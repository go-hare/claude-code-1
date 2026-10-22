/**
 * densable 2.1.289 `_r` / pr / Qs / fr — MCP step-up re-auth dialog.
 *
 * Gold WKe source `mcp_step_up_reauth`. Caller is the MCP tool catch:
 * EI.requestedScope + tengu_mcp_step_up_auth_dialog + http + !xaa.
 */
import type { CanUseToolFn } from '../../hooks/useCanUseTool.js'
import type { ToolUseContext } from '../../Tool.js'
import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '../analytics/index.js'
import type {
  McpHTTPServerConfig,
  MCPServerConnection,
  ScopedMcpServerConfig,
} from './types.js'

export const MCP_STEP_UP_AUTH_DIALOG_GATE = 'tengu_mcp_step_up_auth_dialog'

function asMeta(
  value: string,
): AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS {
  return value as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
}

const STEP_UP_CHOICES = [
  {
    value: 'reauthenticate' as const,
    label: 'Re-authenticate in browser',
    description:
      'Signs this server out until you finish authorizing in the browser (for the scope above plus what it already has); if you do not finish, run /mcp to sign back in. The tool call is retried once afterwards',
  },
  {
    value: 'not_now' as const,
    label: 'Not now',
    description:
      'The tool call fails with the permission error; other tools keep working',
  },
]

const flights = new Map<string, Promise<McpStepUpReauthResult>>()
const exhausted = new Map<string, Set<string>>()

export type McpStepUpReauthResult = 'reauthenticated' | 'declined' | 'failed'

function normalizeScope(scope: string): string {
  return scope.split(' ').filter(Boolean).sort().join(' ')
}

/** densable Ua — scope is displayable only when sanitizing is a no-op. */
export function displayableMcpScope(scope: string): string {
  return [...scope]
    .map(ch => {
      const code = ch.charCodeAt(0)
      return code >= 32 && code <= 126 ? ch : ''
    })
    .join('')
}

export function isMcpStepUpScopeDisplayable(scope: string): boolean {
  return displayableMcpScope(scope) === scope && scope.length > 0
}

/** densable Zs / fr — configured oauth.scopes covers requested. */
export function mcpConfiguredScopesPermit(
  config: { oauth?: { scopes?: string; authServerMetadataUrl?: string } },
  requested: string,
): boolean {
  const scopes = config.oauth?.scopes
  if (!(scopes || config.oauth?.authServerMetadataUrl)) {
    return true
  }
  if (!requested || !scopes) return false
  const have = new Set(scopes.split(' ').filter(Boolean))
  return requested
    .split(' ')
    .filter(Boolean)
    .every(token => have.has(token))
}

export function isMcpStepUpReauthExhausted(
  cacheKey: string,
  scope: string,
): boolean {
  return exhausted.get(cacheKey)?.has(normalizeScope(scope)) ?? false
}

export function markMcpStepUpReauthExhausted(
  cacheKey: string,
  previous: string,
  next: string,
): void {
  const key = normalizeScope(previous)
  const set = exhausted.get(cacheKey) ?? new Set<string>()
  if (normalizeScope(next) !== key || set.has(key)) return
  set.add(key)
  exhausted.set(cacheKey, set)
}

/** densable pr */
export function isMcpStepUpAuthDialogEnabled(): boolean {
  try {
    const { getFeatureValue_CACHED_MAY_BE_STALE } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../analytics/growthbook.js') as typeof import('../analytics/growthbook.js')
    return (
      getFeatureValue_CACHED_MAY_BE_STALE(
        MCP_STEP_UP_AUTH_DIALOG_GATE,
        true,
      ) === true
    )
  } catch {
    return true
  }
}

