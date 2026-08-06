/**
 * densable 2.1.214 `u8n` / `aBi` / `W5t` — OTel `tool_source` attribute.
 *
 * Values:
 * - `builtin` — no mcpInfo
 * - `sdk_host_builtin_mcp` — MCP tool from SDK host entrypoint (desktop/local-agent)
 *   when not a child session
 * - `mcp` — other MCP tools
 */

/** densable Xbl — host entrypoints that treat SDK MCP as host-builtin. */
const SDK_HOST_ENTRYPOINTS = new Set([
  'claude-desktop',
  'claude-desktop-3p',
  'local-agent',
])

export type ToolSource = 'builtin' | 'mcp' | 'sdk_host_builtin_mcp'

/**
 * densable W5t / bGm — true when CLAUDE_CODE_ENTRYPOINT is a desktop/local-agent
 * host and this is not a child session (CLAUDE_CODE_CHILD_SESSION).
 */
export function isSdkHostEntrypoint(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const entry = env.CLAUDE_CODE_ENTRYPOINT
  if (entry === undefined || !SDK_HOST_ENTRYPOINTS.has(entry)) {
    return false
  }
  // densable Pgi = Boolean(CLAUDE_CODE_CHILD_SESSION)
  if (env.CLAUDE_CODE_CHILD_SESSION) {
    return false
  }
  return true
}

/**
 * densable aBi — MCP info is SDK transport and host entrypoint qualifies.
 */
export function isSdkHostBuiltinMcp(
  mcpInfo: { serverType?: string } | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return mcpInfo?.serverType === 'sdk' && isSdkHostEntrypoint(env)
}

/**
 * densable u8n(e) — returns `{ tool_source }` for OTel events.
 * `e` is tool.mcpInfo (undefined for builtins).
 */
export function toolSourceAttributes(
  mcpInfo?: { serverType?: string } | null,
  env: NodeJS.ProcessEnv = process.env,
): { tool_source: ToolSource } {
  if (!mcpInfo) {
    return { tool_source: 'builtin' }
  }
  if (isSdkHostBuiltinMcp(mcpInfo, env)) {
    return { tool_source: 'sdk_host_builtin_mcp' }
  }
  return { tool_source: 'mcp' }
}
