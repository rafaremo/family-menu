import { eq } from 'drizzle-orm'
import * as assert from 'remix/assert'
import { beforeEach, describe, it } from 'remix/test'

import { db } from '../db/client.ts'
import { aisle, auditLog, ingredient, tag, unit } from '../db/schema/index.ts'
import { SEED_INGREDIENTS, SEED_UNITS } from '../db/seed-data.ts'
import { normalizeKey, slugify } from '../lib/slug.ts'
import { resetDb } from '../../test/helpers.ts'
import type { ServiceActor } from './audit.ts'
import { seedCatalogs } from './catalog-seed.ts'
import { aisles, createUnit, newUnitInput, removeUnit, unitInput } from './catalogs.ts'
import {
  createIngredient,
  findIngredientByName,
  getIngredient,
  ingredientInput,
  ingredientPatch,
  listIngredients,
  mergeIngredients,
  removeIngredient,
  searchIngredients,
  updateIngredient,
} from './ingredients.ts'

const system: ServiceActor = { userId: null, via: 'system' }

async function rejectsWith(promise: Promise<unknown>, pattern: RegExp) {
  try {
    await promise
  } catch (error) {
    assert.match((error as Error).message, pattern)
    return
  }
  assert.fail(`Se esperaba un error que coincidiera con ${pattern}`)
}

describe('texto', () => {
  it('normalizes keys and slugs without accents', () => {
    assert.equal(normalizeKey('  Limón   VERDE '), 'limon verde')
    assert.equal(normalizeKey('Jalapeño'), 'jalapeno')
    assert.equal(slugify('Chile poblano (grande)'), 'chile-poblano-grande')
    assert.equal(slugify('¡¡!!'), 'item')
  })
})

describe('validación de ingredientes', () => {
  it('parses form strings: blanks → null, comma decimals, alias lists', () => {
    let result = ingredientInput.safeParse({
      name: '  Harina   de trigo ',
      aliases: 'harina, harina blanca\nHarina ,',
      aisleId: '',
      defaultStoreId: '3',
      defaultUnit: '',
      densityGPerMl: '0,53',
      gramsPerPiece: '',
      notes: '',
    })
    assert.ok(result.success)
    assert.equal(result.data.name, 'Harina de trigo')
    assert.deepEqual(result.data.aliases, ['harina', 'harina blanca', 'Harina'])
    assert.equal(result.data.aisleId, null)
    assert.equal(result.data.defaultStoreId, 3)
    assert.equal(result.data.densityGPerMl, 0.53)
    assert.equal(result.data.gramsPerPiece, null)
  })

  it('rejects bad numbers and empty names', () => {
    let result = ingredientInput.safeParse({ name: ' ', densityGPerMl: 'mucho', gramsPerPiece: '-3' })
    assert.equal(result.success, false)
    let paths = result.error!.issues.map((i) => i.path[0])
    assert.ok(paths.includes('name'))
    assert.ok(paths.includes('densityGPerMl'))
    assert.ok(paths.includes('gramsPerPiece'))
  })

  it('keeps omitted fields undefined in patches (MCP partial updates)', () => {
    let result = ingredientPatch.parse({ notes: 'Nueva nota' })
    assert.equal(result.aisleId, undefined)
    assert.equal(result.aliases, undefined)
    assert.equal(result.notes, 'Nueva nota')
  })

  it('requires an equivalence for convertible units', () => {
    assert.equal(unitInput.safeParse({ name: 'bolsa', plural: 'bolsas', dimension: 'mass', toBase: '' }).success, false)
    let other = unitInput.parse({ name: 'bolsa', plural: 'bolsas', dimension: 'other', toBase: '500' })
    assert.equal(other.toBase, null)
    assert.equal(newUnitInput.safeParse({ code: 'Mi Unidad', name: 'x', plural: 'x', dimension: 'other' }).success, false)
  })
})

