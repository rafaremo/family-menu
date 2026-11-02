import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import * as z from 'zod'

import { slugify } from '../../lib/slug.ts'
import { resolveRecipe } from '../../services/menus.ts'
import {
  createRecipe,
  deleteRecipe,
  getRecipe,
  listRecipes,
  recipeInput,
  recipePatch,
  scaleIngredients,
  toggleFavorite,
  updateRecipe,
  type WriteResult,
} from '../../services/recipes.ts'
import { defineTool, recipeRef, type McpContext } from '../context.ts'
import { recipeCardJson, recipeJson } from '../format.ts'

const ingredientLine = z.object({
  ingredient: z.string().min(1).describe('Nombre o alias del ingrediente ("jitomate", "pechuga"). Si no existe se crea.'),
  quantity: z
    .union([z.number(), z.string()])
    .optional()
    .describe('Cantidad: 2, 0.5, "1/2", "1 ½". Omítela para "al gusto".'),
  unit: z
    .string()
    .optional()
    .describe('Unidad por código o nombre: g, kg, ml, l, taza, cda, cdta, pz, lata, manojo, diente, rama… Omítela para piezas sueltas.'),
  preparation: z.string().optional().describe('Cómo va: "picada", "cocida y deshebrada".'),
  group: z.string().optional().describe('Sección: "Para la salsa".'),
  optional: z.boolean().optional().describe('true si es opcional (no entra a la lista del súper por defecto).'),
})

const recipeFields = {
  description: z.string().optional().describe('Descripción breve.'),
  servings: z.number().int().min(1).max(100).optional().describe('Porciones que rinde (default 4).'),
  prep_minutes: z.number().int().min(0).optional(),
  cook_minutes: z.number().int().min(0).optional(),
  steps: z.array(z.string()).optional().describe('Pasos en orden, uno por elemento (sin numerar).'),
  notes: z.string().optional().describe('Notas y trucos.'),
  source_url: z.string().optional().describe('URL de origen, si viene de internet.'),
  family_credit: z.string().optional().describe('De quién es la receta: "la abuela Lupe".'),
  tags: z.array(z.string()).optional().describe('Etiquetas por nombre (ver list_tags). Las que no existan se crean.'),
  ingredients: z.array(ingredientLine).optional().describe('Ingredientes estructurados, en orden.'),
}

type RecipeArgs = { [K in keyof typeof recipeFields]?: z.infer<(typeof recipeFields)[K]> } & { title?: string }

/** Convierte nombres snake_case del MCP a la entrada de los servicios. */
function toServiceInput(args: RecipeArgs) {
  return {
    title: args.title,
    description: args.description,
    servings: args.servings,
    prepMinutes: args.prep_minutes,
    cookMinutes: args.cook_minutes,
    steps: args.steps,
    notes: args.notes,
    sourceUrl: args.source_url,
    familyCredit: args.family_credit,
    tags: args.tags,
    ingredients: args.ingredients,
  }
}

function writeSummary(result: WriteResult) {
  return {
    recipe: recipeJson(result.recipe),
    createdIngredients: result.createdIngredients,
    createdTags: result.createdTags,
    ...(result.createdIngredients.length
      ? { hint: 'Se crearon ingredientes nuevos; puedes completar su pasillo, tienda o densidad con update_ingredient.' }
      : {}),
  }
}

