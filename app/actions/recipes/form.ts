import type { FieldErrors } from '../../lib/validation.ts'
import { formatQuantity } from '../../lib/quantity.ts'
import { recipeInput, type RecipeDetail, type RecipeInput } from '../../services/recipes.ts'
import { readText } from '../../lib/validation.ts'

/** Renglón del editor de ingredientes (todo texto, como viene del formulario). */
export interface IngredientRowValues {
  quantity: string
  unit: string
  ingredient: string
  preparation: string
  group: string
  optional: boolean
}

export interface RecipeFormValues {
  title: string
  description: string
  servings: string
  prepMinutes: string
  cookMinutes: string
  familyCredit: string
  sourceUrl: string
  steps: string
  notes: string
  /** Nombres de etiquetas marcadas. */
  tags: string[]
  /** Etiquetas nuevas, separadas por comas. */
  newTags: string
  rows: IngredientRowValues[]
}

export const MAX_ROWS = 100
export const ROWS_STEP = 5

export function blankRow(): IngredientRowValues {
  return { quantity: '', unit: '', ingredient: '', preparation: '', group: '', optional: false }
}

export function withBlankRows(rows: IngredientRowValues[], extra: number, minimum = 0): IngredientRowValues[] {
  let target = Math.min(MAX_ROWS, Math.max(rows.length + extra, minimum))
  let result = [...rows]
  while (result.length < target) result.push(blankRow())
  return result
}

export function emptyValues(): RecipeFormValues {
  return {
    title: '',
    description: '',
    servings: '4',
    prepMinutes: '',
    cookMinutes: '',
    familyCredit: '',
    sourceUrl: '',
    steps: '',
    notes: '',
    tags: [],
    newTags: '',
    rows: withBlankRows([], 0, 8),
  }
}

export function valuesFromRecipe(r: RecipeDetail): RecipeFormValues {
  let rows = r.ingredients.map((line) => ({
    quantity: formatQuantity(line.quantity, { plain: true }),
    unit: line.unitCode ?? '',
    ingredient: line.name,
    preparation: line.preparation ?? '',
    group: line.groupLabel ?? '',
    optional: line.optional,
  }))
  return {
    title: r.title,
    description: r.description ?? '',
    servings: String(r.servings),
    prepMinutes: r.prepMinutes === null ? '' : String(r.prepMinutes),
    cookMinutes: r.cookMinutes === null ? '' : String(r.cookMinutes),
    familyCredit: r.familyCredit ?? '',
    sourceUrl: r.sourceUrl ?? '',
    steps: r.steps.map((s) => s.text).join('\n'),
    notes: r.notes ?? '',
    tags: r.tags.map((t) => t.name),
    newTags: '',
    rows: withBlankRows(rows, 3, 6),
  }
}

/** Nombres de campo de un renglón: ing[3][quantity] */
export function rowField(index: number, field: keyof IngredientRowValues): string {
  return `ing[${index}][${field}]`
}

export function readValues(form: FormData): RecipeFormValues {
  let rowCount = Math.min(MAX_ROWS, Math.max(0, Number(readText(form, 'rowCount')) || 0))
  let rows: IngredientRowValues[] = []
  for (let i = 0; i < rowCount; i++) {
    rows.push({
      quantity: readText(form, rowField(i, 'quantity')),
      unit: readText(form, rowField(i, 'unit')),
      ingredient: readText(form, rowField(i, 'ingredient')),
      preparation: readText(form, rowField(i, 'preparation')),
      group: readText(form, rowField(i, 'group')),
      optional: form.get(rowField(i, 'optional')) !== null,
    })
  }
  return {
    title: readText(form, 'title'),
    description: readText(form, 'description'),
    servings: readText(form, 'servings'),
    prepMinutes: readText(form, 'prepMinutes'),
    cookMinutes: readText(form, 'cookMinutes'),
    familyCredit: readText(form, 'familyCredit'),
    sourceUrl: readText(form, 'sourceUrl'),
    steps: readText(form, 'steps'),
    notes: readText(form, 'notes'),
    tags: form.getAll('tags').filter((v): v is string => typeof v === 'string'),
    newTags: readText(form, 'newTags'),
    rows,
  }
}

function isBlankRow(row: IngredientRowValues): boolean {
  return !row.quantity.trim() && !row.unit && !row.ingredient.trim() && !row.preparation.trim() && !row.group.trim()
}

export interface ParsedRecipe {
  ok: boolean
  data?: RecipeInput
  errors: FieldErrors
}

/**
 * Valida con el mismo esquema que usa el MCP. Los renglones vacíos se ignoran;
 * los errores de renglón se reportan como `ing.<índice del formulario>.<campo>`.
 */
export function parseRecipeForm(values: RecipeFormValues): ParsedRecipe {
  let kept: { index: number; row: IngredientRowValues }[] = []
  values.rows.forEach((row, index) => {
    if (!isBlankRow(row)) kept.push({ index, row })
  })

  let raw = {
    title: values.title,
    description: values.description,
    servings: values.servings,
    prepMinutes: values.prepMinutes,
    cookMinutes: values.cookMinutes,
    familyCredit: values.familyCredit,
    sourceUrl: values.sourceUrl,
    steps: values.steps,
    notes: values.notes,
    tags: [...values.tags, ...values.newTags.split(',')],
    ingredients: kept.map(({ row }) => ({
      ingredient: row.ingredient,
      quantity: row.quantity,
      unit: row.unit,
      preparation: row.preparation,
      group: row.group,
      optional: row.optional,
    })),
  }

  let result = recipeInput.safeParse(raw)
  if (result.success) return { ok: true, data: result.data, errors: {} }

  let errors: FieldErrors = {}
  for (let issue of result.error.issues) {
    let [first, second, third] = issue.path
    let key =
      first === 'ingredients' && typeof second === 'number' && third !== undefined
        ? `ing.${kept[second]!.index}.${String(third)}`
        : String(first ?? '_')
    errors[key] ??= issue.message
  }
  return { ok: false, errors }
}
