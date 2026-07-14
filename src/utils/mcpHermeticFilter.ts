/**
 * Official rhf/tmn — safe-mode / remote-hermetic MCP server filter.
 *
 * When safe mode or (CLAUDE_CODE_REMOTE && REMOTE_HERMETIC_MODE):
 * keep only type==="sdk" servers; drop the rest with a reason string.
 */

import { isSafeModeEnabled } from './safeMode.js'
import { isRemoteHermeticModeEnabled } from './residualFinalEnvGates.js'

export type McpHermeticFilterResult<T> = {
  servers: Record<string, T>
  dropped: string[]
  reason: 'safe mode' | 'hermetic mode' | undefined
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
 * Official rhf — filter MCP configs for safe/hermetic sessions.
 */
export function filterMcpServersForHermeticMode<T extends { type?: string }>(
  servers: Record<string, T>,
  input?: {
    env?: NodeJS.ProcessEnv
    argv?: readonly string[]
    safeMode?: boolean
    hermetic?: boolean
  },
): McpHermeticFilterResult<T> {
  const env = input?.env ?? process.env
  const safe =
    input?.safeMode ?? isSafeModeEnabled(env, input?.argv ?? process.argv)
  const hermetic = input?.hermetic ?? isRemoteHermeticSession(env)
  const reason: McpHermeticFilterResult<T>['reason'] = safe
    ? 'safe mode'
    : hermetic
      ? 'hermetic mode'
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
  reason: 'safe mode' | 'hermetic mode',
): string {
  const n = dropped.length
  const unit = n === 1 ? 'server' : 'servers'
  return `--mcp-config: ${n} ${unit} ignored in ${reason}: ${dropped.join(', ')}`
}
