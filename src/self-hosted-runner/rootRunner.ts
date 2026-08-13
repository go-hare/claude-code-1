/**
 * densable 2.1.224 self-hosted-runner root (`selfHostedRunnerMain` / PBh).
 *
 * Recovered 1:1 from SEA:
 *   - parseArgs (wBh) + helpers (ozv/izv/szv/bBh/yBh)
 *   - resolveEnvironmentSecret (ABh)
 *   - resolveExec (RBh)
 *   - sessionBoundCapacityWarning (CBh)
 *   - derivePollInterval (IBh)
 *   - constants (hBh/gBh/SBh/TBh/…)
 *   - main bootstrap through RegisterRunner + poll (xBh)
 *   - health HTTP (hFh) + metrics state
 *   - SSE work-hints (uBh/ZJl) when CCR_SHR_SSE_HINTS
 *   - session spawn + checkout/post-session hooks via handleSession
 *   - retire/idle/deassign/drain accounting + releaseSession
 *   - git configure / anthropic git proxy (startup)
 *
 * Built-in aWd/Fjy + bjv + outcome + D trust + rBh residual
 * (B2h/Bjv/Fjv/Ijv/W2h/xjv/z2h/CKn) wired via handleSession.
 */
import {
  constants as fsConstants,
  createWriteStream,
  fchmod,
  type WriteStream,
} from 'node:fs'
import { access, lstat, mkdir, readFile, rm } from 'node:fs/promises'
import { getErrnoCode } from 'src/utils/errors.js'
import { homedir, hostname } from 'node:os'
import { dirname, join, resolve as pathResolve } from 'node:path'
import { isEnvDefinedFalsy, isEnvTruthy } from 'src/utils/envUtils.js'
import {
  captureGovernedGitConfigSeed,
  codeSignArtifacts,
  coauthorHookStubs,
  configureAnthropicGitProxy,
  configureGitSigning,
  GIT_PROXY_CRED_HELPER_CONTENT,
  gitProxyCredHelperPath,
  type GitArtifactFile,
} from './gitConfigure.js'
import {
  classifyPollError,
  clearChildMetricsForSession,
  createRunnerHealthState,
  observeInitDuration,
  startHealthServer,
  UNKNOWN_CLIENT_PLATFORM,
  type RunnerHealthState,
} from './healthMetrics.js'
import { snapshotHostConfig, type HostConfigSnapshot } from './hostConfig.js'
import {
  createSelfHostedRunnerApi,
  isRetryableRunnerError,
  resolveRunnerVersion,
  type SelfHostedRunnerApi,
} from './runnerApi.js'
import type {
  HandleSessionResult,
  handleSession as HandleSessionFn,
} from './sessionHandler.js'
import type { BgTaskSnapshot, SessionActivityKind } from './sessionActivity.js'
import { extractSessionActorEmail } from './sessionChild.js'
import {
  createRunnerTokenRefreshScheduler,
  decodeRunnerTokenExpirySeconds,
  formatDelayMs,
  type TokenRefreshScheduler,
} from './tokenRefresh.js'
import {
  isSseHintsEnabled,
  openWorkHintsStream,
  PollWakeQueue,
  SSE_WAKE_JITTER_MS,
  type OpenWorkHintsStreamOpts,
  type WorkHintsStreamHandle,
  type PollWakeSource,
} from './workHintsSse.js'

// ── densable constants (OBh init) ──────────────────────────────────────────

/** densable `hBh` */
export const DEFAULT_API_URL = 'https://api.anthropic.com'
/** densable `gBh` */
export const DEFAULT_CAPACITY = 1
/** densable `SBh` */
export const DEFAULT_BASE_DIR = '/workspace'
/** densable `TBh` */
export const DEFAULT_HEALTH_PORT = 8080
/** densable `tXl` */
export const TRUST_WORKSPACE_DEFAULT = true
/** densable `VUi` — poll failure retry */
export const POLL_ERROR_RETRY_MS = 20_000
/** densable `_Bh` — default startup timeout (15 min) */
export const DEFAULT_STARTUP_TIMEOUT_MS = 900_000
/** densable `pBh` — min poll interval when lease near */
export const MIN_POLL_INTERVAL_MS = 5_000
/** densable `Xjv` — max poll interval derived from lease */
export const MAX_POLL_INTERVAL_MS = 30_000
/** densable `tzv` — environment secret file read timeout */
export const SECRET_READ_TIMEOUT_MS = 10_000
/** densable `kIe` — max minutes flags (7 days) */
export const MAX_MINUTES_FLAG = 10_080
/** densable `eXl` — max drain-grace seconds (7 days) */
export const MAX_DRAIN_GRACE_SEC = 604_800
/** densable `vBh` / `EBh` — retire-at Unix seconds range */
export const RETIRE_AT_MIN_SEC = 1_000_000_000
export const RETIRE_AT_MAX_SEC = 100_000_000_000
/** densable `xKn` — default session-stop grace 5s */
export const DEFAULT_SESSION_STOP_GRACE_MS = 5_000
/** densable `yGr` — default post-session hook timeout 60s */
export const DEFAULT_POST_SESSION_HOOK_TIMEOUT_MS = 60_000
/** densable `GUi` — fixed addend in shutdown budget calc */
export const SHUTDOWN_BUDGET_PAD_MS = 15_000
/** densable `_Gr` — push-outcome-on-release extra budget */
export const PUSH_OUTCOME_BUDGET_MS = 30_000
/** densable `Jjv` client label default for token refresh */
export const RUNNER_TOKEN_LABEL = 'runner'
/** densable `rzv` — retire release retry when declined */
export const RETIRE_RELEASE_RETRY_MS = 15_000
/** densable `nzv` — retire deferred grace for live bg tasks */
export const RETIRE_DEFERRED_GRACE_MS = 60_000
/** densable `Qjv` — shutdown lease heartbeat interval */
export const SHUTDOWN_LEASE_HEARTBEAT_MS = 20_000
/** densable `Zjv` / `ezv` — 404 confirm backoff base / max */
export const POLL_404_BACKOFF_BASE_MS = 1_000
export const POLL_404_BACKOFF_MAX_MS = 5_000
/** densable `lBh` wire wake_source values */
export const POLL_WAKE_SOURCE_WIRE: Record<PollWakeSource, string> = {
  POLL: 'POLL_WAKE_SOURCE_POLL',
  SSE: 'POLL_WAKE_SOURCE_SSE',
  LOCAL: 'POLL_WAKE_SOURCE_LOCAL',
}
/** densable health log every N successful polls */
export const HEALTH_LOG_EVERY_POLLS = 10
/** densable deferred-hold reminders (ms) */
export const DEFERRED_HOLD_REMINDERS_MS = [
  1_800_000, 7_200_000, 28_800_000,
] as const

export type ConfineRepoSettings = 'enforce' | 'warn' | 'off'

/** densable `baseDirSource` — tracks how baseDir was chosen for win32 gate. */
export type BaseDirSource = 'default' | 'env' | 'flag'

export type RootRunnerArgs = {
  apiUrl: string
  capacity: number
  baseDir: string
  /**
   * densable 2.1.229 `baseDirSource` — used by `n_g` to reject bare default
   * `/workspace` on Windows (env/flag override still allowed).
   */
  baseDirSource: BaseDirSource
  execPath: string | undefined
  logLevel: string
  logFile: string | undefined
  healthPort: number
  debugTokenDir: string | undefined
  lockToAccountId: string | undefined
  poolSecretFile: string | undefined
  gitSshRewriteHosts: string[]
  gitHostRewrites: Array<[string, string]>
  useAnthropicGitProxy: boolean
  configureGit: boolean
  pushOutcomeOnRelease: boolean
  trustWorkspace: boolean
  confineRepoSettings: ConfineRepoSettings
  /** env keys set via CLI flags (not ambient env) */
  envSetByFlag: Set<string>
}

// ── small densable helpers ─────────────────────────────────────────────────

/** densable `Dd` — integer parse (NaN if invalid) */
export function parseDenseInt(raw: string): number {
  const n = Number(raw)
  if (!Number.isFinite(n)) return Number.NaN
  return Math.trunc(n)
}

/** densable `MV` — positive ms from env; invalid/empty → 0 */
export function readEnvMs(name: string): number {
  const t = process.env[name]
  if (t === undefined || t === '') return 0
  const r = Number(t)
  if (!Number.isFinite(r) || r <= 0) return 0
  return Math.min(r, 2_147_483_647)
}

/** densable `yBh` — drain wait ms (prefer non-deprecated env) */
export function readDrainWaitMs(): number {
  const e = process.env.SELF_HOSTED_RUNNER_DRAIN_WAIT_MS
  if (e !== undefined && e !== '') {
    return readEnvMs('SELF_HOSTED_RUNNER_DRAIN_WAIT_MS')
  }
  return readEnvMs('SELF_HOSTED_RUNNER_DRAIN_WAIT_BG_TASKS_MS')
}

/** densable `bBh` — retire-at env → ms epoch, or 0 */
export function readRetireAtEnvMs(): number {
  const e = process.env.SELF_HOSTED_RUNNER_RETIRE_AT
  if (e === undefined || e === '') return 0
  const t = Number(e)
  if (
    !Number.isSafeInteger(t) ||
    t < RETIRE_AT_MIN_SEC ||
    t > RETIRE_AT_MAX_SEC
  ) {
    return 0
  }
  return t * 1000
}

/** densable `ozv` */
export function parseHealthPortEnv(
  raw: string | undefined,
  fallback: number,
): number {
  if (raw === undefined || raw === '') return fallback
  const r = parseDenseInt(raw)
  if (Number.isNaN(r) || r < 0 || r > 65535) {
    throw new Error(
      `SELF_HOSTED_RUNNER_HEALTH_PORT must be an integer in [0, 65535] (0 disables), got: ${JSON.stringify(raw)}`,
    )
  }
  return r
}

/** densable `izv` */
export function parseTrustWorkspaceEnv(raw: string | undefined): boolean {
  if (isEnvDefinedFalsy(raw)) return false
  if (isEnvTruthy(raw)) return true
  if (raw === undefined || raw.trim() === '') return TRUST_WORKSPACE_DEFAULT
  throw new Error(
    `SELF_HOSTED_RUNNER_TRUST_WORKSPACE must be one of 1/true/yes/on or 0/false/no/off (got: ${JSON.stringify(raw)})`,
  )
}

/** densable `szv` */
export function parseConfineRepoSettingsEnv(
  raw: string | undefined,
): ConfineRepoSettings {
  if (raw === undefined || raw.trim() === '') return 'warn'
  const t = raw.trim().toLowerCase()
  if (t === 'enforce' || t === 'warn' || t === 'off') return t
  throw new Error(
    `SELF_HOSTED_RUNNER_CONFINE_REPO_SETTINGS must be one of enforce/warn/off (got: ${JSON.stringify(raw)})`,
  )
}

/** densable `XJl` — advertised shutdown budget in whole seconds */
export function computeShutdownBudgetSec(
  sessionStopGraceMs: number,
  postSessionHookTimeoutMs: number,
  drainWaitMs = 0,
  pushOutcomeMs = 0,
): number {
  return Math.ceil(
    (sessionStopGraceMs +
      postSessionHookTimeoutMs +
      drainWaitMs +
      pushOutcomeMs +
      SHUTDOWN_BUDGET_PAD_MS) /
      1000,
  )
}

