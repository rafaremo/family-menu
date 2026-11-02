import type { Handle } from 'remix/component'

import type { Identity } from '../../auth/middleware.ts'
import { addDays, formatDay, formatWeek, formatWeekday, weekDays } from '../../lib/dates.ts'
import { routes } from '../../routes.ts'
import { MEALS, type Meal, type MenuDetail, type MenuItemView } from '../../services/menus.ts'
import { Flash, Layout } from '../../ui/layout.tsx'

export interface MenuShowProps {
  user: Identity
  menu: MenuDetail
  recipes: { id: number; title: string; servings: number }[]
  today: string
  /** Prellenado del formulario "Agregar platillo" (?dia=&comida=). */
  addDate: string
  addMeal: Meal
  ok?: string | null
  error?: string | null
}

function ItemCard(handle: Handle<{ menu: MenuDetail; item: MenuItemView }>) {
  return () => {
    let { menu, item } = handle.props
    let r = routes.menus
    let ids = { id: String(menu.id), itemId: String(item.id) }
    return (
      <div class="menu-item">
        <a href={routes.recipes.show.href({ slug: item.recipeSlug }) + (item.servings !== item.recipeServings ? `?porciones=${item.servings}` : '')}>
          {item.recipeTitle}
        </a>
        <details class="item-edit">
          <summary class="small" title="Cambiar porciones o quitar">
            {item.servings} porc.
          </summary>
          <form method="post" action={r.itemUpdate.href(ids)} class="row nowrap">
            <input
              name="servings"
              type="number"
              min={1}
              max={100}
              defaultValue={String(item.servings)}
              aria-label={`Porciones de ${item.recipeTitle}`}
            />
            <button type="submit" class="secondary small">
              Guardar
            </button>
          </form>
          <form method="post" action={r.itemDestroy.href(ids)}>
            <button type="submit" class="danger small">
              Quitar del menú
            </button>
          </form>
        </details>
      </div>
    )
  }
}

