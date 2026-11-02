import { formData } from 'remix/middleware/form-data'
import { redirect } from 'remix/response/redirect'
import { createController } from 'remix/router'

import { requireUser, sessionAuth, webActor, type Identity } from '../../auth/middleware.ts'
import { toUserMessage, UserFacingError } from '../../lib/errors.ts'
import { parseForm, parseId, readText } from '../../lib/validation.ts'
import { routes } from '../../routes.ts'
import { listUnits } from '../../services/catalogs.ts'
import {
  addManualItem,
  clearChecked,
  createList,
  deleteList,
  exportListText,
  getList,
  listLists,
  manualItemInput,
  regenerateList,
  removeListItem,
  setItemsChecked,
  updateList,
  type ListDetail,
} from '../../services/shopping.ts'
import { NotFound } from '../../ui/layout.tsx'
import { ListShowPage, ListsIndexPage } from './pages.tsx'

type Renderer = { render: (node: any, init?: ResponseInit) => Response | Promise<Response> }

const r = routes.lists

const FLASH: Record<string, string> = {
  generated: 'Lista lista 😉. Se calculó desde el menú.',
  regenerated: 'Lista actualizada desde el menú (se conservó lo agregado a mano y lo marcado).',
  created: 'Lista creada.',
  updated: 'Lista actualizada.',
  deleted: 'Lista eliminada.',
  added: 'Agregado.',
  removed: 'Quitado de la lista.',
  cleared: 'Se quitaron los artículos comprados.',
}

const flash = (url: URL) => FLASH[url.searchParams.get('ok') ?? ''] ?? null

/** Peticiones hechas por el script de mejora progresiva (sin recargar la página). */
const isEnhanced = (headers: Headers) => headers.get('X-Requested-With') === 'fetch'

function notFound(context: Renderer, user: Identity) {
  return context.render(<NotFound user={user} message="Esa lista no existe." backHref={r.index.href()} backLabel="Ver listas" />, {
    status: 404,
  })
}

async function loadList(id: string | undefined): Promise<ListDetail | null> {
  let parsed = parseId(id)
  if (!parsed) return null
  try {
    return await getList(parsed)
  } catch (error) {
    if (error instanceof UserFacingError && error.status === 404) return null
    throw error
  }
}

async function renderList(
  context: Renderer & { url: URL },
  user: Identity,
  list: ListDetail,
  extra: { ok?: string | null; error?: string | null } = {},
  status = 200,
) {
  return context.render(
    <ListShowPage
      user={user}
      list={list}
      units={await listUnits()}
      hideChecked={context.url.searchParams.get('ocultar') === '1'}
      exportText={exportListText(list)}
      {...extra}
    />,
    { status },
  )
}

const showHref = (id: number, ok: string) => `${r.show.href({ id: String(id) })}?ok=${ok}`

export default createController(r, {
  middleware: [sessionAuth, requireUser, formData()],
  actions: {
    async index(context) {
      return context.render(<ListsIndexPage user={context.auth.identity} lists={await listLists()} ok={flash(context.url)} />)
    },

    async create(context) {
      let user = context.auth.identity
      try {
        let list = await createList(webActor(user), readText(context.formData, 'name'))
        return redirect(showHref(list.id, 'created'), 303)
      } catch (error) {
        return context.render(<ListsIndexPage user={user} lists={await listLists()} error={toUserMessage(error)} />, { status: 400 })
      }
    },

    async show(context) {
      let user = context.auth.identity
      let list = await loadList(context.params.id)
      if (!list) return notFound(context, user)
      return renderList(context, user, list, { ok: flash(context.url) })
    },

    async text(context) {
      let list = await loadList(context.params.id)
      if (!list) return new Response('No encontrada', { status: 404 })
      let text = exportListText(list, { includeChecked: context.url.searchParams.get('todo') === '1' })
      return new Response(text, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
    },

    async update(context) {
      let user = context.auth.identity
      let list = await loadList(context.params.id)
      if (!list) return notFound(context, user)
      let status = readText(context.formData, 'status')
      try {
        await updateList(webActor(user), list.id, {
          name: context.formData.has('name') ? readText(context.formData, 'name') : undefined,
          status: status === 'completada' || status === 'abierta' ? status : undefined,
        })
        return redirect(showHref(list.id, 'updated'), 303)
      } catch (error) {
        return renderList(context, user, list, { error: toUserMessage(error) }, 400)
      }
    },

    async destroy(context) {
      let user = context.auth.identity
      let list = await loadList(context.params.id)
      if (!list) return notFound(context, user)
      await deleteList(webActor(user), list.id)
      return redirect(`${r.index.href()}?ok=deleted`, 303)
    },

    async regenerate(context) {
      let user = context.auth.identity
      let list = await loadList(context.params.id)
      if (!list) return notFound(context, user)
      try {
        await regenerateList(webActor(user), list.id)
        return redirect(showHref(list.id, 'regenerated'), 303)
      } catch (error) {
        return renderList(context, user, list, { error: toUserMessage(error) }, 400)
      }
    },

    async clearChecked(context) {
      let user = context.auth.identity
      let list = await loadList(context.params.id)
      if (!list) return notFound(context, user)
      await clearChecked(webActor(user), list.id)
      return redirect(showHref(list.id, 'cleared'), 303)
    },

    async itemAdd(context) {
      let user = context.auth.identity
      let list = await loadList(context.params.id)
      if (!list) return notFound(context, user)
      let parsed = parseForm(manualItemInput, context.formData)
      if (!parsed.ok || !parsed.data) {
        return renderList(context, user, list, { error: Object.values(parsed.errors)[0] ?? 'Revisa los datos.' }, 400)
      }
      try {
        await addManualItem(webActor(user), list.id, parsed.data)
        return redirect(showHref(list.id, 'added'), 303)
      } catch (error) {
        return renderList(context, user, list, { error: toUserMessage(error) }, 400)
      }
    },

    async itemCheck(context) {
      let user = context.auth.identity
      let listId = parseId(context.params.id)
      let itemId = parseId(context.params.itemId)
      if (!listId || !itemId) return notFound(context, user)
      let checked = readText(context.formData, 'checked') === '1'
      try {
        await setItemsChecked(webActor(user), listId, [itemId], checked)
      } catch (error) {
        if (error instanceof UserFacingError && error.status === 404) {
          return isEnhanced(context.headers) ? new Response(null, { status: 404 }) : notFound(context, user)
        }
        throw error
      }
      if (isEnhanced(context.headers)) return new Response(null, { status: 204 })
      // Sin JS: regresa a la lista conservando el filtro.
      let back = new URL(context.headers.get('Referer') ?? '', context.url)
      let hide = back.pathname === r.show.href({ id: String(listId) }) && back.searchParams.get('ocultar') === '1'
      return redirect(`${r.show.href({ id: String(listId) })}${hide ? '?ocultar=1' : ''}#item-${itemId}`, 303)
    },

    async itemDestroy(context) {
      let user = context.auth.identity
      let list = await loadList(context.params.id)
      let itemId = parseId(context.params.itemId)
      if (!list || !itemId) return notFound(context, user)
      try {
        await removeListItem(webActor(user), list.id, itemId)
        return redirect(showHref(list.id, 'removed'), 303)
      } catch (error) {
        return renderList(context, user, list, { error: toUserMessage(error) }, 404)
      }
    },
  },
})
