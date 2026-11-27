import { feature } from 'bun:bundle'
import {
  Client,
  SdkError,
  SdkHttpError,
  UnauthorizedError,
} from '@modelcontextprotocol/client'
import { pathToFileURL } from 'url'
import {
  getAdditionalDirectoriesForClaudeMd,
  getOriginalCwd,
} from '../../../bootstrap/state.js'
import {
  createDefaultCanUseTool,
  resolveToolUseContext,
  type Tool,
} from '../../../Tool.js'
import { getPlatform } from '../../../utils/platform.js'
import {
  errorMessage,
  TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
} from '../../../utils/errors.js'
import { logMCPDebug, logMCPError } from '../../../utils/log.js'
import {
  getBootstrapSession,
  runWithSession,
} from '../../../utils/sessionRoot.js'
import { isCliOwnedConfig } from '../cliOwnedConfigs.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../analytics/index.js'
import {
  connectorDesignOmitsPersistentAllow,
  connectorDesignTokenlessWriteDeny,
} from '../connectorDesign.js'
import { mcpToolCheckPermissionsResult } from '../mcpToolInteraction.js'
import { createHash } from 'crypto'
import { isIPv6 } from 'net'
import { normalizeNameForMCP } from '../normalization.js'
import { isMcpConnectionClosedError } from '../authReconnect.js'
import type {
  ConnectedMCPServer,
  MCPServerConnection,
  ScopedMcpServerConfig,
} from '../types.js'
import {
  McpAuthError,
  McpToolCallError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
} from '../connectionHelpers.js'
import { isClaudeInChromeMCPServer } from '../../../utils/claudeInChrome/common.js'

export const isComputerUseMCPServer = feature('CHICAGO_MCP')
  ? (
      require('../../../utils/computerUse/common.js') as typeof import('../../../utils/computerUse/common.js')
    ).isComputerUseMCPServer
  : undefined

export const MCP_FETCH_CACHE_SIZE = 20

export type BoundSession = ReturnType<typeof getBootstrapSession>

export type ConnectedClientWiringFn = (client: ConnectedMCPServer) => void

export type McpToolsSwapperFn = (
  serverName: string,
  tools: Tool[],
  config: ScopedMcpServerConfig,
  connectedClient?: ConnectedMCPServer,
) => boolean

export type McpServerConnectedListener = (client: ConnectedMCPServer) => void

