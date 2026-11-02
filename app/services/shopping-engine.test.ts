import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'

import { SEED_UNITS } from '../db/seed-data.ts'
import { computeShoppingLines, type EngineEntry, type EngineIngredient } from './shopping-engine.ts'
import { convertBase, humanize, toMeasure, unitTable } from './units.ts'

const units = unitTable(SEED_UNITS.map(([code, name, plural, dimension, toBase]) => ({ code, name, plural, dimension, toBase })))

function ing(id: number, name: string, extra: Partial<EngineIngredient> = {}): EngineIngredient {
  return {
    id, name, aisleId: null, aisleName: null, aisleOrder: null, storeId: null, storeName: null, storeOrder: null,
    defaultUnit: null, densityGPerMl: null, gramsPerPiece: null, ...extra,
  }
}

const HARINA = ing(1, 'Harina de trigo', { defaultUnit: 'g', densityGPerMl: 0.53, aisleId: 6, aisleName: 'Abarrotes', aisleOrder: 60 })
const JITOMATE = ing(2, 'Jitomate', { defaultUnit: 'g', gramsPerPiece: 120, aisleId: 1, aisleName: 'Frutas y verduras', aisleOrder: 10 })
const SAL = ing(3, 'Sal', { defaultUnit: 'g', aisleOrder: 70 })
const LECHE = ing(4, 'Leche', { defaultUnit: 'ml', densityGPerMl: 1.03, aisleOrder: 40, storeId: 1, storeName: 'Costco', storeOrder: 10 })
const CILANTRO = ing(5, 'Cilantro', { defaultUnit: 'manojo', aisleOrder: 10 })
const HUEVO = ing(6, 'Huevo', { defaultUnit: 'pz', gramsPerPiece: 50, aisleOrder: 40 })
const CREMA = ing(7, 'Crema', { defaultUnit: 'ml', aisleOrder: 40 })
const all = new Map([HARINA, JITOMATE, SAL, LECHE, CILANTRO, HUEVO, CREMA].map((i) => [i.id, i]))

const entry = (recipeTitle: string, recipeServings: number, servings: number, lines: EngineEntry['lines']): EngineEntry => ({
  recipeTitle, recipeServings, servings, lines,
})
const line = (ingredientId: number, quantity: number | null, unitCode: string | null, optional = false) => ({ ingredientId, quantity, unitCode, optional })

function summary(entries: EngineEntry[], options = {}) {
  return computeShoppingLines(entries, all, units, options).map((l) => `${l.label}: ${l.quantity ?? '—'} ${l.unitCode ?? ''}`.trim())
}

describe('unidades', () => {
  it('normalizes to base units', () => {
    assert.deepEqual(toMeasure(2, 'taza', units), { group: 'volume', amount: 480 })
    assert.deepEqual(toMeasure(1.5, 'kg', units), { group: 'mass', amount: 1500 })
    assert.deepEqual(toMeasure(3, null, units), { group: 'count', amount: 3 })
    assert.deepEqual(toMeasure(2, 'lata', units), { group: 'u:lata', amount: 2 })
    assert.equal(toMeasure(null, 'g', units), null)
  })

  it('converts across dimensions only with the right factor', () => {
    let f = { densityGPerMl: 0.5, gramsPerPiece: 100 }
    assert.equal(convertBase(240, 'volume', 'mass', f), 120)
    assert.equal(convertBase(300, 'mass', 'count', f), 3)
    assert.equal(convertBase(2, 'count', 'volume', f), 400)
    assert.equal(convertBase(240, 'volume', 'mass', { densityGPerMl: null, gramsPerPiece: 100 }), null)
  })

  it('humanizes to buyable amounts', () => {
    assert.deepEqual(humanize({ group: 'mass', amount: 1500 }), { quantity: 1.5, unitCode: 'kg' })
    assert.deepEqual(humanize({ group: 'mass', amount: 333.33 }), { quantity: 334, unitCode: 'g' })
    assert.deepEqual(humanize({ group: 'mass', amount: 1000.0000001 }), { quantity: 1, unitCode: 'kg' })
    assert.deepEqual(humanize({ group: 'volume', amount: 750 }), { quantity: 750, unitCode: 'ml' })
    assert.deepEqual(humanize({ group: 'volume', amount: 2250 }), { quantity: 2.25, unitCode: 'l' })
    assert.deepEqual(humanize({ group: 'count', amount: 2.33 }), { quantity: 3, unitCode: 'pz' })
    assert.deepEqual(humanize({ group: 'u:lata', amount: 1.5 }), { quantity: 2, unitCode: 'lata' })
  })
})

