import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { and, eq } from 'drizzle-orm'
import * as assert from 'remix/assert'
import { afterEach, beforeEach, describe, it } from 'remix/test'

import { db } from '../db/client.ts'
import { auditLog, user } from '../db/schema/index.ts'
import { router } from '../router.ts'
import { readFileSync } from 'node:fs'

import { seedCatalogs } from '../services/catalog-seed.ts'
import { importerTesting } from '../services/importer.ts'
import { createToken, listTokens } from '../services/tokens.ts'
import { createUser, login, ORIGIN, request, resetDb } from '../../test/helpers.ts'

const MEMBER = { email: 'mon@test.local', password: 'member-secreto-1', name: 'Mon Miembro', role: 'member' as const }

let memberId = ''
let token = ''
let clients: Client[] = []

const routerFetch = ((input: RequestInfo | URL, init?: RequestInit) => router.fetch(new Request(input, init))) as typeof fetch

async function connect(options: { key?: string; pathToken?: boolean } = {}): Promise<Client> {
  let key = options.key ?? token
  let url = options.pathToken ? new URL(`/mcp/t/${key}`, ORIGIN) : new URL('/mcp', ORIGIN)
  let transport = new StreamableHTTPClientTransport(url, {
    fetch: routerFetch,
    requestInit: options.pathToken ? {} : { headers: { Authorization: `Bearer ${key}` } },
  })
  let client = new Client({ name: 'test', version: '1.0.0' })
  await client.connect(transport)
  clients.push(client)
  return client
}

type ToolResult = { isError?: boolean; content: { type: string; text?: string }[] }

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  let result = (await client.callTool({ name, arguments: args })) as ToolResult
  let text = result.content.map((c) => c.text ?? '').join('\n')
  let json: any = null
  try {
    json = JSON.parse(text)
  } catch {}
  return { isError: Boolean(result.isError), text, json }
}

function rawMcp(path: string, init: { method?: string; headers?: Record<string, string> } = {}) {
  return router.fetch(
    new Request(new URL(path, ORIGIN), {
      method: init.method ?? 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...init.headers },
      body: init.method === 'GET' ? undefined : JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    }),
  )
}

