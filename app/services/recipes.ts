import { and, asc, count, desc, eq, inArray, ne, sql, type SQL } from 'drizzle-orm'
import * as z from 'zod'

import { db } from '../db/client.ts'
import {
  aisle,
  favorite,
  ingredient,
  recipe,
  recipeIngredient,
  recipePhoto,
  recipeTag,
  tag,
  unit,
  user,
  type RecipeStep,
} from '../db/schema/index.ts'
import { PG_UNIQUE_VIOLATION, pgErrorCode, UserFacingError } from '../lib/errors.ts'
import { parseQuantity, QuantityError } from '../lib/quantity.ts'
import { cleanText, normalizeKey, slugify } from '../lib/slug.ts'
import { blankToNull, optionalText } from '../lib/validation.ts'
import { audit, type ServiceActor } from './audit.ts'
import { createIngredient, findIngredientByName } from './ingredients.ts'
import { listRecipePhotos, removeStoredFiles, type RecipePhoto } from './photos.ts'
import { buildRecipeSearchText } from './recipe-search.ts'

/**
 * Recetas. Toda la lógica vive aquí; el dashboard y el MCP solo validan entrada y llaman.
 *
 * - Los ingredientes se indican por nombre o alias; si no existen se crean (y se reportan).
 * - Las unidades se aceptan por código, nombre o plural ("cda", "cucharada", "cucharadas").
 * - Las etiquetas se indican por nombre o slug; las que no existen se crean como "libres".
 */

// ─── Esquemas ────────────────────────────────────────────────────────────────

const quantityField = z.unknown().transform((value, ctx) => {
  try {
    return parseQuantity(blankToNull(value))
  } catch (error) {
    ctx.addIssue({ code: 'custom', message: error instanceof QuantityError ? error.message : 'Cantidad no válida.' })
    return z.NEVER
  }
})

const booleanField = z.preprocess(
  (v) => v === true || v === 'on' || v === 'true' || v === '1',
  z.boolean(),
)

export const recipeIngredientInput = z.object({
  /** Nombre o alias del ingrediente. */
  ingredient: z.string().transform(cleanText).pipe(z.string().min(1, 'Escribe el ingrediente.').max(80, 'Máximo 80 caracteres.')),
  quantity: quantityField.optional(),
  /** Código, nombre o plural de la unidad. Vacío = sin unidad (piezas sueltas, "al gusto"). */
  unit: optionalText(30),
  preparation: optionalText(120),
  group: optionalText(60),
  optional: booleanField.optional(),
})
export type RecipeIngredientInput = z.output<typeof recipeIngredientInput>

function optionalInt(label: string, min: number, max: number) {
  return z.preprocess(
    (v) => {
      let value = blankToNull(v)
      return typeof value === 'string' ? Number(value.trim()) : value
    },
    z
      .number({ message: `${label}: escribe un número.` })
      .int(`${label}: número entero.`)
      .min(min, `${label}: mínimo ${min}.`)
      .max(max, `${label}: máximo ${max}.`)
      .nullable()
      .optional(),
  )
}

/** Pasos: texto (un paso por renglón), arreglo de textos o de `{ text }`. */
const stepsField = z.preprocess(
  (value) => {
    if (value === null) return []
    if (typeof value === 'string') return value.split(/\r?\n/)
    if (Array.isArray(value)) return value.map((s) => (typeof s === 'object' && s && 'text' in s ? s.text : s))
    return value
  },
  z
    .array(z.string())
    .transform((items) =>
      items.map((s) => s.replace(/^\s*(\d+[.)]|[-•*])\s+/, '').replace(/\s+/g, ' ').trim()).filter(Boolean),
    )
    .pipe(z.array(z.string().max(2000, 'Cada paso: máximo 2000 caracteres.')).max(60, 'Máximo 60 pasos.'))
    .transform((items): RecipeStep[] => items.map((text) => ({ text })))
    .optional(),
)