export function extractInsufficientScope(error: unknown): string | undefined {
  if (error == null || typeof error !== 'object') return undefined
  const rec = error as {
    code?: unknown
    message?: unknown
    requestedScope?: unknown
    headers?: unknown
    cause?: unknown
  }
  if (typeof rec.requestedScope === 'string' && rec.requestedScope) {
    return rec.requestedScope
  }
  const www =
    rec.headers &&
    typeof rec.headers === 'object' &&
    rec.headers !== null &&
    'get' in rec.headers &&
    typeof (rec.headers as { get?: unknown }).get === 'function'
      ? (rec.headers as { get: (n: string) => string | null }).get(
          'WWW-Authenticate',
        )
      : undefined
  const fromHeader = www?.includes('insufficient_scope')
    ? www.match(/scope=(?:"([^"]+)"|([^\s,]+))/)
    : undefined
  const headerScope = fromHeader?.[1] ?? fromHeader?.[2]
  if (headerScope) return headerScope
  const message = typeof rec.message === 'string' ? rec.message : ''
  if (message.includes('insufficient_scope')) {
    const match = message.match(/scope[=:][\s"]*([^"\s]+)/i)
    if (match?.[1]) return match[1]
  }
  if (rec.cause !== undefined) {
    return extractInsufficientScope(rec.cause)
  }
  return undefined
}

function isHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
  } catch {
    return false
  }
}

export async function requestMcpStepUpReauth(input: {
  serverName: string
  config: McpHTTPServerConfig
  requestedScope: string
  canUseTool: CanUseToolFn
  toolUseContext: ToolUseContext
  signal: AbortSignal
  cacheKey: string
}): Promise<McpStepUpReauthResult> {
  const existing = flights.get(input.cacheKey)
  if (existing !== undefined) return existing
  const flight = runMcpStepUpReauth(input).finally(() => {
    flights.delete(input.cacheKey)
  })
  flights.set(input.cacheKey, flight)
  return flight
}