/** densable `IBh` — poll interval from lease_expires_at */
export function derivePollInterval(
  leaseExpiresAt: unknown,
  nowMs: number = Date.now(),
): number {
  if (!leaseExpiresAt) return POLL_ERROR_RETRY_MS
  const t =
    typeof leaseExpiresAt === 'string' || typeof leaseExpiresAt === 'number'
      ? Date.parse(String(leaseExpiresAt))
      : Number.NaN
  if (Number.isNaN(t)) return POLL_ERROR_RETRY_MS
  const r = t - nowMs
  if (r <= 0) return MIN_POLL_INTERVAL_MS
  const n = Math.floor(r / 3)
  return Math.max(MIN_POLL_INTERVAL_MS, Math.min(MAX_POLL_INTERVAL_MS, n))
}

/**
 * densable `L2h` — decode JWT payload; return `ccr:spawn_session_id` or null.
 * Prefix strip: `/^sk-ant-[a-z]+-/` (densable, not sk-ant-*- alphanumeric).
 */
export function extractSpawnSessionId(secret: string): string | null {
  const stripped = secret.replace(/^sk-ant-[a-z]+-/, '')
  const parts = stripped.split('.')
  if (parts.length < 2) return null
  try {
    const b64 = parts[1]!.replace(/-/g, '+').replace(/_/g, '/')
    const pad = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
    const json = JSON.parse(Buffer.from(pad, 'base64').toString('utf8')) as {
      'ccr:spawn_session_id'?: unknown
    }
    const n = json['ccr:spawn_session_id']
    return typeof n === 'string' && n.length > 0 ? n : null
  } catch {
    return null
  }
}

/**
 * densable `CBh` — warn when capacity>1 with session-bound work-order JWT (L2h≠null).
 */
export function sessionBoundCapacityWarning(
  poolSecret: string,
  capacity: number,
): string | null {
  if (capacity <= 1) return null
  if (extractSpawnSessionId(poolSecret) === null) return null
  return (
    `[runner:warn] --capacity ${capacity} has no effect on a session-bound runner: this work order is bound to one session, so this runner will serve exactly one session and the extra ${capacity - 1} slot(s) will not be used. To run multiple concurrent sessions for the same account ` +
    'per runner, register a fixed-fleet runner with the environment secret — see ' +
    'docs/self-hosted-runners-guide.md § "Get started".'
  )
}

/** densable `tR` — promise timeout */
export async function withTimeoutMs<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => {
        reject(new Error(`${label} timed out after ${ms}ms`))
      },
      Math.min(ms, 2_147_483_647),
    )
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    // densable: e.catch(()=>{}) — swallow late rejection of original
    promise.catch(() => {})
  }
}

/** densable `EtE` — baseDir writability check timeout (ms). */
export const BASE_DIR_CHECK_TIMEOUT_MS = 10_000

/**
 * densable `izh` — ensure runner baseDir is creatable + writable.
 * Timeout → fatal exit(1) (NFS/CSI). Other errors throw (caller → exit 2).
 */
export async function ensureBaseDirWritable(
  baseDir: string,
  timeoutMs: number = BASE_DIR_CHECK_TIMEOUT_MS,
): Promise<void> {
  try {
    await withTimeoutMs(
      mkdir(baseDir, { recursive: true }).then(() =>
        access(baseDir, fsConstants.W_OK | fsConstants.X_OK),
      ),
      timeoutMs,
      `base directory check for ${baseDir}`,
    )
  } catch (err) {
    const msg = errMsg(err)
    if (msg.includes('timed out after')) {
      console.error(`[runner:fatal] ${msg} — check NFS/CSI mount health`)
      process.exit(1)
    }
    throw new Error(
      `cannot create or write to base directory ${baseDir} (${getErrnoCode(err) ?? msg}); pass --base-dir <writable path> or set SELF_HOSTED_RUNNER_BASE_DIR`,
    )
  }
}

/** densable `TE` — redact secrets in log lines */
export function redactLogText(text: string): string {
  return text
    .replace(/(\b[a-z][a-z0-9+.-]{0,31}:\/\/)[^@/\s]+@/gi, '$1***:***@')
    .replace(
      /((?:secret|key|token|password|credential)[^=:\s]*\s*[=:]\s*)\S+/gi,
      '$1***',
    )
}

function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

function isAuthFailure(err: unknown): boolean {
  return (
    err instanceof Error &&
    'isAuthFailure' in err &&
    (err as { isAuthFailure?: boolean }).isAuthFailure === true
  )
}

// ── parseArgs (wBh) ────────────────────────────────────────────────────────

/**
 * densable 2.1.229 `n_g` — Windows rejects bare built-in default baseDir.
 * Env (`SELF_HOSTED_RUNNER_BASE_DIR`) and `--base-dir` flag still allowed.
 */
export function assertWindowsBaseDirSource(
  baseDirSource: BaseDirSource,
  platform: NodeJS.Platform = process.platform,
): void {
  if (platform === 'win32' && baseDirSource === 'default') {
    throw new Error(
      '--base-dir (or SELF_HOSTED_RUNNER_BASE_DIR) is required on Windows: the built-in default is a POSIX container path that does not apply there. Pass the directory that repositories should be checked out under.',
    )
  }
}

/**
 * densable `wBh` / `t_g` — parse root runner CLI args.
 * Mutates process.env for timeout/lifetime flags (1:1 densable).
 */
