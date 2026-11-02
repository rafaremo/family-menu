import type { Handle } from 'remix/component'

import type { Identity } from '../../auth/middleware.ts'
import type { FieldErrors } from '../../lib/validation.ts'
import { routes } from '../../routes.ts'
import { UNIT_DIMENSIONS, type Aisle, type Store, type Unit } from '../../services/catalogs.ts'
import type { Ingredient } from '../../services/ingredients.ts'
import { Select, TextArea, TextInput } from '../../ui/form.tsx'
import { Flash, Layout } from '../../ui/layout.tsx'

export interface IngredientFormValues {
  name: string
  aliases: string
  aisleId: string
  defaultStoreId: string
  defaultUnit: string
  densityGPerMl: string
  gramsPerPiece: string
  notes: string
}

export const EMPTY_VALUES: IngredientFormValues = {
  name: '',
  aliases: '',
  aisleId: '',
  defaultStoreId: '',
  defaultUnit: '',
  densityGPerMl: '',
  gramsPerPiece: '',
  notes: '',
}

const num = (n: number | null) => (n === null ? '' : String(n))

export function valuesFromIngredient(i: Ingredient): IngredientFormValues {
  return {
    name: i.name,
    aliases: i.aliases.join(', '),
    aisleId: i.aisleId ? String(i.aisleId) : '',
    defaultStoreId: i.defaultStoreId ? String(i.defaultStoreId) : '',
    defaultUnit: i.defaultUnit ?? '',
    densityGPerMl: num(i.densityGPerMl),
    gramsPerPiece: num(i.gramsPerPiece),
    notes: i.notes ?? '',
  }
}

export interface IngredientFormPageProps {
  user: Identity
  /** Si existe, es edición. */
  ingredient?: Ingredient
  values: IngredientFormValues
  errors?: FieldErrors
  error?: string | null
  ok?: string | null
  aisles: Aisle[]
  stores: Store[]
  units: Unit[]
  /** Otros ingredientes, para fusionar. */
  mergeOptions?: { id: number; name: string }[]
}

export function IngredientFormPage(handle: Handle<IngredientFormPageProps>) {
  return () => {
    let { user, ingredient, values, errors = {}, error, ok, aisles, stores, units, mergeOptions = [] } = handle.props
    let r = routes.ingredients
    let editing = Boolean(ingredient)
    let title = ingredient ? ingredient.name : 'Nuevo ingrediente'
    let action = ingredient ? r.update.href({ id: String(ingredient.id) }) : r.create.href()

    let unitGroups = UNIT_DIMENSIONS.map((d) => ({
      label: d.label,
      options: units.filter((u) => u.dimension === d.value).map((u) => ({ value: u.code, label: `${u.name} (${u.code})` })),
    })).filter((g) => g.options.length)

    return (
      <Layout title={title} user={user} section="ingredientes">
        <p class="small">
          <a href={r.index.href()}>← Ingredientes</a>
        </p>
        <h1>{title}</h1>
        <Flash ok={ok} error={error} />

        <form method="post" action={action} class="card stack form-grid">
          <div class="span-2">
            <TextInput name="name" label="Nombre" value={values.name} error={errors.name} autoComplete="off" />
          </div>
          <div class="span-2">
            <TextArea
              name="aliases"
              label="Alias"
              value={values.aliases}
              error={errors.aliases}
              rows={2}
              placeholder="tomate, tomate rojo"
              hint="Otros nombres con los que aparece en recetas, separados por comas. Sirven para buscar y para empatar recetas importadas."
            />
          </div>
          <Select
            name="aisleId"
            label="Pasillo"
            value={values.aisleId}
            error={errors.aisleId}
            empty="Sin pasillo"
            options={aisles.map((a) => ({ value: String(a.id), label: a.name }))}
          />
          <Select
            name="defaultStoreId"
            label="Tienda habitual"
            value={values.defaultStoreId}
            error={errors.defaultStoreId}
            empty="Cualquiera"
            options={stores.map((s) => ({ value: String(s.id), label: s.name }))}
          />
          <Select
            name="defaultUnit"
            label="Unidad habitual"
            value={values.defaultUnit}
            error={errors.defaultUnit}
            empty="—"
            groups={unitGroups}
          />
          <div />
          <TextInput
            name="gramsPerPiece"
            label="Gramos por pieza"
            value={values.gramsPerPiece}
            error={errors.gramsPerPiece}
            required={false}
            inputMode="decimal"
            placeholder="ej. 120"
            hint="Opcional. Permite sumar “2 piezas” con “300 g”."
          />
          <TextInput
            name="densityGPerMl"
            label="Densidad (g por ml)"
            value={values.densityGPerMl}
            error={errors.densityGPerMl}
            required={false}
            inputMode="decimal"
            placeholder="ej. 0.53"
            hint="Opcional. Permite convertir tazas o cucharadas a gramos."
          />
          <div class="span-2">
            <TextArea name="notes" label="Notas" value={values.notes} error={errors.notes} rows={2} />
          </div>
          <div class="span-2 row">
            <button type="submit">{editing ? 'Guardar cambios' : 'Crear ingrediente'}</button>
            <a class="button secondary" href={r.index.href()}>
              Cancelar
            </a>
          </div>
        </form>

        {ingredient ? (
          <>
            <h2>Fusionar duplicado</h2>
            <form method="post" action={r.merge.href({ id: String(ingredient.id) })} class="card stack narrow">
              <p class="muted small">
                Si “{ingredient.name}” es el mismo que otro ingrediente, fusiónalo: su nombre y alias pasan al otro y
                este se elimina.
              </p>
              <div>
                <label htmlFor="merge-target">Fusionar dentro de</label>
                <select id="merge-target" name="targetId" required>
                  <option value="">Elige un ingrediente…</option>
                  {mergeOptions.map((o) => (
                    <option key={o.id} value={String(o.id)}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </div>
              <button type="submit" class="secondary">
                Fusionar
              </button>
            </form>

            <h2>Eliminar</h2>
            <details class="card">
              <summary>Eliminar “{ingredient.name}”…</summary>
              <form method="post" action={r.destroy.href({ id: String(ingredient.id) })} class="inline">
                <button type="submit" class="danger">
                  Sí, eliminar
                </button>
              </form>
            </details>
          </>
        ) : null}
      </Layout>
    )
  }
}
