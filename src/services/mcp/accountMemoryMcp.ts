/**
 * densable 2.1.289 `X2e` / `$zt` / `bE` — account-memory MCP predicate.
 * Gold SEA stamps `mcpInfo.accountMemory:!0` via Dn when X2e(server, toolName).
 * Do **not** export minify `X2e` / `$zt` / `bE` / `di` / `nf` / `qS`.
 */

import { isCliOwnedConfig } from './cliOwnedConfigs.js'
import { isMcpCcrProxyUrl } from './mcpConnectTimeout.js'

/** densable `di` / `bme`. */
export const ACCOUNT_MEMORY_SERVER_NAME = 'memory'

/** densable `l0` — dedicated CCR memory MCP path. */
const ACCOUNT_MEMORY_PATH_RE =
  /^\/v2\/ccr-sessions\/[A-Za-z0-9_-]+\/memory\/mcp$/

/** densable `FWe` — session MCP path that may carry toolbox id. */
const CCR_SESSION_MCP_PATH_RE = /^\/v2\/ccr-sessions\/([A-Za-z0-9_-]+)\/mcp$/

/** densable `eYr` — toolbox_mcp_server_id for account memory. */
export const ACCOUNT_MEMORY_TOOLBOX_ID = 'a471caf9-e559-5ad8-836c-4e5972877185'

/** densable `u0` — sdk tool names on the memory server. */
const ACCOUNT_MEMORY_SDK_TOOL_RE = /^memory_[a-z_]+$/

type AccountMemoryServer = {
  name: string
  config: {
    scope?: string
    type?: string
    url?: unknown
    [key: string]: unknown
  }
}

/**
 * densable `$zt` — dynamic HTTP CCR memory server (not cli-owned).
 */
export function isCcrAccountMemoryHttpServer(
  server: AccountMemoryServer,
): boolean {
  const url = server.config.url
  if (
    server.name !== ACCOUNT_MEMORY_SERVER_NAME ||
    server.config.scope !== 'dynamic' ||
    isCliOwnedConfig(server.config) ||
    typeof url !== 'string' ||
    !isMcpCcrProxyUrl(url)
  ) {
    return false
  }
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.username !== '' || parsed.password !== '' || parsed.hash !== '') {
    return false
  }
  if (ACCOUNT_MEMORY_PATH_RE.test(parsed.pathname)) {
    return parsed.search === ''
  }
  const ids = parsed.searchParams.getAll('toolbox_mcp_server_id')
  return (
    CCR_SESSION_MCP_PATH_RE.test(parsed.pathname) &&
    ids.length === 1 &&
    ids[0] === ACCOUNT_MEMORY_TOOLBOX_ID
  )
}

/**
 * densable `bE` — dynamic sdk memory server + `memory_*` tool (not cli-owned).
 */
export function isSdkAccountMemoryTool(
  server: AccountMemoryServer,
  toolName: string,
): boolean {
  return (
    server.name === ACCOUNT_MEMORY_SERVER_NAME &&
    server.config.scope === 'dynamic' &&
    server.config.type === 'sdk' &&
    !isCliOwnedConfig(server.config) &&
    ACCOUNT_MEMORY_SDK_TOOL_RE.test(toolName)
  )
}

/**
 * densable `wno` @179527629 — `(entrypoint === 'local-agent' || 'local_agent') && !childSession`.
 */
export function isLocalAgentAccountMemoryEntrypoint(): boolean {
  const entrypoint = process.env.CLAUDE_CODE_ENTRYPOINT
  return (
    (entrypoint === 'local-agent' || entrypoint === 'local_agent') &&
    !process.env.CLAUDE_CODE_CHILD_SESSION
  )
}

/**
 * densable `X2e(e,n)` — stamp `mcpInfo.accountMemory`.
 * `$zt(e) || bE(e,n) || (e?.name===di && nf(e.config))`
 */
export function isAccountMemoryTool(
  server: AccountMemoryServer,
  toolName: string,
): boolean {
  return (
    isCcrAccountMemoryHttpServer(server) ||
    isSdkAccountMemoryTool(server, toolName) ||
    (server.name === ACCOUNT_MEMORY_SERVER_NAME &&
      isCliOwnedConfig(server.config))
  )
}

/**
 * densable `SZe(e,n)` @182203335 — `$zt(e) || _E(e,n) || (e?.name===di && nf(e.config))`
 * where `_E(e,n) = bE(e,n) && wno()`. Used to stamp `mcpInfo.accountMemoryServer`
 * (`oe`) across all tools of the account memory server (`@214518400`).
 */
export function isAccountMemoryServerTool(
  server: AccountMemoryServer,
  toolName: string,
): boolean {
  return (
    isCcrAccountMemoryHttpServer(server) ||
    (isSdkAccountMemoryTool(server, toolName) &&
      isLocalAgentAccountMemoryEntrypoint()) ||
    (server.name === ACCOUNT_MEMORY_SERVER_NAME &&
      isCliOwnedConfig(server.config))
  )
}
