import { eq } from 'drizzle-orm'
import * as assert from 'remix/assert'
import { beforeEach, describe, it } from 'remix/test'

import { db } from '../db/client.ts'
import { aisle, ingredient, store, tag, unit } from '../db/schema/index.ts'
import { seedCatalogs } from '../services/catalog-seed.ts'
import { findIngredientByName } from '../services/ingredients.ts'
import { createUser, login, request, resetDb } from '../../test/helpers.ts'

const ADMIN = { email: 'admin@test.local', password: 'admin-secreto-1', name: 'Rafa Admin', role: 'admin' as const }
const MEMBER = { email: 'mon@test.local', password: 'member-secreto-1', name: 'Mon Miembro', role: 'member' as const }

let adminCookie = ''
let memberCookie = ''

async function setup() {
  await resetDb()
  await seedCatalogs()
  await createUser(ADMIN)
  await createUser(MEMBER)
  adminCookie = await login(ADMIN.email, ADMIN.password)
  memberCookie = await login(MEMBER.email, MEMBER.password)
}

const emptyIngredient = {
  name: '',
  aliases: '',
  aisleId: '',
  defaultStoreId: '',
  defaultUnit: '',
  densityGPerMl: '',
  gramsPerPiece: '',
  notes: '',
}

describe('dashboard: ingredientes', () => {
  beforeEach(setup)

  it('requires login', async () => {
    let response = await request('/ingredientes')
    assert.equal(response.status, 303)
    assert.equal(response.headers.get('Location'), '/login?redirectTo=%2Fingredientes')
  })

  it('lists and searches (fuzzy, by alias)', async () => {
    let list = await request('/ingredientes', { cookie: memberCookie })
    assert.equal(list.status, 200)
    let html = await list.text()
    assert.match(html, /Aguacate/)
    assert.match(html, /href="\/ingredientes"[^>]*aria-current="page"/)

    let search = await (await request('/ingredientes?q=tomate', { cookie: memberCookie })).text()
    assert.match(search, /Jitomate/)
    assert.doesNotMatch(search, /Aguacate/)

    let typo = await (await request('/ingredientes?q=jitomte', { cookie: memberCookie })).text()
    assert.match(typo, /Jitomate/)

    let none = await (await request('/ingredientes?q=qqqzzz', { cookie: memberCookie })).text()
    assert.match(none, /Nada coincide/)
  })

  it('paginates', async () => {
    let html = await (await request('/ingredientes', { cookie: memberCookie })).text()
    assert.match(html, /Página 1 de 2/)
    let page2 = await request('/ingredientes?pagina=2', { cookie: memberCookie })
    assert.match(await page2.text(), /Página 2 de 2/)
  })

  it('a member creates, edits and deletes an ingredient', async () => {
    let [frutas] = await db.select().from(aisle).where(eq(aisle.name, 'Frutas y verduras'))
    let created = await request('/ingredientes', {
      cookie: memberCookie,
      form: {
        ...emptyIngredient,
        name: 'Nopal',
        aliases: 'nopales, nopalitos',
        aisleId: String(frutas!.id),
        defaultUnit: 'pz',
        gramsPerPiece: '80',
      },
    })
    assert.equal(created.status, 303)
    let location = created.headers.get('Location')!
    assert.match(location, /^\/ingredientes\/\d+\?ok=created$/)

    let edit = await request(location, { cookie: memberCookie })
    let html = await edit.text()
    assert.match(html, /Ingrediente creado/)
    assert.match(html, /value="Nopal"/)

    let nopal = (await findIngredientByName('nopalitos'))!
    assert.equal(nopal.gramsPerPiece, 80)

    let updated = await request(`/ingredientes/${nopal.id}`, {
      cookie: memberCookie,
      form: { ...emptyIngredient, name: 'Nopal', aliases: 'nopales', defaultUnit: 'kg', notes: 'Ya limpios' },
    })
    assert.equal(updated.status, 303)
    let after = (await findIngredientByName('nopal'))!
    assert.deepEqual(after.aliases, ['nopales'])
    assert.equal(after.defaultUnit, 'kg')
    assert.equal(after.aisleId, null)
    assert.equal(after.gramsPerPiece, null)

    let deleted = await request(`/ingredientes/${nopal.id}/eliminar`, { cookie: memberCookie, form: {} })
    assert.equal(deleted.status, 303)
    assert.equal(deleted.headers.get('Location'), '/ingredientes?ok=deleted')
    assert.equal(await findIngredientByName('nopal'), null)
  })

  it('shows validation and duplicate errors, keeping what was typed', async () => {
    let invalid = await request('/ingredientes', {
      cookie: memberCookie,
      form: { ...emptyIngredient, name: '', aliases: 'algo', gramsPerPiece: 'mucho' },
    })
    assert.equal(invalid.status, 400)
    let html = await invalid.text()
    assert.match(html, /Escribe un nombre/)
    assert.match(html, /Gramos por pieza: escribe un número/)
    assert.match(html, /algo/)

    let dup = await request('/ingredientes', { cookie: memberCookie, form: { ...emptyIngredient, name: 'TOMATE' } })
    assert.equal(dup.status, 400)
    assert.match(await dup.text(), /ya es alias de &quot;Jitomate&quot;|ya es alias de "Jitomate"/)
  })

  it('merges duplicates from the edit page', async () => {
    let created = await request('/ingredientes', {
      cookie: memberCookie,
      form: { ...emptyIngredient, name: 'Aguacate hass' },
    })
    let dupId = created.headers.get('Location')!.match(/\/ingredientes\/(\d+)/)![1]
    let aguacate = (await findIngredientByName('aguacate'))!

    let merged = await request(`/ingredientes/${dupId}/fusionar`, {
      cookie: memberCookie,
      form: { targetId: String(aguacate.id) },
    })
    assert.equal(merged.status, 303)
    assert.equal(merged.headers.get('Location'), `/ingredientes/${aguacate.id}?ok=merged`)
    assert.equal((await findIngredientByName('aguacate hass'))?.id, aguacate.id)

    let missingTarget = await request(`/ingredientes/${aguacate.id}/fusionar`, { cookie: memberCookie, form: { targetId: '' } })
    assert.equal(missingTarget.status, 400)
  })

  it('returns 404 for unknown ingredients', async () => {
    assert.equal((await request('/ingredientes/999999', { cookie: memberCookie })).status, 404)
    assert.equal((await request('/ingredientes/abc', { cookie: memberCookie })).status, 404)
    let post = await request('/ingredientes/999999/eliminar', { cookie: memberCookie, form: {} })
    assert.equal(post.status, 404)
  })

  it('renders the new-ingredient form (not captured by /:id)', async () => {
    let response = await request('/ingredientes/nuevo?nombre=Pitaya', { cookie: memberCookie })
    assert.equal(response.status, 200)
    let html = await response.text()
    assert.match(html, /Nuevo ingrediente/)
    assert.match(html, /value="Pitaya"/)
  })
})

