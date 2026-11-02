import { UserFacingError } from '../lib/errors.ts'
import { safeFetch } from '../lib/safe-fetch.ts'
import { normalizeKey } from '../lib/slug.ts'
import { listTags, listUnits } from './catalogs.ts'
import { nameCandidates, parseIngredientLines } from './ingredient-parser.ts'
import { findIngredientByName } from './ingredients.ts'

/**
 * Importa recetas desde una URL leyendo su JSON-LD (schema.org/Recipe), que publican casi todos
 * los sitios de recetas (WordPress + Yoast/WPRM, Kiwilimón, Cookpad, RecetasGratis…).
 * Regresa un **borrador** para revisar; no guarda nada.
 */

export interface DraftIngredient {
  raw: string
  /** Nombre a usar: el del catálogo si empató, o el leído. */
  ingredient: string
  /** true si ya existe en el catálogo. */
  matched: boolean
  quantity: number | null
  unit: string | null
  preparation: string | null
  optional: boolean
  group: string | null
}

export interface RecipeDraft {
  title: string
  description: string | null
  servings: number | null
  prepMinutes: number | null
  cookMinutes: number | null
  steps: string[]
  ingredients: DraftIngredient[]
  /** Etiquetas existentes que coinciden con categoría / palabras clave del sitio. */
  tags: string[]
  imageUrl: string | null
  sourceUrl: string
  siteName: string
  /** Lectura aproximada (sin schema.org): revisar con más cuidado. */
  approximate: boolean
}

/** Datos crudos sacados del HTML (puro; sirve para pruebas con fixtures). */
export interface ExtractedRecipe {
  title: string
  description: string | null
  servings: number | null
  prepMinutes: number | null
  cookMinutes: number | null
  steps: string[]
  ingredients: { text: string; group: string | null }[]
  keywords: string[]
  imageUrl: string | null
  siteName: string | null
  /** true si no hubo datos estructurados y se leyó el HTML "a ojo". */
  approximate?: boolean
}

// ─── HTML / texto ────────────────────────────────────────────────────────────

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', laquo: '«', raquo: '»',
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú',
  ntilde: 'ñ', Ntilde: 'Ñ', uuml: 'ü', Uuml: 'Ü', iexcl: '¡', iquest: '¿', deg: '°', frac12: '½', frac14: '¼', frac34: '¾',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', middot: '·', bull: '•', times: '×',
}

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (match, code: string) => {
    if (code[0] === '#') {
      let n = code[1]?.toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : match
    }
    return NAMED_ENTITIES[code] ?? match
  })
}

/** Quita etiquetas HTML y decodifica entidades. */
export function htmlToText(value: unknown): string {
  if (typeof value !== 'string') return ''
  return decodeEntities(value.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' '))
    .replace(/[ \t ]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim()
}

// ─── JSON-LD ─────────────────────────────────────────────────────────────────

type Json = Record<string, unknown>

function jsonLdBlocks(html: string): unknown[] {
  let blocks: unknown[] = []
  let re = /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi
  for (let match of html.matchAll(re)) {
    let body = match[1]!.trim().replace(/^<!\[CDATA\[|\]\]>$/g, '').replace(/^<!--|-->$/g, '')
    try {
      blocks.push(JSON.parse(body))
    } catch {
      // Algunos sitios meten saltos de línea crudos dentro de strings.
      try {
        blocks.push(JSON.parse(body.replace(/[\u0000-\u001f]+/g, ' ')))
      } catch {}
    }
  }
  return blocks
}

function isRecipe(node: unknown): node is Json {
  if (!node || typeof node !== 'object') return false
  let type = (node as Json)['@type']
  return type === 'Recipe' || (Array.isArray(type) && type.includes('Recipe'))
}

/** Busca un nodo Recipe en cualquier nivel (arrays, @graph, mainEntity…). */
function findRecipe(node: unknown, depth = 0): Json | null {
  if (depth > 6 || !node || typeof node !== 'object') return null
  if (isRecipe(node)) return node
  let children = Array.isArray(node) ? node : Object.values(node as Json)
  for (let child of children) {
    let found = findRecipe(child, depth + 1)
    if (found) return found
  }
  return null
}

