/**
 * densable 2.1.224 session handler (rBh core) + child spawn (sjv core).
 *
 * Recovered path:
 *   validate session_id → issueSessionToken (Krr) → yjv + bjv →
 *   getSessionRemoteConfig → djv/pjv source map →
 *   registerWorker → WJl epoch fence →
 *   checkout hooks (H2h) OR built-in aWd/Fjy (+ sanitize/worktree) →
 *   outcome branches (Ojv/Djv/Pjv) → njv host seed → spawn (sjv) →
 *   push-on-release (Hjv) → Y2h on fail → M2h
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, rm } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  isRetryableRunnerError,
  type SelfHostedRunnerApi,
} from './runnerApi.js'
import {
  DEFAULT_POST_SESSION_HOOK_TIMEOUT_MS,
  DEFAULT_SESSION_STOP_GRACE_MS,
  PUSH_OUTCOME_BUDGET_MS,
  SHUTDOWN_BUDGET_PAD_MS,
  readEnvMs,
  retryAsync,
  withTimeoutMs,
} from './rootRunner.js'
import {
  buildSessionChildArgs,
  buildSessionChildEnv,
  sessionIngressTokenPath,
} from './sessionChild.js'
import {
  isCheckoutHookSourceType,
  mapSourcesForCheckout,
  parseGovernedGitConfig,
  resolveHookPath,
  runCheckoutHook,
  runPostSessionHook,
  sourceCanonicalPath,
  sourceCheckoutSlug,
  type MappedCheckoutSource,
} from './sessionHooks.js'
import { isSafeGitRevision, isSafeGitUrl } from './orchestrator.js'
import {
  createActivityPipeState,
  disposeActivityPipeState,
  handleActivityLine,
  handleStderrInitMarker,
  type SessionActivityHandler,
} from './sessionActivity.js'
import type { HostConfigSnapshot } from './hostConfig.js'
import {
  assertConfigDirOutsideGlobalTemp,
  claudeConfigFileSuffix,
  resolveChildCwdAndAddDirs,
  resolveUnderSessionRoot,
  seedHostConfigIntoSession,
  seedPersistedWorkspaceTrust,
  writeDebugTokenFile,
  writeGovernedGitconfigSeed,
  writeRemoteMcpConfig,
  writeSessionIngressToken,
} from './sessionSeed.js'
import {
  acceptRemoteCwdUnderSession,
  cleanupSessionIngressToken,
  cleanupSessionSideFiles,
  createIngressFenceBgController,
  forwardDebugLogDiagnostics,
  inferenceRefreshIntervalMs,
  initMilestoneEvent,
  startIntervalRefreshLoop,
  type IntervalRefreshLoop,
} from './sessionRuntime.js'
import {
  createRunnerTokenRefreshScheduler,
  pushTokenToChild,
  sweepPendingTokenAcks,
  type PendingTokenAck,
  type TokenRefreshScheduler,
} from './tokenRefresh.js'
import {
  applyRepoSettingsConfine,
  type ConfineRepoSettings,
} from './sessionConfine.js'
import {
  buildSessionGoneEndSessionLine,
  isEpochMismatchRunnerError,
  notifyChildSessionGone,
  postSessionFailureResult,
} from './sessionFailure.js'
import { governedSigningEntries, governedGitSpawn } from './gitConfigure.js'
import { truncateSessionErrorText } from './sessionText.js'
import {
  addSessionWorktree,
  cleanupOutcomeBranch,
  cleanupSessionWorktrees,
  createOutcomeBranch,
  fetchOutcomeBranches,
  fetchPriorOutcomeBranch,
  mapOutcomeBranchLists,
  mapPushTargetsFromRemote,
  prepareSources,
  prepClonePhaseEvent,
  prepStepEvent,
  PUSH_ON_RELEASE_RESUME_FETCH_MS,
  pushOutcomeBranch,
  resetGovernedOriginToUpstream,
  resetStaleGitProxyCredHelper,
  revParseVerify,
  sanitizeCanonicalGitState,
  shouldSanitizeCanonical,
  unsetGitProxyRepoLocalCredHelper,
  wireGitProxyRepoLocalCredHelper,
  withCanonicalLock,
  type GitPrepareSource,
  type SessionWorktree,
} from './gitPrepare.js'

export type SessionResult = 'completed' | 'failed' | 'interrupted' | 'abandoned'

/** densable rBh return shape (xBh reads failureReason / *FailureKind). */
export type HandleSessionResult = {
  result: SessionResult
  exitCode?: number | null
  failureReason?: string
  setupFailureKind?: string
  failureKind?: string
}

export type HandleSessionOpts = {
  apiClient: SelfHostedRunnerApi
  getRunnerToken: () => string
  baseDir: string
  execPath: string
  execArgs: string[]
  capacity: number
  healthPort?: number
  clientPlatform?: string
  onDebug: (msg: string) => void
  onStatus: (msg: string) => void
  onSessionTokenIssued?: (token: string) => void
  onChildLifecycle?: (
    state: 'spawned' | 'completed' | 'failed' | 'interrupted',
  ) => void
  /** densable onInitPhase for health metrics */
  onInitPhase?: (ev: {
    kind: 'start' | 'end' | 'exit-before-init'
    durationSec?: number
    failed?: boolean
  }) => void
  onSessionStartHookError?: () => void
  /** densable onSessionActivity — idle clock / retire release driver */
  onSessionActivity?: SessionActivityHandler
  /** densable onBgTaskLedger — non-monitor live task count */
  onBgTaskLedger?: (liveNonMonitor: number) => void
  hooksDir?: string
  gitSshRewriteHosts?: string[]
  gitHostRewrites?: Array<[string, string]>
  pushOutcomeOnRelease?: boolean
  postSessionHookTimeoutMs?: number
  /** densable inject point used by xBh tests */
  spawnChild?: typeof spawnSessionChild
  /** skip child spawn after register (tests / dry-run) */
  skipSpawn?: boolean
  /** densable hostConfigSnapshot (Q2h) — njv seeds into session config dir */
  hostConfigSnapshot?: HostConfigSnapshot
  /**
   * densable `trustWorkspace` (D) — seed per-session `.claude.json` projects
   * with hasTrustDialogAccepted for child cwd / add-dirs / canonical repos.
   * Default true at azv/root (SELF_HOSTED_RUNNER_TRUST_WORKSPACE).
   */
  trustWorkspace?: boolean
  /** densable governedGitConfigSeed (eBh) — written when governed git_config */
  governedGitConfigSeed?: string
  /**
   * densable `_t` / useAnthropicGitProxy — api base URL after qqv when proxy on
   * and governed git is not active for this session.
   */
  anthropicGitProxyBaseUrl?: string
  /** densable `k` — GIT_CONFIG_GLOBAL path for bjv restore */
  gitProxyGlobalConfigPath?: string
  /** densable `R` — startup snapshot of global gitconfig for bjv */
  gitProxyGlobalConfigSnapshot?: string
  /** densable `P` — git-proxy cred helper artifact */
  gitProxyCredHelper?: { path: string; content: string }
  /** densable `S` — shared canonical sanitize locks (ijv) */
  canonicalLocks?: Map<string, Promise<unknown>>
  /** densable debugTokenDir — F2h best-effort JWT dump */
  debugTokenDir?: string
  /** densable configureGitHookStubs (O) — capacity==1 only path uses yjv */
  configureGitHookStubs?: Array<{
    path: string
    content: string
    mode: number
  }>
  /** densable configureGitSigningArtifacts (H) */
  configureGitSigningArtifacts?: Array<{
    path: string
    content: string
    mode: number
  }>
  /**
   * densable `B` / confineRepoSettings — repo-committed settings confine guard.
   * Default densable rBh: `"enforce"`. Root CLI default is `"warn"`.
   */
  confineRepoSettings?: ConfineRepoSettings
}

export { truncateSessionErrorText } from './sessionText.js'

/** densable `qrr` — axios-style HTTP status extraction */
export function extractErrorHttpStatus(err: unknown): number | undefined {
  if (err !== null && typeof err === 'object') {
    const e = err as {
      httpStatus?: unknown
      status?: unknown
      response?: { status?: unknown }
    }
    if (typeof e.httpStatus === 'number') return e.httpStatus
    if (typeof e.response?.status === 'number') return e.response.status
    if (typeof e.status === 'number') return e.status
  }
  return undefined
}

/**
 * densable `v4o` / SourceRefNotFound signals used for setupFailureKind.
 */
export function isSourceRefNotFoundMessage(msg: string): boolean {
  return (
    /SOURCE_REF_NOT_FOUND/i.test(msg) ||
    /could not find remote ref/i.test(msg) ||
    /pathspec .+ did not match/i.test(msg) ||
    /reference is not a tree/i.test(msg) ||
    /not a valid object name/i.test(msg) ||
    /ambiguous argument .+ unknown revision/i.test(msg)
  )
}

