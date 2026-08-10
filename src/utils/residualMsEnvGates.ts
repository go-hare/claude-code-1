/**
 * Official residual positive-integer ms env gates (portable parsers).
 * Invalid/missing → undefined (caller keeps default).
 * densable 2.1.211: scientific notation + digit separators via parsePositiveEnvInt.
 */

import { parseEnvInt, parsePositiveEnvInt } from './envUtils.js'

function parsePositiveMs(raw: string | undefined): number | undefined {
  return parsePositiveEnvInt(raw)
}

/** Official cjt default: 10 minutes. */
export const DEFAULT_AUTH_FAIL_EXIT_MS = 600_000
/** Official W1n / Jeh default. */
export const DEFAULT_USER_DIALOG_TIMEOUT_MS = 300_000
/** Official Svf / PARKED_PERMISSION_ANSWER_WAIT_MS default. */
export const DEFAULT_PARKED_PERMISSION_WAIT_MS = 2_000
/** Official ZEf default. */
export const DEFAULT_TEAM_TEARDOWN_PARK_TIMEOUT_MS = 10_000
/** Official XTh remote-session default when env unset. */
export const DEFAULT_OAUTH_401_WAIT_REMOTE_MS = 60_000

export function resolveAuthFailExitMs(
  env: NodeJS.ProcessEnv = process.env,
): number | undefined {
  return parsePositiveMs(env.CLAUDE_CODE_AUTH_FAIL_EXIT_MS)
}

/**
 * Official cjt threshold: env CLAUDE_CODE_AUTH_FAIL_EXIT_MS or 600_000.
 * Raw 0 disables the zombie-exit kill switch.
 */
export function resolveAuthFailExitMsOrDefault(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env.CLAUDE_CODE_AUTH_FAIL_EXIT_MS
  if (raw === undefined || raw === '') return DEFAULT_AUTH_FAIL_EXIT_MS
  // densable: raw 0 disables the zombie-exit kill switch (allow non-positive).
  return parseEnvInt(raw, DEFAULT_AUTH_FAIL_EXIT_MS)
}

export function resolveUserDialogTimeoutMs(
  env: NodeJS.ProcessEnv = process.env,
): number | undefined {
  return parsePositiveMs(env.CLAUDE_CODE_USER_DIALOG_TIMEOUT_MS)
}

/** Official W1n — USER_DIALOG_TIMEOUT_MS ?? 300_000. */
export function resolveUserDialogTimeoutMsOrDefault(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env.CLAUDE_CODE_USER_DIALOG_TIMEOUT_MS
  if (raw === undefined || raw === '') return DEFAULT_USER_DIALOG_TIMEOUT_MS
  return parseEnvInt(raw, DEFAULT_USER_DIALOG_TIMEOUT_MS)
}

export function resolveParkedPermissionWaitMs(
  env: NodeJS.ProcessEnv = process.env,
): number | undefined {
  return parsePositiveMs(env.CLAUDE_CODE_PARKED_PERMISSION_WAIT_MS)
}

/** Official Svf — PARKED_PERMISSION_WAIT_MS ?? 2000. */
export function resolveParkedPermissionWaitMsOrDefault(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env.CLAUDE_CODE_PARKED_PERMISSION_WAIT_MS
  if (raw === undefined || raw === '') return DEFAULT_PARKED_PERMISSION_WAIT_MS
  return parseEnvInt(raw, DEFAULT_PARKED_PERMISSION_WAIT_MS)
}

export function resolveOauth401WaitMs(
  env: NodeJS.ProcessEnv = process.env,
): number | undefined {
  return parsePositiveMs(env.CLAUDE_CODE_OAUTH_401_WAIT_MS)
}

/**
 * Official XTh — CLAUDE_CODE_OAUTH_401_WAIT_MS if set (incl. 0);
 * else remote session → 60_000, else 0.
 */
