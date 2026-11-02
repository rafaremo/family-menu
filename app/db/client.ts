import { drizzle } from 'drizzle-orm/node-postgres'
import { sql } from 'drizzle-orm'
import pg from 'pg'

import * as schema from './schema/index.ts'

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://family:family@127.0.0.1:5434/family_menu'

export const pool = new pg.Pool({ connectionString, max: 10 })

export const db = drizzle(pool, { schema })

export type Db = typeof db

export async function pingDb(): Promise<boolean> {
  try {
    await db.execute(sql`select 1`)
    return true
  } catch {
    return false
  }
}
