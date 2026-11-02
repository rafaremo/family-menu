import { APIError } from 'better-auth/api'

/** Mensajes en español para los códigos de error de Better Auth que mostramos al usuario. */
const MESSAGES: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: 'Correo o contraseña incorrectos.',
  INVALID_PASSWORD: 'La contraseña actual no es correcta.',
  PASSWORD_TOO_SHORT: 'La contraseña es demasiado corta (mínimo 8 caracteres).',
  PASSWORD_TOO_LONG: 'La contraseña es demasiado larga.',
  USER_ALREADY_EXISTS: 'Ya existe un miembro con ese correo.',
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: 'Ya existe un miembro con ese correo.',
  BANNED_USER: 'Tu cuenta está desactivada. Habla con el administrador.',
  YOU_CANNOT_BAN_YOURSELF: 'No puedes desactivarte a ti mismo.',
  YOU_CANNOT_REMOVE_YOURSELF: 'No puedes eliminarte a ti mismo.',
  INVALID_EMAIL: 'El correo no es válido.',
}

/** Error de negocio con mensaje para el usuario (en español). */
export class UserFacingError extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.name = 'UserFacingError'
    this.status = status
  }
}

export function toUserMessage(error: unknown, fallback = 'Ocurrió un error inesperado.'): string {
  if (error instanceof UserFacingError) return error.message
  if (error instanceof APIError) {
    let code = (error.body as { code?: string } | undefined)?.code
    if (code && MESSAGES[code]) return MESSAGES[code]
    if (error.status === 'FORBIDDEN' || error.status === 'UNAUTHORIZED') {
      return 'No tienes permiso para hacer esto.'
    }
  }
  console.error(error)
  return fallback
}

export function isExpected(error: unknown): boolean {
  return error instanceof UserFacingError || error instanceof APIError
}
