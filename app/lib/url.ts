/** URL pública de la app (para links y snippets de configuración MCP). */
export function publicUrl(path = '/'): string {
  let base = (process.env.PUBLIC_URL || process.env.BETTER_AUTH_URL || 'http://localhost:3010').replace(/\/$/, '')
  return `${base}${path}`
}