describe('motor de lista del súper', () => {
  it('scales by servings and sums the same ingredient across recipes', () => {
    let lines = summary([
      entry('Pastel', 8, 4, [line(1, 500, 'g')]),
      entry('Hot cakes', 4, 8, [line(1, 250, 'g')]),
    ])
    assert.deepEqual(lines, ['Harina de trigo: 750 g'])
  })

  it('converts cups to grams with density and pieces to grams with grams-per-piece', () => {
    let lines = summary([
      entry('Galletas', 4, 4, [line(1, 2, 'taza'), line(1, 500, 'g')]),
      entry('Salsa', 4, 4, [line(2, 3, null), line(2, 640, 'g')]),
    ])
    // 2 tazas = 480 ml × 0.53 = 254.4 g + 500 g = 754.4 → 755 g; 3 pz × 120 + 640 = 1000 g → 1 kg
    assert.deepEqual(lines, ['Jitomate: 1 kg', 'Harina de trigo: 755 g'])
  })

  it('keeps unconvertible quantities as separate rows', () => {
    let lines = summary([entry('Salsa', 4, 4, [line(7, 200, 'ml'), line(7, 100, 'g')])])
    assert.deepEqual(lines, ['Crema: 200 ml', 'Crema: 100 g'])
  })

  it('handles “al gusto”: only its own row when nothing else asks for it', () => {
    assert.deepEqual(summary([entry('Caldo', 4, 4, [line(3, null, null)])]), ['Sal: —'])
    let withQty = computeShoppingLines(
      [entry('Caldo', 4, 4, [line(3, null, null)]), entry('Pan', 4, 4, [line(3, 10, 'g')])],
      all,
      units,
    )
    assert.equal(withQty.length, 1)
    assert.equal(withQty[0]!.quantity, 10)
    assert.deepEqual(withQty[0]!.sourceRecipes, [
      { recipe: 'Pan', qty: '10 gramos' },
      { recipe: 'Caldo', qty: 'al gusto' },
    ])
  })

  it('sums “other” units only with themselves and rounds them up', () => {
    let lines = summary([
      entry('Salsa verde', 4, 2, [line(5, 1, 'manojo')]),
      entry('Arroz', 4, 4, [line(5, 0.5, 'manojo')]),
    ])
    assert.deepEqual(lines, ['Cilantro: 1 manojo'])
    assert.deepEqual(summary([entry('Salsa verde', 4, 6, [line(5, 1, 'manojo')])]), ['Cilantro: 2 manojo'])
  })

  it('rounds pieces up and keeps the preferred dimension', () => {
    // Huevo: unidad habitual pz; 100 g de huevo = 2 pz
    let lines = summary([entry('Hot cakes', 4, 6, [line(6, 1, null)]), entry('Pastel', 4, 4, [line(6, 100, 'g')])])
    assert.deepEqual(lines, ['Huevo: 4 pz'])
  })

  it('excludes optional ingredients unless asked', () => {
    let e = [entry('Tinga', 4, 4, [line(7, 100, 'ml', true), line(2, 2, null)])]
    assert.deepEqual(summary(e), ['Jitomate: 240 g'])
    assert.deepEqual(summary(e, { includeOptional: true }), ['Jitomate: 240 g', 'Crema: 100 ml'])
  })

  it('orders by store, then aisle, then name and records sources', () => {
    let lines = computeShoppingLines(
      [entry('Tinga', 4, 4, [line(4, 1, 'taza'), line(2, 3, null), line(1, 1, 'cda'), line(6, 2, null)])],
      all,
      units,
    )
    assert.deepEqual(lines.map((l) => l.label), ['Leche', 'Jitomate', 'Huevo', 'Harina de trigo'])
    assert.equal(lines[0]!.storeName, 'Costco')
    assert.deepEqual(lines[1]!.sourceRecipes, [{ recipe: 'Tinga', qty: '3' }])
    assert.equal(lines[1]!.mergeKey, '2|mass')
  })

  it('handles recipes with zero ingredients and a factor with odd servings', () => {
    assert.deepEqual(summary([entry('Agua', 4, 4, [])]), [])
    // 1/3 de taza de leche × (5/3) → 133.33 ml → 134 ml
    assert.deepEqual(summary([entry('Licuado', 3, 5, [line(4, 1 / 3, 'taza')])]), ['Leche: 134 ml'])
  })
})
