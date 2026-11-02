import type { Handle } from 'remix/component'

import type { Identity } from '../../auth/middleware.ts'
import { formatDay, formatWeek, weekDays } from '../../lib/dates.ts'
import { routes } from '../../routes.ts'
import { MEALS, type MenuDetail } from '../../services/menus.ts'
import type { RecipeCard as RecipeCardData } from '../../services/recipes.ts'
import { Layout } from '../../ui/layout.tsx'
import { RecipeCard } from '../../ui/recipe-card.tsx'

export interface HomeProps {
  user: Identity
  recent: RecipeCardData[]
  week: MenuDetail | null
  today: string
}

function WeekSummary(handle: Handle<{ week: MenuDetail; today: string }>) {
  return () => {
    let { week, today } = handle.props
    let todays = week.items.filter((i) => i.date === today)
    let upcoming = weekDays(week.weekStart).filter((d) => d > today)
    return (
      <section class="card home-week">
        <div class="page-head">
          <div>
            <h2 class="card-title">{week.name}</h2>
            <p class="muted small">{formatWeek(week.weekStart)}</p>
          </div>
          <div class="row">
            <a class="button secondary small" href={routes.menus.show.href({ id: String(week.id) })}>
              Ver menú
            </a>
            {week.listId ? (
              <a class="button small" href={routes.lists.show.href({ id: String(week.listId) })}>
                🛒 Lista
              </a>
            ) : null}
          </div>
        </div>
        <h3>Hoy, {formatDay(today).toLowerCase()}</h3>
        {todays.length ? (
          <ul class="today-meals">
            {MEALS.map((m) =>
              todays
                .filter((i) => i.meal === m.value)
                .map((i) => (
                  <li key={i.id}>
                    <span class="muted small">{m.label}</span>{' '}
                    <a href={routes.recipes.show.href({ slug: i.recipeSlug })}>{i.recipeTitle}</a>
                  </li>
                )),
            )}
          </ul>
        ) : (
          <p class="muted small">Nada planeado para hoy.</p>
        )}
        {upcoming.some((d) => week.items.some((i) => i.date === d)) ? (
          <>
            <h3>Lo que sigue</h3>
            <ul class="today-meals">
              {upcoming.map((d) => {
                let items = week.items.filter((i) => i.date === d)
                return items.length ? (
                  <li key={d}>
                    <span class="muted small">{formatDay(d)}</span> {items.map((i) => i.recipeTitle).join(', ')}
                  </li>
                ) : null
              })}
            </ul>
          </>
        ) : null}
      </section>
    )
  }
}

export function HomePage(handle: Handle<HomeProps>) {
  return () => {
    let { user, recent, week, today } = handle.props
    let firstName = user.name.split(' ')[0]

    return (
      <Layout title="Inicio" user={user} section="home">
        <h1>¡Hola, {firstName}! 👋</h1>

        {week ? (
          <WeekSummary week={week} today={today} />
        ) : (
          <section class="card empty-state">
            <p>Todavía no hay menú para esta semana.</p>
            <form method="post" action={routes.menus.create.href()} class="inline">
              <input type="hidden" name="weekStart" value={today} />
              <button type="submit">🗓️ Planear esta semana</button>
            </form>
          </section>
        )}

        <p class="row" style={{ marginTop: '1rem' }}>
          <a class="button secondary" href={routes.recipes.new.href()}>
            + Nueva receta
          </a>
          <a class="button secondary" href={routes.menus.index.href()}>
            Menús
          </a>
          <a class="button secondary" href={routes.lists.index.href()}>
            Listas
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
            <a class="button" href={routes.recipes.new.href()}>
              + Nueva receta
            </a>
          </div>
        )}
      </Layout>
    )
  }
}