const tagsField = z.preprocess(
  (value) => (typeof value === 'string' ? value.split(',') : value === null ? [] : value),
  z
    .array(z.string())
    .transform((items) => [...new Set(items.map(cleanText).filter(Boolean))])
    .pipe(z.array(z.string().max(60)).max(30, 'Máximo 30 etiquetas.'))
    .optional(),
)

const urlField = z.preprocess(
  blankToNull,
  z
    .string()
    .trim()
    .max(2000)
    .url('Escribe una URL válida (https://…).')
    .refine((u) => /^https?:\/\//i.test(u), 'Solo URLs http o https.')
    .nullable()
    .optional(),
)

export const recipeInput = z.object({
  title: z.string().transform(cleanText).pipe(z.string().min(1, 'Escribe el nombre de la receta.').max(120, 'Máximo 120 caracteres.')),
  description: optionalText(2000),
  servings: optionalInt('Porciones', 1, 100),
  prepMinutes: optionalInt('Preparación', 0, 2880),
  cookMinutes: optionalInt('Cocción', 0, 2880),
  steps: stepsField,
  notes: optionalText(4000),
  sourceUrl: urlField,
  familyCredit: optionalText(120),
  ingredients: z.array(recipeIngredientInput).max(100, 'Máximo 100 ingredientes.').optional(),
  tags: tagsField,
})
export type RecipeInput = z.output<typeof recipeInput>

/** Updates parciales (MCP): lo que no venga se conserva. `ingredients`/`tags` reemplazan la lista completa. */
export const recipePatch = recipeInput.partial()
export type RecipePatch = z.output<typeof recipePatch>

export const DEFAULT_SERVINGS = 4

// ─── Tipos de lectura ────────────────────────────────────────────────────────

export interface RecipeIngredientLine {
  id: number
  ingredientId: number
  name: string
  slug: string
  quantity: number | null
  unitCode: string | null
  unitName: string | null
  unitPlural: string | null
  preparation: string | null
  groupLabel: string | null
  optional: boolean
  position: number
  aisleName: string | null
}

export interface RecipeTagRef {
  id: number
  name: string
  slug: string
  kind: 'category' | 'diet' | 'occasion' | 'free'
}

export interface RecipeDetail {
  id: number
  title: string
  slug: string
  description: string | null
  servings: number
  prepMinutes: number | null
  cookMinutes: number | null
  steps: RecipeStep[]
  notes: string | null
  sourceUrl: string | null
  familyCredit: string | null
  coverPhotoId: number | null
  coverPhotoKey: string | null
  createdByName: string | null
  createdAt: Date
  updatedAt: Date
  ingredients: RecipeIngredientLine[]
  tags: RecipeTagRef[]
  photos: RecipePhoto[]
  isFavorite: boolean
  favoriteCount: number
}

export interface RecipeCard {
  id: number
  title: string
  slug: string
  description: string | null
  servings: number
  totalMinutes: number | null
  familyCredit: string | null
  coverPhotoKey: string | null
  tags: RecipeTagRef[]
  isFavorite: boolean
}

export interface WriteResult {
  recipe: RecipeDetail
  /** Ingredientes que no existían y se crearon. */
  createdIngredients: string[]
  /** Etiquetas que no existían y se crearon. */
  createdTags: string[]
}

// ─── Lectura ─────────────────────────────────────────────────────────────────

async function recipeRow(where: SQL) {
  let [row] = await db
    .select({
      recipe,
      coverPhotoKey: recipePhoto.storageKey,
      createdByName: user.name,
    })
    .from(recipe)
    .leftJoin(recipePhoto, eq(recipePhoto.id, recipe.coverPhotoId))
    .leftJoin(user, eq(user.id, recipe.createdBy))
    .where(where)
    .limit(1)
  return row
}

async function loadDetail(where: SQL, viewerId?: string | null): Promise<RecipeDetail> {
  let row = await recipeRow(where)
  if (!row) throw new UserFacingError('Esa receta no existe.', 404)
  let r = row.recipe

  let [lines, tags, photos, favs] = await Promise.all([
    db
      .select({
        id: recipeIngredient.id,
        ingredientId: recipeIngredient.ingredientId,
        name: ingredient.name,
        slug: ingredient.slug,
        quantity: recipeIngredient.quantity,
        unitCode: recipeIngredient.unitCode,
        unitName: unit.name,
        unitPlural: unit.plural,
        preparation: recipeIngredient.preparation,
        groupLabel: recipeIngredient.groupLabel,
        optional: recipeIngredient.optional,
        position: recipeIngredient.position,
        aisleName: aisle.name,
      })
      .from(recipeIngredient)
      .innerJoin(ingredient, eq(ingredient.id, recipeIngredient.ingredientId))
      .leftJoin(unit, eq(unit.code, recipeIngredient.unitCode))
      .leftJoin(aisle, eq(aisle.id, ingredient.aisleId))
      .where(eq(recipeIngredient.recipeId, r.id))
      .orderBy(asc(recipeIngredient.position), asc(recipeIngredient.id)),
    tagsFor([r.id]),
    listRecipePhotos(r.id),
    db.select({ userId: favorite.userId }).from(favorite).where(eq(favorite.recipeId, r.id)),
  ])

  return {
    id: r.id,
    title: r.title,
    slug: r.slug,
    description: r.description,
    servings: r.servings,
    prepMinutes: r.prepMinutes,
    cookMinutes: r.cookMinutes,
    steps: r.steps,
    notes: r.notes,
    sourceUrl: r.sourceUrl,
    familyCredit: r.familyCredit,
    coverPhotoId: r.coverPhotoId,
    coverPhotoKey: row.coverPhotoKey,
    createdByName: row.createdByName,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    ingredients: lines,
    tags: tags.get(r.id) ?? [],
    photos,
    isFavorite: Boolean(viewerId && favs.some((f) => f.userId === viewerId)),
    favoriteCount: favs.length,
  }
}

export function getRecipe(id: number, viewerId?: string | null): Promise<RecipeDetail> {
  return loadDetail(eq(recipe.id, id), viewerId)
}

export function getRecipeBySlug(slug: string, viewerId?: string | null): Promise<RecipeDetail> {
  return loadDetail(eq(recipe.slug, slug), viewerId)
}

const KIND_ORDER = { category: 0, diet: 1, occasion: 2, free: 3 } as const

async function tagsFor(recipeIds: number[]): Promise<Map<number, RecipeTagRef[]>> {
  let map = new Map<number, RecipeTagRef[]>()
  if (!recipeIds.length) return map
  let rows = await db
    .select({ recipeId: recipeTag.recipeId, id: tag.id, name: tag.name, slug: tag.slug, kind: tag.kind })
    .from(recipeTag)
    .innerJoin(tag, eq(tag.id, recipeTag.tagId))
    .where(inArray(recipeTag.recipeId, recipeIds))
  for (let { recipeId, ...t } of rows) {
    let list = map.get(recipeId) ?? []
    list.push(t)
    map.set(recipeId, list)
  }
  for (let list of map.values()) {
    list.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.name.localeCompare(b.name, 'es'))
  }
  return map
}

