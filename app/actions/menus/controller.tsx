import { formData } from 'remix/middleware/form-data'
import { redirect } from 'remix/response/redirect'
import { createController } from 'remix/router'

import { requireUser, sessionAuth, webActor, type Identity } from '../../auth/middleware.ts'
import { addDays, isIsoDate, mondayOf, todayIso } from '../../lib/dates.ts'
import { toUserMessage, UserFacingError } from '../../lib/errors.ts'
import { parseForm, parseId, readText } from '../../lib/validation.ts'
import { routes } from '../../routes.ts'
import {
  addMenuItem,
  copyMenu,
  createMenu,
  deleteMenu,
  getMenu,
  listMenus,
  MEAL_VALUES,
  menuInput,
  menuItemInput,
  menuItemPatch,
  menuPatch,
  removeMenuItem,
  updateMenu,
  updateMenuItem,
  type Meal,
  type MenuDetail,
} from '../../services/menus.ts'
import { recipeOptions } from '../../services/recipes.ts'
import { generateListForMenu } from '../../services/shopping.ts'
import { NotFound } from '../../ui/layout.tsx'
import { MenusIndexPage } from './index-page.tsx'
import { MenuShowPage } from './show-page.tsx'

type Renderer = { render: (node: any, init?: ResponseInit) => Response | Promise<Response> }

const r = routes.menus

const FLASH: Record<string, string> = {
  created: 'Menú creado. Ahora agrega platillos.',
  updated: 'Menú actualizado.',
  deleted: 'Menú eliminado.',
  copied: 'Menú copiado a la nueva semana.',
  added: 'Platillo agregado.',
  itemUpdated: 'Platillo actualizado.',
  itemRemoved: 'Platillo quitado.',
}

const flash = (url: URL) => FLASH[url.searchParams.get('ok') ?? ''] ?? null

function notFound(context: Renderer, user: Identity) {
  return context.render(<NotFound user={user} message="Ese menú no existe." backHref={r.index.href()} backLabel="Ver menús" />, {
    status: 404,
  })
}

async function loadMenu(id: string | undefined): Promise<MenuDetail | null> {
  let parsed = parseId(id)
  if (!parsed) return null
  try {
    return await getMenu(parsed)
  } catch (error) {
    if (error instanceof UserFacingError && error.status === 404) return null
    throw error
  }
}

async function renderMenu(
  context: Renderer & { url: URL },
  user: Identity,
  menu: MenuDetail,
  extra: { ok?: string | null; error?: string | null } = {},
  status = 200,
) {
  let today = todayIso()
  let dia = context.url.searchParams.get('dia') ?? ''
  let comida = context.url.searchParams.get('comida') ?? ''
  let inWeek = (d: string) => isIsoDate(d) && d >= menu.weekStart && d <= addDays(menu.weekStart, 6)
  let addDate = inWeek(dia) ? dia : inWeek(today) ? today : menu.weekStart
  let addMeal: Meal = (MEAL_VALUES as readonly string[]).includes(comida) ? (comida as Meal) : 'comida'
  let recipes = await recipeOptions()
  return context.render(
    <MenuShowPage user={user} menu={menu} recipes={recipes} today={today} addDate={addDate} addMeal={addMeal} {...extra} />,
    { status },
  )
}

/** Semana sugerida para un menú nuevo: esta, o la siguiente si esta ya tiene menú. */
function suggestedWeek(thisWeek: string, existing: { weekStart: string }[]): string {
  let week = thisWeek
  while (existing.some((m) => m.weekStart === week)) week = addDays(week, 7)
  return week
}

const showHref = (id: number, ok: string, hash = '') => `${r.show.href({ id: String(id) })}?ok=${ok}${hash}`

