import type { Handle } from 'remix/component'

import type { Identity } from '../../auth/middleware.ts'
import { routes } from '../../routes.ts'
import { TAG_KINDS, type Tag } from '../../services/catalogs.ts'
import type { RecipeCard as RecipeCardData } from '../../services/recipes.ts'
import { Flash, Layout } from '../../ui/layout.tsx'
import { RecipeCard } from '../../ui/recipe-card.tsx'

export interface RecipeFilters {
  q: string
  tag: string
  ingredient: string
  favorites: boolean
}

export interface RecipesIndexProps {
  user: Identity
  items: RecipeCardData[]
  total: number
  page: number
  pages: number
  filters: RecipeFilters
  tags: Tag[]
  ok?: string | null
}

export function filtersQuery(filters: RecipeFilters, page = 1): string {
  let params = new URLSearchParams()
  if (filters.q) params.set('q', filters.q)
  if (filters.tag) params.set('etiqueta', filters.tag)
  if (filters.ingredient) params.set('ingrediente', filters.ingredient)
  if (filters.favorites) params.set('favoritas', '1')
  if (page > 1) params.set('pagina', String(page))
  let qs = params.toString()
  return qs ? `?${qs}` : ''
}

export function RecipesIndexPage(handle: Handle<RecipesIndexProps>) {
  return () => {
    let { user, items, total, page, pages, filters, tags, ok } = handle.props
    let r = routes.recipes
    let filtered = Boolean(filters.q || filters.tag || filters.ingredient || filters.favorites)

    return (
      <Layout title="Recetas" user={user} section="recetas">
        <div class="page-head">
          <h1>Recetas</h1>
          <a class="button" href={r.new.href()}>
            + Nueva receta
          </a>
        </div>
        <Flash ok={ok} />

        <form method="get" action={r.index.href()} class="card filters" role="search">
          <div class="grow">
            <label htmlFor="q">Buscar</label>
            <input id="q" name="q" type="search" defaultValue={filters.q} placeholder="tinga, sopa, de la abuela…" autoComplete="off" />
          </div>
          <div>
            <label htmlFor="ingrediente">Con ingrediente</label>
            <input id="ingrediente" name="ingrediente" type="search" defaultValue={filters.ingredient} placeholder="pollo" autoComplete="off" />
          </div>
          <div>
            <label htmlFor="etiqueta">Etiqueta</label>
            <select id="etiqueta" name="etiqueta">
              <option value="" selected={!filters.tag}>
                Todas
              </option>
              {TAG_KINDS.map((kind) => {
                let group = tags.filter((t) => t.kind === kind.value)
                return group.length ? (
                  <optgroup key={kind.value} label={kind.label}>
                    {group.map((t) => (
                      <option key={t.id} value={t.slug} selected={filters.tag === t.slug}>
                        {t.name}
                      </option>
                    ))}
                  </optgroup>
                ) : null
              })}
            </select>
          </div>
          <label class="check">
            <input type="checkbox" name="favoritas" value="1" checked={filters.favorites} /> Mis favoritas
          </label>
          <div class="row">
            <button type="submit">Buscar</button>
            {filtered ? (
              <a class="button secondary" href={r.index.href()}>
                Limpiar
              </a>
            ) : null}
          </div>
        </form>

        {items.length ? (
          <>
            <p class="muted small">
              {total} receta{total === 1 ? '' : 's'}
              {filtered ? ' encontradas' : ''}.
            </p>
            <div class="recipe-grid">
              {items.map((item) => (
                <RecipeCard key={item.id} recipe={item} />
              ))}
            </div>
          </>
        ) : filtered ? (
          <p class="muted">Nada coincide con tu búsqueda.</p>
        ) : (
          <div class="card empty-state">
            <p>Aún no hay recetas. ¡Captura la primera receta de la familia!</p>
            <a class="button" href={r.new.href()}>
              + Nueva receta
            </a>
          </div>
        )}

        {pages > 1 ? (
          <nav class="pager row" aria-label="Páginas">
            {page > 1 ? (
              <a class="button secondary small" href={r.index.href() + filtersQuery(filters, page - 1)} rel="prev">
                ← Anterior
              </a>
            ) : null}
            <span class="muted small">
              Página {page} de {pages}
            </span>
            {page < pages ? (
              <a class="button secondary small" href={r.index.href() + filtersQuery(filters, page + 1)} rel="next">
                Siguiente →
              </a>
            ) : null}
          </nav>
        ) : null}
      </Layout>
    )
  }
}
