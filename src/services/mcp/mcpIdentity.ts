/**
 * densable MCP account-identity generation — official `Xn` / `r8r` / `WKs` /
 * `GKs` / `Ts` / `SGr` / `rN`.
 *
 * `ZA` aborts a headless reconnect when `getMcpIdentityEpoch()` moves and
 * `mcpConfigDependsOnAccountIdentity(config)` is true.
 */

import { getClaudeAIOAuthTokens } from '../../utils/auth.js'
import type { ScopedMcpServerConfig } from './types.js'

type McpIdentityState = {
  identityEpoch: number
  identityBaseline: string | undefined
  identitySeedAttempted: boolean
  lastResolvedAccountToken: string | undefined
}

const state: McpIdentityState = {
  identityEpoch: 0,
  identityBaseline: undefined,
  identitySeedAttempted: false,
  lastResolvedAccountToken: undefined,
}

/** Official `r8r` — current account token, or undefined if unresolved. */
export function currentMcpAccountToken(): string | undefined {
  applyResolvedAccountToken()
  const token = getClaudeAIOAuthTokens()?.accessToken
  return token === undefined || token === '' ? undefined : token
}

/**
 * Official `SGr` — bump `identityEpoch` when the resolved account token
 * changes after a previous token was recorded.
 */
function applyResolvedAccountToken(): void {
  const token = getClaudeAIOAuthTokens()?.accessToken
  if (token === undefined || token === '') return
  const previous = state.lastResolvedAccountToken
  state.lastResolvedAccountToken = token
  if (previous === undefined || previous === token) return
  state.identityEpoch += 1
}

/** Official `WKs` / `seedMcpIdentityCheck`. */
export function seedMcpIdentityCheck(): void {
  if (state.identitySeedAttempted) return
  state.identitySeedAttempted = true
  const token = currentMcpAccountToken()
  if (token !== undefined) state.identityBaseline = token
}

/** Official `GKs` / `mcpIdentityChangedSinceLastCheck`. */
export function mcpIdentityChangedSinceLastCheck(): boolean {
  const token = currentMcpAccountToken()
  if (token === undefined) {
    state.identityBaseline = undefined
    return true
  }
  if (state.identityBaseline === undefined) {
    state.identityBaseline = token
    return true
  }
  if (state.identityBaseline === token) return false
  state.identityBaseline = token
  return true
}

/** Official `Ts` / `getMcpIdentityEpoch`. */
export function getMcpIdentityEpoch(): number {
  applyResolvedAccountToken()
  return state.identityEpoch
}

/**
 * Official `rN` — remote transports depend on account identity; stdio / sdk /
 * IDE sockets do not.
 */
export function mcpConfigDependsOnAccountIdentity(
  config: Pick<ScopedMcpServerConfig, 'type'>,
): boolean {
  switch (config.type) {
    case 'stdio':
    case undefined:
    case 'sdk':
    case 'sse-ide':
    case 'ws-ide':
      return false
    default:
      return true
  }
}

export function resetMcpIdentityStateForTests(): void {
  state.identityEpoch = 0
  state.identityBaseline = undefined
  state.identitySeedAttempted = false
  state.lastResolvedAccountToken = undefined
}
