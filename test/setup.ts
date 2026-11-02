import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import pg from 'pg'

/** Crea (si hace falta) y migra la BD de pruebas. Se niega a correr contra otra BD. */
export async function globalSetup() {
  let url = new URL(process.env.DATABASE_URL ?? '')
  let dbName = url.pathname.slice(1)
  if (!dbName.endsWith('_test')) {
    throw new Error(`Las pruebas solo corren contra una BD *_test (DATABASE_URL apunta a "${dbName}").`)
  }

  let adminUrl = new URL(url)
  adminUrl.pathname = '/postgres'
  let admin = new pg.Client({ connectionString: adminUrl.toString() })
  await admin.connect()
  let exists = await admin.query('select 1 from pg_database where datname = $1', [dbName])
  if (exists.rowCount === 0) await admin.query(`create database "${dbName}"`)
  await admin.end()

  let pool = new pg.Pool({ connectionString: url.toString() })
  await migrate(drizzle(pool), { migrationsFolder: './drizzle' })
  await pool.end()
}
