import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import * as z from 'zod'

import { todayIso } from '../../lib/dates.ts'
import { UserFacingError } from '../../lib/errors.ts'
import {
  addMenuItem,
  copyMenu,
  createMenu,
  getMenu,
  listMenus,
  menuForWeek,
  menuInput,
  menuItemInput,
  menuItemPatch,
  removeMenuItem,
  updateMenuItem,
} from '../../services/menus.ts'
import {
  addManualItem,
  exportListText,
  generateListForMenu,
  getList,
  listLists,
  manualItemInput,
  setItemsChecked,
} from '../../services/shopping.ts'
import { defineTool, isoDate, MEAL_ENUM, recipeRef, type McpContext } from '../context.ts'
import { listJson, menuJson } from '../format.ts'

const menuId = z.number().int().positive().describe('id del menú (ver list_menus).')
const listId = z.number().int().positive().describe('id de la lista (ver get_shopping_list o list_menus → shoppingListId).')

export function registerMenuTools(server: McpServer, ctx: McpContext) {
  defineTool(
    server,
    ctx,
    'list_menus',
    {
      title: 'Menús',
      description: `Menús semanales recientes (más nuevos primero). Hoy es ${todayIso()}.`,
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () =>
      (await listMenus(30)).map((m) => ({ id: m.id, name: m.name, weekStart: m.weekStart, dishes: m.itemCount, shoppingListId: m.listId })),
  )

  defineTool(
    server,
    ctx,
    'get_menu',
    {
      title: 'Ver menú',
      description: 'Muestra un menú día por día. Usa `menu_id`, o `week` (cualquier fecha de la semana) para el menú de esa semana; sin nada, el de esta semana.',
      inputSchema: { menu_id: menuId.optional(), week: isoDate.optional() },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      let menu = args.menu_id ? await getMenu(args.menu_id) : await menuForWeek(args.week ?? todayIso())
      if (!menu) throw new UserFacingError(`No hay menú para la semana de ${args.week ?? todayIso()}. Créalo con create_menu.`, 404)
      return menuJson(menu)
    },
  )

  defineTool(
    server,
    ctx,
    'create_menu',
    {
      title: 'Crear menú',
      description: 'Crea el menú de una semana (lunes a domingo). `week` puede ser cualquier fecha de esa semana.',
      inputSchema: {
        week: isoDate,
        name: z.string().optional().describe('Default: "Semana del 3 nov".'),
        default_servings: z.number().int().min(1).max(100).optional().describe('Porciones por platillo (default 4).'),
        notes: z.string().optional(),
      },
    },
    async (args) =>
      menuJson(
        await createMenu(
          ctx.actor,
          menuInput.parse({ weekStart: args.week, name: args.name, defaultServings: args.default_servings, notes: args.notes }),
        ),
      ),
  )

  defineTool(
    server,
    ctx,
    'add_menu_item',
    {
      title: 'Agregar platillo al menú',
      description: 'Pone una receta en un día y comida del menú. La fecha debe estar dentro de la semana del menú.',
      inputSchema: {
        menu_id: menuId,
        date: isoDate,
        meal: MEAL_ENUM.describe('desayuno, comida, cena o colacion'),
        recipe: recipeRef,
        servings: z.number().int().min(1).max(100).optional().describe('Default: porciones del menú.'),
        notes: z.string().optional(),
      },
    },
    async (args) => {
      let item = await addMenuItem(
        ctx.actor,
        args.menu_id,
        menuItemInput.parse({ date: args.date, meal: args.meal, recipe: args.recipe, servings: args.servings, notes: args.notes }),
      )
      return { itemId: item.id, date: item.date, meal: item.meal, recipe: item.recipeTitle, servings: item.servings }
    },
  )

  defineTool(
    server,
    ctx,
    'update_menu_item',
    {
      title: 'Cambiar platillo',
      description: 'Mueve un platillo de día/comida o cambia sus porciones.',
      inputSchema: {
        menu_id: menuId,
        item_id: z.number().int().positive(),
        date: isoDate.optional(),
        meal: MEAL_ENUM.optional(),
        servings: z.number().int().min(1).max(100).optional(),
        notes: z.string().optional(),
      },
    },
    async (args) => {
      await updateMenuItem(ctx.actor, args.menu_id, args.item_id, menuItemPatch.parse({ date: args.date, meal: args.meal, servings: args.servings, notes: args.notes }))
      return menuJson(await getMenu(args.menu_id))
    },
  )

  defineTool(
    server,
    ctx,
    'remove_menu_item',
    {
      title: 'Quitar platillo',
      description: 'Quita un platillo del menú.',
      inputSchema: { menu_id: menuId, item_id: z.number().int().positive() },
      annotations: { destructiveHint: true },
    },
    async (args) => {
      await removeMenuItem(ctx.actor, args.menu_id, args.item_id)
      return { removed: args.item_id }
    },
  )

  defineTool(
    server,
    ctx,
    'copy_menu',
    {
      title: 'Repetir menú',
      description: 'Copia un menú completo a otra semana (los platillos caen en el mismo día de la semana).',
      inputSchema: { menu_id: menuId, week: isoDate.describe('Cualquier fecha de la semana destino.'), name: z.string().optional() },
    },
    async (args) => menuJson(await copyMenu(ctx.actor, args.menu_id, args.week, args.name)),
  )

  // ─── Lista del súper ───────────────────────────────────────────────────────

  defineTool(
    server,
    ctx,
    'generate_shopping_list',
    {
      title: 'Generar lista del súper',
      description:
        'Calcula la lista del súper de un menú: escala por porciones, suma y convierte unidades, agrupa por tienda y pasillo. Si ya hay lista abierta del menú la actualiza conservando lo agregado a mano y lo ya marcado.',
      inputSchema: { menu_id: menuId, include_optional: z.boolean().optional().describe('Incluir ingredientes opcionales.') },
    },
    async (args) => listJson(await generateListForMenu(ctx.actor, args.menu_id, { includeOptional: args.include_optional })),
  )

  defineTool(
    server,
    ctx,
    'get_shopping_list',
    {
      title: 'Ver lista del súper',
      description: 'Muestra una lista por tienda y pasillo, con lo marcado. Sin `list_id` regresa la más reciente abierta.',
      inputSchema: { list_id: listId.optional() },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      let id = args.list_id ?? (await listLists(20)).find((l) => l.status === 'abierta')?.id
      if (!id) throw new UserFacingError('No hay listas abiertas. Genera una con generate_shopping_list.', 404)
      return listJson(await getList(id))
    },
  )

  defineTool(
    server,
    ctx,
    'add_list_item',
    {
      title: 'Agregar a la lista',
      description: 'Agrega algo a mano a una lista (si empata con un ingrediente toma su pasillo y tienda).',
      inputSchema: {
        list_id: listId,
        label: z.string().min(1).describe('Qué comprar: "papel de baño".'),
        quantity: z.union([z.number(), z.string()]).optional(),
        unit: z.string().optional(),
        notes: z.string().optional(),
      },
    },
    async (args) => {
      let item = await addManualItem(
        ctx.actor,
        args.list_id,
        manualItemInput.parse({ label: args.label, quantity: args.quantity, unit: args.unit, notes: args.notes }),
      )
      return { itemId: item.id, label: item.label, aisle: item.aisleName, store: item.storeName }
    },
  )

  defineTool(
    server,
    ctx,
    'check_list_items',
    {
      title: 'Marcar comprados',
      description: 'Marca (o desmarca con checked=false) artículos de la lista como comprados.',
      inputSchema: {
        list_id: listId,
        item_ids: z.array(z.number().int().positive()).min(1),
        checked: z.boolean().optional().describe('Default true.'),
      },
    },
    async (args) => ({ updated: await setItemsChecked(ctx.actor, args.list_id, args.item_ids, args.checked ?? true) }),
  )

  defineTool(
    server,
    ctx,
    'export_shopping_list',
    {
      title: 'Exportar lista',
      description: 'Lista en texto para WhatsApp/Notas, agrupada por tienda y pasillo. Por defecto solo lo pendiente.',
      inputSchema: { list_id: listId, include_checked: z.boolean().optional() },
      annotations: { readOnlyHint: true },
    },
    async (args) => exportListText(await getList(args.list_id), { includeChecked: args.include_checked }),
  )
}
