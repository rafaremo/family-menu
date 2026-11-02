import { eq, inArray } from 'drizzle-orm'

import { db } from '../db/client.ts'
import { ingredient, recipe, recipeIngredient, recipeTag, tag } from '../db/schema/index.ts'
import { normalizeKey } from '../lib/slug.ts'

/**
 * Texto de búsqueda de una receta (sin acentos): título, descripción, crédito familiar,
 * nombres y alias de sus ingredientes y sus etiquetas. Se indexa con full-text en español y trigramas.
 */
export function buildRecipeSearchText(parts: {
  title: string
  description?: string | null
  familyCredit?: string | null
  ingredientNames?: string[]
  tagNames?: string[]
}): string {
  return normalizeKey(
    [parts.title, parts.description, parts.familyCredit, ...(parts.ingredientNames ?? []), ...(parts.tagNames ?? [])]
      .filter(Boolean)
      .join(' '),
  )
}

/** Recalcula `search_text` (p. ej. después de renombrar o fusionar ingredientes, o cambiar etiquetas). */
export async function refreshRecipeSearchText(recipeIds: number[]): Promise<void> {
  let ids = [...new Set(recipeIds)]
  if (!ids.length) return

  let recipes = await db
    .select({ id: recipe.id, title: recipe.title, description: recipe.description, familyCredit: recipe.familyCredit })
    .from(recipe)
    .where(inArray(recipe.id, ids))
  let ingredientRows = await db
    .select({ recipeId: recipeIngredient.recipeId, name: ingredient.name, aliases: ingredient.aliases })
    .from(recipeIngredient)
    .innerJoin(ingredient, eq(ingredient.id, recipeIngredient.ingredientId))
    .where(inArray(recipeIngredient.recipeId, ids))
  let tagRows = await db
    .select({ recipeId: recipeTag.recipeId, name: tag.name })
    .from(recipeTag)
    .innerJoin(tag, eq(tag.id, recipeTag.tagId))
    .where(inArray(recipeTag.recipeId, ids))

  for (let r of recipes) {
    let searchText = buildRecipeSearchText({
      ...r,
      ingredientNames: ingredientRows.filter((i) => i.recipeId === r.id).flatMap((i) => [i.name, ...i.aliases]),
      tagNames: tagRows.filter((t) => t.recipeId === r.id).map((t) => t.name),
    })
    await db.update(recipe).set({ searchText }).where(eq(recipe.id, r.id))
  }
}

/** Recetas que usan un ingrediente. */
export async function recipeIdsUsingIngredient(ingredientId: number): Promise<number[]> {
  let rows = await db
    .selectDistinct({ id: recipeIngredient.recipeId })
    .from(recipeIngredient)
    .where(eq(recipeIngredient.ingredientId, ingredientId))
  return rows.map((r) => r.id)
}

/** Recetas con una etiqueta. */
export async function recipeIdsWithTag(tagId: number): Promise<number[]> {
  let rows = await db.select({ id: recipeTag.recipeId }).from(recipeTag).where(eq(recipeTag.tagId, tagId))
  return rows.map((r) => r.id)
}
