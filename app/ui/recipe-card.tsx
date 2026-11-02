import type { Handle } from 'remix/component'

import { routes } from '../routes.ts'
import type { RecipeCard as RecipeCardData } from '../services/recipes.ts'
import { formatMinutes, photoUrl } from './format.ts'

export function RecipeCard(handle: Handle<{ recipe: RecipeCardData }>) {
  return () => {
    let { recipe } = handle.props
    let minutes = formatMinutes(recipe.totalMinutes)
    return (
      <a class="card recipe-card" href={routes.recipes.show.href({ slug: recipe.slug })}>
        <div class="recipe-cover">
          {recipe.coverPhotoKey ? (
            <img src={photoUrl(recipe.coverPhotoKey)} alt="" loading="lazy" />
          ) : (
            <span class="recipe-cover-empty" aria-hidden="true">
              🍲
            </span>
          )}
          {recipe.isFavorite ? (
            <span class="fav-badge" title="Favorita">
              ♥
            </span>
          ) : null}
        </div>
        <div class="recipe-card-body">
          <h3>{recipe.title}</h3>
          <p class="muted small">
            {[minutes, `${recipe.servings} porc.`, recipe.familyCredit ? `de ${recipe.familyCredit}` : null]
              .filter(Boolean)
              .join(' · ')}
          </p>
          {recipe.tags.length ? (
            <div class="tag-list">
              {recipe.tags.slice(0, 3).map((t) => (
                <span key={t.id} class="badge">
                  {t.name}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </a>
    )
  }
}
