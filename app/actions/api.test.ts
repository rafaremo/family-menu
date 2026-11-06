import { eq } from 'drizzle-orm'
import * as assert from 'remix/assert'
import { afterEach, beforeEach, describe, it } from 'remix/test'

import { db } from '../db/client.ts'
import { user } from '../db/schema/index.ts'
import { seedCatalogs } from '../services/catalog-seed.ts'
import { addManualItem, createList, manualItemInput, setItemsChecked, updateList } from '../services/shopping.ts'
import { createToken, listTokens } from '../services/tokens.ts'
import { createUser, login, request, resetDb } from '../../test/helpers.ts'

const MEMBER = { email: 'mon@test.local', password: 'member-secreto-1', name: 'Mon Miembro', role: 'member' as const }

let memberId = ''
let readToken = ''
let fullToken = ''

function api(path: string, init: { method?: string; token?: string | null; headers?: Record<string, string> } = {}) {
  let headers = new Headers(init.headers)
  let token = init.token === undefined ? readToken : init.token
  if (token) headers.set('Authorization', `Bearer ${token}`)
  return request(path, { method: init.method ?? 'GET', headers: Object.fromEntries(headers) })
}

describe('API REST de listas', () => {
  beforeEach(async () => {
    await resetDb()
    await seedCatalogs()
    let u = await createUser(MEMBER)
    memberId = u.id
    let actor = { userId: u.id, via: 'web' as const }
    readToken = (await createToken(actor, { name: 'Pantalla entrada', scope: 'lists:read' })).key
    fullToken = (await createToken(actor, { name: 'Claude Code' })).key
  })

  afterEach(() => {
    delete process.env.API_CORS_ORIGINS
  })

  async function seedLists() {
    let actor = { userId: memberId, via: 'web' as const }
    let old = await createList(actor, 'Súper pasado')
    await updateList(actor, old.id, { status: 'completada' })
    let current = await createList(actor, 'Súper semana')
    let leche = await addManualItem(actor, current.id, manualItemInput.parse({ label: 'leche', quantity: '2', unit: 'l' }))
    await addManualItem(actor, current.id, manualItemInput.parse({ label: 'papel de baño', notes: 'el de 12' }))
    await setItemsChecked(actor, current.id, [leche.id], true)
    return { old, current, leche }
  }

  it('requires a valid bearer token', async () => {
    let missing = await api('/api/v1/listas', { token: null })
    assert.equal(missing.status, 401)
    assert.match((await missing.json()).error, /Falta el token/)
    assert.match(missing.headers.get('WWW-Authenticate') ?? '', /Bearer/)

    assert.equal((await api('/api/v1/listas', { token: 'fm_inventado' })).status, 401)

    // Las cookies de sesión no sirven: la API es solo con token.
    let cookie = await login(MEMBER.email, MEMBER.password)
    let withCookie = await request('/api/v1/listas', { cookie })
    assert.equal(withCookie.status, 401)
  })

  it('lists every list with its status and counts', async () => {
    let { old, current } = await seedLists()
    let res = await api('/api/v1/listas')
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('Cache-Control'), 'no-store')
    let body = await res.json()
    assert.deepEqual(
      body.lists.map((l: any) => [l.id, l.status, l.open, l.total, l.checked, l.pending]),
      [
        [current.id, 'abierta', true, 2, 1, 1],
        [old.id, 'completada', false, 0, 0, 0],
      ],
    )

    let open = await (await api('/api/v1/listas?estado=abierta')).json()
    assert.deepEqual(open.lists.map((l: any) => l.id), [current.id])
    let closed = await (await api('/api/v1/listas?estado=cerradas')).json()
    assert.deepEqual(closed.lists.map((l: any) => l.id), [old.id])
    assert.equal((await api('/api/v1/listas?estado=quien-sabe')).status, 400)
  })

  it('returns a list with items, checked state and sections', async () => {
    let { current } = await seedLists()
    for (let path of [`/api/v1/listas/${current.id}`, '/api/v1/listas/actual']) {
      let res = await api(path)
      assert.equal(res.status, 200, path)
      let body = await res.json()
      assert.equal(body.id, current.id)
      assert.equal(body.open, true)
      assert.equal(body.pending, 1)
      let leche = body.items.find((i: any) => i.label === 'Leche' || i.label === 'leche')
      assert.ok(leche, 'leche en la lista')
      assert.equal(leche.checked, true)
      assert.equal(leche.amount, '2 l')
      let papel = body.items.find((i: any) => /papel/i.test(i.label))
      assert.equal(papel.checked, false)
      assert.equal(papel.notes, 'el de 12')
      let sectionItems = body.sections.flatMap((s: any) => s.aisles.flatMap((a: any) => a.items))
      assert.equal(sectionItems.length, 2)
    }
  })

  it('404s for missing lists and when there is no open list', async () => {
    assert.equal((await api('/api/v1/listas/999')).status, 404)
    assert.equal((await api('/api/v1/listas/abc')).status, 404)
    let none = await api('/api/v1/listas/actual')
    assert.equal(none.status, 404)
    assert.match((await none.json()).error, /No hay listas abiertas/)
  })

  it('is read-only', async () => {
    let { current } = await seedLists()
    let res = await api(`/api/v1/listas/${current.id}`, { method: 'POST', headers: { 'Sec-Fetch-Site': 'same-origin' } })
    assert.equal(res.status, 405)
    assert.match(res.headers.get('Allow') ?? '', /GET/)
  })

  it('also accepts full MCP tokens', async () => {
    assert.equal((await api('/api/v1/listas', { token: fullToken })).status, 200)
  })

  it('answers CORS preflight and sets CORS headers', async () => {
    let preflight = await api('/api/v1/listas', {
      method: 'OPTIONS',
      token: null,
      headers: { Origin: 'https://casa.example', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization' },
    })
    assert.equal(preflight.status, 204)
    assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), '*')
    assert.match(preflight.headers.get('Access-Control-Allow-Headers') ?? '', /Authorization/)

    process.env.API_CORS_ORIGINS = 'https://casa.example, https://otra.example/'
    let allowed = await api('/api/v1/listas', { headers: { Origin: 'https://casa.example' } })
    assert.equal(allowed.headers.get('Access-Control-Allow-Origin'), 'https://casa.example')
    assert.match(allowed.headers.get('Vary') ?? '', /Origin/)
    let denied = await api('/api/v1/listas', { headers: { Origin: 'https://malo.example' } })
    assert.equal(denied.headers.get('Access-Control-Allow-Origin'), null)
    // Los errores también llevan CORS para que el dashboard pueda leer el mensaje.
    let unauthorized = await api('/api/v1/listas', { token: null, headers: { Origin: 'https://casa.example' } })
    assert.equal(unauthorized.status, 401)
    assert.equal(unauthorized.headers.get('Access-Control-Allow-Origin'), 'https://casa.example')
  })

  it('rejects read-only tokens on the MCP endpoint', async () => {
    let res = await request('/mcp', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${readToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
    })
    assert.equal(res.status, 403)
    assert.match(JSON.stringify(await res.json()), /solo lectura/)
  })

  it('stops working when the owner is banned', async () => {
    await db.update(user).set({ banned: true }).where(eq(user.id, memberId))
    let res = await api('/api/v1/listas')
    assert.equal(res.status, 401)
    assert.match((await res.json()).error, /desactivada/)
  })

  it('creates read-only tokens from the account page', async () => {
    let cookie = await login(MEMBER.email, MEMBER.password)
    let res = await request('/cuenta/tokens', { cookie, form: { name: 'Tablet cocina', scope: 'lists:read', expiresInDays: '' } })
    assert.equal(res.status, 200)
    let html = await res.text()
    assert.match(html, /solo leer listas/)
    assert.match(html, /\/api\/v1\/listas/)
    let created = (await listTokens(memberId)).find((t) => t.name === 'Tablet cocina')
    assert.equal(created?.scope, 'lists:read')

    let bad = await request('/cuenta/tokens', { cookie, form: { name: 'Raro', scope: 'admin' } })
    assert.equal(bad.status, 400)
    // Los tokens viejos (sin metadata) siguen siendo de MCP completo.
    assert.equal((await listTokens(memberId)).find((t) => t.name === 'Claude Code')?.scope, 'full')
  })
})

