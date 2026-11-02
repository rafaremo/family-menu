import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm'
import * as z from 'zod'

import { db } from '../db/client.ts'
import { menu, menuItem, recipe, recipePhoto, shoppingList } from '../db/schema/index.ts'
import { addDays, daysBetween, defaultMenuName, isIsoDate, mondayOf, todayIso } from '../lib/dates.ts'
import { UserFacingError } from '../lib/errors.ts'
import { cleanText, normalizeKey } from '../lib/slug.ts'
import { blankToNull, optionalText } from '../lib/validation.ts'
import { audit, type ServiceActor } from './audit.ts'

/**
 * Menús semanales: una cuadrícula día × comida con recetas y porciones.
 * La semana empieza en lunes; un platillo siempre cae dentro de su semana.
 */

export const MEALS = [
  { value: 'desayuno', label: 'Desayuno' },
  { value: 'comida', label: 'Comida' },
  { value: 'cena', label: 'Cena' },
  { value: 'colacion', label: 'Colación' },
] as const
export type Meal = (typeof MEALS)[number]['value']
export const MEAL_VALUES = MEALS.map((m) => m.value) as [Meal, ...Meal[]]
export const mealLabel = (meal: Meal) => MEALS.find((m) => m.value === meal)!.label

// ─── Esquemas ────────────────────────────────────────────────────────────────

const isoDateField = z.string().trim().refine(isIsoDate, 'Fecha inválida (usa AAAA-MM-DD).')

const servingsField = z.preprocess(
  (v) => {
    let value = blankToNull(v)
    return typeof value === 'string' ? Number(value.trim()) : value
  },
  z.number({ message: 'Porciones: escribe un número.' }).int('Porciones: número entero.').min(1, 'Porciones: mínimo 1.').max(100, 'Porciones: máximo 100.').nullable().optional(),
)

export const menuInput = z.object({
  /** Cualquier fecha de la semana; se ajusta al lunes. */
  weekStart: isoDateField,
  name: optionalText(80),
  defaultServings: servingsField,
  notes: optionalText(2000),
})
export type MenuInput = z.output<typeof menuInput>

export const menuPatch = menuInput.partial()
export type MenuPatch = z.output<typeof menuPatch>

export const menuItemInput = z.object({
  /** Fecha del platillo (dentro de la semana del menú). */
  date: isoDateField,
  meal: z.enum(MEAL_VALUES, { message: 'Comida inválida.' }),
  /** id, slug o título de la receta. */
  recipe: z.union([z.number().int().positive(), z.string().trim().min(1, 'Elige una receta.')]),
  servings: servingsField,
  notes: optionalText(300),
})
export type MenuItemInput = z.output<typeof menuItemInput>

export const menuItemPatch = menuItemInput.omit({ recipe: true }).partial()
export type MenuItemPatch = z.output<typeof menuItemPatch>

// ─── Tipos ───────────────────────────────────────────────────────────────────

export interface MenuSummary {
  id: number
  name: string
  weekStart: string
  defaultServings: number
  itemCount: number
  listId: number | null
}

export interface MenuItemView {
  id: number
  date: string
  meal: Meal
  servings: number
  notes: string | null
  position: number
  recipeId: number
  recipeTitle: string
  recipeSlug: string
  recipeServings: number
  coverPhotoKey: string | null
}

export interface MenuDetail {
  id: number
  name: string
  weekStart: string
  defaultServings: number
  notes: string | null
  createdAt: Date
  updatedAt: Date
  items: MenuItemView[]
  listId: number | null
}

// ─── Lectura ─────────────────────────────────────────────────────────────────

async function latestListIds(menuIds: number[]): Promise<Map<number, number>> {
  let map = new Map<number, number>()
  if (!menuIds.length) return map
  let rows = await db
    .select({ id: shoppingList.id, menuId: shoppingList.menuId })
    .from(shoppingList)
    .where(inArray(shoppingList.menuId, menuIds))
    .orderBy(desc(shoppingList.createdAt), desc(shoppingList.id))
  for (let r of rows) if (r.menuId !== null && !map.has(r.menuId)) map.set(r.menuId, r.id)
  return map
}

export async function listMenus(limit = 100): Promise<MenuSummary[]> {
  let rows = await db
    .select({
      id: menu.id,
      name: menu.name,
      weekStart: menu.weekStart,
      defaultServings: menu.defaultServings,
      itemCount: sql<number>`(select count(*)::int from ${menuItem} where ${menuItem.menuId} = ${menu.id})`,
    })
    .from(menu)
    .orderBy(desc(menu.weekStart), desc(menu.id))
    .limit(limit)
  let lists = await latestListIds(rows.map((r) => r.id))
  return rows.map((r) => ({ ...r, itemCount: Number(r.itemCount), listId: lists.get(r.id) ?? null }))
}

