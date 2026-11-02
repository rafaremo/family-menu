import type { Handle } from 'remix/component'

import type { Identity } from '../../auth/middleware.ts'
import type { FieldErrors } from '../../lib/validation.ts'
import { routes } from '../../routes.ts'
import { TAG_KINDS, UNIT_DIMENSIONS, type Aisle, type Store, type Tag, type Unit } from '../../services/catalogs.ts'
import { Flash, Layout } from '../../ui/layout.tsx'

export type CatalogSection = 'pasillos' | 'tiendas' | 'unidades' | 'etiquetas'

/** Lo que el usuario escribió en un formulario de alta que falló (para no perderlo). */
export interface Draft {
  section: CatalogSection
  values: Record<string, string>
  errors: FieldErrors
}

export interface CatalogsPageProps {
  user: Identity
  aisles: Aisle[]
  stores: Store[]
  units: Unit[]
  tags: Tag[]
  ok?: string | null
  error?: string | null
  draft?: Draft
}

const r = routes.catalogs

function FieldError(handle: Handle<{ error?: string }>) {
  return () => (handle.props.error ? <p class="field-error">{handle.props.error}</p> : null)
}

interface NamedSectionProps {
  section: 'pasillos' | 'tiendas'
  title: string
  singular: string
  hint: string
  items: { id: number; name: string; sortOrder: number }[]
  createHref: string
  updateHref: (id: string) => string
  destroyHref: (id: string) => string
  draft?: Draft
}

