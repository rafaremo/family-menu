import { asc } from 'drizzle-orm'
import { formData } from 'remix/middleware/form-data'
import { redirect } from 'remix/response/redirect'
import { createController, type Middleware } from 'remix/router'
import { FormDataParseError, MultipartParseError } from 'remix/form-data-parser'

import { requireUser, sessionAuth, webActor, type Identity } from '../../auth/middleware.ts'
import { db } from '../../db/client.ts'
import { ingredient } from '../../db/schema/index.ts'
import { toUserMessage, UserFacingError } from '../../lib/errors.ts'
import { parseId, readText } from '../../lib/validation.ts'
import { routes } from '../../routes.ts'
import { listTags, listUnits } from '../../services/catalogs.ts'
import { addRecipePhotos, MAX_PHOTO_BYTES, realFiles, removeRecipePhoto, setCoverPhoto } from '../../services/photos.ts'
import {
  createRecipe,
  deleteRecipe,
  getRecipeBySlug,
  listRecipes,
  scaleIngredients,
  toggleFavorite,
  updateRecipe,
  type RecipeDetail,
  type WriteResult,
} from '../../services/recipes.ts'
import { NotFound } from '../../ui/layout.tsx'
import { emptyValues, parseRecipeForm, readValues, ROWS_STEP, valuesFromRecipe, withBlankRows } from './form.ts'
import { RecipeFormPage, type RecipeFormPageProps } from './form-page.tsx'
import { RecipesIndexPage, type RecipeFilters } from './index-page.tsx'
import { RecipeShowPage } from './show-page.tsx'

type Renderer = { render: (node: any, init?: ResponseInit) => Response | Promise<Response> }

const r = routes.recipes

const FLASH: Record<string, string> = {
  created: 'Receta guardada.',
  updated: 'Cambios guardados.',
  deleted: 'Receta eliminada.',
  photos: 'Fotos agregadas.',
  cover: 'Portada actualizada.',
  photoRemoved: 'Foto quitada.',
}

function flash(url: URL): string | null {
  return FLASH[url.searchParams.get('ok') ?? ''] ?? null
}

