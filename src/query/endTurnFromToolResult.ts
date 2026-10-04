/**
 * densable 2.1.283 `smo` @ 184413938 / `GSt` `claude/endTurn`.
 *
 * A successful tool_result that asked to end the turn (`toolEndsTurn` or MCP
 * `_meta["claude/endTurn"]`) must not recurse into the next query iteration —
 * StructuredOutput + max_turns=1 otherwise hits error_max_turns.
 */

export const MCP_END_TURN_META_KEY = 'claude/endTurn'

export type ToolEndTurnSource = 'tool' | 'mcp_meta'

type ToolResultBlockLike = {
  type?: string
  is_error?: boolean
}

type UserLike = {
  type?: string
  toolEndsTurn?: boolean
  mcpMeta?: { _meta?: Record<string, unknown> }
  message?: { content?: unknown }
}

/** densable GSt — MCP _meta.claude/endTurn === true. */
export function mcpMetaRequestsEndTurn(
  mcpMeta: { _meta?: Record<string, unknown> } | undefined,
): boolean {
  return mcpMeta?._meta?.[MCP_END_TURN_META_KEY] === true
}

/**
 * densable smo. Returns `'tool' | 'mcp_meta'` or false.
 * Error tool_results never end the turn.
 */
export function endTurnSourceFromToolResult(
  message: UserLike,
): ToolEndTurnSource | false {
  if (message.type !== 'user') return false
  const source: ToolEndTurnSource | false = message.toolEndsTurn
    ? 'tool'
    : mcpMetaRequestsEndTurn(message.mcpMeta)
      ? 'mcp_meta'
      : false
  if (!source) return false
  const content = message.message?.content
  if (
    Array.isArray(content) &&
    content.some(
      (block: ToolResultBlockLike) =>
        block.type === 'tool_result' && block.is_error === true,
    )
  ) {
    return false
  }
  return source
}
