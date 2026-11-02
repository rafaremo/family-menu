import type { Handle } from 'remix/component'

import { routes } from '../routes.ts'

export interface McpConnectProps {
  /** URL base pública, sin "/" final. */
  baseUrl: string
  pathTokensAllowed: boolean
  /** Muestra el enlace para crear un token (no hace falta dentro de Mi cuenta). */
  showTokenLink?: boolean
}

/**
 * URLs del servidor MCP para copiar y pegar. El token no se puede volver a mostrar (se guarda
 * cifrado), así que aquí van las URLs base y se explica dónde va el token.
 */
export function McpConnect(handle: Handle<McpConnectProps>) {
  return () => {
    let { baseUrl, pathTokensAllowed, showTokenLink } = handle.props
    let endpoint = `${baseUrl}/mcp`
    let pathPrefix = `${baseUrl}/mcp/t/`
    return (
      <section class="card stack mcp-connect">
        <h3 class="card-title">🤖 Conecta Claude o ChatGPT (MCP)</h3>
        <div>
          <label htmlFor="mcp-url">URL del servidor MCP</label>
          <div class="row nowrap">
            <input id="mcp-url" readOnly value={endpoint} class="mono" />
            <button type="button" class="secondary small" data-copy="#mcp-url">
              Copiar
            </button>
          </div>
          <p class="field-hint">
            Claude Code, Claude Desktop, Cursor, VS Code: usa esta URL con el header{' '}
            <code>Authorization: Bearer &lt;tu token&gt;</code>.
          </p>
        </div>
        {pathTokensAllowed ? (
          <div>
            <label htmlFor="mcp-url-path">Claude.ai / ChatGPT (conector personalizado)</label>
            <div class="row nowrap">
              <input id="mcp-url-path" readOnly value={pathPrefix} class="mono" />
              <button type="button" class="secondary small" data-copy="#mcp-url-path">
                Copiar
              </button>
            </div>
            <p class="field-hint">
              Pega tu token al final (<code>…/mcp/t/fm_…</code>). Esa URL completa da acceso a tu cuenta: trátala como
              contraseña.
            </p>
          </div>
        ) : null}
        {showTokenLink ? (
          <p class="small">
            ¿No tienes token? <a href={`${routes.account.index.href()}#tokens`}>Créalo en Mi cuenta</a> (solo se muestra
            una vez; ahí mismo verás los comandos listos para pegar).
          </p>
        ) : null}
      </section>
    )
  }
}
