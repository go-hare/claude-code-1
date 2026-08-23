/**
 * densable 2.1.224 self-hosted-runner orchestrator (ZFh / Iqv / jFh / XFh / bFh).
 * 1:1 from SEA — spawn-hints poll + external spawn-runner hook.
 *
 * Landed residual: kFh SCM tunnel, JFh healthz, YFh/UFh/qFh metrics.
 * Process-tree kill: spawn path uses SIGTERM/-pid + SIGKILL grace (Grr);
 * full Ane/VE_ lives in gitPrepare.killProcessTree for git children.
 */
import { createServer, type Server } from 'node:http'
import { spawn } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import {
  access,
  constants as fsConstants,
  mkdir,
  open,
  readdir,
  readFile,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { hostname as osHostname, tmpdir } from 'node:os'
import { join, resolve as pathResolve } from 'node:path'
import {
  assertSafeId,
  classifyRunnerError,
  createSelfHostedRunnerApi,
  emptyRunnerErrorCounts,
  getHttpStatusFromError,
  resolveRunnerVersion,
  type SelfHostedRunnerApi,
  type SpawnHint,
} from './runnerApi.js'
import { parseDenseInt, redactLogText, withTimeoutMs } from './rootRunner.js'
import { assertOrchestratorProxyAuthUnset } from './egressProxyAuth.js'
import {
  startScmConnector,
  type ScmConnectorConfig as ScmTunnelConfig,
  type ScmConnectorHandle,
  type ScmConnectorHealth,
} from './scmConnector.js'

// ── densable constants ────────────────────────────────────────────────────────

/** densable `LFh` */
export const ORCH_DEFAULT_API_URL = 'https://api.anthropic.com'
/** densable `NFh` */
export const ORCH_DEFAULT_HEALTH_PORT = 8080
/** densable `$Fh` */
export const ORCH_DEFAULT_HOOK_CONCURRENCY = 4
/** densable `FFh` */
export const ORCH_DEFAULT_HOOK_TIMEOUT_MS = 60_000
/** densable `BFh` */
export const ORCH_DEFAULT_EXPECTED_SPAWN_SECONDS = 120
/** densable `Tqv` */
export const ORCH_SECRET_READ_TIMEOUT_MS = 10_000
/** densable `Eqv` */
export const ORCH_POLL_INTERVAL_MS = 5_000
/** densable `PFh` / `wqv` — poll error backoff */
export const ORCH_POLL_BACKOFF_INITIAL_MS = 1_000
export const ORCH_POLL_BACKOFF_MAX_MS = 30_000
/** densable `Grr` — SIGKILL grace after SIGTERM */
export const ORCH_SIGKILL_GRACE_MS = 5_000
/** densable `vqv` — clock skew warn threshold */
export const ORCH_CLOCK_SKEW_WARN_MS = 60_000
/** densable `Cqv` */
export const ORCH_FATAL_HTTP = new Set([400, 401, 403, 404, 426])
/** densable `oqv` — debug-dir prune age */
export const ORCH_DEBUG_PRUNE_MS = 300_000
/** densable `IFh` — /healthz EADDRINUSE retry delay */
export const ORCH_HEALTH_ADDRINUSE_RETRY_MS = 1_500
/** densable `fGr` — spawn-hook duration histogram buckets (seconds) */
export const ORCH_SPAWN_HOOK_DURATION_BUCKETS = [
  0.1, 0.25, 0.5, 1, 2.5, 5, 10, 20, 30, 60,
] as const
/** densable `mGr` — session queue-wait histogram buckets (seconds) */
export const ORCH_SESSION_QUEUE_WAIT_BUCKETS = [
  0.5, 1, 2.5, 5, 10, 20, 40, 80, 160, 320, 640, 1280, 2560, 5120,
] as const
/** densable `HUi` — poll error kind series (stable order for Prometheus) */
export const ORCH_POLL_ERROR_KINDS = [
  'transport',
  'timeout',
  '5xx',
  '429',
  '4xx',
] as const

export type ScmConnectorConfig = {
  host: string
  port: number
  provider: string
  connectorId: number
  caFile?: string
  hostRewrite?: { from: string; toHost: string; toPort: number }
}

/** densable histogram accumulator (UFh / qFh) */
export type OrchHistogram = {
  buckets: number[]
  count: number
  sum: number
}

/** densable `RFh` */
export function emptyScmConnectorHealth(): ScmConnectorHealth {
  return {
    connected: false,
    last_connected_at: null,
    last_error: null,
    reconnects: 0,
    requests_forwarded: 0,
  }
}

/** densable `UFh` */
export function emptySpawnHookDurations(): OrchHistogram {
  return {
    buckets: ORCH_SPAWN_HOOK_DURATION_BUCKETS.map(() => 0),
    count: 0,
    sum: 0,
  }
}

/** densable `qFh` */
export function emptySessionQueueWaits(): OrchHistogram {
  return {
    buckets: ORCH_SESSION_QUEUE_WAIT_BUCKETS.map(() => 0),
    count: 0,
    sum: 0,
  }
}

/** densable `Aqv` */
export function observeSpawnHookDuration(
  h: OrchHistogram,
  seconds: number,
): void {
  h.sum += seconds
  h.count += 1
  for (let i = 0; i < ORCH_SPAWN_HOOK_DURATION_BUCKETS.length; i++) {
    if (seconds <= ORCH_SPAWN_HOOK_DURATION_BUCKETS[i]!) h.buckets[i]!++
  }
}

/** densable `Rqv` */
export function observeSessionQueueWait(
  h: OrchHistogram,
  seconds: number,
): void {
  const v = Math.max(0, seconds)
  h.sum += v
  h.count += 1
  for (let i = 0; i < ORCH_SESSION_QUEUE_WAIT_BUCKETS.length; i++) {
    if (v <= ORCH_SESSION_QUEUE_WAIT_BUCKETS[i]!) h.buckets[i]!++
  }
}

/** densable `wme` — Prometheus label escape */
export function escapePromLabel(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')
}

export type OrchestratorArgs = {
  apiUrl: string
  hooksDir: string | undefined
  healthPort: number
  hookConcurrency: number
  hookTimeoutMs: number
  expectedSpawnSeconds: number
  minIdle: number
  debugDir: string | undefined
  logLevel: string
  poolSecretFile: string | undefined
  scmConnector?: ScmConnectorConfig
}

export type SpawnHintClaims = {
  jti: string
  session_id: string
  attempt: number
  pool_id: string
  account_id: string
  account_email: string
  server_time: string
  repo_sources: Array<{ url: string; revision: string }>
  primary_repo_url: string
  primary_repo_revision: string
  correlation_id: string
}

export type HookRunResult = {
  ok: boolean
  exitCode: number | null
  timedOut: boolean
  execError: boolean
  stderrTail: string
  durationMs: number
}

// ── small helpers ────────────────────────────────────────────────────────────

function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

/** densable `NUi` — control chars (reject on claims / path validation) */
export function hasControlChars(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 32 || (c >= 127 && c <= 159) || c === 8232 || c === 8233) {
      return true
    }
  }
  return false
}

/**
 * densable log clean: drop C0 except TAB/LF/CR, plus DEL.
 * Equivalent to `/[\x00-\x08\x0b-\x1f\x7f]/g` without a control-char regex
 * (Biome `noControlCharactersInRegex`).
 */
export function stripControlCharsForLog(s: string): string {
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if ((c >= 0 && c <= 8) || (c >= 11 && c <= 31) || c === 127) continue
    out += s[i]!
  }
  return out
}

/** densable `g2` — safe git revision */
export function isSafeGitRevision(ref: string): boolean {
  if (!ref || ref.startsWith('-') || ref.startsWith('/')) return false
  if (ref.includes('..')) return false
  if (ref.split('/').some(p => p === '.' || p === '')) return false
  return /^[a-zA-Z0-9/._+@-]+$/.test(ref)
}

/** densable `Nbn` — safe git URL shape */
export function isSafeGitUrl(url: string): boolean {
  return (
    url.startsWith('https://') ||
    url.startsWith('http://') ||
    url.startsWith('ssh://') ||
    (!url.includes('://') && /^[A-Za-z0-9][A-Za-z0-9._-]*@[^:]+:/.test(url))
  )
}

