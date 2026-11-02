import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import * as z from 'zod'

import { db } from '../db/client.ts'
import {
  aisle,
  ingredient,
  menu,
  menuItem,
  recipe,
  recipeIngredient,
  shoppingList,
  shoppingListItem,
  store,
  unit,
  type SourceRecipe,
} from '../db/schema/index.ts'
import { UserFacingError } from '../lib/errors.ts'
import { formatQuantity, parseQuantity, QuantityError } from '../lib/quantity.ts'
import { cleanText, normalizeKey } from '../lib/slug.ts'
import { blankToNull, optionalText } from '../lib/validation.ts'
import { audit, type ServiceActor } from './audit.ts'
import { findIngredientByName } from './ingredients.ts'
import { getMenu } from './menus.ts'
import { computeShoppingLines, type EngineEntry, type EngineIngredient } from './shopping-engine.ts'
import { unitTable, type UnitDef } from './units.ts'

/**
 * Listas del súper. Una lista puede venir de un menú (renglones "generated") y además
 * tener renglones a mano ("manual"). Regenerar respeta los manuales y lo ya palomeado.
 */

// ─── Tipos ───────────────────────────────────────────────────────────────────

export interface ListItemView {
  id: number
  ingredientId: number | null
  label: string
  quantity: number | null
  unitCode: string | null
  unitName: string | null
  unitPlural: string | null
  aisleId: number | null
  aisleName: string | null
  aisleOrder: number | null
  storeId: number | null
  storeName: string | null
  storeOrder: number | null
  checked: boolean
  source: 'generated' | 'manual'
  sourceRecipes: SourceRecipe[]
  notes: string | null
}

export interface ListSummary {
  id: number
  name: string
  status: 'abierta' | 'completada'
  menuId: number | null
  menuName: string | null
  total: number
  checked: number
  generatedAt: Date | null
  updatedAt: Date
}

export interface ListDetail extends Omit<ListSummary, 'total' | 'checked'> {
  includeOptional: boolean
  items: ListItemView[]
}

export interface ListSection {
  storeName: string | null
  aisles: { aisleName: string | null; items: ListItemView[] }[]
}

// ─── Esquemas ────────────────────────────────────────────────────────────────

const quantityField = z.unknown().transform((value, ctx) => {
  try {
    return parseQuantity(blankToNull(value))
  } catch (error) {
    ctx.addIssue({ code: 'custom', message: error instanceof QuantityError ? error.message : 'Cantidad no válida.' })
    return z.NEVER
  }
})

export const manualItemInput = z.object({
  label: z.string().transform(cleanText).pipe(z.string().min(1, 'Escribe qué hay que comprar.').max(120, 'Máximo 120 caracteres.')),
  quantity: quantityField.optional(),
  /** Código, nombre o plural de unidad. */
  unit: optionalText(30),
  notes: optionalText(300),
})
export type ManualItemInput = z.output<typeof manualItemInput>

// ─── Lectura ─────────────────────────────────────────────────────────────────

const compareNullable = (a: number | null, b: number | null) => (a === b ? 0 : a === null ? 1 : b === null ? -1 : a - b)