export interface RecipeListOptions {
  q?: string
  /** slug de la etiqueta */
  tag?: string
  /** texto: recetas que llevan un ingrediente que coincide (nombre o alias) */
  ingredient?: string
  /** solo favoritas de este usuario */
  favoritesOf?: string | null
  viewerId?: string | null
  /** 'title' (default) o 'recent' (última modificación). Con búsqueda de texto se ordena por relevancia. */
  sort?: 'title' | 'recent'
  page?: number
  pageSize?: number
}

/** Convierte texto libre en un tsquery con prefijos: "tinga pol" → 'tinga:* & pol:*' */
function prefixTsQuery(q: string): string | null {
  let words = normalizeKey(q)
    .split(/[^a-z0-9ñ]+/)
    .filter((w) => w.length > 0)
    .slice(0, 8)
  return words.length ? words.map((w) => `${w}:*`).join(' & ') : null
}

/** Búsqueda (texto completo en español + tolerancia a errores) con filtros. */
export async function listRecipes(options: RecipeListOptions = {}) {
  let pageSize = Math.min(Math.max(options.pageSize ?? 24, 1), 100)
  let page = Math.max(options.page ?? 1, 1)
  let filters: SQL[] = []
  let rank: SQL | null = null

  let q = options.q ? normalizeKey(options.q) : ''
  let tsq = q ? prefixTsQuery(q) : null
  if (q && tsq) {
    let vector = sql`to_tsvector('spanish'::regconfig, ${recipe.searchText})`
    let query = sql`to_tsquery('spanish'::regconfig, ${tsq})`
    filters.push(sql`(${vector} @@ ${query} or word_similarity(${q}, ${recipe.searchText}) >= 0.5)`)
    rank = sql`(ts_rank(${vector}, ${query}) + word_similarity(${q}, ${recipe.searchText}) * 2)`
  }

  if (options.tag) {
    filters.push(
      sql`exists (select 1 from ${recipeTag} inner join ${tag} on ${tag.id} = ${recipeTag.tagId}
        where ${recipeTag.recipeId} = ${recipe.id} and ${tag.slug} = ${options.tag})`,
    )
  }

  if (options.ingredient) {
    let key = normalizeKey(options.ingredient)
    if (key) {
      filters.push(
        sql`exists (select 1 from ${recipeIngredient} inner join ${ingredient} on ${ingredient.id} = ${recipeIngredient.ingredientId}
          where ${recipeIngredient.recipeId} = ${recipe.id}
          and (${ingredient.searchText} like ${`%${key.replace(/[\\%_]/g, (c) => `\\${c}`)}%`} or word_similarity(${key}, ${ingredient.searchText}) >= 0.6))`,
      )
    }
  }

  if (options.favoritesOf) {
    filters.push(
      sql`exists (select 1 from ${favorite} where ${favorite.recipeId} = ${recipe.id} and ${favorite.userId} = ${options.favoritesOf})`,
    )
  }

  let where = filters.length ? and(...filters) : undefined
  let [totalRow] = await db.select({ n: count() }).from(recipe).where(where)
  let rows = await db
    .select({
      id: recipe.id,
      title: recipe.title,
      slug: recipe.slug,
      description: recipe.description,
      servings: recipe.servings,
      prepMinutes: recipe.prepMinutes,
      cookMinutes: recipe.cookMinutes,
      familyCredit: recipe.familyCredit,
      coverPhotoKey: recipePhoto.storageKey,
    })
    .from(recipe)
    .leftJoin(recipePhoto, eq(recipePhoto.id, recipe.coverPhotoId))
    .where(where)
    .orderBy(
      ...(rank ? [sql`${rank} desc`] : []),
      ...(options.sort === 'recent' ? [desc(recipe.updatedAt)] : []),
      asc(sql`lower(${recipe.title})`),
    )
    .limit(pageSize)
    .offset((page - 1) * pageSize)

  let ids = rows.map((r) => r.id)
  let [tags, favs] = await Promise.all([
    tagsFor(ids),
    options.viewerId && ids.length
      ? db
          .select({ recipeId: favorite.recipeId })
          .from(favorite)
          .where(and(eq(favorite.userId, options.viewerId), inArray(favorite.recipeId, ids)))
      : Promise.resolve([]),
  ])
  let favSet = new Set(favs.map((f) => f.recipeId))

  let items: RecipeCard[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    slug: r.slug,
    description: r.description,
    servings: r.servings,
    totalMinutes: r.prepMinutes === null && r.cookMinutes === null ? null : (r.prepMinutes ?? 0) + (r.cookMinutes ?? 0),
    familyCredit: r.familyCredit,
    coverPhotoKey: r.coverPhotoKey,
    tags: tags.get(r.id) ?? [],
    isFavorite: favSet.has(r.id),
  }))

  let total = totalRow?.n ?? 0
  return { items, total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)) }
}

