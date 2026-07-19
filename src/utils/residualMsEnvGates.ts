/**
 * Official residual positive-integer ms env gates (portable parsers).
 * Invalid/missing → undefined or documented defaults (caller-dependent).
 */

export const DEFAULT_AUTH_FAIL_EXIT_MS = 300_000
export const DEFAULT_USER_DIALOG_TIMEOUT_MS = 300_000
export const DEFAULT_PARKED_PERMISSION_WAIT_MS = 2_000
export const DEFAULT_TEAM_TEARDOWN_PARK_TIMEOUT_MS = 30_000
export const DEFAULT_OAUTH_401_WAIT_REMOTE_MS = 30_000
export const DEFAULT_IDLE_THRESHOLD_MINUTES = 60
export const DEFAULT_IDLE_TOKEN_THRESHOLD = 100_000
export const DEFAULT_SESSIONEND_HOOKS_TIMEOUT_MS = 1_500
export const DEFAULT_PWSH_PARSE_TIMEOUT_MS = 5_000
export const DEFAULT_API_KEY_HELPER_TTL_MS = 5 * 60 * 1000
export const DEFAULT_AWS_CHAIN_RESOLVE_TIMEOUT_MS = 60_000
export const DEFAULT_MCP_TOOL_IDLE_TIMEOUT_MS = 5 * 60 * 1000
export const DEFAULT_MAX_TOOL_USE_CONCURRENCY = 10
export const DEFAULT_STOP_HOOK_BLOCK_CAP = 50

function parsePositiveMs(raw: string | undefined): number | undefined {
  if (!raw) return undefined
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return undefined
  return Math.floor(n)
}

/** Non-negative integer ms (0 allowed). Invalid/missing → undefined. */
function parseNonNegativeMs(raw: string | undefined): number | undefined {
  if (raw === undefined || raw === '') return undefined
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) return undefined
  return Math.floor(n)
}

export function resolveAuthFailExitMs(
  env: NodeJS.ProcessEnv = process.env,
): number | undefined {
  return parsePositiveMs(env.CLAUDE_CODE_AUTH_FAIL_EXIT_MS)
}

/**
 * OrDefault densable — explicit 0 allowed; invalid/missing → DEFAULT.
 * Uses non-negative parse so CLAUDE_CODE_AUTH_FAIL_EXIT_MS=0 disables exit.
 */
export function resolveAuthFailExitMsOrDefault(
  env: NodeJS.ProcessEnv = process.env,
): number {
  return (
    parseNonNegativeMs(env.CLAUDE_CODE_AUTH_FAIL_EXIT_MS) ??
    DEFAULT_AUTH_FAIL_EXIT_MS
  )
}

export function resolveUserDialogTimeoutMs(
  env: NodeJS.ProcessEnv = process.env,
): number | undefined {
  return parsePositiveMs(env.CLAUDE_CODE_USER_DIALOG_TIMEOUT_MS)
}

export function resolveUserDialogTimeoutMsOrDefault(
  env: NodeJS.ProcessEnv = process.env,
): number {
  return resolveUserDialogTimeoutMs(env) ?? DEFAULT_USER_DIALOG_TIMEOUT_MS
}

export function resolveParkedPermissionWaitMs(
  env: NodeJS.ProcessEnv = process.env,
): number | undefined {
  return parsePositiveMs(env.CLAUDE_CODE_PARKED_PERMISSION_WAIT_MS)
}

export function resolveParkedPermissionWaitMsOrDefault(
  env: NodeJS.ProcessEnv = process.env,
): number {
  return (
    resolveParkedPermissionWaitMs(env) ?? DEFAULT_PARKED_PERMISSION_WAIT_MS
  )
}

export function resolveOauth401WaitMs(
  env: NodeJS.ProcessEnv = process.env,
): number | undefined {
  return parsePositiveMs(env.CLAUDE_CODE_OAUTH_401_WAIT_MS)
}

/**
 * Official XTh densable — OAuth 401 wait with remote default.
 * - Explicit CLAUDE_CODE_OAUTH_401_WAIT_MS (incl. 0) wins.
 * - Remote session → DEFAULT_OAUTH_401_WAIT_REMOTE_MS (30_000).
 * - Non-remote → 0 (no wait).
 */
