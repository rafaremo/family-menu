import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import * as z from 'zod'

import { addDays, mondayOf, todayIso } from '../lib/dates.ts'
import { getMenu, listMenus } from '../services/menus.ts'
import { getRecipeBySlug, listRecipes, recipeOptions } from '../services/recipes.ts'
import { defineTool, type McpContext } from './context.ts'
import { menuMarkdown, publicUrl, recipeMarkdown } from './format.ts'
import { registerIngredientTools } from './tools/ingredients.ts'
import { registerMenuTools } from './tools/menus.ts'
import { registerRecipeTools } from './tools/recipes.ts'

export const SERVER_INFO = { name: 'family-menu', version: '1.0.0' }

const INSTRUCTIONS = `Family Menu: recetario familiar, menús semanales y lista del súper (todo en español).
- Antes de crear recetas, busca ingredientes con search_ingredients para reutilizar nombres; los nuevos se crean solos.
- Las cantidades van estructuradas: quantity + unit (g, kg, ml, l, taza, cda, cdta, pz, lata, manojo, diente…).
- Flujo típico: create_menu (semana) → add_menu_item por día y comida → generate_shopping_list → export_shopping_list.
- Las fechas son AAAA-MM-DD; las semanas empiezan en lunes. Hoy es ${todayIso()}.
- No borres nada sin confirmarlo con el usuario.`

/** Un servidor por petición (modo sin estado): las herramientas actúan como el dueño del token. */
export function createMcpServer(ctx: McpContext): McpServer {
  let server = new McpServer(SERVER_INFO, { instructions: INSTRUCTIONS, capabilities: { logging: {} } })

  defineTool(
    server,
    ctx,
    'whoami',
    {
      title: '¿Quién soy?',
      description: 'Usuario dueño del token y rol en la familia.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => ({ ...ctx.identity, app: publicUrl('/'), today: todayIso() }),
  )

  registerRecipeTools(server, ctx)
  registerIngredientTools(server, ctx)
  registerMenuTools(server, ctx)

  // ─── Resources ─────────────────────────────────────────────────────────────

  server.registerResource(
    'receta',
    new ResourceTemplate('recipe://{slug}', {
      list: async () => ({
        resources: (await recipeOptions()).map((r) => ({ uri: `recipe://${r.slug}`, name: r.title, mimeType: 'text/markdown' })),
      }),
    }),
    { title: 'Receta', description: 'Receta en markdown.', mimeType: 'text/markdown' },
    async (uri, { slug }) => {
      let recipe = await getRecipeBySlug(String(slug), ctx.identity.id)
      return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text: recipeMarkdown(recipe) }] }
    },
  )

  server.registerResource(
    'menu',
    new ResourceTemplate('menu://{id}', {
      list: async () => ({
        resources: (await listMenus(20)).map((m) => ({ uri: `menu://${m.id}`, name: m.name, mimeType: 'text/markdown' })),
      }),
    }),
    { title: 'Menú', description: 'Menú semanal en markdown.', mimeType: 'text/markdown' },
    async (uri, { id }) => {
      let menu = await getMenu(Number(id))
      return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text: menuMarkdown(menu) }] }
    },
  )

  // ─── Prompts ───────────────────────────────────────────────────────────────

  server.registerPrompt(
    'planear_semana',
    {
      title: 'Planear la semana',
      description: 'Sugiere el menú de una semana usando favoritas y evitando repetir lo de semanas recientes.',
      argsSchema: {
        semana: z.string().optional().describe('Cualquier fecha de la semana (AAAA-MM-DD). Default: la próxima semana.'),
        notas: z.string().optional().describe('Preferencias: "cenas ligeras", "sin cerdo", "visitas el sábado"…'),
      },
    },
    async ({ semana, notas }) => {
      let weekStart = mondayOf(semana && /^\d{4}-\d{2}-\d{2}$/.test(semana) ? semana : addDays(todayIso(), 7))
      let favorites = await listRecipes({ favoritesOf: ctx.identity.id, pageSize: 50 })
      let recent = (await listMenus(3)).filter((m) => m.weekStart < weekStart)
      let recentTitles = new Set<string>()
      for (let m of recent) for (let i of (await getMenu(m.id)).items) recentTitles.add(i.recipeTitle)
      let text = [
        `Ayúdame a planear el menú de la semana que empieza el ${weekStart} (lunes a domingo).`,
        notas ? `Preferencias: ${notas}` : null,
        '',
        `Mis favoritas: ${favorites.items.map((r) => r.title).join(', ') || '(ninguna marcada)'}.`,
        `Ya comimos en semanas recientes (evita repetirlas): ${[...recentTitles].join(', ') || '(nada registrado)'}.`,
        '',
        'Pasos:',
        '1. Revisa el recetario con search_recipes (puedes filtrar por etiqueta).',
        '2. Propón un plan día por día (desayuno, comida, cena) y pídeme confirmación antes de guardar.',
        `3. Cuando lo apruebe: create_menu con week=${weekStart}, add_menu_item por platillo y al final generate_shopping_list.`,
        '4. Si propones algo que no está en el recetario, pregúntame si lo capturamos con create_recipe.',
      ]
        .filter((l) => l !== null)
        .join('\n')
      return { messages: [{ role: 'user', content: { type: 'text', text } }] }
    },
  )

  server.registerPrompt(
    'capturar_receta',
    {
      title: 'Capturar receta familiar',
      description: 'Guía para dictar una receta de la familia y guardarla bien estructurada.',
      argsSchema: { receta: z.string().optional().describe('Nombre de la receta o el texto dictado.') },
    },
    async ({ receta }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: [
              `Quiero guardar una receta de la familia${receta ? `: ${receta}` : ''}.`,
              '',
              'Hazme preguntas cortas, una a la vez, para completar: de quién es, cuántas porciones rinde, tiempos,',
              'ingredientes con cantidad y unidad (y si alguno es opcional o va en una sección como "para la salsa"),',
              'pasos en orden y trucos. Antes de guardar, busca los ingredientes con search_ingredients para usar los',
              'nombres del catálogo. Muéstrame un resumen y, cuando lo confirme, guárdala con create_recipe.',
            ].join('\n'),
          },
        },
      ],
    }),
  )

  return server
}
