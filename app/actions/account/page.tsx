import type { Handle } from 'remix/component'

import type { Identity } from '../../auth/middleware.ts'
import type { FieldErrors } from '../../lib/validation.ts'
import { routes } from '../../routes.ts'
import { TOKEN_EXPIRY_OPTIONS, type TokenSummary } from '../../services/tokens.ts'
import { Flash, Layout } from '../../ui/layout.tsx'
import { PasswordInput } from '../../ui/form.tsx'
import { McpConnect } from '../../ui/mcp-connect.tsx'

export interface NewToken {
  name: string
  key: string
}

export interface AccountPageProps {
  user: Identity
  tokens: TokenSummary[]
  /** URL base pública (para los snippets). */
  baseUrl: string
  pathTokensAllowed: boolean
  /** Token recién creado: se muestra una sola vez. */
  newToken?: NewToken | null
  ok?: string | null
  error?: string | null
  errors?: FieldErrors
}

const dateFmt = new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium' })
const dateTimeFmt = new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Mexico_City' })

function Snippet(handle: Handle<{ id: string; title: string; hint?: string; code: string; open?: boolean }>) {
  return () => {
    let { id, title, hint, code, open } = handle.props
    return (
      <details class="snippet" open={open}>
        <summary>{title}</summary>
        {hint ? <p class="muted small">{hint}</p> : null}
        <textarea id={id} readOnly rows={Math.min(10, code.split('\n').length + 1)} defaultValue={code} />
        <button type="button" class="secondary small" data-copy={`#${id}`}>
          Copiar
        </button>
      </details>
    )
  }
}

function NewTokenPanel(handle: Handle<{ token: NewToken; baseUrl: string; pathTokensAllowed: boolean }>) {
  return () => {
    let { token, baseUrl, pathTokensAllowed } = handle.props
    let endpoint = `${baseUrl}/mcp`
    let claudeCode = `claude mcp add --transport http family-menu ${endpoint} \\\n  --header "Authorization: Bearer ${token.key}"`
    let desktop = JSON.stringify(
      {
        mcpServers: {
          'family-menu': { command: 'npx', args: ['-y', 'mcp-remote', endpoint, '--header', `Authorization: Bearer ${token.key}`] },
        },
      },
      null,
      2,
    )
    let generic = JSON.stringify({ mcpServers: { 'family-menu': { url: endpoint, headers: { Authorization: `Bearer ${token.key}` } } } }, null, 2)
    return (
      <section class="card new-token" aria-live="polite">
        <h3 class="card-title">🔑 Token “{token.name}” creado</h3>
        <p>
          <strong>Cópialo ahora:</strong> por seguridad no lo volverás a ver. Si lo pierdes, revócalo y crea otro.
        </p>
        <div class="row nowrap">
          <input id="new-token-key" readOnly value={token.key} aria-label="Token" class="mono" />
          <button type="button" class="secondary small" data-copy="#new-token-key">
            Copiar
          </button>
        </div>

        <h4>Conéctalo</h4>
        <Snippet id="snip-claude-code" title="Claude Code (terminal)" code={claudeCode} open />
        <Snippet
          id="snip-desktop"
          title="Claude Desktop (claude_desktop_config.json)"
          hint="Ajustes → Desarrollador → Editar configuración. Requiere Node.js; reinicia Claude Desktop después."
          code={desktop}
        />
        {pathTokensAllowed ? (
          <Snippet
            id="snip-url"
            title="Claude.ai / ChatGPT (conector personalizado)"
            hint="Estos clientes no permiten headers: el token va en la URL, así que trátala como contraseña."
            code={`${baseUrl}/mcp/t/${token.key}`}
          />
        ) : null}
        <Snippet id="snip-generic" title="Cursor, VS Code y otros (URL + header)" code={generic} />
      </section>
    )
  }
}

export function AccountPage(handle: Handle<AccountPageProps>) {
  return () => {
    let { user, tokens, baseUrl, pathTokensAllowed, newToken, ok, error, errors = {} } = handle.props
    let r = routes.account

    return (
      <Layout title="Mi cuenta" user={user} section="cuenta">
        <h1>Mi cuenta</h1>
        <Flash ok={ok} error={error} />

        <div class="card stack">
          <div>
            <strong>{user.name}</strong>{' '}
            <span class={user.role === 'admin' ? 'badge admin' : 'badge'}>{user.role === 'admin' ? 'Admin' : 'Miembro'}</span>
          </div>
          <div class="muted">{user.email}</div>
        </div>

        <h2 id="tokens">Tokens para Claude / ChatGPT (MCP)</h2>
        <p class="muted">
          Con un token, un asistente puede consultar y editar recetas, menús y listas en tu nombre (no puede administrar
          miembros). Crea uno por app o dispositivo para poder revocarlos por separado.
        </p>

        <McpConnect baseUrl={baseUrl} pathTokensAllowed={pathTokensAllowed} />

        {newToken ? <NewTokenPanel token={newToken} baseUrl={baseUrl} pathTokensAllowed={pathTokensAllowed} /> : null}

        {tokens.length ? (
          <div class="card table-wrap">
            <table class="stack-mobile">
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Creado</th>
                  <th>Último uso</th>
                  <th>Vence</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {tokens.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <strong>{t.name}</strong>
                      {t.start ? <div class="muted small mono">{t.start}…</div> : null}
                    </td>
                    <td data-label="Creado" class="small">
                      {dateFmt.format(t.createdAt)}
                    </td>
                    <td data-label="Último uso" class="small">
                      {t.lastUsedAt ? dateTimeFmt.format(t.lastUsedAt) : <span class="muted">Nunca</span>}
                    </td>
                    <td data-label="Vence" class="small">
                      {t.expiresAt ? dateFmt.format(t.expiresAt) : <span class="muted">Nunca</span>}
                    </td>
                    <td>
                      <details>
                        <summary>Revocar…</summary>
                        <form method="post" action={r.tokenRevoke.href({ id: t.id })} class="inline">
                          <button type="submit" class="danger small">
                            Sí, revocar “{t.name}”
                          </button>
                        </form>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p class="muted small">Aún no tienes tokens.</p>
        )}

        <form method="post" action={r.tokenCreate.href()} class="card row add-form">
          <div class="grow">
            <label htmlFor="token-name">Nombre del token</label>
            <input id="token-name" name="name" required maxLength={60} placeholder="Claude Code en mi laptop" />
            {errors.name ? <p class="field-error">{errors.name}</p> : null}
          </div>
          <div>
            <label htmlFor="token-expiry">Vence en</label>
            <select id="token-expiry" name="expiresInDays">
              {TOKEN_EXPIRY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <button type="submit">Crear token</button>
        </form>

        <h2>Cambiar contraseña</h2>
        <form method="post" action={r.password.href()} class="card stack narrow">
          <PasswordInput name="currentPassword" label="Contraseña actual" autoComplete="current-password" error={errors.currentPassword} />
          <PasswordInput name="newPassword" label="Nueva contraseña" autoComplete="new-password" error={errors.newPassword} />
          <PasswordInput name="confirmPassword" label="Confirmar nueva contraseña" autoComplete="new-password" error={errors.confirmPassword} />
          <button type="submit">Guardar contraseña</button>
        </form>
      </Layout>
    )
  }
}