/** densable `jpt` — JWT payload decode (no verify) */
export function decodeJwtPayloadObject(
  token: string,
): Record<string, unknown> | null {
  const stripped = token.replace(/^sk-ant-[a-z]+-/, '')
  const parts = stripped.split('.')
  if (parts.length < 2) return null
  try {
    const b64 = parts[1]!.replace(/-/g, '+').replace(/_/g, '/')
    const pad = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
    const json = JSON.parse(Buffer.from(pad, 'base64').toString('utf8'))
    return json !== null && typeof json === 'object'
      ? (json as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

/** densable `GFh` — coerce attempt to number when numeric string */
export function coerceAttempt(value: unknown): number | string {
  if (value === undefined || value === null) return 0
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    return /^(0|[1-9]\d{0,14})$/.test(value) ? Number(value) : value
  }
  return String(value)
}

/** densable `HJl` */
export function parseScmConnectorHost(raw: string): {
  host: string
  port: number
} {
  if (raw.includes('://') || raw.includes('/') || raw.includes('@')) {
    throw new Error(
      '--scm-connector-host expects a bare hostname (e.g. ghe.example.com[:443]), not a URL',
    )
  }
  const lastColon = raw.lastIndexOf(':')
  const isV6 = raw.startsWith('[')
  let host: string
  let port = 443
  if (lastColon > 0 && (!isV6 || (isV6 && raw[lastColon - 1] === ']'))) {
    host = raw.slice(0, lastColon)
    const portRaw = raw.slice(lastColon + 1)
    const p = parseInt(portRaw, 10)
    if (Number.isNaN(p) || p < 1 || p > 65535 || String(p) !== portRaw) {
      throw new Error(
        '--scm-connector-host port must be an integer in [1, 65535]',
      )
    }
    port = p
  } else {
    host = raw
  }
  if (host.length === 0) {
    throw new Error('--scm-connector-host: hostname is empty')
  }
  if (host.includes(':') && !(host.startsWith('[') && host.endsWith(']'))) {
    throw new Error(
      '--scm-connector-host: hostname must be a bare hostname or [v6] literal',
    )
  }
  return { host, port }
}

/** densable `AFh` (scm rewrite) */
export function parseScmHostRewrite(raw: string): {
  from: string
  toHost: string
  toPort: number
} {
  const eq = raw.indexOf('=')
  if (eq <= 0 || eq === raw.length - 1) {
    throw new Error(
      '--scm-connector-host-rewrite requires <from>=<to_host:to_port>',
    )
  }
  const from = raw.slice(0, eq).toLowerCase()
  const to = raw.slice(eq + 1)
  for (const s of [from, to]) {
    if (s.includes('://') || s.includes('/') || s.includes('@')) {
      throw new Error(
        '--scm-connector-host-rewrite expects bare hostnames, not URLs',
      )
    }
  }
  const { host, port } = parseScmConnectorHost(to)
  return { from, toHost: host, toPort: port }
}

function parseHealthPortEnv(
  raw: string | undefined,
  fallback: number,
  envName: string,
): number {
  if (raw === undefined || raw === '') return fallback
  const n = parseDenseInt(raw)
  if (Number.isNaN(n) || n < 0 || n > 65535) {
    throw new Error(
      `${envName} must be an integer in [0, 65535], got: "${raw}"`,
    )
  }
  return n
}

function sleepMs(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve()
  return new Promise(resolve => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t)
        resolve()
      },
      { once: true },
    )
  })
}

// ── parseArgs (jFh) ──────────────────────────────────────────────────────────

/** densable `jFh` */
export function parseOrchestratorArgs(argv: string[]): OrchestratorArgs {
  const t: OrchestratorArgs = {
    apiUrl: ORCH_DEFAULT_API_URL,
    hooksDir: process.env.SELF_HOSTED_RUNNER_HOOKS_DIR
      ? pathResolve(process.env.SELF_HOSTED_RUNNER_HOOKS_DIR)
      : undefined,
    healthPort: parseHealthPortEnv(
      process.env.SELF_HOSTED_RUNNER_HEALTH_PORT,
      ORCH_DEFAULT_HEALTH_PORT,
      'SELF_HOSTED_RUNNER_HEALTH_PORT',
    ),
    hookConcurrency: ORCH_DEFAULT_HOOK_CONCURRENCY,
    hookTimeoutMs: ORCH_DEFAULT_HOOK_TIMEOUT_MS,
    expectedSpawnSeconds: ORCH_DEFAULT_EXPECTED_SPAWN_SECONDS,
    minIdle: 0,
    debugDir: process.env.SELF_HOSTED_RUNNER_DEBUG_DIR,
    logLevel: 'info',
    poolSecretFile: undefined,
  }

  let scmHost: { host: string; port: number } | undefined
  let scmId: number | undefined
  let scmProvider = 'ghe'
  let scmProviderSet = false
  let scmCa: string | undefined
  let scmRewrite: { from: string; toHost: string; toPort: number } | undefined

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    const val = argv[i + 1]
    switch (flag) {
      case '--api-url':
        if (val) {
          t.apiUrl = val
          i++
        }
        break
      case '--pool-secret-file':
      case '--environment-secret-file':
        if (flag === '--pool-secret-file') {
          console.error(
            '[runner:warn] --pool-secret-file is deprecated; use --environment-secret-file',
          )
        }
        if (val) {
          t.poolSecretFile = val
          i++
        }
        break
      case '--hooks-dir':
        if (val) {
          t.hooksDir = pathResolve(val)
          i++
        }
        break
      case '--health-port':
        if (val) {
          const d = parseDenseInt(val)
          if (Number.isNaN(d) || d < 0 || d > 65535) {
            throw new Error(
              `--health-port must be an integer in [0, 65535] (0 disables), got: ${val}`,
            )
          }
          t.healthPort = d
          i++
        }
        break
      case '--hook-concurrency':
        if (val) {
          const d = parseDenseInt(val)
          if (Number.isNaN(d) || d < 1 || d > 100) {
            throw new Error(
              `--hook-concurrency must be an integer in [1, 100], got: ${val}`,
            )
          }
          t.hookConcurrency = d
          i++
        }
        break
      case '--hook-timeout':
        if (val) {
          const d = Number(val)
          if (!Number.isFinite(d) || d <= 0) {
            throw new Error(
              `--hook-timeout must be a positive number of seconds, got: ${val}`,
            )
          }
          t.hookTimeoutMs = d * 1000
          i++
        }
        break
      case '--expected-spawn-seconds':
        if (val) {
          const d = parseInt(val, 10)
          if (
            Number.isNaN(d) ||
            d < 10 ||
            d > 3600 ||
            String(d) !== val.trim()
          ) {
            throw new Error(
              `--expected-spawn-seconds must be an integer in [10, 3600], got: ${val}`,
            )
          }
          t.expectedSpawnSeconds = d
          i++
        }
        break
      case '--min-idle':
        if (val) {
          const d = parseInt(val, 10)
          if (Number.isNaN(d) || d < 0 || d > 100 || String(d) !== val.trim()) {
            throw new Error('--min-idle must be an integer in [0, 100]')
          }
          t.minIdle = d
          i++
        }
        break
      case '--scm-connector-host':
        if (!val) throw new Error('--scm-connector-host requires HOST[:PORT]')
        scmHost = parseScmConnectorHost(val)
        i++
        break
      case '--scm-connector-id': {
        if (!val) throw new Error('--scm-connector-id requires an integer')
        const d = parseInt(val, 10)
        if (Number.isNaN(d) || d < 1 || String(d) !== val.trim()) {
          throw new Error('--scm-connector-id must be a positive integer')
        }
        scmId = d
        i++
        break
      }
      case '--scm-connector-provider':
        if (!val) throw new Error('--scm-connector-provider requires a value')
        if (!/^[a-z0-9-]{1,32}$/.test(val)) {
          throw new Error(
            '--scm-connector-provider must match ^[a-z0-9-]{1,32}$',
          )
        }
        scmProvider = val
        scmProviderSet = true
        i++
        break
      case '--scm-connector-ca-file':
        if (!val) throw new Error('--scm-connector-ca-file requires a path')
        scmCa = val
        i++
        break
      case '--scm-connector-host-rewrite':
        if (!val) {
          throw new Error(
            '--scm-connector-host-rewrite requires <from>=<to_host:to_port>',
          )
        }
        scmRewrite = parseScmHostRewrite(val)
        i++
        break
      case '--debug-dir':
        if (val) {
          t.debugDir = val
          i++
        }
        break
      case '--log-level':
        if (val) {
          t.logLevel = val
          i++
        }
        break
      default:
        if (flag?.startsWith('--')) throw new Error(`unknown flag ${flag}`)
        break
    }
  }

  if (scmHost !== undefined) {
    if (scmId === undefined) {
      throw new Error(
        '--scm-connector-id is required when --scm-connector-host is set',
      )
    }
    t.scmConnector = {
      host: scmHost.host,
      port: scmHost.port,
      provider: scmProvider,
      connectorId: scmId,
      caFile: scmCa,
      hostRewrite: scmRewrite,
    }
  } else if (
    scmId !== undefined ||
    scmProviderSet ||
    scmCa !== undefined ||
    scmRewrite !== undefined
  ) {
    throw new Error(
      '--scm-connector-id / --scm-connector-provider / --scm-connector-ca-file / --scm-connector-host-rewrite require --scm-connector-host',
    )
  }

  if (
    t.hookTimeoutMs + ORCH_SIGKILL_GRACE_MS >=
    t.expectedSpawnSeconds * 1000
  ) {
    throw new Error(
      `--hook-timeout (${t.hookTimeoutMs / 1000}s) + ${ORCH_SIGKILL_GRACE_MS / 1000}s SIGKILL grace must be less than --expected-spawn-seconds (${t.expectedSpawnSeconds}s) — otherwise an HA replica ` +
        're-claims the lease while this hook is still running and both spawn a runner',
    )
  }
  return t
}

