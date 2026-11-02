import type { Handle } from 'remix/component'

import type { Identity } from '../../auth/middleware.ts'
import { routes } from '../../routes.ts'
import { Flash, Layout } from '../../ui/layout.tsx'

export function ImportPage(handle: Handle<{ user: Identity; url?: string; error?: string | null }>) {
  return () => {
    let { user, url, error } = handle.props
    return (
      <Layout title="Importar receta" user={user} section="recetas">
        <p class="small">
          <a href={routes.recipes.index.href()}>← Recetas</a>
        </p>
        <h1>Importar receta de internet</h1>
        <Flash error={error} />
        <form method="post" action={routes.recipes.importPreview.href()} class="card stack">
          <div>
            <label htmlFor="import-url">Dirección (URL) de la receta</label>
            <input
              id="import-url"
              name="url"
              type="url"
              required
              defaultValue={url ?? ''}
              placeholder="https://www.kiwilimon.com/receta/…"
              autoComplete="off"
            />
            <p class="field-hint">
              Funciona con la mayoría de sitios de recetas (Kiwilimón, Cookpad, Directo al Paladar, Cocina Fácil, Recetas
              Nestlé, blogs de WordPress…). Verás una vista previa para revisar antes de guardar.
            </p>
          </div>
          <button type="submit">Leer receta</button>
        </form>
      </Layout>
    )
  }
}
