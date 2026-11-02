/**
 * Paso de "release" (corre en el contenedor antes de levantar el servidor, ver Dockerfile):
 *  1. Aplica migraciones pendientes (drizzle/).
 *  2. Carga catálogos iniciales si están vacíos.
 *  3. Crea el primer admin desde ADMIN_EMAIL / ADMIN_PASSWORD si no hay ninguno.
 * Todo es idempotente. Si la BD no responde, reintenta unos segundos (la BD puede arrancar después).
 */
import { pingDb, pool } from '../app/db/client.ts'
import { appStorageConfig } from '../app/lib/storage.ts'
import { ADMIN_MESSAGES, describeSeed, ensureAdmin, runMigrations, seedCatalogs } from '../app/services/bootstrap.ts'

const log = (msg: string) => console.log(`[release] ${msg}`)

async function waitForDb(attempts = 30) {
  for (let i = 1; i <= attempts; i++) {
    if (await pingDb()) return
    log(`esperando la base de datos (${i}/${attempts})…`)
    await new Promise((r) => setTimeout(r, 2000))
  }
  throw new Error('La base de datos no respondió. Revisa DATABASE_URL.')
}

function checkEnv() {
  let problems: string[] = []
  if (!process.env.DATABASE_URL) problems.push('falta DATABASE_URL')
  let secret = process.env.BETTER_AUTH_SECRET ?? ''
  if (secret.length < 32) problems.push('BETTER_AUTH_SECRET debe tener al menos 32 caracteres (openssl rand -base64 32)')
  if (!/^https:\/\//.test(process.env.BETTER_AUTH_URL ?? '')) log('⚠ BETTER_AUTH_URL no es https; las cookies no serán "secure".')
  if (problems.length) throw new Error(`Configuración incompleta: ${problems.join('; ')}.`)
  // Falla temprano si el almacenamiento (R2) está a medio configurar.
  log(`archivos: ${appStorageConfig().description}`)
}

try {
  checkEnv()
  await waitForDb()
  await runMigrations()
  log('✓ migraciones al día')
  log(`✓ ${describeSeed(await seedCatalogs())}`)
  let admin = await ensureAdmin()
  log(`${admin === 'missing-env' || admin === 'weak-password' ? '⚠' : '✓'} ${ADMIN_MESSAGES[admin]}`)
} catch (error) {
  console.error(`[release] ✗ ${error instanceof Error ? error.message : error}`)
  process.exitCode = 1
} finally {
  await pool.end()
}
