/**
 * Conversión y normalización de unidades (funciones puras; la tabla `unit` se pasa como dato).
 *
 * Cada medida se lleva a la base de su dimensión: g (masa), ml (volumen), pz (piezas).
 * Entre dimensiones solo se convierte si el ingrediente sabe cómo:
 *   volumen ↔ masa con `densityGPerMl`, piezas ↔ masa con `gramsPerPiece`.
 * Las unidades "otra" (lata, manojo, diente…) no convierten: solo se suman consigo mismas.
 */

export type Dimension = 'mass' | 'volume' | 'count' | 'other'
export type BaseDimension = Exclude<Dimension, 'other'>

export interface UnitDef {
  code: string
  name: string
  plural: string
  dimension: Dimension
  toBase: number | null
}

export interface ConversionFactors {
  densityGPerMl: number | null
  gramsPerPiece: number | null
}

/** Medida normalizada: `group` es la dimensión base o `u:<código>` para unidades sin conversión. */
export interface Measure {
  group: BaseDimension | `u:${string}`
  amount: number
}

export const BASE_UNIT: Record<BaseDimension, string> = { mass: 'g', volume: 'ml', count: 'pz' }

export type UnitTable = Map<string, UnitDef>

export function unitTable(units: UnitDef[]): UnitTable {
  return new Map(units.map((u) => [u.code, u]))
}

export function isBaseDimension(group: string): group is BaseDimension {
  return group === 'mass' || group === 'volume' || group === 'count'
}

/**
 * Normaliza una cantidad. Sin unidad = piezas ("3 jitomates"). Sin cantidad = null ("al gusto").
 */
export function toMeasure(quantity: number | null, unitCode: string | null, units: UnitTable): Measure | null {
  if (quantity === null) return null
  if (!unitCode) return { group: 'count', amount: quantity }
  let unit = units.get(unitCode)
  if (!unit) return { group: `u:${unitCode}`, amount: quantity }
  if (unit.dimension === 'other' || unit.toBase === null) return { group: `u:${unit.code}`, amount: quantity }
  return { group: unit.dimension, amount: quantity * unit.toBase }
}

/** Convierte una cantidad base entre dimensiones. Regresa null si el ingrediente no tiene el factor. */
export function convertBase(amount: number, from: BaseDimension, to: BaseDimension, f: ConversionFactors): number | null {
  if (from === to) return amount
  let grams: number | null
  if (from === 'mass') grams = amount
  else if (from === 'volume') grams = f.densityGPerMl ? amount * f.densityGPerMl : null
  else grams = f.gramsPerPiece ? amount * f.gramsPerPiece : null
  if (grams === null) return null

  if (to === 'mass') return grams
  if (to === 'volume') return f.densityGPerMl ? grams / f.densityGPerMl : null
  return f.gramsPerPiece ? grams / f.gramsPerPiece : null
}

/** Quita ruido de punto flotante (0.1 + 0.2) antes de redondear hacia arriba. */
function clean(n: number): number {
  return Math.round(n * 1e6) / 1e6
}

function ceilTo(n: number, step: number): number {
  return clean(Math.ceil(clean(n) / step) * step)
}

/**
 * Lleva una cantidad base a algo comprable:
 *   1500 g → 1.5 kg · 333.3 g → 334 g · 750 ml → 750 ml · 2.33 pz → 3 pz · 1.5 latas → 2 latas
 */
export function humanize(measure: Measure): { quantity: number; unitCode: string } {
  let { group, amount } = measure
  if (group === 'mass') return amount >= 1000 ? { quantity: ceilTo(amount / 1000, 0.01), unitCode: 'kg' } : { quantity: ceilTo(amount, 1), unitCode: 'g' }
  if (group === 'volume') return amount >= 1000 ? { quantity: ceilTo(amount / 1000, 0.01), unitCode: 'l' } : { quantity: ceilTo(amount, 1), unitCode: 'ml' }
  if (group === 'count') return { quantity: ceilTo(amount, 1), unitCode: 'pz' }
  // Unidades de empaque/manojo: se compran enteras.
  return { quantity: ceilTo(amount, 1), unitCode: group.slice(2) }
}