/** Opciones ligeras (selects de menús, MCP). */
export async function recipeOptions(): Promise<{ id: number; title: string; slug: string; servings: number }[]> {
  return db
    .select({ id: recipe.id, title: recipe.title, slug: recipe.slug, servings: recipe.servings })
    .from(recipe)
    .orderBy(asc(sql`lower(${recipe.title})`))
}

// ─── Escalado ────────────────────────────────────────────────────────────────

/** Escala las cantidades a otro número de porciones ("al gusto" se queda igual). */
export function scaleIngredients(detail: RecipeDetail, servings: number): RecipeIngredientLine[] {
  if (!Number.isFinite(servings) || servings <= 0) throw new UserFacingError('Porciones inválidas.')
  let factor = servings / detail.servings
  return detail.ingredients.map((line) => ({
    ...line,
    quantity: line.quantity === null ? null : Math.round(line.quantity * factor * 10_000) / 10_000,
  }))
}

// ─── Escritura ───────────────────────────────────────────────────────────────

interface UnitLookup {
  resolve(value: string | null | undefined): string | null
}

async function unitLookup(): Promise<UnitLookup> {
  let rows = await db.select({ code: unit.code, name: unit.name, plural: unit.plural }).from(unit)
  let map = new Map<string, string>()
  for (let r of rows) {
    for (let key of [r.code, r.name, r.plural]) map.set(normalizeKey(key), r.code)
  }
  // Abreviaturas comunes en recetas mexicanas.
  let extra: Record<string, string> = {
    tz: 'taza', tza: 'taza', cdas: 'cda', cucharadas: 'cda', cdtas: 'cdta', cditas: 'cdta', cdita: 'cdta',
    gr: 'g', grs: 'g', gramo: 'g', kilo: 'kg', kgs: 'kg', lt: 'l', lts: 'l', pza: 'pz', pzas: 'pz', pzs: 'pz',
  }
  for (let [alias, code] of Object.entries(extra)) {
    if (!map.has(alias) && rows.some((r) => r.code === code)) map.set(alias, code)
  }
  return {
    resolve(value) {
      if (!value) return null
      let code = map.get(normalizeKey(value).replace(/\.$/, ''))
      if (!code) throw new UserFacingError(`No conozco la unidad "${value}". Agrégala en Catálogos o usa otra.`)
      return code
    },
  }
}