describe('MCP', () => {
  beforeEach(async () => {
    await resetDb()
    await seedCatalogs()
    let u = await createUser(MEMBER)
    memberId = u.id
    token = (await createToken({ userId: u.id, via: 'web' }, { name: 'Claude Code' })).key
  })

  afterEach(async () => {
    for (let c of clients) await c.close().catch(() => {})
    clients = []
    delete process.env.MCP_ALLOW_PATH_TOKEN
  })

  it('rejects missing, invalid and non-POST requests', async () => {
    let missing = await rawMcp('/mcp')
    assert.equal(missing.status, 401)
    assert.match(missing.headers.get('WWW-Authenticate') ?? '', /Bearer/)
    assert.match(JSON.stringify(await missing.json()), /Falta el token/)

    let invalid = await rawMcp('/mcp', { headers: { Authorization: 'Bearer fm_inventado' } })
    assert.equal(invalid.status, 401)
    assert.equal((await rawMcp('/mcp/t/fm_inventado')).status, 401)

    let get = await rawMcp('/mcp', { method: 'GET', headers: { Authorization: `Bearer ${token}` } })
    assert.equal(get.status, 405)
  })

  it('identifies the token owner and lists every tool', async () => {
    let client = await connect()
    let me = await call(client, 'whoami')
    assert.equal(me.json.email, MEMBER.email)
    assert.equal(me.json.role, 'member')

    let { tools } = await client.listTools()
    let names = tools.map((t) => t.name).sort()
    for (let expected of [
      'whoami', 'search_recipes', 'get_recipe', 'create_recipe', 'update_recipe', 'delete_recipe', 'scale_recipe', 'toggle_favorite',
      'search_ingredients', 'create_ingredient', 'update_ingredient', 'merge_ingredients',
      'list_tags', 'list_aisles', 'list_stores', 'list_units',
      'list_menus', 'get_menu', 'create_menu', 'add_menu_item', 'update_menu_item', 'remove_menu_item', 'copy_menu',
      'generate_shopping_list', 'get_shopping_list', 'add_list_item', 'check_list_items', 'export_shopping_list',
      'import_recipe_from_url',
    ]) {
      assert.ok(names.includes(expected), `falta la herramienta ${expected}`)
    }
    assert.ok(!names.some((n) => /member|user|token/.test(n)), 'la gestión de usuarios no se expone por MCP')
    let del = tools.find((t) => t.name === 'delete_recipe')!
    assert.equal(del.annotations?.destructiveHint, true)
    assert.match(client.getInstructions() ?? '', /Family Menu/)
  })

  it('accepts the token in the path (and can be disabled)', async () => {
    let client = await connect({ pathToken: true })
    assert.equal((await call(client, 'whoami')).json.name, MEMBER.name)

    process.env.MCP_ALLOW_PATH_TOKEN = 'false'
    assert.equal((await rawMcp(`/mcp/t/${token}`)).status, 404)
  })

  it('stops working once revoked from the dashboard, or when the owner is banned', async () => {
    let client = await connect()
    assert.equal((await call(client, 'whoami')).isError, false)

    let cookie = await login(MEMBER.email, MEMBER.password)
    let [summary] = await listTokens(memberId)
    let revoked = await request(`/cuenta/tokens/${summary!.id}/revocar`, { cookie, form: {} })
    assert.equal(revoked.status, 303)
    assert.equal((await rawMcp('/mcp', { headers: { Authorization: `Bearer ${token}` } })).status, 401)

    let other = (await createToken({ userId: memberId, via: 'web' }, { name: 'Otro' })).key
    await db.update(user).set({ banned: true }).where(eq(user.id, memberId))
    let banned = await rawMcp('/mcp', { headers: { Authorization: `Bearer ${other}` } })
    assert.equal(banned.status, 401)
    assert.match(JSON.stringify(await banned.json()), /desactivada/)
  })

  it('Claude creates a recipe, plans a menu and generates the shopping list', async () => {
    let client = await connect()

    let found = await call(client, 'search_ingredients', { query: 'tomate' })
    assert.equal(found.json[0].name, 'Jitomate')

    let created = await call(client, 'create_recipe', {
      title: 'Enfrijoladas',
      family_credit: 'tía Mari',
      servings: 4,
      tags: ['Platos fuertes', 'económica'],
      steps: ['Licúa los frijoles con caldo.', 'Pasa las tortillas por la salsa.', 'Sirve con queso y crema.'],
      ingredients: [
        { ingredient: 'frijoles', quantity: 3, unit: 'taza' },
        { ingredient: 'tortillas', quantity: 12 },
        { ingredient: 'queso fresco', quantity: 200, unit: 'g' },
        { ingredient: 'crema', quantity: '1/2', unit: 'taza', optional: true },
        { ingredient: 'chile chipotle seco', quantity: 2, preparation: 'tostado' },
      ],
    })
    assert.equal(created.isError, false, created.text)
    assert.equal(created.json.recipe.slug, 'enfrijoladas')
    assert.deepEqual(created.json.createdIngredients, ['Chile chipotle seco'])
    assert.deepEqual(created.json.createdTags, ['económica'])
    assert.equal(created.json.recipe.ingredients[0].ingredient, 'Frijol negro')

    let search = await call(client, 'search_recipes', { query: 'tia mari' })
    assert.equal(search.json.recipes[0].title, 'Enfrijoladas')

    let scaled = await call(client, 'scale_recipe', { recipe: 'enfrijoladas', servings: 8 })
    assert.ok(scaled.json.ingredients.includes('6 tazas Frijol negro'), scaled.text)

    let menu = await call(client, 'create_menu', { week: '2026-11-04', default_servings: 4 })
    assert.equal(menu.json.weekStart, '2026-11-02')
    for (let date of ['2026-11-02', '2026-11-05']) {
      let added = await call(client, 'add_menu_item', { menu_id: menu.json.id, date, meal: 'cena', recipe: 'Enfrijoladas', servings: 6 })
      assert.equal(added.isError, false, added.text)
    }

    let list = await call(client, 'generate_shopping_list', { menu_id: menu.json.id })
    assert.equal(list.isError, false, list.text)
    let items = list.json.stores.flatMap((s: any) => s.aisles.flatMap((a: any) => a.items))
    let byLabel = new Map(items.map((i: any) => [i.label, i]))
    // 12 tortillas × 6/4 × 2 = 36 pz; 3 tazas = 720 ml × 0.8 g/ml × 1.5 × 2 = 1728 g → 1.73 kg
    assert.equal((byLabel.get('Tortilla de maíz') as any).amount, '36 pz')
    assert.equal((byLabel.get('Frijol negro') as any).amount, '1.73 kg')
    assert.equal(byLabel.has('Crema'), false)

    let target = byLabel.get('Tortilla de maíz') as any
    let checked = await call(client, 'check_list_items', { list_id: list.json.id, item_ids: [target.itemId] })
    assert.equal(checked.json.updated, 1)
    await call(client, 'add_list_item', { list_id: list.json.id, label: 'servilletas', quantity: 1, unit: 'paquete' })

    let text = await call(client, 'export_shopping_list', { list_id: list.json.id })
    assert.match(text.text, /Frijol negro — 1.73 kg/)
    assert.match(text.text, /servilletas — 1 paquete/)
    assert.doesNotMatch(text.text, /Tortilla de maíz/)

    let week = await call(client, 'get_menu', { week: '2026-11-03' })
    assert.equal(week.json.days[3].meals[0].recipe, 'Enfrijoladas')

    // Todo quedó en la bitácora como "mcp".
    let logs = await db.select().from(auditLog).where(and(eq(auditLog.via, 'mcp'), eq(auditLog.userId, memberId)))
    assert.ok(logs.some((l) => l.entity === 'recipe' && l.action === 'create'))
    assert.ok(logs.some((l) => l.entity === 'shopping_list' && l.action === 'generate'))
    assert.ok(logs.filter((l) => l.action === 'tool_call').length >= 10)
  })

  it('returns Spanish errors the model can act on', async () => {
    let client = await connect()
    let missing = await call(client, 'get_recipe', { recipe: 'pozole' })
    assert.equal(missing.isError, true)
    assert.match(missing.text, /No encontré la receta "pozole"/)

    let bad = await call(client, 'create_recipe', { title: 'Mala', ingredients: [{ ingredient: 'sal', quantity: 'mucha' }] })
    assert.equal(bad.isError, true)
    assert.match(bad.text, /ingredients\.0\.quantity: Cantidad no válida/)

    let unit = await call(client, 'create_recipe', { title: 'Rara', ingredients: [{ ingredient: 'sal', quantity: 1, unit: 'puñito' }] })
    assert.match(unit.text, /No conozco la unidad "puñito"/)

    let typo = await call(client, 'update_ingredient', { ingredient: 'jitomte', notes: 'x' })
    assert.match(typo.text, /¿Quisiste decir: Jitomate/)

    let noConfirm = await call(client, 'delete_recipe', { recipe: 'x' })
    assert.equal(noConfirm.isError, true)

    let aisle = await call(client, 'update_ingredient', { ingredient: 'jitomate', aisle: 'Juguetería' })
    assert.match(aisle.text, /No existe el pasillo "Juguetería"/)
    let moved = await call(client, 'update_ingredient', { ingredient: 'jitomate', store: 'costco', grams_per_piece: 110 })
    assert.equal(moved.json.store, 'Costco')
    assert.equal(moved.json.gramsPerPiece, 110)
  })

  it('imports a recipe draft from a URL, then saves it (reporting a blocked photo)', async () => {
    importerTesting.fetchHtml = async (url) => ({
      url,
      html: readFileSync(new URL('../../test/fixtures/recipes/wordpress-yoast.html', import.meta.url), 'utf8'),
    })
    try {
      let client = await connect()
      let imported = await call(client, 'import_recipe_from_url', { url: 'https://ejemplo.mx/pozole/' })
      assert.equal(imported.isError, false, imported.text)
      let draft = imported.json.draft
      assert.equal(draft.title, 'Pozole rojo de la casa')
      assert.equal(draft.servings, 8)
      assert.deepEqual(imported.json.newIngredients, ['Maíz pozolero precocido', 'Lechuga', 'Rábanos'].filter((n: string) => imported.json.newIngredients.includes(n)))
      let lomo = draft.ingredients.find((i: any) => i.original === '1 kg de lomo de cerdo en trozos')
      assert.deepEqual([lomo.ingredient, lomo.quantity, lomo.unit, lomo.matched], ['Lomo de cerdo', 1, 'kg', true])

      let saved = await call(client, 'create_recipe', {
        title: draft.title,
        servings: draft.servings,
        steps: draft.steps,
        source_url: draft.source_url,
        image_url: 'http://127.0.0.1/foto.jpg',
        ingredients: draft.ingredients.map(({ matched, original, ...rest }: any) => rest),
      })
      assert.equal(saved.isError, false, saved.text)
      assert.equal(saved.json.recipe.sourceUrl, 'https://ejemplo.mx/pozole/')
      assert.match(saved.json.photo, /no se pudo guardar: Esa dirección no está permitida/)
    } finally {
      importerTesting.fetchHtml = null
    }
  })

  it('exposes recipes and menus as resources, and the planning prompts', async () => {
    let client = await connect()
    await call(client, 'create_recipe', {
      title: 'Sopa de lentejas',
      servings: 6,
      ingredients: [{ ingredient: 'lentejas', quantity: 500, unit: 'g', group: 'Base' }],
      steps: ['Remoja.', 'Cuece.'],
    })
    await call(client, 'toggle_favorite', { recipe: 'sopa-de-lentejas', favorite: true })

    let { resources } = await client.listResources()
    assert.ok(resources.some((r) => r.uri === 'recipe://sopa-de-lentejas'))
    let read = await client.readResource({ uri: 'recipe://sopa-de-lentejas' })
    let md = (read.contents[0] as { text: string }).text
    assert.match(md, /^# Sopa de lentejas/)
    assert.match(md, /### Base\n- 500 gramos Lenteja/)
    assert.match(md, /1\. Remoja\./)

    let menu = await call(client, 'create_menu', { week: '2026-11-02' })
    let menuMd = await client.readResource({ uri: `menu://${menu.json.id}` })
    assert.match((menuMd.contents[0] as { text: string }).text, /## Lunes 2 de nov/)

    let { prompts } = await client.listPrompts()
    assert.deepEqual(prompts.map((p) => p.name).sort(), ['capturar_receta', 'planear_semana'])
    let plan = await client.getPrompt({ name: 'planear_semana', arguments: { semana: '2026-11-11', notas: 'cenas ligeras' } })
    let planText = (plan.messages[0]!.content as { text: string }).text
    assert.match(planText, /2026-11-09/)
    assert.match(planText, /Mis favoritas: Sopa de lentejas/)
    assert.match(planText, /cenas ligeras/)
  })
})

describe('dashboard: tokens MCP', () => {
  beforeEach(async () => {
    await resetDb()
    await createUser(MEMBER)
  })

  it('creates a token shown once with ready-to-paste snippets, then lists and revokes it', async () => {
    let cookie = await login(MEMBER.email, MEMBER.password)
    let empty = await (await request('/cuenta', { cookie })).text()
    assert.match(empty, /Aún no tienes tokens/)

    let created = await request('/cuenta/tokens', { cookie, form: { name: 'Claude Code laptop', expiresInDays: '90' } })
    assert.equal(created.status, 200)
    assert.equal(created.headers.get('Cache-Control'), 'no-store')
    let html = await created.text()
    let key = html.match(/id="new-token-key"[^>]*value="(fm_[^"]+)"/)?.[1] ?? html.match(/value="(fm_[^"]+)"[^>]*id="new-token-key"/)?.[1]
    assert.ok(key, 'el token se muestra')
    assert.match(html, /claude mcp add --transport http family-menu http:\/\/localhost:3010\/mcp/)
    assert.match(html, new RegExp(`/mcp/t/${key}`))
    assert.match(html, /mcp-remote/)

    let later = await (await request('/cuenta', { cookie })).text()
    assert.match(later, /Claude Code laptop/)
    assert.doesNotMatch(later, new RegExp(key!))
    assert.match(later, new RegExp(`${key!.slice(0, 6)}…`))

    let bad = await request('/cuenta/tokens', { cookie, form: { name: '  ' } })
    assert.equal(bad.status, 400)
    assert.match(await bad.text(), /Ponle un nombre al token/)

    // Otro miembro no puede revocar tokens ajenos.
    await createUser({ email: 'otro@test.local', password: 'otro-secreto-1', name: 'Otro', role: 'admin' })
    let otherCookie = await login('otro@test.local', 'otro-secreto-1')
    let [mine] = await listTokens((await db.select().from(user).where(eq(user.email, MEMBER.email)))[0]!.id)
    assert.equal((await request(`/cuenta/tokens/${mine!.id}/revocar`, { cookie: otherCookie, form: {} })).status, 404)
    assert.equal((await request(`/cuenta/tokens/${mine!.id}/revocar`, { cookie, form: {} })).status, 303)
  })
})