export function resolveOauth401WaitMsOrDefault(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const explicit = parseNonNegativeMs(env.CLAUDE_CODE_OAUTH_401_WAIT_MS)
  if (explicit !== undefined) return explicit
  const isRemote = Boolean(
    env.CLAUDE_CODE_REMOTE_SESSION_ID || env.CLAUDE_CODE_REMOTE,
  )
  return isRemote ? DEFAULT_OAUTH_401_WAIT_REMOTE_MS : 0
}

export function resolveTeamTeardownParkTimeoutMs(
  env: NodeJS.ProcessEnv = process.env,
): number | undefined {
  return parsePositiveMs(env.CLAUDE_CODE_TEAM_TEARDOWN_PARK_TIMEOUT_MS)
}

export function resolveTeamTeardownParkTimeoutMsOrDefault(
  env: NodeJS.ProcessEnv = process.env,
): number {
  return (
    resolveTeamTeardownParkTimeoutMs(env) ??
    DEFAULT_TEAM_TEARDOWN_PARK_TIMEOUT_MS
  )
}

/** Official densable — CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY (default 10). */
export function resolveMaxToolUseConcurrency(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env.CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY
  if (raw !== undefined && raw !== '') {
    const n = Number(raw)
    if (Number.isFinite(n) && n > 0) return Math.floor(n)
  }
  return DEFAULT_MAX_TOOL_USE_CONCURRENCY
}

/** Official densable — CLAUDE_CODE_STOP_HOOK_BLOCK_CAP (default 50). */
export function resolveStopHookBlockCap(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env.CLAUDE_CODE_STOP_HOOK_BLOCK_CAP
  if (raw !== undefined && raw !== '') {
    const n = Number(raw)
    if (Number.isFinite(n) && n > 0) return Math.floor(n)
  }
  return DEFAULT_STOP_HOOK_BLOCK_CAP
}

/** Official densable — CLAUDE_CODE_IDLE_TOKEN_THRESHOLD (default 100_000). */
export function resolveIdleTokenThreshold(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const n = Number(
    env.CLAUDE_CODE_IDLE_TOKEN_THRESHOLD ?? DEFAULT_IDLE_TOKEN_THRESHOLD,
  )
  return Number.isFinite(n) ? n : DEFAULT_IDLE_TOKEN_THRESHOLD
}

/** Official densable — CLAUDE_CODE_IDLE_THRESHOLD_MINUTES (default 60). */
export function resolveIdleThresholdMinutes(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const n = Number(
    env.CLAUDE_CODE_IDLE_THRESHOLD_MINUTES ?? DEFAULT_IDLE_THRESHOLD_MINUTES,
  )
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_IDLE_THRESHOLD_MINUTES
}

/** Official densable — idle threshold in ms (minutes × 60_000). */
export function resolveIdleThresholdMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  return resolveIdleThresholdMinutes(env) * 60_000
}

/** Official fXr densable — SESSIONEND_HOOKS_TIMEOUT_MS positive or 1500. */
export function resolveSessionEndHooksTimeoutMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env.CLAUDE_CODE_SESSIONEND_HOOKS_TIMEOUT_MS
  const parsed = raw ? parseInt(raw, 10) : NaN
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_SESSIONEND_HOOKS_TIMEOUT_MS
}

/** Official v_g densable — PWSH_PARSE_TIMEOUT_MS positive or 5000. */
export function resolvePwshParseTimeoutMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env.CLAUDE_CODE_PWSH_PARSE_TIMEOUT_MS
  if (raw) {
    const parsed = parseInt(raw, 10)
    if (!Number.isNaN(parsed) && parsed > 0) return parsed
  }
  return DEFAULT_PWSH_PARSE_TIMEOUT_MS
}

/**
 * Official obc densable — API_KEY_HELPER_TTL_MS ≥0 or 300_000.
 * Invalid raw is returned for caller logging; ttl falls back to default.
 */
export function resolveApiKeyHelperTtlMs(
  env: NodeJS.ProcessEnv = process.env,
): { ttlMs: number; invalidRaw?: string } {
  const envTtl = env.CLAUDE_CODE_API_KEY_HELPER_TTL_MS
  if (envTtl) {
    const parsed = parseInt(envTtl, 10)
    if (!Number.isNaN(parsed) && parsed >= 0) {
      return { ttlMs: parsed }
    }
    return { ttlMs: DEFAULT_API_KEY_HELPER_TTL_MS, invalidRaw: envTtl }
  }
  return { ttlMs: DEFAULT_API_KEY_HELPER_TTL_MS }
}