export async function getMenu(id: number): Promise<MenuDetail> {
  let [row] = await db.select().from(menu).where(eq(menu.id, id)).limit(1)
  if (!row) throw new UserFacingError('Ese menú no existe.', 404)
  let items = await db
    .select({
      id: menuItem.id,
      date: menuItem.date,
      meal: menuItem.meal,
      servings: menuItem.servings,
      notes: menuItem.notes,
      position: menuItem.position,
      recipeId: recipe.id,
      recipeTitle: recipe.title,
      recipeSlug: recipe.slug,
      recipeServings: recipe.servings,
      coverPhotoKey: recipePhoto.storageKey,
    })
    .from(menuItem)
    .innerJoin(recipe, eq(recipe.id, menuItem.recipeId))
    .leftJoin(recipePhoto, eq(recipePhoto.id, recipe.coverPhotoId))
    .where(eq(menuItem.menuId, id))
    .orderBy(asc(menuItem.date), asc(menuItem.position), asc(menuItem.id))
  let mealOrder = new Map(MEAL_VALUES.map((m, i) => [m, i]))
  items.sort((a, b) => a.date.localeCompare(b.date) || mealOrder.get(a.meal)! - mealOrder.get(b.meal)! || a.position - b.position)
  let lists = await latestListIds([id])
  return { ...row, items, listId: lists.get(id) ?? null }
}

/** Menú de la semana de `date` (el más reciente si hay varios). */
export async function menuForWeek(date = todayIso()): Promise<MenuDetail | null> {
  let [row] = await db
    .select({ id: menu.id })
    .from(menu)
    .where(eq(menu.weekStart, mondayOf(date)))
    .orderBy(desc(menu.updatedAt), desc(menu.id))
    .limit(1)
  return row ? getMenu(row.id) : null
}

// ─── Escritura ───────────────────────────────────────────────────────────────

export async function createMenu(actor: ServiceActor, input: MenuInput): Promise<MenuDetail> {
  let weekStart = mondayOf(input.weekStart)
  let [row] = await db
    .insert(menu)
    .values({
      name: input.name ? cleanText(input.name) : defaultMenuName(weekStart),
      weekStart,
      defaultServings: input.defaultServings ?? 4,
      notes: input.notes ?? null,
      createdBy: actor.userId,
    })
    .returning({ id: menu.id })
  await audit({ ...actor, action: 'create', entity: 'menu', entityId: String(row!.id), details: { weekStart } })
  return getMenu(row!.id)
}

export async function updateMenu(actor: ServiceActor, id: number, patch: MenuPatch): Promise<MenuDetail> {
  let current = await getMenu(id)
  let weekStart = patch.weekStart ? mondayOf(patch.weekStart) : current.weekStart
  let shift = daysBetween(current.weekStart, weekStart)

  await db.transaction(async (tx) => {
    await tx
      .update(menu)
      .set({
        weekStart,
        name: patch.name === undefined ? undefined : patch.name ? cleanText(patch.name) : defaultMenuName(weekStart),
        defaultServings: patch.defaultServings ?? undefined,
        notes: patch.notes,
        updatedAt: new Date(),
      })
      .where(eq(menu.id, id))
    // Si cambia la semana, los platillos se mueven con ella.
    if (shift !== 0) {
      await tx
        .update(menuItem)
        .set({ date: sql`${menuItem.date} + ${shift}::int` })
        .where(eq(menuItem.menuId, id))
    }
  })
  await audit({ ...actor, action: 'update', entity: 'menu', entityId: String(id), details: { ...patch } })
  return getMenu(id)
}

export async function deleteMenu(actor: ServiceActor, id: number): Promise<void> {
  let current = await getMenu(id)
  await db.delete(menu).where(eq(menu.id, id))
  await audit({ ...actor, action: 'delete', entity: 'menu', entityId: String(id), details: { name: current.name } })
}

/** Busca una receta por id, slug o título (sin acentos). */
export async function resolveRecipe(ref: number | string): Promise<{ id: number; title: string; servings: number }> {
  let fields = { id: recipe.id, title: recipe.title, servings: recipe.servings }
  let rows =
    typeof ref === 'number' || /^\d+$/.test(ref)
      ? await db.select(fields).from(recipe).where(eq(recipe.id, Number(ref))).limit(1)
      : await db.select(fields).from(recipe).where(eq(recipe.slug, ref)).limit(1)
  if (!rows.length && typeof ref === 'string') {
    let key = normalizeKey(ref)
    let all = await db.select(fields).from(recipe)
    rows = all.filter((r) => normalizeKey(r.title) === key)
  }
  if (!rows[0]) throw new UserFacingError(`No encontré la receta "${ref}".`, 404)
  return rows[0]
}

