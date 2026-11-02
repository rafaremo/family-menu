import type { SourceRecipe } from '../db/schema/index.ts'
import { formatQuantity } from '../lib/quantity.ts'
import {
  convertBase,
  humanize,
  isBaseDimension,
  toMeasure,
  type BaseDimension,
  type Measure,
  type UnitTable,
} from './units.ts'

/**
 * Motor de la lista del súper (puro: sin BD, fácil de probar).
 *
 * 1. Escala cada ingrediente: factor = porciones del platillo / porciones de la receta.
 * 2. Excluye opcionales (salvo `includeOptional`).
 * 3. Normaliza a g / ml / pz; las unidades "otra" se quedan en su unidad.
 * 4. Por ingrediente, convierte a una sola dimensión cuando hay factor (densidad, g por pieza);
 *    la dimensión destino es la de su unidad habitual o la que más aparece.
 * 5. Suma; lo que no se pudo convertir queda como renglón aparte.
 *    "Al gusto" solo genera renglón (sin cantidad) si no hay otro renglón del mismo ingrediente.
 * 6. Humaniza (1500 g → 1.5 kg, 2.3 pz → 3 pz).
 * 7. Ordena por tienda, pasillo y nombre; guarda de qué receta sale cada cosa.
 */

export interface EngineIngredient {
  id: number
  name: string
  aisleId: number | null
  aisleName: string | null
  aisleOrder: number | null
  storeId: number | null
  storeName: string | null
  storeOrder: number | null
  defaultUnit: string | null
  densityGPerMl: number | null
  gramsPerPiece: number | null
}

export interface EngineLine {
  ingredientId: number
  quantity: number | null
  unitCode: string | null
  optional: boolean
}

export interface EngineEntry {
  recipeTitle: string
  recipeServings: number
  servings: number
  lines: EngineLine[]
}

export interface ShoppingLine {
  /** Estable entre regeneraciones: `<ingrediente>|<dimensión o u:unidad o gusto>`. */
  mergeKey: string
  ingredientId: number
  label: string
  quantity: number | null
  unitCode: string | null
  aisleId: number | null
  aisleName: string | null
  storeId: number | null
  storeName: string | null
  sourceRecipes: SourceRecipe[]
  /** Para ordenar. */
  storeOrder: number | null
  aisleOrder: number | null
}

export interface EngineOptions {
  includeOptional?: boolean
}

interface Contribution {
  recipe: string
  measure: Measure | null
  text: string
}

function describe(quantity: number | null, unitCode: string | null, units: UnitTable): string {
  if (quantity === null) return 'al gusto'
  let qty = formatQuantity(quantity)
  if (!unitCode) return qty
  let unit = units.get(unitCode)
  if (!unit) return `${qty} ${unitCode}`
  return `${qty} ${quantity <= 1 ? unit.name : unit.plural}`
}

function targetDimension(ingredient: EngineIngredient, contributions: Contribution[], units: UnitTable): BaseDimension | null {
  let preferred = ingredient.defaultUnit ? units.get(ingredient.defaultUnit) : undefined
  if (preferred && preferred.dimension !== 'other' && preferred.toBase !== null) return preferred.dimension
  let counts = new Map<BaseDimension, number>()
  for (let c of contributions) {
    if (c.measure && isBaseDimension(c.measure.group)) counts.set(c.measure.group, (counts.get(c.measure.group) ?? 0) + 1)
  }
  let best: BaseDimension | null = null
  for (let [dim, n] of counts) if (!best || n > counts.get(best)!) best = dim
  return best
}

function compareNullable(a: number | null, b: number | null): number {
  if (a === b) return 0
  if (a === null) return 1
  if (b === null) return -1
  return a - b
}

export function computeShoppingLines(
  entries: EngineEntry[],
  ingredients: Map<number, EngineIngredient>,
  units: UnitTable,
  options: EngineOptions = {},
): ShoppingLine[] {
  // 1–3: contribuciones escaladas y normalizadas, agrupadas por ingrediente.
  let byIngredient = new Map<number, Contribution[]>()
  for (let entry of entries) {
    let factor = entry.recipeServings > 0 ? entry.servings / entry.recipeServings : 1
    for (let line of entry.lines) {
      if (line.optional && !options.includeOptional) continue
      let quantity = line.quantity === null ? null : line.quantity * factor
      let list = byIngredient.get(line.ingredientId) ?? []
      list.push({
        recipe: entry.recipeTitle,
        measure: toMeasure(quantity, line.unitCode, units),
        text: describe(quantity === null ? null : Math.round(quantity * 1000) / 1000, line.unitCode, units),
      })
      byIngredient.set(line.ingredientId, list)
    }
  }

  let result: ShoppingLine[] = []
  for (let [ingredientId, contributions] of byIngredient) {
    let ingredient = ingredients.get(ingredientId)
    if (!ingredient) continue
    let target = targetDimension(ingredient, contributions, units)

    // 4–5: convertir y sumar.
    let groups = new Map<string, { amount: number; sources: SourceRecipe[] }>()
    let toTaste: SourceRecipe[] = []
    for (let c of contributions) {
      if (!c.measure) {
        toTaste.push({ recipe: c.recipe, qty: c.text })
        continue
      }
      let group: string = c.measure.group
      let amount = c.measure.amount
      if (target && isBaseDimension(group) && group !== target) {
        let converted = convertBase(amount, group, target, ingredient)
        if (converted !== null) {
          group = target
          amount = converted
        }
      }
      let g = groups.get(group) ?? { amount: 0, sources: [] }
      g.amount += amount
      g.sources.push({ recipe: c.recipe, qty: c.text })
      groups.set(group, g)
    }

    let base = {
      ingredientId,
      label: ingredient.name,
      aisleId: ingredient.aisleId,
      aisleName: ingredient.aisleName,
      storeId: ingredient.storeId,
      storeName: ingredient.storeName,
      storeOrder: ingredient.storeOrder,
      aisleOrder: ingredient.aisleOrder,
    }

    if (!groups.size) {
      result.push({ ...base, mergeKey: `${ingredientId}|gusto`, quantity: null, unitCode: null, sourceRecipes: toTaste })
      continue
    }
    // Renglón principal primero: la dimensión destino, luego otras dimensiones base, luego empaques.
    let rank = (group: string) => (group === target ? 0 : isBaseDimension(group) ? 1 : 2)
    let ordered = [...groups.entries()].sort(([a], [b]) => rank(a) - rank(b))
    ordered.forEach(([group, g], index) => {
      let { quantity, unitCode } = humanize({ group: group as Measure['group'], amount: g.amount })
      result.push({
        ...base,
        mergeKey: `${ingredientId}|${group}`,
        quantity,
        unitCode,
        // Lo "al gusto" se menciona en el primer renglón del ingrediente.
        sourceRecipes: index === 0 ? [...g.sources, ...toTaste] : g.sources,
      })
    })
  }

  // 7: tienda → pasillo → nombre.
  return result.sort(
    (a, b) =>
      compareNullable(a.storeOrder, b.storeOrder) ||
      compareNullable(a.aisleOrder, b.aisleOrder) ||
      a.label.localeCompare(b.label, 'es'),
  ) // sort es estable: los renglones de un mismo ingrediente conservan su orden.
}
