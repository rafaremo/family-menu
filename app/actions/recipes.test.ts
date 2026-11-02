import * as assert from 'remix/assert'
import { beforeEach, describe, it } from 'remix/test'

import { db } from '../db/client.ts'
import { recipe } from '../db/schema/index.ts'
import { seedCatalogs } from '../services/catalog-seed.ts'
import { getRecipeBySlug } from '../services/recipes.ts'
import { createUser, login, request, resetDb, TINY_PNG } from '../../test/helpers.ts'

const MEMBER = { email: 'mon@test.local', password: 'member-secreto-1', name: 'Mon Miembro', role: 'member' as const }
let cookie = ''

function recipeForm(fields: Record<string, string>, rows: Record<string, string>[] = []): FormData {
  let form = new FormData()
  for (let [k, v] of Object.entries(fields)) form.set(k, v)
  form.set('rowCount', String(rows.length))
  rows.forEach((row, i) => {
    for (let [k, v] of Object.entries(row)) form.set(`ing[${i}][${k}]`, v)
  })
  return form
}

const BASE = { title: 'Tinga de pollo', servings: '4', prepMinutes: '15', cookMinutes: '30', steps: 'Cocer.\nDeshebrar.' }
const ROWS: Record<string, string>[] = [
  { quantity: '500', unit: 'g', ingredient: 'Pechuga de pollo', preparation: 'deshebrada' },
  { quantity: '1 1/2', unit: 'taza', ingredient: 'puré de tomate', group: 'Salsa' },
  { quantity: '', unit: '', ingredient: '', preparation: '' },
  { quantity: '', unit: '', ingredient: 'sal' },
]

