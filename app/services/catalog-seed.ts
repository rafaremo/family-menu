import { count } from 'drizzle-orm'
import type { PgTable } from 'drizzle-orm/pg-core'

import { db } from '../db/client.ts'
import { aisle, ingredient, store, tag, unit } from '../db/schema/index.ts'
import { SEED_AISLES, SEED_INGREDIENTS, SEED_STORES, SEED_TAGS, SEED_UNITS } from '../db/seed-data.ts'
import { slugify } from '../lib/slug.ts'
import type { ServiceActor } from './audit.ts'
import { createIngredient } from './ingredients.ts'

async function isEmpty(table: PgTable): Promise<boolean> {
  let [row] = await db.select({ n: count() }).from(table)
  return (row?.n ?? 0) === 0
}

export interface SeedReport {
  aisles: number
  stores: number
  units: number
  tags: number
  ingredients: number
}

/**
 * Carga los catálogos iniciales. Cada catálogo se llena solo si está vacío
 * (idempotente y no revive lo que la familia borró o renombró).
 */
export async function seedCatalogs(): Promise<SeedReport> {
  let report: SeedReport = { aisles: 0, stores: 0, units: 0, tags: 0, ingredients: 0 }
  let actor: ServiceActor = { userId: null, via: 'system' }

  if (await isEmpty(aisle)) {
    await db.insert(aisle).values(SEED_AISLES.map((name, i) => ({ name, sortOrder: (i + 1) * 10 })))
    report.aisles = SEED_AISLES.length
  }
  if (await isEmpty(store)) {
    await db.insert(store).values(SEED_STORES.map((name, i) => ({ name, sortOrder: (i + 1) * 10 })))
    report.stores = SEED_STORES.length
  }
  if (await isEmpty(unit)) {
    await db.insert(unit).values(
      SEED_UNITS.map(([code, name, plural, dimension, toBase], i) => ({
        code,
        name,
        plural,
        dimension,
        toBase,
        sortOrder: (i + 1) * 10,
      })),
    )
    report.units = SEED_UNITS.length
  }
  if (await isEmpty(tag)) {
    await db.insert(tag).values(SEED_TAGS.map(([name, kind]) => ({ name, kind, slug: slugify(name) })))
    report.tags = SEED_TAGS.length
  }

  if (await isEmpty(ingredient)) {
    let aisleIds = new Map((await db.select().from(aisle)).map((a) => [a.name, a.id]))
    let unitCodes = new Set((await db.select({ code: unit.code }).from(unit)).map((u) => u.code))
    for (let item of SEED_INGREDIENTS) {
      await createIngredient(actor, {
        name: item.name,
        aliases: item.aliases ?? [],
        aisleId: aisleIds.get(item.aisle) ?? null,
        defaultStoreId: null,
        defaultUnit: unitCodes.has(item.unit) ? item.unit : null,
        densityGPerMl: item.density ?? null,
        gramsPerPiece: item.gpp ?? null,
        notes: null,
      })
      report.ingredients++
    }
  }

  return report
}
