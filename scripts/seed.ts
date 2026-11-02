/**
 * Seed idempotente.
 *  - Crea el admin inicial desde ADMIN_EMAIL / ADMIN_PASSWORD / ADMIN_NAME si aún no hay ningún admin.
 *  - Carga pasillos, tiendas, unidades, etiquetas e ingredientes base (cada catálogo solo si está vacío).
 *
 * Uso: npm run db:seed
 */
import { eq } from 'drizzle-orm'

import { auth } from '../app/auth/auth.ts'
import { db, pool } from '../app/db/client.ts'
import { user } from '../app/db/schema/index.ts'
import { audit } from '../app/services/audit.ts'
import { seedCatalogs } from '../app/services/catalog-seed.ts'

async function seedAdmin() {
  let [existingAdmin] = await db.select({ id: user.id }).from(user).where(eq(user.role, 'admin')).limit(1)
  if (existingAdmin) {
    console.log('✓ Ya existe un admin; no se crea otro.')
    return
  }

  let email = process.env.ADMIN_EMAIL?.trim().toLowerCase()
  let password = process.env.ADMIN_PASSWORD
  let name = process.env.ADMIN_NAME?.trim() || 'Admin'

  if (!email || !password) {
    console.warn('⚠ No hay admin y faltan ADMIN_EMAIL / ADMIN_PASSWORD en .env. Agrégalos y vuelve a correr el seed.')
    process.exitCode = 1
    return
  }
  if (password.length < 8) {
    console.error('✗ ADMIN_PASSWORD debe tener al menos 8 caracteres.')
    process.exitCode = 1
    return
  }

  let [existingUser] = await db.select({ id: user.id }).from(user).where(eq(user.email, email)).limit(1)
  if (existingUser) {
    await db.update(user).set({ role: 'admin' }).where(eq(user.id, existingUser.id))
    await audit({ userId: null, via: 'system', action: 'set_role', entity: 'member', entityId: existingUser.id, details: { role: 'admin' } })
    console.log(`✓ ${email} ya existía; ahora es admin.`)
    return
  }

  let result = await auth.api.createUser({ body: { email, password, name, role: 'admin' } })
  await audit({ userId: null, via: 'system', action: 'create', entity: 'member', entityId: result.user.id, details: { email, role: 'admin' } })
  console.log(`✓ Admin creado: ${email}`)
}

async function seedCatalogData() {
  let report = await seedCatalogs()
  let parts = Object.entries(report)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${n} ${CATALOG_LABELS[k as keyof typeof report]}`)
  console.log(parts.length ? `✓ Catálogos cargados: ${parts.join(', ')}.` : '✓ Catálogos ya tenían datos; no se tocaron.')
}

const CATALOG_LABELS = {
  aisles: 'pasillos',
  stores: 'tiendas',
  units: 'unidades',
  tags: 'etiquetas',
  ingredients: 'ingredientes',
}

try {
  await seedAdmin()
  await seedCatalogData()
} finally {
  await pool.end()
}