describe('dashboard: recetas', () => {
  beforeEach(async () => {
    await resetDb()
    await seedCatalogs()
    await createUser(MEMBER)
    cookie = await login(MEMBER.email, MEMBER.password)
  })

  it('requires login, also for photos', async () => {
    assert.equal((await request('/recetas')).status, 303)
    assert.equal((await request('/fotos/00000000-0000-0000-0000-000000000000.png')).status, 303)
  })

  it('shows an empty state and the editor', async () => {
    let list = await (await request('/recetas', { cookie })).text()
    assert.match(list, /Aún no hay recetas/)
    let editor = await request('/recetas/nueva', { cookie })
    assert.equal(editor.status, 200)
    let html = await editor.text()
    assert.match(html, /name="ing\[7\]\[ingredient\]"/)
    assert.match(html, /<datalist id="ingredient-names">/)
    assert.match(html, /Platos fuertes/)
  })

  it('captures a full family recipe with a photo, then shows, scales and lists it', async () => {
    let form = recipeForm({ ...BASE, familyCredit: 'la abuela Lupe', newTags: 'jueves' }, ROWS)
    form.append('tags', 'Platos fuertes')
    form.append('photos', new File([TINY_PNG], 'tinga.png', { type: 'image/png' }))

    let created = await request('/recetas', { cookie, multipart: form })
    assert.equal(created.status, 303)
    let location = created.headers.get('Location')!
    assert.match(location, /^\/recetas\/tinga-de-pollo\?ok=created/)

    let show = await request(location, { cookie })
    let html = await show.text()
    assert.equal(show.status, 200)
    assert.match(html, /Receta guardada/)
    assert.match(html, /Receta de la abuela Lupe/)
    assert.match(html, /<strong>500 gramos<\/strong> Pechuga de pollo/)
    assert.match(html, /<strong>1 ½ tazas<\/strong> Puré de tomate/)
    assert.match(html, /<strong>al gusto<\/strong> Sal/)
    assert.match(html, /Salsa/)
    assert.match(html, /<li>Deshebrar.<\/li>/)

    let detail = await getRecipeBySlug('tinga-de-pollo')
    assert.equal(detail.photos.length, 1)
    assert.deepEqual(detail.tags.map((t) => t.name), ['Platos fuertes', 'jueves'])
    assert.match(html, new RegExp(`src="/fotos/${detail.coverPhotoKey}"`))

    let photo = await request(`/fotos/${detail.coverPhotoKey}`, { cookie })
    assert.equal(photo.status, 200)
    assert.equal(photo.headers.get('Content-Type'), 'image/png')
    assert.equal(photo.headers.get('X-Content-Type-Options'), 'nosniff')
    assert.equal(new Uint8Array(await photo.arrayBuffer()).length, TINY_PNG.length)

    let scaled = await (await request('/recetas/tinga-de-pollo?porciones=8', { cookie })).text()
    assert.match(scaled, /<strong>1000 gramos<\/strong>/)
    assert.match(scaled, /<strong>3 tazas<\/strong>/)
    assert.match(scaled, /Cantidades para 8 porciones/)

    let list = await (await request('/recetas?q=tinga', { cookie })).text()
    assert.match(list, /Tinga de pollo/)
    assert.match(list, /45 min · 4 porc\./)
    let home = await (await request('/', { cookie })).text()
    assert.match(home, /Tinga de pollo/)
  })

  it('adds editor rows without saving, keeping what was typed', async () => {
    let form = recipeForm({ ...BASE, intent: 'addRows' }, ROWS)
    let response = await request('/recetas', { cookie, multipart: form })
    assert.equal(response.status, 200)
    let html = await response.text()
    assert.match(html, /name="ing\[8\]\[ingredient\]"/)
    assert.match(html, /value="Pechuga de pollo"/)
    assert.equal((await db.select().from(recipe)).length, 0)
  })

  it('reports errors on the right ingredient row', async () => {
    let rows: Record<string, string>[] = [...ROWS, { quantity: 'mucha', unit: 'g', ingredient: 'arroz' }, { quantity: '2', unit: '', ingredient: '' }]
    let response = await request('/recetas', { cookie, multipart: recipeForm({ ...BASE, title: '' }, rows) })
    assert.equal(response.status, 400)
    let html = await response.text()
    assert.match(html, /Escribe el nombre de la receta/)
    assert.match(html, /Revisa los ingredientes marcados/)
    assert.match(html, /name="ing\[4\]\[quantity\]"[^>]*aria-invalid="true"/)
    assert.match(html, /Cantidad no válida: &quot;mucha&quot;|Cantidad no válida: "mucha"/)
    assert.match(html, /name="ing\[5\]\[ingredient\]"[^>]*aria-invalid="true"/)
    assert.match(html, /value="arroz"/)
  })

  it('rejects files that are not images, keeping the recipe', async () => {
    let form = recipeForm(BASE, ROWS)
    form.append('photos', new File(['<html>no</html>'], 'foto.png', { type: 'image/png' }))
    let response = await request('/recetas', { cookie, multipart: form })
    assert.equal(response.status, 303)
    let location = response.headers.get('Location')!
    assert.match(location, /^\/recetas\/tinga-de-pollo\/editar\?ok=created&fotoError=/)
    let html = await (await request(location, { cookie })).text()
    assert.match(html, /La receta se guardó, pero la foto no/)
    assert.equal((await getRecipeBySlug('tinga-de-pollo')).photos.length, 0)
  })

  it('edits, manages photos, toggles favorite and deletes', async () => {
    await request('/recetas', { cookie, multipart: recipeForm(BASE, ROWS) })

    let edit = await (await request('/recetas/tinga-de-pollo/editar', { cookie })).text()
    assert.match(edit, /value="1 1\/2"/)
    assert.match(edit, /Aún no tiene fotos/)

    let updated = await request('/recetas/tinga-de-pollo/editar', {
      cookie,
      multipart: recipeForm({ ...BASE, title: 'Tinga de res', prepMinutes: '' }, [
        { quantity: '600', unit: 'g', ingredient: 'bistec' },
      ]),
    })
    assert.equal(updated.status, 303)
    assert.match(updated.headers.get('Location')!, /^\/recetas\/tinga-de-res\?ok=updated/)
    let after = await getRecipeBySlug('tinga-de-res')
    assert.equal(after.prepMinutes, null)
    assert.deepEqual(after.ingredients.map((i) => i.name), ['Bistec de res'])
    assert.equal((await request('/recetas/tinga-de-pollo', { cookie })).status, 404)

    let upload = new FormData()
    upload.append('photos', new File([TINY_PNG], 'a.png', { type: 'image/png' }))
    upload.append('photos', new File([TINY_PNG], 'b.png', { type: 'image/png' }))
    let added = await request('/recetas/tinga-de-res/fotos', { cookie, multipart: upload })
    assert.equal(added.status, 303)
    let withPhotos = await getRecipeBySlug('tinga-de-res')
    let [a, b] = withPhotos.photos
    assert.equal(withPhotos.coverPhotoId, a!.id)

    await request(`/recetas/tinga-de-res/fotos/${b!.id}/portada`, { cookie, form: {} })
    assert.equal((await getRecipeBySlug('tinga-de-res')).coverPhotoId, b!.id)
    await request(`/recetas/tinga-de-res/fotos/${b!.id}/eliminar`, { cookie, form: {} })
    assert.equal((await getRecipeBySlug('tinga-de-res')).coverPhotoId, a!.id)
    assert.equal((await request(`/recetas/tinga-de-res/fotos/99999/eliminar`, { cookie, form: {} })).status, 404)

    let fav = await request('/recetas/tinga-de-res/favorita', { cookie, form: {} })
    assert.equal(fav.status, 303)
    let favs = await (await request('/recetas?favoritas=1', { cookie })).text()
    assert.match(favs, /Tinga de res/)
    assert.match(await (await request('/recetas/tinga-de-res', { cookie })).text(), /♥ Favorita/)

    let del = await request('/recetas/tinga-de-res/eliminar', { cookie, form: {} })
    assert.equal(del.headers.get('Location'), '/recetas?ok=deleted')
    assert.equal((await db.select().from(recipe)).length, 0)
  })

  it('rejects oversized uploads with 413', async () => {
    let form = recipeForm(BASE, ROWS)
    form.append('photos', new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'enorme.jpg', { type: 'image/jpeg' }))
    let response = await request('/recetas', { cookie, multipart: form })
    assert.equal(response.status, 413)
    assert.match(await response.text(), /menos de 10 MB/)
    assert.equal((await db.select().from(recipe)).length, 0)
  })

  it('returns 404 for unknown recipes and photos', async () => {
    assert.equal((await request('/recetas/no-existe', { cookie })).status, 404)
    assert.equal((await request('/recetas/../../etc', { cookie })).status, 404)
    assert.equal((await request('/fotos/00000000-0000-0000-0000-000000000000.png', { cookie })).status, 404)
    assert.equal((await request('/fotos/..%2F.env', { cookie })).status, 404)
  })
})