interface ResolvedLines {
  rows: Omit<typeof recipeIngredient.$inferInsert, 'recipeId'>[]
  names: string[]
  created: string[]
}

async function resolveIngredientLines(actor: ServiceActor, lines: RecipeIngredientInput[]): Promise<ResolvedLines> {
  let units = await unitLookup()
  let resolvedUnits = lines.map((line) => units.resolve(line.unit))

  let byKey = new Map<string, { id: number; name: string; aliases: string[] }>()
  let created: string[] = []
  for (let [index, line] of lines.entries()) {
    let key = normalizeKey(line.ingredient)
    if (byKey.has(key)) continue
    let found = await findIngredientByName(line.ingredient)
    if (!found) {
      found = await createIngredient(actor, { name: line.ingredient, defaultUnit: resolvedUnits[index] ?? null })
      created.push(found.name)
    }
    byKey.set(key, found)
  }

  let rows = lines.map((line, position) => ({
    ingredientId: byKey.get(normalizeKey(line.ingredient))!.id,
    quantity: line.quantity ?? null,
    unitCode: resolvedUnits[position] ?? null,
    preparation: line.preparation ?? null,
    groupLabel: line.group ?? null,
    optional: line.optional ?? false,
    position,
  }))
  let names = [...byKey.values()].flatMap((i) => [i.name, ...i.aliases])
  return { rows, names, created }
}