/** ISO 8601 ("PT1H30M", "P0DT0H45M") → minutos. */
export function isoDurationToMinutes(value: unknown): number | null {
  if (typeof value !== 'string') return null
  let m = /^P(?:(\d+)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i.exec(value.trim())
  if (!m) return null
  let minutes = Number(m[1] ?? 0) * 1440 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) + Number(m[4] ?? 0) / 60
  return minutes > 0 ? Math.round(minutes) : null
}

function parseServings(value: unknown): number | null {
  let values = Array.isArray(value) ? value : [value]
  for (let v of values) {
    if (typeof v === 'number' && v > 0) return Math.min(100, Math.round(v))
    if (typeof v === 'string') {
      let m = /(\d+)/.exec(v)
      if (m) return Math.min(100, Math.max(1, Number(m[1])))
    }
  }
  return null
}

function firstImage(value: unknown, base: string): string | null {
  let candidate: unknown = Array.isArray(value) ? value[0] : value
  if (candidate && typeof candidate === 'object') candidate = (candidate as Json).url ?? (candidate as Json).contentUrl
  if (typeof candidate !== 'string' || !candidate) return null
  try {
    let url = new URL(candidate, base)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}

/** Pasos desde string, HowToStep, HowToSection (con itemListElement) o arreglos mezclados. */
function collectSteps(value: unknown, out: string[] = [], depth = 0): string[] {
  if (depth > 5 || value == null) return out
  if (typeof value === 'string') {
    let text = htmlToText(value)
    // Un solo bloque de texto: separa por renglones o por pasos numerados.
    let parts = text.split(/\n+|(?:^|\s)(?=\d+[.)]\s)/).map((s) => s.trim()).filter(Boolean)
    out.push(...parts)
    return out
  }
  if (Array.isArray(value)) {
    for (let v of value) collectSteps(v, out, depth + 1)
    return out
  }
  if (typeof value === 'object') {
    let node = value as Json
    if (node.itemListElement) return collectSteps(node.itemListElement, out, depth + 1)
    let text = htmlToText(node.text) || htmlToText(node.name)
    if (text) out.push(text)
  }
  return out
}

function collectKeywords(recipe: Json): string[] {
  let words: string[] = []
  for (let field of ['recipeCategory', 'recipeCuisine', 'keywords']) {
    let value = recipe[field]
    let list = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : []
    for (let item of list) if (typeof item === 'string' && item.trim()) words.push(htmlToText(item))
  }
  return [...new Set(words)]
}

function siteNameOf(html: string): string | null {
  return metaContent(html, 'og:site_name')
}

function metaContent(html: string, property: string): string | null {
  let re = new RegExp(`<meta[^>]+(?:property|name)=["']${property}["'][^>]*content=["']([^"']+)["']|<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${property}["']`, 'i')
  let m = re.exec(html)
  let value = m?.[1] ?? m?.[2]
  return value ? decodeEntities(value).trim() : null
}

/**
 * Extrae la receta del HTML: 1) JSON-LD schema.org/Recipe, 2) objeto de receta embebido (Kiwilimón),
 * 3) lectura aproximada de las secciones "Ingredientes" / "Preparación". Lanza un error claro si no hay.
 */
