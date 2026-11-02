import type * as z from 'zod'
import { formData } from 'remix/middleware/form-data'
import { redirect } from 'remix/response/redirect'
import { createController } from 'remix/router'

import { requireAdmin, requireUser, sessionAuth, webActor, type Identity } from '../../auth/middleware.ts'
import { toUserMessage, UserFacingError } from '../../lib/errors.ts'
import { parseForm, parseId, type FieldErrors } from '../../lib/validation.ts'
import { routes } from '../../routes.ts'
import type { ServiceActor } from '../../services/audit.ts'
import {
  aisles,
  createTag,
  createUnit,
  listTags,
  listUnits,
  namedCatalogInput,
  newUnitInput,
  removeTag,
  removeUnit,
  stores,
  tagInput,
  unitInput,
  updateTag,
  updateUnit,
} from '../../services/catalogs.ts'
import { CatalogsPage, type CatalogSection, type Draft } from './page.tsx'

type Renderer = { render: (node: any, init?: ResponseInit) => Response | Promise<Response> }

interface Ctx extends Renderer {
  auth: { identity: Identity }
  formData: FormData
  url: URL
}

const FLASH: Record<string, string> = {
  created: 'Agregado.',
  updated: 'Guardado.',
  deleted: 'Eliminado.',
}

async function renderPage(
  context: Renderer & { auth: { identity: Identity } },
  extra: { ok?: string | null; error?: string | null; draft?: Draft } = {},
  status = 200,
) {
  let [aisleList, storeList, unitList, tagList] = await Promise.all([aisles.list(), stores.list(), listUnits(), listTags()])
  return context.render(
    <CatalogsPage
      user={context.auth.identity}
      aisles={aisleList}
      stores={storeList}
      units={unitList}
      tags={tagList}
      {...extra}
    />,
    { status },
  )
}

function formValues(form: FormData): Record<string, string> {
  let values: Record<string, string> = {}
  for (let [key, value] of form) if (typeof value === 'string') values[key] = value
  return values
}

function firstError(errors: FieldErrors): string {
  return Object.values(errors).find(Boolean) ?? 'Revisa los datos.'
}

/**
 * Patrón común: valida, ejecuta y redirige a la sección con un mensaje; si falla,
 * vuelve a pintar la página con el error (y lo capturado, en altas).
 */
async function run<S extends z.ZodType>(
  context: Ctx,
  section: CatalogSection,
  ok: keyof typeof FLASH,
  schema: S | null,
  action: (actor: ServiceActor, data: z.output<S>) => Promise<unknown>,
  options: { isCreate?: boolean } = {},
) {
  let draftFor = (errors: FieldErrors): Draft | undefined =>
    options.isCreate ? { section, values: formValues(context.formData), errors } : undefined

  let data: z.output<S> = undefined as z.output<S>
  if (schema) {
    let parsed = parseForm(schema, context.formData)
    if (!parsed.ok) {
      return renderPage(context, { error: firstError(parsed.errors), draft: draftFor(parsed.errors) }, 400)
    }
    data = parsed.data as z.output<S>
  }

  try {
    await action(webActor(context.auth.identity), data)
    return redirect(`${routes.catalogs.index.href()}?ok=${ok}#${section}`, 303)
  } catch (error) {
    let status = error instanceof UserFacingError ? error.status : 500
    return renderPage(context, { error: toUserMessage(error), draft: draftFor({}) }, status)
  }
}

function idParam(value: string | undefined): number {
  let id = parseId(value)
  if (!id) throw new UserFacingError('No encontrado.', 404)
  return id
}

export default createController(routes.catalogs, {
  middleware: [sessionAuth, requireUser, requireAdmin(), formData()],
  actions: {
    index(context) {
      return renderPage(context, { ok: FLASH[context.url.searchParams.get('ok') ?? ''] ?? null })
    },

    aisleCreate: (c) => run(c, 'pasillos', 'created', namedCatalogInput, (a, d) => aisles.create(a, d), { isCreate: true }),
    aisleUpdate: (c) => run(c, 'pasillos', 'updated', namedCatalogInput, (a, d) => aisles.update(a, idParam(c.params.id), d)),
    aisleDestroy: (c) => run(c, 'pasillos', 'deleted', null, (a) => aisles.remove(a, idParam(c.params.id))),

    storeCreate: (c) => run(c, 'tiendas', 'created', namedCatalogInput, (a, d) => stores.create(a, d), { isCreate: true }),
    storeUpdate: (c) => run(c, 'tiendas', 'updated', namedCatalogInput, (a, d) => stores.update(a, idParam(c.params.id), d)),
    storeDestroy: (c) => run(c, 'tiendas', 'deleted', null, (a) => stores.remove(a, idParam(c.params.id))),

    unitCreate: (c) => run(c, 'unidades', 'created', newUnitInput, (a, d) => createUnit(a, d), { isCreate: true }),
    unitUpdate: (c) => run(c, 'unidades', 'updated', unitInput, (a, d) => updateUnit(a, c.params.code, d)),
    unitDestroy: (c) => run(c, 'unidades', 'deleted', null, (a) => removeUnit(a, c.params.code)),

    tagCreate: (c) => run(c, 'etiquetas', 'created', tagInput, (a, d) => createTag(a, d), { isCreate: true }),
    tagUpdate: (c) => run(c, 'etiquetas', 'updated', tagInput, (a, d) => updateTag(a, idParam(c.params.id), d)),
    tagDestroy: (c) => run(c, 'etiquetas', 'deleted', null, (a) => removeTag(a, idParam(c.params.id))),
  },
})
