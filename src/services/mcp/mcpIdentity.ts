import {
  getAnthropicApiKeyWithSource,
  getClaudeAIOAuthTokens,
} from '../../utils/auth.js'
import { getGlobalConfig } from '../../utils/config.js'
import { logForDebugging } from '../../utils/debug.js'
import {
  getActiveSessionFromAls,
  getBootstrapSessionHost,
  HostSlot,
  isDisklessLaunch,
  runWithSession,
} from '../../utils/sessionHost.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../analytics/growthbook.js'
import { logEvent } from '../analytics/index.js'
import type { ScopedMcpServerConfig } from './types.js'

export type McpAccountIdentity = {
  accountUuid?: string
  organizationUuid?: string
  credentialInstalled: boolean
}
export type McpResolvedAccount =
  | { kind: 'unwired' | 'logged-out' | 'incomplete'; token: string }
  | { kind: 'resolved'; token: string; accountUuid: string; orgUuid: string }

type McpIdentityState = {
  identityEpoch: number
  identityBaseline: string | undefined
  identitySeedAttempted: boolean
  lastResolvedAccountToken: string | undefined
  accountResolver?: () => McpAccountIdentity | undefined
  handler?: () => void
  tripUnowned: boolean
  identityChanged: boolean
  offLatched?: string
}

function createMcpIdentityState(): McpIdentityState {
  return {
    identityEpoch: 0,
    identityBaseline: undefined,
    identitySeedAttempted: false,
    lastResolvedAccountToken: undefined,
    tripUnowned: false,
    identityChanged: false,
  }
}

const mcpIdentityHostSlot = new HostSlot<McpIdentityState>(
  createMcpIdentityState,
)

function getMcpIdentityState(): McpIdentityState {
  return mcpIdentityHostSlot.of(getBootstrapSessionHost())
}

/** Gold Ha/Pdt: disabled and diskless states latch per SessionHost. */
export function isMcpIdentityBoundaryEnabled(): boolean {
  const state = getMcpIdentityState()
  if (isDisklessLaunch()) state.offLatched = 'diskless'
  if (state.offLatched !== undefined) return false
  const raw = process.env.MCP_DISCOVERY_CACHE
  if (raw === '0' || raw === 'false') {
    state.offLatched = 'env-disabled'
    return false
  }
  const gate = getFeatureValue_CACHED_MAY_BE_STALE<boolean | null>(
    'tengu_mcp_discovery_cache_enable',
    null,
  )
  if (gate === false) {
    state.offLatched = 'kill-switch'
    return false
  }
  if (raw === '1' || raw === 'true' || gate === true) return true
  state.offLatched = 'not-enabled'
  return false
}

export function setMcpAccountIdentityResolver(
  resolver: () => McpAccountIdentity | undefined,
): void {
  const state = getMcpIdentityState()
  state.accountResolver = resolver
  state.lastResolvedAccountToken = undefined
}

function hasManagedAccountKey(): boolean {
  try {
    return (
      getAnthropicApiKeyWithSource({ skipRetrievingKeyFromApiKeyHelper: true })
        .source === '/login managed key'
    )
  } catch {
    return false
  }
}

export function ensureMcpAccountIdentityResolver(): void {
  const state = getMcpIdentityState()
  if (state.accountResolver) return
  setMcpAccountIdentityResolver(() => {
    const account = getGlobalConfig().oauthAccount
    if (!account) return undefined
    return {
      accountUuid: account.accountUuid,
      organizationUuid: account.organizationUuid,
      credentialInstalled:
        getClaudeAIOAuthTokens()?.accessToken != null || hasManagedAccountKey(),
    }
  })
}

export function resolveMcpAccountIdentity(): McpResolvedAccount {
  const state = getMcpIdentityState()
  if (!state.accountResolver) return { kind: 'unwired', token: 'acct:unwired' }
  const account = state.accountResolver()
  if (!account) return { kind: 'logged-out', token: 'acct:logged-out' }
  const accountUuid = account.accountUuid ?? ''
  const orgUuid = account.organizationUuid ?? ''
  if (!accountUuid || !account.credentialInstalled) {
    return { kind: 'incomplete', token: 'acct:incomplete' }
  }
  return {
    kind: 'resolved',
    token: `acct:${accountUuid}|org:${orgUuid}`,
    accountUuid,
    orgUuid,
  }
}

