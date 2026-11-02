import { apiKey } from '@better-auth/api-key'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { admin } from 'better-auth/plugins'
import { createAccessControl } from 'better-auth/plugins/access'
import { adminAc, defaultStatements, userAc } from 'better-auth/plugins/admin/access'

import { db } from '../db/client.ts'
import * as schema from '../db/schema/index.ts'

export const MCP_KEY_PREFIX = 'fm_'

// Roles de la familia: admin (todo) y member (sin gestión de usuarios).
const ac = createAccessControl(defaultStatements)
const roles = {
  admin: ac.newRole({ ...adminAc.statements }),
  member: ac.newRole({ ...userAc.statements }),
}

export const auth = betterAuth({
  appName: 'Family Menu',
  baseURL: process.env.BETTER_AUTH_URL ?? 'http://localhost:3010',
  secret: process.env.BETTER_AUTH_SECRET,
  basePath: '/api/auth',
  database: drizzleAdapter(db, { provider: 'pg', schema }),
  emailAndPassword: {
    enabled: true,
    // Solo el admin da de alta miembros (plugin admin → createUser).
    disableSignUp: true,
    minPasswordLength: 8,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 días
    updateAge: 60 * 60 * 24,
  },
  advanced: {
    cookiePrefix: 'family-menu',
  },
  plugins: [
    admin({
      ac,
      roles,
      defaultRole: 'member',
      adminRoles: ['admin'],
    }),
    apiKey({
      defaultPrefix: MCP_KEY_PREFIX,
      // Los tokens MCP se usan en ráfagas (un LLM puede hacer varias llamadas seguidas).
      rateLimit: { enabled: true, timeWindow: 60_000, maxRequests: 120 },
      enableMetadata: true,
    }),
  ],
})

export type Auth = typeof auth
export type AuthSession = typeof auth.$Infer.Session
export type AuthUser = AuthSession['user']
export type Role = 'admin' | 'member'
