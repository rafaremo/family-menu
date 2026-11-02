import type { Handle } from 'remix/component'

import type { Identity } from '../../auth/middleware.ts'
import type { FieldErrors } from '../../lib/validation.ts'
import { routes } from '../../routes.ts'
import { TAG_KINDS, UNIT_DIMENSIONS, type Tag, type Unit } from '../../services/catalogs.ts'
import { MAX_PHOTOS_PER_RECIPE } from '../../services/photos.ts'
import type { RecipeDetail } from '../../services/recipes.ts'
import { TextArea, TextInput } from '../../ui/form.tsx'
import { photoUrl } from '../../ui/format.ts'
import { Flash, Layout } from '../../ui/layout.tsx'
import { MAX_ROWS, ROWS_STEP, rowField, type RecipeFormValues } from './form.ts'

export interface ImportInfo {
  siteName: string
  sourceUrl: string
  imageUrl: string | null
  approximate: boolean
  newIngredients: number
}

export interface RecipeFormPageProps {
  user: Identity
  /** Si existe, es edición. */
  recipe?: RecipeDetail
  values: RecipeFormValues
  errors?: FieldErrors
  error?: string | null
  ok?: string | null
  units: Unit[]
  tags: Tag[]
  ingredientNames: string[]
  /** Borrador importado de una URL (para mostrar el aviso y la foto). */
  importInfo?: ImportInfo | null
}

const PHOTO_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif'

