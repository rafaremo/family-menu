/**
 * Seed idempotente (desarrollo):
 *  - Crea el admin inicial desde ADMIN_EMAIL / ADMIN_PASSWORD / ADMIN_NAME si aún no hay ningún admin.
 *  - Carga pasillos, tiendas, unidades, etiquetas e ingredientes base (cada catálogo solo si está vacío).
 *
 * Uso: npm run db:seed   (en producción lo hace scripts/release.ts al arrancar)
 */
import { pool } from '../app/db/client.ts'
import { ADMIN_MESSAGES, describeSeed, ensureAdmin, seedCatalogs } from '../app/services/bootstrap.ts'

try {
  let admin = await ensureAdmin()
  let ok = admin === 'exists' || admin === 'created' || admin === 'promoted'
  console.log(`${ok ? '✓' : '⚠'} ${ADMIN_MESSAGES[admin]}`)
  if (!ok) process.exitCode = 1
  console.log(`✓ ${describeSeed(await seedCatalogs())}`)
} finally {
  await pool.end()
}
