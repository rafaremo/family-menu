import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { eq } from 'drizzle-orm'

import { auth } from '../auth/auth.ts'
import { db, pool } from '../db/client.ts'
import { user } from '../db/schema/index.ts'
import { audit } from './audit.ts'
import { seedCatalogs, type SeedReport } from './catalog-seed.ts'

/**
 * Tareas de arranque idempotentes (desarrollo, seed y "release" en producción):
 * migraciones, catálogos iniciales y el primer admin.
 */

export async function runMigrations(): Promise<void> {
  await migrate(drizzle(pool), { migrationsFolder: './drizzle' })
}

export type AdminResult = 'exists' | 'created' | 'promoted' | 'missing-env' | 'weak-password'

/** Crea el admin inicial desde ADMIN_EMAIL / ADMIN_PASSWORD / ADMIN_NAME si aún no hay ningún admin. */
export async function ensureAdmin(env: Record<string, string | undefined> = process.env): Promise<AdminResult> {
  let [existingAdmin] = await db.select({ id: user.id }).from(user).where(eq(user.role, 'admin')).limit(1)
  if (existingAdmin) return 'exists'

  let email = env.ADMIN_EMAIL?.trim().toLowerCase()
  let password = env.ADMIN_PASSWORD
  let name = env.ADMIN_NAME?.trim() || 'Admin'
  if (!email || !password) return 'missing-env'
  if (password.length < 8) return 'weak-password'

  let [existingUser] = await db.select({ id: user.id }).from(user).where(eq(user.email, email)).limit(1)
  if (existingUser) {
    await db.update(user).set({ role: 'admin' }).where(eq(user.id, existingUser.id))
    await audit({ userId: null, via: 'system', action: 'set_role', entity: 'member', entityId: existingUser.id, details: { role: 'admin' } })
    return 'promoted'
  }

  let result = await auth.api.createUser({ body: { email, password, name, role: 'admin' } })
  await audit({ userId: null, via: 'system', action: 'create', entity: 'member', entityId: result.user.id, details: { email, role: 'admin' } })
  return 'created'
}

const CATALOG_LABELS: Record<keyof SeedReport, string> = {
  aisles: 'pasillos',
  stores: 'tiendas',
  units: 'unidades',
  tags: 'etiquetas',
  ingredients: 'ingredientes',
}

export function describeSeed(report: SeedReport): string {
  let parts = Object.entries(report)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${n} ${CATALOG_LABELS[k as keyof SeedReport]}`)
  return parts.length ? `Catálogos cargados: ${parts.join(', ')}.` : 'Catálogos ya tenían datos; no se tocaron.'
}

export const ADMIN_MESSAGES: Record<AdminResult, string> = {
  exists: 'Ya existe un admin; no se crea otro.',
  created: 'Admin creado desde ADMIN_EMAIL.',
  promoted: 'El usuario de ADMIN_EMAIL ya existía; ahora es admin.',
  'missing-env': 'No hay admin y faltan ADMIN_EMAIL / ADMIN_PASSWORD. Agrégalos y vuelve a arrancar.',
  'weak-password': 'ADMIN_PASSWORD debe tener al menos 8 caracteres.',
}

export { seedCatalogs }