/** densable `zFh` */
export async function validateSpawnRunnerHook(
  hooksDir: string | undefined,
): Promise<string> {
  if (!hooksDir) {
    throw new Error(
      'orchestrator requires --hooks-dir (or SELF_HOSTED_RUNNER_HOOKS_DIR) — no spawn-runner hook directory configured',
    )
  }
  const hookPath = join(hooksDir, 'spawn-runner')
  let st: Awaited<ReturnType<typeof stat>>
  try {
    st = await withTimeoutMs(stat(hookPath), 5000, `stat ${hookPath}`)
  } catch (err) {
    throw new Error(
      `spawn-runner hook not found at ${hookPath} — the orchestrator cannot start without it (${errMsg(err)})`,
    )
  }
  if (!st.isFile()) {
    throw new Error(`spawn-runner hook at ${hookPath} is not a regular file`)
  }
  try {
    await withTimeoutMs(
      access(hookPath, fsConstants.X_OK),
      5000,
      `access ${hookPath}`,
    )
  } catch {
    throw new Error(
      `spawn-runner hook at ${hookPath} is not executable (chmod +x ${hookPath})`,
    )
  }
  return hookPath
}

/** densable `WFh` — pool_id from JWT `ccr:pool_id` */
export function extractPoolIdFromSecret(secret: string): string {
  const payload = decodeJwtPayloadObject(secret)
  const n =
    payload !== null && typeof payload === 'object'
      ? payload['ccr:pool_id']
      : undefined
  if (typeof n !== 'string' || n === '') {
    throw new Error(
      'environment secret is missing the ccr:pool_id claim — cannot derive pool_id for spawn-hint polling',
    )
  }
  return n
}

/** densable `VFh` — claims from spawn hint */
export function extractSpawnHintClaims(
  hint: SpawnHint,
  serverTime?: string | null,
): SpawnHintClaims {
  const payload = decodeJwtPayloadObject(hint.work_order_jwt) ?? {}
  const str = (k: string): string =>
    typeof payload[k] === 'string' ? (payload[k] as string) : ''
  const aud = payload.aud
  const audStr = Array.isArray(aud)
    ? ((aud.find(x => typeof x === 'string') as string | undefined) ?? '')
    : typeof aud === 'string'
      ? aud
      : ''
  const poolId =
    str('ccr:pool_id') || (audStr.startsWith('ccpool_') ? audStr : '')
  const sources = (
    (hint.sources as Array<{ url?: string; revision?: string }>) ?? []
  ).map(s => ({
    url: s.url ?? '',
    revision: s.revision ?? '',
  }))
  const attempt = coerceAttempt(hint.attempt)
  return {
    jti: String(hint.jti || str('jti') || ''),
    session_id: String(hint.session_uuid ?? ''),
    attempt: typeof attempt === 'number' ? attempt : Number(attempt) || 0,
    pool_id: poolId,
    account_id: str('ccr:spawn_account_id') || str('account_id'),
    account_email: str('ccr:spawn_account_email') || str('account_email'),
    server_time: serverTime ?? '',
    repo_sources: sources,
    primary_repo_url: sources[0]?.url ?? '',
    primary_repo_revision: sources[0]?.revision ?? '',
    correlation_id:
      typeof hint.correlation_id === 'string' ? hint.correlation_id : '',
  }
}

/** densable `KFh` — clock skew ms (server_date - now is inverted: now - parse) */
export function clockSkewMs(
  serverDate: string | null | undefined,
  nowMs: number = Date.now(),
): number | null {
  if (!serverDate) return null
  const r = Date.parse(serverDate)
  if (Number.isNaN(r)) return null
  return nowMs - r
}

/** densable `QFh` */
export async function resolveOrchestratorPoolSecret(
  args: Pick<OrchestratorArgs, 'poolSecretFile'>,
): Promise<string> {
  if (args.poolSecretFile) {
    const n = await withTimeoutMs(
      readFile(args.poolSecretFile, { encoding: 'utf-8' }),
      ORCH_SECRET_READ_TIMEOUT_MS,
      `environment-secret read from ${args.poolSecretFile}`,
    )
    return n.trim()
  }
  const t = process.env.SELF_HOSTED_RUNNER_ENVIRONMENT_SECRET
  if (t) return t.trim()
  const r = process.env.SELF_HOSTED_RUNNER_POOL_SECRET
  if (r) {
    console.error(
      '[runner:warn] SELF_HOSTED_RUNNER_POOL_SECRET is deprecated; use SELF_HOSTED_RUNNER_ENVIRONMENT_SECRET',
    )
    return r.trim()
  }
  throw new Error(
    'No environment secret provided. Use --environment-secret-file or set SELF_HOSTED_RUNNER_ENVIRONMENT_SECRET.',
  )
}

/** densable `iqv` — write work-order JWT to temp file mode 0600 */
export async function writeWorkOrderFile(
  label: string,
  jwt: string,
): Promise<string> {
  const path = join(tmpdir(), `${label}-${randomBytes(6).toString('hex')}`)
  const fh = await open(path, 'wx', 0o600)
  try {
    await fh.writeFile(jwt)
  } catch (err) {
    await unlink(path).catch(() => {})
    throw err
  } finally {
    await fh.close()
  }
  return path
}

/** densable `sqv` — debug-dir artifacts + prune */
export async function writeOrchDebugArtifacts(
  debugDir: string,
  claims: SpawnHintClaims,
  jwt: string,
  stderr: string,
  onDebug: (msg: string) => void,
): Promise<void> {
  const base = join(debugDir, claims.jti)
  try {
    await writeFile(`${base}.jwt`, jwt, { mode: 0o600 })
    await writeFile(`${base}.json`, JSON.stringify(claims, null, 2), {
      mode: 0o600,
    })
    await writeFile(`${base}.stderr`, stderr, { mode: 0o600 })
  } catch (err) {
    onDebug(`[runner:orchestrator] debug-dir write failed: ${errMsg(err)}`)
  }
  try {
    const cutoff = Date.now() - ORCH_DEBUG_PRUNE_MS
    const re =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jwt|json|stderr)$/
    for (const name of await readdir(debugDir)) {
      if (!re.test(name)) continue
      const p = join(debugDir, name)
      const st = await stat(p).catch(() => null)
      if (st?.isFile() && st.mtimeMs < cutoff) {
        await unlink(p).catch(() => {})
      }
    }
  } catch {
    /* best-effort prune */
  }
}