export default createController(r, {
  middleware: [sessionAuth, requireUser, formData()],
  actions: {
    async index(context) {
      let menus = await listMenus()
      let thisWeek = mondayOf(todayIso())
      return context.render(
        <MenusIndexPage
          user={context.auth.identity}
          menus={menus}
          thisWeek={thisWeek}
          suggestedWeek={suggestedWeek(thisWeek, menus)}
          ok={flash(context.url)}
        />,
      )
    },

    async create(context) {
      let user = context.auth.identity
      let parsed = parseForm(menuInput, context.formData)
      if (!parsed.ok || !parsed.data) {
        let menus = await listMenus()
        let thisWeek = mondayOf(todayIso())
        return context.render(
          <MenusIndexPage
            user={user}
            menus={menus}
            thisWeek={thisWeek}
            suggestedWeek={suggestedWeek(thisWeek, menus)}
            errors={parsed.errors}
            values={{
              weekStart: readText(context.formData, 'weekStart'),
              name: readText(context.formData, 'name'),
              defaultServings: readText(context.formData, 'defaultServings'),
            }}
          />,
          { status: 400 },
        )
      }
      let created = await createMenu(webActor(user), parsed.data)
      return redirect(showHref(created.id, 'created', '#agregar'), 303)
    },

    async show(context) {
      let user = context.auth.identity
      let menu = await loadMenu(context.params.id)
      if (!menu) return notFound(context, user)
      return renderMenu(context, user, menu, { ok: flash(context.url) })
    },

    async update(context) {
      let user = context.auth.identity
      let menu = await loadMenu(context.params.id)
      if (!menu) return notFound(context, user)
      let parsed = parseForm(menuPatch, context.formData)
      if (!parsed.ok || !parsed.data) {
        return renderMenu(context, user, menu, { error: Object.values(parsed.errors)[0] ?? 'Revisa los datos.' }, 400)
      }
      await updateMenu(webActor(user), menu.id, parsed.data)
      return redirect(showHref(menu.id, 'updated'), 303)
    },

    async destroy(context) {
      let user = context.auth.identity
      let menu = await loadMenu(context.params.id)
      if (!menu) return notFound(context, user)
      await deleteMenu(webActor(user), menu.id)
      return redirect(`${r.index.href()}?ok=deleted`, 303)
    },

    async copy(context) {
      let user = context.auth.identity
      let menu = await loadMenu(context.params.id)
      if (!menu) return notFound(context, user)
      try {
        let copy = await copyMenu(webActor(user), menu.id, readText(context.formData, 'weekStart'))
        return redirect(showHref(copy.id, 'copied'), 303)
      } catch (error) {
        return renderMenu(context, user, menu, { error: toUserMessage(error) }, 400)
      }
    },

    async itemAdd(context) {
      let user = context.auth.identity
      let menu = await loadMenu(context.params.id)
      if (!menu) return notFound(context, user)
      let parsed = parseForm(menuItemInput, context.formData)
      if (!parsed.ok || !parsed.data) {
        return renderMenu(context, user, menu, { error: Object.values(parsed.errors)[0] ?? 'Revisa los datos.' }, 400)
      }
      try {
        await addMenuItem(webActor(user), menu.id, parsed.data)
        return redirect(showHref(menu.id, 'added'), 303)
      } catch (error) {
        let status = error instanceof UserFacingError ? error.status : 500
        return renderMenu(context, user, menu, { error: toUserMessage(error) }, status)
      }
    },

    async itemUpdate(context) {
      let user = context.auth.identity
      let menu = await loadMenu(context.params.id)
      let itemId = parseId(context.params.itemId)
      if (!menu || !itemId) return notFound(context, user)
      let parsed = parseForm(menuItemPatch, context.formData)
      if (!parsed.ok || !parsed.data) {
        return renderMenu(context, user, menu, { error: Object.values(parsed.errors)[0] ?? 'Revisa los datos.' }, 400)
      }
      try {
        await updateMenuItem(webActor(user), menu.id, itemId, parsed.data)
        return redirect(showHref(menu.id, 'itemUpdated'), 303)
      } catch (error) {
        let status = error instanceof UserFacingError ? error.status : 500
        return renderMenu(context, user, menu, { error: toUserMessage(error) }, status)
      }
    },

    async itemDestroy(context) {
      let user = context.auth.identity
      let menu = await loadMenu(context.params.id)
      let itemId = parseId(context.params.itemId)
      if (!menu || !itemId) return notFound(context, user)
      try {
        await removeMenuItem(webActor(user), menu.id, itemId)
        return redirect(showHref(menu.id, 'itemRemoved'), 303)
      } catch (error) {
        return renderMenu(context, user, menu, { error: toUserMessage(error) }, 404)
      }
    },

    async generateList(context) {
      let user = context.auth.identity
      let menu = await loadMenu(context.params.id)
      if (!menu) return notFound(context, user)
      if (!menu.items.length) return renderMenu(context, user, menu, { error: 'Agrega platillos antes de generar la lista.' }, 400)
      let list = await generateListForMenu(webActor(user), menu.id)
      return redirect(`${routes.lists.show.href({ id: String(list.id) })}?ok=generated`, 303)
    },
  },
})
