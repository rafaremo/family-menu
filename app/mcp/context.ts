import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js'
import * as z from 'zod'

import type { Identity } from '../auth/middleware.ts'
import { UserFacingError } from '../lib/errors.ts'
import { audit, type ServiceActor } from '../services/audit.ts'

/** Contexto de una petición MCP: quién llama (dueño del token). */
export interface McpContext {
  identity: Identity
  actor: ServiceActor & { userId: string }
  tokenId: string
}

export function createContext(identity: Identity, tokenId: string): McpContext {
  return { identity, tokenId, actor: { userId: identity.id, via: 'mcp' } }
}

/** Resultado exitoso: JSON legible para el LLM (o texto/markdown tal cual). */
export function ok(data: unknown): CallToolResult {
  let text = typeof data === 'string' ? data : JSON.stringify(data, null, 2)
  return { content: [{ type: 'text', text }] }
}

export function fail(message: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: message }] }
}

function errorMessage(error: unknown): string | null {
  if (error instanceof UserFacingError) return error.message
  if (error instanceof z.ZodError) {
    return error.issues.map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message)).join('\n')
  }
  return null
}

/**
 * Envuelve una herramienta: registra la llamada en la bitácora (via=mcp) y convierte errores
 * de negocio / validación en `isError` con mensaje en español para que el LLM pueda corregir.
 */
export function tool<A>(ctx: McpContext, name: string, handler: (args: A) => Promise<CallToolResult | unknown>) {
  return async (args: A): Promise<CallToolResult> => {
    try {
      let result = await handler(args)
      await audit({ ...ctx.actor, action: 'tool_call', entity: 'mcp', entityId: name, details: { ok: true, tokenId: ctx.tokenId } })
      return isToolResult(result) ? result : ok(result)
    } catch (error) {
      let message = errorMessage(error)
      await audit({
        ...ctx.actor,
        action: 'tool_call',
        entity: 'mcp',
        entityId: name,
        details: { ok: false, error: message ?? 'internal', tokenId: ctx.tokenId },
      })
      if (message) return fail(message)
      console.error(`MCP ${name} falló`, error)
      return fail('Error interno del servidor. Intenta de nuevo o revisa los datos.')
    }
  }
}

function isToolResult(value: unknown): value is CallToolResult {
  return typeof value === 'object' && value !== null && Array.isArray((value as { content?: unknown }).content)
}

// ─── Campos comunes para los esquemas de entrada ─────────────────────────────

export const recipeRef = z
  .union([z.number().int().positive(), z.string().min(1)])
  .describe('Receta: id numérico, slug (p. ej. "tinga-de-pollo") o título exacto.')

export const ingredientRef = z
  .union([z.number().int().positive(), z.string().min(1)])
  .describe('Ingrediente: id numérico o nombre/alias (p. ej. "jitomate" o "tomate").')

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Fecha AAAA-MM-DD')

export const MEAL_ENUM = z.enum(['desayuno', 'comida', 'cena', 'colacion'])

/** Registra una herramienta con argumentos tipados desde su esquema zod. */
export function defineTool<Shape extends z.ZodRawShape>(
  server: McpServer,
  ctx: McpContext,
  name: string,
  config: { title: string; description: string; inputSchema: Shape; annotations?: ToolAnnotations },
  handler: (args: z.infer<z.ZodObject<Shape>>) => Promise<CallToolResult | unknown>,
) {
  let wrapped = tool(ctx, name, handler)
  server.registerTool(name, config, wrapped as never)
}