async function resolveTags(actor: ServiceActor, names: string[]): Promise<{ ids: number[]; names: string[]; created: string[] }> {
  let ids: number[] = []
  let resolvedNames: string[] = []
  let created: string[] = []
  for (let name of names) {
    let slug = slugify(name)
    let [found] = await db.select().from(tag).where(eq(tag.slug, slug)).limit(1)
    if (!found) {
      ;[found] = await db
        .insert(tag)
        .values({ name, slug, kind: 'free' })
        .onConflictDoNothing()
        .returning()
      found ??= (await db.select().from(tag).where(eq(tag.slug, slug)).limit(1))[0]
      if (!found) continue
      created.push(found.name)
      await audit({ ...actor, action: 'create', entity: 'tag', entityId: String(found.id), details: { name } })
    }
    if (!ids.includes(found.id)) {
      ids.push(found.id)
      resolvedNames.push(found.name)
    }
  }
  return { ids, names: resolvedNames, created }
}

/** Segmentos de /recetas/* que no pueden ser slugs. */
const RESERVED_SLUGS = new Set(['nueva', 'importar'])

async function uniqueRecipeSlug(title: string, excludeId?: number): Promise<string> {
  let base = slugify(title)
  for (let i = 1; i < 200; i++) {
    let candidate = i === 1 ? base : `${base}-${i}`
    if (RESERVED_SLUGS.has(candidate)) continue
    let [taken] = await db
      .select({ id: recipe.id })
      .from(recipe)
      .where(and(eq(recipe.slug, candidate), excludeId ? ne(recipe.id, excludeId) : undefined))
      .limit(1)
    if (!taken) return candidate
  }
  return `${base}-${Date.now()}`
}

export async function createRecipe(actor: ServiceActor, input: RecipeInput): Promise<WriteResult> {
  let lines = await resolveIngredientLines(actor, input.ingredients ?? [])
  let tags = await resolveTags(actor, input.tags ?? [])
  let slug = await uniqueRecipeSlug(input.title)

  let id = await db
    .transaction(async (tx) => {
      let [row] = await tx
        .insert(recipe)
        .values({
          title: input.title,
          slug,
          description: input.description ?? null,
          servings: input.servings ?? DEFAULT_SERVINGS,
          prepMinutes: input.prepMinutes ?? null,
          cookMinutes: input.cookMinutes ?? null,
          steps: input.steps ?? [],
          notes: input.notes ?? null,
          sourceUrl: input.sourceUrl ?? null,
          familyCredit: input.familyCredit ?? null,
          searchText: buildRecipeSearchText({ ...input, ingredientNames: lines.names, tagNames: tags.names }),
          createdBy: actor.userId,
          updatedBy: actor.userId,
        })
        .returning({ id: recipe.id })
      let recipeId = row!.id
      if (lines.rows.length) await tx.insert(recipeIngredient).values(lines.rows.map((r) => ({ ...r, recipeId })))
      if (tags.ids.length) await tx.insert(recipeTag).values(tags.ids.map((tagId) => ({ recipeId, tagId })))
      return recipeId
    })
    .catch((error) => {
      if (pgErrorCode(error) === PG_UNIQUE_VIOLATION) throw new UserFacingError('Ya existe una receta con ese nombre.', 409)
      throw error
    })

  await audit({
    ...actor,
    action: 'create',
    entity: 'recipe',
    entityId: String(id),
    details: { title: input.title, createdIngredients: lines.created, createdTags: tags.created },
  })
  return { recipe: await getRecipe(id, actor.userId), createdIngredients: lines.created, createdTags: tags.created }
}