describe('seed de catálogos', () => {
  beforeEach(resetDb)

  it('loads every catalog once and is idempotent', async () => {
    let first = await seedCatalogs()
    assert.equal(first.aisles, 12)
    assert.equal(first.stores, 5)
    assert.equal(first.units, SEED_UNITS.length)
    assert.ok(first.tags > 0)
    assert.equal(first.ingredients, SEED_INGREDIENTS.length)

    let second = await seedCatalogs()
    assert.deepEqual(second, { aisles: 0, stores: 0, units: 0, tags: 0, ingredients: 0 })

    let [kg] = await db.select().from(unit).where(eq(unit.code, 'kg'))
    assert.equal(kg?.toBase, 1000)
    assert.equal(kg?.dimension, 'mass')

    let jitomate = await findIngredientByName('jitomate')
    assert.equal(jitomate?.aisleName, 'Frutas y verduras')
    assert.equal(jitomate?.gramsPerPiece, 120)
    assert.ok((await db.select().from(tag)).some((t) => t.slug === 'sopas-y-caldos'))
  })

  it('does not resurrect deleted catalog entries', async () => {
    await seedCatalogs()
    let [otros] = await db.select().from(aisle).where(eq(aisle.name, 'Limpieza'))
    await aisles.remove(system, otros!.id)
    await seedCatalogs()
    let rows = await db.select().from(aisle).where(eq(aisle.name, 'Limpieza'))
    assert.equal(rows.length, 0)
  })
})

describe('búsqueda de ingredientes', () => {
  beforeEach(async () => {
    await resetDb()
    await seedCatalogs()
  })

  it('finds by name ignoring accents and case', async () => {
    let [first] = await searchIngredients('LIMON')
    assert.equal(first?.name, 'Limón')
  })

  it('finds by alias and reports which alias matched', async () => {
    let [first] = await searchIngredients('tomate')
    assert.equal(first?.name, 'Jitomate')
    assert.equal(first?.matchedAlias, 'tomate')

    let [chipotle] = await searchIngredients('chipotle')
    assert.equal(chipotle?.name, 'Chiles chipotles adobados')
  })

  it('tolerates typos (fuzzy trigram search)', async () => {
    for (let [typo, expected] of [
      ['jitomte', 'Jitomate'],
      ['zanaoria', 'Zanahoria'],
      ['cilantor', 'Cilantro'],
      ['mantequila', 'Mantequilla'],
    ]) {
      let results = await searchIngredients(typo!)
      assert.equal(results[0]?.name, expected, `"${typo}" debería encontrar ${expected}`)
    }
  })

  it('ranks exact and prefix matches above partial ones', async () => {
    let names = (await searchIngredients('cebolla')).map((r) => r.name)
    assert.deepEqual(names.slice(0, 2), ['Cebolla blanca', 'Cebolla morada'])

    let pollo = (await searchIngredients('pollo')).map((r) => r.name)
    assert.ok(pollo.includes('Pechuga de pollo'))
    assert.ok(pollo.includes('Muslo de pollo'))
  })

  it('returns nothing for nonsense and handles LIKE wildcards literally', async () => {
    assert.equal((await searchIngredients('qqqzzz')).length, 0)
    assert.equal((await searchIngredients('%')).length, 0)
    assert.equal((await searchIngredients('   ')).length, 0)
  })

  it('lists with pagination and aisle filters', async () => {
    let page1 = await listIngredients({ pageSize: 10 })
    assert.equal(page1.items.length, 10)
    assert.equal(page1.total, SEED_INGREDIENTS.length)
    assert.equal(page1.pages, Math.ceil(SEED_INGREDIENTS.length / 10))

    let [lacteos] = await db.select().from(aisle).where(eq(aisle.name, 'Lácteos y huevo'))
    let filtered = await listIngredients({ aisleId: lacteos!.id, pageSize: 200 })
    assert.ok(filtered.items.length > 0)
    assert.ok(filtered.items.every((i) => i.aisleName === 'Lácteos y huevo'))

    let unassigned = await listIngredients({ aisleId: 0 })
    assert.equal(unassigned.total, 0)
  })
})

