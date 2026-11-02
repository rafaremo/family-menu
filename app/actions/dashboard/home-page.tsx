import type { Handle } from 'remix/component'

import type { Identity } from '../../auth/middleware.ts'
import { routes } from '../../routes.ts'
import { Layout } from '../../ui/layout.tsx'

const upcoming = [
  { emoji: '📖', title: 'Recetas', text: 'El recetario de la familia, con fotos, etiquetas y favoritos.' },
  { emoji: '🗓️', title: 'Menús', text: 'Planea la semana: desayuno, comida y cena.' },
  { emoji: '🛒', title: 'Lista del súper', text: 'Se arma sola desde el menú, agrupada por tienda y pasillo.' },
  { emoji: '🤖', title: 'Claude / ChatGPT', text: 'Administra todo platicando, vía MCP.' },
]

export function HomePage(handle: Handle<{ user: Identity }>) {
  return () => {
    let { user } = handle.props
    let firstName = user.name.split(' ')[0]

    return (
      <Layout title="Inicio" user={user} section="home">
        <h1>¡Hola, {firstName}! 👋</h1>
        <p class="muted">Esto es lo que viene en Family Menu:</p>
        <div class="grid">
          {upcoming.map((item) => (
            <div key={item.title} class="card">
              <div style={{ fontSize: '1.8rem' }}>{item.emoji}</div>
              <h3>{item.title}</h3>
              <p class="muted small">{item.text}</p>
            </div>
          ))}
        </div>
        <p class="row">
          <a class="button" href={routes.ingredients.index.href()}>
            Ingredientes
          </a>
          {user.role === 'admin' ? (
            <>
              <a class="button secondary" href={routes.catalogs.index.href()}>
                Catálogos
              </a>
              <a class="button secondary" href={routes.admin.members.index.href()}>
                Administrar miembros
              </a>
            </>
          ) : null}
        </p>
      </Layout>
    )
  }
}
