import * as assert from 'remix/assert'
import { beforeEach, describe, it } from 'remix/test'

import { db } from '../db/client.ts'
import { menu, shoppingList } from '../db/schema/index.ts'
import { addDays, mondayOf, todayIso } from '../lib/dates.ts'
import { seedCatalogs } from '../services/catalog-seed.ts'
import { createRecipe, recipeInput } from '../services/recipes.ts'
import { getList } from '../services/shopping.ts'
import { createUser, login, request, resetDb } from '../../test/helpers.ts'

const MEMBER = { email: 'mon@test.local', password: 'member-secreto-1', name: 'Mon Miembro', role: 'member' as const }
let cookie = ''
let tingaId = 0

describe('dashboard: menús y listas', () => {
  beforeEach(async () => {
    await resetDb()
    await seedCatalogs()
    let u = await createUser(MEMBER)
    cookie = await login(MEMBER.email, MEMBER.password)
    let tinga = await createRecipe(
      { userId: u.id, via: 'web' },
      recipeInput.parse({
        title: 'Tinga de pollo',
        servings: 4,
        ingredients: [
          { ingredient: 'pechuga', quantity: 500, unit: 'g' },
          { ingredient: 'jitomate', quantity: 3 },
          { ingredient: 'sal' },
        ],
      }),
    )
    tingaId = tinga.recipe.id
  })

  it('requires login', async () => {
    assert.equal((await request('/menus')).status, 303)
    assert.equal((await request('/listas')).status, 303)
  })

  it('plans this week from home, adds dishes and generates the list', async () => {
    let home = await (await request('/', { cookie })).text()
    assert.match(home, /Todavía no hay menú para esta semana/)

    let created = await request('/menus', { cookie, form: { weekStart: todayIso() } })
    assert.equal(created.status, 303)
    let menuUrl = created.headers.get('Location')!.split('?')[0]!
    assert.match(menuUrl, /^\/menus\/\d+$/)

    let page = await (await request(created.headers.get('Location')!, { cookie })).text()
    assert.match(page, /Menú creado/)
    assert.match(page, /Tinga de pollo/) // en el select de recetas
    assert.match(page, /class="week-row today"/)

    let today = todayIso()
    let added = await request(`${menuUrl}/platillos`, {
      cookie,
      form: { date: today, meal: 'comida', recipe: String(tingaId), servings: '8' },
    })
    assert.equal(added.status, 303)
    let withItem = await (await request(menuUrl, { cookie })).text()
    assert.match(withItem, /href="\/recetas\/tinga-de-pollo\?porciones=8"/)
    assert.match(withItem, /8 porc\./)

    let outside = await request(`${menuUrl}/platillos`, {
      cookie,
      form: { date: addDays(mondayOf(today), 7), meal: 'comida', recipe: String(tingaId) },
    })
    assert.equal(outside.status, 400)
    assert.match(await outside.text(), /no está en la semana/)

    let home2 = await (await request('/', { cookie })).text()
    assert.match(home2, /Tinga de pollo/)
    assert.match(home2, /Hoy, /)

    let generated = await request(`${menuUrl}/lista`, { cookie, form: {} })
    assert.equal(generated.status, 303)
    let listUrl = generated.headers.get('Location')!.split('?')[0]!
    assert.match(listUrl, /^\/listas\/\d+$/)

    let list = await (await request(`${listUrl}?ok=generated`, { cookie })).text()
    assert.match(list, /Pechuga de pollo/)
    assert.match(list, /1 kg/)
    assert.match(list, /Frutas y verduras/)
    assert.match(list, /0<\/span>\/3/)
    assert.match(list, /data-enhance="toggle"/)
  })

  it('checks items with and without JavaScript, adds manual items and exports', async () => {
    let created = await request('/menus', { cookie, form: { weekStart: '2026-11-02' } })
    let menuUrl = created.headers.get('Location')!.split('?')[0]!
    await request(`${menuUrl}/platillos`, { cookie, form: { date: '2026-11-03', meal: 'cena', recipe: String(tingaId) } })
    let listUrl = (await request(`${menuUrl}/lista`, { cookie, form: {} })).headers.get('Location')!.split('?')[0]!
    let listId = Number(listUrl.split('/').pop())
    let items = (await getList(listId)).items
    let pechuga = items.find((i) => i.label === 'Pechuga de pollo')!
    let sal = items.find((i) => i.label === 'Sal')!

    // Con JS: 204 sin recargar.
    let enhanced = await request(`${listUrl}/articulos/${pechuga.id}/marcar`, {
      cookie,
      form: { checked: '1' },
      headers: { 'X-Requested-With': 'fetch' },
    })
    assert.equal(enhanced.status, 204)
    // Sin JS: redirige a la lista (conservando el filtro "ocultar").
    let plain = await request(`${listUrl}/articulos/${sal.id}/marcar`, {
      cookie,
      form: { checked: '1' },
      headers: { Referer: `http://localhost:3010${listUrl}?ocultar=1` },
    })
    assert.equal(plain.status, 303)
    assert.equal(plain.headers.get('Location'), `${listUrl}?ocultar=1#item-${sal.id}`)

    let hidden = await (await request(`${listUrl}?ocultar=1`, { cookie })).text()
    assert.doesNotMatch(hidden, /Pechuga de pollo<\/span>/)
    assert.match(hidden, /Jitomate/)
    assert.match(hidden, /Mostrar comprados/)

    let manual = await request(`${listUrl}/articulos`, { cookie, form: { label: 'Papel de baño', quantity: '2', unit: 'paquete' } })
    assert.equal(manual.status, 303)
    let bad = await request(`${listUrl}/articulos`, { cookie, form: { label: '', quantity: 'mucho' } })
    assert.equal(bad.status, 400)

    let text = await request(`${listUrl}/texto`, { cookie })
    assert.equal(text.headers.get('Content-Type'), 'text/plain; charset=utf-8')
    let body = await text.text()
    assert.match(body, /• Jitomate — 360 g/)
    assert.match(body, /• Papel de baño — 2 paquetes/)
    assert.doesNotMatch(body, /Pechuga/)
    assert.match(await (await request(`${listUrl}/texto?todo=1`, { cookie })).text(), /✅ Pechuga de pollo — 500 g/)

    let regenerated = await request(`${listUrl}/regenerar`, { cookie, form: {} })
    assert.equal(regenerated.status, 303)
    let after = (await getList(listId)).items
    assert.equal(after.find((i) => i.label === 'Pechuga de pollo')!.checked, true)
    assert.ok(after.find((i) => i.label === 'Papel de baño'))

    let cleared = await request(`${listUrl}/limpiar`, { cookie, form: {} })
    assert.equal(cleared.status, 303)
    assert.equal((await getList(listId)).items.length, 2)

    let done = await request(listUrl, { cookie, form: { name: 'Súper del martes', status: 'completada' } })
    assert.equal(done.status, 303)
    let index = await (await request('/listas', { cookie })).text()
    assert.match(index, /Súper del martes/)
    assert.match(index, /Completada/)
  })

  it('copies and deletes menus; lists survive their menu', async () => {
    let created = await request('/menus', { cookie, form: { weekStart: '2026-11-02', name: 'Semana de prueba' } })
    let menuUrl = created.headers.get('Location')!.split('?')[0]!
    await request(`${menuUrl}/platillos`, { cookie, form: { date: '2026-11-04', meal: 'comida', recipe: String(tingaId) } })
    await request(`${menuUrl}/lista`, { cookie, form: {} })

    let copied = await request(`${menuUrl}/copiar`, { cookie, form: { weekStart: '2026-11-09' } })
    assert.equal(copied.status, 303)
    let copyPage = await (await request(copied.headers.get('Location')!, { cookie })).text()
    assert.match(copyPage, /Semana del 9 nov/)
    assert.match(copyPage, /Tinga de pollo/)

    let del = await request(`${menuUrl}/eliminar`, { cookie, form: {} })
    assert.equal(del.headers.get('Location'), '/menus?ok=deleted')
    assert.equal((await db.select().from(menu)).length, 1)
    let [list] = await db.select().from(shoppingList)
    assert.equal(list?.menuId, null)
  })

  it('creates loose lists and 404s unknown ids', async () => {
    let created = await request('/listas', { cookie, form: { name: 'Costco del sábado' } })
    assert.equal(created.status, 303)
    let page = await (await request(created.headers.get('Location')!, { cookie })).text()
    assert.match(page, /La lista está vacía/)
    assert.doesNotMatch(page, /Actualizar desde el menú/)

    assert.equal((await request('/menus/999999', { cookie })).status, 404)
    assert.equal((await request('/listas/999999', { cookie })).status, 404)
    assert.equal((await request('/listas/abc/articulos/1/marcar', { cookie, form: { checked: '1' } })).status, 404)
    let wrongItem = await request(`${created.headers.get('Location')!.split('?')[0]}/articulos/999/marcar`, {
      cookie,
      form: { checked: '1' },
      headers: { 'X-Requested-With': 'fetch' },
    })
    assert.equal(wrongItem.status, 404)
  })
})
