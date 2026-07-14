/**
 * Official 2.1.207 host-managed credential file (uLp / mLp / dLp / hj_).
 * Desktop injects CLAUDE_CODE_HOST_CREDS_FILE when PROVIDER_MANAGED_BY_HOST.
 */

import { open as fsOpen } from 'fs/promises'
import { isAbsolute } from 'path'
import { z } from 'zod'
import { logForDebugging } from './debug.js'
import { isEnvTruthy } from './envUtils.js'
import {
  getProcessStartTimeMs,
  isProcessRunning,
} from './genericProcessUtils.js'
import { jsonParse } from './slowOperations.js'

/** Official size cap on host creds file. */
export const HOST_CREDS_MAX_BYTES = 65_536

/** Official gj_ — max |procStart − OS start| ms before rejecting host creds. */
export const HOST_CREDS_PROC_START_DRIFT_MS = 2000

/** Official endpoint-lock keys (zke subset used as sfa). */
export const HOST_CREDS_ENDPOINT_KEYS = new Set([
  'ANTHROPIC_BASE_URL',
  '_CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL',
  'ANTHROPIC_BEDROCK_BASE_URL',
  'ANTHROPIC_VERTEX_BASE_URL',
  'ANTHROPIC_FOUNDRY_BASE_URL',
  'ANTHROPIC_AWS_BASE_URL',
  'ANTHROPIC_BEDROCK_MANTLE_BASE_URL',
  'CLAUDE_CODE_ARTIFACTS_API_BASE_URL',
])

/** Official secret/token keys (tpe). */
export const HOST_CREDS_SECRET_KEYS = new Set([
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'AWS_BEARER_TOKEN_BEDROCK',
  'ANTHROPIC_FOUNDRY_API_KEY',
  'ANTHROPIC_FOUNDRY_AUTH_TOKEN',
  'ANTHROPIC_AWS_API_KEY',
  'ANTHROPIC_BEDROCK_MANTLE_API_KEY',
])

/**
 * Official mj_ — env keys accepted from host creds file.
 * Secrets + endpoints (minus assume-first-party) + custom headers + skip vertex.
 */
export const HOST_CREDS_ALLOWED_ENV_KEYS = new Set([
  ...HOST_CREDS_SECRET_KEYS,
  ...[...HOST_CREDS_ENDPOINT_KEYS].filter(
    k => k !== '_CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL',
  ),
  'ANTHROPIC_CUSTOM_HEADERS',
  'CLAUDE_CODE_SKIP_VERTEX_AUTH',
])

const hostCredsSchema = z.object({
  env: z.record(z.string(), z.string()),
  expiresAt: z
    .union([z.number(), z.string()])
    .pipe(z.coerce.number())
    .nullable()
    .default(null),
  pid: z.number().int(),
  procStart: z.union([z.number(), z.string()]).pipe(z.coerce.number()),
})

export type HostCredsFile = {
  env: Record<string, string>
  expiresAt: number | null
  pid: number
  procStart: number
}

/** Official hj_ parse + mj_ filter (pure). */
export function parseHostCredsPayload(raw: unknown): HostCredsFile | null {
  const parsed = hostCredsSchema.safeParse(raw)
  if (!parsed.success) return null
  if (!Number.isFinite(parsed.data.procStart)) return null
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(parsed.data.env)) {
    if (HOST_CREDS_ALLOWED_ENV_KEYS.has(k)) env[k] = v
  }
  return {
    env,
    expiresAt: parsed.data.expiresAt,
    pid: parsed.data.pid,
    procStart: parsed.data.procStart,
  }
}

/**
 * Split host env into endpoint-lock keys vs mutable secrets/headers.
 * Official mLp first apply.
 */
export function splitHostCredsEnv(env: Record<string, string>): {
  endpoints: Record<string, string>
  rest: Record<string, string>
} {
  const endpoints: Record<string, string> = {}
  const rest: Record<string, string> = {}
  for (const [k, v] of Object.entries(env)) {
    if (HOST_CREDS_ENDPOINT_KEYS.has(k)) endpoints[k] = v
    else rest[k] = v
  }
  return { endpoints, rest }
}

/**
 * Official dLp — replace previously applied host env keys with a new set.
 * Tracks last-applied keys so removed secrets are cleared from process.env.
 */
export function applyHostCredsEnvDiff(
  next: Record<string, string>,
  previouslyApplied: ReadonlySet<string>,
  env: NodeJS.ProcessEnv = process.env,
): Set<string> {
  for (const key of previouslyApplied) {
    if (!(key in next)) {
      delete env[key]
    }
  }
  Object.assign(env, next)
  return new Set(Object.keys(next))
}

/**
 * Reject refresh if any endpoint-lock key changed after first apply
 * (official mLp refresh path).
 */
export function hostCredsEndpointChanged(
  nextEnv: Record<string, string>,
  lockedEndpoints: ReadonlyMap<string, string>,
): string | null {
  for (const [k, v] of lockedEndpoints) {
    if (nextEnv[k] !== undefined && nextEnv[k] !== v) return k
  }
  return null
}

