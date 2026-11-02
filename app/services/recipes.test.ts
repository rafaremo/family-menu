import { eq } from 'drizzle-orm'
import * as assert from 'remix/assert'
import { beforeEach, describe, it } from 'remix/test'

import { db } from '../db/client.ts'
import { auditLog, recipe, tag } from '../db/schema/index.ts'
import { createUser, resetDb, TINY_PNG } from '../../test/helpers.ts'
import type { ServiceActor } from './audit.ts'
import { seedCatalogs } from './catalog-seed.ts'
import { removeTag, updateTag } from './catalogs.ts'
import { findIngredientByName, mergeIngredients, removeIngredient, updateIngredient } from './ingredients.ts'
import { addRecipePhotos, getPhotoFile, removeRecipePhoto } from './photos.ts'
import {
  createRecipe,
  deleteRecipe,
  getRecipe,
  listRecipes,
  recipeInput,
  recipePatch,
  scaleIngredients,
  toggleFavorite,
  updateRecipe,
} from './recipes.ts'

let actor: ServiceActor & { userId: string }

async function rejectsWith(promise: Promise<unknown>, pattern: RegExp) {
  try {
    await promise
  } catch (error) {
    assert.match((error as Error).message, pattern)
    return
  }
  assert.fail(`Se esperaba un error que coincidiera con ${pattern}`)
}

const tinga = () =>
  recipeInput.parse({
    title: 'Tinga de pollo',
    description: 'La de todos los jueves.',
    servings: '4',
    prepMinutes: '20',
    cookMinutes: '40',
    familyCredit: 'la abuela Lupe',
    steps: '1. Cuece el pollo.\n\n2) Desmenúzalo.\n- Fríe la cebolla y el jitomate.\nAgrega el chipotle.',
    tags: ['Platos fuertes', 'favorita de los niños'],
    ingredients: [
      { ingredient: 'pechuga', quantity: '500', unit: 'g', preparation: 'cocida y deshebrada' },
      { ingredient: 'Jitomate', quantity: '3', unit: 'pz', group: 'Salsa' },
      { ingredient: 'cebolla', quantity: '1/2', unit: 'pieza', preparation: 'fileteada', group: 'Salsa' },
      { ingredient: 'chipotle', quantity: '2', unit: 'cucharadas', group: 'Salsa' },
      { ingredient: 'Tostadas de maíz horneadas', quantity: '12', unit: '' },
      { ingredient: 'sal', quantity: '', unit: '' },
      { ingredient: 'crema', quantity: '1/2', unit: 'tz', optional: 'on' },
    ],
  })

describe('recetas: validación', () => {
  it('cleans steps and parses quantities', () => {
    let input = tinga()
    assert.deepEqual(
      input.steps!.map((s) => s.text),
      ['Cuece el pollo.', 'Desmenúzalo.', 'Fríe la cebolla y el jitomate.', 'Agrega el chipotle.'],
    )
    assert.equal(input.ingredients![2]!.quantity, 0.5)
    assert.equal(input.ingredients![5]!.quantity, null)
    assert.equal(input.ingredients![6]!.optional, true)
    assert.equal(input.servings, 4)
  })

  it('reports bad quantities, missing titles and bad URLs', () => {
    let result = recipeInput.safeParse({
      title: '',
      sourceUrl: 'javascript:alert(1)',
      ingredients: [{ ingredient: 'sal', quantity: 'mucha' }],
    })
    assert.equal(result.success, false)
    let paths = result.error!.issues.map((i) => i.path.join('.'))
    assert.ok(paths.includes('title'))
    assert.ok(paths.includes('sourceUrl'))
    assert.ok(paths.includes('ingredients.0.quantity'))
  })

  it('accepts MCP-style arrays and keeps omitted fields undefined in patches', () => {
    let input = recipeInput.parse({ title: 'X', steps: [{ text: 'Uno' }, 'Dos'], tags: 'a, b' })
    assert.deepEqual(input.steps, [{ text: 'Uno' }, { text: 'Dos' }])
    assert.deepEqual(input.tags, ['a', 'b'])
    let patch = recipePatch.parse({ notes: 'Nueva nota' })
    assert.equal(patch.ingredients, undefined)
    assert.equal(patch.servings, undefined)
  })
})