export function RecipeFormPage(handle: Handle<RecipeFormPageProps>) {
  return () => {
    let { user, recipe, values, errors = {}, error, ok, units, tags, ingredientNames, importInfo } = handle.props
    let r = routes.recipes
    let title = recipe ? `Editar: ${recipe.title}` : importInfo ? 'Revisar receta importada' : 'Nueva receta'
    let action = recipe ? r.update.href({ slug: recipe.slug }) : r.create.href()
    let rowErrors = Object.entries(errors).filter(([k]) => k.startsWith('ing.'))
    let checked = new Set(values.tags.map((t) => t.toLowerCase()))

    let unitGroups = UNIT_DIMENSIONS.map((d) => ({
      label: d.label,
      units: units.filter((u) => u.dimension === d.value),
    })).filter((g) => g.units.length)

    return (
      <Layout title={title} user={user} section="recetas">
        <p class="small">
          {recipe ? <a href={r.show.href({ slug: recipe.slug })}>← {recipe.title}</a> : <a href={r.index.href()}>← Recetas</a>}
        </p>
        <h1>{title}</h1>
        <Flash ok={ok} error={error ?? (rowErrors.length ? 'Revisa los ingredientes marcados.' : null)} />

        <form method="post" action={action} enctype="multipart/form-data" class="stack recipe-form">
          {/* Enter en cualquier campo guarda (botón por defecto = el primero del formulario). */}
          <button type="submit" class="sr-only" tabIndex={-1} aria-hidden="true">
            Guardar
          </button>
          <input type="hidden" name="rowCount" value={String(values.rows.length)} />
          {importInfo ? (
            <section class="card import-banner">
              <input type="hidden" name="importSite" value={importInfo.siteName} />
              <input type="hidden" name="importApprox" value={importInfo.approximate ? '1' : ''} />
              <p>
                <strong>Importada de {importInfo.siteName}.</strong> Revisa todo antes de guardar: cantidades, unidades y nombres
                pueden necesitar ajustes.
                {importInfo.newIngredients
                  ? ` ${importInfo.newIngredients} ingrediente${importInfo.newIngredients === 1 ? '' : 's'} no está${importInfo.newIngredients === 1 ? '' : 'n'} en el catálogo (marcados “nuevo”) y se agregará${importInfo.newIngredients === 1 ? '' : 'n'} al guardar; si alguno ya existe con otro nombre, corrígelo.`
                  : ''}
              </p>
              {importInfo.approximate ? (
                <p class="alert error small">
                  Esta página no publica la receta en formato estructurado; la leí “a ojo”. Revisa con más cuidado los
                  ingredientes y los pasos.
                </p>
              ) : null}
              {importInfo.imageUrl ? (
                <label class="import-photo">
                  <img src={importInfo.imageUrl} alt="Foto de la receta original" referrerPolicy="no-referrer" loading="lazy" />
                  <span>
                    <input type="checkbox" name="importImage" value={importInfo.imageUrl} checked /> Guardar esta foto con la receta
                  </span>
                </label>
              ) : null}
            </section>
          ) : null}

          <section class="card form-grid">
            <div class="span-2">
              <TextInput name="title" label="Nombre de la receta" value={values.title} error={errors.title} autoComplete="off" placeholder="Tinga de pollo" />
            </div>
            <div class="span-2">
              <TextArea name="description" label="Descripción" value={values.description} error={errors.description} rows={2} />
            </div>
            <div class="row nowrap three">
              <TextInput name="servings" label="Porciones" type="number" value={values.servings} error={errors.servings} required={false} inputMode="numeric" />
              <TextInput name="prepMinutes" label="Preparación (min)" type="number" value={values.prepMinutes} error={errors.prepMinutes} required={false} inputMode="numeric" />
              <TextInput name="cookMinutes" label="Cocción (min)" type="number" value={values.cookMinutes} error={errors.cookMinutes} required={false} inputMode="numeric" />
            </div>
            <TextInput
              name="familyCredit"
              label="Receta de…"
              value={values.familyCredit}
              error={errors.familyCredit}
              required={false}
              placeholder="la abuela Lupe"
            />
            <div class="span-2">
              <TextInput
                name="sourceUrl"
                label="Fuente (URL)"
                type="url"
                value={values.sourceUrl}
                error={errors.sourceUrl}
                required={false}
                placeholder="https://…"
              />
            </div>
          </section>

          <section class="card">
            <h2 class="card-title">Ingredientes</h2>
            <p class="muted small">
              Escribe el ingrediente; si no existe se agrega al catálogo. Cantidades como <code>2</code>, <code>1/2</code>,{' '}
              <code>1 ½</code> o <code>0.5</code>; vacía = “al gusto”. Usa “Grupo” para secciones como “Para la salsa”.
            </p>
            <datalist id="ingredient-names">
              {ingredientNames.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
            <div class="ing-table" role="table" aria-label="Ingredientes">
              <div class="ing-row ing-head" role="row">
                <span role="columnheader">Cantidad</span>
                <span role="columnheader">Unidad</span>
                <span role="columnheader">Ingrediente</span>
                <span role="columnheader">Preparación</span>
                <span role="columnheader">Grupo</span>
                <span role="columnheader" title="Opcional">Opc.</span>
              </div>
              {values.rows.map((row, i) => {
                // Ejemplos solo en el primer renglón y si está vacío (para que no parezcan datos).
                let showHints = i === 0 && !row.ingredient && !row.quantity
                let qtyError = errors[`ing.${i}.quantity`]
                let nameError = errors[`ing.${i}.ingredient`]
                let otherError = Object.entries(errors).find(
                  ([k]) => k.startsWith(`ing.${i}.`) && !k.endsWith('.quantity') && !k.endsWith('.ingredient'),
                )?.[1]
                return (
                  <div key={i} class="ing-row" role="row">
                    <input
                      name={rowField(i, 'quantity')}
                      defaultValue={row.quantity}
                      inputMode="decimal"
                      placeholder={showHints ? '2' : undefined}
                      aria-label={`Cantidad, renglón ${i + 1}`}
                      aria-invalid={qtyError ? 'true' : undefined}
                    />
                    <select name={rowField(i, 'unit')} aria-label={`Unidad, renglón ${i + 1}`}>
                      <option value="" selected={!row.unit}>
                        —
                      </option>
                      {unitGroups.map((g) => (
                        <optgroup key={g.label} label={g.label}>
                          {g.units.map((u) => (
                            <option key={u.code} value={u.code} selected={row.unit === u.code}>
                              {u.name}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                    <input
                      name={rowField(i, 'ingredient')}
                      defaultValue={row.ingredient}
                      list="ingredient-names"
                      autoComplete="off"
                      placeholder={showHints ? 'Pechuga de pollo' : undefined}
                      aria-label={`Ingrediente, renglón ${i + 1}`}
                      aria-invalid={nameError ? 'true' : undefined}
                    />
                    <input
                      name={rowField(i, 'preparation')}
                      defaultValue={row.preparation}
                      placeholder={showHints ? 'picada' : undefined}
                      aria-label={`Preparación, renglón ${i + 1}`}
                    />
                    <input
                      name={rowField(i, 'group')}
                      defaultValue={row.group}
                      placeholder={showHints ? 'Para la salsa' : undefined}
                      aria-label={`Grupo, renglón ${i + 1}`}
                    />
                    <label class="ing-opt">
                      <input type="checkbox" name={rowField(i, 'optional')} checked={row.optional} />
                      <span class="mobile-only">Opcional</span>
                    </label>
                    {qtyError || nameError || otherError ? (
                      <p class="field-error ing-error">{qtyError ?? nameError ?? otherError}</p>
                    ) : null}
                    {row.hint ? (
                      <p class="ing-hint">
                        {row.isNew ? <span class="badge new">nuevo</span> : null} Original: “{row.hint}”
                      </p>
                    ) : null}
                  </div>
                )
              })}
            </div>
            {values.rows.length < MAX_ROWS ? (
              <button type="submit" name="intent" value="addRows" class="secondary small" formNoValidate>
                + {ROWS_STEP} renglones más
              </button>
            ) : null}
          </section>

          <section class="card stack">
            <h2 class="card-title">Preparación</h2>
            <TextArea
              name="steps"
              label="Pasos"
              value={values.steps}
              error={errors.steps}
              rows={8}
              hint="Un paso por renglón. La numeración se pone sola."
              placeholder={'Cuece el pollo con ajo y cebolla.\nDesmenúzalo.\nFríe la cebolla y agrega el jitomate…'}
            />
            <TextArea name="notes" label="Notas y trucos" value={values.notes} error={errors.notes} rows={3} />
          </section>

          <section class="card stack">
            <h2 class="card-title">Etiquetas</h2>
            {TAG_KINDS.map((kind) => {
              let group = tags.filter((t) => t.kind === kind.value)
              if (!group.length) return null
              return (
                <fieldset key={kind.value} class="chips">
                  <legend>{kind.label}</legend>
                  {group.map((t) => (
                    <label key={t.id} class="chip">
                      <input type="checkbox" name="tags" value={t.name} checked={checked.has(t.name.toLowerCase())} />
                      <span>{t.name}</span>
                    </label>
                  ))}
                </fieldset>
              )
            })}
            <TextInput
              name="newTags"
              label="Otras etiquetas"
              value={values.newTags}
              error={errors.tags}
              required={false}
              placeholder="favorita de los niños, lonchera"
              hint="Separadas por comas. Las que no existan se crean."
            />
          </section>

          {recipe ? null : (
            <section class="card stack">
              <h2 class="card-title">Fotos</h2>
              <div>
                <label htmlFor="photos">Agregar fotos</label>
                <input id="photos" name="photos" type="file" accept={PHOTO_ACCEPT} multiple />
                <p class="field-hint">JPG, PNG, WEBP o GIF; hasta 10 MB cada una. La primera será la portada.</p>
              </div>
            </section>
          )}

          <div class="row sticky-actions">
            <button type="submit">{recipe ? 'Guardar cambios' : 'Guardar receta'}</button>
            <a class="button secondary" href={recipe ? r.show.href({ slug: recipe.slug }) : r.index.href()}>
              Cancelar
            </a>
          </div>
        </form>

        {recipe ? <PhotoManager recipe={recipe} /> : null}

        {recipe ? (
          <>
            <h2>Eliminar receta</h2>
            <details class="card">
              <summary>Eliminar “{recipe.title}”…</summary>
              <p class="muted small">Se borran también sus fotos. Esto no se puede deshacer.</p>
              <form method="post" action={r.destroy.href({ slug: recipe.slug })} class="inline">
                <button type="submit" class="danger">
                  Sí, eliminar receta
                </button>
              </form>
            </details>
          </>
        ) : null}
      </Layout>
    )
  }
}

function PhotoManager(handle: Handle<{ recipe: RecipeDetail }>) {
  return () => {
    let { recipe } = handle.props
    let r = routes.recipes
    return (
      <section id="fotos">
        <h2>Fotos</h2>
        {recipe.photos.length ? (
          <div class="photo-grid">
            {recipe.photos.map((p) => {
              let isCover = p.id === recipe.coverPhotoId
              return (
                <figure key={p.id} class="card photo-item">
                  <img src={photoUrl(p.storageKey)} alt={`Foto de ${recipe.title}`} loading="lazy" />
                  <figcaption class="row">
                    {isCover ? (
                      <span class="badge admin">Portada</span>
                    ) : (
                      <form method="post" action={r.photoCover.href({ slug: recipe.slug, photoId: String(p.id) })} class="inline">
                        <button type="submit" class="secondary small">
                          Usar de portada
                        </button>
                      </form>
                    )}
                    <form method="post" action={r.photoDestroy.href({ slug: recipe.slug, photoId: String(p.id) })} class="inline">
                      <button type="submit" class="danger small">
                        Quitar
                      </button>
                    </form>
                  </figcaption>
                </figure>
              )
            })}
          </div>
        ) : (
          <p class="muted">Aún no tiene fotos.</p>
        )}
        {recipe.photos.length < MAX_PHOTOS_PER_RECIPE ? (
          <form method="post" action={r.photoAdd.href({ slug: recipe.slug })} enctype="multipart/form-data" class="card row add-form">
            <div class="grow">
              <label htmlFor="more-photos">Agregar fotos</label>
              <input id="more-photos" name="photos" type="file" accept={PHOTO_ACCEPT} multiple required />
            </div>
            <button type="submit">Subir</button>
          </form>
        ) : null}
      </section>
    )
  }
}