export async function getList(id: number): Promise<ListDetail> {
  let [row] = await db
    .select({ list: shoppingList, menuName: menu.name })
    .from(shoppingList)
    .leftJoin(menu, eq(menu.id, shoppingList.menuId))
    .where(eq(shoppingList.id, id))
    .limit(1)
  if (!row) throw new UserFacingError('Esa lista no existe.', 404)

  let items = await db
    .select({
      id: shoppingListItem.id,
      ingredientId: shoppingListItem.ingredientId,
      label: shoppingListItem.label,
      quantity: shoppingListItem.quantity,
      unitCode: shoppingListItem.unitCode,
      unitName: unit.name,
      unitPlural: unit.plural,
      aisleId: shoppingListItem.aisleId,
      aisleName: aisle.name,
      aisleOrder: aisle.sortOrder,
      storeId: shoppingListItem.storeId,
      storeName: store.name,
      storeOrder: store.sortOrder,
      checked: shoppingListItem.checked,
      source: shoppingListItem.source,
      sourceRecipes: shoppingListItem.sourceRecipes,
      notes: shoppingListItem.notes,
    })
    .from(shoppingListItem)
    .leftJoin(unit, eq(unit.code, shoppingListItem.unitCode))
    .leftJoin(aisle, eq(aisle.id, shoppingListItem.aisleId))
    .leftJoin(store, eq(store.id, shoppingListItem.storeId))
    .where(eq(shoppingListItem.listId, id))
    .orderBy(asc(shoppingListItem.id))

  items.sort(
    (a, b) =>
      compareNullable(a.storeOrder, b.storeOrder) ||
      compareNullable(a.aisleOrder, b.aisleOrder) ||
      a.label.localeCompare(b.label, 'es') ||
      a.id - b.id,
  )

  let l = row.list
  return {
    id: l.id,
    name: l.name,
    status: l.status,
    menuId: l.menuId,
    menuName: row.menuName,
    includeOptional: l.includeOptional,
    generatedAt: l.generatedAt,
    updatedAt: l.updatedAt,
    items,
  }
}

/** Agrupa por tienda y pasillo (en el orden de los catálogos). */
export function sectionsOf(items: ListItemView[]): ListSection[] {
  let sections: ListSection[] = []
  for (let item of items) {
    let section = sections.find((s) => s.storeName === item.storeName)
    if (!section) sections.push((section = { storeName: item.storeName, aisles: [] }))
    let group = section.aisles.find((a) => a.aisleName === item.aisleName)
    if (!group) section.aisles.push((group = { aisleName: item.aisleName, items: [] }))
    group.items.push(item)
  }
  return sections
}

export async function listLists(limit = 50): Promise<ListSummary[]> {
  let rows = await db
    .select({
      id: shoppingList.id,
      name: shoppingList.name,
      status: shoppingList.status,
      menuId: shoppingList.menuId,
      menuName: menu.name,
      generatedAt: shoppingList.generatedAt,
      updatedAt: shoppingList.updatedAt,
      total: sql<number>`(select count(*)::int from ${shoppingListItem} where ${shoppingListItem.listId} = ${shoppingList.id})`,
      checked: sql<number>`(select count(*)::int from ${shoppingListItem} where ${shoppingListItem.listId} = ${shoppingList.id} and ${shoppingListItem.checked})`,
    })
    .from(shoppingList)
    .leftJoin(menu, eq(menu.id, shoppingList.menuId))
    .orderBy(asc(sql`${shoppingList.status} = 'completada'`), desc(shoppingList.updatedAt))
    .limit(limit)
  return rows.map((r) => ({ ...r, total: Number(r.total), checked: Number(r.checked) }))
}

// ─── Generación ──────────────────────────────────────────────────────────────

async function loadUnits(): Promise<UnitDef[]> {
  return db.select({ code: unit.code, name: unit.name, plural: unit.plural, dimension: unit.dimension, toBase: unit.toBase }).from(unit)
}