describe('recetas: servicio', () => {
  beforeEach(async () => {
    await resetDb()
    await seedCatalogs()
    let u = await createUser({ email: 'mon@test.local', password: 'member-secreto-1', name: 'Mon', role: 'member' })
    actor = { userId: u.id, via: 'web' }
  })

  it('creates a full recipe resolving ingredients by alias, units by name and new tags', async () => {
    let result = await createRecipe(actor, tinga())
    let r = result.recipe
    assert.equal(r.slug, 'tinga-de-pollo')
    assert.equal(r.createdByName, 'Mon')
    assert.deepEqual(result.createdIngredients, ['Tostadas de maíz horneadas'])
    assert.deepEqual(result.createdTags, ['favorita de los niños'])

    let names = r.ingredients.map((i) => i.name)
    assert.deepEqual(names, [
      'Pechuga de pollo',
      'Jitomate',
      'Cebolla blanca',
      'Chiles chipotles adobados',
      'Tostadas de maíz horneadas',
      'Sal',
      'Crema',
    ])
    assert.equal(r.ingredients[2]!.unitCode, 'pz')
    assert.equal(r.ingredients[3]!.unitCode, 'cda')
    assert.equal(r.ingredients[6]!.unitCode, 'taza')
    assert.equal(r.ingredients[6]!.optional, true)
    assert.equal(r.ingredients[1]!.groupLabel, 'Salsa')
    assert.deepEqual(
      r.tags.map((t) => t.name),
      ['Platos fuertes', 'favorita de los niños'],
    )

    let [log] = await db.select().from(auditLog).where(eq(auditLog.entity, 'recipe'))
    assert.equal(log?.action, 'create')
  })

  it('rejects unknown units without creating anything', async () => {
    let input = recipeInput.parse({ title: 'Rara', ingredients: [{ ingredient: 'sal', quantity: '1', unit: 'puñito' }] })
    await rejectsWith(createRecipe(actor, input), /No conozco la unidad "puñito"/)
    assert.equal((await db.select().from(recipe)).length, 0)
  })

  it('gives duplicate titles unique slugs and avoids reserved ones', async () => {
    let a = await createRecipe(actor, recipeInput.parse({ title: 'Arroz rojo' }))
    let b = await createRecipe(actor, recipeInput.parse({ title: 'Arroz  ROJO' }))
    assert.equal(a.recipe.slug, 'arroz-rojo')
    assert.equal(b.recipe.slug, 'arroz-rojo-2')
    let reserved = await createRecipe(actor, recipeInput.parse({ title: 'Nueva' }))
    assert.equal(reserved.recipe.slug, 'nueva-2')
  })

  it('searches by text (Spanish stemming, accents, prefixes, typos), ingredient, tag and favorites', async () => {
    let t = (await createRecipe(actor, tinga())).recipe
    await createRecipe(
      actor,
      recipeInput.parse({
        title: 'Sopa de fideo',
        tags: ['Sopas y caldos'],
        ingredients: [{ ingredient: 'fideo', quantity: '200', unit: 'g' }, { ingredient: 'jitomate', quantity: '2' }],
      }),
    )
    await createRecipe(actor, recipeInput.parse({ title: 'Agua de limón', ingredients: [{ ingredient: 'limones', quantity: '6' }] }))

    let titles = async (opts: Parameters<typeof listRecipes>[0]) => (await listRecipes(opts)).items.map((i) => i.title)

    assert.deepEqual(await titles({ q: 'tinga' }), ['Tinga de pollo'])
    assert.deepEqual(await titles({ q: 'tostadas' }), ['Tinga de pollo'])
    assert.deepEqual(await titles({ q: 'tostada' }), ['Tinga de pollo'])
    assert.deepEqual(await titles({ q: 'LIMON' }), ['Agua de limón'])
    assert.deepEqual(await titles({ q: 'abuela lupe' }), ['Tinga de pollo'])
    assert.deepEqual(await titles({ q: 'sop' }), ['Sopa de fideo'])
    assert.deepEqual(await titles({ q: 'tnga de pollo' }), ['Tinga de pollo'])
    assert.deepEqual(await titles({ q: 'qqqzzz' }), [])

    assert.deepEqual(await titles({ ingredient: 'tomate' }), ['Sopa de fideo', 'Tinga de pollo'])
    assert.deepEqual(await titles({ ingredient: 'espagueti' }), ['Sopa de fideo'])
    assert.deepEqual(await titles({ tag: 'sopas-y-caldos' }), ['Sopa de fideo'])

    assert.deepEqual(await titles({ favoritesOf: actor.userId }), [])
    assert.equal(await toggleFavorite(actor, t.id), true)
    assert.deepEqual(await titles({ favoritesOf: actor.userId }), ['Tinga de pollo'])
    let list = await listRecipes({ viewerId: actor.userId })
    assert.equal(list.items.find((i) => i.id === t.id)?.isFavorite, true)
    assert.equal(await toggleFavorite(actor, t.id), false)
    assert.deepEqual(await titles({ favoritesOf: actor.userId }), [])
  })

  it('scales ingredient quantities, leaving “al gusto” alone', async () => {
    let r = (await createRecipe(actor, tinga())).recipe
    let lines = scaleIngredients(r, 6)
    assert.equal(lines[0]!.quantity, 750)
    assert.equal(lines[2]!.quantity, 0.75)
    assert.equal(lines[5]!.quantity, null)
    assert.equal(scaleIngredients(r, 2)[1]!.quantity, 1.5)
  })

  it('updates partially and replaces ingredient lists', async () => {
    let r = (await createRecipe(actor, tinga())).recipe
    let updated = (await updateRecipe(actor, r.id, recipePatch.parse({ notes: 'Mejor con pollo rostizado' }))).recipe
    assert.equal(updated.notes, 'Mejor con pollo rostizado')
    assert.equal(updated.ingredients.length, 7)
    assert.equal(updated.familyCredit, 'la abuela Lupe')
    assert.equal(updated.slug, 'tinga-de-pollo')

    let renamed = (
      await updateRecipe(
        actor,
        r.id,
        recipePatch.parse({ title: 'Tinga de res', ingredients: [{ ingredient: 'bistec', quantity: '600', unit: 'g' }], tags: [] }),
      )
    ).recipe
    assert.equal(renamed.slug, 'tinga-de-res')
    assert.deepEqual(renamed.ingredients.map((i) => i.name), ['Bistec de res'])
    assert.equal(renamed.tags.length, 0)
    assert.deepEqual((await listRecipes({ q: 'bistec' })).items.map((i) => i.title), ['Tinga de res'])
    assert.equal((await listRecipes({ q: 'tostadas' })).total, 0)
  })

  it('protects ingredients used by recipes and repoints them on merge', async () => {
    let r = (await createRecipe(actor, tinga())).recipe
    let tostadasNuevas = (await findIngredientByName('Tostadas de maíz horneadas'))!
    await rejectsWith(removeIngredient(actor, tostadasNuevas.id), /se usa en 1 receta/)

    let tostadas = (await findIngredientByName('tostadas'))!
    await mergeIngredients(actor, tostadasNuevas.id, tostadas.id)
    let after = await getRecipe(r.id)
    assert.equal(after.ingredients[4]!.name, 'Tostadas')
    assert.deepEqual((await listRecipes({ q: 'horneadas' })).items.map((i) => i.title), ['Tinga de pollo'])
  })

  it('refreshes search text when an ingredient or tag is renamed or deleted', async () => {
    await createRecipe(actor, tinga())
    let chipotle = (await findIngredientByName('chipotle'))!
    await updateIngredient(actor, chipotle.id, { name: 'Chipotle en adobo', aliases: ['morita adobado'] })
    assert.equal((await listRecipes({ q: 'morita' })).total, 1)

    let [fav] = await db.select().from(tag).where(eq(tag.slug, 'favorita-de-los-ninos'))
    await updateTag(actor, fav!.id, { name: 'Consentida', kind: 'free' })
    assert.equal((await listRecipes({ q: 'consentida' })).total, 1)
    await removeTag(actor, fav!.id)
    assert.equal((await listRecipes({ q: 'consentida' })).total, 0)
  })

  it('stores photos, keeps a cover and cleans up on delete', async () => {
    let r = (await createRecipe(actor, tinga())).recipe
    let [first, second] = await addRecipePhotos(actor, r.id, [
      new File([TINY_PNG], 'uno.png', { type: 'image/png' }),
      new File([TINY_PNG], 'dos.png', { type: 'image/png' }),
    ])
    let detail = await getRecipe(r.id)
    assert.equal(detail.coverPhotoId, first!.id)
    assert.equal(detail.photos.length, 2)
    assert.equal(first!.width, 1)
    assert.ok(await getPhotoFile(first!.storageKey))
    assert.equal(await getPhotoFile('../../etc/passwd'), null)

    await rejectsWith(
      addRecipePhotos(actor, r.id, [new File(['<svg/>'], 'x.png', { type: 'image/png' })]),
      /no es una imagen/,
    )

    await removeRecipePhoto(actor, r.id, first!.id)
    assert.equal((await getRecipe(r.id)).coverPhotoId, second!.id)
    assert.equal(await getPhotoFile(first!.storageKey), null)

    await deleteRecipe(actor, r.id)
    assert.equal(await getPhotoFile(second!.storageKey), null)
    await rejectsWith(getRecipe(r.id), /no existe/)
  })
})
