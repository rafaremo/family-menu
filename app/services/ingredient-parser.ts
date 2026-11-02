import { normalizeKey } from '../lib/slug.ts'

/**
 * Parser de renglones de ingredientes en español (puro, sin BD):
 *   "2 tazas de harina cernida"           → 2 taza  · harina           · cernida
 *   "1 ½ cdas. de aceite de oliva"        → 1.5 cda · aceite de oliva
 *   "3 jitomates picados finamente"       → 3 —     · jitomates        · picados finamente
 *   "Sal y pimienta al gusto"             → sal (al gusto) + pimienta (al gusto)
 *   "1 lata (400 g) de chiles chipotles"  → 1 lata  · chiles chipotles · 400 g
 *   "2-3 dientes de ajo"                  → 3 diente · ajo
 *   "Medio kilo de carne molida"          → 0.5 kg  · carne molida
 */

export interface ParsedIngredient {
  /** Texto original. */
  raw: string
  quantity: number | null
  /** Código de unidad (del catálogo sembrado) o null. */
  unit: string | null
  name: string
  preparation: string | null
  optional: boolean
}

const UNICODE_FRACTIONS: Record<string, string> = {
  '½': ' 1/2', '⅓': ' 1/3', '⅔': ' 2/3', '¼': ' 1/4', '¾': ' 3/4', '⅕': ' 1/5', '⅛': ' 1/8', '⅜': ' 3/8', '⅝': ' 5/8', '⅞': ' 7/8',
}

const WORD_NUMBERS: Record<string, number> = {
  un: 1, una: 1, uno: 1, medio: 0.5, media: 0.5, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8,
  nueve: 9, diez: 10, once: 11, doce: 12, quince: 15, veinte: 20, 'un cuarto': 0.25, 'tres cuartos': 0.75, 'un tercio': 1 / 3,
  'un par': 2, 'un par de': 2,
}

/** [regex sin anclas, código]. El orden importa: lo más largo primero. */
const UNIT_PATTERNS: [string, string][] = [
  ['cucharaditas?|cditas?\\.?|cdtas?\\.?|cdta\\.?|c\\/c', 'cdta'],
  ['cucharadas?(?: soperas?)?|cdas?\\.?|c\\/s', 'cda'],
  ['tazas?|tzs?\\.?', 'taza'],
  ['kilogramos?|kilos?|kgs?\\.?', 'kg'],
  ['gramos?|grams?|grs?\\.?|gms?\\.?|g\\.?', 'g'],
  ['mililitros?|ml\\.?', 'ml'],
  ['litros?|lts?\\.?|l\\.?', 'l'],
  ['libras?|lbs?\\.?', 'lb'],
  ['onzas?|oz\\.?', 'oz'],
  ['piezas?|pzas?\\.?|pzs?\\.?', 'pz'],
  ['docenas?', 'docena'],
  ['dientes?', 'diente'],
  ['manojos?|manojitos?', 'manojo'],
  ['ramas?|ramitas?|ramitos?', 'rama'],
  ['hojas?', 'hoja'],
  ['rebanadas?', 'rebanada'],
  ['latas?', 'lata'],
  ['paquetes?', 'paquete'],
  ['sobres?|sobrecitos?', 'sobre'],
  ['frascos?', 'frasco'],
  ['pizcas?|pizquitas?', 'pizca'],
]

const UNIT_RE = new RegExp(`^(?:${UNIT_PATTERNS.map(([p]) => `(${p})`).join('|')})(?=\\s|$|\\(|,)`, 'i')

const NUMBER = String.raw`(?:\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:[.,]\d+)?)`
const QTY_RE = new RegExp(String.raw`^(${NUMBER})(?:\s*(?:-|–|a|o)\s*(${NUMBER}))?(?:\s+y\s+(medio|media|\d+\/\d+))?\s*`, 'i')

const TO_TASTE_RE = /\b(al gusto|a gusto|c\/n|cantidad necesaria|lo necesario|lo que se necesite|suficiente)\b/i
const OPTIONAL_RE = /\(?\s*\bopcional(?:es)?\b\s*\)?/i

/** Marcadores que suelen empezar la "preparación" cuando no hay coma. */
const PREP_MARKERS = [
  'finamente', 'picad[oa]s?', 'cortad[oa]s?', 'rebanad[oa]s?', 'troceado?s?', 'rallad[oa]s?', 'desvenad[oa]s?', 'pelad[oa]s?',
  'cocid[oa]s?', 'deshebrad[oa]s?', 'fileteada?s?', 'machacad[oa]s?', 'asad[oa]s?', 'remojad[oa]s?', 'derretid[oa]s?',
  'tostad[oa]s?(?! de)', 'escurrid[oa]s?', 'cernid[oa]s?', 'desmoronad[oa]s?', 'batid[oa]s?', 'hervid[oa]s?', 'lavad[oa]s?', 'desinfectad[oa]s?', 'en cubos', 'en cubitos', 'en cuadritos',
  'en rodajas', 'en trozos', 'en tiras', 'en julianas?', 'en mitades', 'sin semillas', 'sin piel', 'sin hueso', 'a temperatura ambiente',
  'tibi[oa]', 'frí[oa]', 'para (?:decorar|servir|acompañar|freír|engrasar)',
]
const PREP_RE = new RegExp(`\\s(?:${PREP_MARKERS.join('|')})\\b`, 'i')

function toNumber(text: string): number {
  let t = text.trim().replace(',', '.')
  let mixed = /^(\d+)\s+(\d+)\/(\d+)$/.exec(t)
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3])
  let frac = /^(\d+)\/(\d+)$/.exec(t)
  if (frac) return Number(frac[2]) ? Number(frac[1]) / Number(frac[2]) : NaN
  return Number(t)
}

