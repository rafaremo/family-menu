import { index, jsonb, pgEnum, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core'

import { user } from './auth.ts'

export const auditVia = pgEnum('audit_via', ['web', 'mcp', 'system'])

/** Bitácora de cambios hechos desde el dashboard o el MCP. */
export const auditLog = pgTable(
  'audit_log',
  {
    id: serial('id').primaryKey(),
    userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
    via: auditVia('via').notNull(),
    action: text('action').notNull(),
    entity: text('entity').notNull(),
    entityId: text('entity_id'),
    details: jsonb('details'),
    at: timestamp('at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('audit_log_at_idx').on(table.at), index('audit_log_entity_idx').on(table.entity, table.entityId)],
)