export type RunSpawnRunnerHookOpts = {
  hookPath: string
  jwt: string
  claims: SpawnHintClaims
  timeoutMs: number
  debugDir?: string
  signal?: AbortSignal
  onStatus: (msg: string) => void
  onDebug: (msg: string) => void
}

/**
 * densable `bFh` — validate claims, write work-order file, spawn hook.
 */
export async function runSpawnRunnerHook(
  opts: RunSpawnRunnerHookOpts,
): Promise<HookRunResult> {
  const { claims } = opts
  assertSafeId(claims.jti, 'spawn-hint jti')
  if (claims.session_id)
    assertSafeId(claims.session_id, 'spawn-hint session_id')
  if (claims.pool_id) assertSafeId(claims.pool_id, 'spawn-hint environment_id')
  if (claims.account_id) {
    assertSafeId(claims.account_id, 'spawn-hint account_id')
  }
  if (hasControlChars(claims.account_email)) {
    throw new Error('spawn-hint account_email: control character')
  }
  for (const src of claims.repo_sources) {
    if (src.url && (!isSafeGitUrl(src.url) || hasControlChars(src.url))) {
      throw new Error('spawn-hint repo_sources: unsafe git URL')
    }
    if (src.revision && !isSafeGitRevision(src.revision)) {
      throw new Error('spawn-hint repo_sources: unsafe revision')
    }
  }
  if (
    hasControlChars(claims.correlation_id) ||
    claims.correlation_id.startsWith('-') ||
    /\s/.test(claims.correlation_id)
  ) {
    throw new Error('spawn-hint correlation_id: unsafe value')
  }
  if (hasControlChars(claims.server_time)) {
    throw new Error('spawn-hint server_time: unsafe value')
  }
  if (
    typeof claims.attempt !== 'number' ||
    !Number.isInteger(claims.attempt) ||
    claims.attempt < 0
  ) {
    throw new Error('spawn-hint attempt: unsafe value')
  }
  if (!/^[A-Za-z0-9_.-]+$/.test(opts.jwt)) {
    throw new Error(
      'spawn-hint work_order_jwt: unsafe character (not base64url + dot)',
    )
  }

  const started = Date.now()
  const workOrderFile = await writeWorkOrderFile(
    `work-order-${claims.jti}`,
    opts.jwt,
  )
  opts.onDebug(
    `[runner:orchestrator] spawn-runner jti=${claims.jti} workOrderFile=${workOrderFile}`,
  )

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    SELF_HOSTED_RUNNER_POOL_SECRET: undefined,
    SELF_HOSTED_RUNNER_ENVIRONMENT_SECRET: undefined,
    CLAUDE_RUNNER_WORK_ORDER_FILE: workOrderFile,
    CLAUDE_RUNNER_ORDER_ID: claims.jti,
    CLAUDE_RUNNER_SESSION_ID: claims.session_id,
    CLAUDE_RUNNER_SESSION_UUID: claims.session_id,
    CLAUDE_RUNNER_ATTEMPT: String(claims.attempt),
    CLAUDE_RUNNER_POOL_ID: claims.pool_id,
    CLAUDE_RUNNER_ACCOUNT_EMAIL: claims.account_email,
    CLAUDE_RUNNER_ACCOUNT_ID: claims.account_id,
    CLAUDE_RUNNER_ORDER_SERVER_TIME: claims.server_time,
    CLAUDE_RUNNER_PRIMARY_REPO_URL: claims.primary_repo_url,
    CLAUDE_RUNNER_PRIMARY_REPO_REVISION: claims.primary_repo_revision,
    CLAUDE_RUNNER_REPO_SOURCES:
      claims.repo_sources.length > 0 ? JSON.stringify(claims.repo_sources) : '',
    CLAUDE_RUNNER_CORRELATION_ID: claims.correlation_id,
  }

  let stderrTail = ''
  let timedOut = false
  let exitCode: number | null = null
  let execError = false

  try {
    await new Promise<void>(resolve => {
      let child
      try {
        child = spawn(opts.hookPath, [], {
          cwd: undefined,
          env,
          stdio: ['ignore', 'pipe', 'pipe'],
          detached: true,
          windowsHide: true,
        })
      } catch (err) {
        execError = true
        stderrTail = `spawn-runner hook exec failed: ${errMsg(err)}`
        resolve()
        return
      }

      let killTimer: ReturnType<typeof setTimeout> | undefined
      let forceTimer: ReturnType<typeof setTimeout> | undefined
      let abandonTimer: ReturnType<typeof setTimeout> | undefined
      let abortKillTimer: ReturnType<typeof setTimeout> | undefined

      const timeout = setTimeout(() => {
        timedOut = true
        opts.onStatus(
          `[runner:orchestrator] spawn-runner jti=${claims.jti} timed out after ${opts.timeoutMs}ms, sending SIGTERM to process tree`,
        )
        if (child.pid !== undefined) {
          try {
            process.kill(-child.pid, 'SIGTERM')
          } catch {
            try {
              child.kill('SIGTERM')
            } catch {
              /* ignore */
            }
          }
        }
        killTimer = setTimeout(() => {
          if (child.pid !== undefined) {
            try {
              process.kill(-child.pid, 'SIGKILL')
            } catch {
              try {
                child.kill('SIGKILL')
              } catch {
                /* ignore */
              }
            }
          }
          forceTimer = setTimeout(() => {
            opts.onStatus(
              `[runner:orchestrator] spawn-runner jti=${claims.jti} did not exit after SIGKILL within ${ORCH_SIGKILL_GRACE_MS}ms (likely D-state); abandoning child and resolving as timed out`,
            )
            opts.signal?.removeEventListener('abort', onAbort)
            resolve()
          }, ORCH_SIGKILL_GRACE_MS)
        }, ORCH_SIGKILL_GRACE_MS)
      }, opts.timeoutMs)

      child.stdout?.setEncoding('utf8')
      child.stderr?.setEncoding('utf8')
      let stdoutBuf = ''
      let stderrBuf = ''
      const onChunk = (chunk: string, isStderr: boolean): void => {
        const lines = chunk.split('\n')
        const rest = lines.pop() ?? ''
        for (const line of lines) {
          const cleaned = stripControlCharsForLog(redactLogText(line))
          opts.onStatus(`[runner:hook:spawn-runner] ${cleaned}`)
          if (isStderr) {
            stderrTail = (stderrTail + cleaned + '\n').slice(-65_536)
          }
        }
        if (isStderr) stderrBuf = rest
        else stdoutBuf = rest
      }
      child.stdout?.on('data', (d: string) => {
        onChunk(stdoutBuf + d, false)
      })
      child.stderr?.on('data', (d: string) => {
        onChunk(stderrBuf + d, true)
      })

      const onAbort = (): void => {
        opts.onStatus(
          `[runner:orchestrator] spawn-runner jti=${claims.jti} aborted by shutdown, sending SIGTERM to process tree`,
        )
        if (child.pid !== undefined) {
          try {
            process.kill(-child.pid, 'SIGTERM')
          } catch {
            try {
              child.kill('SIGTERM')
            } catch {
              /* ignore */
            }
          }
          abortKillTimer = setTimeout(() => {
            if (child.pid !== undefined) {
              try {
                process.kill(-child.pid, 'SIGKILL')
              } catch {
                /* ignore */
              }
            }
          }, ORCH_SIGKILL_GRACE_MS)
          abortKillTimer.unref?.()
        }
      }
      opts.signal?.addEventListener('abort', onAbort, { once: true })
      if (opts.signal?.aborted) onAbort()

      child.on('error', err => {
        clearTimeout(timeout)
        if (killTimer) clearTimeout(killTimer)
        if (forceTimer) clearTimeout(forceTimer)
        if (abortKillTimer) clearTimeout(abortKillTimer)
        opts.signal?.removeEventListener('abort', onAbort)
        execError = true
        const code = (err as NodeJS.ErrnoException).code
        stderrTail =
          code === 'ENOENT'
            ? 'spawn-runner hook missing (ENOENT)'
            : `spawn-runner hook exec failed: ${errMsg(err)}`
        resolve()
      })
      child.on('close', code => {
        clearTimeout(timeout)
        if (killTimer) clearTimeout(killTimer)
        if (forceTimer) clearTimeout(forceTimer)
        if (abortKillTimer) clearTimeout(abortKillTimer)
        opts.signal?.removeEventListener('abort', onAbort)
        exitCode = code
        resolve()
      })
    })
  } finally {
    await unlink(workOrderFile).catch(err =>
      opts.onDebug(
        `[runner:orchestrator] failed to delete ${workOrderFile}: ${errMsg(err)}`,
      ),
    )
  }

  if (timedOut && !stderrTail) {
    stderrTail = `spawn-runner hook timed out after ${opts.timeoutMs}ms`
  }
  if (opts.debugDir) {
    await writeOrchDebugArtifacts(
      opts.debugDir,
      claims,
      opts.jwt,
      stderrTail,
      opts.onDebug,
    )
  }
  return {
    ok: exitCode === 0 && !timedOut && !execError,
    exitCode,
    timedOut,
    execError,
    stderrTail,
    durationMs: Date.now() - started,
  }
}