describe('CRUD de ingredientes', () => {
  beforeEach(async () => {
    await resetDb()
    await seedCatalogs()
  })

  it('creates with cleaned aliases, slug and audit entry', async () => {
    let created = await createIngredient(system, {
      name: 'Chile morita',
      aliases: ['morita', 'Morita', 'chile morita', ' moritas '],
      defaultUnit: 'pz',
    })
    assert.deepEqual(created.aliases, ['morita', 'moritas'])
    assert.equal(created.slug, 'chile-morita')
    assert.equal(created.unitName, 'pieza')
    assert.equal((await findIngredientByName('MORITA'))?.id, created.id)

    let logs = await db.select().from(auditLog).where(eq(auditLog.entityId, String(created.id)))
    assert.equal(logs[0]?.action, 'create')
  })

  it('rejects duplicate names (accent-insensitive) and alias collisions', async () => {
    await rejectsWith(createIngredient(system, { name: 'limon' }), /Ya existe el ingrediente "Limón"/)
    await rejectsWith(createIngredient(system, { name: 'Tomate' }), /"Tomate" ya es alias de "Jitomate"/)
    await rejectsWith(
      createIngredient(system, { name: 'Tomate bola', aliases: ['jitomate'] }),
      /Ya existe el ingrediente "Jitomate"/,
    )
  })

  it('rejects unknown units', async () => {
    await rejectsWith(createIngredient(system, { name: 'Algo raro', defaultUnit: 'nope' }), /no existen/)
  })

  it('updates partially, keeping untouched fields', async () => {
    let jitomate = (await findIngredientByName('jitomate'))!
    let updated = await updateIngredient(system, jitomate.id, { notes: 'Mejor el saladet' })
    assert.equal(updated.notes, 'Mejor el saladet')
    assert.equal(updated.aisleName, 'Frutas y verduras')
    assert.deepEqual(updated.aliases, jitomate.aliases)
    assert.equal(updated.slug, 'jitomate')

    let renamed = await updateIngredient(system, jitomate.id, { name: 'Jitomate saladet', aliases: ['jitomate', 'tomate'] })
    assert.equal(renamed.slug, 'jitomate-saladet')
    assert.deepEqual(renamed.aliases, ['jitomate', 'tomate'])
    assert.equal((await findIngredientByName('jitomate'))?.id, jitomate.id)

    await rejectsWith(updateIngredient(system, jitomate.id, { aliases: ['cebolla'] }), /ya es alias de "Cebolla blanca"/)
  })

  it('clears fields when given null', async () => {
    let huevo = (await findIngredientByName('huevo'))!
    let updated = await updateIngredient(system, huevo.id, { gramsPerPiece: null, aisleId: null })
    assert.equal(updated.gramsPerPiece, null)
    assert.equal(updated.aisleId, null)
  })

  it('merges a duplicate into the target', async () => {
    let jitomate = (await findIngredientByName('jitomate'))!
    let dup = await createIngredient(system, {
      name: 'Tomate guaje',
      aliases: ['guaje'],
      notes: 'Para salsas',
      densityGPerMl: 0.95,
    })

    let merged = await mergeIngredients(system, dup.id, jitomate.id)
    assert.equal(merged.id, jitomate.id)
    assert.ok(merged.aliases.includes('Tomate guaje'))
    assert.ok(merged.aliases.includes('guaje'))
    assert.equal(merged.densityGPerMl, 0.95)
    assert.equal(merged.gramsPerPiece, 120)
    assert.equal(merged.notes, 'Para salsas')

    await rejectsWith(getIngredient(dup.id), /no existe/)
    assert.equal((await findIngredientByName('guaje'))?.id, jitomate.id)
    await rejectsWith(mergeIngredients(system, jitomate.id, jitomate.id), /distinto/)
  })

  it('deletes ingredients', async () => {
    let fresa = (await findIngredientByName('fresa'))!
    await removeIngredient(system, fresa.id)
    assert.equal(await findIngredientByName('fresa'), null)
    let rows = await db.select().from(ingredient).where(eq(ingredient.id, fresa.id))
    assert.equal(rows.length, 0)
  })

  it('cannot delete a unit that ingredients use', async () => {
    await rejectsWith(removeUnit(system, 'g'), /ingrediente\(s\) la usan/)
    await createUnit(system, newUnitInput.parse({ code: 'bolsa', name: 'bolsa', plural: 'bolsas', dimension: 'other' }))
    await removeUnit(system, 'bolsa')
  })
})
