import { and, arrayOverlaps, asc, count, eq, ne, sql, type SQL } from 'drizzle-orm'
import * as z from 'zod'

import { db } from '../db/client.ts'
import { aisle, ingredient, recipeIngredient, shoppingListItem, store, unit } from '../db/schema/index.ts'
import { PG_FOREIGN_KEY_VIOLATION, PG_UNIQUE_VIOLATION, pgErrorCode, UserFacingError } from '../lib/errors.ts'
import { cleanText, normalizeKey, slugify } from '../lib/slug.ts'
import { optionalDecimal, optionalId, optionalText, textList } from '../lib/validation.ts'
import { audit, type ServiceActor } from './audit.ts'
import { recipeIdsUsingIngredient, refreshRecipeSearchText } from './recipe-search.ts'

/**
 * Ingredientes: catálogo compartido de la familia.
 *
 * - `name_key` (nombre normalizado, sin acentos) es único: "Limón" y "limon" son el mismo.
 * - `keys` = nombre + alias normalizados. Ninguna clave puede repetirse entre ingredientes,
 *   así empatar "tomate" → "Jitomate" nunca es ambiguo.
 * - Búsqueda difusa con pg_trgm sobre `search_text` (tolera faltas de ortografía).
 */

// ─── Esquemas ────────────────────────────────────────────────────────────────

const nameField = z
  .string()
  .transform(cleanText)
  .pipe(z.string().min(1, 'Escribe un nombre.').max(80, 'Máximo 80 caracteres.'))

export const ingredientInput = z.object({
  name: nameField,
  aliases: textList,
  aisleId: optionalId,
  defaultStoreId: optionalId,
  defaultUnit: optionalText(16),
  densityGPerMl: optionalDecimal('Densidad', { max: 30 }),
  gramsPerPiece: optionalDecimal('Gramos por pieza', { max: 100_000 }),
  notes: optionalText(500),
})
export type IngredientInput = z.output<typeof ingredientInput>

/** Para updates parciales (MCP): todo opcional; `undefined` conserva el valor actual. */
export const ingredientPatch = ingredientInput.partial()
export type IngredientPatch = z.output<typeof ingredientPatch>

// ─── Tipos ───────────────────────────────────────────────────────────────────

export type IngredientRow = typeof ingredient.$inferSelect

export interface Ingredient {
  id: number
  name: string
  slug: string
  aliases: string[]
  aisleId: number | null
  aisleName: string | null
  defaultStoreId: number | null
  storeName: string | null
  defaultUnit: string | null
  unitName: string | null
  densityGPerMl: number | null
  gramsPerPiece: number | null
  notes: string | null
  createdAt: Date
  updatedAt: Date
}

export interface IngredientMatch extends Ingredient {
  /** Alias que empató, si no fue el nombre. */
  matchedAlias: string | null
  score: number
}

const selection = {
  id: ingredient.id,
  name: ingredient.name,
  slug: ingredient.slug,
  aliases: ingredient.aliases,
  aisleId: ingredient.aisleId,
  aisleName: aisle.name,
  defaultStoreId: ingredient.defaultStoreId,
  storeName: store.name,
  defaultUnit: ingredient.defaultUnit,
  unitName: unit.name,
  densityGPerMl: ingredient.densityGPerMl,
  gramsPerPiece: ingredient.gramsPerPiece,
  notes: ingredient.notes,
  createdAt: ingredient.createdAt,
  updatedAt: ingredient.updatedAt,
}

function baseQuery() {
  return db
    .select(selection)
    .from(ingredient)
    .leftJoin(aisle, eq(aisle.id, ingredient.aisleId))
    .leftJoin(store, eq(store.id, ingredient.defaultStoreId))
    .leftJoin(unit, eq(unit.code, ingredient.defaultUnit))
}

// ─── Búsqueda ────────────────────────────────────────────────────────────────