function modeAllowsGroupOrOther(mode: number): boolean {
  // group/other read/write/exec bits (official r.mode & 63)
  return (mode & 0o077) !== 0
}

/**
 * Official uLp — read + validate host creds file.
 * Portable subset: absolute path, size, unix mode/owner, JSON schema, live pid,
 * expiresAt. procStart drift vs OS process start is host-specific and skipped
 * when process start time is unavailable.
 */
export async function readHostCredsFile(
  filePath: string | undefined = process.env.CLAUDE_CODE_HOST_CREDS_FILE,
): Promise<HostCredsFile | null> {
  if (!filePath || !isAbsolute(filePath)) return null

  let handle: Awaited<ReturnType<typeof fsOpen>> | undefined
  try {
    handle = await fsOpen(filePath, 'r')
    const st = await handle.stat()
    if (st.size > HOST_CREDS_MAX_BYTES) return null

    if (process.platform !== 'win32') {
      if (modeAllowsGroupOrOther(st.mode)) {
        logForDebugging(
          'ignoring CLAUDE_CODE_HOST_CREDS_FILE with group/other-readable mode or wrong owner',
          { level: 'warn' },
        )
        return null
      }
      const uid = process.getuid?.()
      if (uid !== undefined && st.uid !== uid) {
        logForDebugging(
          'ignoring CLAUDE_CODE_HOST_CREDS_FILE with group/other-readable mode or wrong owner',
          { level: 'warn' },
        )
        return null
      }
    }

    const text = await handle.readFile({ encoding: 'utf8' })
    let json: unknown
    try {
      json = jsonParse(text)
    } catch {
      return null
    }
    const data = parseHostCredsPayload(json)
    if (!data) return null
    if (!isProcessRunning(data.pid)) return null
    // Official Dmi / gj_: reject when OS process start drifts > 2s from file.
    // Skip when OS start time is unavailable (Windows / ps failure).
    const osStart = await getProcessStartTimeMs(data.pid)
    if (
      osStart !== null &&
      Math.abs(data.procStart - osStart) > HOST_CREDS_PROC_START_DRIFT_MS
    ) {
      return null
    }
    if (data.expiresAt !== null && data.expiresAt < Date.now()) return null
    return data
  } catch (e) {
    logForDebugging(
      `readHostCredsFile failed: ${e instanceof Error ? e.message : String(e)}`,
      { level: 'warn' },
    )
    return null
  } finally {
    await handle?.close().catch(() => {})
  }
}

/** Official Ej_ — max same-token 401 recoveries before hard fail. */
export const HOST_AUTH_401_MAX_SAME_TOKEN = 2

/**
 * Official CLAUDE_CODE_HOST_AUTH_REFRESH_TIMEOUT_MS default (10s).
 * Desktop host refresh can hang; cap the 401 recovery callback.
 */
export const HOST_AUTH_REFRESH_TIMEOUT_MS_DEFAULT = 10_000

/** Official sMo — env var holding the host-injected auth token. */
export function getHostAuthEnvVarName(): string {
  return process.env.CLAUDE_CODE_HOST_AUTH_ENV_VAR || 'ANTHROPIC_AUTH_TOKEN'
}

/**
 * Resolve host-auth refresh timeout from env (ms). Non-positive / invalid → default.
 */
export function getHostAuthRefreshTimeoutMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env.CLAUDE_CODE_HOST_AUTH_REFRESH_TIMEOUT_MS
  if (raw === undefined || raw === '')
    return HOST_AUTH_REFRESH_TIMEOUT_MS_DEFAULT
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return HOST_AUTH_REFRESH_TIMEOUT_MS_DEFAULT
  return Math.floor(n)
}

/**
 * Race a host-auth refresh promise against the configured timeout.
 * On timeout returns null (treated as same-token path under 401 budget).
 */