export async function updateRecipe(actor: ServiceActor, id: number, patch: RecipePatch): Promise<WriteResult> {
  let current = await getRecipe(id)
  let lines = patch.ingredients ? await resolveIngredientLines(actor, patch.ingredients) : null
  let tags = patch.tags ? await resolveTags(actor, patch.tags) : null

  let title = patch.title ?? current.title
  let slug = normalizeKey(title) !== normalizeKey(current.title) ? await uniqueRecipeSlug(title, id) : current.slug

  let ingredientNames =
    lines?.names ??
    (
      await db
        .select({ name: ingredient.name, aliases: ingredient.aliases })
        .from(recipeIngredient)
        .innerJoin(ingredient, eq(ingredient.id, recipeIngredient.ingredientId))
        .where(eq(recipeIngredient.recipeId, id))
    ).flatMap((i) => [i.name, ...i.aliases])
  let tagNames = tags?.names ?? current.tags.map((t) => t.name)
  let description = patch.description === undefined ? current.description : patch.description
  let familyCredit = patch.familyCredit === undefined ? current.familyCredit : patch.familyCredit

  await db.transaction(async (tx) => {
    await tx
      .update(recipe)
      .set({
        title,
        slug,
        description,
        servings: patch.servings === null ? DEFAULT_SERVINGS : patch.servings,
        prepMinutes: patch.prepMinutes,
        cookMinutes: patch.cookMinutes,
        steps: patch.steps,
        notes: patch.notes,
        sourceUrl: patch.sourceUrl,
        familyCredit,
        searchText: buildRecipeSearchText({ title, description, familyCredit, ingredientNames, tagNames }),
        updatedBy: actor.userId,
        updatedAt: new Date(),
      })
      .where(eq(recipe.id, id))
    if (lines) {
      await tx.delete(recipeIngredient).where(eq(recipeIngredient.recipeId, id))
      if (lines.rows.length) await tx.insert(recipeIngredient).values(lines.rows.map((r) => ({ ...r, recipeId: id })))
    }
    if (tags) {
      await tx.delete(recipeTag).where(eq(recipeTag.recipeId, id))
      if (tags.ids.length) await tx.insert(recipeTag).values(tags.ids.map((tagId) => ({ recipeId: id, tagId })))
    }
  })

  let { ingredients: _i, ...changed } = patch
  await audit({
    ...actor,
    action: 'update',
    entity: 'recipe',
    entityId: String(id),
    details: { fields: Object.keys(changed).filter((k) => changed[k as keyof typeof changed] !== undefined), ingredients: Boolean(lines) },
  })
  return {
    recipe: await getRecipe(id, actor.userId),
    createdIngredients: lines?.created ?? [],
    createdTags: tags?.created ?? [],
  }
}

export async function deleteRecipe(actor: ServiceActor, id: number): Promise<void> {
  let current = await getRecipe(id)
  await db.delete(recipe).where(eq(recipe.id, id))
  await removeStoredFiles(current.photos.map((p) => p.storageKey))
  await audit({ ...actor, action: 'delete', entity: 'recipe', entityId: String(id), details: { title: current.title } })
}

/** Marca o desmarca como favorita para el usuario. Regresa el nuevo estado. */
export async function toggleFavorite(actor: ServiceActor & { userId: string }, recipeId: number, value?: boolean): Promise<boolean> {
  let [r] = await db.select({ id: recipe.id }).from(recipe).where(eq(recipe.id, recipeId)).limit(1)
  if (!r) throw new UserFacingError('Esa receta no existe.', 404)
  let [existing] = await db
    .select()
    .from(favorite)
    .where(and(eq(favorite.userId, actor.userId), eq(favorite.recipeId, recipeId)))
    .limit(1)
  let next = value ?? !existing
  if (next && !existing) await db.insert(favorite).values({ userId: actor.userId, recipeId }).onConflictDoNothing()
  if (!next && existing) {
    await db.delete(favorite).where(and(eq(favorite.userId, actor.userId), eq(favorite.recipeId, recipeId)))
  }
  return next
}

/** Recetas recientes (inicio del dashboard). */
export async function recentRecipes(limit = 6, viewerId?: string | null): Promise<RecipeCard[]> {
  return (await listRecipes({ sort: 'recent', pageSize: limit, viewerId })).items
}
