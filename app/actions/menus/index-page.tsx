import type { Handle } from 'remix/component'

import type { Identity } from '../../auth/middleware.ts'
import { formatWeek } from '../../lib/dates.ts'
import type { FieldErrors } from '../../lib/validation.ts'
import { routes } from '../../routes.ts'
import type { MenuSummary } from '../../services/menus.ts'
import { TextInput } from '../../ui/form.tsx'
import { Flash, Layout } from '../../ui/layout.tsx'

export interface MenusIndexProps {
  user: Identity
  menus: MenuSummary[]
  /** Lunes de esta semana (para marcar "esta semana" y como valor por defecto). */
  thisWeek: string
  suggestedWeek: string
  ok?: string | null
  error?: string | null
  errors?: FieldErrors
  values?: { weekStart: string; name: string; defaultServings: string }
}

export function MenusIndexPage(handle: Handle<MenusIndexProps>) {
  return () => {
    let { user, menus, thisWeek, suggestedWeek, ok, error, errors = {}, values } = handle.props
    let r = routes.menus
    return (
      <Layout title="Menús" user={user} section="menus">
        <h1>Menús</h1>
        <Flash ok={ok} error={error} />

        {menus.length ? (
          <div class="menu-list">
            {menus.map((m) => (
              <a key={m.id} class={m.weekStart === thisWeek ? 'card menu-row current' : 'card menu-row'} href={r.show.href({ id: String(m.id) })}>
                <div>
                  <strong>{m.name}</strong>
                  {m.weekStart === thisWeek ? <span class="badge admin">Esta semana</span> : null}
                  <div class="muted small">{formatWeek(m.weekStart)}</div>
                </div>
                <div class="muted small right">
                  {m.itemCount} platillo{m.itemCount === 1 ? '' : 's'}
                  {m.listId ? <div>🛒 con lista</div> : null}
                </div>
              </a>
            ))}
          </div>
        ) : (
          <p class="muted">Aún no hay menús. Planea la primera semana:</p>
        )}

        <h2>Nuevo menú</h2>
        <form method="post" action={r.create.href()} class="card form-grid narrow-wide">
          <div>
            <label htmlFor="weekStart">Semana</label>
            <input id="weekStart" name="weekStart" type="date" required defaultValue={values?.weekStart ?? suggestedWeek} />
            <p class="field-hint">Cualquier día; se ajusta al lunes.</p>
            {errors.weekStart ? <p class="field-error">{errors.weekStart}</p> : null}
          </div>
          <TextInput
            name="defaultServings"
            label="Porciones por platillo"
            type="number"
            value={values?.defaultServings ?? '4'}
            error={errors.defaultServings}
            required={false}
            inputMode="numeric"
          />
          <div class="span-2">
            <TextInput name="name" label="Nombre (opcional)" value={values?.name} error={errors.name} required={false} placeholder="Semana del 3 nov." />
          </div>
          <div class="span-2">
            <button type="submit">Crear menú</button>
          </div>
        </form>
      </Layout>
    )
  }
}
