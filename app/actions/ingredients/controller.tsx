import { formData } from 'remix/middleware/form-data'
import { redirect } from 'remix/response/redirect'
import { createController } from 'remix/router'

import { requireUser, sessionAuth, webActor, type Identity } from '../../auth/middleware.ts'
import { toUserMessage, UserFacingError } from '../../lib/errors.ts'
import { parseForm, parseId, readText } from '../../lib/validation.ts'
import { routes } from '../../routes.ts'
import { aisles, listUnits, stores } from '../../services/catalogs.ts'
import {
  createIngredient,
  getIngredient,
  ingredientInput,
  ingredientOptions,
  listIngredients,
  mergeIngredients,
  removeIngredient,
  updateIngredient,
  type Ingredient,
} from '../../services/ingredients.ts'
import { NotFound } from '../../ui/layout.tsx'
import {
  EMPTY_VALUES,
  IngredientFormPage,
  valuesFromIngredient,
  type IngredientFormPageProps,
  type IngredientFormValues,
} from './form-page.tsx'
import { IngredientsIndexPage } from './index-page.tsx'

type Renderer = { render: (node: any, init?: ResponseInit) => Response | Promise<Response> }

const FLASH: Record<string, string> = {
  created: 'Ingrediente creado.',
  updated: 'Cambios guardados.',
  deleted: 'Ingrediente eliminado.',
  merged: 'Ingredientes fusionados.',
}

const r = routes.ingredients

function flash(url: URL): string | null {
  return FLASH[url.searchParams.get('ok') ?? ''] ?? null
}

function readValues(form: FormData): IngredientFormValues {
  let values = { ...EMPTY_VALUES }
  for (let key of Object.keys(values) as (keyof IngredientFormValues)[]) values[key] = readText(form, key)
  return values
}

async function renderForm(
  context: Renderer,
  props: Omit<IngredientFormPageProps, 'aisles' | 'stores' | 'units' | 'mergeOptions'>,
  status = 200,
) {
  let [aisleList, storeList, unitList, options] = await Promise.all([
    aisles.list(),
    stores.list(),
    listUnits(),
    props.ingredient ? ingredientOptions() : Promise.resolve([]),
  ])
  let mergeOptions = options.filter((o) => o.id !== props.ingredient?.id)
  return context.render(
    <IngredientFormPage {...props} aisles={aisleList} stores={storeList} units={unitList} mergeOptions={mergeOptions} />,
    { status },
  )
}

function notFound(context: Renderer, user: Identity) {
  return context.render(
    <NotFound user={user} message="Ese ingrediente no existe." backHref={r.index.href()} backLabel="Ver ingredientes" />,
    { status: 404 },
  )
}

/** Carga el ingrediente de la URL o regresa null (404). */
async function loadIngredient(id: string | undefined): Promise<Ingredient | null> {
  let parsed = parseId(id)
  if (!parsed) return null
  try {
    return await getIngredient(parsed)
  } catch (error) {
    if (error instanceof UserFacingError && error.status === 404) return null
    throw error
  }
}

export default createController(r, {
  middleware: [sessionAuth, requireUser, formData()],
  actions: {
    async index(context) {
      let user = context.auth.identity
      let q = (context.url.searchParams.get('q') ?? '').trim().slice(0, 80)
      let aisle = context.url.searchParams.get('pasillo') ?? ''
      let aisleId = aisle === '0' ? 0 : parseId(aisle)
      let page = parseId(context.url.searchParams.get('pagina') ?? '') ?? 1

      let [result, aisleList] = await Promise.all([listIngredients({ q, aisleId, page }), aisles.list()])
      return context.render(
        <IngredientsIndexPage
          user={user}
          {...result}
          q={q}
          aisle={aisleId === null ? '' : String(aisleId)}
          aisles={aisleList}
          ok={flash(context.url)}
        />,
      )
    },

    async new(context) {
      let values = { ...EMPTY_VALUES, name: (context.url.searchParams.get('nombre') ?? '').slice(0, 80) }
      return renderForm(context, { user: context.auth.identity, values })
    },

    async create(context) {
      let user = context.auth.identity
      let values = readValues(context.formData)
      let parsed = parseForm(ingredientInput, context.formData)
      if (!parsed.ok || !parsed.data) return renderForm(context, { user, values, errors: parsed.errors }, 400)
      try {
        let created = await createIngredient(webActor(user), parsed.data)
        return redirect(`${r.edit.href({ id: String(created.id) })}?ok=created`, 303)
      } catch (error) {
        return renderForm(context, { user, values, error: toUserMessage(error) }, 400)
      }
    },

    async edit(context) {
      let user = context.auth.identity
      let ingredient = await loadIngredient(context.params.id)
      if (!ingredient) return notFound(context, user)
      return renderForm(context, { user, ingredient, values: valuesFromIngredient(ingredient), ok: flash(context.url) })
    },

    async update(context) {
      let user = context.auth.identity
      let ingredient = await loadIngredient(context.params.id)
      if (!ingredient) return notFound(context, user)

      let values = readValues(context.formData)
      let parsed = parseForm(ingredientInput, context.formData)
      if (!parsed.ok || !parsed.data) return renderForm(context, { user, ingredient, values, errors: parsed.errors }, 400)
      try {
        await updateIngredient(webActor(user), ingredient.id, parsed.data)
        return redirect(`${r.edit.href({ id: String(ingredient.id) })}?ok=updated`, 303)
      } catch (error) {
        return renderForm(context, { user, ingredient, values, error: toUserMessage(error) }, 400)
      }
    },

    async destroy(context) {
      let user = context.auth.identity
      let ingredient = await loadIngredient(context.params.id)
      if (!ingredient) return notFound(context, user)
      try {
        await removeIngredient(webActor(user), ingredient.id)
        return redirect(`${r.index.href()}?ok=deleted`, 303)
      } catch (error) {
        return renderForm(
          context,
          { user, ingredient, values: valuesFromIngredient(ingredient), error: toUserMessage(error) },
          400,
        )
      }
    },

    async merge(context) {
      let user = context.auth.identity
      let ingredient = await loadIngredient(context.params.id)
      if (!ingredient) return notFound(context, user)

      let values = valuesFromIngredient(ingredient)
      let targetId = parseId(readText(context.formData, 'targetId'))
      if (!targetId) {
        return renderForm(context, { user, ingredient, values, error: 'Elige el ingrediente destino.' }, 400)
      }
      try {
        let target = await mergeIngredients(webActor(user), ingredient.id, targetId)
        return redirect(`${r.edit.href({ id: String(target.id) })}?ok=merged`, 303)
      } catch (error) {
        return renderForm(context, { user, ingredient, values, error: toUserMessage(error) }, 400)
      }
    },
  },
})