export type OrchestratorHealthState = {
  orchestratorUuid: string
  hostname: string
  version: string
  pool_id: string
  connected: boolean
  last_poll_at: number
  last_hint_at: number
  last_hook_ok_at: number
  last_warm_hook_ok_at: number
  last_error: string | null
  clock_skew_ms: number | null
  queue_counts: {
    pending: number
    backing_off: number
    circuit_broken: number
  } | null
  pool_pending_session_count: number | null
  pool_active_session_count: number | null
  warm_hints_dispatched: number
  spawnHooks: { ok: number; retryable: number; nonRetryable: number }
  pollErrors: ReturnType<typeof emptyRunnerErrorCounts>
  /** densable UFh — present always for YFh histogram series */
  spawnHookDurations: OrchHistogram
  /** densable qFh — present always; seat hints only */
  sessionQueueWaits: OrchHistogram
  /** densable RFh — null when --scm-connector-host unset */
  scm_connector: ScmConnectorHealth | null
}

/**
 * densable `YFh` — Prometheus text exposition for orchestrator /metrics.
 */
export function renderOrchestratorMetrics(
  state: OrchestratorHealthState,
  nowMs: number = Date.now(),
): string {
  const age = state.last_poll_at > 0 ? (nowMs - state.last_poll_at) / 1000 : 0
  const labels = `version="${escapePromLabel(state.version)}",pool_id="${escapePromLabel(state.pool_id)}",orchestrator_uuid="${escapePromLabel(state.orchestratorUuid)}",hostname="${escapePromLabel(state.hostname)}"`
  let out = ''
  out += `# HELP claude_code_self_hosted_orchestrator_info Self-hosted orchestrator identity (info-style gauge; value is always 1).\n`
  out += `# TYPE claude_code_self_hosted_orchestrator_info gauge\n`
  out += `claude_code_self_hosted_orchestrator_info{${labels}} 1\n`
  out += `# HELP claude_code_self_hosted_orchestrator_connected 1 when the last PollSpawnHints returned successfully; 0 on transport/5xx error.\n`
  out += `# TYPE claude_code_self_hosted_orchestrator_connected gauge\n`
  out += `claude_code_self_hosted_orchestrator_connected ${state.connected ? 1 : 0}\n`
  out += `# HELP claude_code_self_hosted_orchestrator_last_poll_age_seconds Seconds since the last PollSpawnHints attempt (success or failure).\n`
  out += `# TYPE claude_code_self_hosted_orchestrator_last_poll_age_seconds gauge\n`
  out += `claude_code_self_hosted_orchestrator_last_poll_age_seconds ${age}\n`
  out += `# HELP claude_code_self_hosted_orchestrator_queue_pending_sessions Spawn-hint queue rows claimable right now (eta < now, unclaimed, not circuit-broken). Server-side aggregate for this environment.\n`
  out += `# TYPE claude_code_self_hosted_orchestrator_queue_pending_sessions gauge\n`
  if (state.queue_counts !== null) {
    out += `claude_code_self_hosted_orchestrator_queue_pending_sessions ${state.queue_counts.pending}\n`
  }
  out += `# HELP claude_code_self_hosted_orchestrator_queue_backing_off_sessions Spawn-hint queue rows in retry backoff (nacked retryable; eta in the future). Server-side aggregate for this environment.\n`
  out += `# TYPE claude_code_self_hosted_orchestrator_queue_backing_off_sessions gauge\n`
  if (state.queue_counts !== null) {
    out += `claude_code_self_hosted_orchestrator_queue_backing_off_sessions ${state.queue_counts.backing_off}\n`
  }
  out += `# HELP claude_code_self_hosted_orchestrator_queue_circuit_broken_sessions Spawn-hint queue rows circuit-broken (nacked non-retryable; operator must RetrySpawnHint to re-admit). Server-side aggregate for this environment.\n`
  out += `# TYPE claude_code_self_hosted_orchestrator_queue_circuit_broken_sessions gauge\n`
  if (state.queue_counts !== null) {
    out += `claude_code_self_hosted_orchestrator_queue_circuit_broken_sessions ${state.queue_counts.circuit_broken}\n`
  }
  out += `# HELP claude_code_self_hosted_orchestrator_pool_pending_sessions Total sessions currently waiting on a runner for this environment (the UI "N ahead of you" number). Autoscale on this, not on queue_pending_sessions.\n`
  out += `# TYPE claude_code_self_hosted_orchestrator_pool_pending_sessions gauge\n`
  if (state.pool_pending_session_count !== null) {
    out += `claude_code_self_hosted_orchestrator_pool_pending_sessions ${state.pool_pending_session_count}\n`
  }
  out += `# HELP claude_code_self_hosted_orchestrator_pool_active_sessions Sessions currently assigned to an alive runner in this environment (the server's environment-wide sum of the per-runner _active_sessions gauges). Environment-wide aggregate — identical on every orchestrator for one environment; use MAX not SUM across orchestrator instances.\n`
  out += `# TYPE claude_code_self_hosted_orchestrator_pool_active_sessions gauge\n`
  if (state.pool_active_session_count !== null) {
    out += `claude_code_self_hosted_orchestrator_pool_active_sessions ${state.pool_active_session_count}\n`
  }
  out += `# HELP claude_code_self_hosted_orchestrator_warm_hints_dispatched_total Standby (warm) hints dispatched since process start.\n`
  out += `# TYPE claude_code_self_hosted_orchestrator_warm_hints_dispatched_total counter\n`
  out += `claude_code_self_hosted_orchestrator_warm_hints_dispatched_total ${state.warm_hints_dispatched}\n`
  out += `# HELP claude_code_self_hosted_orchestrator_spawn_hooks_total spawn-runner hook outcomes since process start (exit-code contract: ok=0, retryable=1/timeout/signal, non_retryable=>=2/ENOENT/EACCES). Counts orchestrator hook invocations (seat + warm), NOT runner child spawns — NOT comparable to the runner's sessions_started_total (capacity>1, warm environments, and per-runner re-spawns all diverge them).\n`
  out += `# TYPE claude_code_self_hosted_orchestrator_spawn_hooks_total counter\n`
  out += `claude_code_self_hosted_orchestrator_spawn_hooks_total{result="ok"} ${state.spawnHooks.ok}\n`
  out += `claude_code_self_hosted_orchestrator_spawn_hooks_total{result="retryable"} ${state.spawnHooks.retryable}\n`
  out += `claude_code_self_hosted_orchestrator_spawn_hooks_total{result="non_retryable"} ${state.spawnHooks.nonRetryable}\n`
  out += `# HELP claude_code_self_hosted_orchestrator_spawn_hook_duration_seconds Wall-clock seconds per spawn-runner hook run (all outcomes; seat + warm).\n`
  out += `# TYPE claude_code_self_hosted_orchestrator_spawn_hook_duration_seconds histogram\n`
  {
    const s = state.spawnHookDurations
    for (let i = 0; i < ORCH_SPAWN_HOOK_DURATION_BUCKETS.length; i++) {
      out += `claude_code_self_hosted_orchestrator_spawn_hook_duration_seconds_bucket{le="${ORCH_SPAWN_HOOK_DURATION_BUCKETS[i]}"} ${s.buckets[i]}\n`
    }
    out += `claude_code_self_hosted_orchestrator_spawn_hook_duration_seconds_bucket{le="+Inf"} ${s.count}\n`
    out += `claude_code_self_hosted_orchestrator_spawn_hook_duration_seconds_sum ${s.sum}\n`
    out += `claude_code_self_hosted_orchestrator_spawn_hook_duration_seconds_count ${s.count}\n`
  }
  out += `# HELP claude_code_self_hosted_orchestrator_session_queue_wait_seconds Seconds each session waited in the queue before the orchestrator claimed it for spawn (HTTP Date header - SpawnHint.queue_wait_started_at; seat hints only). For p50/p99 queue-time SLOs and "queue wait > N" alerting.\n`
  out += `# TYPE claude_code_self_hosted_orchestrator_session_queue_wait_seconds histogram\n`
  {
    const a = state.sessionQueueWaits
    for (let i = 0; i < ORCH_SESSION_QUEUE_WAIT_BUCKETS.length; i++) {
      out += `claude_code_self_hosted_orchestrator_session_queue_wait_seconds_bucket{le="${ORCH_SESSION_QUEUE_WAIT_BUCKETS[i]}"} ${a.buckets[i]}\n`
    }
    out += `claude_code_self_hosted_orchestrator_session_queue_wait_seconds_bucket{le="+Inf"} ${a.count}\n`
    out += `claude_code_self_hosted_orchestrator_session_queue_wait_seconds_sum ${a.sum}\n`
    out += `claude_code_self_hosted_orchestrator_session_queue_wait_seconds_count ${a.count}\n`
  }
  out += `# HELP claude_code_self_hosted_orchestrator_poll_errors_total PollSpawnHints request failures by error kind (transport=no HTTP response; timeout=client deadline; 5xx/429/4xx by status). All five series present from process start so rate() works and absent() means process-down.\n`
  out += `# TYPE claude_code_self_hosted_orchestrator_poll_errors_total counter\n`
  for (const kind of ORCH_POLL_ERROR_KINDS) {
    out += `claude_code_self_hosted_orchestrator_poll_errors_total{error_kind="${kind}"} ${state.pollErrors[kind]}\n`
  }
  out += `# HELP claude_code_self_hosted_orchestrator_clock_skew_seconds Local-minus-server clock skew from the most recent PollSpawnHints Date header. Sample omitted until measured.\n`
  out += `# TYPE claude_code_self_hosted_orchestrator_clock_skew_seconds gauge\n`
  if (state.clock_skew_ms !== null) {
    out += `claude_code_self_hosted_orchestrator_clock_skew_seconds ${state.clock_skew_ms / 1000}\n`
  }
  out += `# HELP claude_code_self_hosted_orchestrator_scm_connector_connected 1 when the standing SCM connector WebSocket is OPEN; 0 when dialing/backing off. Series absent when --scm-connector-host is not set.\n`
  out += `# TYPE claude_code_self_hosted_orchestrator_scm_connector_connected gauge\n`
  if (state.scm_connector !== null) {
    out += `claude_code_self_hosted_orchestrator_scm_connector_connected ${state.scm_connector.connected ? 1 : 0}\n`
  }
  out += `# HELP claude_code_self_hosted_orchestrator_scm_connector_requests_forwarded_total Cumulative HTTP requests proxied to the configured SCM host since process start.\n`
  out += `# TYPE claude_code_self_hosted_orchestrator_scm_connector_requests_forwarded_total counter\n`
  if (state.scm_connector !== null) {
    out += `claude_code_self_hosted_orchestrator_scm_connector_requests_forwarded_total ${state.scm_connector.requests_forwarded}\n`
  }
  return out
}