export function extractRecipe(html: string, url: string): ExtractedRecipe {
  let recipe: Json | null = null
  for (let block of jsonLdBlocks(html)) {
    recipe = findRecipe(block)
    if (recipe) break
  }
  // JSON-LD vacío (algunos sitios lo llenan con JavaScript): se intenta lo demás.
  let ldIngredients = recipe ? (recipe.recipeIngredient ?? recipe.ingredients) : null
  let noIngredients = !ldIngredients || (Array.isArray(ldIngredients) && !ldIngredients.length)
  if (!recipe || noIngredients) {
    let embedded = extractEmbedded(html, url) ?? extractFromHeadings(html, url)
    if (embedded) return embedded
  }
  if (!recipe) {
    throw new UserFacingError(
      'No encontré una receta en esa página. Prueba con la página de la receta (no un listado) o captúrala a mano.',
    )
  }

  let title = htmlToText(recipe.name) || htmlToText(recipe.headline)
  if (!title) throw new UserFacingError('La receta de esa página no tiene nombre.')

  let ingredientsRaw = recipe.recipeIngredient ?? recipe.ingredients
  let ingredientList = (Array.isArray(ingredientsRaw) ? ingredientsRaw : typeof ingredientsRaw === 'string' ? ingredientsRaw.split('\n') : [])
    .map((i) => htmlToText(typeof i === 'string' ? i : (i as Json)?.text))
    .filter(Boolean)

  // Algunos sitios meten subtítulos como renglones ("Para la salsa:").
  let group: string | null = null
  let ingredients: { text: string; group: string | null }[] = []
  for (let text of ingredientList) {
    let heading = /^(?:para (?:el|la|los|las)\s.+|[^\d]{3,40}):$/i.exec(text)
    if (heading) {
      group = text.replace(/:$/, '').trim()
      continue
    }
    ingredients.push({ text, group })
  }

  let prep = isoDurationToMinutes(recipe.prepTime)
  let cook = isoDurationToMinutes(recipe.cookTime)
  let total = isoDurationToMinutes(recipe.totalTime)
  if (cook === null && total !== null) cook = prep !== null && total > prep ? total - prep : prep === null ? total : null

  return {
    title,
    description: htmlToText(recipe.description) || null,
    servings: parseServings(recipe.recipeYield),
    prepMinutes: prep,
    cookMinutes: cook,
    steps: collectSteps(recipe.recipeInstructions).map((s) => s.replace(/^\d+[.)]\s*/, '')).filter(Boolean),
    ingredients,
    keywords: collectKeywords(recipe),
    imageUrl: firstImage(recipe.image ?? recipe.thumbnailUrl, url) ?? firstImage(metaContent(html, 'og:image'), url),
    siteName: siteNameOf(html),
  }
}

/** Lee un objeto JSON balanceado a partir de `start` (que apunta a "{"). */
function readJsonObject(text: string, start: number): unknown {
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length && i - start < 2_000_000; i++) {
    let c = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (c === '\\') escaped = true
      else if (c === '"') inString = false
    } else if (c === '"') inString = true
    else if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1))
        } catch {
          return null
        }
      }
    }
  }
  return null
}