describe('dashboard: catálogos (admin)', () => {
  beforeEach(setup)

  it('is admin-only', async () => {
    assert.equal((await request('/catalogos', { cookie: memberCookie })).status, 403)
    let post = await request('/catalogos/pasillos', { cookie: memberCookie, form: { name: 'Hackeo' } })
    assert.equal(post.status, 403)
    assert.equal((await db.select().from(aisle).where(eq(aisle.name, 'Hackeo'))).length, 0)

    let home = await (await request('/', { cookie: memberCookie })).text()
    assert.doesNotMatch(home, /href="\/catalogos"/)
  })

  it('shows every catalog', async () => {
    let response = await request('/catalogos', { cookie: adminCookie })
    assert.equal(response.status, 200)
    let html = await response.text()
    for (let text of ['Frutas y verduras', 'City Market', 'cucharadita', 'Sopas y caldos']) {
      assert.match(html, new RegExp(text))
    }
  })

  it('creates, renames and deletes aisles (ingredients lose the aisle)', async () => {
    let created = await request('/catalogos/pasillos', { cookie: adminCookie, form: { name: 'Mascotas', sortOrder: '' } })
    assert.equal(created.status, 303)
    assert.equal(created.headers.get('Location'), '/catalogos?ok=created#pasillos')
    let [mascotas] = await db.select().from(aisle).where(eq(aisle.name, 'Mascotas'))
    assert.equal(mascotas?.sortOrder, 130)

    let dup = await request('/catalogos/pasillos', { cookie: adminCookie, form: { name: 'mascotas' } })
    assert.equal(dup.status, 409)
    assert.match(await dup.text(), /Ya existe un pasillo con ese nombre/)

    let renamed = await request(`/catalogos/pasillos/${mascotas!.id}`, {
      cookie: adminCookie,
      form: { name: 'Mascotas y bebé', sortOrder: '5' },
    })
    assert.equal(renamed.status, 303)
    let [row] = await db.select().from(aisle).where(eq(aisle.id, mascotas!.id))
    assert.equal(row?.name, 'Mascotas y bebé')
    assert.equal(row?.sortOrder, 5)

    let [lacteos] = await db.select().from(aisle).where(eq(aisle.name, 'Lácteos y huevo'))
    let del = await request(`/catalogos/pasillos/${lacteos!.id}/eliminar`, { cookie: adminCookie, form: {} })
    assert.equal(del.status, 303)
    let leche = await findIngredientByName('leche')
    assert.equal(leche?.aisleId, null)
  })

  it('manages stores', async () => {
    let created = await request('/catalogos/tiendas', { cookie: adminCookie, form: { name: 'Mercado de Coyoacán' } })
    assert.equal(created.status, 303)
    let [row] = await db.select().from(store).where(eq(store.name, 'Mercado de Coyoacán'))
    assert.ok(row)
    let del = await request(`/catalogos/tiendas/${row!.id}/eliminar`, { cookie: adminCookie, form: {} })
    assert.equal(del.status, 303)
  })

  it('manages units with validation', async () => {
    let bad = await request('/catalogos/unidades', {
      cookie: adminCookie,
      form: { code: 'bolsa', name: 'bolsa', plural: 'bolsas', dimension: 'mass', toBase: '' },
    })
    assert.equal(bad.status, 400)
    let html = await bad.text()
    assert.match(html, /Escribe la equivalencia/)
    assert.match(html, /value="bolsa"/)

    let ok = await request('/catalogos/unidades', {
      cookie: adminCookie,
      form: { code: 'bolsa', name: 'bolsa', plural: 'bolsas', dimension: 'mass', toBase: '500' },
    })
    assert.equal(ok.status, 303)
    let [bolsa] = await db.select().from(unit).where(eq(unit.code, 'bolsa'))
    assert.equal(bolsa?.toBase, 500)

    let dup = await request('/catalogos/unidades', {
      cookie: adminCookie,
      form: { code: 'bolsa', name: 'bolsa', plural: 'bolsas', dimension: 'other' },
    })
    assert.equal(dup.status, 409)

    let edit = await request('/catalogos/unidades/taza', {
      cookie: adminCookie,
      form: { name: 'taza', plural: 'tazas', dimension: 'volume', toBase: '250', sortOrder: '70' },
    })
    assert.equal(edit.status, 303)
    let [taza] = await db.select().from(unit).where(eq(unit.code, 'taza'))
    assert.equal(taza?.toBase, 250)

    let inUse = await request('/catalogos/unidades/g/eliminar', { cookie: adminCookie, form: {} })
    assert.equal(inUse.status, 409)
    assert.match(await inUse.text(), /la usan como unidad por defecto/)

    let del = await request('/catalogos/unidades/bolsa/eliminar', { cookie: adminCookie, form: {} })
    assert.equal(del.status, 303)

    let missing = await request('/catalogos/unidades/nope/eliminar', { cookie: adminCookie, form: {} })
    assert.equal(missing.status, 404)
  })

  it('manages tags', async () => {
    let created = await request('/catalogos/etiquetas', { cookie: adminCookie, form: { name: 'Día de Muertos', kind: 'occasion' } })
    assert.equal(created.status, 303)
    let [row] = await db.select().from(tag).where(eq(tag.slug, 'dia-de-muertos'))
    assert.equal(row?.kind, 'occasion')

    let dup = await request('/catalogos/etiquetas', { cookie: adminCookie, form: { name: 'dia de muertos', kind: 'free' } })
    assert.equal(dup.status, 409)

    let renamed = await request(`/catalogos/etiquetas/${row!.id}`, { cookie: adminCookie, form: { name: 'Muertos', kind: 'free' } })
    assert.equal(renamed.status, 303)
    let [after] = await db.select().from(tag).where(eq(tag.id, row!.id))
    assert.equal(after?.slug, 'muertos')

    let del = await request(`/catalogos/etiquetas/${row!.id}/eliminar`, { cookie: adminCookie, form: {} })
    assert.equal(del.status, 303)
    assert.equal((await db.select().from(ingredient)).length > 0, true)
  })
})
