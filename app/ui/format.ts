import { formatQuantity } from '../lib/quantity.ts'
import { routes } from '../routes.ts'

/** "2 tazas", "½ taza", "3", "al gusto". */
export function formatAmount(quantity: number | null, unitName: string | null, unitPlural: string | null): string {
  if (quantity === null) return unitName ? `${unitName} al gusto` : 'al gusto'
  let qty = formatQuantity(quantity)
  if (!unitName) return qty
  let singular = quantity <= 1
  return `${qty} ${singular ? unitName : (unitPlural ?? unitName)}`
}

/** 95 → "1 h 35 min" */
export function formatMinutes(minutes: number | null | undefined): string | null {
  if (minutes === null || minutes === undefined) return null
  if (minutes < 60) return `${minutes} min`
  let h = Math.floor(minutes / 60)
  let m = minutes % 60
  return m ? `${h} h ${m} min` : `${h} h`
}

export function photoUrl(key: string): string {
  return routes.photos.show.href({ key })
}