export function resolveOauth401WaitMsOrDefault(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env.CLAUDE_CODE_OAUTH_401_WAIT_MS
  if (raw !== undefined) {
    // densable: raw present including 0 / scientific / underscore
    return parseEnvInt(raw, 0)
  }
  return env.CLAUDE_CODE_REMOTE_SESSION_ID
    ? DEFAULT_OAUTH_401_WAIT_REMOTE_MS
    : 0
}

export function resolveTeamTeardownParkTimeoutMs(
  env: NodeJS.ProcessEnv = process.env,
): number | undefined {
  return parsePositiveMs(env.CLAUDE_CODE_TEAM_TEARDOWN_PARK_TIMEOUT_MS)
}

/** Official ZEf — TEAM_TEARDOWN_PARK_TIMEOUT_MS ?? 10_000. */
export function resolveTeamTeardownParkTimeoutMsOrDefault(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env.CLAUDE_CODE_TEAM_TEARDOWN_PARK_TIMEOUT_MS
  if (raw === undefined || raw === '') {
    return DEFAULT_TEAM_TEARDOWN_PARK_TIMEOUT_MS
  }
  return parseEnvInt(raw, DEFAULT_TEAM_TEARDOWN_PARK_TIMEOUT_MS)
}

export type AuthFailExitDecision = 'continue' | 'exit'

export type AuthFailExitState = {
  firstFailAtMs: number | null
}

/**
 * Official cjt densable — remote-child unrecovered OAuth 401 zombie-exit gate.
 * recovered → clear + continue; non-remote → continue; threshold≤0 → continue;
 * first fail records timestamp; subsequent past threshold → exit.
 */
export function evaluateRemoteAuthFailExit(
  state: AuthFailExitState,
  input: {
    recovered?: boolean
    nowMs?: number
    isRemoteChild?: boolean
    thresholdMs?: number
    env?: NodeJS.ProcessEnv
  } = {},
): { decision: AuthFailExitDecision; state: AuthFailExitState } {
  const env = input.env ?? process.env
  if (input.recovered) {
    return { decision: 'continue', state: { firstFailAtMs: null } }
  }
  const isRemote =
    input.isRemoteChild ?? Boolean(env.CLAUDE_CODE_REMOTE_SESSION_ID)
  if (!isRemote) {
    return { decision: 'continue', state }
  }
  const threshold = input.thresholdMs ?? resolveAuthFailExitMsOrDefault(env)
  if (threshold <= 0) {
    return { decision: 'continue', state }
  }
  const now = input.nowMs ?? Date.now()
  if (state.firstFailAtMs === null) {
    return { decision: 'continue', state: { firstFailAtMs: now } }
  }
  if (now - state.firstFailAtMs >= threshold) {
    return { decision: 'exit', state }
  }
  return { decision: 'continue', state }
}

/**
 * Official dbc densable — poll until env/FD OAuth token rotates away from
 * the failed access token, or timeout elapses.
 */
export async function waitForRotatedOauthToken(input: {
  failedAccessToken: string
  timeoutMs: number
  readToken?: () => string | undefined
  sleeper?: (ms: number) => Promise<void>
  pollMs?: number
  nowMs?: () => number
}): Promise<boolean> {
  const pollMs = input.pollMs ?? 2_000
  const readToken =
    input.readToken ?? (() => process.env.CLAUDE_CODE_OAUTH_TOKEN || undefined)
  const sleeper =
    input.sleeper ??
    ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)))
  const now = input.nowMs ?? Date.now
  const deadline = now() + input.timeoutMs
  while (now() < deadline) {
    const token = readToken()
    if (token && token !== input.failedAccessToken) return true
    await sleeper(Math.min(pollMs, Math.max(1, deadline - now())))
  }
  const finalToken = readToken()
  return Boolean(finalToken && finalToken !== input.failedAccessToken)
}

/** Official Vuy default tool concurrency. */
export const DEFAULT_MAX_TOOL_USE_CONCURRENCY = 10

