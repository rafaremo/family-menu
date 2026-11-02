import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import * as z from 'zod'

import { UserFacingError } from '../../lib/errors.ts'
import { aisles, listTags, listUnits, stores } from '../../services/catalogs.ts'
import {
  createIngredient,
  findIngredientByName,
  getIngredient,
  ingredientInput,
  ingredientPatch,
  mergeIngredients,
  searchIngredients,
  updateIngredient,
  type Ingredient,
} from '../../services/ingredients.ts'
import { normalizeKey } from '../../lib/slug.ts'
import { defineTool, ingredientRef, type McpContext } from '../context.ts'
import { ingredientJson } from '../format.ts'

async function resolveIngredient(ref: number | string): Promise<Ingredient> {
  if (typeof ref === 'number') return getIngredient(ref)
  let found = await findIngredientByName(ref)
  if (found) return found
  let suggestions = (await searchIngredients(ref, 5)).map((i) => i.name)
  throw new UserFacingError(
    `No encontré el ingrediente "${ref}".${suggestions.length ? ` ¿Quisiste decir: ${suggestions.join(', ')}?` : ''}`,
    404,
  )
}

/** Pasillo / tienda por nombre (sin acentos). `null` = quitar. */
async function resolveNamed(kind: 'pasillo' | 'tienda', value: string | null | undefined): Promise<number | null | undefined> {
  if (value === undefined) return undefined
  if (value === null || value === '') return null
  let list = kind === 'pasillo' ? await aisles.list() : await stores.list()
  let match = list.find((x) => normalizeKey(x.name) === normalizeKey(value))
  if (!match) throw new UserFacingError(`No existe ${kind === 'pasillo' ? 'el pasillo' : 'la tienda'} "${value}". Opciones: ${list.map((x) => x.name).join(', ')}.`)
  return match.id
}

const ingredientFields = {
  aliases: z.array(z.string()).optional().describe('Otros nombres ("tomate", "tomate rojo"). Reemplaza la lista completa.'),
  aisle: z.string().nullable().optional().describe('Pasillo por nombre (ver list_aisles). null = sin pasillo.'),
  store: z.string().nullable().optional().describe('Tienda habitual por nombre (ver list_stores). null = cualquiera.'),
  default_unit: z.string().nullable().optional().describe('Código de unidad habitual (ver list_units).'),
  density_g_per_ml: z.number().positive().nullable().optional().describe('Gramos por ml, para convertir tazas/cucharadas a gramos.'),
  grams_per_piece: z.number().positive().nullable().optional().describe('Gramos por pieza, para sumar piezas con gramos.'),
  notes: z.string().nullable().optional(),
}

type IngredientArgs = { [K in keyof typeof ingredientFields]?: z.infer<(typeof ingredientFields)[K]> } & { name?: string }

async function toServiceInput(args: IngredientArgs) {
  return {
    name: args.name,
    aliases: args.aliases,
    aisleId: await resolveNamed('pasillo', args.aisle),
    defaultStoreId: await resolveNamed('tienda', args.store),
    defaultUnit: args.default_unit,
    densityGPerMl: args.density_g_per_ml,
    gramsPerPiece: args.grams_per_piece,
    notes: args.notes,
  }
}

const withoutUndefined = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined))

export function registerIngredientTools(server: McpServer, ctx: McpContext) {
  defineTool(
    server,
    ctx,
    'search_ingredients',
    {
      title: 'Buscar ingredientes',
      description: 'Busca en el catálogo de ingredientes por nombre o alias (tolera acentos y errores). Úsalo antes de crear recetas para reutilizar los nombres existentes.',
      inputSchema: { query: z.string().min(1), limit: z.number().int().min(1).max(50).optional() },
      annotations: { readOnlyHint: true },
    },
    async (args) => (await searchIngredients(args.query, args.limit ?? 10)).map((i) => ({ ...ingredientJson(i), matchedAlias: i.matchedAlias })),
  )

  defineTool(
    server,
    ctx,
    'create_ingredient',
    {
      title: 'Crear ingrediente',
      description: 'Agrega un ingrediente al catálogo con su pasillo, tienda y unidad habitual.',
      inputSchema: { name: z.string().min(1), ...ingredientFields },
    },
    async (args) => ingredientJson(await createIngredient(ctx.actor, ingredientInput.parse(withoutUndefined(await toServiceInput(args))))),
  )

  defineTool(
    server,
    ctx,
    'update_ingredient',
    {
      title: 'Editar ingrediente',
      description: 'Cambia datos de un ingrediente (nombre, alias, pasillo, tienda, unidad, densidad, gramos por pieza). Solo cambia lo que envíes.',
      inputSchema: { ingredient: ingredientRef, name: z.string().optional(), ...ingredientFields },
    },
    async ({ ingredient, ...rest }) => {
      let target = await resolveIngredient(ingredient)
      let patch = ingredientPatch.parse(withoutUndefined(await toServiceInput(rest)))
      return ingredientJson(await updateIngredient(ctx.actor, target.id, patch))
    },
  )

  defineTool(
    server,
    ctx,
    'merge_ingredients',
    {
      title: 'Fusionar ingredientes',
      description: 'Junta un ingrediente duplicado (`source`) dentro de otro (`target`): el nombre del duplicado pasa a ser alias, sus recetas y listas apuntan al destino y el duplicado se borra.',
      inputSchema: { source: ingredientRef, target: ingredientRef },
      annotations: { destructiveHint: true },
    },
    async (args) => {
      let source = await resolveIngredient(args.source)
      let target = await resolveIngredient(args.target)
      return { merged: source.name, into: ingredientJson(await mergeIngredients(ctx.actor, source.id, target.id)) }
    },
  )

  // ─── Catálogos (solo lectura por MCP) ──────────────────────────────────────

  defineTool(
    server,
    ctx,
    'list_tags',
    { title: 'Etiquetas', description: 'Etiquetas disponibles para recetas, por tipo.', inputSchema: {}, annotations: { readOnlyHint: true } },
    async () => (await listTags()).map((t) => ({ name: t.name, slug: t.slug, kind: t.kind })),
  )
  defineTool(
    server,
    ctx,
    'list_aisles',
    { title: 'Pasillos', description: 'Pasillos del súper en el orden de la lista.', inputSchema: {}, annotations: { readOnlyHint: true } },
    async () => (await aisles.list()).map((a) => a.name),
  )
  defineTool(
    server,
    ctx,
    'list_stores',
    { title: 'Tiendas', description: 'Tiendas donde compra la familia.', inputSchema: {}, annotations: { readOnlyHint: true } },
    async () => (await stores.list()).map((s) => s.name),
  )
  defineTool(
    server,
    ctx,
    'list_units',
    {
      title: 'Unidades',
      description: 'Unidades de medida (código, nombre, tipo y equivalencia a g/ml/pz).',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => (await listUnits()).map((u) => ({ code: u.code, name: u.name, plural: u.plural, type: u.dimension, toBase: u.toBase })),
  )
}