/** Umbral de `word_similarity` para considerar un empate difuso (0–1). */
const FUZZY_THRESHOLD = 0.4

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`)
}

function searchClauses(query: string): { where: SQL; score: SQL } | null {
  let q = normalizeKey(query)
  if (!q) return null
  let contains = `%${escapeLike(q)}%`
  let prefix = `${escapeLike(q)}%`
  let where = sql`(${ingredient.searchText} like ${contains} or word_similarity(${q}, ${ingredient.searchText}) >= ${FUZZY_THRESHOLD})`
  let score = sql<number>`(
    case
      when ${ingredient.nameKey} = ${q} then 4
      when ${q} = any(${ingredient.keys}) then 3
      when ${ingredient.nameKey} like ${prefix} then 2
      when ${ingredient.searchText} like ${contains} then 1
      else 0
    end + word_similarity(${q}, ${ingredient.searchText}))::float8`
  return { where, score }
}

function matchedAlias(row: { name: string; aliases: string[] }, query: string): string | null {
  let q = normalizeKey(query)
  if (!q || normalizeKey(row.name) === q) return null
  let exact = row.aliases.find((a) => normalizeKey(a) === q)
  if (exact) return exact
  if (normalizeKey(row.name).includes(q)) return null
  return row.aliases.find((a) => normalizeKey(a).includes(q)) ?? null
}

export interface ListOptions {
  q?: string
  aisleId?: number | null
  /** `0` = sin pasillo asignado. */
  page?: number
  pageSize?: number
}

/** Listado paginado para el dashboard (búsqueda opcional + filtro por pasillo). */
export async function listIngredients(options: ListOptions = {}) {
  let pageSize = Math.min(Math.max(options.pageSize ?? 50, 1), 200)
  let page = Math.max(options.page ?? 1, 1)
  let search = options.q ? searchClauses(options.q) : null

  let filters: SQL[] = []
  if (search) filters.push(search.where)
  if (options.aisleId === 0) filters.push(sql`${ingredient.aisleId} is null`)
  else if (options.aisleId) filters.push(eq(ingredient.aisleId, options.aisleId))
  let where = filters.length ? and(...filters) : undefined

  let [totalRow] = await db.select({ n: count() }).from(ingredient).where(where)
  let rows = await baseQuery()
    .where(where)
    .orderBy(...(search ? [sql`${search.score} desc`] : []), asc(ingredient.nameKey))
    .limit(pageSize)
    .offset((page - 1) * pageSize)

  let total = totalRow?.n ?? 0
  return { items: rows, total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)) }
}

/** Búsqueda difusa por nombre o alias (autocompletado, MCP, empatar recetas importadas). */
export async function searchIngredients(query: string, limit = 10): Promise<IngredientMatch[]> {
  let search = searchClauses(query)
  if (!search) return []
  let rows = await db
    .select({ ...selection, score: search.score })
    .from(ingredient)
    .leftJoin(aisle, eq(aisle.id, ingredient.aisleId))
    .leftJoin(store, eq(store.id, ingredient.defaultStoreId))
    .leftJoin(unit, eq(unit.code, ingredient.defaultUnit))
    .where(search.where)
    .orderBy(sql`${search.score} desc`, asc(ingredient.nameKey))
    .limit(Math.min(Math.max(limit, 1), 50))
  return rows.map((row) => ({ ...row, score: Number(row.score), matchedAlias: matchedAlias(row, query) }))
}

/** Empate exacto por nombre o alias (sin acentos / mayúsculas). */
export async function findIngredientByName(name: string): Promise<Ingredient | null> {
  let key = normalizeKey(name)
  if (!key) return null
  let [row] = await baseQuery().where(sql`${key} = any(${ingredient.keys})`).limit(1)
  return row ?? null
}

// ─── Lectura ─────────────────────────────────────────────────────────────────

export async function getIngredient(id: number): Promise<Ingredient> {
  let [row] = await baseQuery().where(eq(ingredient.id, id)).limit(1)
  if (!row) throw new UserFacingError('Ese ingrediente no existe.', 404)
  return row
}

export async function getIngredientBySlug(slug: string): Promise<Ingredient> {
  let [row] = await baseQuery().where(eq(ingredient.slug, slug)).limit(1)
  if (!row) throw new UserFacingError('Ese ingrediente no existe.', 404)
  return row
}

/** Opciones ligeras para selects (fusionar, editor de recetas). */
export async function ingredientOptions(): Promise<{ id: number; name: string }[]> {
  return db.select({ id: ingredient.id, name: ingredient.name }).from(ingredient).orderBy(asc(ingredient.nameKey))
}

// ─── Escritura ───────────────────────────────────────────────────────────────

interface Normalized {
  name: string
  nameKey: string
  aliases: string[]
  keys: string[]
  searchText: string
}

/** Limpia alias (sin duplicados ni repetir el nombre) y calcula las claves de búsqueda. */
function normalizeNames(name: string, aliases: string[]): Normalized {
  let nameKey = normalizeKey(name)
  let seen = new Set([nameKey])
  let cleanAliases: string[] = []
  for (let alias of aliases) {
    let key = normalizeKey(alias)
    if (!key || seen.has(key)) continue
    seen.add(key)
    cleanAliases.push(cleanText(alias))
  }
  let keys = [...seen]
  return { name, nameKey, aliases: cleanAliases, keys, searchText: keys.join(' | ') }
}

async function assertNoKeyConflicts(names: Normalized, excludeId?: number): Promise<void> {
  let conflicts = await db
    .select({ id: ingredient.id, name: ingredient.name, nameKey: ingredient.nameKey, keys: ingredient.keys })
    .from(ingredient)
    .where(and(arrayOverlaps(ingredient.keys, names.keys), excludeId ? ne(ingredient.id, excludeId) : undefined))
    .limit(1)
  let other = conflicts[0]
  if (!other) return

  let key = names.keys.find((k) => other.keys.includes(k))!
  let label = key === names.nameKey ? names.name : (names.aliases.find((a) => normalizeKey(a) === key) ?? key)
  if (key === other.nameKey) {
    throw new UserFacingError(`Ya existe el ingrediente "${other.name}".`, 409)
  }
  throw new UserFacingError(`"${label}" ya es alias de "${other.name}".`, 409)
}

async function uniqueSlug(name: string, excludeId?: number): Promise<string> {
  let base = slugify(name)
  for (let i = 1; i < 100; i++) {
    let candidate = i === 1 ? base : `${base}-${i}`
    let [taken] = await db
      .select({ id: ingredient.id })
      .from(ingredient)
      .where(and(eq(ingredient.slug, candidate), excludeId ? ne(ingredient.id, excludeId) : undefined))
      .limit(1)
    if (!taken) return candidate
  }
  return `${base}-${Date.now()}`
}

function writeError(error: unknown): never {
  let code = pgErrorCode(error)
  if (code === PG_FOREIGN_KEY_VIOLATION) throw new UserFacingError('El pasillo, la tienda o la unidad no existen.')
  if (code === PG_UNIQUE_VIOLATION) throw new UserFacingError('Ya existe un ingrediente con ese nombre.', 409)
  throw error
}

export async function createIngredient(actor: ServiceActor, input: IngredientInput): Promise<Ingredient> {
  let names = normalizeNames(input.name, input.aliases ?? [])
  await assertNoKeyConflicts(names)

  let [row] = await db
    .insert(ingredient)
    .values({
      ...names,
      slug: await uniqueSlug(names.name),
      aisleId: input.aisleId ?? null,
      defaultStoreId: input.defaultStoreId ?? null,
      defaultUnit: input.defaultUnit ?? null,
      densityGPerMl: input.densityGPerMl ?? null,
      gramsPerPiece: input.gramsPerPiece ?? null,
      notes: input.notes ?? null,
      createdBy: actor.userId,
    })
    .returning({ id: ingredient.id })
    .catch(writeError)

  await audit({ ...actor, action: 'create', entity: 'ingredient', entityId: String(row!.id), details: { name: names.name } })
  return getIngredient(row!.id)
}

export async function updateIngredient(actor: ServiceActor, id: number, patch: IngredientPatch): Promise<Ingredient> {
  let current = await getIngredient(id)
  let names = normalizeNames(patch.name ?? current.name, patch.aliases ?? current.aliases)
  await assertNoKeyConflicts(names, id)

  let renamed = names.nameKey !== normalizeKey(current.name)
  await db
    .update(ingredient)
    .set({
      ...names,
      ...(renamed ? { slug: await uniqueSlug(names.name, id) } : {}),
      aisleId: patch.aisleId,
      defaultStoreId: patch.defaultStoreId,
      defaultUnit: patch.defaultUnit,
      densityGPerMl: patch.densityGPerMl,
      gramsPerPiece: patch.gramsPerPiece,
      notes: patch.notes,
      updatedAt: new Date(),
    })
    .where(eq(ingredient.id, id))
    .catch(writeError)

  if (renamed || patch.aliases) await refreshRecipeSearchText(await recipeIdsUsingIngredient(id))
  await audit({ ...actor, action: 'update', entity: 'ingredient', entityId: String(id), details: { ...patch } })
  return getIngredient(id)
}

export async function removeIngredient(actor: ServiceActor, id: number): Promise<void> {
  let current = await getIngredient(id)
  let usedBy = await recipeIdsUsingIngredient(id)
  if (usedBy.length) {
    throw new UserFacingError(
      `"${current.name}" se usa en ${usedBy.length} receta(s). Fusiónalo con otro ingrediente en vez de eliminarlo.`,
      409,
    )
  }
  try {
    await db.delete(ingredient).where(eq(ingredient.id, id))
  } catch (error) {
    if (pgErrorCode(error) === PG_FOREIGN_KEY_VIOLATION) {
      throw new UserFacingError(`"${current.name}" se usa en recetas. Fusiónalo con otro ingrediente en vez de eliminarlo.`, 409)
    }
    throw error
  }
  await audit({ ...actor, action: 'delete', entity: 'ingredient', entityId: String(id), details: { name: current.name } })
}

/**
 * Fusiona `sourceId` dentro de `targetId` (deduplicar): el nombre y los alias del origen pasan a ser
 * alias del destino, los datos vacíos del destino se completan con los del origen y el origen se borra.
 */
export async function mergeIngredients(actor: ServiceActor, sourceId: number, targetId: number): Promise<Ingredient> {
  if (sourceId === targetId) throw new UserFacingError('Elige un ingrediente distinto para fusionar.')
  let source = await getIngredient(sourceId)
  let target = await getIngredient(targetId)

  let names = normalizeNames(target.name, [...target.aliases, source.name, ...source.aliases])

  let affectedRecipes = await recipeIdsUsingIngredient(sourceId)
  await db.transaction(async (tx) => {
    // Las recetas y listas que usaban el duplicado ahora apuntan al destino.
    await tx.update(recipeIngredient).set({ ingredientId: targetId }).where(eq(recipeIngredient.ingredientId, sourceId))
    await tx.update(shoppingListItem).set({ ingredientId: targetId }).where(eq(shoppingListItem.ingredientId, sourceId))
    await tx.delete(ingredient).where(eq(ingredient.id, sourceId))
    await tx
      .update(ingredient)
      .set({
        ...names,
        aisleId: target.aisleId ?? source.aisleId,
        defaultStoreId: target.defaultStoreId ?? source.defaultStoreId,
        defaultUnit: target.defaultUnit ?? source.defaultUnit,
        densityGPerMl: target.densityGPerMl ?? source.densityGPerMl,
        gramsPerPiece: target.gramsPerPiece ?? source.gramsPerPiece,
        notes: [target.notes, source.notes].filter(Boolean).join('\n') || null,
        updatedAt: new Date(),
      })
      .where(eq(ingredient.id, targetId))
  })

  await refreshRecipeSearchText(affectedRecipes)
  await audit({
    ...actor,
    action: 'merge',
    entity: 'ingredient',
    entityId: String(targetId),
    details: { from: { id: sourceId, name: source.name }, into: target.name },
  })
  return getIngredient(targetId)
}
