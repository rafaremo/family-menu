import { auth as authMiddleware, Auth, requireAuth, type AuthScheme } from 'remix/middleware/auth'
import { redirect } from 'remix/response/redirect'
import type { Middleware } from 'remix/router'

import { routes } from '../routes.ts'
import type { ServiceActor } from '../services/audit.ts'
import { auth, type Role } from './auth.ts'

/** Identidad que ven los controladores en `context.auth.identity`. */
export interface Identity {
  id: string
  name: string
  email: string
  role: Role
}

export function toRole(value: string | null | undefined): Role {
  return value === 'admin' ? 'admin' : 'member'
}

/** Resuelve la sesión (cookie) de Better Auth para peticiones del dashboard. */
export const betterAuthSessionScheme: AuthScheme<Identity> = {
  name: 'session',
  async authenticate(context) {
    // Sin cookie no hay nada que consultar.
    if (!context.headers.get('Cookie')) return

    let result = await auth.api.getSession({ headers: context.headers })
    if (!result) return

    let { user } = result
    if (user.banned) {
      return { status: 'failure', code: 'invalid_credentials', message: 'Cuenta desactivada' }
    }

    return {
      status: 'success',
      identity: { id: user.id, name: user.name, email: user.email, role: toRole(user.role) },
    }
  },
}

/** Resuelve `context.auth` desde la cookie de sesión. Se usa por controlador (no en assets). */
export const sessionAuth = authMiddleware({ schemes: [betterAuthSessionScheme] })

/** Solo permite rutas relativas del mismo sitio (evita open redirects). */
export function safeRedirectTo(value: unknown, fallback = '/'): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) {
    return fallback
  }
  return value
}

/** Requiere sesión. Si no hay, redirige a /login?redirectTo=... */
export const requireUser = requireAuth<Identity>({
  onFailure(context) {
    let redirectTo = context.url.pathname + context.url.search
    let login = routes.login.index.href()
    let target = redirectTo === '/' ? login : `${login}?${new URLSearchParams({ redirectTo })}`
    return redirect(target, 303)
  },
})

/** Requiere rol admin. Debe ir después de `requireUser`. */
export function requireAdmin(): Middleware {
  return (context, next) => {
    let state = context.get(Auth)
    if (!state?.ok || (state.identity as Identity).role !== 'admin') {
      return new Response('No tienes permiso para ver esta página.', {
        status: 403,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      })
    }
    return next()
  }
}

/** Actor para los servicios de dominio cuando la acción viene del dashboard. */
export function webActor(identity: Identity): ServiceActor {
  return { userId: identity.id, via: 'web' }
}