/**
 * densable `JFh` — orchestrator /healthz + /metrics HTTP server.
 * EADDRINUSE retries once after IFh ms; other listen errors are non-fatal.
 */
export function startOrchestratorHealthServer(
  port: number,
  state: OrchestratorHealthState,
  onStatus: (msg: string) => void,
): Server {
  const server = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/metrics') {
      const body = renderOrchestratorMetrics(state)
      res.writeHead(200, {
        'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
      })
      res.end(body)
      return
    }
    if (req.method !== 'GET' || req.url !== '/healthz') {
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('not found\n')
      return
    }
    const scm = state.scm_connector
    const body = JSON.stringify({
      status: 'ok',
      orchestrator_uuid: state.orchestratorUuid,
      hostname: state.hostname,
      version: state.version,
      pool_id: state.pool_id,
      connected: state.connected,
      last_poll_at:
        state.last_poll_at > 0
          ? new Date(state.last_poll_at).toISOString()
          : null,
      last_hint_at:
        state.last_hint_at > 0
          ? new Date(state.last_hint_at).toISOString()
          : null,
      last_hook_ok_at:
        state.last_hook_ok_at > 0
          ? new Date(state.last_hook_ok_at).toISOString()
          : null,
      last_warm_hook_ok_at:
        state.last_warm_hook_ok_at > 0
          ? new Date(state.last_warm_hook_ok_at).toISOString()
          : null,
      last_error: state.last_error,
      clock_skew_ms: state.clock_skew_ms,
      queue_counts: state.queue_counts,
      pool_pending_session_count: state.pool_pending_session_count,
      pool_active_session_count: state.pool_active_session_count,
      warm_hints_dispatched: state.warm_hints_dispatched,
      scm_connector_connected: scm?.connected ?? null,
      scm_connector: scm
        ? {
            connected: scm.connected,
            last_connected_at:
              scm.last_connected_at !== null && scm.last_connected_at > 0
                ? new Date(scm.last_connected_at).toISOString()
                : null,
            last_error: scm.last_error,
            reconnects: scm.reconnects,
            requests_forwarded: scm.requests_forwarded,
          }
        : null,
    })
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    })
    res.end(body)
  })
  server.unref()
  let addrInUseRetried = 0
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE' && addrInUseRetried === 0) {
      addrInUseRetried++
      onStatus(
        `[runner:warn] /healthz port ${port} busy, retrying in ${ORCH_HEALTH_ADDRINUSE_RETRY_MS}ms`,
      )
      setTimeout(() => {
        server.listen(port)
      }, ORCH_HEALTH_ADDRINUSE_RETRY_MS).unref()
      return
    }
    onStatus(
      `[runner:warn] /healthz listener failed on port ${port}: ${err.message} — continuing without health endpoint`,
    )
  })
  server.on('listening', () => {
    const addr = server.address()
    const p = typeof addr === 'object' && addr !== null ? addr.port : port
    onStatus(
      `[runner:health] orchestrator /healthz and /metrics listening on :${p}`,
    )
  })
  server.listen(port)
  return server
}

export type RunOrchestratorLoopOpts = {
  apiClient: SelfHostedRunnerApi
  healthState: OrchestratorHealthState
  onStatus: (msg: string) => void
  onDebug: (msg: string) => void
  args: OrchestratorArgs
  hookPath: string
  runHook?: typeof runSpawnRunnerHook
  fatalExit?: (msg: string) => never
  pollIntervalMs?: number
}

function defaultFatalExit(msg: string): never {
  console.error(
    `${new Date().toISOString()} [self-hosted-runner] [runner:fatal] ${redactLogText(msg)}`,
  )
  process.exit(1)
}