async function runMcpStepUpReauth(input: {
  serverName: string
  config: McpHTTPServerConfig
  requestedScope: string
  canUseTool: CanUseToolFn
  toolUseContext: ToolUseContext
  signal: AbortSignal
  cacheKey: string
}): Promise<McpStepUpReauthResult> {
  const { logEvent } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../analytics/index.js') as typeof import('../analytics/index.js')
  const { logMCPDebug } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../../utils/log.js') as typeof import('../../utils/log.js')
  const { confirmWithUser } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../../utils/permissions/confirmWithUser.js') as typeof import('../../utils/permissions/confirmWithUser.js')
  const { getBootstrapSession } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../../utils/sessionRoot.js') as typeof import('../../utils/sessionRoot.js')
  const { createSystemMessage } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../../utils/messages.js') as typeof import('../../utils/messages.js')
  const { performMCPOAuthFlow } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('./auth.js') as typeof import('./auth.js')
  const { connectToServer, clearServerCache, getServerCacheKey } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('./client.js') as typeof import('./client.js')

  const stillHere = (): boolean => {
    const clients =
      input.toolUseContext.getMcp?.().clients ??
      input.toolUseContext.options.mcpClients
    return clients.some(
      client =>
        client.name === input.serverName &&
        client.config.type === 'http' &&
        getServerCacheKey(client.name, client.config) === input.cacheKey,
    )
  }

  const shown = displayableMcpScope(input.requestedScope)
  if (shown !== input.requestedScope) {
    logEvent('mcp_step_up_reauth', {
      reason:
        'scope_not_displayable' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    return 'declined'
  }

  const answered = await confirmWithUser({
    canUseTool: input.canUseTool,
    toolUseContext: input.toolUseContext,
    source: 'mcp_step_up_reauth',
    header: 'MCP',
    question: `MCP server "${input.serverName}" needs additional permissions for this tool (it asked for the scope "${shown}"). Re-authenticate now?`,
    choices: STEP_UP_CHOICES,
  })
  if (answered.kind !== 'chose' || answered.value !== 'reauthenticate') {
    logEvent('mcp_step_up_reauth', {
      reason: (answered.kind === 'unanswered'
        ? answered.reason
        : answered.kind === 'chose'
          ? 'declined'
          : answered.kind) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    return 'declined'
  }
  if (!stillHere()) {
    logEvent('mcp_step_up_reauth', {
      reason: asMeta('server_unavailable_after_consent'),
    })
    return 'failed'
  }

  try {
    await performMCPOAuthFlow(
      input.serverName,
      input.config,
      url => {
        logMCPDebug(
          input.serverName,
          `Step-up re-auth authorization URL: ${url}`,
        )
        const prefix = `Opening your browser to re-authenticate MCP server "${input.serverName}".`
        const displayable = isHttpUrl(url)
        input.toolUseContext.appendSystemMessage?.(
          createSystemMessage(
            displayable
              ? `${prefix} If it doesn't open, use this link to the server's sign-in page: ${url}`
              : `${prefix} If it doesn't open, run /mcp to sign back in; its sign-in screen shows the link.`,
            'suggestion',
          ) as never,
        )
      },
      input.signal,
    )
  } catch {
    if (input.signal.aborted) {
      logEvent('mcp_step_up_reauth', { reason: asMeta('cancelled') })
    } else {
      logEvent('mcp_step_up_reauth', { reason: asMeta('flow_failed') })
    }
    return 'failed'
  }

  if (!stillHere()) {
    logEvent('mcp_step_up_reauth', {
      reason: asMeta('server_unavailable_after_flow'),
    })
    return 'failed'
  }

  const wiring = getBootstrapSession().mcpSessionWiring
  if (wiring.connections() === undefined) {
    logEvent('mcp_step_up_reauth', { reason: asMeta('no_connections_owner') })
    return 'failed'
  }

  try {
    const scoped = input.config as unknown as ScopedMcpServerConfig
    await clearServerCache(input.serverName, scoped)
    const reconnected = (await connectToServer(
      input.serverName,
      scoped,
    )) as MCPServerConnection
    const owner = wiring.connections()
    if (!stillHere() || owner === undefined) {
      await clearServerCache(input.serverName, scoped).catch(
        (error: unknown) => {
          logMCPDebug(
            input.serverName,
            `Orphan cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
          )
        },
      )
      logEvent('mcp_step_up_reauth', {
        reason: asMeta('server_unavailable_after_reconnect'),
      })
      return 'failed'
    }
    owner.adoptServer(input.serverName, reconnected, {
      appendIfAbsent: false,
    })
    if (reconnected.type !== 'connected') {
      logEvent('mcp_step_up_reauth', {
        reason: asMeta('reconnect_not_connected'),
      })
      return 'failed'
    }
  } catch {
    logEvent('mcp_step_up_reauth', { reason: asMeta('reconnect_failed') })
    return 'failed'
  }

  logEvent('mcp_step_up_reauth', { enabled: true })
  return 'reauthenticated'
}

export function shouldOfferMcpStepUpReauth(input: {
  requestedScope: string | undefined
  config: ScopedMcpServerConfig
  canUseTool: unknown
  toolUseContext: ToolUseContext
  alreadyRetried: boolean
}): boolean {
  if (input.alreadyRetried) return false
  if (input.requestedScope === undefined) return false
  if (!isMcpStepUpAuthDialogEnabled()) return false
  if (input.config.type !== 'http') return false
  if (input.config.oauth?.xaa === true) return false
  if (!mcpConfiguredScopesPermit(input.config, input.requestedScope)) {
    return false
  }
  if (typeof input.canUseTool !== 'function') return false
  if (input.toolUseContext.agentId !== undefined) return false
  if (input.toolUseContext.options.isNonInteractiveSession) return false
  try {
    const { isBgSessionWithoutTerminal } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../utils/concurrentSessions.js') as typeof import('../../utils/concurrentSessions.js')
    if (isBgSessionWithoutTerminal()) return false
    const { getBootstrapSessionHost } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../utils/sessionRoot.js') as typeof import('../../utils/sessionRoot.js')
    if (
      getBootstrapSessionHost().extensionsConfig.teammateAgentId() !== undefined
    ) {
      return false
    }
  } catch {
    return false
  }
  return true
}
