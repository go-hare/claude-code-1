/**
 * Official CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS portable resolver.
 *
 * When set to a positive integer, long-running MCP tool calls may be
 * auto-backgrounded after this many ms. 0 / unset / invalid → disabled.
 */

export function resolveMcpAutoBackgroundMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env.CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS
  if (raw === undefined || raw === '') return 0
  const n = parseInt(raw, 10)
  if (Number.isNaN(n) || n <= 0) return 0
  return n
}

export function isMcpAutoBackgroundEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return resolveMcpAutoBackgroundMs(env) > 0
}