export function markMcpIdentityChanged(): void {
  const state = getMcpIdentityState()
  if (state.identityChanged) return
  state.identityChanged = true
  logEvent('tengu_feature_sad', {
    feature_name: 'mcp_discovery_cache',
    error_code: 'identity_changed',
  })
}

function notifyIdentityChange(state: McpIdentityState): void {
  if (!state.handler) {
    state.tripUnowned = true
    return
  }
  const capturedSession = getActiveSessionFromAls()
  queueMicrotask(() => {
    const handler = state.handler
    if (!handler) {
      state.tripUnowned = true
      return
    }
    try {
      if (
        capturedSession !== undefined &&
        getActiveSessionFromAls() !== capturedSession
      ) {
        runWithSession(capturedSession, handler)
      } else {
        handler()
      }
    } catch (error) {
      logForDebugging(`MCP identity-change handler failed: ${String(error)}`, {
        level: 'warn',
      })
    }
  })
}

export function registerMcpIdentityChangeHandler(
  handler: () => void,
): () => void {
  const state = getMcpIdentityState()
  state.handler = handler
  return () => {
    if (state.handler === handler) state.handler = undefined
  }
}

export function takeUnownedMcpIdentityChange(): boolean {
  const state = getMcpIdentityState()
  const pending = state.tripUnowned
  state.tripUnowned = false
  return pending
}

function applyResolvedAccountIdentity(): McpResolvedAccount {
  const account = resolveMcpAccountIdentity()
  if (account.kind !== 'resolved' || !isMcpIdentityBoundaryEnabled()) {
    return account
  }
  const state = getMcpIdentityState()
  const previous = state.lastResolvedAccountToken
  state.lastResolvedAccountToken = account.token
  if (previous !== undefined && previous !== account.token) {
    state.identityEpoch += 1
    markMcpIdentityChanged()
    notifyIdentityChange(state)
  }
  return account
}

export function currentMcpAccountToken(): string | undefined {
  const account = applyResolvedAccountIdentity()
  return account.kind === 'unwired' || account.kind === 'incomplete'
    ? undefined
    : account.token
}

export function seedMcpIdentityCheck(): void {
  ensureMcpAccountIdentityResolver()
  const state = getMcpIdentityState()
  if (state.identitySeedAttempted) return
  state.identitySeedAttempted = true
  const token = currentMcpAccountToken()
  if (token !== undefined) state.identityBaseline = token
}

export function mcpIdentityChangedSinceLastCheck(): boolean {
  const state = getMcpIdentityState()
  const token = currentMcpAccountToken()
  if (token === undefined) {
    state.identityBaseline = undefined
    return true
  }
  if (state.identityBaseline === token) return false
  state.identityBaseline = token
  return true
}

export function getMcpIdentityEpoch(): number {
  if (isMcpIdentityBoundaryEnabled()) applyResolvedAccountIdentity()
  return getMcpIdentityState().identityEpoch
}

export function advanceMcpIdentityEpoch(): number {
  const state = getMcpIdentityState()
  if (isMcpIdentityBoundaryEnabled()) state.identityEpoch += 1
  return state.identityEpoch
}

export function rearmMcpIdentityBaseline(): void {
  if (!isMcpIdentityBoundaryEnabled()) return
  advanceMcpIdentityEpoch()
  getMcpIdentityState().lastResolvedAccountToken = 'baseline:rearmed'
}

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
  const state = getMcpIdentityState()
  state.identityEpoch = 0
  state.identityBaseline = undefined
  state.identitySeedAttempted = false
  state.lastResolvedAccountToken = undefined
  state.accountResolver = undefined
  state.handler = undefined
  state.tripUnowned = false
  state.identityChanged = false
  state.offLatched = undefined
}
