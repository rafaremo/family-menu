import type { Handle } from 'remix/component'

import type { FieldErrors } from '../../lib/validation.ts'
import { routes } from '../../routes.ts'
import { Document } from '../document.tsx'

export interface LoginPageProps {
  email?: string
  redirectTo?: string
  error?: string
  errors?: FieldErrors
}

export function LoginPage(handle: Handle<LoginPageProps>) {
  return () => {
    let { email = '', redirectTo = '/', error, errors = {} } = handle.props

    return (
      <Document title="Iniciar sesión">
        <main class="center-screen">
          <div class="card narrow stack" style={{ width: '100%' }}>
            <div>
              <div style={{ fontSize: '2.5rem' }}>🍲</div>
              <h1>Family Menu</h1>
              <p class="muted">Inicia sesión con la cuenta que te dio el administrador.</p>
            </div>

            {error ? (
              <p class="alert error" role="alert">
                {error}
              </p>
            ) : null}

            <form method="post" action={routes.login.action.href()} class="stack">
              <input type="hidden" name="redirectTo" value={redirectTo} />
              <div>
                <label htmlFor="email">Correo</label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  defaultValue={email}
                  aria-invalid={errors.email ? 'true' : undefined}
                />
                {errors.email ? <p class="field-error">{errors.email}</p> : null}
              </div>
              <div>
                <label htmlFor="password">Contraseña</label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  aria-invalid={errors.password ? 'true' : undefined}
                />
                {errors.password ? <p class="field-error">{errors.password}</p> : null}
              </div>
              <button type="submit" style={{ width: '100%' }}>
                Entrar
              </button>
            </form>
          </div>
        </main>
      </Document>
    )
  }
}
