import { db } from '../db/client.ts'
import { auditLog } from '../db/schema/index.ts'

export type AuditVia = 'web' | 'mcp' | 'system'

/** Quién hace un cambio en los servicios de dominio (dashboard o MCP). */
export interface ServiceActor {
  userId: string | null
  via: AuditVia
}

export interface AuditEntry {
  userId: string | null
  via: AuditVia
  action: string
  entity: string
  entityId?: string | null
  details?: Record<string, unknown>
}

/** Registra una acción. Nunca debe tumbar la operación principal. */
export async function audit(entry: AuditEntry): Promise<void> {
  try {
    await db.insert(auditLog).values({
      userId: entry.userId,
      via: entry.via,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId ?? null,
      details: entry.details ?? null,
    })
  } catch (error) {
    console.error('audit log failed', error)
  }
}