/** densable `XFh` */
export async function runOrchestratorLoop(
  opts: RunOrchestratorLoopOpts,
  signal: AbortSignal,
): Promise<void> {
  const {
    apiClient,
    healthState,
    onStatus,
    onDebug,
    args,
    hookPath,
    runHook = runSpawnRunnerHook,
    fatalExit = defaultFatalExit,
    pollIntervalMs = ORCH_POLL_INTERVAL_MS,
  } = opts

  let backoff = ORCH_POLL_BACKOFF_INITIAL_MS

  while (!signal.aborted) {
    healthState.last_poll_at = Date.now()
    let poll
    try {
      poll = await apiClient.pollSpawnHints(
        {
          orchestrator_uuid: healthState.orchestratorUuid,
          hostname: healthState.hostname,
          client_version: resolveRunnerVersion(),
          max: args.hookConcurrency,
          expected_spawn_seconds: args.expectedSpawnSeconds,
          ...(args.minIdle > 0 ? { min_idle: args.minIdle } : {}),
        },
        signal,
      )
    } catch (err) {
      if (signal.aborted) break
      healthState.pollErrors[classifyRunnerError(err)]++
      const status = getHttpStatusFromError(err)
      const msg = redactLogText(errMsg(err))
      if (status !== undefined && ORCH_FATAL_HTTP.has(status)) {
        healthState.connected = false
        healthState.last_error = msg
        fatalExit(
          status === 426
            ? `orchestrator version too old (HTTP 426): ${msg} — upgrade and restart`
            : `PollSpawnHints rejected (HTTP ${status}): ${msg}`,
        )
      }
      healthState.connected = false
      healthState.last_error = msg
      onStatus(
        `[runner:orchestrator] poll failed${status ? ` (HTTP ${status})` : ''}: ${msg} — retrying in ${Math.round(backoff / 1000)}s`,
      )
      await sleepMs(backoff, signal)
      backoff = Math.min(backoff * 2, ORCH_POLL_BACKOFF_MAX_MS)
      continue
    }

    healthState.connected = true
    healthState.last_error = null
    backoff = ORCH_POLL_BACKOFF_INITIAL_MS

    const skew = clockSkewMs(poll.server_date)
    if (skew !== null) {
      healthState.clock_skew_ms = skew
      if (Math.abs(skew) > ORCH_CLOCK_SKEW_WARN_MS) {
        onStatus(
          `[runner:warn] clock skew ${Math.round(skew / 1000)}s vs server — check NTP (work-order exp checks may fail)`,
        )
      }
    }

    healthState.queue_counts = {
      pending: poll.pending_count,
      backing_off: poll.backing_off_count,
      circuit_broken: poll.circuit_broken_count,
    }
    healthState.pool_pending_session_count =
      poll.pool_pending_session_count ?? null
    healthState.pool_active_session_count =
      poll.pool_active_session_count ?? null

    const take = poll.hints.slice(0, args.hookConcurrency)
    const over = poll.hints.slice(args.hookConcurrency)
    for (const hint of over) {
      onStatus(
        `[runner:orchestrator] server over-returned hint session=${hint.session_uuid} (got ${poll.hints.length}, max=${args.hookConcurrency}) — nacking retryably`,
      )
      await apiClient
        .nackSpawnHint(
          {
            session_uuid: hint.session_uuid,
            attempt: hint.attempt,
            error: 'orchestrator: server over-returned hints (>max)',
            retryable: true,
          },
          signal,
        )
        .catch(err =>
          onStatus(
            `[runner:orchestrator] nack of over-returned hint failed: ${errMsg(err)} — lease expiry will re-admit`,
          ),
        )
    }

    const warmBudget = Math.max(0, args.hookConcurrency - take.length)
    const warm = args.minIdle > 0 ? poll.warm_hints.slice(0, warmBudget) : []
    if (poll.warm_hints.length > warm.length) {
      onDebug(
        `[runner:orchestrator] dropping ${poll.warm_hints.length - warm.length} warm hint(s) (budget=${warmBudget}, minIdle=${args.minIdle})`,
      )
    }
    if (take.length > 0) {
      onStatus(
        `[runner:orchestrator] dispatching ${take.length} hint(s) (concurrency=${args.hookConcurrency})`,
      )
    }
    if (warm.length > 0) {
      onStatus(
        `[runner:orchestrator] dispatching ${warm.length} warm hint(s) (min_idle=${args.minIdle})`,
      )
    }

    const dispatch = async (
      hint: SpawnHint,
      serverDate: string | null,
      isWarm: boolean,
    ): Promise<void> => {
      healthState.last_hint_at = Date.now()
      if (isWarm) healthState.warm_hints_dispatched++
      // densable Rqv — seat hints only (queue_wait_started_at vs HTTP Date)
      if (!isWarm) {
        const startedAt = hint.queue_wait_started_at
        if (
          typeof startedAt === 'string' &&
          startedAt.length > 0 &&
          typeof serverDate === 'string' &&
          serverDate.length > 0
        ) {
          const a = Date.parse(startedAt)
          const b = Date.parse(serverDate)
          if (!Number.isNaN(a) && !Number.isNaN(b)) {
            observeSessionQueueWait(
              healthState.sessionQueueWaits,
              (b - a) / 1000,
            )
          }
        }
      }
      let result: HookRunResult
      let setupOk = false
      try {
        const claims = extractSpawnHintClaims(hint, serverDate)
        result = await runHook({
          hookPath,
          jwt: hint.work_order_jwt,
          claims,
          timeoutMs: args.hookTimeoutMs,
          debugDir: args.debugDir,
          signal,
          onStatus,
          onDebug,
        })
        setupOk = true
      } catch (err) {
        result = {
          ok: false,
          exitCode: 1,
          timedOut: false,
          execError: false,
          stderrTail: `spawn-runner hook setup failed: ${errMsg(err)}`,
          durationMs: 0,
        }
      }

      // densable Aqv — all outcomes (seat + warm)
      observeSpawnHookDuration(
        healthState.spawnHookDurations,
        result.durationMs / 1000,
      )

      if (result.ok) {
        healthState.spawnHooks.ok++
        healthState.last_hook_ok_at = Date.now()
        if (isWarm) {
          healthState.last_warm_hook_ok_at = healthState.last_hook_ok_at
        }
        onDebug(
          `[runner:orchestrator] ok session=${hint.session_uuid} attempt=${hint.attempt} jti=${hint.jti} (${result.durationMs}ms)`,
        )
        return
      }

      const errText = redactLogText(
        result.stderrTail ||
          (result.exitCode === null
            ? 'hook killed by external signal (no stderr)'
            : `exit ${result.exitCode}`),
      )
      const retryable =
        result.exitCode === 1 ||
        result.timedOut ||
        (result.exitCode === null && !result.execError)
      const failureKind = !setupOk
        ? undefined
        : result.timedOut
          ? 'SESSION_FAILURE_KIND_SPAWN_TIMEOUT'
          : 'SESSION_FAILURE_KIND_SPAWN_HOOK_ERROR'
      if (retryable) healthState.spawnHooks.retryable++
      else healthState.spawnHooks.nonRetryable++
      healthState.last_error = `spawn-runner hook failed: ${errText}`

      if (isWarm) {
        onStatus(
          `[runner:orchestrator] warm hook failed jti=${hint.jti} exit=${result.exitCode} timedOut=${result.timedOut}: ${errText} — lease expiry will re-mint`,
        )
        return
      }
      onStatus(
        `[runner:orchestrator] nack session=${hint.session_uuid} attempt=${hint.attempt} exit=${result.exitCode} timedOut=${result.timedOut} retryable=${retryable}: ${errText}`,
      )
      try {
        await apiClient.nackSpawnHint(
          {
            session_uuid: hint.session_uuid,
            attempt: hint.attempt,
            error: errText,
            retryable,
            ...(failureKind ? { failure_kind: failureKind } : {}),
          },
          signal,
        )
      } catch (err) {
        onStatus(
          `[runner:orchestrator] nack failed session=${hint.session_uuid}: ${errMsg(err)} — lease expiry will re-admit`,
        )
      }
    }

    if (take.length + warm.length > 0) {
      await Promise.all([
        ...take.map(h => dispatch(h, poll.server_date, false)),
        ...warm.map(h => dispatch(h, poll.server_date, true)),
      ])
    }
    await sleepMs(pollIntervalMs, signal)
  }
}

