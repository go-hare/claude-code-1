/**
 * densable 2.1.233 #6 — tools/list response boundary.
 *
 * Official densable SEA is untyped JS (`listTools`/`callTool` string protocol).
 * Our product path uses `@modelcontextprotocol/server@2`, whose `Tool.inputSchema`
 * is a strict JSON-Schema Infer (literal `type` discriminants). Hand-written
 * tool bags and `zodToJsonSchema` output are runtime-valid for the wire but
 * widen under TS (`type: string` vs `"object"`).
 *
 * densable does **not** invent a schema adapter package. Prefer:
 *   - `McpServer.registerTool` + Zod (createSdkMcpServer / agent-sdk `fVp`)
 *   - force root `inputSchema.type = 'object'` after zod convert
 *   - this single boundary when returning a static/list bag from `tools/list`
 *
 * Do not reintroduce `@modelcontextprotocol/sdk` 1.x. Do not invent apps gateway.
 */
import type { ListToolsResult } from '@modelcontextprotocol/server'

/** Structural list entry — wire shape without v2 literal nested schema. */
export type LooseListTool = {
  name: string
  description?: string
  inputSchema: {
    type: 'object' | string
    properties?: Record<string, unknown>
    required?: string[]
    [key: string]: unknown
  }
  [key: string]: unknown
}

/**
 * Wrap tools for `setRequestHandler('tools/list', …)`.
 * One intentional cast site instead of scattered `as never`.
 */
export function listToolsResult(
  tools: readonly LooseListTool[],
): ListToolsResult {
  return { tools: tools as ListToolsResult['tools'] }
}