/** Calcula los renglones de un menú sin guardar nada (sirve para previsualizar y para el MCP). */
export async function computeMenuLines(menuId: number, options: { includeOptional?: boolean } = {}) {
  await getMenu(menuId)
  let items = await db
    .select({ id: menuItem.id, servings: menuItem.servings, recipeId: recipe.id, title: recipe.title, recipeServings: recipe.servings })
    .from(menuItem)
    .innerJoin(recipe, eq(recipe.id, menuItem.recipeId))
    .where(eq(menuItem.menuId, menuId))
    // Cronológico: así "Para: …" se lee en el orden de la semana.
    .orderBy(asc(menuItem.date), asc(menuItem.meal), asc(menuItem.position), asc(menuItem.id))

  let recipeIds = [...new Set(items.map((i) => i.recipeId))]
  let lines = recipeIds.length
    ? await db
        .select({
          recipeId: recipeIngredient.recipeId,
          ingredientId: recipeIngredient.ingredientId,
          quantity: recipeIngredient.quantity,
          unitCode: recipeIngredient.unitCode,
          optional: recipeIngredient.optional,
        })
        .from(recipeIngredient)
        .where(inArray(recipeIngredient.recipeId, recipeIds))
    : []

  let ingredientIds = [...new Set(lines.map((l) => l.ingredientId))]
  let ingredientRows = ingredientIds.length
    ? await db
        .select({
          id: ingredient.id,
          name: ingredient.name,
          aisleId: ingredient.aisleId,
          aisleName: aisle.name,
          aisleOrder: aisle.sortOrder,
          storeId: ingredient.defaultStoreId,
          storeName: store.name,
          storeOrder: store.sortOrder,
          defaultUnit: ingredient.defaultUnit,
          densityGPerMl: ingredient.densityGPerMl,
          gramsPerPiece: ingredient.gramsPerPiece,
        })
        .from(ingredient)
        .leftJoin(aisle, eq(aisle.id, ingredient.aisleId))
        .leftJoin(store, eq(store.id, ingredient.defaultStoreId))
        .where(inArray(ingredient.id, ingredientIds))
    : []

  let entries: EngineEntry[] = items.map((item) => ({
    recipeTitle: item.title,
    recipeServings: item.recipeServings,
    servings: item.servings,
    lines: lines.filter((l) => l.recipeId === item.recipeId),
  }))
  let ingredients = new Map<number, EngineIngredient>(ingredientRows.map((i) => [i.id, i]))
  return computeShoppingLines(entries, ingredients, unitTable(await loadUnits()), options)
}

/**
 * Genera (o regenera) la lista de un menú. Reutiliza la lista abierta más reciente del menú.
 * Conserva renglones manuales y el palomeo de los generados que siguen existiendo.
 */
export async function generateListForMenu(
  actor: ServiceActor,
  menuId: number,
  options: { includeOptional?: boolean; listId?: number } = {},
): Promise<ListDetail> {
  let source = await getMenu(menuId)

  let listId = options.listId
  if (!listId) {
    let [existing] = await db
      .select({ id: shoppingList.id })
      .from(shoppingList)
      .where(and(eq(shoppingList.menuId, menuId), eq(shoppingList.status, 'abierta')))
      .orderBy(desc(shoppingList.createdAt))
      .limit(1)
    listId = existing?.id
  }
  let includeOptional = options.includeOptional
  if (listId && includeOptional === undefined) {
    let [l] = await db.select({ includeOptional: shoppingList.includeOptional }).from(shoppingList).where(eq(shoppingList.id, listId))
    includeOptional = l?.includeOptional
  }
  let lines = await computeMenuLines(menuId, { includeOptional })

  let id = await db.transaction(async (tx) => {
    let currentId = listId
    if (!currentId) {
      let [created] = await tx
        .insert(shoppingList)
        .values({ menuId, name: `Súper: ${source.name}`, includeOptional: includeOptional ?? false, createdBy: actor.userId })
        .returning({ id: shoppingList.id })
      currentId = created!.id
    }
    let previous = await tx
      .select({ mergeKey: shoppingListItem.mergeKey, checked: shoppingListItem.checked })
      .from(shoppingListItem)
      .where(and(eq(shoppingListItem.listId, currentId), eq(shoppingListItem.source, 'generated')))
    let checkedKeys = new Set(previous.filter((p) => p.checked && p.mergeKey).map((p) => p.mergeKey!))

    await tx.delete(shoppingListItem).where(and(eq(shoppingListItem.listId, currentId), eq(shoppingListItem.source, 'generated')))
    if (lines.length) {
      await tx.insert(shoppingListItem).values(
        lines.map((line) => ({
          listId: currentId!,
          ingredientId: line.ingredientId,
          label: line.label,
          quantity: line.quantity,
          unitCode: line.unitCode,
          aisleId: line.aisleId,
          storeId: line.storeId,
          checked: checkedKeys.has(line.mergeKey),
          source: 'generated' as const,
          mergeKey: line.mergeKey,
          sourceRecipes: line.sourceRecipes,
        })),
      )
    }
    await tx
      .update(shoppingList)
      .set({ generatedAt: new Date(), updatedAt: new Date(), status: 'abierta', includeOptional: includeOptional ?? false })
      .where(eq(shoppingList.id, currentId))
    return currentId
  })

  await audit({
    ...actor,
    action: options.listId || listId ? 'regenerate' : 'generate',
    entity: 'shopping_list',
    entityId: String(id),
    details: { menuId, lines: lines.length },
  })
  return getList(id)
}