/** Official sbc densable — AWS_CHAIN_RESOLVE_TIMEOUT_MS positive or 60_000. */
export function resolveAwsChainResolveTimeoutMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env.CLAUDE_CODE_AWS_CHAIN_RESOLVE_TIMEOUT_MS
  if (raw) {
    const n = Number(raw)
    if (Number.isFinite(n) && n > 0) return Math.floor(n)
  }
  return DEFAULT_AWS_CHAIN_RESOLVE_TIMEOUT_MS
}

/**
 * Official MCP tool idle densable core (env only; per-server timeout is
 * applied by the caller). Returns null when env disables (≤0).
 */
export function resolveMcpToolIdleTimeoutMs(
  env: NodeJS.ProcessEnv = process.env,
): number | null {
  const envRaw = env.CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT
  if (envRaw !== undefined && envRaw !== '') {
    const parsed = parseInt(envRaw, 10)
    if (!Number.isNaN(parsed)) {
      if (parsed <= 0) return null
      return parsed
    }
  }
  return DEFAULT_MCP_TOOL_IDLE_TIMEOUT_MS
}

export type RemoteAuthFailExitState = {
  firstFailAtMs: number | null
}

export type RemoteAuthFailExitResult = {
  decision: 'continue' | 'exit'
  state: RemoteAuthFailExitState
}

/**
 * Official cjt densable — remote-session auth-fail exit after threshold.
 * Non-remote → continue. recovered clears firstFailAtMs. threshold 0 disables.
 */
export function evaluateRemoteAuthFailExit(
  state: RemoteAuthFailExitState,
  input: {
    env?: NodeJS.ProcessEnv
    nowMs?: number
    thresholdMs?: number
    recovered?: boolean
  } = {},
): RemoteAuthFailExitResult {
  if (input.recovered) {
    return { decision: 'continue', state: { firstFailAtMs: null } }
  }
  const env = input.env ?? process.env
  const isRemote = Boolean(
    env.CLAUDE_CODE_REMOTE_SESSION_ID || env.CLAUDE_CODE_REMOTE,
  )
  if (!isRemote) {
    return { decision: 'continue', state }
  }
  // Must use OrDefault (non-negative): explicit 0 disables zombie exit.
  // resolveAuthFailExitMs rejects 0 via parsePositiveMs and would fall back
  // to DEFAULT, incorrectly re-enabling exit when env says 0.
  const threshold =
    input.thresholdMs ?? resolveAuthFailExitMsOrDefault(env)
  if (threshold <= 0) {
    return { decision: 'continue', state }
  }
  const now = input.nowMs ?? Date.now()
  if (state.firstFailAtMs === null) {
    return {
      decision: 'continue',
      state: { firstFailAtMs: now },
    }
  }
  if (now - state.firstFailAtMs >= threshold) {
    return { decision: 'exit', state }
  }
  return { decision: 'continue', state }
}

/**
 * Official dbc densable — poll until oauth access token rotates away from
 * the failed token (or timeout).
 *
 * Accepts `sleeper`/`nowMs` (call sites + tests) with `sleep`/`now` aliases.
 */
export async function waitForRotatedOauthToken(input: {
  failedAccessToken: string
  timeoutMs: number
  pollMs?: number
  readToken?: () => string | undefined
  sleeper?: (ms: number) => Promise<void>
  sleep?: (ms: number) => Promise<void>
  nowMs?: () => number
  now?: () => number
}): Promise<boolean> {
  const sleep =
    input.sleeper ??
    input.sleep ??
    ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)))
  const now = input.nowMs ?? input.now ?? (() => Date.now())
  const readToken =
    input.readToken ??
    (() => process.env.CLAUDE_CODE_OAUTH_TOKEN || undefined)
  const pollMs = input.pollMs ?? 2_000
  const deadline = now() + input.timeoutMs
  while (now() < deadline) {
    const token = readToken()
    if (token && token !== input.failedAccessToken) return true
    await sleep(Math.min(pollMs, Math.max(1, deadline - now())))
  }
  const finalToken = readToken()
  return Boolean(finalToken && finalToken !== input.failedAccessToken)
}
