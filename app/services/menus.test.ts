import { eq } from 'drizzle-orm'
import * as assert from 'remix/assert'
import { beforeEach, describe, it } from 'remix/test'

import { db } from '../db/client.ts'
import { store } from '../db/schema/index.ts'
import { addDays, formatWeek, mondayOf, todayIso, weekDays } from '../lib/dates.ts'
import { createUser, resetDb } from '../../test/helpers.ts'
import type { ServiceActor } from './audit.ts'
import { seedCatalogs } from './catalog-seed.ts'
import { findIngredientByName, mergeIngredients, updateIngredient } from './ingredients.ts'
import { addMenuItem, copyMenu, createMenu, getMenu, menuForWeek, menuItemInput, removeMenuItem, updateMenu, updateMenuItem } from './menus.ts'
import { createRecipe, deleteRecipe, recipeInput } from './recipes.ts'
import {
  addManualItem,
  clearChecked,
  exportListText,
  generateListForMenu,
  getList,
  manualItemInput,
  regenerateList,
  sectionsOf,
  setItemsChecked,
} from './shopping.ts'

let actor: ServiceActor

async function rejectsWith(promise: Promise<unknown>, pattern: RegExp) {
  try {
    await promise
  } catch (error) {
    assert.match((error as Error).message, pattern)
    return
  }
  assert.fail(`Se esperaba un error que coincidiera con ${pattern}`)
}

const WEEK = '2026-11-02' // lunes

async function seedRecipes() {
  let tinga = await createRecipe(actor, recipeInput.parse({
    title: 'Tinga de pollo', servings: 4,
    ingredients: [
      { ingredient: 'pechuga', quantity: 500, unit: 'g' },
      { ingredient: 'jitomate', quantity: 3, unit: '' },
      { ingredient: 'cebolla', quantity: 1, unit: 'pz' },
      { ingredient: 'chipotle', quantity: 1, unit: 'lata' },
      { ingredient: 'tostadas', quantity: 12 },
      { ingredient: 'crema', quantity: 0.5, unit: 'taza', optional: true },
      { ingredient: 'sal' },
    ],
  }))
  let arroz = await createRecipe(actor, recipeInput.parse({
    title: 'Arroz rojo', servings: 6,
    ingredients: [
      { ingredient: 'arroz', quantity: 2, unit: 'taza' },
      { ingredient: 'jitomate', quantity: 200, unit: 'g' },
      { ingredient: 'cebolla', quantity: 0.5, unit: 'pz' },
      { ingredient: 'caldo de pollo', quantity: 1, unit: 'l' },
      { ingredient: 'sal' },
    ],
  }))
  let huevos = await createRecipe(actor, recipeInput.parse({
    title: 'Huevos a la mexicana', servings: 2,
    ingredients: [
      { ingredient: 'huevo', quantity: 4 },
      { ingredient: 'jitomate', quantity: 1 },
      { ingredient: 'chile serrano', quantity: 2 },
      { ingredient: 'cebolla', quantity: 0.25, unit: 'pz' },
    ],
  }))
  return { tinga: tinga.recipe, arroz: arroz.recipe, huevos: huevos.recipe }
}

describe('fechas', () => {
  it('computes weeks from Monday and formats in Spanish', () => {
    assert.equal(mondayOf('2026-11-08'), '2026-11-02') // domingo
    assert.equal(mondayOf('2026-11-02'), '2026-11-02')
    assert.equal(mondayOf('2027-01-01'), '2026-12-28')
    assert.deepEqual(weekDays(WEEK).slice(-1), ['2026-11-08'])
    assert.equal(addDays('2026-02-28', 1), '2026-03-01')
    assert.match(formatWeek(WEEK), /^2 nov\.? – 8 nov\.? 2026$/)
    assert.equal(todayIso(new Date('2026-11-02T05:30:00Z'), 'America/Mexico_City'), '2026-11-01')
  })
})

