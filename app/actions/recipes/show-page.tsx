import type { Handle } from 'remix/component'

import type { Identity } from '../../auth/middleware.ts'
import { routes } from '../../routes.ts'
import type { RecipeDetail, RecipeIngredientLine } from '../../services/recipes.ts'
import { formatAmount, formatMinutes, photoUrl } from '../../ui/format.ts'
import { Flash, Layout } from '../../ui/layout.tsx'

export interface RecipeShowProps {
  user: Identity
  recipe: RecipeDetail
  /** Porciones a mostrar (escaladas). */
  servings: number
  lines: RecipeIngredientLine[]
  ok?: string | null
  error?: string | null
}

function groupLines(lines: RecipeIngredientLine[]): { label: string | null; lines: RecipeIngredientLine[] }[] {
  let groups: { label: string | null; lines: RecipeIngredientLine[] }[] = []
  for (let line of lines) {
    let last = groups[groups.length - 1]
    if (last && last.label === line.groupLabel) last.lines.push(line)
    else groups.push({ label: line.groupLabel, lines: [line] })
  }
  return groups
}

export function RecipeShowPage(handle: Handle<RecipeShowProps>) {
  return () => {
    let { user, recipe, servings, lines, ok, error } = handle.props
    let r = routes.recipes
    let scaled = servings !== recipe.servings
    let prep = formatMinutes(recipe.prepMinutes)
    let cook = formatMinutes(recipe.cookMinutes)
    let otherPhotos = recipe.photos.filter((p) => p.id !== recipe.coverPhotoId)

    return (
      <Layout title={recipe.title} user={user} section="recetas">
        <p class="small no-print">
          <a href={r.index.href()}>← Recetas</a>
        </p>
        <Flash ok={ok} error={error} />

        <article class="recipe">
          <header class="recipe-header">
            {recipe.coverPhotoKey ? (
              <img class="recipe-hero" src={photoUrl(recipe.coverPhotoKey)} alt={recipe.title} />
            ) : null}
            <div class="page-head">
              <h1>{recipe.title}</h1>
              <div class="row no-print">
                <form method="post" action={r.favorite.href({ slug: recipe.slug })} class="inline">
                  <button
                    type="submit"
                    class={recipe.isFavorite ? 'fav on' : 'secondary fav'}
                    aria-pressed={recipe.isFavorite ? 'true' : 'false'}
                  >
                    {recipe.isFavorite ? '♥ Favorita' : '♡ Favorita'}
                  </button>
                </form>
                <a class="button secondary" href={r.edit.href({ slug: recipe.slug })}>
                  Editar
                </a>
              </div>
            </div>
            {recipe.familyCredit ? <p class="credit">Receta de {recipe.familyCredit}</p> : null}
            {recipe.description ? <p>{recipe.description}</p> : null}
            <p class="muted small">
              {[prep ? `Preparación: ${prep}` : null, cook ? `Cocción: ${cook}` : null, `${recipe.servings} porciones`]
                .filter(Boolean)
                .join(' · ')}
            </p>
            {recipe.tags.length ? (
              <div class="tag-list">
                {recipe.tags.map((t) => (
                  <a key={t.id} class="badge" href={`${r.index.href()}?etiqueta=${t.slug}`}>
                    {t.name}
                  </a>
                ))}
              </div>
            ) : null}
          </header>

          <div class="recipe-body">
            <section class="card recipe-ingredients">
              <div class="row space-between">
                <h2 class="card-title">Ingredientes</h2>
                <form method="get" action={r.show.href({ slug: recipe.slug })} class="row scale-form no-print">
                  <label htmlFor="porciones" class="small">
                    Porciones
                  </label>
                  <input id="porciones" name="porciones" type="number" min={1} max={100} defaultValue={String(servings)} />
                  <button type="submit" class="secondary small">
                    Ajustar
                  </button>
                </form>
              </div>
              {scaled ? (
                <p class="alert ok small">
                  Cantidades para {servings} porciones (la receta original es para {recipe.servings}).{' '}
                  <a href={r.show.href({ slug: recipe.slug })}>Ver original</a>
                </p>
              ) : null}
              {lines.length ? (
                groupLines(lines).map((group, gi) => (
                  <div key={gi}>
                    {group.label ? <h3 class="group-label">{group.label}</h3> : null}
                    <ul class="ingredient-list">
                      {group.lines.map((line) => (
                        <li key={line.id}>
                          <label>
                            <input type="checkbox" class="no-print" />
                            <span>
                              <strong>{formatAmount(line.quantity, line.unitName, line.unitPlural)}</strong> {line.name}
                              {line.preparation ? <span class="muted">, {line.preparation}</span> : null}
                              {line.optional ? <span class="badge">opcional</span> : null}
                            </span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))
              ) : (
                <p class="muted">Sin ingredientes capturados.</p>
              )}
            </section>

            <section class="recipe-steps">
              <h2>Preparación</h2>
              {recipe.steps.length ? (
                <ol class="steps">
                  {recipe.steps.map((step, i) => (
                    <li key={i}>{step.text}</li>
                  ))}
                </ol>
              ) : (
                <p class="muted">Sin pasos capturados.</p>
              )}
              {recipe.notes ? (
                <>
                  <h2>Notas</h2>
                  <p class="notes">{recipe.notes}</p>
                </>
              ) : null}
              {recipe.sourceUrl ? (
                <p class="small">
                  Fuente:{' '}
                  <a href={recipe.sourceUrl} rel="noopener noreferrer nofollow" target="_blank">
                    {new URL(recipe.sourceUrl).hostname}
                  </a>
                </p>
              ) : null}
            </section>
          </div>

          {otherPhotos.length ? (
            <section class="no-print">
              <h2>Fotos</h2>
              <div class="photo-grid">
                {otherPhotos.map((p) => (
                  <a key={p.id} href={photoUrl(p.storageKey)} class="photo-item card">
                    <img src={photoUrl(p.storageKey)} alt={`Foto de ${recipe.title}`} loading="lazy" />
                  </a>
                ))}
              </div>
            </section>
          ) : null}

          <p class="muted small">
            {recipe.createdByName ? `Capturada por ${recipe.createdByName}. ` : ''}
            {recipe.favoriteCount ? `Favorita de ${recipe.favoriteCount} miembro${recipe.favoriteCount === 1 ? '' : 's'}.` : ''}
          </p>
        </article>
      </Layout>
    )
  }
}