/** Convierte errores de límites de subida en una respuesta entendible (413). */
const uploadLimits: Middleware = async (_context, next) => {
  try {
    return await next()
  } catch (error) {
    if (error instanceof MultipartParseError || error instanceof FormDataParseError) {
      let message = `No se pudo subir: cada foto debe pesar menos de ${MAX_PHOTO_BYTES / 1024 / 1024} MB y máximo 6 por envío.`
      return new Response(message, { status: 413, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
    }
    throw error
  }
}

async function editorProps() {
  let [units, tags, names] = await Promise.all([
    listUnits(),
    listTags(),
    db.select({ name: ingredient.name }).from(ingredient).orderBy(asc(ingredient.nameKey)),
  ])
  return { units, tags, ingredientNames: names.map((n) => n.name) }
}

async function renderForm(
  context: Renderer,
  props: Omit<RecipeFormPageProps, 'units' | 'tags' | 'ingredientNames'>,
  status = 200,
) {
  return context.render(<RecipeFormPage {...props} {...await editorProps()} />, { status })
}

function notFound(context: Renderer, user: Identity) {
  return context.render(
    <NotFound user={user} message="Esa receta no existe." backHref={r.index.href()} backLabel="Ver recetas" />,
    { status: 404 },
  )
}

async function loadRecipe(slug: string | undefined, viewerId: string): Promise<RecipeDetail | null> {
  if (!slug || !/^[a-z0-9-]{1,100}$/.test(slug)) return null
  try {
    return await getRecipeBySlug(slug, viewerId)
  } catch (error) {
    if (error instanceof UserFacingError && error.status === 404) return null
    throw error
  }
}

/** Mensaje extra cuando se crearon ingredientes o etiquetas nuevas. */
function createdNote(result: WriteResult): string {
  let parts = []
  if (result.createdIngredients.length) parts.push(`ingredientes nuevos: ${result.createdIngredients.join(', ')}`)
  if (result.createdTags.length) parts.push(`etiquetas nuevas: ${result.createdTags.join(', ')}`)
  return parts.length ? `&nuevos=${encodeURIComponent(parts.join('; '))}` : ''
}

function okMessage(url: URL): string | null {
  let base = flash(url)
  let extra = url.searchParams.get('nuevos')
  if (!base) return null
  return extra ? `${base} Se agregaron ${extra.slice(0, 500)}.` : base
}

export default createController(r, {
  middleware: [
    sessionAuth,
    requireUser,
    uploadLimits,
    formData({ maxFiles: 6, maxFileSize: MAX_PHOTO_BYTES, maxTotalSize: 6 * MAX_PHOTO_BYTES + 1024 * 1024 }),
  ],
  actions: {
    async index(context) {
      let user = context.auth.identity
      let params = context.url.searchParams
      let filters: RecipeFilters = {
        q: (params.get('q') ?? '').trim().slice(0, 100),
        tag: (params.get('etiqueta') ?? '').slice(0, 80),
        ingredient: (params.get('ingrediente') ?? '').trim().slice(0, 80),
        favorites: params.get('favoritas') === '1',
      }
      let page = parseId(params.get('pagina') ?? '') ?? 1
      let [result, tags] = await Promise.all([
        listRecipes({
          q: filters.q,
          tag: filters.tag || undefined,
          ingredient: filters.ingredient || undefined,
          favoritesOf: filters.favorites ? user.id : null,
          viewerId: user.id,
          page,
        }),
        listTags(),
      ])
      return context.render(<RecipesIndexPage user={user} {...result} filters={filters} tags={tags} ok={flash(context.url)} />)
    },

    async new(context) {
      return renderForm(context, { user: context.auth.identity, values: emptyValues() })
    },

    async create(context) {
      let user = context.auth.identity
      let values = readValues(context.formData)

      if (readText(context.formData, 'intent') === 'addRows') {
        values.rows = withBlankRows(values.rows, ROWS_STEP)
        return renderForm(context, { user, values })
      }

      let parsed = parseRecipeForm(values)
      if (!parsed.ok || !parsed.data) return renderForm(context, { user, values, errors: parsed.errors }, 400)

      let photos = realFiles(context.formData.getAll('photos'))
      try {
        let result = await createRecipe(webActor(user), parsed.data)
        let photoError = ''
        try {
          await addRecipePhotos(webActor(user), result.recipe.id, photos)
        } catch (error) {
          // La receta ya quedó guardada; avisamos y mandamos a editar para reintentar la foto.
          photoError = toUserMessage(error)
        }
        if (photoError) {
          return redirect(
            `${r.edit.href({ slug: result.recipe.slug })}?ok=created&fotoError=${encodeURIComponent(photoError)}#fotos`,
            303,
          )
        }
        return redirect(`${r.show.href({ slug: result.recipe.slug })}?ok=created${createdNote(result)}`, 303)
      } catch (error) {
        return renderForm(context, { user, values, error: toUserMessage(error) }, 400)
      }
    },

    async show(context) {
      let user = context.auth.identity
      let recipe = await loadRecipe(context.params.slug, user.id)
      if (!recipe) return notFound(context, user)
      let requested = Number(context.url.searchParams.get('porciones'))
      let servings = Number.isInteger(requested) && requested >= 1 && requested <= 100 ? requested : recipe.servings
      return context.render(
        <RecipeShowPage
          user={user}
          recipe={recipe}
          servings={servings}
          lines={scaleIngredients(recipe, servings)}
          ok={okMessage(context.url)}
        />,
      )
    },

    async edit(context) {
      let user = context.auth.identity
      let recipe = await loadRecipe(context.params.slug, user.id)
      if (!recipe) return notFound(context, user)
      let photoError = context.url.searchParams.get('fotoError')
      return renderForm(context, {
        user,
        recipe,
        values: valuesFromRecipe(recipe),
        ok: flash(context.url),
        error: photoError ? `La receta se guardó, pero la foto no: ${photoError.slice(0, 300)}` : null,
      })
    },

    async update(context) {
      let user = context.auth.identity
      let recipe = await loadRecipe(context.params.slug, user.id)
      if (!recipe) return notFound(context, user)
      let values = readValues(context.formData)

      if (readText(context.formData, 'intent') === 'addRows') {
        values.rows = withBlankRows(values.rows, ROWS_STEP)
        return renderForm(context, { user, recipe, values })
      }

      let parsed = parseRecipeForm(values)
      if (!parsed.ok || !parsed.data) return renderForm(context, { user, recipe, values, errors: parsed.errors }, 400)
      try {
        // Desde el formulario se manda la receta completa (incluye vaciar campos).
        let data = parsed.data
        let result = await updateRecipe(webActor(user), recipe.id, {
          ...data,
          description: data.description ?? null,
          servings: data.servings ?? null,
          prepMinutes: data.prepMinutes ?? null,
          cookMinutes: data.cookMinutes ?? null,
          steps: data.steps ?? [],
          notes: data.notes ?? null,
          sourceUrl: data.sourceUrl ?? null,
          familyCredit: data.familyCredit ?? null,
          ingredients: data.ingredients ?? [],
          tags: data.tags ?? [],
        })
        return redirect(`${r.show.href({ slug: result.recipe.slug })}?ok=updated${createdNote(result)}`, 303)
      } catch (error) {
        return renderForm(context, { user, recipe, values, error: toUserMessage(error) }, 400)
      }
    },

    async destroy(context) {
      let user = context.auth.identity
      let recipe = await loadRecipe(context.params.slug, user.id)
      if (!recipe) return notFound(context, user)
      await deleteRecipe(webActor(user), recipe.id)
      return redirect(`${r.index.href()}?ok=deleted`, 303)
    },

    async favorite(context) {
      let user = context.auth.identity
      let recipe = await loadRecipe(context.params.slug, user.id)
      if (!recipe) return notFound(context, user)
      await toggleFavorite({ userId: user.id, via: 'web' }, recipe.id)
      return redirect(r.show.href({ slug: recipe.slug }), 303)
    },

    async photoAdd(context) {
      let user = context.auth.identity
      let recipe = await loadRecipe(context.params.slug, user.id)
      if (!recipe) return notFound(context, user)
      try {
        let files = realFiles(context.formData.getAll('photos'))
        if (!files.length) throw new UserFacingError('Elige al menos una foto.')
        await addRecipePhotos(webActor(user), recipe.id, files)
        return redirect(`${r.edit.href({ slug: recipe.slug })}?ok=photos#fotos`, 303)
      } catch (error) {
        let status = error instanceof UserFacingError ? error.status : 500
        return renderForm(context, { user, recipe, values: valuesFromRecipe(recipe), error: toUserMessage(error) }, status)
      }
    },

    async photoCover(context) {
      let user = context.auth.identity
      let recipe = await loadRecipe(context.params.slug, user.id)
      let photoId = parseId(context.params.photoId)
      if (!recipe || !photoId) return notFound(context, user)
      try {
        await setCoverPhoto(webActor(user), recipe.id, photoId)
        return redirect(`${r.edit.href({ slug: recipe.slug })}?ok=cover#fotos`, 303)
      } catch (error) {
        return renderForm(context, { user, recipe, values: valuesFromRecipe(recipe), error: toUserMessage(error) }, 404)
      }
    },

    async photoDestroy(context) {
      let user = context.auth.identity
      let recipe = await loadRecipe(context.params.slug, user.id)
      let photoId = parseId(context.params.photoId)
      if (!recipe || !photoId) return notFound(context, user)
      try {
        await removeRecipePhoto(webActor(user), recipe.id, photoId)
        return redirect(`${r.edit.href({ slug: recipe.slug })}?ok=photoRemoved#fotos`, 303)
      } catch (error) {
        return renderForm(context, { user, recipe, values: valuesFromRecipe(recipe), error: toUserMessage(error) }, 404)
      }
    },
  },
})