export function registerRecipeTools(server: McpServer, ctx: McpContext) {
  defineTool(
    server,
    ctx,
    'search_recipes',
    {
      title: 'Buscar recetas',
      description:
        'Busca en el recetario familiar por texto (título, descripción, ingredientes, quién la hizo; tolera acentos y errores), etiqueta, ingrediente o favoritas. Sin filtros lista todas. Ej.: {"query":"tinga"} o {"ingredient":"pollo","tag":"Platos fuertes"}.',
      inputSchema: {
        query: z.string().optional().describe('Texto libre.'),
        tag: z.string().optional().describe('Nombre o slug de etiqueta.'),
        ingredient: z.string().optional().describe('Recetas que llevan este ingrediente (nombre o alias).'),
        favorites_only: z.boolean().optional().describe('Solo mis favoritas.'),
        page: z.number().int().min(1).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      let tag = args.tag ? slugify(args.tag) : undefined
      let result = await listRecipes({
        q: args.query,
        tag,
        ingredient: args.ingredient,
        favoritesOf: args.favorites_only ? ctx.identity.id : null,
        viewerId: ctx.identity.id,
        page: args.page,
        pageSize: 30,
      })
      return { total: result.total, page: result.page, pages: result.pages, recipes: result.items.map(recipeCardJson) }
    },
  )

  defineTool(
    server,
    ctx,
    'get_recipe',
    {
      title: 'Ver receta',
      description: 'Regresa una receta completa (ingredientes, pasos, notas). Opcionalmente escalada a otras porciones.',
      inputSchema: {
        recipe: recipeRef,
        servings: z.number().int().min(1).max(100).optional().describe('Escalar a estas porciones.'),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      let { id } = await resolveRecipe(args.recipe)
      let detail = await getRecipe(id, ctx.identity.id)
      let servings = args.servings ?? detail.servings
      return recipeJson(detail, scaleIngredients(detail, servings), servings)
    },
  )

  defineTool(
    server,
    ctx,
    'scale_recipe',
    {
      title: 'Escalar receta',
      description: 'Calcula los ingredientes de una receta para N porciones (no modifica la receta).',
      inputSchema: { recipe: recipeRef, servings: z.number().int().min(1).max(100) },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      let { id } = await resolveRecipe(args.recipe)
      let detail = await getRecipe(id, ctx.identity.id)
      let lines = scaleIngredients(detail, args.servings)
      return { recipe: detail.title, servings: args.servings, originalServings: detail.servings, ingredients: recipeJson(detail, lines).ingredients.map((i) => i.text) }
    },
  )

  defineTool(
    server,
    ctx,
    'create_recipe',
    {
      title: 'Crear receta',
      description:
        'Guarda una receta nueva en el recetario. Usa ingredientes estructurados (cantidad + unidad + ingrediente). Antes de inventar ingredientes nuevos busca con search_ingredients; los que no existan se crean solos. Ej. ingrediente: {"ingredient":"cebolla","quantity":"1/2","unit":"pz","preparation":"picada"}.',
      inputSchema: { title: z.string().min(1).describe('Nombre de la receta.'), ...recipeFields },
    },
    async (args) => writeSummary(await createRecipe(ctx.actor, recipeInput.parse(toServiceInput(args)))),
  )

  defineTool(
    server,
    ctx,
    'update_recipe',
    {
      title: 'Editar receta',
      description:
        'Modifica una receta. Solo cambia los campos que envíes. OJO: `ingredients`, `steps` y `tags` reemplazan la lista completa (envía la lista final, no solo los cambios).',
      inputSchema: { recipe: recipeRef, title: z.string().optional(), ...recipeFields },
    },
    async ({ recipe, ...rest }) => {
      let { id } = await resolveRecipe(recipe)
      let patch = Object.fromEntries(Object.entries(toServiceInput(rest)).filter(([, v]) => v !== undefined))
      return writeSummary(await updateRecipe(ctx.actor, id, recipePatch.parse(patch)))
    },
  )

  defineTool(
    server,
    ctx,
    'delete_recipe',
    {
      title: 'Eliminar receta',
      description: 'Elimina una receta (y sus fotos; se quita de los menús). Irreversible: confirma con el usuario y manda confirm=true.',
      inputSchema: { recipe: recipeRef, confirm: z.literal(true).describe('Debe ser true.') },
      annotations: { destructiveHint: true },
    },
    async (args) => {
      let target = await resolveRecipe(args.recipe)
      await deleteRecipe(ctx.actor, target.id)
      return { deleted: target.title }
    },
  )

  defineTool(
    server,
    ctx,
    'toggle_favorite',
    {
      title: 'Marcar favorita',
      description: 'Marca o desmarca una receta como favorita del usuario del token. Sin `favorite` alterna.',
      inputSchema: { recipe: recipeRef, favorite: z.boolean().optional() },
    },
    async (args) => {
      let target = await resolveRecipe(args.recipe)
      let value = await toggleFavorite(ctx.actor, target.id, args.favorite)
      return { recipe: target.title, favorite: value }
    },
  )
}