export function MenuShowPage(handle: Handle<MenuShowProps>) {
  return () => {
    let { user, menu, recipes, today, addDate, addMeal, ok, error } = handle.props
    let r = routes.menus
    let id = String(menu.id)
    let days = weekDays(menu.weekStart)
    let cell = (date: string, meal: Meal) => menu.items.filter((i) => i.date === date && i.meal === meal)
    let addHref = (date: string, meal: Meal) => `${r.show.href({ id })}?dia=${date}&comida=${meal}#agregar`

    return (
      <Layout title={menu.name} user={user} section="menus">
        <p class="small">
          <a href={r.index.href()}>← Menús</a>
        </p>
        <div class="page-head">
          <div>
            <h1>{menu.name}</h1>
            <p class="muted small">
              {formatWeek(menu.weekStart)} · {menu.items.length} platillo{menu.items.length === 1 ? '' : 's'}
            </p>
          </div>
          <div class="row">
            <form method="post" action={r.generateList.href({ id })} class="inline">
              <button type="submit" disabled={!menu.items.length}>
                🛒 {menu.listId ? 'Actualizar lista' : 'Generar lista'}
              </button>
            </form>
            {menu.listId ? (
              <a class="button secondary" href={routes.lists.show.href({ id: String(menu.listId) })}>
                Ver lista
              </a>
            ) : null}
          </div>
        </div>
        <Flash ok={ok} error={error} />
        {menu.notes ? <p class="notes">{menu.notes}</p> : null}

        <div class="week-grid" role="table" aria-label={`Menú ${menu.name}`}>
          <div class="week-row week-head" role="row">
            <span role="columnheader" />
            {MEALS.map((m) => (
              <span key={m.value} role="columnheader">
                {m.label}
              </span>
            ))}
          </div>
          {days.map((date) => (
            <div key={date} class={date === today ? 'week-row today' : 'week-row'} role="row">
              <div class="week-day" role="rowheader">
                <strong>{formatWeekday(date)}</strong>
                <span class="muted small">{formatDay(date).replace(/^\S+\s/, '')}</span>
                {date === today ? <span class="badge admin">Hoy</span> : null}
              </div>
              {MEALS.map((m) => {
                let items = cell(date, m.value)
                return (
                  <div key={m.value} class={items.length ? 'week-cell' : 'week-cell empty'} role="cell">
                    <span class="meal-label">{m.label}</span>
                    {items.map((item) => (
                      <ItemCard key={item.id} menu={menu} item={item} />
                    ))}
                    <a class="add-link" href={addHref(date, m.value)} aria-label={`Agregar a ${m.label} del ${formatDay(date)}`}>
                      +
                    </a>
                  </div>
                )
              })}
            </div>
          ))}
        </div>

        <h2 id="agregar">Agregar platillo</h2>
        {recipes.length ? (
          <form method="post" action={r.itemAdd.href({ id })} class="card add-item-form">
            <div>
              <label htmlFor="add-date">Día</label>
              <select id="add-date" name="date">
                {days.map((date) => (
                  <option key={date} value={date} selected={date === addDate}>
                    {formatDay(date)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="add-meal">Comida</label>
              <select id="add-meal" name="meal">
                {MEALS.map((m) => (
                  <option key={m.value} value={m.value} selected={m.value === addMeal}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
            <div class="grow">
              <label htmlFor="add-recipe">Receta</label>
              <select id="add-recipe" name="recipe" required>
                <option value="">Elige una receta…</option>
                {recipes.map((rec) => (
                  <option key={rec.id} value={String(rec.id)}>
                    {rec.title}
                  </option>
                ))}
              </select>
            </div>
            <div class="col-order">
              <label htmlFor="add-servings">Porciones</label>
              <input id="add-servings" name="servings" type="number" min={1} max={100} placeholder={String(menu.defaultServings)} />
            </div>
            <button type="submit">Agregar</button>
          </form>
        ) : (
          <p class="muted">
            Aún no hay recetas. <a href={routes.recipes.new.href()}>Captura una</a> para armar el menú.
          </p>
        )}

        <h2>Opciones</h2>
        <div class="stack">
          <details class="card">
            <summary>Editar nombre, semana o porciones</summary>
            <form method="post" action={r.update.href({ id })} class="form-grid">
              <div>
                <label htmlFor="edit-name">Nombre</label>
                <input id="edit-name" name="name" defaultValue={menu.name} />
              </div>
              <div>
                <label htmlFor="edit-week">Semana</label>
                <input id="edit-week" name="weekStart" type="date" defaultValue={menu.weekStart} />
                <p class="field-hint">Si cambias la semana, los platillos se mueven con ella.</p>
              </div>
              <div>
                <label htmlFor="edit-servings">Porciones por platillo</label>
                <input id="edit-servings" name="defaultServings" type="number" min={1} max={100} defaultValue={String(menu.defaultServings)} />
              </div>
              <div class="span-2">
                <label htmlFor="edit-notes">Notas</label>
                <textarea id="edit-notes" name="notes" rows={2} defaultValue={menu.notes ?? ''} />
              </div>
              <div class="span-2">
                <button type="submit">Guardar</button>
              </div>
            </form>
          </details>

          <details class="card">
            <summary>Repetir este menú otra semana</summary>
            <form method="post" action={r.copy.href({ id })} class="row add-form">
              <div>
                <label htmlFor="copy-week">Semana destino</label>
                <input id="copy-week" name="weekStart" type="date" required defaultValue={addDays(menu.weekStart, 7)} />
              </div>
              <button type="submit" class="secondary">
                Copiar menú
              </button>
            </form>
          </details>

          <details class="card">
            <summary>Eliminar menú…</summary>
            <p class="muted small">Las listas del súper que ya generaste se conservan.</p>
            <form method="post" action={r.destroy.href({ id })} class="inline">
              <button type="submit" class="danger">
                Sí, eliminar “{menu.name}”
              </button>
            </form>
          </details>
        </div>
      </Layout>
    )
  }
}