export async function withHostAuthRefreshTimeout<T>(
  work: Promise<T>,
  timeoutMs: number = getHostAuthRefreshTimeoutMs(),
): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      work,
      new Promise<null>(resolve => {
        timer = setTimeout(() => resolve(null), timeoutMs)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

export type HostAuthTokenRefreshCallback = () => Promise<string | null>

// Module state for host-creds apply + 401 recovery (official afa / Gan / cLp).
let hostAuthTokenRefreshCallback: HostAuthTokenRefreshCallback | null = null
let lockedHostEndpoints: Map<string, string> | null = null
let appliedHostSecretKeys = new Set<string>()
let hostAuth401SameTokenCount = 0

/** Official ASr */
export function setHostAuthTokenRefreshCallback(
  cb: HostAuthTokenRefreshCallback | null,
): void {
  hostAuthTokenRefreshCallback = cb
}

/** Official S$t */
export function getHostAuthTokenRefreshCallback(): HostAuthTokenRefreshCallback | null {
  return hostAuthTokenRefreshCallback
}

/**
 * Official lfa — host auth recovery available when a refresh callback is
 * registered (desktop host-creds path).
 */
export function isHostAuthTokenRefreshAvailable(): boolean {
  return hostAuthTokenRefreshCallback !== null
}

/**
 * Official mLp refresh half (afa) — re-read host creds file, reject endpoint
 * drift, apply secret/header env, return the host auth token value.
 */
export async function refreshHostCredsToken(): Promise<string | null> {
  const data = await readHostCredsFile()
  if (!data) return null

  const { endpoints, rest } = splitHostCredsEnv(data.env)
  if (lockedHostEndpoints) {
    const drifted = hostCredsEndpointChanged(
      { ...endpoints, ...rest },
      lockedHostEndpoints,
    )
    if (drifted) {
      logForDebugging(
        `host-creds refresh rejected: endpoint changed (${drifted})`,
        { level: 'warn' },
      )
      return null
    }
  } else {
    lockedHostEndpoints = new Map(Object.entries(endpoints))
    for (const [k, v] of Object.entries(endpoints)) {
      process.env[k] = v
    }
  }

  appliedHostSecretKeys = applyHostCredsEnvDiff(rest, appliedHostSecretKeys)
  return rest[getHostAuthEnvVarName()] ?? null
}

/**
 * Official host_auth_401_recovery path: invoke refresh callback, update env
 * when token changes. Returns:
 * - `updated` — env rewritten, caller should rebuild client and retry
 * - `same` — callback returned same/null under budget (retry once more)
 * - `exhausted` — same token too many times; caller should fail the request
 * - `unavailable` — no callback registered
 * - `failed` — callback threw
 */
export async function tryHostAuth401Recovery(): Promise<
  'updated' | 'same' | 'exhausted' | 'unavailable' | 'failed'
> {
  const cb = hostAuthTokenRefreshCallback
  if (!cb) return 'unavailable'

  const envVar = getHostAuthEnvVarName()
  const previous = process.env[envVar]
  let next: string | null = null
  try {
    // Official: cap host refresh so a hung desktop callback cannot stall retries.
    const timed = await withHostAuthRefreshTimeout(cb())
    next = timed
  } catch (e) {
    logForDebugging(
      `host getHostAuthToken callback failed: ${e instanceof Error ? e.message : String(e)}`,
      { level: 'error' },
    )
    return 'failed'
  }

  if (next && next !== previous) {
    process.env[envVar] = next
    hostAuth401SameTokenCount = 0
    logForDebugging('host_auth_401_recovery: token updated')
    return 'updated'
  }

  hostAuth401SameTokenCount++
  if (hostAuth401SameTokenCount >= HOST_AUTH_401_MAX_SAME_TOKEN) {
    logForDebugging(
      next === null
        ? 'host_auth_401_recovery: callback returned null (exhausted)'
        : 'host_auth_401_recovery: callback returned same token (exhausted)',
      { level: 'error' },
    )
    return 'exhausted'
  }
  return 'same'
}

/**
 * Official mLp bootstrap — when host-managed + creds file set, apply env and
 * register the 401 refresh callback (ASr(afa)).
 */
export async function applyHostCredsFromFileIfManaged(): Promise<Record<
  string,
  string
> | null> {
  // Official mLp: skip if a host auth refresh callback is already installed.
  if (hostAuthTokenRefreshCallback) return null
  // Official PROVIDER_MANAGED_BY_HOST densable.
  let providerManagedByHost = isEnvTruthy(
    process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST,
  )
  try {
    const { isProviderManagedByHostEnvEnabled } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./residualFinalEnvGates.js') as typeof import('./residualFinalEnvGates.js')
    providerManagedByHost = isProviderManagedByHostEnvEnabled()
  } catch {
    // keep raw env fallback
  }
  if (!providerManagedByHost) {
    return null
  }
  if (!process.env.CLAUDE_CODE_HOST_CREDS_FILE) return null

  const data = await readHostCredsFile()
  if (!data) {
    logForDebugging(
      `CLAUDE_CODE_HOST_CREDS_FILE is set (${process.env.CLAUDE_CODE_HOST_CREDS_FILE}) but no usable host credentials were read`,
      { level: 'warn' },
    )
    return null
  }

  const { endpoints, rest } = splitHostCredsEnv(data.env)
  lockedHostEndpoints = new Map(Object.entries(endpoints))
  for (const [k, v] of Object.entries(endpoints)) {
    process.env[k] = v
  }
  appliedHostSecretKeys = applyHostCredsEnvDiff(rest, appliedHostSecretKeys)
  setHostAuthTokenRefreshCallback(refreshHostCredsToken)
  // Official CLAUDE_CODE_SDK_HAS_HOST_AUTH_REFRESH — mark host 401 refresh path.
  process.env.CLAUDE_CODE_SDK_HAS_HOST_AUTH_REFRESH = '1'
  return rest
}

/** Test helper — reset module state between cases. */
export function resetHostCredsModuleStateForTests(): void {
  hostAuthTokenRefreshCallback = null
  lockedHostEndpoints = null
  appliedHostSecretKeys = new Set()
  hostAuth401SameTokenCount = 0
}