function classifyThrownFailure(
  err: unknown,
  prefix: 'setup threw' | 'pre-spawn threw',
): Pick<
  HandleSessionResult,
  'failureReason' | 'setupFailureKind' | 'failureKind'
> {
  const tr = truncateSessionErrorText(
    err instanceof Error ? err.message : String(err),
  )
  const status = extractErrorHttpStatus(err)
  const refMiss =
    isSourceRefNotFoundMessage(tr) ||
    (err instanceof Error &&
      (err.name === 'SourceRefNotFound' || err.name === 'VJl'))
  let failureKind: string | undefined
  let setupFailureKind: string | undefined
  if (status !== undefined && status >= 500) {
    failureKind = 'SESSION_FAILURE_KIND_ANTHROPIC_CONTROL_PLANE_5XX'
  } else if (refMiss) {
    failureKind = 'SESSION_FAILURE_KIND_SESSION_CONFIG_ERROR'
  }
  if (refMiss) setupFailureKind = 'SETUP_FAILURE_KIND_SOURCE_REF_NOT_FOUND'
  return {
    failureReason: `${prefix}: ${tr}`,
    setupFailureKind,
    failureKind,
  }
}

export type SessionChildResult = {
  result: 'completed' | 'failed' | 'interrupted'
  exitCode: number | null
  stderrTail: string
}

export type SpawnSessionChildOpts = {
  execPath: string
  execArgs: string[]
  apiBaseUrl: string
  sessionId: string
  sessionToken: string
  workerEpoch: number
  cwd: string
  configDir: string
  stageFileRoot: string
  debugFile: string
  capacity: number
  healthPort?: number
  clientPlatform?: string
  environmentVariables?: Record<string, string | undefined>
  inferenceAccessToken: string
  claudeCodeArgs?: Record<string, unknown>
  mcpConfigPath?: string
  addDirs?: string[]
  /** densable `governedGit` / `governedGitConfigPath` for sjv env */
  governedGitConfig?: boolean
  governedGhPathShim?: boolean
  governedGitConfigPath?: string
  onDebug: (msg: string) => void
  onStatus: (msg: string) => void
  signal: AbortSignal
  postSessionHookTimeoutMs?: number
  pushOutcomeOnRelease?: boolean
  onSessionActivity?: SessionActivityHandler
  onBgTaskLedger?: (liveNonMonitor: number) => void
  onSessionStartHookError?: () => void
  /** densable `onChildInit` — system/init or SDKStartup marker latches */
  onInitObserved?: () => void
  /** stdin write hook for token push (densable A) */
  onStdinReady?: (write: (line: string) => void) => void
  onTokenAck?: (requestId: string) => void
}

function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