/** Regenera una lista ya existente desde su menú. */
export async function regenerateList(actor: ServiceActor, listId: number, options: { includeOptional?: boolean } = {}) {
  let current = await getList(listId)
  if (!current.menuId) throw new UserFacingError('Esta lista no viene de un menú; no hay nada que regenerar.')
  return generateListForMenu(actor, current.menuId, { ...options, listId })
}

// ─── Edición ─────────────────────────────────────────────────────────────────

export async function createList(actor: ServiceActor, name: string): Promise<ListDetail> {
  let clean = cleanText(name)
  if (!clean) throw new UserFacingError('Escribe un nombre para la lista.')
  let [row] = await db.insert(shoppingList).values({ name: clean.slice(0, 80), createdBy: actor.userId }).returning({ id: shoppingList.id })
  await audit({ ...actor, action: 'create', entity: 'shopping_list', entityId: String(row!.id), details: { name: clean } })
  return getList(row!.id)
}

export async function updateList(
  actor: ServiceActor,
  listId: number,
  patch: { name?: string; status?: 'abierta' | 'completada' },
): Promise<ListDetail> {
  await getList(listId)
  let name = patch.name === undefined ? undefined : cleanText(patch.name).slice(0, 80)
  if (name === '') throw new UserFacingError('Escribe un nombre para la lista.')
  await db.update(shoppingList).set({ name, status: patch.status, updatedAt: new Date() }).where(eq(shoppingList.id, listId))
  await audit({ ...actor, action: 'update', entity: 'shopping_list', entityId: String(listId), details: { ...patch } })
  return getList(listId)
}

export async function deleteList(actor: ServiceActor, listId: number): Promise<void> {
  let current = await getList(listId)
  await db.delete(shoppingList).where(eq(shoppingList.id, listId))
  await audit({ ...actor, action: 'delete', entity: 'shopping_list', entityId: String(listId), details: { name: current.name } })
}

async function resolveUnitCode(value: string | null | undefined): Promise<string | null> {
  if (!value) return null
  let key = normalizeKey(value).replace(/\.$/, '')
  let units = await loadUnits()
  let found = units.find((u) => [u.code, u.name, u.plural].some((k) => normalizeKey(k) === key))
  if (!found) throw new UserFacingError(`No conozco la unidad "${value}".`)
  return found.code
}

/** Agrega un renglón a mano. Si el texto empata con un ingrediente, toma su pasillo y tienda. */
export async function addManualItem(actor: ServiceActor, listId: number, input: ManualItemInput): Promise<ListItemView> {
  await getList(listId)
  let unitCode = await resolveUnitCode(input.unit)
  let match = await findIngredientByName(input.label)
  let [row] = await db
    .insert(shoppingListItem)
    .values({
      listId,
      ingredientId: match?.id ?? null,
      label: match?.name ?? input.label,
      quantity: input.quantity ?? null,
      unitCode,
      aisleId: match?.aisleId ?? null,
      storeId: match?.defaultStoreId ?? null,
      source: 'manual',
      notes: input.notes ?? null,
    })
    .returning({ id: shoppingListItem.id })
  await db.update(shoppingList).set({ updatedAt: new Date() }).where(eq(shoppingList.id, listId))
  await audit({ ...actor, action: 'add_item', entity: 'shopping_list', entityId: String(listId), details: { label: input.label } })
  return (await getList(listId)).items.find((i) => i.id === row!.id)!
}