export function parseRootArgs(argv: string[]): RootRunnerArgs {
  const envBaseDir = process.env.SELF_HOSTED_RUNNER_BASE_DIR || undefined
  const t: RootRunnerArgs = {
    apiUrl: DEFAULT_API_URL,
    capacity: DEFAULT_CAPACITY,
    baseDir: pathResolve(envBaseDir ?? DEFAULT_BASE_DIR),
    baseDirSource: envBaseDir === undefined ? 'default' : 'env',
    execPath: process.env.SELF_HOSTED_RUNNER_EXEC_PATH,
    logLevel: 'info',
    logFile: process.env.SELF_HOSTED_RUNNER_LOG_FILE || undefined,
    healthPort: parseHealthPortEnv(
      process.env.SELF_HOSTED_RUNNER_HEALTH_PORT,
      DEFAULT_HEALTH_PORT,
    ),
    debugTokenDir: process.env.SELF_HOSTED_RUNNER_DEBUG_TOKEN_DIR,
    lockToAccountId: process.env.SELF_HOSTED_RUNNER_LOCK_TO_ACCOUNT,
    poolSecretFile: undefined,
    gitSshRewriteHosts: [],
    gitHostRewrites: [],
    useAnthropicGitProxy: isEnvTruthy(process.env.CLAUDE_RUNNER_USE_GIT_PROXY),
    configureGit: isEnvTruthy(process.env.SELF_HOSTED_RUNNER_CONFIGURE_GIT),
    pushOutcomeOnRelease: isEnvTruthy(
      process.env.SELF_HOSTED_RUNNER_PUSH_OUTCOME_ON_RELEASE,
    ),
    trustWorkspace: parseTrustWorkspaceEnv(
      process.env.SELF_HOSTED_RUNNER_TRUST_WORKSPACE,
    ),
    confineRepoSettings: parseConfineRepoSettingsEnv(
      process.env.SELF_HOSTED_RUNNER_CONFINE_REPO_SETTINGS,
    ),
    envSetByFlag: new Set(),
  }

  if (process.env.SELF_HOSTED_RUNNER_HOOKS_DIR) {
    process.env.SELF_HOSTED_RUNNER_HOOKS_DIR = pathResolve(
      process.env.SELF_HOSTED_RUNNER_HOOKS_DIR,
    )
  }

  for (let n = 0; n < argv.length; n++) {
    const o = argv[n]
    const i = argv[n + 1]
    switch (o) {
      case '--api-url':
        if (i) {
          t.apiUrl = i
          n++
        }
        break
      case '--pool-secret-file':
      case '--environment-secret-file':
        if (o === '--pool-secret-file') {
          console.error(
            '[runner:warn] --pool-secret-file is deprecated; use --environment-secret-file',
          )
        }
        if (i) {
          t.poolSecretFile = i
          n++
        }
        break
      case '--capacity':
        if (i) {
          const s = parseDenseInt(i)
          if (Number.isNaN(s) || s < 1) {
            throw new Error(`--capacity must be a positive integer, got: ${i}`)
          }
          t.capacity = s
          n++
        }
        break
      case '--base-dir':
        if (i) {
          t.baseDir = pathResolve(i)
          t.baseDirSource = 'flag'
          n++
        }
        break
      case '--exec-path':
        if (i) {
          t.execPath = i
          n++
        }
        break
      case '--hooks-dir':
        if (i) {
          process.env.SELF_HOSTED_RUNNER_HOOKS_DIR = pathResolve(i)
          n++
        }
        break
      case '--git-ssh-rewrite':
        if (!i) throw new Error('--git-ssh-rewrite requires a hostname')
        t.gitSshRewriteHosts.push(i)
        n++
        break
      case '--git-host-rewrite': {
        if (!i) throw new Error('--git-host-rewrite requires <from>=<to>')
        const s = i.indexOf('=')
        if (s <= 0 || s === i.length - 1) {
          throw new Error(`--git-host-rewrite requires <from>=<to>, got: ${i}`)
        }
        const a = i.slice(0, s).toLowerCase()
        const l = i.slice(s + 1)
        if (
          a.includes('://') ||
          a.includes('/') ||
          l.includes('://') ||
          l.includes('/')
        ) {
          throw new Error(
            `--git-host-rewrite expects bare hostnames (e.g. ext.example.com=int.example.com), not URLs. Got: ${i}`,
          )
        }
        if (t.gitHostRewrites.some(([c]) => c === a)) {
          throw new Error(`duplicate --git-host-rewrite for '${a}'`)
        }
        t.gitHostRewrites.push([a, l])
        n++
        break
      }
      case '--use-anthropic-git-proxy':
        t.useAnthropicGitProxy = true
        break
      case '--configure-git':
        t.configureGit = true
        break
      case '--push-outcome-on-release':
        t.pushOutcomeOnRelease = true
        break
      case '--trust-workspace':
        if (i === 'false' || i === '0') {
          t.trustWorkspace = false
          n++
        } else if (i === 'true' || i === '1') {
          t.trustWorkspace = true
          n++
        } else {
          t.trustWorkspace = true
        }
        break
      case '--confine-repo-settings':
        if (i === 'enforce' || i === 'warn' || i === 'off') {
          t.confineRepoSettings = i
          n++
        } else {
          throw new Error(
            `--confine-repo-settings requires one of enforce/warn/off (got: ${JSON.stringify(i)})`,
          )
        }
        break
      case '--log-level':
        if (i) {
          t.logLevel = i
          n++
        }
        break
      case '--log-file':
        if (i) {
          t.logFile = i
          n++
        }
        break
      case '--health-port':
        if (i) {
          const s = parseDenseInt(i)
          if (Number.isNaN(s) || s < 0 || s > 65535) {
            throw new Error(
              `--health-port must be an integer in [0, 65535] (0 disables), got: ${i}`,
            )
          }
          t.healthPort = s
          n++
        }
        break
      case '--kill-session-after-min': {
        if (i) {
          const s = Number(i)
          if (!Number.isFinite(s) || s < 0 || s > MAX_MINUTES_FLAG) {
            throw new Error(
              `--kill-session-after-min must be a non-negative number of minutes (0 disables, max ${MAX_MINUTES_FLAG}), got: ${i}`,
            )
          }
          process.env.SELF_HOSTED_RUNNER_MAX_LIFETIME_MS = String(s * 60 * 1000)
          t.envSetByFlag.add('SELF_HOSTED_RUNNER_MAX_LIFETIME_MS')
          n++
        }
        break
      }
      case '--exit-if-unused-min': {
        if (i) {
          const s = Number(i)
          if (!Number.isFinite(s) || s < 0 || s > MAX_MINUTES_FLAG) {
            throw new Error(
              `--exit-if-unused-min must be a non-negative number of minutes (0 disables, max ${MAX_MINUTES_FLAG}), got: ${i}`,
            )
          }
          process.env.SELF_HOSTED_RUNNER_IDLE_SHUTDOWN_MS = String(
            s * 60 * 1000,
          )
          t.envSetByFlag.add('SELF_HOSTED_RUNNER_IDLE_SHUTDOWN_MS')
          n++
        }
        break
      }
      case '--session-stop-grace-sec': {
        const s = argv[++n]
        const a = Number(s)
        if (!s || !Number.isFinite(a) || a <= 0) {
          throw new Error(
            `--session-stop-grace-sec must be a positive number of seconds, got: ${s}`,
          )
        }
        process.env.SELF_HOSTED_RUNNER_SESSION_STOP_GRACE_MS = String(a * 1000)
        break
      }
      case '--sigkill-timeout-sec':
        throw new Error(
          '--sigkill-timeout-sec was renamed to --session-stop-grace-sec. It controls how long to wait for the Claude process to exit cleanly after a session ends, before force-killing it. The post-session hook runs after this.',
        )
      case '--post-session-hook-timeout-sec': {
        const s = argv[++n]
        const a = Number(s)
        if (!s || !Number.isFinite(a) || a <= 0) {
          throw new Error(
            `--post-session-hook-timeout-sec must be a positive number of seconds, got: ${s}`,
          )
        }
        process.env.SELF_HOSTED_RUNNER_POST_SESSION_HOOK_TIMEOUT_MS = String(
          a * 1000,
        )
        break
      }
      case '--drain-wait-bg-tasks-sec':
      case '--drain-wait-sec': {
        if (o === '--drain-wait-bg-tasks-sec') {
          console.error(
            '[runner:warn] --drain-wait-bg-tasks-sec is deprecated; use --drain-wait-sec (it now also waits for an in-flight foreground turn, not only background tasks)',
          )
        }
        const s = argv[++n]
        const a = Number(s)
        if (!s || !Number.isFinite(a) || a < 0 || a > 86_400) {
          throw new Error(
            `${o} must be a non-negative number of seconds (max 86400), got: ${s}`,
          )
        }
        process.env.SELF_HOSTED_RUNNER_DRAIN_WAIT_MS = String(a * 1000)
        break
      }
      case '--drain-grace-sec': {
        if (i) {
          const s = Number(i)
          if (!Number.isFinite(s) || s < 0 || s > MAX_DRAIN_GRACE_SEC) {
            throw new Error(
              `--drain-grace-sec must be a non-negative number of seconds (0 = immediate, max ${MAX_DRAIN_GRACE_SEC}), got: ${i}`,
            )
          }
          process.env.SELF_HOSTED_RUNNER_DRAIN_GRACE_MS = String(s * 1000)
          n++
        }
        break
      }
      case '--release-idle-session-min': {
        if (i) {
          const s = Number(i)
          if (!Number.isFinite(s) || s < 0 || s > MAX_MINUTES_FLAG) {
            throw new Error(
              `--release-idle-session-min must be a non-negative number of minutes (0 disables, max ${MAX_MINUTES_FLAG}), got: ${i}`,
            )
          }
          process.env.SELF_HOSTED_RUNNER_SESSION_IDLE_MS = String(s * 60 * 1000)
          t.envSetByFlag.add('SELF_HOSTED_RUNNER_SESSION_IDLE_MS')
          n++
        }
        break
      }
      case '--startup-timeout-min': {
        if (i) {
          const s = Number(i)
          if (!Number.isFinite(s) || s < 0 || s > MAX_MINUTES_FLAG) {
            throw new Error(
              `--startup-timeout-min must be a non-negative number of minutes (0 disables, max ${MAX_MINUTES_FLAG}), got: ${i}`,
            )
          }
          process.env.SELF_HOSTED_RUNNER_STARTUP_TIMEOUT_MS = String(
            s * 60 * 1000,
          )
          t.envSetByFlag.add('SELF_HOSTED_RUNNER_STARTUP_TIMEOUT_MS')
          n++
        }
        break
      }
      case '--retire-at': {
        const s = argv[++n]
        const a = Number(s)
        if (
          !s ||
          !Number.isSafeInteger(a) ||
          a < RETIRE_AT_MIN_SEC ||
          a > RETIRE_AT_MAX_SEC
        ) {
          throw new Error(
            `--retire-at must be an absolute Unix timestamp in whole SECONDS (e.g. the output of 'date +%s' plus the runner's intended lifetime — not milliseconds, not a duration), got: ${s}`,
          )
        }
        process.env.SELF_HOSTED_RUNNER_RETIRE_AT = String(a)
        break
      }
      case '--lock-to-account':
        if (i) {
          t.lockToAccountId = i
          n++
        }
        break
      case '--debug-token-dir':
        if (i) {
          t.debugTokenDir = i
          n++
        }
        break
      default:
        if (o?.startsWith('--')) throw new Error(`unknown flag ${o}`)
        if (o === '') {
          throw new Error(
            'empty argument — a flag value may be unset (failed env/K8s substitution?)',
          )
        }
        if (o !== undefined) {
          throw new Error(
            `unexpected argument '${o}' — this command takes no positional arguments`,
          )
        }
        break
    }
  }

  const rewriteHosts = new Set(t.gitSshRewriteHosts.map(n => n.toLowerCase()))
  for (const [n, o] of t.gitHostRewrites) {
    if (rewriteHosts.has(n)) {
      console.error(
        `[runner:warn] --git-ssh-rewrite '${n}' will not match: --git-host-rewrite rewrites it to '${o}' first. Did you mean --git-ssh-rewrite '${o}'?`,
      )
    }
  }
  return t
}

// ── resolve secret / exec ──────────────────────────────────────────────────