/** Objeto `"recipe":{…}` embebido con `ingredients[].text` y `steps[].text` (p. ej. Kiwilimón). */
function extractEmbedded(html: string, url: string): ExtractedRecipe | null {
  for (let match of html.matchAll(/"recipe"\s*:\s*\{/g)) {
    let obj = readJsonObject(html, match.index! + match[0].length - 1) as Json | null
    if (!obj || !Array.isArray(obj.ingredients) || !obj.ingredients.length) continue
    let text = (v: unknown) => htmlToText(typeof v === 'string' ? v : (v as Json | null)?.text)
    let ingredients = (obj.ingredients as unknown[]).map(text).filter(Boolean)
    if (!ingredients.length) continue
    let title = htmlToText(obj.name) || htmlToText(obj.titleh1) || metaContent(html, 'og:title') || ''
    if (!title) continue
    let num = (v: unknown) => (typeof v === 'number' && v > 0 ? Math.round(v) : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : null)
    let prep = num(obj.time) ?? num(obj.preparationtime)
    let cook = num(obj.cooktime) ?? num(obj.cookingtime)
    let total = num(obj.totaltime)
    if (cook === null && total !== null) cook = prep !== null && total > prep ? total - prep : total
    return {
      title: title.trim(),
      description: htmlToText(obj.description) || null,
      servings: parseServings(obj.portions ?? obj.servings ?? obj.yield),
      prepMinutes: prep,
      cookMinutes: cook,
      steps: (Array.isArray(obj.steps) ? obj.steps : []).map(text).filter(Boolean),
      ingredients: ingredients.map((t) => ({ text: t, group: null })),
      keywords: [htmlToText(obj.classificationname)].filter(Boolean),
      imageUrl: firstImage(metaContent(html, 'og:image'), url),
      siteName: siteNameOf(html),
    }
  }
  return null
}

const INGREDIENTS_HEADING = /^ingredientes\b/i
const STEPS_HEADING = /^(?:preparaci[oó]n|elaboraci[oó]n|instrucciones|procedimiento|paso a paso|modo de preparaci[oó]n|c[oó]mo (?:se )?(?:hace|prepara))/i

/**
 * Lectura aproximada sin datos estructurados: lista(s) después de un encabezado "Ingredientes"
 * y lista(s) o párrafos después de "Preparación" (o de subtítulos que le siguen).
 */
function extractFromHeadings(html: string, url: string): ExtractedRecipe | null {
  let body = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->/gi, '')
  let headings = [...body.matchAll(/<(h[1-6])\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((m) => ({
    level: Number(m[1]![1]),
    text: htmlToText(m[2]),
    start: m.index!,
    end: m.index! + m[0].length,
  }))
  let ing = headings.findIndex((h) => INGREDIENTS_HEADING.test(h.text))
  if (ing < 0) return null

  let itemsBetween = (from: number, to: number) =>
    [...body.slice(from, to).matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map((m) => htmlToText(m[1]).replace(/\n+/g, ' ')).filter(Boolean)

  let stepsIndex = headings.findIndex((h, i) => i > ing && STEPS_HEADING.test(h.text))
  // Ingredientes: hasta el siguiente encabezado que no sea un grupo de ingredientes ("Para la salsa").
  let isGroup = (text: string) => /^para\s/i.test(text) || /:$/.test(text)
  let ingEnd =
    headings.find((h, i) => i > ing && (i === stepsIndex || h.level <= headings[ing]!.level || !isGroup(h.text)))?.start ??
    body.length
  let ingredients = itemsBetween(headings[ing]!.end, ingEnd)
  if (!ingredients.length) return null

  // Pasos: desde "Preparación" (o desde el fin de ingredientes) hasta un encabezado de nivel ≤ 2 que no sea subsección.
  let stepsStart = stepsIndex >= 0 ? headings[stepsIndex]!.end : ingEnd
  let baseLevel = stepsIndex >= 0 ? headings[stepsIndex]!.level : headings[ing]!.level
  let stepsEnd =
    headings.find((h) => h.start > stepsStart && h.level <= baseLevel && !STEPS_HEADING.test(h.text) && h.level <= 2)?.start ??
    Math.min(body.length, stepsStart + 40_000)
  let steps = itemsBetween(stepsStart, stepsEnd)
  if (!steps.length) {
    steps = [...body.slice(stepsStart, stepsEnd).matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => htmlToText(m[1])).filter((t) => t.length > 15)
  }

  let h1 = headings.find((h) => h.level === 1)?.text
  let title = metaContent(html, 'og:title')?.replace(/\s*[|–-]\s*[^|–-]+$/, '') || h1
  if (!title) return null
  return {
    title,
    description: metaContent(html, 'og:description') || metaContent(html, 'description'),
    servings: null,
    prepMinutes: null,
    cookMinutes: null,
    steps,
    ingredients: ingredients.map((text) => ({ text, group: null })),
    keywords: [],
    imageUrl: firstImage(metaContent(html, 'og:image'), url),
    siteName: siteNameOf(html),
    approximate: true,
  }
}

// ─── Empate con el catálogo ──────────────────────────────────────────────────

/**
 * Busca el ingrediente en el catálogo: tal cual, en singular, o quitando palabras finales
 * ("jalapeños en escabeche" → Chile jalapeño, y "en escabeche" queda como preparación).
 */
export async function matchIngredientName(name: string): Promise<{ name: string; rest: string | null } | null> {
  for (let candidate of nameCandidates(name)) {
    let found = await findIngredientByName(candidate)
    if (found) return { name: found.name, rest: null }
  }
  let original = name.replace(/\s+/g, ' ').trim().split(' ')
  let words = normalizeKey(name).split(' ')
  for (let n = words.length - 1; n >= 1; n--) {
    // "pasta de achiote" no es "pasta": un "de …" suele definir otro producto.
    if (/^(?:de|del|con)$/.test(words[n]!)) continue
    for (let candidate of nameCandidates(words.slice(0, n).join(' '))) {
      let found = await findIngredientByName(candidate)
      if (found) {
        let rest = original.slice(n).join(' ').replace(/^(?:de|del|en)\s+$/i, '').trim()
        return { name: found.name, rest: rest || null }
      }
    }
  }
  return null
}

export async function buildDraft(extracted: ExtractedRecipe, sourceUrl: string): Promise<RecipeDraft> {
  let units = new Set((await listUnits()).map((u) => u.code))
  let parsed = parseIngredientLines(extracted.ingredients.map((i) => i.text))
  let groupOf = new Map(extracted.ingredients.map((i) => [i.text.replace(/\s+/g, ' ').trim(), i.group]))

  let ingredients: DraftIngredient[] = []
  for (let p of parsed) {
    let match = await matchIngredientName(p.name)
    ingredients.push({
      raw: p.raw,
      ingredient: match?.name ?? p.name.charAt(0).toLocaleUpperCase('es') + p.name.slice(1),
      matched: Boolean(match),
      quantity: p.quantity,
      // Si el catálogo ya no tiene esa unidad, se deja sin unidad (el texto original queda en `raw`).
      unit: p.unit && units.has(p.unit) ? p.unit : null,
      preparation: [match?.rest, p.preparation].filter(Boolean).join(', ') || null,
      optional: p.optional,
      group: groupOf.get(p.raw) ?? null,
    })
  }

  let tagByKey = new Map((await listTags()).map((t) => [normalizeKey(t.name), t.name]))
  let tags = [...new Set(extracted.keywords.map((k) => tagByKey.get(normalizeKey(k))).filter((t): t is string => Boolean(t)))]

  return {
    title: extracted.title,
    description: extracted.description,
    servings: extracted.servings,
    prepMinutes: extracted.prepMinutes,
    cookMinutes: extracted.cookMinutes,
    steps: extracted.steps,
    ingredients,
    tags,
    imageUrl: extracted.imageUrl,
    sourceUrl,
    siteName: extracted.siteName ?? new URL(sourceUrl).hostname.replace(/^www\./, ''),
    approximate: Boolean(extracted.approximate),
  }
}

type FetchHtml = (url: string) => Promise<{ url: string; html: string }>

/** Solo para pruebas: reemplaza la descarga (el fetch real no puede llegar a servidores locales). */
export const importerTesting: { fetchHtml: FetchHtml | null } = { fetchHtml: null }

/** Descarga, extrae y arma el borrador. */
export async function importRecipeFromUrl(url: string, options: { fetchHtml?: FetchHtml } = {}): Promise<RecipeDraft> {
  let fetchHtml =
    options.fetchHtml ??
    importerTesting.fetchHtml ??
    (async (u: string) => {
      let res = await safeFetch(u, { maxBytes: 4 * 1024 * 1024 })
      if (!/html|xml|text\/plain/i.test(res.contentType) && res.contentType) {
        throw new UserFacingError('Esa URL no es una página web (parece un archivo).')
      }
      return { url: res.url, html: decodeHtml(res.body, res.contentType) }
    })
  let page = await fetchHtml(url)
  return buildDraft(extractRecipe(page.html, page.url), page.url)
}

/** Decodifica respetando el charset (header o meta); UTF-8 por defecto, tolerante a bytes inválidos. */
export function decodeHtml(body: Buffer, contentType: string): string {
  let charset = /charset=["']?([\w-]+)/i.exec(contentType)?.[1]
  if (!charset) charset = /<meta[^>]+charset=["']?([\w-]+)/i.exec(body.subarray(0, 4096).toString('latin1'))?.[1]
  try {
    return new TextDecoder((charset ?? 'utf-8').toLowerCase()).decode(body)
  } catch {
    return new TextDecoder('utf-8').decode(body)
  }
}
