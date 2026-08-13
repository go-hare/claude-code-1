/**
 * Official AYh / rhf / tmn — safe-mode / remote-hermetic / enterprise MCP filter.
 *
 * densable 2.1.229 AYh(e, {dropForEnterpriseMcpConfig}):
 *   reason = safe mode | hermetic mode | enterprise MCP config
 *   keep only type==="sdk"; drop the rest.
 *
 * Enterprise soft-drop is for CLAUDE_CODE_REMOTE sessions with managed-mcp.json
 * (skip+warn instead of process.exit on --mcp-config non-sdk servers).
 */

import { isSafeModeEnabled } from './safeMode.js'
import { isRemoteHermeticModeEnabled } from './residualFinalEnvGates.js'

export type McpHermeticDropReason =
  | 'safe mode'
  | 'hermetic mode'
  | 'enterprise MCP config'

export type McpHermeticFilterResult<T> = {
  servers: Record<string, T>
  dropped: string[]
  reason: McpHermeticDropReason | undefined
}

/**
 * Official tmn densable: REMOTE && REMOTE_HERMETIC_MODE.
 */
export function isRemoteHermeticSession(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isRemoteHermeticModeEnabled(env)
}

/**
 * densable AYh — filter MCP configs for safe / hermetic / enterprise-remote.
 */
export function filterMcpServersForHermeticMode<T extends { type?: string }>(
  servers: Record<string, T>,
  input?: {
    env?: NodeJS.ProcessEnv
    argv?: readonly string[]
    safeMode?: boolean
    hermetic?: boolean
    /** densable dropForEnterpriseMcpConfig — remote + managed-mcp exclusive */
    dropForEnterpriseMcpConfig?: boolean
  },
): McpHermeticFilterResult<T> {
  const env = input?.env ?? process.env
  const safe =
    input?.safeMode ?? isSafeModeEnabled(env, input?.argv ?? process.argv)
  const hermetic = input?.hermetic ?? isRemoteHermeticSession(env)
  const enterprise = input?.dropForEnterpriseMcpConfig === true
  // densable AYh priority: safe > hermetic > enterprise
  const reason: McpHermeticDropReason | undefined = safe
    ? 'safe mode'
    : hermetic
      ? 'hermetic mode'
      : enterprise
        ? 'enterprise MCP config'
        : undefined
  if (!reason) {
    return { servers, dropped: [], reason: undefined }
  }
  const kept: Record<string, T> = {}
  const dropped: string[] = []
  for (const [name, cfg] of Object.entries(servers)) {
    if (cfg?.type === 'sdk') kept[name] = cfg
    else dropped.push(name)
  }
  return { servers: kept, dropped, reason }
}

/** Format official warn: `--mcp-config: N server(s) ignored in <reason>: a, b` */
export function formatMcpHermeticDropWarn(
  dropped: readonly string[],
  reason: McpHermeticDropReason,
): string {
  const n = dropped.length
  const unit = n === 1 ? 'server' : 'servers'
  // densable debug line uses "ignored (reason)"; local historical surface is
  // "ignored in <reason>" for safe/hermetic — keep that for non-enterprise.
  if (reason === 'enterprise MCP config') {
    return `--mcp-config: ${n} ${unit} ignored (${reason}): ${dropped.join(', ')}`
  }
  return `--mcp-config: ${n} ${unit} ignored in ${reason}: ${dropped.join(', ')}`
}

/**
 * densable user-facing enterprise soft-skip warn (main --mcp-config path):
 * "Warning: an enterprise MCP config (managed-mcp.json) is present and has
 * exclusive control over MCP servers; ignoring N MCP server(s) supplied via
 * --mcp-config: a, b"
 */
export function formatEnterpriseMcpConfigDropWarn(
  dropped: readonly string[],
): string {
  const n = dropped.length
  const unit = n === 1 ? 'server' : 'servers'
  return (
    `Warning: an enterprise MCP config (managed-mcp.json) is present and has ` +
    `exclusive control over MCP servers; ignoring ${n} MCP ${unit} supplied ` +
    `via --mcp-config: ${dropped.join(', ')}`
  )
}

/**
 * densable mcp_set_servers soft-ignore reason when remote + enterprise:
 * "Ignored: an enterprise MCP config (managed-mcp.json) is present and has
 * exclusive control over MCP servers"
 */
export const ENTERPRISE_MCP_SET_SERVERS_IGNORE_REASON =
  'Ignored: an enterprise MCP config (managed-mcp.json) is present and has exclusive control over MCP servers'

/** densable hermetic mcp_set_servers soft-ignore */
export const HERMETIC_MCP_SET_SERVERS_IGNORE_REASON =
  'Ignored in hermetic mode (not declared in user config)'
