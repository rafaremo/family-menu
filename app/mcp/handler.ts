import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'

import { verifyToken } from '../services/tokens.ts'
import { createContext } from './context.ts'
import { createMcpServer } from './server.ts'

/**
 * Endpoint MCP (Streamable HTTP, sin estado): un servidor + transporte por petición.
 * Auth: `Authorization: Bearer <token>` o el token en la ruta (`/mcp/t/<token>`, para clientes
 * como Claude.ai o ChatGPT que no dejan poner headers).
 */

export function pathTokensAllowed(): boolean {
  return process.env.MCP_ALLOW_PATH_TOKEN !== 'false'
}

function bearer(request: Request): string | null {
  let header = request.headers.get('Authorization') ?? ''
  let match = /^Bearer\s+(\S+)$/i.exec(header)
  return match ? match[1]! : null
}

function jsonRpcError(status: number, message: string, headers: Record<string, string> = {}): Response {
  return Response.json({ jsonrpc: '2.0', error: { code: -32001, message }, id: null }, { status, headers })
}

const UNAUTHORIZED: Record<string, string> = {
  missing: 'Falta el token. Usa "Authorization: Bearer <token>" (créalo en Mi cuenta → Tokens).',
  invalid: 'Token inválido, vencido o revocado.',
  banned: 'La cuenta dueña del token está desactivada.',
}

export async function handleMcpRequest(request: Request, pathToken?: string): Promise<Response> {
  let key = pathToken ?? bearer(request)
  if (pathToken && !pathTokensAllowed()) return jsonRpcError(404, 'Token en la ruta deshabilitado en este servidor.')

  let check = await verifyToken(key)
  if (!check.ok) {
    if (check.reason === 'rate_limited') return jsonRpcError(429, 'Demasiadas peticiones con este token; espera un minuto.', { 'Retry-After': '60' })
    return jsonRpcError(401, UNAUTHORIZED[check.reason]!, { 'WWW-Authenticate': 'Bearer realm="family-menu"' })
  }

  // Sin estado: GET (stream SSE independiente) y DELETE (cerrar sesión) no aplican.
  if (request.method !== 'POST') {
    return jsonRpcError(405, 'Usa POST (servidor MCP sin estado).', { Allow: 'POST' })
  }

  let server = createMcpServer(createContext(check.identity, check.tokenId))
  let transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
  try {
    await server.connect(transport)
    return await transport.handleRequest(request)
  } finally {
    // JSON response: ya se resolvió todo; liberamos el servidor de esta petición.
    void transport.close().catch(() => {})
    void server.close().catch(() => {})
  }
}