/** Pasillos y tiendas: nombre + orden. */
function NamedSection(handle: Handle<NamedSectionProps>) {
  return () => {
    let { section, title, singular, hint, items, createHref, updateHref, destroyHref, draft } = handle.props
    let mine = draft?.section === section ? draft : undefined
    return (
      <section id={section} class="catalog-section">
        <h2>{title}</h2>
        <p class="muted small">{hint}</p>
        <div class="card table-wrap">
          <table class="stack-mobile">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Orden</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                let formId = `${section}-${item.id}`
                return (
                  <tr key={item.id}>
                    <td>
                      <input form={formId} name="name" defaultValue={item.name} required aria-label={`Nombre de ${item.name}`} />
                    </td>
                    <td data-label="Orden" class="col-order">
                      <input
                        form={formId}
                        name="sortOrder"
                        type="number"
                        min={0}
                        step={1}
                        defaultValue={String(item.sortOrder)}
                        aria-label={`Orden de ${item.name}`}
                      />
                    </td>
                    <td class="row">
                      <form id={formId} method="post" action={updateHref(String(item.id))} class="inline">
                        <button type="submit" class="secondary small">
                          Guardar
                        </button>
                      </form>
                      <details>
                        <summary>Eliminar…</summary>
                        <form method="post" action={destroyHref(String(item.id))} class="inline">
                          <button type="submit" class="danger small">
                            Sí, eliminar “{item.name}”
                          </button>
                        </form>
                      </details>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <form method="post" action={createHref} class="card row add-form">
          <div class="grow">
            <label htmlFor={`${section}-new-name`}>Nuevo {singular}</label>
            <input id={`${section}-new-name`} name="name" required defaultValue={mine?.values.name ?? ''} />
            <FieldError error={mine?.errors.name} />
          </div>
          <div class="col-order">
            <label htmlFor={`${section}-new-order`}>Orden</label>
            <input
              id={`${section}-new-order`}
              name="sortOrder"
              type="number"
              min={0}
              step={1}
              defaultValue={mine?.values.sortOrder ?? ''}
              placeholder="auto"
            />
          </div>
          <button type="submit">Agregar</button>
        </form>
      </section>
    )
  }
}

function UnitsSection(handle: Handle<{ units: Unit[]; draft?: Draft }>) {
  return () => {
    let { units, draft } = handle.props
    let mine = draft?.section === 'unidades' ? draft : undefined
    let dimensionOptions = (selected: string, withBase = false) =>
      UNIT_DIMENSIONS.map((d) => (
        <option key={d.value} value={d.value} selected={d.value === selected}>
          {withBase && d.base ? `${d.label} (${d.base})` : d.short}
        </option>
      ))

    return (
      <section id="unidades" class="catalog-section">
        <h2>Unidades</h2>
        <p class="muted small">
          La equivalencia convierte a la unidad base de su tipo (g, ml o pz) para sumar cantidades en la lista del súper.
          Las unidades “Otra” (lata, manojo…) solo se suman entre sí.
        </p>
        <div class="card table-wrap">
          <table class="stack-mobile">
            <thead>
              <tr>
                <th>Código</th>
                <th>Nombre / plural</th>
                <th>Tipo</th>
                <th>Equivale a</th>
                <th>Orden</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {units.map((u) => {
                let formId = `unit-${u.code}`
                return (
                  <tr key={u.code}>
                    <td>
                      <code>{u.code}</code>
                    </td>
                    <td data-label="Nombre / plural">
                      <div class="row nowrap">
                        <input form={formId} name="name" defaultValue={u.name} required aria-label={`Nombre de ${u.code}`} />
                        <input form={formId} name="plural" defaultValue={u.plural} required aria-label={`Plural de ${u.code}`} />
                      </div>
                    </td>
                    <td data-label="Tipo">
                      <select form={formId} name="dimension" aria-label={`Tipo de ${u.code}`}>
                        {dimensionOptions(u.dimension)}
                      </select>
                    </td>
                    <td data-label="Equivale a" class="col-num">
                      <input
                        form={formId}
                        name="toBase"
                        inputMode="decimal"
                        defaultValue={u.toBase === null ? '' : String(u.toBase)}
                        aria-label={`Equivalencia de ${u.code}`}
                      />
                    </td>
                    <td data-label="Orden" class="col-order">
                      <input
                        form={formId}
                        name="sortOrder"
                        type="number"
                        min={0}
                        step={1}
                        defaultValue={String(u.sortOrder)}
                        aria-label={`Orden de ${u.code}`}
                      />
                    </td>
                    <td class="row">
                      <form id={formId} method="post" action={r.unitUpdate.href({ code: u.code })} class="inline">
                        <button type="submit" class="secondary small">
                          Guardar
                        </button>
                      </form>
                      <details>
                        <summary>Eliminar…</summary>
                        <form method="post" action={r.unitDestroy.href({ code: u.code })} class="inline">
                          <button type="submit" class="danger small">
                            Sí, eliminar “{u.code}”
                          </button>
                        </form>
                      </details>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <form method="post" action={r.unitCreate.href()} class="card form-grid add-form">
          <div>
            <label htmlFor="unit-new-code">Código</label>
            <input id="unit-new-code" name="code" required placeholder="ej. bolsa" defaultValue={mine?.values.code ?? ''} />
            <FieldError error={mine?.errors.code} />
          </div>
          <div>
            <label htmlFor="unit-new-dimension">Tipo</label>
            <select id="unit-new-dimension" name="dimension">
              {dimensionOptions(mine?.values.dimension ?? 'other', true)}
            </select>
          </div>
          <div>
            <label htmlFor="unit-new-name">Nombre</label>
            <input id="unit-new-name" name="name" required placeholder="bolsa" defaultValue={mine?.values.name ?? ''} />
            <FieldError error={mine?.errors.name} />
          </div>
          <div>
            <label htmlFor="unit-new-plural">Plural</label>
            <input id="unit-new-plural" name="plural" required placeholder="bolsas" defaultValue={mine?.values.plural ?? ''} />
            <FieldError error={mine?.errors.plural} />
          </div>
          <div>
            <label htmlFor="unit-new-tobase">Equivale a (g / ml / pz)</label>
            <input
              id="unit-new-tobase"
              name="toBase"
              inputMode="decimal"
              placeholder="vacío si es “Otra”"
              defaultValue={mine?.values.toBase ?? ''}
            />
            <FieldError error={mine?.errors.toBase} />
          </div>
          <div>
            <label htmlFor="unit-new-order">Orden</label>
            <input id="unit-new-order" name="sortOrder" type="number" min={0} step={1} placeholder="auto" defaultValue={mine?.values.sortOrder ?? ''} />
          </div>
          <div class="span-2">
            <button type="submit">Agregar unidad</button>
          </div>
        </form>
      </section>
    )
  }
}

function TagsSection(handle: Handle<{ tags: Tag[]; draft?: Draft }>) {
  return () => {
    let { tags, draft } = handle.props
    let mine = draft?.section === 'etiquetas' ? draft : undefined
    let kindOptions = (selected: string) =>
      TAG_KINDS.map((k) => (
        <option key={k.value} value={k.value} selected={k.value === selected}>
          {k.label}
        </option>
      ))

    return (
      <section id="etiquetas" class="catalog-section">
        <h2>Etiquetas</h2>
        <p class="muted small">Para clasificar recetas: categoría (sopas, postres…), dieta, ocasión o libre.</p>
        <div class="card table-wrap">
          <table class="stack-mobile">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Tipo</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {tags.map((t) => {
                let formId = `tag-${t.id}`
                return (
                  <tr key={t.id}>
                    <td>
                      <input form={formId} name="name" defaultValue={t.name} required aria-label={`Nombre de ${t.name}`} />
                    </td>
                    <td data-label="Tipo">
                      <select form={formId} name="kind" aria-label={`Tipo de ${t.name}`}>
                        {kindOptions(t.kind)}
                      </select>
                    </td>
                    <td class="row">
                      <form id={formId} method="post" action={r.tagUpdate.href({ id: String(t.id) })} class="inline">
                        <button type="submit" class="secondary small">
                          Guardar
                        </button>
                      </form>
                      <details>
                        <summary>Eliminar…</summary>
                        <form method="post" action={r.tagDestroy.href({ id: String(t.id) })} class="inline">
                          <button type="submit" class="danger small">
                            Sí, eliminar “{t.name}”
                          </button>
                        </form>
                      </details>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <form method="post" action={r.tagCreate.href()} class="card row add-form">
          <div class="grow">
            <label htmlFor="tag-new-name">Nueva etiqueta</label>
            <input id="tag-new-name" name="name" required defaultValue={mine?.values.name ?? ''} />
            <FieldError error={mine?.errors.name} />
          </div>
          <div>
            <label htmlFor="tag-new-kind">Tipo</label>
            <select id="tag-new-kind" name="kind">
              {kindOptions(mine?.values.kind ?? 'category')}
            </select>
          </div>
          <button type="submit">Agregar</button>
        </form>
      </section>
    )
  }
}

export function CatalogsPage(handle: Handle<CatalogsPageProps>) {
  return () => {
    let { user, aisles, stores, units, tags, ok, error, draft } = handle.props
    return (
      <Layout title="Catálogos" user={user} section="catalogos">
        <h1>Catálogos</h1>
        <nav class="row subnav" aria-label="Secciones">
          <a href="#pasillos">Pasillos</a>
          <a href="#tiendas">Tiendas</a>
          <a href="#unidades">Unidades</a>
          <a href="#etiquetas">Etiquetas</a>
        </nav>
        <Flash ok={ok} error={error} />

        <NamedSection
          section="pasillos"
          title="Pasillos"
          singular="pasillo"
          hint="La lista del súper se ordena por pasillo (menor orden primero). Al eliminar uno, sus ingredientes quedan sin pasillo."
          items={aisles}
          createHref={r.aisleCreate.href()}
          updateHref={(id) => r.aisleUpdate.href({ id })}
          destroyHref={(id) => r.aisleDestroy.href({ id })}
          draft={draft}
        />
        <NamedSection
          section="tiendas"
          title="Tiendas"
          singular="tienda"
          hint="La lista se puede agrupar por tienda. Al eliminar una, sus ingredientes quedan sin tienda habitual."
          items={stores}
          createHref={r.storeCreate.href()}
          updateHref={(id) => r.storeUpdate.href({ id })}
          destroyHref={(id) => r.storeDestroy.href({ id })}
          draft={draft}
        />
        <UnitsSection units={units} draft={draft} />
        <TagsSection tags={tags} draft={draft} />
      </Layout>
    )
  }
}
