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
