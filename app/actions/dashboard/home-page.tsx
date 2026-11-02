import type { Handle } from 'remix/component'

import type { Identity } from '../../auth/middleware.ts'
import { routes } from '../../routes.ts'
import type { RecipeCard as RecipeCardData } from '../../services/recipes.ts'
import { Layout } from '../../ui/layout.tsx'
import { RecipeCard } from '../../ui/recipe-card.tsx'

const upcoming = [
  { emoji: '🗓️', title: 'Menús', text: 'Planea la semana: desayuno, comida y cena.' },
  { emoji: '🛒', title: 'Lista del súper', text: 'Se arma sola desde el menú, agrupada por tienda y pasillo.' },
  { emoji: '🤖', title: 'Claude / ChatGPT', text: 'Administra todo platicando, vía MCP.' },
]

export function HomePage(handle: Handle<{ user: Identity; recent: RecipeCardData[] }>) {
  return () => {
    let { user, recent } = handle.props
    let firstName = user.name.split(' ')[0]

    return (
      <Layout title="Inicio" user={user} section="home">
        <h1>¡Hola, {firstName}! 👋</h1>

        <p class="row">
          <a class="button" href={routes.recipes.new.href()}>
            + Nueva receta
          </a>
          <a class="button secondary" href={routes.recipes.index.href()}>
            Recetas
          </a>
          <a class="button secondary" href={routes.ingredients.index.href()}>
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

        <h2>Recetas recientes</h2>
        {recent.length ? (
          <div class="recipe-grid">
            {recent.map((recipe) => (
              <RecipeCard key={recipe.id} recipe={recipe} />
            ))}
          </div>
        ) : (
          <div class="card empty-state">
            <p>Aún no hay recetas. ¡Captura la primera receta de la familia!</p>
          </div>
        )}

        <h2>Próximamente</h2>
        <div class="grid">
          {upcoming.map((item) => (
            <div key={item.title} class="card">
              <div style={{ fontSize: '1.8rem' }}>{item.emoji}</div>
              <h3>{item.title}</h3>
              <p class="muted small">{item.text}</p>
            </div>
          ))}
        </div>
      </Layout>
    )
  }
}
