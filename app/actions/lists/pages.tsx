import type { Handle } from 'remix/component'

import type { Identity } from '../../auth/middleware.ts'
import { routes } from '../../routes.ts'
import type { Unit } from '../../services/catalogs.ts'
import { formatItemAmount, sectionsOf, type ListDetail, type ListItemView, type ListSummary } from '../../services/shopping.ts'
import { Flash, Layout } from '../../ui/layout.tsx'

// ─── Índice ──────────────────────────────────────────────────────────────────

export function ListsIndexPage(handle: Handle<{ user: Identity; lists: ListSummary[]; ok?: string | null; error?: string | null }>) {
  return () => {
    let { user, lists, ok, error } = handle.props
    let r = routes.lists
    return (
      <Layout title="Listas del súper" user={user} section="listas">
        <h1>Listas del súper</h1>
        <Flash ok={ok} error={error} />
        {lists.length ? (
          <div class="menu-list">
            {lists.map((l) => (
              <a key={l.id} class={l.status === 'completada' ? 'card menu-row done' : 'card menu-row'} href={r.show.href({ id: String(l.id) })}>
                <div>
                  <strong>{l.name}</strong>
                  {l.status === 'completada' ? <span class="badge">Completada</span> : null}
                  <div class="muted small">{l.menuName ? `Menú: ${l.menuName}` : 'Lista suelta'}</div>
                </div>
                <div class="right">
                  <span class="progress-text">
                    {l.checked}/{l.total}
                  </span>
                  <progress max={Math.max(l.total, 1)} value={l.checked} aria-label="Avance" />
                </div>
              </a>
            ))}
          </div>
        ) : (
          <p class="muted">
            Aún no hay listas. Genera una desde un <a href={routes.menus.index.href()}>menú</a> o crea una suelta:
          </p>
        )}
        <h2>Nueva lista suelta</h2>
        <form method="post" action={r.create.href()} class="card row add-form">
          <div class="grow">
            <label htmlFor="list-name">Nombre</label>
            <input id="list-name" name="name" required placeholder="Costco del sábado" />
          </div>
          <button type="submit">Crear</button>
        </form>
      </Layout>
    )
  }
}

// ─── Lista ───────────────────────────────────────────────────────────────────

export interface ListShowProps {
  user: Identity
  list: ListDetail
  units: Unit[]
  hideChecked: boolean
  exportText: string
  ok?: string | null
  error?: string | null
}

function ItemRow(handle: Handle<{ list: ListDetail; item: ListItemView }>) {
  return () => {
    let { list, item } = handle.props
    let r = routes.lists
    let ids = { id: String(list.id), itemId: String(item.id) }
    let amount = formatItemAmount(item)
    let sources = item.sourceRecipes.map((s) => `${s.recipe} (${s.qty})`).join(' · ')
    return (
      <li id={`item-${item.id}`} class={item.checked ? 'list-item checked' : 'list-item'} data-item>
        <form method="post" action={r.itemCheck.href(ids)} data-enhance="toggle" class="item-toggle">
          <input type="hidden" name="checked" value={item.checked ? '0' : '1'} />
          <button type="submit" class="check" aria-pressed={item.checked ? 'true' : 'false'} aria-label={`${item.checked ? 'Desmarcar' : 'Marcar'} ${item.label}`}>
            <span class="box" aria-hidden="true">
              ✓
            </span>
            <span class="item-text">
              <span class="item-label">{item.label}</span>
              {amount ? <span class="item-amount">{amount}</span> : null}
            </span>
          </button>
        </form>
        {sources || item.notes || item.source === 'manual' ? (
          <details class="item-more">
            <summary aria-label={`Detalles de ${item.label}`}>⋯</summary>
            {sources ? <p class="small muted">Para: {sources}</p> : null}
            {item.notes ? <p class="small">{item.notes}</p> : null}
            <form method="post" action={r.itemDestroy.href(ids)}>
              <button type="submit" class="danger small">
                Quitar de la lista
              </button>
            </form>
          </details>
        ) : null}
      </li>
    )
  }
}