describe('menús y lista del súper', () => {
  beforeEach(async () => {
    await resetDb()
    await seedCatalogs()
    let u = await createUser({ email: 'mon@test.local', password: 'member-secreto-1', name: 'Mon', role: 'member' })
    actor = { userId: u.id, via: 'web' }
  })

  it('creates menus on Mondays and validates item dates', async () => {
    let m = await createMenu(actor, { weekStart: '2026-11-05', defaultServings: 5 })
    assert.equal(m.weekStart, WEEK)
    assert.equal(m.name, 'Semana del 2 nov')
    let { tinga } = await seedRecipes()
    let item = await addMenuItem(actor, m.id, menuItemInput.parse({ date: '2026-11-03', meal: 'comida', recipe: tinga.slug }))
    assert.equal(item.servings, 5)
    assert.equal(item.recipeTitle, 'Tinga de pollo')
    await rejectsWith(addMenuItem(actor, m.id, menuItemInput.parse({ date: '2026-11-09', meal: 'cena', recipe: 'tinga de pollo' })), /no está en la semana/)
    await rejectsWith(addMenuItem(actor, m.id, menuItemInput.parse({ date: WEEK, meal: 'cena', recipe: 'Pozole' })), /No encontré la receta "Pozole"/)
    let byTitle = await addMenuItem(actor, m.id, menuItemInput.parse({ date: WEEK, meal: 'cena', recipe: 'TINGA DE POLLO', servings: '2' }))
    assert.equal(byTitle.servings, 2)
  })

  it('generates a correct, grouped list for a 7-day menu', async () => {
    let { tinga, arroz, huevos } = await seedRecipes()
    let [costco] = await db.select().from(store).where(eq(store.name, 'Costco'))
    let pechuga = (await findIngredientByName('pechuga'))!
    await updateIngredient(actor, pechuga.id, { defaultStoreId: costco!.id })

    let m = await createMenu(actor, { weekStart: WEEK, defaultServings: 4 })
    for (let date of weekDays(WEEK)) {
      await addMenuItem(actor, m.id, menuItemInput.parse({ date, meal: 'desayuno', recipe: huevos.id, servings: 4 }))
    }
    for (let date of [WEEK, addDays(WEEK, 3)]) {
      await addMenuItem(actor, m.id, menuItemInput.parse({ date, meal: 'comida', recipe: tinga.id, servings: 6 }))
    }
    for (let date of [addDays(WEEK, 1), addDays(WEEK, 4)]) {
      await addMenuItem(actor, m.id, menuItemInput.parse({ date, meal: 'comida', recipe: arroz.id, servings: 6 }))
    }

    let list = await generateListForMenu(actor, m.id)
    let byLabel = new Map(list.items.map((i) => [`${i.label}|${i.unitCode}`, i]))
    let qty = (label: string, unit: string) => byLabel.get(`${label}|${unit}`)?.quantity

    // Huevo: 4 pz × (4/2) × 7 días = 56
    assert.equal(qty('Huevo', 'pz'), 56)
    // Pechuga: 500 g × 6/4 × 2 = 1500 g → 1.5 kg (en Costco)
    assert.equal(qty('Pechuga de pollo', 'kg'), 1.5)
    assert.equal(byLabel.get('Pechuga de pollo|kg')!.storeName, 'Costco')
    // Jitomate (g, 120 g/pz): huevos 1 pz ×2 ×7 = 14 pz = 1680 g; tinga 3 pz ×1.5 ×2 = 9 pz = 1080 g; arroz 200 g ×1 ×2 = 400 g → 3160 g
    assert.equal(qty('Jitomate', 'kg'), 3.16)
    // Cebolla (pz): huevos 0.25×2×7 = 3.5; tinga 1×1.5×2 = 3; arroz 0.5×1×2 = 1 → 7.5 → 8 pz
    assert.equal(qty('Cebolla blanca', 'pz'), 8)
    // Arroz: 2 tazas = 480 ml × 0.85 g/ml = 408 g × 2 = 816 g
    assert.equal(qty('Arroz', 'g'), 816)
    // Caldo: 1 l × 2 = 2 l
    assert.equal(qty('Caldo de pollo', 'l'), 2)
    // Chipotle: 1 lata × 1.5 × 2 = 3 latas
    assert.equal(qty('Chiles chipotles adobados', 'lata'), 3)
    // Tostadas sin unidad: 12 × 1.5 × 2 = 36 pz
    assert.equal(qty('Tostadas', 'pz'), 36)
    // Serrano: 2 × 2 × 7 = 28
    assert.equal(qty('Chile serrano', 'pz'), 28)
    // Sal: al gusto, un solo renglón sin cantidad
    let sal = list.items.filter((i) => i.label === 'Sal')
    assert.equal(sal.length, 1)
    assert.equal(sal[0]!.quantity, null)
    // Crema es opcional: no aparece
    assert.equal(list.items.some((i) => i.label === 'Crema'), false)

    // Agrupado: Costco primero (orden 10), luego "Cualquier tienda"; pasillos en orden de catálogo
    let sections = sectionsOf(list.items)
    assert.equal(sections[0]!.storeName, 'Costco')
    assert.equal(sections[1]!.storeName, null)
    assert.deepEqual(
      sections[1]!.aisles.map((a) => a.aisleName),
      ['Frutas y verduras', 'Lácteos y huevo', 'Panadería y tortillas', 'Abarrotes', 'Especias y condimentos', 'Enlatados'],
    )
    let jitomate = byLabel.get('Jitomate|kg')!
    assert.deepEqual(jitomate.sourceRecipes.map((s) => s.recipe).filter((v, i, a) => a.indexOf(v) === i), [
      'Huevos a la mexicana',
      'Tinga de pollo',
      'Arroz rojo',
    ])

    let text = exportListText(list)
    assert.match(text, /^🛒 \*Súper: Semana del 2 nov\.?\*/)
    assert.match(text, /\*Costco\*\n_Carnes y pescados_\n• Pechuga de pollo — 1.5 kg/)
    assert.match(text, /• Huevo — 56 pz/)
    assert.match(text, /• Chiles chipotles adobados — 3 latas/)
    assert.match(text, /• Sal\n/)
  })

  it('regenerates keeping manual items and checked state', async () => {
    let { tinga, huevos } = await seedRecipes()
    let m = await createMenu(actor, { weekStart: WEEK, defaultServings: 4 })
    let item = await addMenuItem(actor, m.id, menuItemInput.parse({ date: WEEK, meal: 'comida', recipe: tinga.id }))
    let list = await generateListForMenu(actor, m.id)

    let pechuga = list.items.find((i) => i.label === 'Pechuga de pollo')!
    let tostadas = list.items.find((i) => i.label === 'Tostadas')!
    await setItemsChecked(actor, list.id, [pechuga.id, tostadas.id], true)
    let manual = await addManualItem(actor, list.id, manualItemInput.parse({ label: 'Papel de baño', quantity: '2', unit: 'paquetes' }))
    assert.equal(manual.unitCode, 'paquete')
    assert.equal(manual.aisleName, null)
    let leche = await addManualItem(actor, list.id, manualItemInput.parse({ label: 'leche entera', quantity: '2', unit: 'l' }))
    assert.equal(leche.label, 'Leche')
    assert.equal(leche.aisleName, 'Lácteos y huevo')

    // Cambia el menú: más porciones de tinga y agrega huevos.
    await updateMenuItem(actor, m.id, item.id, { servings: 8 })
    await addMenuItem(actor, m.id, menuItemInput.parse({ date: WEEK, meal: 'desayuno', recipe: huevos.id }))
    let again = await regenerateList(actor, list.id)
    assert.equal(again.id, list.id)

    let get = (label: string) => again.items.find((i) => i.label === label)!
    assert.equal(get('Pechuga de pollo').quantity, 1)
    assert.equal(get('Pechuga de pollo').unitCode, 'kg')
    assert.equal(get('Pechuga de pollo').checked, true) // seguía existiendo (misma dimensión)
    assert.equal(get('Tostadas').checked, true)
    assert.equal(get('Huevo').checked, false)
    assert.ok(get('Papel de baño'))
    assert.equal(get('Leche').source, 'manual')

    // Generar otra vez desde el menú reutiliza la lista abierta.
    let same = await generateListForMenu(actor, m.id)
    assert.equal(same.id, list.id)

    assert.equal(await clearChecked(actor, list.id), 2)
    assert.equal((await getList(list.id)).items.some((i) => i.checked), false)
  })

  it('copies menus to another week, moves weeks and cascades deleted recipes', async () => {
    let { tinga, arroz } = await seedRecipes()
    let m = await createMenu(actor, { weekStart: WEEK })
    await addMenuItem(actor, m.id, menuItemInput.parse({ date: addDays(WEEK, 2), meal: 'comida', recipe: tinga.id }))
    let arrozItem = await addMenuItem(actor, m.id, menuItemInput.parse({ date: addDays(WEEK, 2), meal: 'comida', recipe: arroz.id }))

    let copy = await copyMenu(actor, m.id, '2026-11-12')
    assert.equal(copy.weekStart, '2026-11-09')
    assert.deepEqual(copy.items.map((i) => [i.date, i.recipeTitle]), [
      ['2026-11-11', 'Tinga de pollo'],
      ['2026-11-11', 'Arroz rojo'],
    ])

    let moved = await updateMenu(actor, m.id, { weekStart: '2026-11-16' })
    assert.equal(moved.weekStart, '2026-11-16')
    assert.equal(moved.items[0]!.date, '2026-11-18')
    assert.equal((await menuForWeek('2026-11-20'))?.id, m.id)

    await removeMenuItem(actor, m.id, arrozItem.id)
    await deleteRecipe(actor, tinga.id)
    assert.equal((await getMenu(m.id)).items.length, 0)
    assert.equal((await getMenu(copy.id)).items.length, 1)
  })

  it('merging ingredients repoints list items', async () => {
    let { tinga } = await seedRecipes()
    let m = await createMenu(actor, { weekStart: WEEK })
    await addMenuItem(actor, m.id, menuItemInput.parse({ date: WEEK, meal: 'comida', recipe: tinga.id }))
    let list = await generateListForMenu(actor, m.id)
    let tostadas = (await findIngredientByName('tostadas'))!
    let dup = await addManualItem(actor, list.id, manualItemInput.parse({ label: 'Tostadas' }))
    assert.equal(dup.ingredientId, tostadas.id)
    let tortilla = (await findIngredientByName('tortilla de maíz'))!
    await mergeIngredients(actor, tostadas.id, tortilla.id)
    let after = await getList(list.id)
    assert.ok(after.items.filter((i) => i.label === 'Tostadas').every((i) => i.ingredientId === tortilla.id))
  })
})
