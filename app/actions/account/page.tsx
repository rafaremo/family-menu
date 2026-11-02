import type { Handle } from 'remix/component'

import type { Identity } from '../../auth/middleware.ts'
import type { FieldErrors } from '../../lib/validation.ts'
import { routes } from '../../routes.ts'
import { Flash, Layout } from '../../ui/layout.tsx'
import { PasswordInput } from '../../ui/form.tsx'

export interface AccountPageProps {
  user: Identity
  ok?: string | null
  error?: string | null
  errors?: FieldErrors
}

export function AccountPage(handle: Handle<AccountPageProps>) {
  return () => {
    let { user, ok, error, errors = {} } = handle.props

    return (
      <Layout title="Mi cuenta" user={user} section="cuenta">
        <h1>Mi cuenta</h1>
        <Flash ok={ok} error={error} />

        <div class="card stack">
          <div>
            <strong>{user.name}</strong>{' '}
            <span class={user.role === 'admin' ? 'badge admin' : 'badge'}>
              {user.role === 'admin' ? 'Admin' : 'Miembro'}
            </span>
          </div>
          <div class="muted">{user.email}</div>
        </div>

        <h2>Cambiar contraseña</h2>
        <form method="post" action={routes.account.password.href()} class="card stack narrow">
          <PasswordInput name="currentPassword" label="Contraseña actual" autoComplete="current-password" error={errors.currentPassword} />
          <PasswordInput name="newPassword" label="Nueva contraseña" autoComplete="new-password" error={errors.newPassword} />
          <PasswordInput name="confirmPassword" label="Confirmar nueva contraseña" autoComplete="new-password" error={errors.confirmPassword} />
          <button type="submit">Guardar contraseña</button>
        </form>

        <h2>Tokens para Claude / ChatGPT</h2>
        <p class="muted">Muy pronto podrás crear aquí tus tokens de acceso MCP.</p>
      </Layout>
    )
  }
}
