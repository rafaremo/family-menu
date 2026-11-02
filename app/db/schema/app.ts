import { sql } from 'drizzle-orm'
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
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

// ─── Recetas ──────────────────────────────────────────────────────────────────

export interface RecipeStep {
  text: string
}

export const recipe = pgTable(
  'recipe',
  {
    id: serial('id').primaryKey(),
    title: text('title').notNull(),
    slug: text('slug').notNull(),
    description: text('description'),
    servings: integer('servings').notNull().default(4),
    prepMinutes: integer('prep_minutes'),
    cookMinutes: integer('cook_minutes'),
    steps: jsonb('steps').$type<RecipeStep[]>().notNull().default([]),
    notes: text('notes'),
    sourceUrl: text('source_url'),
    familyCredit: text('family_credit'),
    /** Foto de portada (FK lógica a recipe_photo; se limpia en el servicio). */
    coverPhotoId: integer('cover_photo_id'),
    /** Texto normalizado (sin acentos) de título, descripción, crédito, ingredientes y etiquetas. */
    searchText: text('search_text').notNull().default(''),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    updatedBy: text('updated_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('recipe_slug_key').on(table.slug),
    index('recipe_fts_idx').using('gin', sql`to_tsvector('spanish'::regconfig, ${table.searchText})`),
    index('recipe_search_trgm_idx').using('gin', sql`${table.searchText} gin_trgm_ops`),
  ],
)

export const recipeIngredient = pgTable(
  'recipe_ingredient',
  {
    id: serial('id').primaryKey(),
    recipeId: integer('recipe_id')
      .notNull()
      .references(() => recipe.id, { onDelete: 'cascade' }),
    ingredientId: integer('ingredient_id')
      .notNull()
      .references(() => ingredient.id, { onDelete: 'restrict' }),
    /** null = "al gusto". */
    quantity: numeric('quantity', { mode: 'number' }),
    unitCode: text('unit_code').references(() => unit.code, { onDelete: 'restrict', onUpdate: 'cascade' }),
    preparation: text('preparation'),
    groupLabel: text('group_label'),
    optional: boolean('optional').notNull().default(false),
    position: integer('position').notNull().default(0),
  },
  (table) => [
    index('recipe_ingredient_recipe_idx').on(table.recipeId, table.position),
    index('recipe_ingredient_ingredient_idx').on(table.ingredientId),
  ],
)

export const recipePhoto = pgTable(
  'recipe_photo',
  {
    id: serial('id').primaryKey(),
    recipeId: integer('recipe_id')
      .notNull()
      .references(() => recipe.id, { onDelete: 'cascade' }),
    storageKey: text('storage_key').notNull(),
    contentType: text('content_type').notNull(),
    size: integer('size').notNull(),
    width: integer('width'),
    height: integer('height'),
    position: integer('position').notNull().default(0),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('recipe_photo_recipe_idx').on(table.recipeId, table.position), uniqueIndex('recipe_photo_key').on(table.storageKey)],
)

export const recipeTag = pgTable(
  'recipe_tag',
  {
    recipeId: integer('recipe_id')
      .notNull()
      .references(() => recipe.id, { onDelete: 'cascade' }),
    tagId: integer('tag_id')
      .notNull()
      .references(() => tag.id, { onDelete: 'cascade' }),
  },
  (table) => [primaryKey({ columns: [table.recipeId, table.tagId] }), index('recipe_tag_tag_idx').on(table.tagId)],
)

export const favorite = pgTable(
  'favorite',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    recipeId: integer('recipe_id')
      .notNull()
      .references(() => recipe.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.recipeId] }), index('favorite_recipe_idx').on(table.recipeId)],
)

// ─── Menús ────────────────────────────────────────────────────────────────────

export const mealKind = pgEnum('meal_kind', ['desayuno', 'comida', 'cena', 'colacion'])

export const menu = pgTable(
  'menu',
  {
    id: serial('id').primaryKey(),
    name: text('name').notNull(),
    /** Lunes de la semana (YYYY-MM-DD). */
    weekStart: date('week_start', { mode: 'string' }).notNull(),
    defaultServings: integer('default_servings').notNull().default(4),
    notes: text('notes'),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('menu_week_idx').on(table.weekStart)],
)

export const menuItem = pgTable(
  'menu_item',
  {
    id: serial('id').primaryKey(),
    menuId: integer('menu_id')
      .notNull()
      .references(() => menu.id, { onDelete: 'cascade' }),
    date: date('date', { mode: 'string' }).notNull(),
    meal: mealKind('meal').notNull(),
    recipeId: integer('recipe_id')
      .notNull()
      .references(() => recipe.id, { onDelete: 'cascade' }),
    servings: integer('servings').notNull(),
    position: integer('position').notNull().default(0),
    notes: text('notes'),
  },
  (table) => [index('menu_item_menu_idx').on(table.menuId, table.date), index('menu_item_recipe_idx').on(table.recipeId)],
)

// ─── Listas del súper ─────────────────────────────────────────────────────────

export const listStatus = pgEnum('list_status', ['abierta', 'completada'])
export const listItemSource = pgEnum('list_item_source', ['generated', 'manual'])

export interface SourceRecipe {
  recipe: string
  qty: string
}

export const shoppingList = pgTable(
  'shopping_list',
  {
    id: serial('id').primaryKey(),
    menuId: integer('menu_id').references(() => menu.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    status: listStatus('status').notNull().default('abierta'),
    includeOptional: boolean('include_optional').notNull().default(false),
    generatedAt: timestamp('generated_at', { withTimezone: true }),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('shopping_list_menu_idx').on(table.menuId)],
)

export const shoppingListItem = pgTable(
  'shopping_list_item',
  {
    id: serial('id').primaryKey(),
    listId: integer('list_id')
      .notNull()
      .references(() => shoppingList.id, { onDelete: 'cascade' }),
    ingredientId: integer('ingredient_id').references(() => ingredient.id, { onDelete: 'set null' }),
    label: text('label').notNull(),
    quantity: numeric('quantity', { mode: 'number' }),
    unitCode: text('unit_code').references(() => unit.code, { onDelete: 'set null', onUpdate: 'cascade' }),
    aisleId: integer('aisle_id').references(() => aisle.id, { onDelete: 'set null' }),
    storeId: integer('store_id').references(() => store.id, { onDelete: 'set null' }),
    checked: boolean('checked').notNull().default(false),
    source: listItemSource('source').notNull().default('manual'),
    /** Para regenerar: identifica el renglón generado (ingrediente + dimensión/unidad). */
    mergeKey: text('merge_key'),
    sourceRecipes: jsonb('source_recipes').$type<SourceRecipe[]>().notNull().default([]),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('shopping_list_item_list_idx').on(table.listId), index('shopping_list_item_ingredient_idx').on(table.ingredientId)],
)
