import { asc, count, eq, max } from 'drizzle-orm'
import * as z from 'zod'

import { db } from '../db/client.ts'
import { aisle, ingredient, store, tag, unit } from '../db/schema/index.ts'
import { PG_FOREIGN_KEY_VIOLATION, PG_UNIQUE_VIOLATION, pgErrorCode, UserFacingError } from '../lib/errors.ts'
import { cleanText, slugify } from '../lib/slug.ts'
import { optionalDecimal, sortOrderField } from '../lib/validation.ts'
import { audit, type ServiceActor } from './audit.ts'
import { recipeIdsWithTag, refreshRecipeSearchText } from './recipe-search.ts'

/**
 * Catálogos: pasillos, tiendas, unidades y etiquetas.
 * Lectura para cualquier miembro; los cambios los hace un admin (lo verifica el controlador / MCP).
 */

// ─── Tipos y esquemas ────────────────────────────────────────────────────────

export type Aisle = typeof aisle.$inferSelect
export type Store = typeof store.$inferSelect
export type Unit = typeof unit.$inferSelect
export type Tag = typeof tag.$inferSelect

export type UnitDimension = Unit['dimension']
export type TagKind = Tag['kind']

export const UNIT_DIMENSIONS: { value: UnitDimension; label: string; short: string; base?: string }[] = [
  { value: 'mass', label: 'Peso', short: 'Peso', base: 'g' },
  { value: 'volume', label: 'Volumen', short: 'Volumen', base: 'ml' },
  { value: 'count', label: 'Piezas', short: 'Piezas', base: 'pz' },
  { value: 'other', label: 'Otra (no convierte)', short: 'Otra' },
]

export const TAG_KINDS: { value: TagKind; label: string }[] = [
  { value: 'category', label: 'Categoría' },
  { value: 'diet', label: 'Dieta' },
  { value: 'occasion', label: 'Ocasión' },
  { value: 'free', label: 'Libre' },
]

const nameField = z.string().transform(cleanText).pipe(z.string().min(1, 'Escribe un nombre.').max(60, 'Máximo 60 caracteres.'))

export const namedCatalogInput = z.object({ name: nameField, sortOrder: sortOrderField })
export type NamedCatalogInput = z.output<typeof namedCatalogInput>

export const unitInput = z
  .object({
    name: nameField,
    plural: nameField,
    dimension: z.enum(['mass', 'volume', 'count', 'other'], { message: 'Tipo de unidad inválido.' }),
    toBase: optionalDecimal('Equivalencia'),
    sortOrder: sortOrderField,
  })
  .superRefine((value, ctx) => {
    if (value.dimension !== 'other' && value.toBase == null) {
      ctx.addIssue({ code: 'custom', path: ['toBase'], message: 'Escribe la equivalencia en la unidad base.' })
    }
  })
  .transform((value) => ({ ...value, toBase: value.dimension === 'other' ? null : (value.toBase ?? null) }))
export type UnitInput = z.output<typeof unitInput>

export const unitCodeField = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z][a-z0-9_]{0,15}$/, 'Código: letras minúsculas, números o _ (máx. 16), sin espacios.')

export const newUnitInput = z.intersection(z.object({ code: unitCodeField }), unitInput)

export const tagInput = z.object({
  name: nameField,
  kind: z.enum(['category', 'diet', 'occasion', 'free'], { message: 'Tipo de etiqueta inválido.' }),
})
export type TagInput = z.output<typeof tagInput>

function uniqueError(error: unknown, message: string): never {
  if (pgErrorCode(error) === PG_UNIQUE_VIOLATION) throw new UserFacingError(message, 409)
  throw error
}

/** Siguiente orden (de 10 en 10) para que lo nuevo quede al final. */
async function nextSortOrder(column: typeof aisle.sortOrder | typeof unit.sortOrder, table: typeof aisle | typeof unit) {
  let [row] = await db.select({ top: max(column) }).from(table as typeof aisle)
  return (row?.top ?? 0) + 10
}

// ─── Pasillos y tiendas (misma forma) ────────────────────────────────────────

function namedCatalog<T extends typeof aisle | typeof store>(
  table: T,
  entity: 'aisle' | 'store',
  labels: { duplicate: string; missing: string },
) {
  type Row = { id: number; name: string; sortOrder: number }

  async function get(id: number): Promise<Row> {
    let [row] = await db.select().from(table as typeof aisle).where(eq((table as typeof aisle).id, id)).limit(1)
    if (!row) throw new UserFacingError(labels.missing, 404)
    return row
  }

  return {
    async list(): Promise<Row[]> {
      let t = table as typeof aisle
      return db.select().from(t).orderBy(asc(t.sortOrder), asc(t.name))
    },

    get,

    async create(actor: ServiceActor, input: NamedCatalogInput): Promise<Row> {
      let t = table as typeof aisle
      let sortOrder = input.sortOrder ?? (await nextSortOrder(t.sortOrder, t))
      let [row] = await db
        .insert(t)
        .values({ ...input, sortOrder })
        .returning()
        .catch((e) => uniqueError(e, labels.duplicate))
      await audit({ ...actor, action: 'create', entity, entityId: String(row!.id), details: { name: input.name } })
      return row!
    },

    async update(actor: ServiceActor, id: number, input: NamedCatalogInput): Promise<Row> {
      let t = table as typeof aisle
      await get(id)
      let [row] = await db
        .update(t)
        .set(input)
        .where(eq(t.id, id))
        .returning()
        .catch((e) => uniqueError(e, labels.duplicate))
      await audit({ ...actor, action: 'update', entity, entityId: String(id), details: { ...input } })
      return row!
    },

    /** Los ingredientes que lo usaban quedan sin asignar (ON DELETE SET NULL). */
    async remove(actor: ServiceActor, id: number): Promise<void> {
      let t = table as typeof aisle
      let row = await get(id)
      await db.delete(t).where(eq(t.id, id))
      await audit({ ...actor, action: 'delete', entity, entityId: String(id), details: { name: row.name } })
    },
  }
}

