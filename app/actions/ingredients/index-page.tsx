import type { Handle } from 'remix/component'

import type { Identity } from '../../auth/middleware.ts'
import { routes } from '../../routes.ts'
import type { Aisle } from '../../services/catalogs.ts'
import type { Ingredient } from '../../services/ingredients.ts'
import { Flash, Layout } from '../../ui/layout.tsx'

export interface IngredientsIndexProps {
  user: Identity
  items: Ingredient[]
  total: number
  page: number
  pages: number
  q: string
  /** '' = todos, '0' = sin pasillo, o id del pasillo. */
  aisle: string
  aisles: Aisle[]
  ok?: string | null
}

export function IngredientsIndexPage(handle: Handle<IngredientsIndexProps>) {
  return () => {
    let { user, items, total, page, pages, q, aisle, aisles, ok } = handle.props
    let r = routes.ingredients
    let filtered = Boolean(q || aisle)

    let pageHref = (n: number) => {
      let params = new URLSearchParams()
      if (q) params.set('q', q)
      if (aisle) params.set('pasillo', aisle)
      if (n > 1) params.set('pagina', String(n))
      let qs = params.toString()
      return qs ? `${r.index.href()}?${qs}` : r.index.href()
    }

    return (
      <Layout title="Ingredientes" user={user} section="ingredientes">
        <div class="page-head">
          <h1>Ingredientes</h1>
          <a class="button" href={r.new.href()}>
            + Nuevo ingrediente
          </a>
        </div>
        <Flash ok={ok} />

        <form method="get" action={r.index.href()} class="card filters" role="search">
          <div class="grow">
            <label htmlFor="q">Buscar</label>
            <input
              id="q"
              name="q"
              type="search"
              defaultValue={q}
              placeholder="Nombre o alias: jitomate, tomate, limon…"
              autoComplete="off"
            />
          </div>
          <div>
            <label htmlFor="pasillo">Pasillo</label>
            <select id="pasillo" name="pasillo">
              <option value="" selected={aisle === ''}>
                Todos
              </option>
              {aisles.map((a) => (
                <option key={a.id} value={String(a.id)} selected={aisle === String(a.id)}>
                  {a.name}
                </option>
              ))}
              <option value="0" selected={aisle === '0'}>
                Sin pasillo
              </option>
            </select>
          </div>
          <div class="row">
            <button type="submit">Buscar</button>
            {filtered ? (
              <a class="button secondary" href={r.index.href()}>
                Limpiar
              </a>
            ) : null}
          </div>
        </form>

        <p class="muted small">
          {total === 0
            ? filtered
              ? 'Nada coincide con tu búsqueda.'
              : 'Aún no hay ingredientes.'
            : `${total} ingrediente${total === 1 ? '' : 's'}${filtered ? ' encontrados' : ''}.`}
        </p>

        {items.length ? (
          <div class="card table-wrap">
            <table class="stack-mobile compact-mobile">
              <thead>
                <tr>
                  <th>Ingrediente</th>
                  <th>Pasillo</th>
                  <th>Tienda</th>
                  <th>Unidad</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <a href={r.edit.href({ id: String(item.id) })}>
                        <strong>{item.name}</strong>
                      </a>
                      {item.aliases.length ? <div class="muted small">También: {item.aliases.join(', ')}</div> : null}
                    </td>
                    <td data-label="Pasillo" class={item.aisleName ? 'meta' : 'meta empty'}>
                      {item.aisleName ?? <span class="muted">—</span>}
                    </td>
                    <td data-label="Tienda" class={item.storeName ? 'meta' : 'meta empty'}>
                      {item.storeName ?? <span class="muted">—</span>}
                    </td>
                    <td data-label="Unidad" class={item.unitName ? 'meta' : 'meta empty'}>
                      {item.unitName ?? <span class="muted">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {pages > 1 ? (
          <nav class="pager row" aria-label="Páginas">
            {page > 1 ? (
              <a class="button secondary small" href={pageHref(page - 1)} rel="prev">
                ← Anterior
              </a>
            ) : null}
            <span class="muted small">
              Página {page} de {pages}
            </span>
            {page < pages ? (
              <a class="button secondary small" href={pageHref(page + 1)} rel="next">
                Siguiente →
              </a>
            ) : null}
          </nav>
        ) : null}
      </Layout>
    )
  }
}
