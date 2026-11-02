import { and, desc, eq } from 'drizzle-orm'

import { auth, MCP_KEY_PREFIX } from '../auth/auth.ts'
import { toRole, type Identity } from '../auth/middleware.ts'
import { db } from '../db/client.ts'
import { apikey, user } from '../db/schema/index.ts'
import { UserFacingError } from '../lib/errors.ts'
import { cleanText } from '../lib/slug.ts'
import { audit, type ServiceActor } from './audit.ts'

/**
 * Tokens MCP por usuario (plugin `apiKey` de Better Auth). El token completo solo se muestra
 * al crearlo; en la BD queda su hash. Revocar = borrar.
 */

export interface TokenSummary {
  id: string
  name: string
  /** Primeros caracteres, para reconocerlo ("fm_kEq…"). */
  start: string | null
  createdAt: Date
  lastUsedAt: Date | null
  expiresAt: Date | null
  enabled: boolean
}

export const TOKEN_EXPIRY_OPTIONS = [
  { value: '', label: 'Nunca' },
  { value: '30', label: '30 días' },
  { value: '90', label: '90 días' },
  { value: '365', label: '1 año' },
] as const

export async function listTokens(userId: string): Promise<TokenSummary[]> {
  let rows = await db
    .select({
      id: apikey.id,
      name: apikey.name,
      start: apikey.start,
      createdAt: apikey.createdAt,
      lastUsedAt: apikey.lastRequest,
      expiresAt: apikey.expiresAt,
      enabled: apikey.enabled,
    })
    .from(apikey)
    .where(eq(apikey.referenceId, userId))
    .orderBy(desc(apikey.createdAt))
  return rows.map((r) => ({ ...r, name: r.name ?? 'Sin nombre', enabled: r.enabled ?? true }))
}

export async function createToken(
  actor: ServiceActor & { userId: string },
  input: { name: string; expiresInDays?: number | null },
): Promise<{ id: string; key: string; name: string }> {
  let name = cleanText(input.name).slice(0, 60)
  if (!name) throw new UserFacingError('Ponle un nombre al token (p. ej. "Claude Code de Rafa").')
  let days = input.expiresInDays ?? null
  if (days !== null && (!Number.isInteger(days) || days < 1 || days > 3650)) throw new UserFacingError('Vigencia inválida.')

  let created = await auth.api.createApiKey({
    body: { userId: actor.userId, name, ...(days ? { expiresIn: days * 24 * 60 * 60 } : {}) },
  })
  await audit({ ...actor, action: 'create', entity: 'mcp_token', entityId: created.id, details: { name, days } })
  return { id: created.id, key: created.key, name }
}

export async function revokeToken(actor: ServiceActor & { userId: string }, tokenId: string): Promise<void> {
  let deleted = await db
    .delete(apikey)
    .where(and(eq(apikey.id, tokenId), eq(apikey.referenceId, actor.userId)))
    .returning({ id: apikey.id, name: apikey.name })
  if (!deleted.length) throw new UserFacingError('Ese token no existe.', 404)
  await audit({ ...actor, action: 'revoke', entity: 'mcp_token', entityId: tokenId, details: { name: deleted[0]!.name } })
}

export type TokenCheck =
  | { ok: true; identity: Identity; tokenId: string }
  | { ok: false; reason: 'missing' | 'invalid' | 'rate_limited' | 'banned' }

/** Verifica un token MCP y regresa la identidad de su dueño. */
export async function verifyToken(key: string | null | undefined): Promise<TokenCheck> {
  if (!key || key.length > 200) return { ok: false, reason: 'missing' }
  // Descarta basura sin consultar la BD (y sin llenar los logs de Better Auth).
  if (!key.startsWith(MCP_KEY_PREFIX) || !/^[\w-]+$/.test(key)) return { ok: false, reason: 'invalid' }
  let result = await auth.api.verifyApiKey({ body: { key } }).catch(() => null)
  if (!result?.valid || !result.key) {
    let code = (result?.error as { code?: string } | null | undefined)?.code
    return { ok: false, reason: code === 'RATE_LIMITED' ? 'rate_limited' : 'invalid' }
  }
  let [owner] = await db.select().from(user).where(eq(user.id, result.key.referenceId)).limit(1)
  if (!owner) return { ok: false, reason: 'invalid' }
  if (owner.banned) return { ok: false, reason: 'banned' }
  return {
    ok: true,
    tokenId: result.key.id,
    identity: { id: owner.id, name: owner.name, email: owner.email, role: toRole(owner.role) },
  }
}
