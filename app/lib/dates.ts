/**
 * Fechas de calendario (YYYY-MM-DD) sin zonas horarias: se manejan como UTC a medianoche.
 * "Hoy" se calcula en la zona de la familia (APP_TIMEZONE, default America/Mexico_City).
 */

export const APP_TIMEZONE = process.env.APP_TIMEZONE || 'America/Mexico_City'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false
  let d = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value
}

function toDate(iso: string): Date {
  if (!isIsoDate(iso)) throw new Error(`Fecha inválida: ${iso}`)
  return new Date(`${iso}T00:00:00Z`)
}

function toIso(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export function todayIso(now = new Date(), timeZone = APP_TIMEZONE): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

export function addDays(iso: string, days: number): string {
  let d = toDate(iso)
  d.setUTCDate(d.getUTCDate() + days)
  return toIso(d)
}

/** Lunes de la semana de `iso`. */
export function mondayOf(iso: string): string {
  let d = toDate(iso)
  let offset = (d.getUTCDay() + 6) % 7
  return addDays(iso, -offset)
}

export function weekDays(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
}

/** Días entre dos fechas (b - a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((toDate(b).getTime() - toDate(a).getTime()) / 86_400_000)
}

const dayFmt = new Intl.DateTimeFormat('es-MX', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' })
const weekdayFmt = new Intl.DateTimeFormat('es-MX', { weekday: 'long', timeZone: 'UTC' })
const shortFmt = new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const yearFmt = new Intl.DateTimeFormat('es-MX', { year: 'numeric', timeZone: 'UTC' })

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** "Lunes 3 nov." */
export function formatDay(iso: string): string {
  return capitalize(dayFmt.format(toDate(iso)).replace(',', ''))
}

/** "Lunes" */
export function formatWeekday(iso: string): string {
  return capitalize(weekdayFmt.format(toDate(iso)))
}

/** "3 – 9 nov. 2026" */
export function formatWeek(weekStart: string): string {
  let end = addDays(weekStart, 6)
  return `${shortFmt.format(toDate(weekStart))} – ${shortFmt.format(toDate(end))} ${yearFmt.format(toDate(end))}`
}

/** Nombre por defecto de un menú: "Semana del 3 nov." */
export function defaultMenuName(weekStart: string): string {
  return `Semana del ${shortFmt.format(toDate(weekStart))}`
}
