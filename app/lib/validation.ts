import * as z from 'zod'

export type FieldErrors = Partial<Record<string, string>>

export interface ParseResult<T> {
  ok: boolean
  data?: T
  errors: FieldErrors
}

/** Valida un FormData con zod y regresa errores por campo (primer mensaje). */
export function parseForm<T extends z.ZodType>(schema: T, formData: FormData): ParseResult<z.output<T>> {
  let raw: Record<string, unknown> = {}
  for (let [key, value] of formData) {
    if (typeof value === 'string') raw[key] = value
  }

  let result = schema.safeParse(raw)
  if (result.success) return { ok: true, data: result.data, errors: {} }

  let errors: FieldErrors = {}
  for (let issue of result.error.issues) {
    let key = String(issue.path[0] ?? '_')
    errors[key] ??= issue.message
  }
  return { ok: false, errors }
}

export function readText(formData: FormData, name: string): string {
  let value = formData.get(name)
  return typeof value === 'string' ? value : ''
}

export const emailField = z.string().trim().toLowerCase().email('Escribe un correo válido.')
export const passwordField = z
  .string()
  .min(8, 'Mínimo 8 caracteres.')
  .max(128, 'Máximo 128 caracteres.')
export const nameField = z.string().trim().min(1, 'Escribe un nombre.').max(80, 'Máximo 80 caracteres.')
export const roleField = z.enum(['admin', 'member'], { message: 'Rol inválido.' })

// ─── Campos de dominio (sirven igual para formularios y para el MCP) ─────────

/**
 * Convención: `undefined` = "no se envió" (se conserva el valor actual en updates parciales del MCP);
 * `""` o `null` = "vaciar".
 */
export const blankToNull = (value: unknown) =>
  value === null || (typeof value === 'string' && value.trim() === '') ? null : value

/** Número decimal opcional; acepta "0,5" (coma decimal). Vacío → null. */
export function optionalDecimal(label: string, { min = 0, max = 1_000_000 } = {}) {
  return z.preprocess(
    (value) => {
      let v = blankToNull(value)
      return typeof v === 'string' ? Number(v.trim().replace(',', '.')) : v
    },
    z
      .number({ message: `${label}: escribe un número.` })
      .gt(min, `${label}: debe ser mayor que ${min}.`)
      .max(max, `${label}: es demasiado grande.`)
      .nullable()
      .optional(),
  )
}

/** id numérico opcional (selects con opción vacía). */
export const optionalId = z.preprocess(
  (value) => {
    let v = blankToNull(value)
    return typeof v === 'string' ? Number(v) : v
  },
  z.number().int().positive().nullable().optional(),
)

export const sortOrderField = z.preprocess(
  (value) => {
    let v = blankToNull(value)
    // Vacío = "automático" (al crear va al final; al editar no cambia).
    return v === null ? undefined : typeof v === 'string' ? Number(v) : v
  },
  z.number({ message: 'Orden: escribe un número.' }).int('Orden: número entero.').min(0).max(10_000).optional(),
)

export const optionalText = (max: number) =>
  z.preprocess(blankToNull, z.string().trim().max(max, `Máximo ${max} caracteres.`).nullable().optional())

/** Lista de textos: acepta un arreglo o un texto separado por comas / renglones. */
export const textList = z.preprocess(
  (value) => {
    if (value === null) return []
    if (typeof value === 'string') return value.split(/[,\n;]/)
    return value
  },
  z
    .array(z.string())
    .transform((items) => [...new Set(items.map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean))])
    .pipe(z.array(z.string().max(80, 'Cada alias: máximo 80 caracteres.')).max(30, 'Máximo 30 alias.'))
    .optional(),
)

/** Parsea un id de la URL. Regresa null si no es un entero positivo. */
export function parseId(value: string | undefined): number | null {
  if (!value || !/^\d+$/.test(value)) return null
  let n = Number(value)
  return Number.isSafeInteger(n) && n > 0 ? n : null
}