export function createHostCacheProxy<C extends object>(getTarget: () => C): C {
  const proxy: C = new Proxy({} as C, {
    get(_dummy, prop) {
      const target = getTarget()
      if (prop === 'set') {
        const setFn = Reflect.get(target, prop, target)
        if (typeof setFn === 'function') {
          return (...args: unknown[]) => {
            setFn.apply(target, args)
            return proxy
          }
        }
      }
      const value = Reflect.get(target, prop, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
    set(_dummy, prop, value) {
      const target = getTarget()
      return Reflect.set(target, prop, value, target)
    },
    has(_dummy, prop) {
      return Reflect.has(getTarget(), prop)
    },
    ownKeys() {
      return Reflect.ownKeys(getTarget())
    },
    getOwnPropertyDescriptor(_dummy, prop) {
      const desc = Object.getOwnPropertyDescriptor(getTarget(), prop)
      if (!desc) return undefined
      return { ...desc, configurable: true }
    },
  })
  return proxy
}

export function bindMcpClientHandlersToSession(
  client: Client,
  session: BoundSession,
): void {
  const wrapFn = <F extends (...args: never[]) => unknown>(fn: F): F =>
    ((...args: Parameters<F>) =>
      runWithSession(session, () => fn(...args))) as F

  const origSetNotificationHandler = client.setNotificationHandler.bind(
    client,
  ) as (...args: unknown[]) => unknown
  client.setNotificationHandler = ((
    method: unknown,
    schemasOrHandler: unknown,
    maybeHandler?: unknown,
  ) => {
    if (typeof schemasOrHandler === 'function') {
      return origSetNotificationHandler(
        method,
        wrapFn(schemasOrHandler as (...args: never[]) => unknown),
      )
    }
    if (typeof maybeHandler === 'function') {
      return origSetNotificationHandler(
        method,
        schemasOrHandler,
        wrapFn(maybeHandler as (...args: never[]) => unknown),
      )
    }
    return origSetNotificationHandler(method, schemasOrHandler, maybeHandler)
  }) as Client['setNotificationHandler']

  const origSetRequestHandler = client.setRequestHandler.bind(client) as (
    ...args: unknown[]
  ) => unknown
  client.setRequestHandler = ((
    method: unknown,
    schemasOrHandler: unknown,
    maybeHandler?: unknown,
  ) => {
    if (typeof schemasOrHandler === 'function') {
      return origSetRequestHandler(
        method,
        wrapFn(schemasOrHandler as (...args: never[]) => unknown),
      )
    }
    if (typeof maybeHandler === 'function') {
      return origSetRequestHandler(
        method,
        schemasOrHandler,
        wrapFn(maybeHandler as (...args: never[]) => unknown),
      )
    }
    return origSetRequestHandler(method, schemasOrHandler, maybeHandler)
  }) as Client['setRequestHandler']

  for (const prop of [
    'onclose',
    'onerror',
    'fallbackNotificationHandler',
    'fallbackRequestHandler',
  ] as const) {
    const initial = client[prop]
    let current =
      typeof initial === 'function'
        ? (wrapFn(initial as (...args: never[]) => unknown) as typeof initial)
        : initial
    Object.defineProperty(client, prop, {
      configurable: true,
      enumerable: true,
      get() {
        return current
      },
      set(next) {
        current =
          typeof next === 'function'
            ? (wrapFn(next as (...args: never[]) => unknown) as typeof current)
            : next
      },
    })
  }
}

export type EnsureConnectedClientOpts = {
  signal?: AbortSignal
  timeoutMs?: number
  context?: string
}

/**
 * densable ensureConnectedClient → connect with `{signal, timeoutMs}`.
 * Cache key stays name+config (`getServerCacheKey`); deadline is per-call.
 */
/**
 * Official `Iei(n)` (#1564) — unset `AWS_BEARER_TOKEN_BEDROCK` when empty so
 * stdio MCP children don't inherit an empty bearer token override.
 */
export function unsetEmptyAwsBearerTokenBedrock(
  env: Record<string, string>,
): void {
  const isWin = getPlatform() === 'windows'
  const keys = Object.keys(env).filter(
    k =>
      k === 'AWS_BEARER_TOKEN_BEDROCK' ||
      (isWin && k.toUpperCase() === 'AWS_BEARER_TOKEN_BEDROCK'),
  )
  if (keys.some(k => env[k] === '')) {
    for (const k of keys) {
      delete env[k]
    }
  }
}

/**
 * densable `Ld` — raw SDK tools/call. Gold is `Ls(e).callTool(r, void 0, n)`
 * (schema middle). Public client@2 is `callTool(params, options)`; putting
 * `{signal, timeout}` in the 2nd arg is what actually aborts the request.
 */
export function invokeToolRaw(
  client: {
    callTool: (
      params: {
        name: string
        arguments?: Record<string, unknown>
        _meta?: Record<string, unknown>
      },
      options?: { signal?: AbortSignal; timeout?: number },
    ) => Promise<unknown>
  },
  params: {
    name: string
    arguments?: Record<string, unknown>
    _meta?: Record<string, unknown>
  },
  options?: { signal?: AbortSignal; timeout?: number },
): Promise<unknown> {
  return client.callTool(params, options)
}

/**
 * Official 2.1.328 `Ah` / `YP` (chunk@335138039.js @146201):
 * Build `roots/list` entries from the original cwd plus any
 * `additionalWorkingDirectories`, deduplicated by file:// URI, and broadcast
 * `notifications/roots/list_changed` to all live MCP clients when roots change.
 */
export function buildMcpRootsList(
  primaryDir: string | null = getOriginalCwd(),
  additionalDirs: readonly string[] = getAdditionalDirectoriesForClaudeMd(),
): { roots: Array<{ uri: string }> } {
  const seen = new Set<string>()
  const roots: Array<{ uri: string }> = []
  const candidates = [...(primaryDir ? [primaryDir] : []), ...additionalDirs]
  for (const dir of candidates) {
    if (!dir) continue
    let uri: string
    try {
      uri = pathToFileURL(dir).href
    } catch {
      uri = `file://${dir}`
    }
    if (seen.has(uri)) continue
    seen.add(uri)
    roots.push({ uri })
  }
  return { roots }
}

export function formatMcpServerRemovedError(name: string): string {
  return `MCP server "${name}" was not called: it was removed from this session. Continue without it.`
}

/**
 * Official 2.1.326 #81 (`q9a` @288151558): Explain to Claude when a server's
 * tool call failure followed a declined elicitation question.
 */
export function formatMcpElicitationDeclinedError(
  replyMessage: string,
): string {
  const trimmed = replyMessage.trim()
  return `${trimmed === '' ? 'This call failed. That' : `The server replied: "${trimmed}". That reply`} came after a question that the server asked about this call was declined, and the decline still stands. Another call for this action repeats the request that the question was about.`
}

/**
 * Official 2.1.326 #255 (`HHt` @288150814): Outcome-unknown guidance when a
 * `claudeai-proxy` MCP call is cut off after being sent.
 */
export const MCP_CALL_OUTCOME_UNKNOWN_NOTE =
  'The outcome is unknown: the call may have finished, may still be running, or may never have started. Check what it did before you repeat it.'

export function isClaudeAiProxyCutOffAfterSend(
  error: unknown,
  configType: string | undefined,
  signalAborted: boolean,
): boolean {
  if (configType !== 'claudeai-proxy' || signalAborted) {
    return false
  }
  if (!(error instanceof Error)) {
    return false
  }
  if (
    error.name === 'AbortError' ||
    error instanceof McpAuthError ||
    error instanceof
      McpToolCallError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS ||
    error instanceof TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
  ) {
    return false
  }
  if (isMcpConnectionClosedError(error)) {
    return true
  }
  const status =
    error instanceof SdkHttpError
      ? error.status
      : typeof (error as unknown as { code?: unknown }).code === 'number'
        ? (error as unknown as { code: number }).code
        : undefined
  if (status === undefined || error.name === 'TimeoutError') {
    return !(error instanceof SdkError) || error.name === 'TimeoutError'
  }
  return status >= 500
}

const NON_REAUTH_OAUTH_ERROR_CODES = new Set([
  'invalid_grant',
  'invalid_client',
  'unauthorized_client',
])

/**
 * #1996: Official `Wp` + `at` (`isOAuthShapedAuthError`).
 * Classifies MCP tool-call errors from OAuth sign-in servers (such as
 * `TOKEN_EXPIRED`, `invalid_token`, or other non-client-config OAuth errors on
 * HTTP 401/403) so Claude asks the user to sign in again instead of ending in
 * the raw auth-server error.
 */
export function classifyMcpToolCallAuthError(
  error: Error,
  options?: { hasHeadersHelper?: boolean; pendingStepUpScope?: string },
): 'credential_rejected' | 'step_up' | undefined {
  const numericCode =
    'code' in error && typeof (error as { code?: unknown }).code === 'number'
      ? (error as { code: number }).code
      : 'status' in error &&
          typeof (error as { status?: unknown }).status === 'number'
        ? (error as { status: number }).status
        : undefined
  const stringOAuthCode =
    'errorCode' in error &&
    typeof (error as { errorCode?: unknown }).errorCode === 'string'
      ? (error as { errorCode: string }).errorCode
      : 'code' in error &&
          typeof (error as { code?: unknown }).code === 'string'
        ? (error as { code: string }).code
        : undefined
  const isOAuthShapedAuthError =
    stringOAuthCode !== undefined &&
    !NON_REAUTH_OAUTH_ERROR_CODES.has(stringOAuthCode) &&
    (/^HTTP 40[13]\b/.test(error.message) ||
      /^(?:TOKEN_EXPIRED|EXPIRED_TOKEN|INVALID_TOKEN|UNAUTHORIZED|ACCESS_TOKEN_EXPIRED)$/i.test(
        stringOAuthCode,
      ))
  const isUnauthorized =
    error instanceof UnauthorizedError ||
    /\bTOKEN_EXPIRED\b/.test(error.message)
  const hasStepUp = options?.pendingStepUpScope !== undefined
  if (
    !(
      numericCode === 401 ||
      isUnauthorized ||
      isOAuthShapedAuthError ||
      (numericCode === 403 && options?.hasHeadersHelper) ||
      (hasStepUp && numericCode === 403)
    )
  ) {
    return undefined
  }
  return hasStepUp &&
    numericCode !== 401 &&
    !(isOAuthShapedAuthError && /^HTTP 401\b/.test(error.message))
    ? 'step_up'
    : 'credential_rejected'
}

/**
 * #2151: Official `droppedToolsSeqByConnection` (`Lc(e)`). Ensures an older
 * overlapping `tools/list` call never overwrites newer `client.droppedTools`.
 */
const droppedToolsSeqByConnection = new WeakMap<
  MCPServerConnection,
  { started: number; applied: number }
>()

export function nextDroppedToolsSeq(client: MCPServerConnection): {
  seq: number
  state: { started: number; applied: number }
} {
  const state = droppedToolsSeqByConnection.get(client) ?? {
    started: 0,
    applied: 0,
  }
  droppedToolsSeqByConnection.set(client, state)
  state.started += 1
  return { seq: state.started, state }
}

/**
 * Official 2.1.328 (`$mt` / `RAn` / `mhs` / `AZe` @chunk@289358491.js,
 * @chunk@283835568.js): canonical anti-spoofing keys for MCP tools so a
 * renamed or malicious server cannot inherit another server's allow/deny
 * permission rules.
 */
export type McpStandardKey = {
  key: string
  pinned: boolean
}

export type McpToolInfoWithKeys = NonNullable<Tool['mcpInfo']> & {
  accountMemoryServer?: boolean
  standardKey?: McpStandardKey
  denyKey?: string
  toolNameShared?: boolean
  legacyGrantRefused?: boolean
}

const STANDARD_KEY_MAX_LEN = 54

const STANDARD_KEY_MAX_HOST_LEN = 253

const STANDARD_KEY_TRUNC_PREFIX_LEN = 21

const STANDARD_KEY_HASH_LEN = 32

const STANDARD_KEY_DENY_MAX_LEN = 128

const STANDARD_KEY_VALID_RE = /^[A-Za-z0-9_-]+$/

const STANDARD_KEY_HOST_RE = /^([A-Za-z0-9._-]+)(?::[0-9]*)?$/

const STANDARD_KEY_IPV6_RE = /^\[([0-9A-Fa-f:.]+)\](?::[0-9]*)?$/

const STANDARD_KEY_LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

const STANDARD_KEY_NUMERIC_TLD_RE = /^(?:[0-9]+|0x[0-9a-f]*)$/

const STANDARD_KEY_HEX_ID_RE = /^(?:0x)?[0-9a-f_]+$/

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function isValidStandardKeySegment(candidate: string): boolean {
  return (
    STANDARD_KEY_VALID_RE.test(candidate) &&
    !candidate.includes('__') &&
    !candidate.startsWith('_') &&
    !candidate.endsWith('_')
  )
}

function trimAsciiControlAndSpace(raw: string): string {
  let start = 0
  let end = raw.length
  while (start < end && raw.charCodeAt(start) <= 32) start++
  while (end > start && raw.charCodeAt(end - 1) <= 32) end--
  return raw.slice(start, end)
}

/**
 * Official 2.1.328 (`mhs` @chunk@283835568.js@7109): derive a stable,
 * URL-bound key for remote MCP servers (`https://api.example.com/mcp` →
 * `api_example_com`, non-HTTPS/IP/long hosts → `h-<sha256-32>`).
 */
export function deriveMcpUrlStandardKey(url: string): string | undefined {
  const cleaned = trimAsciiControlAndSpace(url.replace(/[\t\r\n]/g, ''))
  const sep = cleaned.indexOf('://')
  if (sep < 0) return undefined
  const scheme = cleaned.slice(0, sep).toLowerCase()
  if (scheme !== 'http' && scheme !== 'https') return undefined
  const authority = cleaned.slice(sep + 3).split(/[/?#]/, 1)[0] ?? ''
  if (authority.includes('\\')) return undefined
  const hostPort = authority.slice(authority.lastIndexOf('@') + 1)
  const hostMatch =
    STANDARD_KEY_HOST_RE.exec(hostPort) ?? STANDARD_KEY_IPV6_RE.exec(hostPort)
  if (!hostMatch?.[1]) return undefined
  if (hostPort.startsWith('[') && !isIPv6(hostMatch[1])) return undefined
  const host = hostMatch[1].toLowerCase().replace(/\.$/, '')
  if (host === '') return undefined

  const originForHash = `${scheme}://${host.includes(':') ? `[${host}]` : host}`
  const hash32 = sha256Hex(originForHash).slice(0, STANDARD_KEY_HASH_LEN)
  const fallback = `h-${hash32}`

  let readable: string | undefined
  const labels = host.split('.')
  const tld = labels.at(-1) ?? ''
  if (
    scheme === 'https' &&
    host.length <= STANDARD_KEY_MAX_HOST_LEN &&
    labels.length >= 2 &&
    !tld.includes('-') &&
    !labels.some(l => l.startsWith('sk-ant-')) &&
    !STANDARD_KEY_NUMERIC_TLD_RE.test(tld) &&
    labels.every(l => STANDARD_KEY_LABEL_RE.test(l))
  ) {
    const joined = labels.join('_')
    const strippedHex = joined.replaceAll('-', '')
    const looksHexId =
      (strippedHex.length === 32 || strippedHex.length === 23) &&
      STANDARD_KEY_HEX_ID_RE.test(strippedHex)
    if (!looksHexId) {
      readable = joined
    }
  }

  const candidate =
    readable === undefined
      ? fallback
      : readable.length > STANDARD_KEY_MAX_LEN
        ? `${readable.slice(0, STANDARD_KEY_TRUNC_PREFIX_LEN).replace(/^[_-]+|[_-]+$/g, '')}-${hash32}`
        : readable
  const finalKey = `${candidate}-`
    .replace(/[_-]+/g, '-')
    .startsWith('org-connector-')
    ? fallback
    : candidate
  return isValidStandardKeySegment(finalKey) ? finalKey : undefined
}

function isReservedStandardKeyServerName(serverName: string): boolean {
  const norm = normalizeNameForMCP(serverName).toLowerCase()
  return (
    norm === 'ide' ||
    isClaudeInChromeMCPServer(serverName) ||
    (feature('CHICAGO_MCP') ? isComputerUseMCPServer!(serverName) : false)
  )
}

/**
 * Official 2.1.328 (`AZe` @chunk@289358491.js@1212): detect a non-claude.ai
 * server attempting to spoof a `claude_ai_*` connector server name.
 */
export function isSpoofedClaudeAiServerName(
  serverName: string,
  config: Pick<ScopedMcpServerConfig, 'scope'>,
): boolean {
  return (
    normalizeNameForMCP(serverName).startsWith('claude_ai_') &&
    config.scope !== 'claudeai'
  )
}

/**
 * Official 2.1.328 (`$mt` @chunk@289358491.js@4910): compute the canonical
 * `standardKey` identifying an MCP server independently of display aliases.
 */
export function computeMcpStandardKey(
  serverName: string,
  config: ScopedMcpServerConfig,
  isCliOwned: boolean = isCliOwnedConfig(config),
): McpStandardKey | undefined {
  if (isCliOwned || isReservedStandardKeyServerName(serverName)) {
    return { key: normalizeNameForMCP(serverName), pinned: true }
  }
  switch (config.type) {
    case 'sse-ide':
    case 'ws-ide':
      return { key: 'ide', pinned: true }
    case 'http':
    case 'sse': {
      const key = deriveMcpUrlStandardKey(config.url)
      return key !== undefined ? { key, pinned: false } : undefined
    }
    case 'claudeai-proxy': {
      const key = deriveMcpUrlStandardKey(config.url)
      return key !== undefined ? { key, pinned: false } : undefined
    }
    case 'stdio':
    case undefined:
      return { key: normalizeNameForMCP(serverName), pinned: false }
    default:
      return undefined
  }
}

/**
 * Official 2.1.328 (`RAn` @chunk@289358491.js@2809): compute the alternate
 * `denyKey` so deny/ask rules continue to match across connector IDs and
 * canonicalized URL origins (e.g. punycode/IDN or proxy origin forms).
 */
export function computeMcpDenyKey(
  config: ScopedMcpServerConfig & { connectorId?: string },
): string | undefined {
  if (config.type === 'sdk' && typeof config.connectorId === 'string') {
    const normalized = normalizeNameForMCP(config.connectorId)
    if (
      normalized.length > 0 &&
      normalized.length <= STANDARD_KEY_DENY_MAX_LEN &&
      !normalized.includes('__')
    ) {
      return normalized
    }
    return undefined
  }
  if (
    config.type !== 'http' &&
    config.type !== 'sse' &&
    config.type !== 'claudeai-proxy'
  ) {
    return undefined
  }
  if (typeof config.url !== 'string' || !URL.canParse(config.url)) {
    return undefined
  }
  const originKey = deriveMcpUrlStandardKey(new URL(config.url).origin)
  const rawUrlKey = deriveMcpUrlStandardKey(config.url)
  return originKey !== undefined && originKey !== rawUrlKey
    ? originKey
    : undefined
}

/**
 * Official 2.1.328 (`wl` / `composeMcpTool` @chunk@335138039.js@210828):
 * attach `standardKey`, `denyKey`, `toolNameShared`, and `legacyGrantRefused`
 * anti-spoofing metadata onto a composed MCP `Tool`, and refuse persistent
 * allow-rules when a server spoofs a `claude_ai_*` name or has colliding
 * normalized tool names.
 */
export function composeMcpTool(params: {
  serverName: string
  config: ScopedMcpServerConfig
  toolName: string
  fullyQualifiedName: string
  skipPrefix?: boolean
  standardKey?: McpStandardKey
  denyKey?: string
  toolNameShared?: boolean
  legacyGrantRefused?: boolean
  requiresUserInteraction: boolean
  isFirstPartyDesignServer: boolean
  baseTool: Tool
  /** Optional server-specific permission check override (e.g. Claude in Chrome URL policy). */
  customCheckPermissions?: Tool['checkPermissions']
}): Tool {
  const {
    serverName,
    config,
    toolName,
    fullyQualifiedName,
    standardKey,
    denyKey,
    toolNameShared = false,
    legacyGrantRefused = false,
    requiresUserInteraction,
    isFirstPartyDesignServer,
    baseTool,
    customCheckPermissions,
  } = params

  const spoofedClaudeAi = isSpoofedClaudeAiServerName(serverName, config)
  const allowRulesBlocked =
    spoofedClaudeAi || legacyGrantRefused || toolNameShared
  if (allowRulesBlocked) {
    logMCPDebug(
      serverName,
      spoofedClaudeAi
        ? "Allow rules do not apply: this server's name starts like a claude.ai connector's. To use allow rules, the server needs another name, and the rules must use that name."
        : legacyGrantRefused
          ? 'Allow rules do not apply: another MCP server already uses this name. Give this server a different name and write the rules for that name.'
          : `Allow rules do not apply to "${toolName}": another tool of this server gets the same name in Claude Code. To use allow rules, the server must rename one of them.`,
    )
  }

  const prevMcpInfo = baseTool.mcpInfo as McpToolInfoWithKeys | undefined
  const mcpInfo: McpToolInfoWithKeys = {
    ...(prevMcpInfo ?? { serverName, toolName }),
    ...(standardKey !== undefined ? { standardKey } : {}),
    ...(denyKey !== undefined ? { denyKey } : {}),
    ...(toolNameShared ? { toolNameShared: true } : {}),
    ...(spoofedClaudeAi || legacyGrantRefused
      ? { legacyGrantRefused: true }
      : {}),
  }

  const omitsPersistentAllow =
    allowRulesBlocked ||
    connectorDesignOmitsPersistentAllow(isFirstPartyDesignServer, toolName)

  const {
    create: _baseCreate,
    permissionCheckFailureDecision: _basePermFailure,
    deriveObservableInput: _baseDeriveObs,
    ...cleanBaseTool
  } = baseTool

  const composed: Tool = {
    ...cleanBaseTool,
    mcpInfo,
    suppressesAlwaysAllowRule: () =>
      requiresUserInteraction || omitsPersistentAllow,
    async checkPermissions(input: unknown, context) {
      const denied = connectorDesignTokenlessWriteDeny(
        isFirstPartyDesignServer,
        toolName,
        input,
      )
      if (denied) return denied
      if (customCheckPermissions !== undefined) {
        return customCheckPermissions(input as Record<string, unknown>, context)
      }
      return mcpToolCheckPermissionsResult(
        requiresUserInteraction,
        fullyQualifiedName,
        serverName,
        omitsPersistentAllow,
      )
    },
    create(deps) {
      return {
        call(args, callCtx) {
          const ctx = resolveToolUseContext(deps, callCtx)
          return composed.call(
            args,
            ctx,
            callCtx.canUseTool ?? createDefaultCanUseTool(),
            callCtx.parentMessage as Parameters<Tool['call']>[3],
            callCtx.onProgress,
            {
              userModified: callCtx.userModified,
              globLimits: callCtx.globLimits,
              fileReadingLimits: callCtx.fileReadingLimits,
              gitDiffRead: callCtx.gitDiffRead,
              smallResultAsked: callCtx.smallResultAsked,
              callerLogsSharedEvents: callCtx.callerLogsSharedEvents,
              timing: callCtx.timing,
              remoteCall: callCtx.remoteCall,
            },
          )
        },
        ...(cleanBaseTool.validateInput !== undefined
          ? {
              validateInput(input, callCtx) {
                return cleanBaseTool.validateInput!(
                  input,
                  resolveToolUseContext(deps, callCtx),
                )
              },
            }
          : {}),
        checkPermissions(input, callCtx) {
          return composed.checkPermissions(
            input,
            resolveToolUseContext(deps, callCtx),
          )
        },
      }
    },
  }
  return composed
}

/**
 * Official 2.1.328 (`hR` / `completeResourceTemplate`
 * @chunk@335138039.js@243488): invoke MCP `completion/complete` for a
 * resource template argument when the connected server advertises the
 * `completions` capability.
 */
export async function completeResourceTemplate(
  client: MCPServerConnection,
  uri: string,
  argumentName: string,
  argumentValue: string,
  contextArguments: Record<string, string> = {},
): Promise<string[]> {
  if (client.type !== 'connected' || !client.capabilities?.completions) {
    return []
  }
  try {
    const result = await client.client.complete({
      ref: { type: 'ref/resource', uri },
      argument: { name: argumentName, value: argumentValue },
      ...(Object.keys(contextArguments).length > 0
        ? { context: { arguments: contextArguments } }
        : {}),
    })
    logEvent('tengu_mcp_complete_resource_template', {
      outcome:
        'success' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    return result.completion.values
  } catch (error) {
    logEvent('tengu_mcp_complete_resource_template', {
      outcome:
        'failed' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    logMCPError(
      client.name,
      `Failed to complete resource template: ${errorMessage(error)}`,
    )
    return []
  }
}

export const MCP_QUESTION_UNANSWERED_MESSAGE =
  "The server asked the user a question, and no answer came before the time limit. Do not call this tool again in this turn. Tell the user that the server's question got no answer, and wait for their reply."

export function formatMcpToolTimeoutMessage(
  serverName: string,
  toolName: string,
  timeoutMs: number,
  hasOpenQuestions: boolean,
): string {
  const base = `MCP server "${serverName}" tool "${toolName}" timed out after ${Math.floor(timeoutMs / 1000)}s`
  return hasOpenQuestions ? `${base}. ${MCP_QUESTION_UNANSWERED_MESSAGE}` : base
}

/**
 * Official `Zqt` @278801674 (#1121):
 * Prevent `'cached'` MCP client updates from overwriting a live `'connected'`,
 * un-held `'disabled'` (`heldBy === undefined`), or `'needs-auth'` client.
 */
export function shouldApplyMcpClientUpdate(
  existing: MCPServerConnection | undefined,
  incoming: MCPServerConnection | { type: string; name: string },
): boolean {
  if (incoming.type !== 'cached' || !existing) return true
  const heldBy =
    existing.type === 'disabled' && 'heldBy' in existing
      ? existing.heldBy
      : undefined
  return !(
    existing.type === 'connected' ||
    (existing.type === 'disabled' && heldBy === undefined) ||
    existing.type === 'needs-auth'
  )
}