/** Palomea / despalomea renglones. Regresa cuántos cambiaron. */
export async function setItemsChecked(actor: ServiceActor, listId: number, itemIds: number[], checked: boolean): Promise<number> {
  await getList(listId)
  if (!itemIds.length) return 0
  let updated = await db
    .update(shoppingListItem)
    .set({ checked })
    .where(and(eq(shoppingListItem.listId, listId), inArray(shoppingListItem.id, itemIds)))
    .returning({ id: shoppingListItem.id })
  if (!updated.length) throw new UserFacingError('Esos artículos no están en la lista.', 404)
  await db.update(shoppingList).set({ updatedAt: new Date() }).where(eq(shoppingList.id, listId))
  await audit({ ...actor, action: checked ? 'check' : 'uncheck', entity: 'shopping_list', entityId: String(listId), details: { itemIds } })
  return updated.length
}

export async function removeListItem(actor: ServiceActor, listId: number, itemId: number): Promise<void> {
  let deleted = await db
    .delete(shoppingListItem)
    .where(and(eq(shoppingListItem.listId, listId), eq(shoppingListItem.id, itemId)))
    .returning({ id: shoppingListItem.id, label: shoppingListItem.label })
  if (!deleted.length) throw new UserFacingError('Ese artículo no está en la lista.', 404)
  await db.update(shoppingList).set({ updatedAt: new Date() }).where(eq(shoppingList.id, listId))
  await audit({ ...actor, action: 'remove_item', entity: 'shopping_list', entityId: String(listId), details: { label: deleted[0]!.label } })
}

/** Quita los renglones palomeados (después de ir al súper). */
export async function clearChecked(actor: ServiceActor, listId: number): Promise<number> {
  await getList(listId)
  let deleted = await db
    .delete(shoppingListItem)
    .where(and(eq(shoppingListItem.listId, listId), eq(shoppingListItem.checked, true)))
    .returning({ id: shoppingListItem.id })
  await audit({ ...actor, action: 'clear_checked', entity: 'shopping_list', entityId: String(listId), details: { count: deleted.length } })
  return deleted.length
}

// ─── Exportar ────────────────────────────────────────────────────────────────

const METRIC = new Set(['g', 'kg', 'ml', 'l'])

export function formatItemAmount(item: Pick<ListItemView, 'quantity' | 'unitCode' | 'unitName' | 'unitPlural'>): string {
  if (item.quantity === null) return ''
  // Métricas con decimales (1.5 kg, 750 ml); fracciones de cocina para lo demás (½ taza).
  if (item.unitCode && METRIC.has(item.unitCode)) return `${Math.round(item.quantity * 100) / 100} ${item.unitCode}`
  let qty = formatQuantity(item.quantity)
  if (!item.unitCode) return qty
  if (item.unitCode === 'pz') return `${qty} pz`
  let name = item.quantity <= 1 ? item.unitName : item.unitPlural
  return `${qty} ${name ?? item.unitCode}`
}

/**
 * Texto para WhatsApp / Notas, agrupado por tienda y pasillo. `*negritas*` y `_cursivas_` de WhatsApp.
 * Por defecto solo lo pendiente.
 */
export function exportListText(list: ListDetail, options: { includeChecked?: boolean } = {}): string {
  let items = options.includeChecked ? list.items : list.items.filter((i) => !i.checked)
  let out = [`🛒 *${list.name}*`]
  if (!items.length) {
    out.push('', options.includeChecked ? '(lista vacía)' : '¡Todo comprado! ✅')
    return out.join('\n')
  }
  for (let section of sectionsOf(items)) {
    out.push('', `*${section.storeName ?? 'Cualquier tienda'}*`)
    for (let group of section.aisles) {
      out.push(`_${group.aisleName ?? 'Otros'}_`)
      for (let item of group.items) {
        let amount = formatItemAmount(item)
        let mark = options.includeChecked ? (item.checked ? '✅ ' : '⬜ ') : '• '
        out.push(`${mark}${item.label}${amount ? ` — ${amount}` : ''}${item.notes ? ` (${item.notes})` : ''}`)
      }
    }
  }
  return out.join('\n')
}