function assertInWeek(weekStart: string, date: string) {
  let offset = daysBetween(weekStart, date)
  if (offset < 0 || offset > 6) {
    throw new UserFacingError(`La fecha ${date} no está en la semana del menú (${weekStart} a ${addDays(weekStart, 6)}).`)
  }
}

export async function addMenuItem(actor: ServiceActor, menuId: number, input: MenuItemInput): Promise<MenuItemView> {
  let current = await getMenu(menuId)
  assertInWeek(current.weekStart, input.date)
  let target = await resolveRecipe(input.recipe)

  let [{ n } = { n: 0 }] = await db
    .select({ n: count() })
    .from(menuItem)
    .where(and(eq(menuItem.menuId, menuId), eq(menuItem.date, input.date), eq(menuItem.meal, input.meal)))
  let [row] = await db
    .insert(menuItem)
    .values({
      menuId,
      date: input.date,
      meal: input.meal,
      recipeId: target.id,
      servings: input.servings ?? current.defaultServings,
      position: n,
      notes: input.notes ?? null,
    })
    .returning({ id: menuItem.id })
  await db.update(menu).set({ updatedAt: new Date() }).where(eq(menu.id, menuId))
  await audit({
    ...actor,
    action: 'add_item',
    entity: 'menu',
    entityId: String(menuId),
    details: { recipe: target.title, date: input.date, meal: input.meal },
  })
  return (await getMenu(menuId)).items.find((i) => i.id === row!.id)!
}

async function getItem(menuId: number, itemId: number) {
  let [row] = await db
    .select()
    .from(menuItem)
    .where(and(eq(menuItem.id, itemId), eq(menuItem.menuId, menuId)))
    .limit(1)
  if (!row) throw new UserFacingError('Ese platillo no existe en el menú.', 404)
  return row
}

export async function updateMenuItem(actor: ServiceActor, menuId: number, itemId: number, patch: MenuItemPatch): Promise<void> {
  let current = await getMenu(menuId)
  await getItem(menuId, itemId)
  if (patch.date) assertInWeek(current.weekStart, patch.date)
  await db
    .update(menuItem)
    .set({ date: patch.date, meal: patch.meal, servings: patch.servings ?? undefined, notes: patch.notes })
    .where(eq(menuItem.id, itemId))
  await db.update(menu).set({ updatedAt: new Date() }).where(eq(menu.id, menuId))
  await audit({ ...actor, action: 'update_item', entity: 'menu', entityId: String(menuId), details: { itemId, ...patch } })
}

export async function removeMenuItem(actor: ServiceActor, menuId: number, itemId: number): Promise<void> {
  await getItem(menuId, itemId)
  await db.delete(menuItem).where(eq(menuItem.id, itemId))
  await db.update(menu).set({ updatedAt: new Date() }).where(eq(menu.id, menuId))
  await audit({ ...actor, action: 'remove_item', entity: 'menu', entityId: String(menuId), details: { itemId } })
}

/** Copia un menú a otra semana (repetir una semana que funcionó). */
export async function copyMenu(actor: ServiceActor, menuId: number, targetWeek: string, name?: string | null): Promise<MenuDetail> {
  if (!isIsoDate(targetWeek)) throw new UserFacingError('Fecha inválida.')
  let source = await getMenu(menuId)
  let weekStart = mondayOf(targetWeek)
  let shift = daysBetween(source.weekStart, weekStart)

  let id = await db.transaction(async (tx) => {
    let [row] = await tx
      .insert(menu)
      .values({
        name: name ? cleanText(name) : defaultMenuName(weekStart),
        weekStart,
        defaultServings: source.defaultServings,
        notes: source.notes,
        createdBy: actor.userId,
      })
      .returning({ id: menu.id })
    if (source.items.length) {
      await tx.insert(menuItem).values(
        source.items.map((item) => ({
          menuId: row!.id,
          date: addDays(item.date, shift),
          meal: item.meal,
          recipeId: item.recipeId,
          servings: item.servings,
          position: item.position,
          notes: item.notes,
        })),
      )
    }
    return row!.id
  })
  await audit({ ...actor, action: 'copy', entity: 'menu', entityId: String(id), details: { from: menuId, weekStart } })
  return getMenu(id)
}