function round(n: number): number {
  return Math.round(n * 10_000) / 10_000
}

function clean(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/^[\s,;:.\-–]+|[\s,;:.\-–]+$/g, '')
    .trim()
}

export function parseIngredientLine(rawInput: string): ParsedIngredient {
  let raw = rawInput.replace(/\s+/g, ' ').trim()
  let text = raw.replace(/^[-•*·▪︎◦]\s*/, '').replace(/^(?:null|undefined)\s+/i, '')
  for (let [symbol, replacement] of Object.entries(UNICODE_FRACTIONS)) text = text.split(symbol).join(replacement)
  text = text.replace(/\s+/g, ' ').trim()

  let optional = OPTIONAL_RE.test(text)
  if (optional) text = clean(text.replace(OPTIONAL_RE, ' '))

  // Paréntesis → notas ("1 lata (400 g)", "(o de verduras, hecho en casa)"), antes de partir por comas.
  let notes: string[] = []
  text = text.replace(/\s*\(([^()]{1,120})\)\s*/g, (_, inner: string) => {
    let note = inner.trim()
    if (note) notes.push(note)
    return ' '
  })
  text = clean(text)

  let toTaste = TO_TASTE_RE.test(text)
  if (toTaste) text = clean(text.replace(TO_TASTE_RE, ' '))

  // Cantidad: número, fracción, rango (se toma el mayor para que alcance) o palabra.
  let quantity: number | null = null
  let q = QTY_RE.exec(text)
  if (q) {
    let low = toNumber(q[1]!)
    let high = q[2] ? toNumber(q[2]) : low
    let extra = q[3] ? (/^medi[oa]$/i.test(q[3]) ? 0.5 : toNumber(q[3])) : 0
    let value = Math.max(low, high) + extra
    if (Number.isFinite(value) && value > 0) {
      quantity = round(value)
      text = text.slice(q[0].length)
    }
  } else {
    let lower = text.toLowerCase()
    let word = Object.keys(WORD_NUMBERS)
      .sort((a, b) => b.length - a.length)
      .find((w) => lower === w || lower.startsWith(`${w} `))
    if (word) {
      quantity = WORD_NUMBERS[word]!
      text = text.slice(word.length).trim()
    }
  }

  // "1count", "2 unidades" (artefactos de algunos sitios) → sin unidad.
  text = text.replace(/^(?:count|unidad(?:es)?|uds?\.?)\b\s*/i, '')
  // "¼ de taza", "1/2 de cucharadita"
  if (quantity !== null) text = text.replace(/^de\s+(?=\S)/i, (m) => (UNIT_RE.test(text.slice(m.length)) ? '' : m))

  // Unidad (solo justo después de la cantidad, o "pizca de…").
  let unit: string | null = null
  let u = UNIT_RE.exec(text)
  if (u && (quantity !== null || /^pizcas?\b/i.test(text))) {
    let index = u.slice(1).findIndex(Boolean)
    unit = UNIT_PATTERNS[index]![1]
    text = text.slice(u[0].length).trim()
    if (quantity === null && unit === 'pizca') quantity = 1
    // "1 taza y media de …"
    let half = /^y medi[oa]\b\s*/i.exec(text)
    if (half && quantity !== null) {
      quantity = round(quantity + 0.5)
      text = text.slice(half[0].length)
    }
  }

  text = text.replace(/^(?:de|del)\s+/i, '')

  // Nombre y preparación: primero por coma; si no, por marcadores ("picado", "en cubos"…).
  let name = text
  let preparation: string | null = null
  let comma = text.indexOf(',')
  if (comma > 0) {
    name = text.slice(0, comma)
    preparation = text.slice(comma + 1)
  } else {
    let marker = PREP_RE.exec(` ${text}`)
    if (marker && marker.index > 0) {
      name = text.slice(0, marker.index - 1)
      preparation = text.slice(marker.index - 1)
    }
  }
  let prep = clean([preparation, ...notes].filter(Boolean).join(', ').replace(/[()]/g, ''))
  return {
    raw,
    quantity: toTaste && quantity === null ? null : quantity,
    unit: toTaste && quantity === null ? null : unit,
    name: clean(name.replace(/\.$/, '')),
    preparation: prep || null,
    optional,
  }
}

/** Parsea varias líneas; separa "sal y pimienta al gusto" en dos renglones. Ignora títulos vacíos. */
export function parseIngredientLines(lines: string[]): ParsedIngredient[] {
  let result: ParsedIngredient[] = []
  for (let line of lines) {
    let parsed = parseIngredientLine(line)
    if (!parsed.name) continue
    let compound = /^([\p{L}]+(?: [\p{L}]+)?) y ([\p{L}]+(?: [\p{L}]+)?)$/u.exec(parsed.name)
    if (parsed.quantity === null && compound && parsed.name.split(' ').length <= 4) {
      result.push({ ...parsed, name: compound[1]! }, { ...parsed, name: compound[2]! })
    } else {
      result.push(parsed)
    }
  }
  return result
}

/** Candidatos para empatar con el catálogo: tal cual, y en singular ("chiles serranos" → "chile serrano"). */
export function nameCandidates(name: string): string[] {
  let key = normalizeKey(name)
  let words = key.split(' ')
  let singular = (w: string) => (w.length > 4 && /[^aeiou]es$/.test(w) ? w.slice(0, -2) : w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w)
  let candidates = [
    key,
    words.map((w) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w)).join(' '),
    words.map(singular).join(' '),
    singular(words[0]!) + (words.length > 1 ? ` ${words.slice(1).join(' ')}` : ''),
  ]
  return [...new Set(candidates.filter(Boolean))]
}
