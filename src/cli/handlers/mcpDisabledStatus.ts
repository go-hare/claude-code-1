/**
 * densable 2.1.238 `wah` — mcp list/get disabled glyph; skip connect/health.
 */
export const MCP_DISABLED_STATUS =
  '⊘ Disabled for this project (re-enable via /mcp)'

export function mcpDisabledHealthResult(
  isDisabled: boolean,
): { status: string } | null {
  if (!isDisabled) return null
  return { status: MCP_DISABLED_STATUS }
}
