import type { Handle } from 'remix/component'

import type { Identity } from '../../../auth/middleware.ts'
import type { FieldErrors } from '../../../lib/validation.ts'
import { routes } from '../../../routes.ts'
import type { Member } from '../../../services/members.ts'
import { TextInput } from '../../../ui/form.tsx'
import { Flash, Layout } from '../../../ui/layout.tsx'

export interface MembersPageProps {
  user: Identity
  members: Member[]
  ok?: string | null
  error?: string | null
  values?: { name: string; email: string; role: string }
  errors?: FieldErrors
  /** Miembro cuyo formulario de edición se deja abierto (tras un error). */
  editing?: string | null
}

const dateFmt = new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium' })

export function MembersPage(handle: Handle<MembersPageProps>) {
  return () => {
    let { user, members, ok, error, values, errors = {}, editing } = handle.props
    let r = routes.admin.members

    return (
      <Layout title="Miembros" user={user} section="admin">
        <h1>Miembros de la familia</h1>
        <Flash ok={ok} error={error} />

        <div class="card table-wrap">
          <table class="stack-mobile">
            <thead>
              <tr>
                <th>Miembro</th>
                <th>Rol</th>
                <th>Alta</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => {
                let isSelf = m.id === user.id
                return (
                  <tr key={m.id}>
                    <td>
                      <strong>{m.name}</strong> {isSelf ? <span class="badge">Tú</span> : null}{' '}
                      {m.banned ? <span class="badge danger">Desactivado</span> : null}
                      <div class="muted small">{m.email}</div>
                    </td>
                    <td data-label="Rol">
                      {isSelf ? (
                        <span class={m.role === 'admin' ? 'badge admin' : 'badge'}>
                          {m.role === 'admin' ? 'Admin' : 'Miembro'}
                        </span>
                      ) : (
                        <form method="post" action={r.role.href({ id: m.id })} class="row">
                          <select name="role" aria-label={`Rol de ${m.name}`} style={{ width: 'auto' }}>
                            <option value="member" selected={m.role === 'member'}>
                              Miembro
                            </option>
                            <option value="admin" selected={m.role === 'admin'}>
                              Admin
                            </option>
                          </select>
                          <button type="submit" class="secondary small">
                            Cambiar
                          </button>
                        </form>
                      )}
                    </td>
                    <td class="muted small" data-label="Alta">{dateFmt.format(m.createdAt)}</td>
                    <td class="stack" data-label="Acciones">
                      <details open={editing === m.id}>
                        <summary>Editar nombre o correo</summary>
                        <form method="post" action={r.update.href({ id: m.id })} class="stack">
                          <input
                            name="name"
                            required
                            maxLength={80}
                            defaultValue={m.name}
                            autoComplete="off"
                            aria-label={`Nombre de ${m.name}`}
                          />
                          <input
                            name="email"
                            type="email"
                            required
                            defaultValue={m.email}
                            autoComplete="off"
                            aria-label={`Correo de ${m.name}`}
                          />
                          <p class="field-hint">El correo es con el que inicia sesión; su contraseña no cambia.</p>
                          <button type="submit" class="small">
                            Guardar
                          </button>
                        </form>
                      </details>
                      <details>
                        <summary>Restablecer contraseña</summary>
                        <form method="post" action={r.password.href({ id: m.id })} class="row">
                          <input
                            name="password"
                            type="password"
                            minLength={8}
                            required
                            autoComplete="new-password"
                            placeholder="Nueva contraseña"
                            aria-label={`Nueva contraseña para ${m.name}`}
                            style={{ width: '12rem' }}
                          />
                          <button type="submit" class="small">
                            Guardar
                          </button>
                        </form>
                      </details>
                      {isSelf ? null : (
                        <div class="row">
                          {m.banned ? (
                            <form method="post" action={r.unban.href({ id: m.id })} class="inline">
                              <button type="submit" class="secondary small">
                                Reactivar
                              </button>
                            </form>
                          ) : (
                            <form method="post" action={r.ban.href({ id: m.id })} class="inline">
                              <button type="submit" class="secondary small">
                                Desactivar
                              </button>
                            </form>
                          )}
                          <details>
                            <summary>Eliminar…</summary>
                            <form method="post" action={r.destroy.href({ id: m.id })} class="inline">
                              <button type="submit" class="danger small">
                                Sí, eliminar a {m.name}
                              </button>
                            </form>
                          </details>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <h2>Agregar miembro</h2>
        <form method="post" action={r.create.href()} class="card stack narrow">
          <TextInput name="name" label="Nombre" value={values?.name} error={errors.name} autoComplete="off" />
          <TextInput name="email" label="Correo" type="email" value={values?.email} error={errors.email} autoComplete="off" />
          <TextInput
            name="password"
            label="Contraseña inicial"
            type="password"
            error={errors.password}
            autoComplete="new-password"
          />
          <div>
            <label htmlFor="new-role">Rol</label>
            <select id="new-role" name="role">
              <option value="member" selected={(values?.role ?? 'member') === 'member'}>
                Miembro: recetas, menús y listas
              </option>
              <option value="admin" selected={values?.role === 'admin'}>
                Admin: además administra miembros y catálogos
              </option>
            </select>
          </div>
          <button type="submit">Agregar</button>
        </form>
      </Layout>
    )
  }
}
