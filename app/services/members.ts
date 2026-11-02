import { asc, count, eq } from 'drizzle-orm'

import { auth, type Role } from '../auth/auth.ts'
import { toRole, type Identity } from '../auth/middleware.ts'
import { db } from '../db/client.ts'
import { user } from '../db/schema/index.ts'
import { UserFacingError } from '../lib/errors.ts'
import { audit, type AuditVia } from './audit.ts'

/**
 * Gestión de miembros de la familia.
 *
 * Las mutaciones pasan por la API del plugin `admin` de Better Auth con los headers
 * del admin que actúa, así Better Auth vuelve a validar permisos además de nuestras reglas.
 */

export interface Member {
  id: string
  name: string
  email: string
  role: Role
  banned: boolean
  createdAt: Date
}

export interface Actor {
  identity: Identity
  headers: Headers
  via: AuditVia
}

export async function listMembers(): Promise<Member[]> {
  let rows = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      banned: user.banned,
      createdAt: user.createdAt,
    })
    .from(user)
    .orderBy(asc(user.createdAt))

  return rows.map((row) => ({ ...row, role: toRole(row.role), banned: Boolean(row.banned) }))
}

async function getMember(id: string): Promise<Member> {
  let [row] = await db.select().from(user).where(eq(user.id, id)).limit(1)
  if (!row) throw new UserFacingError('Ese miembro no existe.', 404)
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: toRole(row.role),
    banned: Boolean(row.banned),
    createdAt: row.createdAt,
  }
}

async function countActiveAdmins(): Promise<number> {
  let rows = await db.select({ role: user.role, banned: user.banned, n: count() }).from(user).groupBy(user.role, user.banned)
  return rows.filter((r) => r.role === 'admin' && !r.banned).reduce((sum, r) => sum + Number(r.n), 0)
}

function assertNotSelf(actor: Actor, targetId: string, message: string) {
  if (actor.identity.id === targetId) throw new UserFacingError(message)
}

export async function createMember(
  actor: Actor,
  input: { name: string; email: string; password: string; role: Role },
): Promise<Member> {
  let result = await auth.api.createUser({
    body: { name: input.name, email: input.email, password: input.password, role: input.role },
    headers: actor.headers,
  })
  await audit({
    userId: actor.identity.id,
    via: actor.via,
    action: 'create',
    entity: 'member',
    entityId: result.user.id,
    details: { email: input.email, role: input.role },
  })
  return getMember(result.user.id)
}

export async function setMemberRole(actor: Actor, userId: string, role: Role): Promise<void> {
  assertNotSelf(actor, userId, 'No puedes cambiar tu propio rol.')
  let target = await getMember(userId)
  if (target.role === 'admin' && role !== 'admin' && (await countActiveAdmins()) <= 1) {
    throw new UserFacingError('Debe quedar al menos un administrador.')
  }
  await auth.api.setRole({ body: { userId, role }, headers: actor.headers })
  await audit({ userId: actor.identity.id, via: actor.via, action: 'set_role', entity: 'member', entityId: userId, details: { role } })
}

export async function setMemberPassword(actor: Actor, userId: string, newPassword: string): Promise<void> {
  await getMember(userId)
  await auth.api.setUserPassword({ body: { userId, newPassword }, headers: actor.headers })
  // Cierra las sesiones abiertas del miembro para que use la nueva contraseña.
  if (actor.identity.id !== userId) {
    await auth.api.revokeUserSessions({ body: { userId }, headers: actor.headers })
  }
  await audit({ userId: actor.identity.id, via: actor.via, action: 'set_password', entity: 'member', entityId: userId })
}

export async function banMember(actor: Actor, userId: string): Promise<void> {
  assertNotSelf(actor, userId, 'No puedes desactivarte a ti mismo.')
  await getMember(userId)
  await auth.api.banUser({ body: { userId, banReason: 'Desactivado por el administrador' }, headers: actor.headers })
  await audit({ userId: actor.identity.id, via: actor.via, action: 'ban', entity: 'member', entityId: userId })
}

export async function unbanMember(actor: Actor, userId: string): Promise<void> {
  await getMember(userId)
  await auth.api.unbanUser({ body: { userId }, headers: actor.headers })
  await audit({ userId: actor.identity.id, via: actor.via, action: 'unban', entity: 'member', entityId: userId })
}

export async function removeMember(actor: Actor, userId: string): Promise<void> {
  assertNotSelf(actor, userId, 'No puedes eliminarte a ti mismo.')
  let target = await getMember(userId)
  await auth.api.removeUser({ body: { userId }, headers: actor.headers })
  await audit({
    userId: actor.identity.id,
    via: actor.via,
    action: 'delete',
    entity: 'member',
    entityId: userId,
    details: { email: target.email },
  })
}
