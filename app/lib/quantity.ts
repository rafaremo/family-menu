/**
 * Cantidades de recetas: "1/2", "1 ½", "0,5", "2" → número. Vacío / "al gusto" → null.
 * El parser completo de renglones en español (fase 6) reutiliza esto.
 */

const UNICODE_FRACTIONS: Record<string, number> = {
  '½': 1 / 2,
  '⅓': 1 / 3,
  '⅔': 2 / 3,
  '¼': 1 / 4,
  '¾': 3 / 4,
  '⅕': 1 / 5,
  '⅛': 1 / 8,
  '⅜': 3 / 8,
  '⅝': 5 / 8,
  '⅞': 7 / 8,
}

const TO_TASTE = /^(al gusto|c\/?n|cantidad necesaria|lo necesario|una pizca)$/i

export class QuantityError extends Error {}

/** Regresa el número, `null` si no hay cantidad ("al gusto"), o lanza `QuantityError`. */
export function parseQuantity(input: unknown): number | null {
  if (input === null || input === undefined) return null
  if (typeof input === 'number') {
    if (!Number.isFinite(input) || input <= 0) throw new QuantityError('La cantidad debe ser mayor que 0.')
    return input
  }
  if (typeof input !== 'string') throw new QuantityError('Cantidad no válida.')

  let text = input.trim().toLowerCase()
  if (!text || TO_TASTE.test(text)) return null

  // Separa fracciones unicode pegadas al entero: "1½" → "1 ½"
  text = text.replace(/(\d)([½⅓⅔¼¾⅕⅛⅜⅝⅞])/g, '$1 $2').replace(/\s+/g, ' ')

  let total = 0
  let parts = text.split(' ')
  if (parts.length > 2) throw new QuantityError(`Cantidad no válida: "${input}".`)
  for (let part of parts) {
    let value: number
    if (part in UNICODE_FRACTIONS) value = UNICODE_FRACTIONS[part]!
    else if (/^\d+\/\d+$/.test(part)) {
      let [n, d] = part.split('/').map(Number) as [number, number]
      if (d === 0) throw new QuantityError(`Cantidad no válida: "${input}".`)
      value = n / d
    } else if (/^\d+([.,]\d+)?$/.test(part)) value = Number(part.replace(',', '.'))
    else throw new QuantityError(`Cantidad no válida: "${input}". Usa números como 2, 0.5, 1/2 o 1 ½.`)
    total += value
  }
  if (total <= 0) throw new QuantityError('La cantidad debe ser mayor que 0.')
  if (total > 100_000) throw new QuantityError('La cantidad es demasiado grande.')
  return Math.round(total * 10_000) / 10_000
}

const NICE_FRACTIONS: [number, string][] = [
  [1 / 8, '⅛'],
  [1 / 4, '¼'],
  [1 / 3, '⅓'],
  [1 / 2, '½'],
  [2 / 3, '⅔'],
  [3 / 4, '¾'],
]

/**
 * Formatea para cocinar: 1.5 → "1 ½", 0.333 → "⅓", 2.4 → "2.4", 333.33 → "333".
 * Con `plain: true` usa fracciones ASCII ("1 1/2") para inputs editables.
 */
export function formatQuantity(value: number | null, options: { plain?: boolean } = {}): string {
  if (value === null) return ''
  if (value >= 20) return String(Math.round(value))
  let whole = Math.floor(value)
  let frac = value - whole
  if (frac < 0.02) return String(whole)
  if (frac > 0.98) return String(whole + 1)
  let nice = NICE_FRACTIONS.find(([f]) => Math.abs(frac - f) < 0.02)
  if (nice) {
    let symbol = options.plain ? asciiFraction(nice[0]) : nice[1]
    return whole ? `${whole} ${symbol}` : symbol
  }
  return String(Math.round(value * 100) / 100)
}

function asciiFraction(f: number): string {
  let map: Record<string, string> = { '0.125': '1/8', '0.25': '1/4', '0.5': '1/2', '0.75': '3/4' }
  let key = String(f)
  if (map[key]) return map[key]!
  return Math.abs(f - 1 / 3) < 0.01 ? '1/3' : '2/3'
}