export function formatOrchestratorHelp(): string {
  return `Usage: claude self-hosted-runner orchestrator [options]

Polls the spawn-hints queue (server returns immediately) and runs \${hooks-dir}/spawn-runner once per
hint. The hook must submit work asynchronously (kubectl create job, EC2
RunInstances, ...) and exit within --hook-timeout. Exit-code contract (session
spawns): 0 = success (no-op); 1 = retryable failure (backoff); >=2 = non-retryable
(circuit-break); stderr tail is forwarded as the nack error. Standby (--min-idle)
spawns: any non-zero exit is logged locally and re-requested after the lease.

Connection:
  --api-url <url>             API base URL (default: ${ORCH_DEFAULT_API_URL})
  --environment-secret-file <path>
                              Path to environment secret file (or set SELF_HOSTED_RUNNER_ENVIRONMENT_SECRET)
                              (--pool-secret-file / SELF_HOSTED_RUNNER_POOL_SECRET are deprecated aliases.)

Hook:
  --hooks-dir <path>          Directory containing the spawn-runner hook (REQUIRED).
                              [env: SELF_HOSTED_RUNNER_HOOKS_DIR]
  --hook-concurrency <n>      Max spawn-runner hooks running in parallel (default: ${ORCH_DEFAULT_HOOK_CONCURRENCY}).
                              Also caps how many hints are claimed per poll.
  --hook-timeout <sec>        SIGTERM the hook after <sec> seconds (default: ${ORCH_DEFAULT_HOOK_TIMEOUT_MS / 1000}).
  --expected-spawn-seconds <n>  p99 boot time for runners this orchestrator spawns
                              (default: ${ORCH_DEFAULT_EXPECTED_SPAWN_SECONDS}). Sent on every Poll as the
                              server-side lease; if the runner doesn't register before then, the
                              session is re-hinted with a fresh jti. HA replicas MUST use the same value.
  --min-idle <n>              Keep at least <n> idle slots free (free capacity across runners, not
                              runner count; default: 0, disabled). The server mints standby
                              work_orders (no session binding) for the gap on every Poll.

SCM connector (optional):
  --scm-connector-host <h[:p]>
  --scm-connector-id <n>
  --scm-connector-provider <s>
  --scm-connector-ca-file <path>
  --scm-connector-host-rewrite <from>=<to_host:to_port>

Runtime:
  --health-port <port>        Port for /healthz (default: ${ORCH_DEFAULT_HEALTH_PORT}). 0 disables.
                              [env: SELF_HOSTED_RUNNER_HEALTH_PORT]
  --log-level <level>         info or debug (default: info)
  --debug-dir <path>          DEV ONLY work-order dumps
                              [env: SELF_HOSTED_RUNNER_DEBUG_DIR]
  --help, -h                  Show this help message
`
}

export type OrchestratorMainDeps = {
  apiFactory?: typeof createSelfHostedRunnerApi
  enterLoop?: boolean
  resolveSecret?: typeof resolveOrchestratorPoolSecret
  runLoop?: typeof runOrchestratorLoop
  validateHook?: typeof validateSpawnRunnerHook
}

/** densable `Iqv` / `selfHostedRunnerOrchestratorMain` */
export async function selfHostedRunnerOrchestratorMain(
  argv: string[],
  deps: OrchestratorMainDeps = {},
): Promise<void> {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(formatOrchestratorHelp())
    return
  }

  let args: OrchestratorArgs
  try {
    // densable 2.1.238 $4y — refuse proxy-authorization knobs on orchestrator
    assertOrchestratorProxyAuthUnset(argv)
    args = parseOrchestratorArgs(argv)
  } catch (err) {
    console.error(
      `error: ${redactLogText(errMsg(err))}\nRun 'claude self-hosted-runner orchestrator --help' for usage.`,
    )
    process.exit(2)
  }

  const debugEnabled = args.logLevel === 'debug'
  const ts = () => new Date().toISOString()
  const clean = (s: string) => stripControlCharsForLog(redactLogText(s))
  const onDebug = (s: string): void => {
    if (debugEnabled) console.error(`${ts()} [DEBUG] ${clean(s)}`)
  }
  const onStatus = (s: string): void => {
    console.log(`${ts()} [self-hosted-runner] ${clean(s)}`)
  }

  let hookPath: string
  try {
    hookPath = await (deps.validateHook ?? validateSpawnRunnerHook)(
      args.hooksDir,
    )
  } catch (err) {
    onStatus(`[runner:fatal] ${errMsg(err)}`)
    process.exit(1)
  }
  onStatus(`[runner:hook] spawn-runner hook found at ${hookPath}`)

  let secret: string
  try {
    secret = await (deps.resolveSecret ?? resolveOrchestratorPoolSecret)(args)
  } catch (err) {
    onStatus(`[runner:fatal] ${errMsg(err)}`)
    process.exit(1)
  }

  if (args.debugDir) {
    await mkdir(args.debugDir, { recursive: true, mode: 0o700 }).catch(err =>
      onStatus(
        `[runner:warn] failed to create --debug-dir ${args.debugDir}: ${errMsg(err)} — continuing without debug artifacts`,
      ),
    )
  }

  const orchUuid = randomUUID()
  const host = osHostname()
  onStatus(
    `[runner:orchestrator] starting orchestrator_uuid=${orchUuid} hostname=${host} hook-concurrency=${args.hookConcurrency} hook-timeout=${args.hookTimeoutMs}ms`,
  )

  let poolId: string
  try {
    poolId = extractPoolIdFromSecret(secret)
  } catch (err) {
    onStatus(`[runner:fatal] ${errMsg(err)}`)
    process.exit(1)
  }
  onStatus(`[runner:orchestrator] environment_id=${poolId}`)

  const api = (deps.apiFactory ?? createSelfHostedRunnerApi)({
    baseUrl: args.apiUrl,
    poolSecret: secret,
    onDebug,
  })

  const healthState: OrchestratorHealthState = {
    orchestratorUuid: orchUuid,
    hostname: host,
    version: resolveRunnerVersion(),
    pool_id: poolId,
    connected: false,
    last_poll_at: 0,
    last_hint_at: 0,
    last_hook_ok_at: 0,
    last_warm_hook_ok_at: 0,
    last_error: null,
    clock_skew_ms: null,
    queue_counts: null,
    pool_pending_session_count: null,
    pool_active_session_count: null,
    warm_hints_dispatched: 0,
    spawnHooks: { ok: 0, retryable: 0, nonRetryable: 0 },
    pollErrors: emptyRunnerErrorCounts(),
    spawnHookDurations: emptySpawnHookDurations(),
    sessionQueueWaits: emptySessionQueueWaits(),
    scm_connector: args.scmConnector ? emptyScmConnectorHealth() : null,
  }

  // densable: health server + SCM before loop; abort stops both
  const ac = new AbortController()

  // densable JFh — /healthz + /metrics
  const healthServer =
    args.healthPort > 0
      ? startOrchestratorHealthServer(args.healthPort, healthState, onStatus)
      : undefined

  // densable kFh — SCM connector tunnel (orch-side)
  let scmHandle: ScmConnectorHandle | undefined
  if (args.scmConnector && healthState.scm_connector) {
    const cfg: ScmTunnelConfig = {
      host: args.scmConnector.host,
      port: args.scmConnector.port,
      provider: args.scmConnector.provider,
      connectorId: args.scmConnector.connectorId,
      caFile: args.scmConnector.caFile,
      hostRewrite: args.scmConnector.hostRewrite,
    }
    scmHandle = startScmConnector(
      cfg,
      healthState.scm_connector,
      {
        apiUrl: args.apiUrl,
        poolSecret: secret,
        onStatus,
        onDebug,
      },
      ac.signal,
    )
  }

  if (deps.enterLoop === false) {
    scmHandle?.stop()
    healthServer?.close()
    return
  }

  let forced = false
  const onSignal = (): void => {
    if (forced) {
      onStatus('Forced shutdown')
      process.exit(1)
    }
    forced = true
    onStatus('Received shutdown signal, stopping poll loop...')
    ac.abort()
  }
  process.on('SIGTERM', onSignal)
  process.on('SIGINT', onSignal)
  try {
    await (deps.runLoop ?? runOrchestratorLoop)(
      {
        apiClient: api,
        hookPath,
        args,
        healthState,
        onStatus,
        onDebug,
      },
      ac.signal,
    )
  } finally {
    scmHandle?.stop()
    try {
      healthServer?.closeAllConnections?.()
    } catch {
      /* ignore */
    }
    healthServer?.close()
    process.removeListener('SIGTERM', onSignal)
    process.removeListener('SIGINT', onSignal)
  }
}
