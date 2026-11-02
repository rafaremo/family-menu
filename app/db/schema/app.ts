import { sql } from 'drizzle-orm'
import {
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

import { user } from './auth.ts'

export const auditVia = pgEnum('audit_via', ['web', 'mcp', 'system'])

/** Bitácora de cambios hechos desde el dashboard o el MCP. */
export const auditLog = pgTable(
  'audit_log',
  {
    id: serial('id').primaryKey(),
    userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
    via: auditVia('via').notNull(),
    action: text('action').notNull(),
    entity: text('entity').notNull(),
    entityId: text('entity_id'),
    details: jsonb('details'),
    at: timestamp('at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('audit_log_at_idx').on(table.at), index('audit_log_entity_idx').on(table.entity, table.entityId)],
)

// ─── Catálogos ────────────────────────────────────────────────────────────────

/** Pasillo o categoría del súper ("Frutas y verduras", "Lácteos y huevo"…). */
export const aisle = pgTable(
  'aisle',
  {
    id: serial('id').primaryKey(),
    name: text('name').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (table) => [uniqueIndex('aisle_name_key').on(sql`lower(${table.name})`)],
)

/** Tienda donde se compra ("Costco", "City Market"…). */
export const store = pgTable(
  'store',
  {
    id: serial('id').primaryKey(),
    name: text('name').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (table) => [uniqueIndex('store_name_key').on(sql`lower(${table.name})`)],
)

export const unitDimension = pgEnum('unit_dimension', ['mass', 'volume', 'count', 'other'])

/**
 * Unidad de medida. `toBase` convierte a la unidad base de su dimensión
 * (g para masa, ml para volumen, pz para conteo). Las unidades `other` (lata, manojo…) no convierten.
 */
export const unit = pgTable('unit', {
  code: text('code').primaryKey(),
  name: text('name').notNull(),
  plural: text('plural').notNull(),
  dimension: unitDimension('dimension').notNull(),
  toBase: numeric('to_base', { mode: 'number' }),
  sortOrder: integer('sort_order').notNull().default(0),
})

export const tagKind = pgEnum('tag_kind', ['category', 'diet', 'occasion', 'free'])

export const tag = pgTable(
  'tag',
  {
    id: serial('id').primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    kind: tagKind('kind').notNull().default('free'),
  },
  (table) => [uniqueIndex('tag_slug_key').on(table.slug)],
)

// ─── Ingredientes ─────────────────────────────────────────────────────────────

export const ingredient = pgTable(
  'ingredient',
  {
    id: serial('id').primaryKey(),
    name: text('name').notNull(),
    /** Nombre normalizado (minúsculas, sin acentos): evita duplicados como "Limón" / "limon". */
    nameKey: text('name_key').notNull(),
    slug: text('slug').notNull(),
    aliases: text('aliases').array().notNull().default(sql`'{}'::text[]`),
    /** Nombre + alias normalizados. Sirve para empatar y para detectar choques entre ingredientes. */
    keys: text('keys').array().notNull().default(sql`'{}'::text[]`),
    /** Texto de búsqueda (claves unidas) con índice trigram para búsqueda difusa. */
    searchText: text('search_text').notNull().default(''),
    aisleId: integer('aisle_id').references(() => aisle.id, { onDelete: 'set null' }),
    defaultStoreId: integer('default_store_id').references(() => store.id, { onDelete: 'set null' }),
    defaultUnit: text('default_unit').references(() => unit.code, { onDelete: 'restrict', onUpdate: 'cascade' }),
    densityGPerMl: numeric('density_g_per_ml', { mode: 'number' }),
    gramsPerPiece: numeric('grams_per_piece', { mode: 'number' }),
    notes: text('notes'),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('ingredient_name_key_key').on(table.nameKey),
    uniqueIndex('ingredient_slug_key').on(table.slug),
    index('ingredient_keys_idx').using('gin', table.keys),
    index('ingredient_search_trgm_idx').using('gin', sql`${table.searchText} gin_trgm_ops`),
    index('ingredient_aisle_idx').on(table.aisleId),
  ],
)