/** densable `sjv` core — spawn Claude child with FD3 activity pipe. */
export async function spawnSessionChild(
  opts: SpawnSessionChildOpts,
): Promise<SessionChildResult> {
  if (!opts.inferenceAccessToken) {
    throw new Error(`/remote response is missing inference_auth.access_token`)
  }
  opts.onDebug(`[runner:session] inference_auth set`)

  const childArgs = buildSessionChildArgs({
    execArgs: opts.execArgs,
    apiBaseUrl: opts.apiBaseUrl,
    sessionId: opts.sessionId,
    debugFile: opts.debugFile,
    mcpConfigPath: opts.mcpConfigPath,
    addDirs: opts.addDirs,
    claudeCodeArgs: opts.claudeCodeArgs,
    onDebug: opts.onDebug,
  })
  const env = buildSessionChildEnv({
    sessionId: opts.sessionId,
    sessionToken: opts.sessionToken,
    workerEpoch: opts.workerEpoch,
    configDir: opts.configDir,
    stageFileRoot: opts.stageFileRoot,
    apiBaseUrl: opts.apiBaseUrl,
    environmentVariables: opts.environmentVariables,
    inferenceAccessToken: opts.inferenceAccessToken,
    capacity: opts.capacity,
    healthPort: opts.healthPort,
    clientPlatform: opts.clientPlatform,
    // densable sjv: u?.toolConfig.gitConfig / ghPathShim + GIT_CONFIG_GLOBAL:d
    governedGitConfig: opts.governedGitConfig,
    governedGhPathShim: opts.governedGhPathShim,
    governedGitConfigPath: opts.governedGitConfigPath,
  })

  opts.onDebug(
    `[runner:session] Spawning child: ${[opts.execPath, ...opts.execArgs].join(' ')} (${childArgs.length - opts.execArgs.length} args) ANTHROPIC_BASE_URL=${opts.apiBaseUrl} CLAUDE_CODE_WORKER_EPOCH=${opts.workerEpoch} cwd=${opts.cwd}`,
  )

  const child: ChildProcess = spawn(opts.execPath, childArgs, {
    cwd: opts.cwd,
    stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
    env,
    windowsHide: true,
    detached: true,
  })

  opts.onStatus(
    `[runner:session] ${opts.sessionId} child spawned pid=${child.pid} cwd=${opts.cwd}`,
  )

  // densable: activity pipe FD3 with stdout fallback (sjv)
  let activityStream = child.stdio[3] as NodeJS.ReadableStream | undefined
  try {
    activityStream?.on?.('error', (err: Error) => {
      opts.onDebug(
        `[runner:session] activity pipe error (${err.message}); falling back to stdout readline`,
      )
      activityStream = undefined
    })
  } catch (err) {
    opts.onDebug(
      `[runner:session] activity pipe unavailable (${err instanceof Error ? err.message : String(err)}); falling back to stdout readline`,
    )
    activityStream = undefined
  }

  if (opts.onStdinReady && child.stdin && !child.stdin.destroyed) {
    opts.onStdinReady((line: string) => {
      if (child.stdin && !child.stdin.destroyed) child.stdin.write(line)
    })
  }

  // densable T?.("startup") — arm idle clock for startup timeout
  opts.onSessionActivity?.('startup')

  const activityState = createActivityPipeState()
  const onActivityLine = (line: string): void => {
    handleActivityLine(line, activityState, {
      onSessionActivity: opts.onSessionActivity,
      onBgTaskLedger: opts.onBgTaskLedger,
      onTokenAck: opts.onTokenAck,
      onSessionStartHookError: opts.onSessionStartHookError,
      onInitObserved: opts.onInitObserved,
      onDebug: opts.onDebug,
    })
  }

  const stderrLines: string[] = []
  const maxStderr = 50
  if (child.stderr) {
    createInterface({ input: child.stderr }).on('line', line => {
      handleStderrInitMarker(line, activityState, {
        onInitObserved: opts.onInitObserved,
        onSessionActivity: opts.onSessionActivity,
      })
      const trimmed = line.length > 500 ? `${line.slice(0, 500)}…` : line
      opts.onDebug(`[runner:session] stderr: ${trimmed}`)
      stderrLines.push(trimmed)
      if (stderrLines.length > maxStderr) stderrLines.shift()
    })
  }
  if (child.stdout) {
    createInterface({ input: child.stdout }).on('line', onActivityLine)
  }
  if (activityStream) {
    createInterface({ input: activityStream as never }).on(
      'line',
      onActivityLine,
    )
  }

  let terminationRequested = false
  const terminate = (): void => {
    terminationRequested = true
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
  }
  const onAbort = (): void => terminate()
  opts.signal.addEventListener('abort', onAbort, { once: true })
  if (opts.signal.aborted) terminate()

  // densable max-lifetime optional
  const maxLifetimeMs = readEnvMs('SELF_HOSTED_RUNNER_MAX_LIFETIME_MS')
  let lifetimeTimer: ReturnType<typeof setTimeout> | undefined
  if (maxLifetimeMs > 0) {
    lifetimeTimer = setTimeout(() => {
      opts.onStatus(
        `[runner:session] ${opts.sessionId} max lifetime ${maxLifetimeMs}ms — terminating`,
      )
      terminate()
    }, maxLifetimeMs)
  }

  const stopGrace =
    readEnvMs('SELF_HOSTED_RUNNER_SESSION_STOP_GRACE_MS') ||
    DEFAULT_SESSION_STOP_GRACE_MS
  const postHook =
    opts.postSessionHookTimeoutMs ??
    (readEnvMs('SELF_HOSTED_RUNNER_POST_SESSION_HOOK_TIMEOUT_MS') ||
      DEFAULT_POST_SESSION_HOOK_TIMEOUT_MS)
  const sigkillGrace = Math.min(
    Math.max(
      readEnvMs('SELF_HOSTED_RUNNER_SIGKILL_GRACE_MS') || 30_000,
      postHook +
        (opts.pushOutcomeOnRelease ? PUSH_OUTCOME_BUDGET_MS : 0) +
        SHUTDOWN_BUDGET_PAD_MS,
    ),
    2_147_483_647,
  )

  return await new Promise<SessionChildResult>(resolve => {
    let settled = false
    const finish = (result: SessionChildResult): void => {
      if (settled) return
      settled = true
      opts.signal.removeEventListener('abort', onAbort)
      if (lifetimeTimer) clearTimeout(lifetimeTimer)
      disposeActivityPipeState(activityState)
      resolve(result)
    }

    child.on('close', (code, signal) => {
      const tail = stderrLines.join('\n')
      if (terminationRequested) {
        opts.onStatus(
          `[runner:session] ${opts.sessionId} child exited pid=${child.pid} code=${code} signal=${signal} (interrupted — we asked)`,
        )
        finish({ result: 'interrupted', exitCode: code, stderrTail: tail })
        return
      }
      if (signal === 'SIGTERM' || signal === 'SIGINT') {
        opts.onStatus(
          `[runner:session] ${opts.sessionId} child exited pid=${child.pid} code=${code} signal=${signal} (interrupted)`,
        )
        finish({ result: 'interrupted', exitCode: code, stderrTail: tail })
        return
      }
      if (code === 0) {
        opts.onStatus(
          `[runner:session] ${opts.sessionId} child exited pid=${child.pid} code=0 (completed)`,
        )
        finish({ result: 'completed', exitCode: 0, stderrTail: tail })
        return
      }
      opts.onStatus(
        `[runner:session] ${opts.sessionId} child exited pid=${child.pid} code=${code} signal=${signal} (failed) — debug log at ${opts.debugFile}`,
      )
      finish({ result: 'failed', exitCode: code, stderrTail: tail })
    })

    child.on('error', err => {
      opts.onDebug(
        `[runner:session] ${opts.sessionId} spawn error: ${err.message}`,
      )
      finish({
        result: 'failed',
        exitCode: null,
        stderrTail: `spawn error: ${err.message}`,
      })
    })

    // densable: if still running after stopGrace from terminate, SIGKILL
    if (opts.signal.aborted) {
      setTimeout(
        () => {
          if (!settled && child.pid !== undefined) {
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
        },
        Math.min(stopGrace, sigkillGrace),
      )
    }
  })
}

/**
 * densable `rBh` — handle one assigned session through spawn (core path).
 */
export async function handleSession(
  sessionId: string,
  opts: HandleSessionOpts,
  signal: AbortSignal,
): Promise<HandleSessionResult> {
  const {
    apiClient: api,
    getRunnerToken,
    baseDir,
    execPath,
    execArgs,
    capacity,
    onDebug,
    onStatus,
  } = opts

  onDebug(`[runner:session] Handling session ${sessionId}`)

  if (!sessionId || !/^[a-zA-Z0-9_-]+$/.test(sessionId)) {
    throw new Error('Invalid session_id: contains unsafe characters')
  }

  const sessionDir = join(baseDir, '_sessions', sessionId)
  const configDir = join(baseDir, '_sessions', `${sessionId}.claude-config`)
  const gitconfigPath = join(baseDir, '_sessions', `${sessionId}.gitconfig`)
  const debugFile = join(configDir, 'claude-code-debug.txt')
  const stageFileRoot = join(baseDir, '_sessions', `${sessionId}.uploads`)
  const multiCap = capacity > 1
  const restoreHooks = opts.configureGitHookStubs !== undefined && !multiCap
  const initStartedAt = Date.now()
  opts.onInitPhase?.({ kind: 'start' })
  let initEnded = false
  const endInitOk = (): void => {
    if (initEnded) return
    initEnded = true
    opts.onInitPhase?.({
      kind: 'end',
      durationSec: (Date.now() - initStartedAt) / 1000,
    })
  }
  const exitBeforeInit = (failed: boolean): void => {
    if (initEnded) return
    initEnded = true
    opts.onInitPhase?.({ kind: 'exit-before-init', failed })
  }

  let sessionTokenLive = ''
  let apiBaseUrlLive = ''
  let workerEpochLive: number | undefined
  // densable fe / nt / wr — finally cleanup + interval loops
  let fencePathLive: string | undefined
  let fenceWriteChain: Promise<unknown> = Promise.resolve()
  /** densable `re` — default `"failed"`; completed → unlink debug in finally */
  let exitResultForCleanup = 'failed'
  /** densable `de` — mcp-config.json path (always unlinked in finally) */
  let mcpConfigPathLive: string | undefined
  /** densable `Be` — repos where Tjv wrote local proxy credential.helper */
  let proxyCredTracksLive: Array<{ path: string; origin: string }> = []
  /** densable `Le` — worktrees cleaned in finally (even on abandoned) */
  const worktreesLive: SessionWorktree[] = []
  /** densable `qe` — outcome tracks cleaned in finally */
  type OutcomeTrack = {
    canonicalPath: string
    branch: string
    needsDetach: boolean
    createdSha?: string
    source: MappedCheckoutSource
  }
  const outcomeTracksLive: OutcomeTrack[] = []
  /** densable `Ue` — checkout-hook paths rm -rf in finally */
  const hookCheckoutPathsLive: string[] = []
  /**
   * densable `Ge` — epoch-stale / AKn fence trip: skip push-on-release
   * (another runner owns the session).
   */
  let epochStaleForCleanup = false
  let prepHeartbeat: IntervalRefreshLoop | undefined
  let inferenceRefresh: IntervalRefreshLoop | undefined
  let childStdinWrite: ((line: string) => void) | undefined
  // densable ke / Ze / $e — session-gone once-only end_session to child
  let sessionGoneNotified = false
  const endSessionLine = buildSessionGoneEndSessionLine(sessionId)
  let sessionTokenRefresh: TokenRefreshScheduler | undefined
  const pendingTokenAcks = new Map<string, PendingTokenAck>()
  // densable ye/Zt — CKn timeout settle → re-WJl with q.current
  const fenceBg = createIngressFenceBgController({
    getFencePath: () => fencePathLive,
    getLatestToken: () => (sessionTokenLive ? sessionTokenLive : undefined),
    enqueueRewrite: (path, tok, onBg) => {
      fenceWriteChain = fenceWriteChain.then(() =>
        writeSessionIngressToken(path, tok, onStatus, onBg),
      )
    },
  })
  /** densable `$e` */
  const handleSessionGone = (err: unknown, source: string): boolean => {
    const r = notifyChildSessionGone({
      err,
      source,
      sessionId,
      alreadySent: sessionGoneNotified,
      endSessionLine,
      write: childStdinWrite,
      onStatus,
    })
    sessionGoneNotified = r.sent
    return r.gone
  }

  try {
    const tokenRes = await retryAsync(
      () => api.issueSessionToken(getRunnerToken(), sessionId, signal),
      {
        initialDelayMs: 500,
        maxDelayMs: 8000,
        maxAttempts: 5,
        shouldRetry: isRetryableRunnerError,
        signal,
        onRetry: (n, err) => {
          onDebug(
            `[runner:session] issueSessionToken attempt ${n} transient failure (${errMsg(err)}) — retrying`,
          )
        },
      },
    )
    if (!tokenRes) {
      exitBeforeInit(false)
      exitResultForCleanup = 'abandoned'
      return { result: 'abandoned' }
    }
    let sessionToken = String(tokenRes.session_token)
    sessionTokenLive = sessionToken
    // densable $: yjv clean-slate hooks when capacity==1 + configure-git stubs
    if (restoreHooks && opts.configureGitHookStubs) {
      const { restoreGitHookStubs } = await import('./gitConfigure.js')
      await restoreGitHookStubs(
        opts.configureGitHookStubs,
        opts.configureGitSigningArtifacts,
        onDebug,
      )
    }
    // densable A + bjv: set session access token + restore HOME git-proxy snapshot
    if (opts.anthropicGitProxyBaseUrl) {
      process.env.CLAUDE_CODE_SESSION_ACCESS_TOKEN = sessionToken
      if (
        opts.gitProxyGlobalConfigSnapshot !== undefined &&
        opts.gitProxyGlobalConfigPath
      ) {
        const { sanitizeGitProxyHomeState } = await import('./gitConfigure.js')
        const xdgHome =
          process.env.XDG_CONFIG_HOME || join(homedir(), '.config')
        await sanitizeGitProxyHomeState(
          {
            globalConfigPath: opts.gitProxyGlobalConfigPath,
            globalConfigSnapshot: opts.gitProxyGlobalConfigSnapshot,
            homeGitconfigPath: join(homedir(), '.gitconfig'),
            xdgConfigPath: join(xdgHome, 'git', 'config'),
            credHelper: opts.gitProxyCredHelper,
            signingArtifacts: opts.configureGitSigningArtifacts,
          },
          onDebug,
        )
      }
    }
    opts.onSessionTokenIssued?.(sessionToken)
    // densable F2h — best-effort dump session JWT when --debug-token-dir set
    if (opts.debugTokenDir) {
      await writeDebugTokenFile(
        opts.debugTokenDir,
        `session_token_${sessionId}.jwt`,
        sessionToken,
        onStatus,
      )
    }
    if (signal.aborted) {
      onDebug(
        `[runner:session] Aborted after issueSessionToken for ${sessionId} — skipping registration`,
      )
      exitBeforeInit(false)
      exitResultForCleanup = 'abandoned'
      return { result: 'abandoned' }
    }
    onDebug(`[runner:session] Issued session_token for ${sessionId}`)

    // densable `Y` — mutable; pre-spawn re-fetch does `Y=jt` (full replace)
    let remote = await retryAsync(
      () => api.getSessionRemoteConfig(sessionId, sessionToken, signal),
      {
        initialDelayMs: 500,
        maxDelayMs: 8000,
        maxAttempts: 5,
        shouldRetry: isRetryableRunnerError,
        signal,
        onRetry: (n, err) => {
          onDebug(
            `[runner:session] getSessionRemoteConfig attempt ${n} transient failure (${errMsg(err)}) — retrying`,
          )
        },
      },
    )
    if (!remote) {
      exitBeforeInit(false)
      exitResultForCleanup = 'abandoned'
      return { result: 'abandoned' }
    }
    if (signal.aborted) {
      onDebug(
        `[runner:session] Aborted after getSessionRemoteConfig for ${sessionId} — skipping registration`,
      )
      exitBeforeInit(false)
      exitResultForCleanup = 'abandoned'
      return { result: 'abandoned' }
    }

    const sources = (remote.sources as unknown[] | undefined) ?? []
    const pushTargets = (remote.push_targets as unknown[] | undefined) ?? []
    // densable Y.api_base_url — mutable; re-fetch `if(jt)Y=jt` re-reads Y.api_base_url
    // for sjv/Y2h/Fjv. Keep local `apiBaseUrl` in sync after full remote replace.
    let apiBaseUrl = String(
      remote.api_base_url ?? process.env.ANTHROPIC_BASE_URL ?? '',
    )
    apiBaseUrlLive = apiBaseUrl
    onDebug(
      `[runner:session] Fetched remote config: ${sources.length} source(s), ${pushTargets.length} push target(s), api_base_url=${apiBaseUrl}`,
    )

    // densable djv — governed git supersedes anthropic git-proxy
    const governed = parseGovernedGitConfig(
      remote.governed_git as
        | {
            git_mount_base_url?: string
            tool_config?: { git_config?: boolean; gh_path_shim?: boolean }
          }
        | undefined,
      () => {
        if (!sessionTokenLive) {
          throw new Error(
            'governed git credential requested but no session token is available — token issue/refresh failed?',
          )
        }
        return sessionTokenLive
      },
      onStatus,
    )
    if (governed) {
      onStatus(
        `[runner:session] governed git ACTIVE for ${sessionId}: pre-CLI clone via git mount, in-session git/gh via the session relay (git_config=${governed.toolConfig.gitConfig}, gh_path_shim=${governed.toolConfig.ghPathShim})` +
          (multiCap
            ? ' — capacity>1: shared-canonical prep relies on per-invocation git hardening (no cross-session sanitize)'
            : ''),
      )
      if (opts.anthropicGitProxyBaseUrl) {
        onStatus(
          "[runner:warn] governed git supersedes --use-anthropic-git-proxy for this session — the work item's environment has ccr_runner_governed_git enabled; the legacy git-proxy flag is ignored",
        )
      }
      if (opts.pushOutcomeOnRelease) {
        onStatus(
          '[runner:warn] --push-outcome-on-release under governed git pushes to the PLAIN upstream URL with customer-managed credentials (the governed mount is read-only and the session relay ends with the child). If no ambient git credential covers the push target, the release-time push will fail naming this flag.',
        )
      }
    }
    const anthropicProxy = governed ? undefined : opts.anthropicGitProxyBaseUrl

    const hooksDir = opts.hooksDir ?? process.env.SELF_HOSTED_RUNNER_HOOKS_DIR
    const workspacePaths: string[] = []
    const checkoutHookPath = await resolveHookPath(hooksDir, 'checkout')
    if (checkoutHookPath && opts.pushOutcomeOnRelease) {
      onStatus(
        `[runner:warn] --push-outcome-on-release does not push repos checked out via the checkout lifecycle hook (${checkoutHookPath}); use the post-session hook to snapshot those`,
      )
    }

    // densable: map sources via full pjv (governed / proxy / legacy)
    let mapped: ReturnType<typeof mapSourcesForCheckout> = []
    if (sources.length > 0) {
      const rawSources = sources as Array<Record<string, unknown>>
      try {
        mapped = mapSourcesForCheckout(rawSources, {
          gitSshRewriteHosts: opts.gitSshRewriteHosts,
          gitHostRewrites: opts.gitHostRewrites,
          onDebug,
          anthropicGitProxy: anthropicProxy
            ? { apiBaseUrl: anthropicProxy, sessionId }
            : undefined,
          governedGit: governed
            ? {
                mountBaseUrl: governed.mountBaseUrl,
                getSessionToken: governed.getSessionToken,
              }
            : undefined,
        })
      } catch (err) {
        exitBeforeInit(true)
        throw err
      }
    }

    // densable: registerWorker + epoch fence BEFORE clone (rBh order).
    // Product previously cloned before register; densable posts prep events
    // with worker epoch, so register first then aWd/H2h.
    // Le/Ue/qe live arrays declared outer for densable finally cleanup.
    const worktrees = worktreesLive
    const hookCheckoutPaths = hookCheckoutPathsLive
    const outcomeTracks = outcomeTracksLive
    const pushBranchMap = mapOutcomeBranchLists(
      mapPushTargetsFromRemote(pushTargets),
    )
    const canonicalLocks =
      opts.canonicalLocks ?? new Map<string, Promise<unknown>>()

    const epoch = await retryAsync(
      () => api.registerWorker(apiBaseUrl, sessionId, sessionToken, signal),
      {
        initialDelayMs: 500,
        maxDelayMs: 8000,
        maxAttempts: 5,
        shouldRetry: isRetryableRunnerError,
        signal,
        onRetry: (n, err) => {
          onDebug(
            `[runner:session] registerWorker attempt ${n} transient failure (${errMsg(err)}) — retrying`,
          )
        },
      },
    )
    if (epoch === undefined) {
      exitBeforeInit(false)
      exitResultForCleanup = 'interrupted'
      return { result: 'interrupted' }
    }
    workerEpochLive = epoch
    onDebug(`[runner:session] Registered worker, epoch=${epoch}`)

    await retryAsync(
      () =>
        api.updateSessionWorkerState(
          apiBaseUrl,
          sessionId,
          sessionToken,
          epoch,
          'running',
          signal,
        ),
      {
        initialDelayMs: 500,
        maxDelayMs: 8000,
        maxAttempts: 5,
        shouldRetry: isRetryableRunnerError,
        signal,
        onRetry: (n, err) => {
          onDebug(
            `[runner:session] updateSessionWorkerState attempt ${n} transient failure (${errMsg(err)}) — retrying`,
          )
        },
      },
    )
    if (signal.aborted) {
      exitBeforeInit(false)
      exitResultForCleanup = 'interrupted'
      return { result: 'interrupted' }
    }

    // densable WJl epoch fence + mkdir + njv host seed + governed gitconfig
    const fencePath = sessionIngressTokenPath(configDir, epoch)
    fencePathLive = fencePath
    await withTimeoutMs(
      mkdir(sessionDir, { recursive: true }),
      30_000,
      `[runner:stuck] mkdir ${sessionDir}`,
    )
    await withTimeoutMs(
      mkdir(configDir, { recursive: true, mode: 0o700 }),
      30_000,
      `[runner:stuck] mkdir ${configDir}`,
    )
    await withTimeoutMs(
      mkdir(stageFileRoot, { recursive: true }),
      30_000,
      `[runner:stuck] mkdir ${stageFileRoot}`,
    )
    fenceWriteChain = writeSessionIngressToken(
      fencePath,
      sessionToken,
      onStatus,
      fenceBg.onBackground,
    )
    await fenceWriteChain
    onDebug(
      `[runner:session] Epoch fence passed for ${sessionId} (epoch=${epoch})`,
    )
    // densable z2h prep heartbeat every 30s until spawn
    prepHeartbeat = startIntervalRefreshLoop({
      intervalMs: 30_000,
      signal,
      refresh: async () => {
        await api.heartbeat(apiBaseUrl, sessionId, sessionToken, epoch, signal)
        onDebug(`[runner:session] prep heartbeat sent for ${sessionId}`)
      },
      onError: err => {
        onDebug(`[runner:session] prep heartbeat failed: ${errMsg(err)}`)
      },
    })

    await seedHostConfigIntoSession(
      configDir,
      opts.hostConfigSnapshot,
      onDebug,
      onStatus,
    )

    if (governed?.toolConfig.gitConfig) {
      await writeGovernedGitconfigSeed(
        gitconfigPath,
        opts.governedGitConfigSeed ?? '',
      )
      if (restoreHooks) {
        for (const [k, v] of governedSigningEntries(baseDir)) {
          await governedGitSpawn([
            'config',
            '--file',
            gitconfigPath,
            '--replace-all',
            k,
            v,
          ])
        }
      }
    }

    // densable Xt — step event helper (best-effort after register)
    const postStep = async (
      stepId: string,
      status: 'started' | 'completed' | 'failed',
      content: string,
      extra?: Record<string, string>,
    ): Promise<void> => {
      try {
        await api.postWorkerEvents(
          apiBaseUrl,
          sessionId,
          sessionTokenLive,
          epoch,
          [prepStepEvent(stepId, status, content, extra)],
          signal,
        )
      } catch (err) {
        // densable AKn — epoch mismatch aborts session
        if (isEpochMismatchRunnerError(err)) throw err
        onDebug(`[runner:session] step event post failed: ${errMsg(err)}`)
      }
    }
    // densable sr — Bjv init_milestone activity post
    const postMilestone = async (message: string): Promise<void> => {
      try {
        await api.postWorkerEvents(
          apiBaseUrl,
          sessionId,
          sessionTokenLive,
          epoch,
          [initMilestoneEvent(message)],
          signal,
        )
      } catch (err) {
        if (isEpochMismatchRunnerError(err)) throw err
        onDebug(`[runner:session] activity event post failed: ${errMsg(err)}`)
      }
    }
    await postStep('provision', 'completed', 'Runner registered', {
      expected_steps:
        mapped.length > 0 ? 'provision,clone,start_cc' : 'provision,start_cc',
    })

    // densable: prepare sources — H2h checkout hook OR aWd built-in clone
    if (mapped.length > 0) {
      onStatus(
        `[runner:session] Preparing ${mapped.length} git ${
          mapped.length === 1 ? 'repository' : 'repositories'
        } (${
          checkoutHookPath
            ? 'checkout hook'
            : multiCap
              ? 'worktree'
              : 'canonical-direct'
        } mode)`,
      )
      const preparedRepos: string[] = []
      const preparedSources: MappedCheckoutSource[] = []
      const preparedUrls: string[] = []
      const preparedPaths: string[] = []

      for (const src of mapped) {
        if (!isCheckoutHookSourceType(src.type)) continue
        const slug = sourceCheckoutSlug(src)
        const canon = sourceCanonicalPath(baseDir, src)
        if (!slug || !canon) {
          exitBeforeInit(true)
          throw new Error(
            `Source '${src.url}' resolved to an unsafe repo path (slug='${src.repo}'). Check for path traversal in the URL.`,
          )
        }
        await postMilestone(`Preparing ${src.repo}...`)
        await postStep('clone', 'started', `Preparing ${src.repo}`, {
          step_detail: src.repo,
        })
        const isWorkRepo = (pushBranchMap.get(src.repo)?.length ?? 0) > 0
        try {
          if (checkoutHookPath) {
            if (src.ref && !isSafeGitRevision(src.ref)) {
              exitBeforeInit(true)
              throw new Error(
                `[runner:session] refusing to pass unsafe ref to checkout hook: ${src.ref}`,
              )
            }
            const repoUrl =
              src.governedMount && src.upstreamUrl ? src.upstreamUrl : src.url
            if (!repoUrl || !isSafeGitUrl(repoUrl)) {
              exitBeforeInit(true)
              throw new Error(
                `[runner:session] refusing to pass unsafe repo URL to checkout hook: ${repoUrl}`,
              )
            }
            const checkoutPath = join(sessionDir, slug)
            await runCheckoutHook({
              hookPath: checkoutHookPath,
              sessionId,
              repoUrl,
              repoRef: src.ref,
              checkoutPath,
              apiBaseUrl,
              gitMountUrl: src.governedMount ? src.url : '',
              sessionAccessToken: sessionToken,
              cwd: sessionDir,
              onStatus,
              onDebug,
              signal,
            })
            preparedPaths.push(checkoutPath)
            preparedRepos.push(src.repo)
            preparedSources.push(src)
            preparedUrls.push(src.url ?? '')
            hookCheckoutPaths.push(checkoutPath)
            workspacePaths.push(checkoutPath)
            await postStep('clone', 'completed', `Prepared ${src.repo}`, {
              step_detail: src.repo,
            })
            continue
          }

          // densable built-in aWd path (no checkout hook)
          const worktreePath = multiCap ? join(sessionDir, slug) : canon
          await withCanonicalLock(canonicalLocks, canon, async () => {
            if (anthropicProxy || (governed && !multiCap)) {
              if (shouldSanitizeCanonical(onStatus, canon)) {
                await sanitizeCanonicalGitState(canon, onDebug, src.url)
              }
            } else {
              await resetStaleGitProxyCredHelper(canon, onDebug, !multiCap)
            }
            const prepSource: GitPrepareSource = {
              type: src.type,
              repo: src.repo,
              ref: src.ref,
              url: src.url,
              getAuthToken: src.getAuthToken,
              governedMount: src.governedMount,
              upstreamUrl: src.upstreamUrl,
            }
            await prepareSources({
              baseDir,
              sources: [prepSource],
              alwaysFetch: true,
              skipReset: multiCap,
              skipValidation: Boolean(
                process.env.CLAUDE_RUNNER_TRUST_CANONICAL_PREWARM && !multiCap,
              ),
              onDebug,
              onPhase: (phase, ms, extra) => {
                api
                  .postWorkerEvents(
                    apiBaseUrl,
                    sessionId,
                    sessionToken,
                    epoch,
                    [prepClonePhaseEvent(src.repo, phase, ms, extra)],
                    signal,
                  )
                  .catch(err =>
                    onDebug(
                      `[runner:session] prep-phase event post failed: ${errMsg(err)}`,
                    ),
                  )
              },
              onProgress: (cmd, progress) => {
                const detail =
                  progress.total !== undefined
                    ? ` (${progress.done}/${progress.total})`
                    : ''
                void postStep(
                  'clone',
                  'started',
                  `${src.repo} — ${progress.label} ${progress.pct}%${detail}`,
                  {
                    step_detail: src.repo,
                    clone_sub: cmd,
                    progress_label: progress.label,
                    progress_pct: String(progress.pct),
                    ...(progress.done !== undefined
                      ? { progress_done: String(progress.done) }
                      : {}),
                    ...(progress.total !== undefined
                      ? { progress_total: String(progress.total) }
                      : {}),
                  },
                )
              },
              signal,
            })
            if (multiCap) {
              await addSessionWorktree({
                canonicalRepoPath: canon,
                worktreePath,
                ref: src.ref,
                onDebug,
                signal,
              })
            }
          })
          if (multiCap) {
            worktrees.push({
              canonicalRepoPath: canon,
              worktreePath,
            })
          }
          preparedPaths.push(worktreePath)
          preparedRepos.push(src.repo)
          preparedSources.push(src)
          preparedUrls.push(src.url ?? '')
          workspacePaths.push(worktreePath)
          await postStep('clone', 'completed', `Prepared ${src.repo}`, {
            step_detail: src.repo,
          })
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          if (isSourceRefNotFoundMessage(msg)) {
            if (!isWorkRepo) {
              const refLabel = src.ref ? `'${src.ref}'` : 'the configured ref'
              onDebug(
                `[runner:session] context source ${src.repo} ref ${refLabel} permanently not found on remote; skipping (not a work repo — no push_targets entry)`,
              )
              await postStep(
                'clone',
                'completed',
                `Skipped ${src.repo} — source ref ${refLabel} no longer exists on remote; continuing without this context repo`,
                { step_detail: src.repo },
              )
              continue
            }
            const e = new Error(msg)
            e.name = 'SourceRefNotFound'
            opts.onSessionStartHookError?.()
            exitBeforeInit(true)
            throw e
          }
          if (checkoutHookPath) opts.onSessionStartHookError?.()
          exitBeforeInit(true)
          throw err
        }
      }

      await postStep('clone', 'completed', 'Finished preparing sources')

      // densable Tjv — wire repo-local git-proxy cred helper (Be tracks for finally unset)
      if (anthropicProxy) {
        let proxyOrigin = ''
        try {
          proxyOrigin = new URL(anthropicProxy).origin
        } catch {
          proxyOrigin = ''
        }
        for (let i = 0; i < preparedPaths.length; i++) {
          const src = preparedSources[i]
          const path = preparedPaths[i]!
          if (!src?.getAuthToken) continue
          if (hookCheckoutPaths.includes(path)) continue
          if (proxyOrigin) {
            proxyCredTracksLive.push({ path, origin: proxyOrigin })
          }
          await wireGitProxyRepoLocalCredHelper(
            path,
            anthropicProxy,
            onDebug,
            signal,
          )
        }
      }
      // densable vjv — governed: reset origin to plain upstream
      if (governed) {
        const seen = new Set<string>()
        for (let i = 0; i < preparedPaths.length; i++) {
          const src = preparedSources[i]
          const path = preparedPaths[i]!
          if (!src?.governedMount || !src.upstreamUrl) continue
          if (hookCheckoutPaths.includes(path)) continue
          const canon =
            worktrees.find(w => w.worktreePath === path)?.canonicalRepoPath ??
            path
          if (seen.has(canon)) continue
          seen.add(canon)
          await resetGovernedOriginToUpstream(
            canon,
            src.upstreamUrl,
            onDebug,
            signal,
          )
        }
      }

      // densable Ojv/Djv/Pjv — outcome branch prep + track for push-on-release
      for (let i = 0; i < preparedPaths.length; i++) {
        const repo = preparedRepos[i]!
        const branches = pushBranchMap.get(repo)
        if (!branches || branches.length === 0) continue
        const [primary, ...extra] = branches
        if (!primary) continue
        const path = preparedPaths[i]!
        const src = preparedSources[i]!
        const wt = worktrees.find(w => w.worktreePath === path)
        const canon = wt?.canonicalRepoPath ?? path
        if (extra.length > 0) {
          const useAuth = Boolean(
            src.getAuthToken && !hookCheckoutPaths.includes(path),
          )
          await fetchOutcomeBranches(
            path,
            extra,
            onDebug,
            signal,
            spawn,
            preparedUrls[i]!.startsWith('file://'),
            anthropicProxy && useAuth ? src.url : undefined,
            src.governedMount && useAuth
              ? { url: src.url, getToken: src.getAuthToken! }
              : undefined,
          )
        }
        let startPoint: string | undefined
        if (
          opts.pushOutcomeOnRelease &&
          epoch > 1 &&
          !hookCheckoutPaths.includes(path)
        ) {
          if (
            await fetchPriorOutcomeBranch(
              canon,
              primary,
              {
                type: src.type,
                repo: src.repo,
                ref: src.ref,
                url: src.url,
                getAuthToken: src.getAuthToken,
                governedMount: src.governedMount,
                upstreamUrl: src.upstreamUrl,
              },
              PUSH_ON_RELEASE_RESUME_FETCH_MS,
              onDebug,
              signal,
            )
          ) {
            startPoint = `refs/remotes/origin/${primary}`
          }
        }
        await createOutcomeBranch(
          path,
          primary,
          onDebug,
          signal,
          Boolean(opts.anthropicGitProxyBaseUrl),
          startPoint,
        )
        if (hookCheckoutPaths.includes(path)) continue
        outcomeTracks.push({
          canonicalPath: canon,
          branch: primary,
          needsDetach: !wt,
          createdSha: opts.pushOutcomeOnRelease
            ? await revParseVerify(canon, `refs/heads/${primary}`)
            : undefined,
          source: src,
        })
      }
    }

    // densable G2h + xjv/Ijv remote.cwd gate (reject symlink / out-of-root)
    const remoteCwd = typeof remote.cwd === 'string' ? remote.cwd : undefined
    let { childCwd, addDirs } = resolveChildCwdAndAddDirs(
      sessionDir,
      workspacePaths,
      remoteCwd,
    )
    if (remoteCwd) {
      const accepted = await acceptRemoteCwdUnderSession(
        sessionDir,
        remoteCwd,
        resolveUnderSessionRoot,
      )
      if (accepted === null) {
        onDebug(
          `[runner:session] config.cwd=${remoteCwd} rejected (not under ${sessionDir}, a segment is a symlink, or fs op timed out)`,
        )
        ;({ childCwd, addDirs } = resolveChildCwdAndAddDirs(
          sessionDir,
          workspacePaths,
        ))
      }
    }
    if (addDirs.length > 0) {
      onDebug(`[runner:session] cwd=${childCwd} + ${addDirs.length} --add-dir`)
    }

    // densable rBh confine (EKn + kjv + outside-workspace) before spawn
    const confineMode: ConfineRepoSettings =
      opts.confineRepoSettings ?? 'enforce'
    await applyRepoSettingsConfine({
      mode: confineMode,
      childCwd,
      addDirs,
      preparedPaths: workspacePaths,
      configDir,
      stageFileRoot,
      onStatus,
    })

    // densable post-confine EKn: session config dir vs global sG/Kw/f2t temps
    assertConfigDirOutsideGlobalTemp(configDir)

    // densable D: Set([ht, ...qt, ...Le.canonicalRepoPath])
    // ht=childCwd, qt=workspacePaths (prepared checkouts), Le=worktrees
    if (opts.trustWorkspace !== false) {
      const trustPaths = [
        childCwd,
        ...workspacePaths,
        ...worktrees.map(w => w.canonicalRepoPath),
      ]
      await seedPersistedWorkspaceTrust({
        configDir,
        trustPaths,
        hostMcpServers: opts.hostConfigSnapshot?.mcpServers,
        configSuffix: claudeConfigFileSuffix(),
        onDebug,
      })
    }

    // densable remote mcp_config.content (base64) → mcp-config.json
    let mcpConfigPath: string | undefined
    const mcpCfg = (remote as { mcp_config?: { content?: string } }).mcp_config
    if (typeof mcpCfg?.content === 'string' && mcpCfg.content.length > 0) {
      mcpConfigPath = await writeRemoteMcpConfig(
        configDir,
        mcpCfg.content,
        onDebug,
      )
      mcpConfigPathLive = mcpConfigPath
    }

    // densable: after git prep + mcp_config, abort before qUi/spawn → abandoned
    if (signal.aborted) {
      onDebug(
        `[runner:session] Aborted after git prep for ${sessionId} — bailing before spawn`,
      )
      exitResultForCleanup = 'abandoned'
      return { result: 'abandoned' }
    }

    // densable: onChildInit ends init phase (Q=!0 + _.({kind:"end"})) — not pre-spawn
    // endInitOk is wired via spawn onInitObserved below

    const runPostHook = async (
      exitReason: string,
      optsExtra?: { sessionGone?: boolean; epochStale?: boolean },
    ): Promise<void> => {
      // densable finally: push-on-release before post-session hook
      // densable: M && Je && re!=="completed" && reason!=="deassign" && !Ge && qe.length
      if (
        opts.pushOutcomeOnRelease &&
        exitReason !== 'completed' &&
        !optsExtra?.sessionGone &&
        !optsExtra?.epochStale &&
        !epochStaleForCleanup &&
        outcomeTracks.length > 0 &&
        String((signal as AbortSignal & { reason?: unknown }).reason ?? '') !==
          'deassign'
      ) {
        onStatus(
          `[runner:session] ${sessionId} ${exitReason}: --push-outcome-on-release pushing ${outcomeTracks.length} outcome branch(es) to the source remote`,
        )
        const budgetEnd = Date.now() + PUSH_OUTCOME_BUDGET_MS
        for (const track of outcomeTracks) {
          let remain = budgetEnd - Date.now()
          if (remain <= 0) {
            onDebug(
              `[runner:session] push-on-release budget exhausted; skipping '${track.branch}' (best-effort)`,
            )
            continue
          }
          if (track.createdSha) {
            const head = await revParseVerify(
              track.canonicalPath,
              `refs/heads/${track.branch}`,
              remain,
            )
            if (head === track.createdSha) {
              onDebug(
                `[runner:session] push-on-release '${track.branch}' has no commits since creation; skipping (best-effort)`,
              )
              continue
            }
          }
          remain = budgetEnd - Date.now()
          if (remain <= 0) {
            onDebug(
              `[runner:session] push-on-release budget exhausted; skipping '${track.branch}' (best-effort)`,
            )
            continue
          }
          await pushOutcomeBranch(
            track.canonicalPath,
            track.branch,
            {
              type: track.source.type,
              repo: track.source.repo,
              ref: track.source.ref,
              url: track.source.url,
              getAuthToken: track.source.getAuthToken,
              governedMount: track.source.governedMount,
              upstreamUrl: track.source.upstreamUrl,
            },
            remain,
            onDebug,
          )
        }
      }

      const postPath = await resolveHookPath(hooksDir, 'post-session')
      if (postPath) {
        const timeoutMs =
          opts.postSessionHookTimeoutMs ??
          (readEnvMs('SELF_HOSTED_RUNNER_POST_SESSION_HOOK_TIMEOUT_MS') ||
            DEFAULT_POST_SESSION_HOOK_TIMEOUT_MS)
        await runPostSessionHook({
          hookPath: postPath,
          sessionId,
          exitReason,
          debugLogPath: debugFile,
          workspacePaths:
            workspacePaths.length > 0 ? workspacePaths : [sessionDir],
          apiBaseUrl,
          sessionAccessToken: sessionToken,
          cwd: sessionDir,
          timeoutMs,
          onStatus,
          onDebug,
        }).catch(err => {
          onDebug(
            `[runner:hook:post-session] unexpected rejection (ignored): ${errMsg(err)}`,
          )
        })
      }

      // densable Fjv runs in outer finally (not Je-gated) — see finally below
    }

    if (opts.skipSpawn) {
      // densable skip path has no child init; close init metrics here
      endInitOk()
      exitResultForCleanup = 'completed'
      await runPostHook('completed')
      return { result: 'completed', exitCode: 0 }
    }

    const inferenceAuth = remote.inference_auth as
      | { access_token?: string; expires_in_seconds?: number }
      | undefined
    const accessToken = inferenceAuth?.access_token
    if (!accessToken) {
      throw new Error(
        `Session ${sessionId} /remote response is missing inference_auth.access_token`,
      )
    }
    if (inferenceAuth?.expires_in_seconds !== undefined) {
      onDebug(
        `[runner:session] inference_auth set (expires_in=${inferenceAuth.expires_in_seconds}s)`,
      )
    }

    // densable qUi/at — session_token refresh scheduler (before spawn)
    sessionTokenRefresh = createRunnerTokenRefreshScheduler({
      label: 'self-hosted-runner-session',
      getAccessToken: async () => {
        try {
          const res = await api.refreshToken(sessionTokenLive)
          return String(res.token)
        } catch (err) {
          if (handleSessionGone(err, 'refreshToken')) {
            sessionTokenRefresh?.cancel(sessionId)
          }
          throw err
        }
      },
      onRefresh: (sid, nextTok) => {
        sessionToken = nextTok
        sessionTokenLive = nextTok
        if (opts.anthropicGitProxyBaseUrl) {
          process.env.CLAUDE_CODE_SESSION_ACCESS_TOKEN = nextTok
        }
        if (fencePathLive) {
          const path = fencePathLive
          fenceWriteChain = fenceWriteChain.then(() =>
            writeSessionIngressToken(
              path,
              nextTok,
              onStatus,
              fenceBg.onBackground,
            ),
          )
        }
        sweepPendingTokenAcks({
          pendingAcks: pendingTokenAcks,
          sessionId: sid,
          onStatus,
        })
        pushTokenToChild({
          write: childStdinWrite,
          envVar: 'CLAUDE_CODE_SESSION_ACCESS_TOKEN',
          token: nextTok,
          sessionId: sid,
          label: 'session_token',
          onStatus,
          pendingAcks: pendingTokenAcks,
        })
      },
      onLog: (msg, meta) => {
        if (meta?.level === 'error') onStatus(msg)
        else onDebug(msg)
      },
    })
    sessionTokenRefresh.schedule(sessionId, sessionToken)

    // densable: re-fetch /remote for fresher config+token before spawn
    // SEA: if(jt)Y=jt  — full object replace (not inference_auth patch-only)
    try {
      const freshRemote = await retryAsync(
        () => api.getSessionRemoteConfig(sessionId, sessionToken, signal),
        {
          initialDelayMs: 1000,
          maxDelayMs: 30_000,
          maxAttempts: 5,
          shouldRetry: isRetryableRunnerError,
          signal,
          onRetry: (n, err) => {
            onDebug(
              `[runner:session] /remote re-fetch attempt ${n} failed: ${errMsg(err)}. Retrying.`,
            )
          },
        },
      )
      if (freshRemote) {
        remote = freshRemote
        // densable: after if(jt)Y=jt, spawn/Y2h/Fjv use Y.api_base_url (not frozen first fetch)
        apiBaseUrl = String(
          remote.api_base_url ?? process.env.ANTHROPIC_BASE_URL ?? '',
        )
        apiBaseUrlLive = apiBaseUrl
        const fa = remote.inference_auth as
          | { access_token?: string; expires_in_seconds?: number }
          | undefined
        onDebug(
          `[runner:session] Re-fetched /remote for fresh inference token (expires_in=${fa?.expires_in_seconds}s)`,
        )
        // densable F2h after Y=jt (not pre-refresh dump)
        if (opts.debugTokenDir && fa?.access_token) {
          await writeDebugTokenFile(
            opts.debugTokenDir,
            `inference_token_${sessionId}.txt`,
            fa.access_token,
            onStatus,
          )
        }
      } else {
        onDebug(
          '[runner:session] /remote re-fetch failed after retries — using stale step-2 token. Interval refresher will converge.',
        )
      }
    } catch (err) {
      if (handleSessionGone(err, '/remote')) {
        // densable: still proceed; child will be told end_session
      } else {
        onDebug(
          `[runner:session] /remote re-fetch error: ${errMsg(err)} — using stale step-2 token`,
        )
      }
    }

    const inferenceAuthLive = remote.inference_auth as
      | { access_token?: string; expires_in_seconds?: number }
      | undefined
    const accessTokenLive = inferenceAuthLive?.access_token ?? accessToken

    // densable z2h + W2h — inference token interval refresh via /remote + q2h/j2h
    inferenceRefresh = startIntervalRefreshLoop({
      intervalMs: inferenceRefreshIntervalMs(
        inferenceAuthLive?.expires_in_seconds ??
          inferenceAuth?.expires_in_seconds,
      ),
      signal,
      refresh: async () => {
        const next = await api.getSessionRemoteConfig(
          sessionId,
          sessionTokenLive,
          signal,
        )
        const nextTok = (next as { inference_auth?: { access_token?: string } })
          .inference_auth?.access_token
        if (!nextTok) {
          throw new Error(
            'getSessionRemoteConfig returned no inference_auth.access_token',
          )
        }
        sweepPendingTokenAcks({
          pendingAcks: pendingTokenAcks,
          sessionId,
          onStatus,
        })
        pushTokenToChild({
          write: childStdinWrite,
          envVar: 'CLAUDE_CODE_OAUTH_TOKEN',
          token: nextTok,
          sessionId,
          label: 'inference_token',
          onStatus,
          expiresInSeconds: (
            next as {
              inference_auth?: { expires_in_seconds?: number }
            }
          ).inference_auth?.expires_in_seconds,
          pendingAcks: pendingTokenAcks,
        })
        return inferenceRefreshIntervalMs(
          (
            next as {
              inference_auth?: { expires_in_seconds?: number }
            }
          ).inference_auth?.expires_in_seconds,
        )
      },
      onError: err => {
        // densable $e(err, "/remote") → cancel z2h permanently
        if (handleSessionGone(err, '/remote')) {
          inferenceRefresh?.cancel()
          return
        }
        onStatus(
          `[runner:session] inference_token refresh failed: ${errMsg(err)}. Retrying shortly.`,
        )
      },
    })

    const envVars = (remote.environment_variables ?? {}) as Record<
      string,
      string | undefined
    >
    const claudeCodeArgs = (remote.claude_code_args ?? {}) as Record<
      string,
      unknown
    >

    // densable: cancel prep heartbeat before spawn (nt?.cancel())
    prepHeartbeat?.cancel()
    prepHeartbeat = undefined

    const spawnFn = opts.spawnChild ?? spawnSessionChild
    opts.onChildLifecycle?.('spawned')
    let childResult: SessionChildResult
    try {
      await postStep('start_cc', 'started', 'Starting Claude Code')
      childResult = await spawnFn({
        execPath,
        execArgs,
        apiBaseUrl,
        sessionId,
        sessionToken,
        workerEpoch: epoch,
        cwd: childCwd,
        configDir,
        stageFileRoot,
        debugFile,
        capacity,
        healthPort: opts.healthPort,
        clientPlatform: opts.clientPlatform,
        environmentVariables: envVars,
        inferenceAccessToken: accessTokenLive,
        claudeCodeArgs,
        mcpConfigPath,
        addDirs: addDirs.length > 0 ? addDirs : undefined,
        // densable sjv(governedGit:pt, governedGitConfigPath:J)
        governedGitConfig: governed?.toolConfig.gitConfig,
        governedGhPathShim: governed?.toolConfig.ghPathShim,
        governedGitConfigPath: governed?.toolConfig.gitConfig
          ? gitconfigPath
          : undefined,
        onDebug,
        onStatus,
        signal,
        postSessionHookTimeoutMs: opts.postSessionHookTimeoutMs,
        pushOutcomeOnRelease: opts.pushOutcomeOnRelease,
        onSessionActivity: opts.onSessionActivity,
        onBgTaskLedger: opts.onBgTaskLedger,
        onSessionStartHookError: opts.onSessionStartHookError,
        // densable onChildInit: Q=!0, _.({kind:"end", durationSec})
        onInitObserved: () => {
          endInitOk()
        },
        onStdinReady: write => {
          // densable onChildStdinReady: Qt=Wr; if(ke) Wr(Ze)
          childStdinWrite = write
          if (sessionGoneNotified) write(endSessionLine)
        },
        onTokenAck: requestId => {
          pendingTokenAcks.delete(requestId)
        },
      })
    } catch (err) {
      onStatus(`[runner:session] ${sessionId} spawn failed: ${errMsg(err)}`)
      opts.onChildLifecycle?.('failed')
      if (workerEpochLive !== undefined) {
        await postSessionFailureResult({
          apiClient: api,
          apiBaseUrl,
          sessionId,
          sessionToken,
          workerEpoch: workerEpochLive,
          exitCode: null,
          stderrTail: errMsg(err),
          onDebug,
          onStatus,
          signal,
        })
      }
      exitResultForCleanup = 'failed'
      await runPostHook('failed')
      return {
        result: 'failed',
        exitCode: null,
        failureReason: `child exited null: ${errMsg(err)}`,
        failureKind: 'SESSION_FAILURE_KIND_RUNNER_CRASH',
      }
    }

    // densable: defer onChildLifecycle for completed/failed until after
    // clean-close reclass; interrupt maps idle-release/deassign → completed
    // densable Y2h on failed/interrupted
    let sessionGone = false
    if (
      (childResult.result === 'failed' ||
        childResult.result === 'interrupted') &&
      workerEpochLive !== undefined
    ) {
      const y = await postSessionFailureResult({
        apiClient: api,
        apiBaseUrl,
        sessionId,
        sessionToken,
        workerEpoch: workerEpochLive,
        exitCode: childResult.exitCode,
        stderrTail: childResult.stderrTail,
        onDebug,
        onStatus,
        signal,
      })
      if (y === 'session_gone') sessionGone = true
      // densable: jt==="epoch_stale" → Ge=!0 (skip push-on-release)
      if (y === 'epoch_stale') epochStaleForCleanup = true
    }
    // densable: clean close when child failed after server end_session
    let finalResult = childResult.result
    let finalReason: string | undefined
    if (
      childResult.result === 'failed' &&
      sessionGone &&
      (childResult.stderrTail.includes('SDKStartup: exiting without result') ||
        childResult.stderrTail.includes(
          'RemoteIO: transport closed permanently',
        ) ||
        childResult.stderrTail.includes('worker epoch mismatch (409)'))
    ) {
      onStatus(
        `[runner:session] ${sessionId} child exit ${childResult.exitCode ?? 'null'} after server end_session — session archived/deleted; clean close, not a runner failure`,
      )
      finalResult = 'completed'
    }

    // densable: if(Tt!==void 0&&(re==="completed"||re==="failed")) h?.(re);
    // else if(re==="interrupted") h?.(idle-release|deassign ? "completed" : "interrupted")
    if (finalResult === 'completed' || finalResult === 'failed') {
      opts.onChildLifecycle?.(finalResult)
    } else if (finalResult === 'interrupted') {
      const reason = String(
        (signal as AbortSignal & { reason?: unknown }).reason ?? '',
      )
      opts.onChildLifecycle?.(
        reason === 'idle-release' || reason === 'deassign'
          ? 'completed'
          : 'interrupted',
      )
    }

    exitResultForCleanup = finalResult
    await runPostHook(finalResult, {
      sessionGone,
      epochStale: epochStaleForCleanup,
    })
    if (finalResult === 'failed') {
      return {
        result: 'failed',
        exitCode: childResult.exitCode,
        failureReason: `child exited ${childResult.exitCode ?? 'null'}: ${childResult.stderrTail}`,
        failureKind: 'SESSION_FAILURE_KIND_RUNNER_CRASH',
      }
    }
    if (finalResult === 'interrupted') {
      return {
        result: 'interrupted',
        exitCode: childResult.exitCode,
        failureReason:
          finalReason ??
          `child interrupted (SIGTERM/watchdog): ${childResult.stderrTail}`,
      }
    }
    return {
      result: finalResult,
      exitCode: childResult.exitCode,
    }
  } catch (err) {
    if (signal.aborted) {
      onDebug(
        `[runner:session] ${sessionId} aborted during setup (reason=${String(
          (signal as AbortSignal & { reason?: unknown }).reason ??
            'unspecified',
        )}) — not a failure`,
      )
      exitBeforeInit(false)
      exitResultForCleanup = 'interrupted'
      return { result: 'interrupted' }
    }
    // densable AKn — epoch fence tripped; re="abandoned", Ge=!0 (no Y2h)
    if (isEpochMismatchRunnerError(err)) {
      onDebug(
        `[runner:session] epoch fence tripped — another runner has taken ${sessionId} (we got epoch ${workerEpochLive} but server rejected). Aborting before spawn.`,
      )
      exitBeforeInit(false)
      epochStaleForCleanup = true
      exitResultForCleanup = 'abandoned'
      return { result: 'abandoned' }
    }
    const classified = classifyThrownFailure(err, 'setup threw')
    exitBeforeInit(true)
    onDebug(
      `[runner:session] Session ${sessionId} threw: ${classified.failureReason}`,
    )
    if (workerEpochLive !== undefined && sessionTokenLive && apiBaseUrlLive) {
      const y = await postSessionFailureResult({
        apiClient: api,
        apiBaseUrl: apiBaseUrlLive,
        sessionId,
        sessionToken: sessionTokenLive,
        workerEpoch: workerEpochLive,
        exitCode: null,
        stderrTail: classified.failureReason ?? errMsg(err),
        onDebug,
        onStatus,
        signal,
      })
      // densable: Y2h === "epoch_stale" → Ge=!0
      if (y === 'epoch_stale') epochStaleForCleanup = true
    }
    exitResultForCleanup = 'failed'
    return {
      result: 'failed',
      ...classified,
    }
  } finally {
    // densable finally order (rBh): push/post (via runPostHook when Je)
    // → Fjv (not Je-gated) → unlink ne/de → Le → qe → Be → Ue
    // → delete env token → B2h fence
    // densable: if(G!==void 0&&!Q)_?.({kind:"exit-before-init",failed:W})
    if (!initEnded) {
      exitBeforeInit(exitResultForCleanup === 'failed')
    }
    prepHeartbeat?.cancel()
    inferenceRefresh?.cancel()
    sessionTokenRefresh?.cancelAll()
    childStdinWrite = undefined
    // densable Fjv — if(le&&q.current&&Y.api_base_url) always, not only Je
    if (workerEpochLive !== undefined && sessionTokenLive && apiBaseUrlLive) {
      await forwardDebugLogDiagnostics({
        apiClient: api,
        apiBaseUrl: apiBaseUrlLive,
        sessionId,
        sessionToken: sessionTokenLive,
        workerEpoch: workerEpochLive,
        debugFile,
        onDebug,
      }).catch(err => {
        onDebug(
          `[runner:session] debug log flush failed (best-effort): ${errMsg(err)}`,
        )
      })
    }
    // densable: completed → unlink debug; always unlink mcp
    await cleanupSessionSideFiles({
      sessionId,
      exitResult: exitResultForCleanup,
      debugFile,
      mcpConfigPath: mcpConfigPathLive,
      onStatus,
    })
    if (worktreesLive.length > 0) {
      await cleanupSessionWorktrees({
        worktrees: worktreesLive,
        onDebug,
      }).catch(err => {
        onDebug(`[runner:session] worktree cleanup failed: ${errMsg(err)}`)
      })
    }
    for (const track of outcomeTracksLive) {
      await cleanupOutcomeBranch(
        track.canonicalPath,
        track.branch,
        track.needsDetach,
        onDebug,
        Boolean(opts.anthropicGitProxyBaseUrl),
      )
    }
    // densable Be — unset Tjv local proxy credential.helper entries
    if (opts.anthropicGitProxyBaseUrl && proxyCredTracksLive.length > 0) {
      for (const track of proxyCredTracksLive) {
        await unsetGitProxyRepoLocalCredHelper(
          track.path,
          opts.anthropicGitProxyBaseUrl,
          onDebug,
        )
      }
    }
    // densable Ue — rm -rf checkout-hook paths
    for (const hookPath of hookCheckoutPathsLive) {
      await rm(hookPath, { recursive: true, force: true }).catch(err => {
        onDebug(`[runner:hook] cleanup ${hookPath} failed: ${errMsg(err)}`)
      })
    }
    if (opts.anthropicGitProxyBaseUrl) {
      delete process.env.CLAUDE_CODE_SESSION_ACCESS_TOKEN
    }
    // densable B2h — He first, await we, sweep fence + .tmp siblings;
    // if De, pe.then(() => B2h again without ye)
    if (fencePathLive) {
      fenceBg.markFinalized()
      await fenceWriteChain.catch(() => {})
      await cleanupSessionIngressToken(
        fencePathLive,
        onStatus,
        fenceBg.onBackground,
      )
      if (fenceBg.hadBackgroundTimeout()) {
        const path = fencePathLive
        fenceBg
          .backgroundAll()
          .then(() => cleanupSessionIngressToken(path, onStatus, undefined))
          .catch(() => {})
      }
    }
  }
}
