import { sql } from 'drizzle-orm'

import { auth } from '../app/auth/auth.ts'
import { db } from '../app/db/client.ts'
import { router } from '../app/router.ts'

export const ORIGIN = new URL(process.env.BETTER_AUTH_URL ?? 'http://localhost:3010').origin

/** Borra todos los datos (no el esquema). */
export async function resetDb() {
  await db.execute(sql`truncate table "audit_log", "apikey", "verification", "session", "account", "user" restart identity cascade`)
}

export async function createUser(input: { email: string; password: string; name: string; role: 'admin' | 'member' }) {
  let result = await auth.api.createUser({ body: input })
  return result.user
}

interface RequestOptions {
  method?: string
  form?: Record<string, string>
  cookie?: string
  headers?: Record<string, string>
}

/** Petición al router como si viniera de un navegador del mismo sitio. */
export function request(path: string, options: RequestOptions = {}) {
  let headers = new Headers(options.headers)
  if (options.cookie) headers.set('Cookie', options.cookie)
  let body: URLSearchParams | undefined
  if (options.form) {
    body = new URLSearchParams(options.form)
    headers.set('Content-Type', 'application/x-www-form-urlencoded')
    if (!headers.has('Sec-Fetch-Site')) headers.set('Sec-Fetch-Site', 'same-origin')
  }
  return router.fetch(
    new Request(new URL(path, ORIGIN), {
      method: options.method ?? (options.form ? 'POST' : 'GET'),
      headers,
      body,
      redirect: 'manual',
    }),
  )
}

/** Convierte los Set-Cookie de una respuesta en un header Cookie. */
export function cookieFrom(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((c) => c.split(';', 1)[0])
    .filter((pair) => !pair.endsWith('='))
    .join('; ')
}

export async function login(email: string, password: string): Promise<string> {
  let response = await request('/login', { form: { email, password } })
  if (response.status !== 303) throw new Error(`login falló (${response.status}) para ${email}`)
  return cookieFrom(response)
}
