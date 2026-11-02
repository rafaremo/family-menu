import { formatDay, formatWeek, weekDays } from '../lib/dates.ts'
import { publicUrl } from '../lib/url.ts'
import type { Ingredient } from '../services/ingredients.ts'
import { MEALS, mealLabel, type MenuDetail } from '../services/menus.ts'
import type { RecipeCard, RecipeDetail, RecipeIngredientLine } from '../services/recipes.ts'
import { formatItemAmount, sectionsOf, type ListDetail } from '../services/shopping.ts'
import { formatAmount, formatMinutes } from '../ui/format.ts'

/** Vistas compactas para el LLM (sin campos internos ni ruido). */

export { publicUrl }

function lineText(l: RecipeIngredientLine): string {
  let amount = formatAmount(l.quantity, l.unitName, l.unitPlural)
  return `${amount} ${l.name}${l.preparation ? `, ${l.preparation}` : ''}${l.optional ? ' (opcional)' : ''}`
}

export function recipeJson(r: RecipeDetail, lines: RecipeIngredientLine[] = r.ingredients, servings = r.servings) {
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    description: r.description,
    servings,
    originalServings: r.servings,
    prepMinutes: r.prepMinutes,
    cookMinutes: r.cookMinutes,
    familyCredit: r.familyCredit,
    sourceUrl: r.sourceUrl,
    tags: r.tags.map((t) => t.name),
    isFavorite: r.isFavorite,
    ingredients: lines.map((l) => ({
      ingredient: l.name,
      quantity: l.quantity,
      unit: l.unitCode,
      preparation: l.preparation,
      group: l.groupLabel,
      optional: l.optional,
      text: lineText(l),
    })),
    steps: r.steps.map((s) => s.text),
    notes: r.notes,
    photos: r.photos.length,
    url: publicUrl(`/recetas/${r.slug}`),
  }
}

export function recipeCardJson(r: RecipeCard) {
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    servings: r.servings,
    totalMinutes: r.totalMinutes,
    familyCredit: r.familyCredit,
    tags: r.tags.map((t) => t.name),
    isFavorite: r.isFavorite,
  }
}

export function recipeMarkdown(r: RecipeDetail): string {
  let out = [`# ${r.title}`]
  if (r.familyCredit) out.push(`*Receta de ${r.familyCredit}*`)
  if (r.description) out.push('', r.description)
  let meta = [
    `${r.servings} porciones`,
    r.prepMinutes !== null ? `preparación ${formatMinutes(r.prepMinutes)}` : null,
    r.cookMinutes !== null ? `cocción ${formatMinutes(r.cookMinutes)}` : null,
  ].filter(Boolean)
  out.push('', meta.join(' · '))
  if (r.tags.length) out.push(`Etiquetas: ${r.tags.map((t) => t.name).join(', ')}`)
  out.push('', '## Ingredientes')
  let group: string | null = null
  for (let l of r.ingredients) {
    if (l.groupLabel !== group) {
      group = l.groupLabel
      if (group) out.push('', `### ${group}`)
    }
    out.push(`- ${lineText(l)}`)
  }
  if (r.steps.length) {
    out.push('', '## Preparación')
    r.steps.forEach((s, i) => out.push(`${i + 1}. ${s.text}`))
  }
  if (r.notes) out.push('', '## Notas', r.notes)
  if (r.sourceUrl) out.push('', `Fuente: ${r.sourceUrl}`)
  return out.join('\n')
}

export function ingredientJson(i: Ingredient) {
  return {
    id: i.id,
    name: i.name,
    aliases: i.aliases,
    aisle: i.aisleName,
    store: i.storeName,
    defaultUnit: i.defaultUnit,
    densityGPerMl: i.densityGPerMl,
    gramsPerPiece: i.gramsPerPiece,
    notes: i.notes,
  }
}

export function menuJson(m: MenuDetail) {
  return {
    id: m.id,
    name: m.name,
    weekStart: m.weekStart,
    week: formatWeek(m.weekStart),
    defaultServings: m.defaultServings,
    notes: m.notes,
    shoppingListId: m.listId,
    days: weekDays(m.weekStart).map((date) => ({
      date,
      day: formatDay(date),
      meals: m.items
        .filter((i) => i.date === date)
        .map((i) => ({ itemId: i.id, meal: i.meal, recipe: i.recipeTitle, recipeSlug: i.recipeSlug, servings: i.servings })),
    })),
    url: publicUrl(`/menus/${m.id}`),
  }
}

export function menuMarkdown(m: MenuDetail): string {
  let out = [`# ${m.name}`, formatWeek(m.weekStart), '']
  for (let date of weekDays(m.weekStart)) {
    let items = m.items.filter((i) => i.date === date)
    out.push(`## ${formatDay(date)}`)
    if (!items.length) out.push('- (nada planeado)')
    for (let meal of MEALS) {
      for (let i of items.filter((x) => x.meal === meal.value)) {
        out.push(`- ${mealLabel(i.meal)}: ${i.recipeTitle} (${i.servings} porc.)`)
      }
    }
    out.push('')
  }
  return out.join('\n')
}

export function listJson(l: ListDetail) {
  return {
    id: l.id,
    name: l.name,
    status: l.status,
    menuId: l.menuId,
    progress: `${l.items.filter((i) => i.checked).length}/${l.items.length}`,
    stores: sectionsOf(l.items).map((s) => ({
      store: s.storeName ?? 'Cualquier tienda',
      aisles: s.aisles.map((a) => ({
        aisle: a.aisleName ?? 'Otros',
        items: a.items.map((i) => ({
          itemId: i.id,
          label: i.label,
          amount: formatItemAmount(i) || null,
          checked: i.checked,
          source: i.source,
          for: i.sourceRecipes.map((s) => `${s.recipe} (${s.qty})`),
        })),
      })),
    })),
    url: publicUrl(`/listas/${l.id}`),
  }
}