/** densable `ABh` */
export async function resolveEnvironmentSecret(
  args: Pick<RootRunnerArgs, 'poolSecretFile'>,
): Promise<string> {
  if (args.poolSecretFile) {
    let n: string
    try {
      n = await withTimeoutMs(
        readFile(args.poolSecretFile, { encoding: 'utf-8' }),
        SECRET_READ_TIMEOUT_MS,
        `environment-secret read from ${args.poolSecretFile}`,
      )
    } catch (o) {
      const i = errMsg(o)
      if (i.includes('timed out after')) {
        console.error(`[runner:fatal] ${i} — check CSI/secret mount health`)
        process.exit(1)
      }
      throw new Error(
        `Failed to read environment secret file ${args.poolSecretFile}: ${i}`,
      )
    }
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

/** densable `RBh` */
export function resolveExec(execPath: string | undefined): {
  execPath: string
  execArgs: string[]
} {
  if (execPath) return { execPath, execArgs: [] }
  // densable `lb()` — bun: no script arg; node: pass argv[1]
  const isBun = typeof (process.versions as { bun?: string }).bun === 'string'
  return {
    execPath: process.execPath,
    execArgs: isBun ? [] : process.argv[1] ? [process.argv[1]] : [],
  }
}

// ── help ───────────────────────────────────────────────────────────────────

export function formatRootHelp(): string {
  const stopGrace = DEFAULT_SESSION_STOP_GRACE_MS / 1000
  const postHook = DEFAULT_POST_SESSION_HOOK_TIMEOUT_MS / 1000
  return `Usage: claude self-hosted-runner [options]

Connection:
  --api-url <url>             API base URL (default: ${DEFAULT_API_URL})
  --environment-secret-file <path>
                              Path to environment secret file (or set SELF_HOSTED_RUNNER_ENVIRONMENT_SECRET)
                              (--pool-secret-file / SELF_HOSTED_RUNNER_POOL_SECRET are deprecated aliases.)
  --lock-to-account <id>      Lock runner to a single account at registration (webhook-driven on-demand
                              spawn). Only that account's sessions are assigned.
                              [env: SELF_HOSTED_RUNNER_LOCK_TO_ACCOUNT]

Runtime:
  --capacity <n>              Max concurrent sessions (default: ${DEFAULT_CAPACITY})
  --base-dir <path>           Base directory for repo checkouts (default: ${DEFAULT_BASE_DIR})
                              [env: SELF_HOSTED_RUNNER_BASE_DIR]
  --exec-path <path>          Binary to spawn for child sessions. Default: this process's own binary.
                              [env: SELF_HOSTED_RUNNER_EXEC_PATH]
  --hooks-dir <path>          Directory of lifecycle hook scripts (checkout, command, post-session).
                              Absent hooks fall through to built-in behavior.
                              [env: SELF_HOSTED_RUNNER_HOOKS_DIR]
  --session-stop-grace-sec <n>
                              How long to wait for the Claude process to exit cleanly after a
                              session ends, before force-killing it. The post-session hook runs
                              after this. Default: ${stopGrace}.
                              [env: SELF_HOSTED_RUNNER_SESSION_STOP_GRACE_MS, in ms]
  --post-session-hook-timeout-sec <n>
                              SIGTERM budget for the post-session lifecycle hook, on every session
                              end including runner shutdown. Default: ${postHook}.
                              [env: SELF_HOSTED_RUNNER_POST_SESSION_HOOK_TIMEOUT_MS, in ms]
  --drain-wait-sec <n>        On SIGTERM/SIGINT, wait up to N seconds for each session's in-flight
                              turn and running background tasks before sending the session process
                              its SIGTERM. Default: 0. Max: 86400.
                              [env: SELF_HOSTED_RUNNER_DRAIN_WAIT_MS, in ms]
  --git-ssh-rewrite <host>    Rewrite https://<host>/... to git@<host>:... (repeatable).
  --git-host-rewrite <f>=<t>  Rewrite https://<f>/... to https://<t>/... (repeatable).
  --use-anthropic-git-proxy   Clone via Anthropic's git proxy.
                              [env: CLAUDE_RUNNER_USE_GIT_PROXY=1]
  --configure-git             Set global git identity + commit signing via Anthropic signing service.
                              [env: SELF_HOSTED_RUNNER_CONFIGURE_GIT=1]
  --push-outcome-on-release   Push outcome branches on runner-initiated non-completed session end.
                              [env: SELF_HOSTED_RUNNER_PUSH_OUTCOME_ON_RELEASE=1]
  --trust-workspace [bool]    Trust workspace (default: ${TRUST_WORKSPACE_DEFAULT}).
                              [env: SELF_HOSTED_RUNNER_TRUST_WORKSPACE]
  --confine-repo-settings <mode>
                              enforce | warn | off (default: warn).
                              [env: SELF_HOSTED_RUNNER_CONFINE_REPO_SETTINGS]
  --health-port <n>           Health HTTP port (default: ${DEFAULT_HEALTH_PORT}; 0 disables).
                              [env: SELF_HOSTED_RUNNER_HEALTH_PORT]
  --log-level <level>         Log level (default: info)
  --log-file <path>           Append logs to file
                              [env: SELF_HOSTED_RUNNER_LOG_FILE]
  --kill-session-after-min <n>
  --exit-if-unused-min <n>
  --release-idle-session-min <n>
  --startup-timeout-min <n>
  --retire-at <unix-seconds>
  --debug-token-dir <path>
  --help, -h                  Show this help message

go-hare 2.1.224 #1: parse/secret/register/session-spawn/hooks/health/SSE/idle-retire-drain HAVE;
git proxy/configure + aWd/bjv/outcome + full Ane + kjv confine + trust D seed + rBh residual (B2h/Zt/z2h/Fjv/xjv/$e/qUi/unlink/Be/F2h/AKn/sjv-governed) HAVE.
`
}

// ── retry (Krr subset) ─────────────────────────────────────────────────────

export async function retryAsync<T>(
  fn: () => Promise<T>,
  opts: {
    initialDelayMs: number
    maxDelayMs: number
    maxAttempts?: number
    shouldRetry?: (err: unknown) => boolean
    onRetry?: (attempt: number, err: unknown) => void
    signal?: AbortSignal
  },
): Promise<T | undefined> {
  let r = opts.initialDelayMs
  let n = 0
  for (;;) {
    if (opts.signal?.aborted) return undefined
    n++
    try {
      return await fn()
    } catch (o) {
      if (opts.shouldRetry && !opts.shouldRetry(o)) throw o
      if (opts.maxAttempts !== undefined && n >= opts.maxAttempts) throw o
      opts.onRetry?.(n, o)
      const i = r * (0.75 + Math.random() * 0.5)
      await sleepMs(i, opts.signal)
      r = Math.min(r * 2, opts.maxDelayMs)
    }
  }
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

// ── poll loop (xBh — full recovered densable path) ─────────────────────────

export type PollSkeletonOpts = {
  apiClient: SelfHostedRunnerApi
  runnerId: string
  tokenState: { runnerToken: string }
  capacity: number
  baseDir?: string
  execPath?: string
  execArgs?: string[]
  healthPort?: number
  apiUrl?: string
  healthState?: RunnerHealthState
  gitSshRewriteHosts?: string[]
  gitHostRewrites?: Array<[string, string]>
  pushOutcomeOnRelease?: boolean
  trustWorkspace?: boolean
  confineRepoSettings?: ConfineRepoSettings
  useAnthropicGitProxy?: boolean
  onStatus: (msg: string) => void
  onDebug: (msg: string) => void
  /**
   * densable test/inject: when true, return after first assignment without
   * waiting for session completion (still runs handleSession if handleSessionFn set).
   * Default false — full handleSession path.
   */
  exitOnAssignment?: boolean
  /** when true (default when exitOnAssignment), skip real spawn (tests). */
  skipSessionSpawn?: boolean
  pollIntervalOverrideMs?: number
  handleSessionFn?: typeof HandleSessionFn
  /** densable `sseHintsEnabledOverride ?? hr(CCR_SHR_SSE_HINTS)` */
  sseHintsEnabledOverride?: boolean
  openWorkHintsStream?: (opts: OpenWorkHintsStreamOpts) => WorkHintsStreamHandle
  retireAtMsOverride?: number
  retireReleaseRetryMsOverride?: number
  retireDeferredGraceMsOverride?: number
  drainTimeoutMs?: number
  shutdownLeaseHeartbeatMs?: number
  flushLogSink?: () => Promise<void>
  /** densable debugTokenDir */
  debugTokenDir?: string
  /** densable hostConfigSnapshot (Q2h) — passed through to handleSession */
  hostConfigSnapshot?: HostConfigSnapshot
  /** densable governedGitConfigSeed (eBh) */
  governedGitConfigSeed?: string
  /** densable runner-token refresh scheduler (qUi) — cancelAll on exit */
  runnerTokenRefresh?: TokenRefreshScheduler
  /**
   * densable `useAnthropicGitProxy: t.apiUrl` — api base URL when proxy on
   * (not a boolean). Prefer this over `useAnthropicGitProxy` boolean alone.
   */
  anthropicGitProxyBaseUrl?: string
  /** densable `D` / gitProxyGlobalConfigPath */
  gitProxyGlobalConfigPath?: string
  /** densable `K` / gitProxyGlobalConfigSnapshot */
  gitProxyGlobalConfigSnapshot?: string
  /** densable `j` / gitProxyCredHelper */
  gitProxyCredHelper?: { path: string; content: string }
  /** densable `B` / configureGitHookStubs */
  configureGitHookStubs?: GitArtifactFile[]
  /** densable `V` / configureGitSigningArtifacts */
  configureGitSigningArtifacts?: GitArtifactFile[]
  /** densable `S` — shared canonical sanitize locks across sessions */
  canonicalLocks?: Map<string, Promise<unknown>>
}

type ActiveSessionSlot = {
  task: Promise<unknown>
  controller: AbortController
  liveBgTasks: number
  turnInFlight: boolean
  releaseForRetire: () => void
}

/**
 * densable `xBh` — poll for work; on assignment call handleSession (rBh).
 * Includes SSE wake, idle/retire/deassign/release, drain teardown.
 */
export async function runPollSkeleton(
  opts: PollSkeletonOpts,
  signal: AbortSignal,
): Promise<'drained' | 'assignment-blocked' | 'auth-failed' | 'aborted'> {
  const exitOnAssignment = opts.exitOnAssignment === true
  const api = opts.apiClient
  const health = opts.healthState
  const sessionStopGraceMs =
    readEnvMs('SELF_HOSTED_RUNNER_SESSION_STOP_GRACE_MS') ||
    DEFAULT_SESSION_STOP_GRACE_MS
  const postSessionHookTimeoutMs =
    readEnvMs('SELF_HOSTED_RUNNER_POST_SESSION_HOOK_TIMEOUT_MS') ||
    DEFAULT_POST_SESSION_HOOK_TIMEOUT_MS
  const drainWaitMs = readDrainWaitMs()
  const idleShutdownMs = readEnvMs('SELF_HOSTED_RUNNER_IDLE_SHUTDOWN_MS')
  const drainGraceMs = readEnvMs('SELF_HOSTED_RUNNER_DRAIN_GRACE_MS')
  const sessionIdleMs = readEnvMs('SELF_HOSTED_RUNNER_SESSION_IDLE_MS')
  const startupTimeoutRaw = process.env.SELF_HOSTED_RUNNER_STARTUP_TIMEOUT_MS
  const startupTimeoutMs =
    startupTimeoutRaw === undefined || startupTimeoutRaw === ''
      ? DEFAULT_STARTUP_TIMEOUT_MS
      : readEnvMs('SELF_HOSTED_RUNNER_STARTUP_TIMEOUT_MS')
  const retireAtMs = opts.retireAtMsOverride ?? readRetireAtEnvMs()
  const retireReleaseRetryMs =
    opts.retireReleaseRetryMsOverride ?? RETIRE_RELEASE_RETRY_MS
  const retireDeferredGraceMs =
    opts.retireDeferredGraceMsOverride ?? RETIRE_DEFERRED_GRACE_MS

  const active = new Map<string, ActiveSessionSlot>()
  const stuckSessions = new Set<string>()
  const failureInFlight = new Set<string>()
  const releasedAwaitingDeassign = new Set<string>()
  const releaseFalseCounts = new Map<string, number>()
  const retireSkipLogged = new Set<string>()
  const platformBySession = new Map<string, string>()
  let consecutive404 = 0
  let lastPollAt = Date.now()
  let sessionsHandled = 0
  let successfulPolls = 0
  let idleSince: number | null = null
  let sawAnyAssignment = false
  let retiring = false
  let retireTimer: ReturnType<typeof setTimeout> | undefined
  let drainNotify: (() => void) | undefined

  const sseEnabled =
    opts.sseHintsEnabledOverride ?? isSseHintsEnabled(process.env)
  const wakeQueue = new PollWakeQueue()
  const openStream = opts.openWorkHintsStream ?? openWorkHintsStream
  let sseHandle: WorkHintsStreamHandle | undefined
  if (sseEnabled) {
    opts.onDebug('[runner:hints] CCR_SHR_SSE_HINTS enabled — opening stream')
    const baseUrl = opts.apiUrl ?? DEFAULT_API_URL
    sseHandle = openStream({
      baseUrl,
      runnerId: opts.runnerId,
      tokenState: opts.tokenState,
      onWake: () => wakeQueue.wake('SSE'),
      onDebug: opts.onDebug,
      signal,
    })
  }

  const armRetireTimer = (): void => {
    retireTimer = undefined
    const remaining = retireAtMs - Date.now()
    if (remaining > 0) {
      retireTimer = setTimeout(
        armRetireTimer,
        Math.min(remaining, 2_147_483_647),
      )
      return
    }
    retiring = true
    opts.onStatus(
      `[runner:retire] retire time reached — releasing ${active.size} active session(s), refusing new work; exiting once the slots are empty`,
    )
    for (const slot of active.values()) slot.releaseForRetire()
  }
  if (retireAtMs > 0) {
    const remaining = retireAtMs - Date.now()
    opts.onStatus(
      remaining > 0
        ? `[runner:retire] retire time set for ${new Date(retireAtMs).toISOString()} (in ${formatDelayMs(remaining)}) — sessions will be released and the runner will exit then`
        : `[runner:retire] retire time ${new Date(retireAtMs).toISOString()} is already in the past — refusing work and exiting`,
    )
    armRetireTimer()
  }

  try {
    while (!signal.aborted) {
      if (retiring && active.size === 0) {
        opts.onStatus(
          '[runner:exit] retire time passed and no active sessions — exiting before the host kills this runner.',
        )
        return 'drained'
      }
      if (drainGraceMs === 0 && sawAnyAssignment && active.size === 0) {
        opts.onStatus(
          '[runner:exit] account workload drained — exiting (grace=0, no re-poll). Orchestrator will restart.',
        )
        return 'drained'
      }

      const available = retiring ? 0 : Math.max(0, opts.capacity - active.size)
      const wakeSrc = wakeQueue.consume()
      if (wakeSrc === 'SSE') {
        await sleepMs(Math.floor(Math.random() * SSE_WAKE_JITTER_MS), signal)
        if (signal.aborted) break
      }

      const pollStartedAt = lastPollAt
      let assignmentIds: string[]
      let lease: unknown
      try {
        const work = await api.pollWork(
          opts.tokenState.runnerToken,
          opts.runnerId,
          available,
          signal,
          sseEnabled ? POLL_WAKE_SOURCE_WIRE[wakeSrc] : undefined,
        )
        assignmentIds = work.assignment_ids
        lease = work.lease_expires_at
        platformBySession.clear()
        const assignments = (
          work as {
            session_assignments?: Array<{
              session_id?: string
              client_platform?: string
            }>
          }
        ).session_assignments
        if (Array.isArray(assignments)) {
          for (const a of assignments) {
            if (
              a.session_id &&
              a.client_platform &&
              /^[A-Za-z0-9_.-]{1,64}$/.test(a.client_platform)
            ) {
              platformBySession.set(a.session_id, a.client_platform)
            }
          }
        }
        lastPollAt = Date.now()
        consecutive404 = 0
        if (health) {
          health.lastPollAt = lastPollAt
          health.activeSessions = active.size
        }
      } catch (err) {
        if (signal.aborted) break
        if (health) health.pollErrors[classifyPollError(err)]++
        const msg = errMsg(err)
        if (isAuthFailure(err)) {
          opts.onStatus(
            '[runner:fatal] poll auth failed — token expired or revoked. Draining and exiting for clean restart.',
          )
          return 'auth-failed'
        }
        const status =
          err !== null &&
          typeof err === 'object' &&
          typeof (err as { httpStatus?: unknown }).httpStatus === 'number'
            ? (err as { httpStatus: number }).httpStatus
            : undefined
        if (status === 404) {
          consecutive404++
          if (consecutive404 >= 3) {
            opts.onStatus(
              `[runner:fatal] poll returned 404 ${consecutive404}× — runner record gone server-side. Draining and exiting for clean restart.`,
            )
            return 'auth-failed'
          }
          const delay = Math.min(
            POLL_404_BACKOFF_MAX_MS,
            POLL_404_BACKOFF_BASE_MS * 2 ** (consecutive404 - 1),
          )
          const jitter = Math.floor(Math.random() * delay)
          opts.onStatus(
            `Poll failed: ${msg} — confirming 404 (${consecutive404}/3), retrying in ${(jitter / 1000).toFixed(1)}s`,
          )
          await sleepMs(opts.pollIntervalOverrideMs ?? jitter, signal)
          continue
        }
        consecutive404 = 0
        opts.onStatus(
          `Poll failed: ${msg} — retrying in ${POLL_ERROR_RETRY_MS / 1000}s`,
        )
        await sleepMs(
          opts.pollIntervalOverrideMs ?? POLL_ERROR_RETRY_MS,
          signal,
        )
        continue
      }

      const fresh = assignmentIds.filter(id => !stuckSessions.has(id))
      if (fresh.length === 0 && active.size === 0) {
        idleSince ??= Date.now()
        const idleFor = Date.now() - idleSince
        if (sawAnyAssignment) {
          if (idleFor >= drainGraceMs) {
            opts.onStatus(
              retiring
                ? '[runner:exit] retire time passed and no active sessions — exiting before the host kills this runner.'
                : drainGraceMs > 0
                  ? `[runner:exit] account workload drained ${Math.round(idleFor / 1000)}s ago (grace ${Math.round(drainGraceMs / 1000)}s) — exiting for fresh disk. Orchestrator will restart.`
                  : '[runner:exit] account workload drained — exiting for fresh disk. Orchestrator will restart.',
            )
            return 'drained'
          }
        } else if (idleShutdownMs > 0 && idleFor >= idleShutdownMs) {
          opts.onStatus(
            `[runner:exit] idle ${Math.round(idleFor / 60000)}min with no work — exiting for autoscaler scale-down`,
          )
          return 'drained'
        }
      } else {
        idleSince = null
      }
      if (fresh.length > 0) sawAnyAssignment = true

      const assignedSet = new Set(assignmentIds)
      for (const [sid, slot] of active) {
        if (!assignedSet.has(sid)) {
          opts.onStatus(
            `[runner:session] ${sid} deassigned by server (deleted/archived/requeued) — aborting child`,
          )
          slot.controller.abort(
            releasedAwaitingDeassign.has(sid) ? 'idle-release' : 'deassign',
          )
        }
      }
      for (const sid of [...releasedAwaitingDeassign]) {
        if (!assignedSet.has(sid)) releasedAwaitingDeassign.delete(sid)
      }
      for (const sid of [...releaseFalseCounts.keys()]) {
        if (!assignedSet.has(sid)) releaseFalseCounts.delete(sid)
      }

      if (
        fresh.length > 0 &&
        exitOnAssignment &&
        opts.skipSessionSpawn !== false
      ) {
        opts.onStatus(`Picked up session(s): ${fresh.join(', ')}`)
        return 'assignment-blocked'
      }

      const baseDir = opts.baseDir ?? DEFAULT_BASE_DIR
      const exec =
        opts.execPath !== undefined
          ? { execPath: opts.execPath, execArgs: opts.execArgs ?? [] }
          : resolveExec(undefined)
      const handlePromise = opts.handleSessionFn
        ? Promise.resolve(opts.handleSessionFn)
        : import('./sessionHandler.js').then(m => m.handleSession)

      for (const sessionId of fresh) {
        if (active.has(sessionId)) {
          opts.onDebug(
            `[runner:main] Ignoring duplicate assignment for ${sessionId}`,
          )
          continue
        }
        if (stuckSessions.has(sessionId)) {
          opts.onDebug(
            `[runner:main] Ignoring stuck session ${sessionId} — already failed, not re-spawning`,
          )
          continue
        }
        if (failureInFlight.has(sessionId)) {
          opts.onDebug(
            `[runner:main] Ignoring session ${sessionId} — failure report in-flight`,
          )
          continue
        }
        if (releasedAwaitingDeassign.has(sessionId)) {
          opts.onDebug(
            `[runner:main] Ignoring released session ${sessionId} — awaiting server deassign`,
          )
          continue
        }
        if (retiring) {
          const msg = `[runner:retire] not starting session ${sessionId} — retire time has passed; it will be requeued when this runner exits`
          if (retireSkipLogged.has(sessionId)) opts.onDebug(msg)
          else {
            retireSkipLogged.add(sessionId)
            opts.onStatus(msg)
          }
          continue
        }

        sessionsHandled++
        opts.onStatus(
          `Picked up session ${sessionId} (${active.size + 1}/${opts.capacity} active)`,
        )
        const childAc = new AbortController()
        const metricsSid = sessionId.replace(/^cse_/, 'session_')
        const clientPlatform =
          platformBySession.get(sessionId) ?? UNKNOWN_CLIENT_PLATFORM
        if (health) {
          health.sessionIdle.set(metricsSid, null)
          health.sessionClientPlatform.set(metricsSid, clientPlatform)
          for (const m of [
            health.sessionsStarted,
            health.sessionsCompleted,
            health.sessionsFailed,
            health.sessionsInterrupted,
          ]) {
            if (!m.has(clientPlatform)) m.set(clientPlatform, 0)
          }
        }

        let idleTimer: ReturnType<typeof setTimeout> | undefined
        let finished = false
        let turnInFlight = false
        let deferredHold = false
        let lastIdleKind: SessionActivityKind | undefined
        let initObserved = false
        let retireAttempt = 0
        let retireBgTimer: ReturnType<typeof setTimeout> | undefined
        let deferredRemindTimer: ReturnType<typeof setTimeout> | undefined
        let retiringThis = false

        const clearIdleTimer = (): void => {
          if (idleTimer !== undefined) {
            clearTimeout(idleTimer)
            idleTimer = undefined
          }
        }
        const clearDeferredRemind = (): void => {
          if (deferredRemindTimer !== undefined) {
            clearTimeout(deferredRemindTimer)
            deferredRemindTimer = undefined
          }
        }
        const clearRetireBg = (): void => {
          if (retireBgTimer !== undefined) {
            clearTimeout(retireBgTimer)
            retireBgTimer = undefined
          }
        }
        const setTurn = (v: boolean): void => {
          turnInFlight = v
          const slot = active.get(sessionId)
          if (slot) slot.turnInFlight = v
          drainNotify?.()
        }
        const armDeferredRemind = (
          snap: BgTaskSnapshot | undefined,
          idx: number,
        ): void => {
          const live = snap?.liveTasks ?? 0
          const ids = (snap?.liveTaskIds ?? []).slice(0, 5).join(',')
          const wakeup =
            snap?.wakeupInMs !== undefined
              ? `wakeup pending in ${formatDelayMs(snap.wakeupInMs)}`
              : undefined
          const parts = [
            live > 0
              ? `${live} background task(s) live [${ids}${live > 5 ? ',…' : ''}]`
              : undefined,
            wakeup,
          ].filter(Boolean)
          const why =
            parts.length > 0 ? parts.join(' / ') : 'planned resumption'
          const still = idx > 0 ? ' still' : ''
          opts.onStatus(
            `[runner:session] ${sessionId} turn ended with ${why} — idle clock${still} deferred`,
          )
          if (idx < DEFERRED_HOLD_REMINDERS_MS.length) {
            deferredRemindTimer = setTimeout(
              armDeferredRemind,
              DEFERRED_HOLD_REMINDERS_MS[idx],
              snap,
              idx + 1,
            )
          }
        }

        const armIdleClock = (
          kind: SessionActivityKind,
          snap?: BgTaskSnapshot,
        ): void => {
          clearIdleTimer()
          if (!finished && health) {
            if (
              kind === 'turn-end' ||
              (kind === 'awaiting-action' && !deferredHold)
            ) {
              if (health.sessionIdle.get(metricsSid) === null) {
                health.sessionIdle.set(metricsSid, Date.now())
              }
            } else {
              health.sessionIdle.set(metricsSid, null)
            }
          }
          if (kind === 'init-observed') {
            if (initObserved && lastIdleKind !== undefined) {
              armIdleClock(lastIdleKind)
            }
            return
          }
          if (kind === 'activity') {
            setTurn(true)
            deferredHold = false
            lastIdleKind = undefined
            retireAttempt = 0
            clearDeferredRemind()
            clearIdleTimer()
            releaseFalseCounts.delete(sessionId)
            return
          }
          if (kind === 'turn-end-deferred') {
            setTurn(false)
            deferredHold = true
            lastIdleKind = undefined
            clearDeferredRemind()
            if (sessionIdleMs > 0) armDeferredRemind(snap, 0)
            if (initObserved) maybeReleaseAfterRetireWithBg()
            return
          }
          if (kind === 'awaiting-action' && deferredHold) {
            lastIdleKind = undefined
            return
          }
          clearDeferredRemind()
          clearIdleTimer()
          setTurn(false)
          deferredHold = false
          lastIdleKind = kind
          const baseMs = initObserved
            ? retireAttempt === 0
              ? 0
              : retireReleaseRetryMs
            : kind === 'startup'
              ? startupTimeoutMs
              : sessionIdleMs
          const waitMs = initObserved ? retireReleaseRetryMs : baseMs
          const whenLabel = (): string =>
            initObserved
              ? retireAttempt === 0
                ? 'now'
                : `in ${formatDelayMs(retireReleaseRetryMs)}`
              : `in ${formatDelayMs(waitMs)}`
          const why = initObserved
            ? 'retire time passed'
            : kind === 'startup'
              ? `no child output for ${formatDelayMs(baseMs)}`
              : kind === 'awaiting-action'
                ? `awaiting user action ${formatDelayMs(baseMs)}`
                : `user idle ${formatDelayMs(baseMs)}`
          if (!initObserved && baseMs <= 0) return
          if (finished || childAc.signal.aborted) return
          if (
            kind === 'awaiting-action' &&
            snap !== undefined &&
            (snap.liveTasks > 0 || snap.wakeupInMs !== undefined)
          ) {
            const ids = snap.liveTaskIds.slice(0, 5).join(',')
            const parts = [
              snap.liveTasks > 0
                ? `${snap.liveTasks} background task(s) live [${ids}${snap.liveTasks > 5 ? ',…' : ''}]`
                : undefined,
              snap.wakeupInMs !== undefined
                ? `wakeup pending in ${formatDelayMs(snap.wakeupInMs)}`
                : undefined,
            ].filter(Boolean)
            opts.onStatus(
              `[runner:session] ${sessionId} awaiting user action overrides deferral (${parts.join(' / ')}) — idle clock armed`,
            )
          }
          if (!initObserved) {
            opts.onStatus(
              `[runner:session] ${sessionId} idle clock armed (${kind}): releases in ${formatDelayMs(baseMs)} at ${new Date(Date.now() + baseMs).toISOString()} unless new activity arrives`,
            )
          }
          idleTimer = setTimeout(() => {
            idleTimer = undefined
            if (finished || childAc.signal.aborted) return
            if (releasedAwaitingDeassign.has(sessionId)) return
            if (turnInFlight) {
              opts.onStatus(
                `[runner:session] ${sessionId} idle timer fired mid-turn — skipping release (stdout-tee likely broken)`,
              )
              return
            }
            if (initObserved) retireAttempt++
            opts.onStatus(`[runner:session] ${sessionId} ${why} — releasing`)
            releasedAwaitingDeassign.add(sessionId)
            void api
              .releaseSession(opts.tokenState.runnerToken, sessionId)
              .then(({ released }) => {
                if (released) {
                  if (finished || childAc.signal.aborted) return
                  releaseFalseCounts.delete(sessionId)
                  opts.onStatus(
                    `[runner:session] ${sessionId} released — aborting child`,
                  )
                  const bg = active.get(sessionId)?.liveBgTasks ?? 0
                  childAc.abort('idle-release')
                  if (turnInFlight || deferredHold || bg > 0) {
                    /* densable Oe released_true_mid_work */
                  }
                  return
                }
                if (finished || childAc.signal.aborted) return
                releasedAwaitingDeassign.delete(sessionId)
                if (initObserved) {
                  opts.onStatus(
                    `[runner:session] ${sessionId} release declined (${kind === 'awaiting-action' ? 'queued event behind the parked prompt' : 'pending user event'}) while retiring — keeping session${turnInFlight || deferredHold ? '' : `, retrying ${whenLabel()}`}`,
                  )
                  if (!turnInFlight && !deferredHold) armIdleClock(kind)
                  return
                }
                if (kind === 'awaiting-action') {
                  opts.onStatus(
                    `[runner:session] ${sessionId} released=false while parked at prompt (queued event behind prompt) — keeping session${turnInFlight || deferredHold ? '' : ', re-arming'}`,
                  )
                  if (!turnInFlight && !deferredHold) armIdleClock(kind)
                  return
                }
                const n = (releaseFalseCounts.get(sessionId) ?? 0) + 1
                releaseFalseCounts.set(sessionId, n)
                if (n >= 3) {
                  releaseFalseCounts.delete(sessionId)
                  opts.onStatus(
                    `[runner:session] ${sessionId} released=false ${n}x — aborting as backstop`,
                  )
                  childAc.abort()
                  return
                }
                opts.onStatus(
                  `[runner:session] ${sessionId} released=false (pending user event) — keeping session${turnInFlight || deferredHold ? '' : ', re-arming'}`,
                )
                if (!turnInFlight && !deferredHold) armIdleClock(kind)
              })
              .catch(err => {
                releasedAwaitingDeassign.delete(sessionId)
                opts.onStatus(
                  `[runner:session] ${sessionId} releaseSession failed: ${errMsg(err)} — keeping session${turnInFlight || deferredHold ? '' : `, retrying ${whenLabel()}`}`,
                )
                if (!turnInFlight && !deferredHold) armIdleClock(kind)
              })
          }, baseMs)
        }

        const maybeReleaseAfterRetireWithBg = (): void => {
          if (finished || childAc.signal.aborted || !deferredHold) return
          const bg = active.get(sessionId)?.liveBgTasks ?? 0
          if (bg === 0) {
            opts.onStatus(
              `[runner:session] ${sessionId} retire time passed with only perpetual monitor task(s) / a scheduled wakeup holding the turn — releasing now`,
            )
            deferredHold = false
            clearRetireBg()
            armIdleClock('turn-end')
            return
          }
          if (retireBgTimer !== undefined) return
          opts.onStatus(
            `[runner:session] ${sessionId} retire time passed with ${bg} background task(s) live — allowing ${formatDelayMs(retireDeferredGraceMs)} to finish before releasing`,
          )
          retireBgTimer = setTimeout(() => {
            retireBgTimer = undefined
            if (finished || childAc.signal.aborted || !deferredHold) return
            const still = active.get(sessionId)?.liveBgTasks ?? 0
            opts.onStatus(
              still === 0
                ? `[runner:session] ${sessionId} background work finished during the retire grace; only perpetual monitor task(s) / a scheduled wakeup still hold the turn — releasing now`
                : `[runner:session] ${sessionId} ${still} background task(s) still live after the retire grace — releasing anyway (a parked session beats a lost worker)`,
            )
            deferredHold = false
            armIdleClock('turn-end')
          }, retireDeferredGraceMs)
        }

        const releaseForRetire = (): void => {
          if (finished || childAc.signal.aborted) return
          retiringThis = true
          initObserved = true
          if (lastIdleKind === undefined) {
            if (deferredHold && !turnInFlight) {
              maybeReleaseAfterRetireWithBg()
              return
            }
            opts.onStatus(
              `[runner:session] ${sessionId} retire time passed ${turnInFlight ? 'mid-turn — releasing as soon as the current turn finishes' : 'before the child reported an idle state — releasing on its first idle transition'}`,
            )
            return
          }
          opts.onStatus(
            `[runner:session] ${sessionId} retire time passed while idle — releasing now`,
          )
          armIdleClock(lastIdleKind)
        }

        const onSessionActivity = (
          kind: SessionActivityKind,
          snap?: BgTaskSnapshot,
        ): void => {
          if (kind === 'startup') {
            armIdleClock('startup')
            return
          }
          if (retiringThis && kind === 'activity') {
            /* still track activity */
          }
          armIdleClock(kind, snap)
        }

        const task = handlePromise
          .then(handle =>
            handle(
              sessionId,
              {
                apiClient: api,
                getRunnerToken: () => opts.tokenState.runnerToken,
                baseDir,
                execPath: exec.execPath,
                execArgs: exec.execArgs,
                capacity: opts.capacity,
                healthPort: health?.listeningOn ?? opts.healthPort,
                clientPlatform,
                onDebug: opts.onDebug,
                onStatus: opts.onStatus,
                skipSpawn: opts.skipSessionSpawn === true,
                gitSshRewriteHosts: opts.gitSshRewriteHosts,
                gitHostRewrites: opts.gitHostRewrites,
                pushOutcomeOnRelease: opts.pushOutcomeOnRelease,
                postSessionHookTimeoutMs,
                onSessionActivity,
                onBgTaskLedger: n => {
                  const slot = active.get(sessionId)
                  if (slot) slot.liveBgTasks = n
                  drainNotify?.()
                },
                // densable 2.1.228 #7 `C` — bg-result follow-up hold keeps
                // deferredHold so retire/idle release does not fire mid-gap.
                // Release when follow-up is no longer busy, or childExited
                // (densable br). Do NOT require liveBgTasks===0 for busy=false:
                // a stale ledger after grace would stick deferredHold forever
                // while the follow-up is already idle. liveBgTasks still gates
                // retire via maybeReleaseAfterRetireWithBg separately.
                onBgResultFollowUpBusy: (busy, childExited) => {
                  if (busy) {
                    deferredHold = true
                    return
                  }
                  if (!deferredHold) return
                  // busy=false or childExited → clear; ignore stale ledger.
                  if (childExited === true || busy === false) {
                    deferredHold = false
                  }
                },
                onSessionTokenIssued: token => {
                  if (health && health.lockedAccountEmail === null) {
                    const email = extractSessionActorEmail(token)
                    if (email !== null) health.lockedAccountEmail = email
                  }
                },
                onChildLifecycle: health
                  ? state => {
                      const map =
                        state === 'spawned'
                          ? health.sessionsStarted
                          : state === 'completed'
                            ? health.sessionsCompleted
                            : state === 'failed'
                              ? health.sessionsFailed
                              : health.sessionsInterrupted
                      map.set(
                        clientPlatform,
                        (map.get(clientPlatform) ?? 0) + 1,
                      )
                    }
                  : undefined,
                onInitPhase: health
                  ? ev => {
                      switch (ev.kind) {
                        case 'start':
                          health.initializingSessions++
                          break
                        case 'end':
                          health.initializingSessions--
                          if (ev.durationSec !== undefined) {
                            observeInitDuration(
                              health.sessionInitDurations,
                              ev.durationSec,
                            )
                          }
                          break
                        case 'exit-before-init':
                          health.initializingSessions--
                          if (ev.failed) health.sessionInitErrors++
                          break
                      }
                    }
                  : undefined,
                onSessionStartHookError: health
                  ? () => {
                      health.sessionStartHookErrors++
                    }
                  : undefined,
                hostConfigSnapshot: opts.hostConfigSnapshot,
                governedGitConfigSeed: opts.governedGitConfigSeed,
                anthropicGitProxyBaseUrl:
                  opts.anthropicGitProxyBaseUrl ??
                  (opts.useAnthropicGitProxy ? opts.apiUrl : undefined),
                gitProxyGlobalConfigPath: opts.gitProxyGlobalConfigPath,
                gitProxyGlobalConfigSnapshot: opts.gitProxyGlobalConfigSnapshot,
                gitProxyCredHelper: opts.gitProxyCredHelper,
                configureGitHookStubs: opts.configureGitHookStubs,
                configureGitSigningArtifacts: opts.configureGitSigningArtifacts,
                canonicalLocks: opts.canonicalLocks,
                confineRepoSettings: opts.confineRepoSettings,
                trustWorkspace: opts.trustWorkspace,
              },
              childAc.signal,
            ),
          )
          .then((result: HandleSessionResult) => {
            const {
              result: ht,
              failureReason,
              setupFailureKind,
              failureKind,
            } = result
            if (failureReason) {
              opts.onStatus(
                `Session ${sessionId} finished: ${ht} — reason: ${failureReason}`,
              )
            } else {
              opts.onStatus(`Session ${sessionId} finished: ${ht}`)
            }
            if (
              ht === 'failed' ||
              (ht === 'interrupted' && !childAc.signal.aborted)
            ) {
              failureInFlight.add(sessionId)
              void api
                .reportSessionFailure(
                  opts.tokenState.runnerToken,
                  sessionId,
                  failureReason ?? 'failed (no reason captured)',
                  setupFailureKind,
                  failureKind,
                )
                .then(rep => {
                  opts.onStatus(
                    `[runner:session] ${sessionId} failure reported · excluded_count=${rep.excluded_count} stuck=${rep.stuck}`,
                  )
                  if (rep.stuck) {
                    stuckSessions.add(sessionId)
                    opts.onStatus(
                      `[runner:session] ${sessionId} marked stuck — will not re-spawn on future polls`,
                    )
                  }
                })
                .catch(err => {
                  opts.onStatus(
                    `[runner:session] ${sessionId} reportSessionFailure failed: ${errMsg(err)} — marking stuck to bound respawn`,
                  )
                  stuckSessions.add(sessionId)
                })
                .finally(() => {
                  failureInFlight.delete(sessionId)
                })
            }
          })
          .catch(err => {
            opts.onStatus(`Session ${sessionId} handler threw: ${errMsg(err)}`)
          })
          .finally(() => {
            finished = true
            clearIdleTimer()
            clearDeferredRemind()
            clearRetireBg()
            releasedAwaitingDeassign.delete(sessionId)
            releaseFalseCounts.delete(sessionId)
            if (health) {
              health.sessionIdle.delete(metricsSid)
              health.sessionClientPlatform.delete(metricsSid)
              clearChildMetricsForSession(health, metricsSid)
            }
            const wasAtCap = active.size >= opts.capacity
            active.delete(sessionId)
            if (health) health.activeSessions = active.size
            drainNotify?.()
            if (sseEnabled && wasAtCap) wakeQueue.wake('LOCAL')
          })

        active.set(sessionId, {
          task,
          controller: childAc,
          liveBgTasks: 0,
          turnInFlight: false,
          releaseForRetire,
        })
        if (health) health.activeSessions = active.size
      }

      if (exitOnAssignment && active.size > 0) return 'assignment-blocked'

      successfulPolls++
      if (successfulPolls % HEALTH_LOG_EVERY_POLLS === 0) {
        const exp = decodeRunnerTokenExpirySeconds(opts.tokenState.runnerToken)
        const now = Date.now()
        const ago = now - pollStartedAt
        const ttl =
          exp !== null
            ? `${exp * 1000 - now < 0 ? '-' : ''}${formatDelayMs(Math.abs(exp * 1000 - now))}`
            : 'unknown'
        const locked =
          health?.lockedAccountEmail ?? (sawAnyAssignment ? 'yes' : 'no')
        opts.onStatus(
          `[runner:health] polling ok · ${active.size}/${opts.capacity} slots · last_poll=${ago}ms ago · locked_account=${locked} · runner_token expires in ${ttl} · ${sessionsHandled} sessions handled`,
        )
      }

      const interval = opts.pollIntervalOverrideMs ?? derivePollInterval(lease)
      if (sseEnabled) {
        wakeQueue.atCapacity = active.size >= opts.capacity
        await wakeQueue.wait(interval, signal)
      } else {
        await sleepMs(interval, signal)
      }
    }
    return signal.aborted ? 'aborted' : 'drained'
  } finally {
    if (retireTimer !== undefined) {
      clearTimeout(retireTimer)
      retireTimer = undefined
    }
    sseHandle?.close()

    const drainTimeoutMs =
      opts.drainTimeoutMs ??
      computeShutdownBudgetSec(
        sessionStopGraceMs,
        postSessionHookTimeoutMs,
        0,
        opts.pushOutcomeOnRelease ? PUSH_OUTCOME_BUDGET_MS : 0,
      ) * 1000
    let heartbeatBusy = false
    const heartbeat = setInterval(() => {
      if (heartbeatBusy) return
      heartbeatBusy = true
      void api
        .pollWork(opts.tokenState.runnerToken, opts.runnerId, 0)
        .then(() => {
          if (health) health.lastPollAt = Date.now()
        })
        .catch(err => {
          if (health) health.pollErrors[classifyPollError(err)]++
          opts.onDebug(
            `[runner] shutdown: lease heartbeat failed (best-effort): ${err}`,
          )
        })
        .finally(() => {
          heartbeatBusy = false
        })
    }, opts.shutdownLeaseHeartbeatMs ?? SHUTDOWN_LEASE_HEARTBEAT_MS)

    try {
      if (drainWaitMs > 0 && signal.aborted) {
        const liveBg = (): number =>
          [...active.values()].reduce((a, s) => a + s.liveBgTasks, 0)
        const liveTurns = (): number =>
          [...active.values()].reduce((a, s) => a + (s.turnInFlight ? 1 : 0), 0)
        const busy = (): boolean => liveBg() > 0 || liveTurns() > 0
        if (busy()) {
          opts.onStatus(
            `[runner] drain-wait: ${liveTurns()} turn(s) in flight, ${liveBg()} background task(s) live across ${active.size} session(s) — waiting up to ${drainWaitMs / 1000}s before stopping session(s)`,
          )
          await new Promise<void>(resolve => {
            const done = (): void => {
              drainNotify = undefined
              resolve()
            }
            const t = setTimeout(done, drainWaitMs)
            drainNotify = () => {
              if (!busy()) {
                clearTimeout(t)
                done()
              }
            }
          })
          opts.onStatus(
            !busy()
              ? '[runner] drain-wait: in-flight work finished — stopping session(s)'
              : `[runner] drain-wait: timed out with ${liveTurns()} turn(s) in flight, ${liveBg()} task(s) still live — stopping session(s)`,
          )
        }
      }
      for (const { controller } of active.values()) controller.abort()
      if (active.size > 0) {
        opts.onStatus(`Draining ${active.size} active session(s)...`)
        try {
          await withTimeoutMs(
            Promise.allSettled([...active.values()].map(s => s.task)),
            drainTimeoutMs,
            '[runner:stuck] drain',
          )
          opts.onStatus('Drain complete')
        } catch {
          opts.onStatus(
            `[runner] shutdown exceeded ${drainTimeoutMs}ms (session-stop-grace + post-session-hook-timeout${opts.pushOutcomeOnRelease ? ' + push-on-release window' : ''} + ${SHUTDOWN_BUDGET_PAD_MS / 1000}s); force-exiting. The post-session hook had its full budget; post-hook cleanup may have been cut short. ${active.size} session(s) still active.`,
          )
          await opts.flushLogSink?.()
          process.exit(1)
        }
      }
    } finally {
      clearInterval(heartbeat)
    }

    let deregistered = false
    await withTimeoutMs(
      api
        .deregisterRunner(opts.tokenState.runnerToken)
        .then(() => {
          if (!deregistered) {
            deregistered = true
            opts.onStatus('[runner:exit] Deregistered — sessions requeued')
          }
        })
        .catch(err => {
          opts.onDebug(
            `[runner:exit] deregisterRunner failed (best-effort): ${err}`,
          )
        }),
      5000,
      '[runner:exit] deregister',
    ).catch(() => {
      opts.onDebug(
        '[runner:exit] deregisterRunner timed out (best-effort) — lease expiry will requeue',
      )
    })
  }
}

// ── main (azv) ─────────────────────────────────────────────────────────────

export type SelfHostedRunnerMainDeps = {
  apiFactory?: typeof createSelfHostedRunnerApi
  /** inject for tests */
  resolveSecret?: typeof resolveEnvironmentSecret
  sleep?: typeof sleepMs
  now?: () => number
  hostname?: () => string
  /** when false, skip entering poll loop after register (tests) */
  enterPollLoop?: boolean
  exitOnAssignment?: boolean
}

/**
 * densable `azv` / `selfHostedRunnerMain`.
 * Lands: help, parseArgs, secret, logging, register, health HTTP, poll + SSE.
 * aWd/bjv/outcome + full Ane (VE_/KE_) + kjv confine + D trust seed + full xBh drain/retire wired.
 */
export async function selfHostedRunnerMain(
  argv: string[],
  deps: SelfHostedRunnerMainDeps = {},
): Promise<void> {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(formatRootHelp())
    return
  }

  let args: RootRunnerArgs
  let secret: string
  try {
    args = parseRootArgs(argv)
    // densable 2.1.229 n_g — Windows requires explicit base-dir (no /workspace default)
    assertWindowsBaseDirSource(args.baseDirSource)
    secret = await (deps.resolveSecret ?? resolveEnvironmentSecret)(args)
    // densable 2.1.225 izh — fail early if baseDir is not writable (NFS/CSI)
    await ensureBaseDirWritable(args.baseDir)
  } catch (q) {
    console.error(
      `error: ${errMsg(q)}\n\nRun 'claude self-hosted-runner --help' for usage.`,
    )
    process.exit(2)
  }

  const debugEnabled = args.logLevel === 'debug'
  const ts = () => new Date().toISOString()
  let logStream: WriteStream | undefined
  if (args.logFile) {
    logStream = createWriteStream(args.logFile, { flags: 'a', mode: 0o600 })
    logStream.on('open', fd => {
      fchmod(fd, 0o600, () => {})
    })
    logStream.on('error', q => {
      console.error(
        `${ts()} [runner:warn] log-file write failed (${errMsg(q)}); continuing stdout-only`,
      )
      logStream = undefined
    })
  }
  const writeLogFile = (q: string): void => {
    logStream?.write(`${q}\n`)
  }
  const flushLog = async (): Promise<void> => {
    if (!logStream) return
    const q = logStream
    logStream = undefined
    await withTimeoutMs(
      new Promise<void>(Y => {
        q.end(() => Y())
      }),
      500,
      '[runner:exit] log-file flush',
    ).catch(() => {})
  }
  const onDebug = (q: string): void => {
    if (!debugEnabled) return
    const Y = `${ts()} [DEBUG] ${redactLogText(q)}`
    console.error(Y)
    writeLogFile(Y)
  }
  const onStatus = (q: string): void => {
    const Y = `${ts()} [self-hosted-runner] ${redactLogText(q)}`
    console.log(Y)
    writeLogFile(Y)
  }

  if (process.env.SELF_HOSTED_RUNNER_SIGKILL_TIMEOUT_MS !== undefined) {
    onStatus(
      '[runner:fatal] SELF_HOSTED_RUNNER_SIGKILL_TIMEOUT_MS was renamed to SELF_HOSTED_RUNNER_SESSION_STOP_GRACE_MS. It controls how long to wait for the Claude process to exit cleanly after a session ends, before force-killing it. The post-session hook runs after this.',
    )
    await flushLog()
    process.exit(1)
  }

  for (const q of [
    'RUNNER_RELEASE_IDLE_SESSION_MIN',
    'SELF_HOSTED_RUNNER_RELEASE_IDLE_SESSION_MIN',
    'SELF_HOSTED_RUNNER_SESSION_IDLE_MIN',
    'SELF_HOSTED_RUNNER_SESSION_IDLE_SEC',
  ]) {
    if (process.env[q] !== undefined) {
      onStatus(
        `[runner:warn] ${q} is set but is not a setting this runner ` +
          'reads — it is being IGNORED. The session idle-release window ' +
          'is configured with --release-idle-session-min <minutes> (or env SELF_HOSTED_RUNNER_SESSION_IDLE_MS, in milliseconds).',
      )
    }
  }

  const stopGrace =
    readEnvMs('SELF_HOSTED_RUNNER_SESSION_STOP_GRACE_MS') ||
    DEFAULT_SESSION_STOP_GRACE_MS
  const postHook =
    readEnvMs('SELF_HOSTED_RUNNER_POST_SESSION_HOOK_TIMEOUT_MS') ||
    DEFAULT_POST_SESSION_HOOK_TIMEOUT_MS
  const budgetSec = computeShutdownBudgetSec(
    stopGrace,
    postHook,
    readDrainWaitMs(),
    args.pushOutcomeOnRelease ? PUSH_OUTCOME_BUDGET_MS : 0,
  )
  const budgetMsg = `[runner] This runner needs up to ${budgetSec}s to stop the Claude process and run the post-session hook on shutdown, and force-exits after ${budgetSec}s. Configure your process supervisor's stop timeout to at least ${budgetSec}s (e.g. terminationGracePeriodSeconds on Kubernetes, stop_grace_period on Docker Compose, TimeoutStopSec on systemd, or your platform's equivalent).`
  onStatus(budgetMsg)

  // densable azv: if no --exec-path, try hooks-dir/command before resolveExec
  let execPathArg = args.execPath
  if (!execPathArg) {
    const hooksDir = process.env.SELF_HOSTED_RUNNER_HOOKS_DIR
    if (hooksDir) {
      const { resolveHookPath } = await import('./sessionHooks.js')
      const commandHook = await resolveHookPath(hooksDir, 'command')
      if (commandHook) {
        execPathArg = commandHook
        onStatus(`[runner:hook] using command hook ${commandHook}`)
      }
    }
  }
  const { execPath, execArgs } = resolveExec(execPathArg)
  onStatus(
    `Connecting to ${args.apiUrl} (capacity=${args.capacity}, baseDir=${args.baseDir}, execPath=${[execPath, ...execArgs].join(' ')})`,
  )
  const capWarn = sessionBoundCapacityWarning(secret, args.capacity)
  if (capWarn !== null) onStatus(capWarn)

  // densable azv git-proxy/configure order:
  // 1) wipe HOME git configs when proxy  2) configureGit  3) configure proxy + snapshot
  let gitProxyGlobalConfigPath: string | undefined
  let gitProxyGlobalConfigSnapshot: string | undefined
  let gitProxyCredHelper: { path: string; content: string } | undefined
  let configureGitHookStubs: GitArtifactFile[] | undefined
  let configureGitSigningArtifacts: GitArtifactFile[] | undefined

  if (args.useAnthropicGitProxy) {
    if (args.capacity > 1) {
      onStatus(
        '[runner:fatal] --use-anthropic-git-proxy requires --capacity 1 (the proxy URL is per-session and linked worktrees share origin). Omit --use-anthropic-git-proxy or set --capacity 1.',
      )
      await flushLog()
      process.exit(1)
    }
    if (
      process.env.CLAUDE_RUNNER_TRUST_CANONICAL_PREWARM &&
      (readEnvMs('SELF_HOSTED_RUNNER_DRAIN_GRACE_MS') ?? 0) > 0
    ) {
      onStatus(
        "[runner:fatal] CLAUDE_RUNNER_TRUST_CANONICAL_PREWARM requires --drain-grace-sec 0 (one-shot). With drain-grace > 0 a second session could reuse this VM after the first's child wrote to the canonical .git/, and the skip would bypass the cross-session-isolation sanitize for an untrusted canonical. Unset the env var or set --drain-grace-sec 0.",
      )
      await flushLog()
      process.exit(1)
    }
    gitProxyGlobalConfigPath =
      process.env.GIT_CONFIG_GLOBAL || join(homedir(), '.gitconfig')
    try {
      const st = await lstat(gitProxyGlobalConfigPath).catch(() => undefined)
      if (st && (st.isCharacterDevice() || st.isBlockDevice())) {
        onStatus(
          `[runner:fatal] --use-anthropic-git-proxy requires a writable global git config, but GIT_CONFIG_GLOBAL resolves to ${gitProxyGlobalConfigPath} which is not a regular file. The proxy flag writes its credential helper there and restores it at each session start. Unset GIT_CONFIG_GLOBAL or point it at a regular file path.`,
        )
        await flushLog()
        process.exit(1)
      }
      const xdg = process.env.XDG_CONFIG_HOME || join(homedir(), '.config')
      onStatus(
        `[runner:git] --use-anthropic-git-proxy: wiping HOME-level git config (${gitProxyGlobalConfigPath}, ${join(xdg, 'git')}, ${join(args.baseDir, '.runner')}) for cross-session isolation. Operator-provisioned git config must live in system config (/etc/gitconfig) or via --configure-git; see the self-hosted runners guide.`,
      )
      await rm(gitProxyGlobalConfigPath, { recursive: true, force: true })
      await rm(join(homedir(), '.gitconfig'), {
        recursive: true,
        force: true,
      })
      await rm(join(xdg, 'git'), { recursive: true, force: true })
      await rm(join(args.baseDir, '.runner'), {
        recursive: true,
        force: true,
      })
      await mkdir(dirname(gitProxyGlobalConfigPath), { recursive: true })
    } catch (err) {
      onStatus(
        `[runner:fatal] --use-anthropic-git-proxy wipe failed: ${errMsg(err)}`,
      )
      await flushLog()
      process.exit(1)
    }
  }

  if (args.configureGit) {
    try {
      await configureGitSigning({
        baseDir: args.baseDir,
        execPath,
        onStatus,
      })
      configureGitHookStubs = coauthorHookStubs(args.baseDir)
      configureGitSigningArtifacts = codeSignArtifacts(args.baseDir, execPath)
    } catch (err) {
      onStatus(`[runner:fatal] --configure-git failed: ${errMsg(err)}`)
      await flushLog()
      process.exit(1)
    }
  }

  if (args.useAnthropicGitProxy) {
    try {
      await configureAnthropicGitProxy({
        apiBaseUrl: args.apiUrl,
        baseDir: args.baseDir,
        onStatus,
      })
      gitProxyGlobalConfigSnapshot = await readFile(
        gitProxyGlobalConfigPath!,
        'utf-8',
      ).catch(() => '')
      gitProxyCredHelper = {
        path: gitProxyCredHelperPath(args.baseDir),
        content: GIT_PROXY_CRED_HELPER_CONTENT,
      }
    } catch (err) {
      onStatus(
        `[runner:fatal] --use-anthropic-git-proxy failed: ${errMsg(err)}`,
      )
      await flushLog()
      process.exit(1)
    }
  }

  const apiFactory = deps.apiFactory ?? createSelfHostedRunnerApi
  const api = apiFactory({
    baseUrl: args.apiUrl,
    poolSecret: secret,
    onDebug,
  })
  const clientLabel = (deps.hostname ?? hostname)()
  if (args.lockToAccountId) {
    onStatus(`Registering locked to account: ${args.lockToAccountId}`)
  }

  let runnerId: string
  let runnerToken: string
  try {
    const reg = await retryAsync(
      () => api.registerRunner(clientLabel, args.lockToAccountId),
      {
        initialDelayMs: 1000,
        maxDelayMs: 16_000,
        maxAttempts: 5,
        shouldRetry: isRetryableRunnerError,
        onRetry: (Y, re) => {
          onStatus(
            `RegisterRunner attempt ${Y} transient failure (${re instanceof Error ? re.message : re}) — retrying`,
          )
        },
      },
    )
    if (!reg) {
      await flushLog()
      process.exit(1)
    }
    runnerId = String(reg.runner_id)
    runnerToken = String((reg as { runner_token?: string }).runner_token ?? '')
    if (!runnerToken) {
      onStatus('[runner:fatal] RegisterRunner response missing runner_token')
      await flushLog()
      process.exit(1)
    }
  } catch (q) {
    const Y = errMsg(q)
    if (isAuthFailure(q)) {
      onStatus(
        `[runner:fatal] RegisterRunner auth failed — environment secret invalid or revoked. Check --environment-secret-file or SELF_HOSTED_RUNNER_ENVIRONMENT_SECRET. (${Y})`,
      )
    } else {
      onStatus(`[runner:fatal] RegisterRunner failed: ${Y}`)
    }
    await flushLog()
    process.exit(1)
  }
  onStatus(`Registered: runner_id=${runnerId}`)

  const healthState = createRunnerHealthState({
    runnerId,
    version: resolveRunnerVersion(),
    clientLabel,
    capacity: args.capacity,
  })
  const healthServer =
    args.healthPort > 0
      ? startHealthServer(args.healthPort, healthState, onStatus)
      : undefined

  if (deps.enterPollLoop === false) {
    healthServer?.close()
    await flushLog()
    return
  }

  const ac = new AbortController()
  let forced = false
  const onSignal = (sig: string): void => {
    if (forced) {
      onStatus('Forced shutdown')
      void flushLog().finally(() => process.exit(1))
      return
    }
    forced = true
    onStatus(`Received shutdown signal, draining active sessions... (${sig})`)
    onStatus(budgetMsg)
    ac.abort()
  }
  const onTerm = (): void => onSignal('SIGTERM')
  const onInt = (): void => onSignal('SIGINT')
  process.on('SIGTERM', onTerm)
  process.on('SIGINT', onInt)

  const tokenState = { runnerToken }
  // densable qUi — schedule runner_token refresh (Jjv label "runner")
  const runnerTokenRefresh = createRunnerTokenRefreshScheduler({
    getAccessToken: async () => {
      const res = await api.refreshToken(tokenState.runnerToken)
      return res.token
    },
    onRefresh: (_sessionId, token) => {
      tokenState.runnerToken = token
      onDebug('[runner:main] runner_token refreshed')
    },
    label: 'self-hosted-runner',
    onLog: (msg, meta) => {
      if (meta?.level === 'error') onStatus(msg)
      else onDebug(msg)
    },
  })
  runnerTokenRefresh.schedule(RUNNER_TOKEN_LABEL, runnerToken)

  // densable Q2h / eBh — startup snapshots passed into xBh → rBh
  const hostConfigSnapshot = await snapshotHostConfig(onStatus)
  const governedGitConfigSeed = await captureGovernedGitConfigSeed(onDebug)

  try {
    const result = await runPollSkeleton(
      {
        apiClient: api,
        runnerId,
        tokenState,
        capacity: args.capacity,
        baseDir: args.baseDir,
        execPath,
        execArgs,
        healthPort: args.healthPort,
        apiUrl: args.apiUrl,
        healthState,
        gitSshRewriteHosts: args.gitSshRewriteHosts,
        gitHostRewrites: args.gitHostRewrites,
        pushOutcomeOnRelease: args.pushOutcomeOnRelease,
        trustWorkspace: args.trustWorkspace,
        confineRepoSettings: args.confineRepoSettings,
        useAnthropicGitProxy: args.useAnthropicGitProxy,
        anthropicGitProxyBaseUrl: args.useAnthropicGitProxy
          ? args.apiUrl
          : undefined,
        gitProxyGlobalConfigPath,
        gitProxyGlobalConfigSnapshot,
        gitProxyCredHelper,
        configureGitHookStubs,
        configureGitSigningArtifacts,
        canonicalLocks: new Map(),
        debugTokenDir: args.debugTokenDir,
        hostConfigSnapshot,
        governedGitConfigSeed,
        runnerTokenRefresh,
        onStatus,
        onDebug,
        exitOnAssignment: deps.exitOnAssignment,
        // tests that set exitOnAssignment still skip real child spawn by default
        skipSessionSpawn: deps.exitOnAssignment === true,
        flushLogSink: flushLog,
      },
      ac.signal,
    )
    // densable xBh finally already best-effort deregisters; exitOnAssignment
    // test path may leave early before that finally completes drain.
    if (result === 'assignment-blocked') {
      onStatus(
        '[runner:exit] assignment observed (test/exitOnAssignment) — exiting',
      )
      await flushLog()
      process.exit(1)
    }
    if (result === 'auth-failed') {
      await flushLog()
      process.exit(1)
    }
  } finally {
    runnerTokenRefresh.cancelAll()
    healthServer?.close()
    process.removeListener('SIGTERM', onTerm)
    process.removeListener('SIGINT', onInt)
    await flushLog()
  }
}
