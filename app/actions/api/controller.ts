import { createController } from 'remix/router'

import { UserFacingError } from '../../lib/errors.ts'
import { parseId } from '../../lib/validation.ts'
import { routes } from '../../routes.ts'
import {
  formatItemAmount,
  getList,
  listLists,
  sectionsOf,
  type ListDetail,
  type ListItemView,
  type ListSummary,
} from '../../services/shopping.ts'
import { verifyToken } from '../../services/tokens.ts'

/**
 * API REST de solo lectura para listas del súper (pantallas en casa, widgets).
 * Auth: `Authorization: Bearer <token>` (tokens "Solo leer listas" o "MCP completo").
 * CORS: `API_CORS_ORIGINS` (orígenes separados por coma, o `*`; default `*`). Es seguro porque
 * no usa cookies: sin token no se puede leer nada.
 * No se registra en la bitácora (una pantalla consulta cada pocos segundos); el último uso queda
 * en el token.
 */

const MAX_LISTS = 100

function allowedOrigin(origin: string | null): string | null {
  let config = (process.env.API_CORS_ORIGINS ?? '*').trim()
  if (config === '*') return '*'
  if (!origin) return null
  let allowed = config
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean)
  return allowed.includes(origin) ? origin : null
}

function corsHeaders(request: Request): Headers {
  let headers = new Headers({ 'Cache-Control': 'no-store' })
  let origin = allowedOrigin(request.headers.get('Origin'))
  if (origin) {
    headers.set('Access-Control-Allow-Origin', origin)
    headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS')
    headers.set('Access-Control-Allow-Headers', 'Authorization')
    headers.set('Access-Control-Max-Age', '86400')
  }
  if (origin !== '*') headers.set('Vary', 'Origin')
  return headers
}

function json(request: Request, data: unknown, status = 200, extra: Record<string, string> = {}): Response {
  let headers = corsHeaders(request)
  for (let [k, v] of Object.entries(extra)) headers.set(k, v)
  return Response.json(data, { status, headers })
}

const apiError = (request: Request, status: number, message: string, extra: Record<string, string> = {}) =>
  json(request, { error: message }, status, extra)

const UNAUTHORIZED: Record<string, string> = {
  missing: 'Falta el token. Usa "Authorization: Bearer <token>" (créalo en Mi cuenta → Tokens).',
  invalid: 'Token inválido, vencido o revocado.',
  banned: 'La cuenta dueña del token está desactivada.',
}

/** Preflight, método y token. Regresa una respuesta de error/preflight o `null` si puede seguir. */
async function guard(request: Request): Promise<Response | null> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request) })
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return apiError(request, 405, 'Esta API es de solo lectura: usa GET.', { Allow: 'GET, OPTIONS' })
  }

  let match = /^Bearer\s+(\S+)$/i.exec(request.headers.get('Authorization') ?? '')
  let check = await verifyToken(match?.[1])
  if (!check.ok) {
    if (check.reason === 'rate_limited') return apiError(request, 429, 'Demasiadas peticiones con este token; espera un minuto.', { 'Retry-After': '60' })
    return apiError(request, 401, UNAUTHORIZED[check.reason]!, { 'WWW-Authenticate': 'Bearer realm="family-menu"' })
  }
  // `full` y `lists:read` pueden leer listas; si se agregan alcances nuevos, se niegan por defecto.
  if (check.scope !== 'full' && check.scope !== 'lists:read') return apiError(request, 403, 'Este token no puede leer listas.')
  return null
}

// ─── Serialización ───────────────────────────────────────────────────────────

const isOpen = (status: ListSummary['status']) => status === 'abierta'

function summaryJson(l: ListSummary) {
  return {
    id: l.id,
    name: l.name,
    status: l.status,
    open: isOpen(l.status),
    menu: l.menuId ? { id: l.menuId, name: l.menuName } : null,
    total: l.total,
    checked: l.checked,
    pending: l.total - l.checked,
    generatedAt: l.generatedAt,
    updatedAt: l.updatedAt,
  }
}

function itemJson(i: ListItemView) {
  return {
    id: i.id,
    label: i.label,
    amount: formatItemAmount(i) || null,
    quantity: i.quantity,
    unit: i.unitCode,
    checked: i.checked,
    store: i.storeName,
    aisle: i.aisleName,
    notes: i.notes,
    source: i.source,
    /** De qué recetas sale y cuánto pide cada una. */
    recipes: i.sourceRecipes.map((r) => ({ recipe: r.recipe, amount: r.qty })),
  }
}

function detailJson(l: ListDetail) {
  let checked = l.items.filter((i) => i.checked).length
  return {
    id: l.id,
    name: l.name,
    status: l.status,
    open: isOpen(l.status),
    menu: l.menuId ? { id: l.menuId, name: l.menuName } : null,
    total: l.items.length,
    checked,
    pending: l.items.length - checked,
    generatedAt: l.generatedAt,
    updatedAt: l.updatedAt,
    items: l.items.map(itemJson),
    sections: sectionsOf(l.items).map((s) => ({
      store: s.storeName,
      aisles: s.aisles.map((a) => ({ aisle: a.aisleName, items: a.items.map(itemJson) })),
    })),
  }
}

const STATUS_FILTER: Record<string, ListSummary['status']> = {
  abierta: 'abierta',
  abiertas: 'abierta',
  completada: 'completada',
  completadas: 'completada',
  cerrada: 'completada',
  cerradas: 'completada',
}

export default createController(routes.api, {
  actions: {
    async lists(context) {
      let request = context.request
      let stop = await guard(request)
      if (stop) return stop

      let estado = context.url.searchParams.get('estado')
      let status = estado ? STATUS_FILTER[estado.toLowerCase()] : undefined
      if (estado && !status) return apiError(request, 400, 'Filtro "estado" inválido: usa "abierta" o "completada".')

      let lists = await listLists(MAX_LISTS)
      if (status) lists = lists.filter((l) => l.status === status)
      return json(request, { lists: lists.map(summaryJson) })
    },

    async list(context) {
      let request = context.request
      let stop = await guard(request)
      if (stop) return stop

      let raw = context.params.id
      let id: number | null
      if (raw === 'actual') {
        // La lista abierta más reciente (lo que normalmente quiere ver la pantalla de la entrada).
        id = (await listLists(MAX_LISTS)).find((l) => isOpen(l.status))?.id ?? null
        if (!id) return apiError(request, 404, 'No hay listas abiertas.')
      } else {
        id = parseId(raw)
        if (!id) return apiError(request, 404, 'Esa lista no existe.')
      }

      try {
        return json(request, detailJson(await getList(id)))
      } catch (error) {
        if (error instanceof UserFacingError && error.status === 404) return apiError(request, 404, 'Esa lista no existe.')
        throw error
      }
    },
  },
})