export const aisles = namedCatalog(aisle, 'aisle', {
  duplicate: 'Ya existe un pasillo con ese nombre.',
  missing: 'Ese pasillo no existe.',
})

export const stores = namedCatalog(store, 'store', {
  duplicate: 'Ya existe una tienda con ese nombre.',
  missing: 'Esa tienda no existe.',
})

// ─── Unidades ────────────────────────────────────────────────────────────────

export async function listUnits(): Promise<Unit[]> {
  return db.select().from(unit).orderBy(asc(unit.sortOrder), asc(unit.code))
}

export async function getUnit(code: string): Promise<Unit> {
  let [row] = await db.select().from(unit).where(eq(unit.code, code)).limit(1)
  if (!row) throw new UserFacingError('Esa unidad no existe.', 404)
  return row
}

export async function createUnit(actor: ServiceActor, input: z.output<typeof newUnitInput>): Promise<Unit> {
  let sortOrder = input.sortOrder ?? (await nextSortOrder(unit.sortOrder, unit))
  let [row] = await db
    .insert(unit)
    .values({ ...input, sortOrder })
    .returning()
    .catch((e) => uniqueError(e, `Ya existe la unidad "${input.code}".`))
  await audit({ ...actor, action: 'create', entity: 'unit', entityId: input.code, details: { ...input } })
  return row!
}

export async function updateUnit(actor: ServiceActor, code: string, input: UnitInput): Promise<Unit> {
  await getUnit(code)
  let [row] = await db.update(unit).set(input).where(eq(unit.code, code)).returning()
  await audit({ ...actor, action: 'update', entity: 'unit', entityId: code, details: { ...input } })
  return row!
}

export async function removeUnit(actor: ServiceActor, code: string): Promise<void> {
  await getUnit(code)
  let [usage] = await db.select({ n: count() }).from(ingredient).where(eq(ingredient.defaultUnit, code))
  if (usage && usage.n > 0) {
    throw new UserFacingError(`No se puede eliminar: ${usage.n} ingrediente(s) la usan como unidad por defecto.`, 409)
  }
  try {
    await db.delete(unit).where(eq(unit.code, code))
  } catch (error) {
    if (pgErrorCode(error) === PG_FOREIGN_KEY_VIOLATION) {
      throw new UserFacingError('No se puede eliminar: la unidad está en uso.', 409)
    }
    throw error
  }
  await audit({ ...actor, action: 'delete', entity: 'unit', entityId: code })
}

// ─── Etiquetas ───────────────────────────────────────────────────────────────

const KIND_ORDER: Record<TagKind, number> = { category: 0, diet: 1, occasion: 2, free: 3 }

export async function listTags(): Promise<Tag[]> {
  let rows = await db.select().from(tag).orderBy(asc(tag.name))
  return rows.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.name.localeCompare(b.name, 'es'))
}

export async function getTag(id: number): Promise<Tag> {
  let [row] = await db.select().from(tag).where(eq(tag.id, id)).limit(1)
  if (!row) throw new UserFacingError('Esa etiqueta no existe.', 404)
  return row
}

const TAG_DUPLICATE = 'Ya existe una etiqueta con ese nombre.'

export async function createTag(actor: ServiceActor, input: TagInput): Promise<Tag> {
  let [row] = await db
    .insert(tag)
    .values({ ...input, slug: slugify(input.name) })
    .returning()
    .catch((e) => uniqueError(e, TAG_DUPLICATE))
  await audit({ ...actor, action: 'create', entity: 'tag', entityId: String(row!.id), details: { ...input } })
  return row!
}

export async function updateTag(actor: ServiceActor, id: number, input: TagInput): Promise<Tag> {
  await getTag(id)
  let [row] = await db
    .update(tag)
    .set({ ...input, slug: slugify(input.name) })
    .where(eq(tag.id, id))
    .returning()
    .catch((e) => uniqueError(e, TAG_DUPLICATE))
  await refreshRecipeSearchText(await recipeIdsWithTag(id))
  await audit({ ...actor, action: 'update', entity: 'tag', entityId: String(id), details: { ...input } })
  return row!
}

export async function removeTag(actor: ServiceActor, id: number): Promise<void> {
  let row = await getTag(id)
  let affected = await recipeIdsWithTag(id)
  await db.delete(tag).where(eq(tag.id, id))
  await refreshRecipeSearchText(affected)
  await audit({ ...actor, action: 'delete', entity: 'tag', entityId: String(id), details: { name: row.name } })
}