/**
 * Official Vuy densable — CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY, positive int
 * or default 10.
 */
export function resolveMaxToolUseConcurrency(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const n = parseInt(env.CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY || '', 10)
  return n > 0 ? n : DEFAULT_MAX_TOOL_USE_CONCURRENCY
}

/** Official stop-hook consecutive block cap default. */
export const DEFAULT_STOP_HOOK_BLOCK_CAP = 8

/**
 * Official densable — CLAUDE_CODE_STOP_HOOK_BLOCK_CAP, NaN → 8.
 * Cap of 0 disables the consecutive-block kill switch (official eo>0 check).
 */
export function resolveStopHookBlockCap(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const n = parseInt(env.CLAUDE_CODE_STOP_HOOK_BLOCK_CAP ?? '', 10)
  return Number.isNaN(n) ? DEFAULT_STOP_HOOK_BLOCK_CAP : n
}

/** Official idle-return default: 75 minutes. */
export const DEFAULT_IDLE_THRESHOLD_MINUTES = 75
/** Official idle-return default: 100_000 tokens. */
export const DEFAULT_IDLE_TOKEN_THRESHOLD = 100_000

/**
 * Official densable — CLAUDE_CODE_IDLE_THRESHOLD_MINUTES (default 75).
 * Used by willow idle-return dialog / hint timers.
 */
export function resolveIdleThresholdMinutes(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const n = Number(
    env.CLAUDE_CODE_IDLE_THRESHOLD_MINUTES ?? DEFAULT_IDLE_THRESHOLD_MINUTES,
  )
  return Number.isFinite(n) ? n : DEFAULT_IDLE_THRESHOLD_MINUTES
}

export function resolveIdleThresholdMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  return resolveIdleThresholdMinutes(env) * 60_000
}

/**
 * Official densable — CLAUDE_CODE_IDLE_TOKEN_THRESHOLD (default 100_000).
 */
export function resolveIdleTokenThreshold(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const n = Number(
    env.CLAUDE_CODE_IDLE_TOKEN_THRESHOLD ?? DEFAULT_IDLE_TOKEN_THRESHOLD,
  )
  return Number.isFinite(n) ? n : DEFAULT_IDLE_TOKEN_THRESHOLD
}

/** Official SessionEnd hooks default timeout. */
export const DEFAULT_SESSIONEND_HOOKS_TIMEOUT_MS = 1_500
/** Official PowerShell parse default timeout. */
export const DEFAULT_PWSH_PARSE_TIMEOUT_MS = 5_000
/** Official API key helper TTL default. */
export const DEFAULT_API_KEY_HELPER_TTL_MS = 5 * 60 * 1000
/** Official AWS default-chain resolve stall guard. */
export const DEFAULT_AWS_CHAIN_RESOLVE_TIMEOUT_MS = 60_000
/** Official MCP tool idle watchdog default. */
export const DEFAULT_MCP_TOOL_IDLE_TIMEOUT_MS = 5 * 60 * 1000

/**
 * Official fXr densable — SESSIONEND_HOOKS_TIMEOUT_MS positive or 1500.
 */
export function resolveSessionEndHooksTimeoutMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env.CLAUDE_CODE_SESSIONEND_HOOKS_TIMEOUT_MS
  const parsed = raw ? parseInt(raw, 10) : NaN
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_SESSIONEND_HOOKS_TIMEOUT_MS
}

/**
 * Official v_g densable — PWSH_PARSE_TIMEOUT_MS positive or 5000.
 */
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
 * Invalid logs via caller; returns default.
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

/**
 * Official sbc densable — AWS_CHAIN_RESOLVE_TIMEOUT_MS positive or 60_000.
 */
export function resolveAwsChainResolveTimeoutMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env.CLAUDE_CODE_AWS_CHAIN_RESOLVE_TIMEOUT_MS
  if (raw) {
    const n = Number(raw)
    if (Number.isFinite(n) && n > 0) return n
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