export function ListShowPage(handle: Handle<ListShowProps>) {
  return () => {
    let { user, list, units, hideChecked, exportText, ok, error } = handle.props
    let r = routes.lists
    let id = String(list.id)
    let total = list.items.length
    let done = list.items.filter((i) => i.checked).length
    let visible = hideChecked ? list.items.filter((i) => !i.checked) : list.items
    let toggleHide = hideChecked ? r.show.href({ id }) : `${r.show.href({ id })}?ocultar=1`

    return (
      <Layout title={list.name} user={user} section="listas">
        <p class="small no-print">
          <a href={r.index.href()}>← Listas</a>
          {list.menuId ? (
            <>
              {' · '}
              <a href={routes.menus.show.href({ id: String(list.menuId) })}>Menú: {list.menuName}</a>
            </>
          ) : null}
        </p>
        <div class="page-head">
          <h1>{list.name}</h1>
          <div class="list-progress" data-progress>
            <span>
              <span data-done>{done}</span>/{total}
            </span>
            <progress max={Math.max(total, 1)} value={done} aria-label="Avance" />
          </div>
        </div>
        <Flash ok={ok} error={error} />

        <div class="row list-actions no-print">
          <a class="button secondary small" href={toggleHide}>
            {hideChecked ? 'Mostrar comprados' : 'Ocultar comprados'}
          </a>
          {list.menuId ? (
            <form method="post" action={r.regenerate.href({ id })} class="inline">
              <button type="submit" class="secondary small" title="Vuelve a calcular desde el menú; conserva lo agregado a mano y lo ya marcado">
                ↻ Actualizar desde el menú
              </button>
            </form>
          ) : null}
          {done ? (
            <form method="post" action={r.clearChecked.href({ id })} class="inline">
              <button type="submit" class="secondary small">
                Quitar comprados
              </button>
            </form>
          ) : null}
        </div>

        {visible.length ? (
          sectionsOf(visible).map((section) => (
            <section key={section.storeName ?? '-'} class="list-store">
              <h2>{section.storeName ?? 'Cualquier tienda'}</h2>
              {section.aisles.map((group) => (
                <div key={group.aisleName ?? '-'} class="card list-aisle">
                  <h3>{group.aisleName ?? 'Otros'}</h3>
                  <ul class="list-items">
                    {group.items.map((item) => (
                      <ItemRow key={item.id} list={list} item={item} />
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          ))
        ) : (
          <div class="card empty-state">
            <p>{total ? '¡Todo comprado! ✅' : 'La lista está vacía.'}</p>
          </div>
        )}

        <h2>Agregar a mano</h2>
        <form method="post" action={r.itemAdd.href({ id })} class="card add-item-form no-print">
          <div class="grow">
            <label htmlFor="item-label">Artículo</label>
            <input id="item-label" name="label" required placeholder="Papel de baño" autoComplete="off" />
          </div>
          <div class="col-order">
            <label htmlFor="item-qty">Cantidad</label>
            <input id="item-qty" name="quantity" inputMode="decimal" placeholder="2" />
          </div>
          <div>
            <label htmlFor="item-unit">Unidad</label>
            <select id="item-unit" name="unit">
              <option value="">—</option>
              {units.map((u) => (
                <option key={u.code} value={u.code}>
                  {u.name}
                </option>
              ))}
            </select>
          </div>
          <button type="submit">Agregar</button>
        </form>

        <h2>Compartir</h2>
        <details class="card no-print" id="exportar">
          <summary>Texto para WhatsApp / Notas (solo lo pendiente)</summary>
          <textarea id="export-text" rows={10} readOnly defaultValue={exportText} />
          <div class="row">
            <button type="button" class="secondary small" data-copy="#export-text" hidden>
              Copiar
            </button>
            <button type="button" class="secondary small" data-share="#export-text" data-share-title={list.name} hidden>
              Compartir…
            </button>
            <a class="button secondary small" href={r.text.href({ id })}>
              Ver como texto
            </a>
          </div>
        </details>

        <div class="stack no-print" style={{ marginTop: '1rem' }}>
          <details class="card">
            <summary>Renombrar o marcar como completada</summary>
            <form method="post" action={r.update.href({ id })} class="row add-form">
              <div class="grow">
                <label htmlFor="rename">Nombre</label>
                <input id="rename" name="name" defaultValue={list.name} required />
              </div>
              <div>
                <label htmlFor="status">Estado</label>
                <select id="status" name="status">
                  <option value="abierta" selected={list.status === 'abierta'}>
                    Abierta
                  </option>
                  <option value="completada" selected={list.status === 'completada'}>
                    Completada
                  </option>
                </select>
              </div>
              <button type="submit" class="secondary">
                Guardar
              </button>
            </form>
          </details>
          <details class="card">
            <summary>Eliminar lista…</summary>
            <form method="post" action={r.destroy.href({ id })} class="inline">
              <button type="submit" class="danger">
                Sí, eliminar “{list.name}”
              </button>
            </form>
          </details>
        </div>
      </Layout>
    )
  }
}
