import { type ChildProcess, execFile } from 'child_process'
import { type FSWatcher, watch } from 'fs'
import { realpath, stat } from 'fs/promises'
import { basename, dirname, resolve } from 'path'
import { tryProcessCwd } from '../utils/cachePaths.js'
import { buildCliLaunch, spawnCli } from '../utils/cliLaunch.js'
import {
  getProcessWrapperArgv,
  getProcessWrapperError,
  isProcessWrapperRunnable,
} from '../utils/processWrapper.js'
import { gt as semverGt } from '../utils/semver.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../services/analytics/index.js'
import {
  writeDaemonState,
  removeDaemonState,
  queryDaemonStatus,
} from './state.js'
import {
  type DaemonLockData,
  classifyDaemonLockHolder,
  getDaemonLockPath,
  isDaemonLockSignalable,
  isDaemonPidRaceLive,
  readAliveDaemonLock,
  readDaemonLockLoose,
} from './daemonLock.js'
import {
  type DaemonConfig,
  type DaemonWorkerKind,
  type SupervisorAuthManager,
  type SupervisorToWorkerIpcMessage,
  buildRemoteControlConfigFromEnv,
  createSupervisorAuthManager,
  diffDaemonConfig,
  emptyDaemonConfig,
  getDefaultDaemonConfigPath,
  loadDaemonConfig,
} from './workerRegistry.js'

/**
 * Exit code used by workers for permanent (non-retryable) failures.
 * @see workerRegistry.ts EXIT_CODE_PERMANENT
 */
const EXIT_CODE_PERMANENT = 78

/**
 * Backoff config for restarting crashed workers.
 */
const BACKOFF_INITIAL_MS = 2_000
const BACKOFF_CAP_MS = 120_000
const BACKOFF_MULTIPLIER = 2
const MAX_RAPID_FAILURES = 5 // Park worker after this many fast crashes

// SEA rr(r) / UD / mV (#145): JSON-quote multi-line daemon log messages and
// \uXXXX-escape control/invisible code points on single-line messages.
const DAEMON_LOG_ANSI_RE =
  // eslint-disable-next-line no-control-regex
  // biome-ignore lint/suspicious/noControlCharactersInRegex: strip ANSI escape sequences
  /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><~]/g
const DAEMON_LOG_INVISIBLE_RE =
  /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\u2028\u2029\p{Default_Ignorable_Code_Point}\u2800]/gu
const DAEMON_LOG_JSON_ESCAPE_RE =
  /[\p{Cf}\p{Co}\p{Cn}\u2028\u2029\u007F-\u009F\p{Default_Ignorable_Code_Point}\u2800]/gu

function escapeDaemonCodeUnits(s: string): string {
  return s
    .split('')
    .map(ch => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'))
    .join('')
}

function escapeDaemonJsonInvisible(s: string): string {
  return s.replace(DAEMON_LOG_JSON_ESCAPE_RE, match =>
    Array.from(
      { length: match.length },
      (_, i) => '\\u' + match.charCodeAt(i).toString(16).padStart(4, '0'),
    ).join(''),
  )
}

export function formatDaemonLogMessage(raw: string): string {
  const clean = raw.replace(DAEMON_LOG_ANSI_RE, '').trimEnd()
  return clean.includes('\n')
    ? escapeDaemonJsonInvisible(JSON.stringify(clean))
    : clean.replace(DAEMON_LOG_INVISIBLE_RE, escapeDaemonCodeUnits)
}

export type DaemonUpgradePollState = {
  refusedStaleTarget: string | null
  deferredLauncherLogged: boolean
}

export type DaemonUpgradePollResult =
  | { shouldRestart: true }
  | {
      shouldRestart: false
      reason: 'unchanged' | 'stale_binary' | 'launcher_unrunnable'
    }

function isOlderVersionBuild(running: string, candidate: string): boolean {
  try {
    return semverGt(running, candidate)
  } catch {
    return false
  }
}

/**
 * SEA Ve upgrade poll (#74):
 * 1. Refuse downgrade to an older build (`tengu_daemon_upgrade_refused_stale_binary`).
 * 2. When non-service and CLAUDE_CODE_PROCESS_WRAPPER is configured, defer
 *    restart if the launcher is not runnable (`upgrade_deferred_launcher_unrunnable`).
 * 3. Otherwise proceed with self-restart (`tengu_daemon_self_restart_on_upgrade`).
 */
export function evaluateDaemonUpgradePoll(opts: {
  startupVersion: string
  currentVersion: string
  origin: string
  state: DaemonUpgradePollState
  log?: (msg: string) => void
  checkLauncherRunnable?: () => boolean
  getWrapperError?: () => string | null
  getWrapperArgv?: () => string[]
}): DaemonUpgradePollResult {
  const { startupVersion, currentVersion, origin, state } = opts
  if (currentVersion === startupVersion || currentVersion === 'unknown') {
    state.refusedStaleTarget = null
    return { shouldRestart: false, reason: 'unchanged' }
  }

  const log =
    opts.log ??
    ((msg: string) => console.log(`[daemon] ${formatDaemonLogMessage(msg)}`))

  if (
    startupVersion !== 'unknown' &&
    isOlderVersionBuild(startupVersion, currentVersion)
  ) {
    if (state.refusedStaleTarget !== currentVersion) {
      state.refusedStaleTarget = currentVersion
      log(
        `binary changed to an OLDER build (${startupVersion} → ${currentVersion}) — refusing self-restart for upgrade; keeping the running build (\`claude daemon stop --any\` to override)`,
      )
      logEvent('tengu_daemon_upgrade_refused_stale_binary', {})
    }
    return { shouldRestart: false, reason: 'stale_binary' }
  }

  const wrapperErr = (opts.getWrapperError ?? getProcessWrapperError)()
  const wrapperArgv = (opts.getWrapperArgv ?? getProcessWrapperArgv)()
  if (origin !== 'service' && (wrapperArgv.length > 0 || wrapperErr !== null)) {
    const runnable = (opts.checkLauncherRunnable ?? isProcessWrapperRunnable)()
    if (!runnable) {
      if (!state.deferredLauncherLogged) {
        state.deferredLauncherLogged = true
        log(
          wrapperErr !== null
            ? `binary changed but CLAUDE_CODE_PROCESS_WRAPPER cannot be used (${wrapperErr}) — deferring the upgrade restart until it is fixed (re-checked every poll)`
            : `binary changed but launcher \`${wrapperArgv[0]}\` is not runnable right now — deferring the upgrade restart until it is (re-checked every poll)`,
        )
        logEvent('tengu_daemon_upgrade_deferred_launcher_unrunnable' as never, {
          reason:
            'upgrade_deferred_launcher_unrunnable' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        })
      }
      return { shouldRestart: false, reason: 'launcher_unrunnable' }
    }
    state.deferredLauncherLogged = false
  }

  log(
    `version changed from ${startupVersion} to ${currentVersion} — restarting`,
  )
  logEvent('tengu_daemon_self_restart_on_upgrade', {
    old_version:
      startupVersion as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    new_version:
      currentVersion as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
  return { shouldRestart: true }
}

interface WorkerState {
  id: string
  kind: DaemonWorkerKind
  config: unknown
  process: ChildProcess | null
  backoffMs: number
  failureCount: number
  parked: boolean
  stopping: boolean
  lastStartTime: number
  restartTimer: ReturnType<typeof setTimeout> | null
}

// ---------------------------------------------------------------------------
// On-disk binary identity probe & detached upgrade successor respawn
// Official `Ot`, `Br`, `an` (`chunk@302249702.js @65500, @107200`)
// ---------------------------------------------------------------------------

export interface BinaryIdentity {
  target: string
  mtimeMs: number
  version: string
}

const VERSION_IN_PATH_RE = /(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/

export function extractSemverFromText(text: string): string | null {
  const match = VERSION_IN_PATH_RE.exec(text)
  return match ? match[1]! : null
}

function queryBinaryVersionCli(
  binaryPath: string,
  timeoutMs = 5_000,
): Promise<string | null> {
  return new Promise(resolveVersion => {
    execFile(
      binaryPath,
      ['--version'],
      { timeout: timeoutMs, windowsHide: true },
      (err, stdout) => {
        if (err || !stdout) {
          resolveVersion(null)
          return
        }
        resolveVersion(extractSemverFromText(String(stdout)))
      },
    )
  })
}

/**
 * Official `Ot(binaryPath)` (`chunk@302249702.js @65500`):
 * Resolve the live on-disk binary target via `realpath` + `stat.mtimeMs`, and
 * determine its version from the target path or `--version` output (never by
 * re-reading static `process.env.CLAUDE_CODE_VERSION`).
 */
export async function probeBinaryIdentity(
  binaryPath: string,
  opts?: {
    startupIdentity?: BinaryIdentity | null
    fallbackVersion?: string
    queryVersion?: (target: string) => Promise<string | null>
  },
): Promise<BinaryIdentity | null> {
  try {
    const target = await realpath(binaryPath)
    const st = await stat(target)
    const startup = opts?.startupIdentity
    const unchanged =
      startup != null &&
      startup.target === target &&
      startup.mtimeMs === st.mtimeMs
    if (unchanged) {
      return { target, mtimeMs: st.mtimeMs, version: startup.version }
    }

    const fromPath = extractSemverFromText(target)
    let version = fromPath
    if (!version && startup != null && opts?.queryVersion !== undefined) {
      version = await opts.queryVersion(target).catch(() => null)
    } else if (!version && startup != null) {
      version = await queryBinaryVersionCli(target).catch(() => null)
    }
    if (!version) {
      version =
        opts?.fallbackVersion ??
        (typeof MACRO !== 'undefined' ? MACRO.VERSION : 'unknown')
    }
    return { target, mtimeMs: st.mtimeMs, version }
  } catch {
    return null
  }
}

/**
 * Official `Br(startup, current)` (`chunk@302249702.js @65600`):
 * True when the on-disk binary symlink target changed or its mtime changed.
 */
export function hasBinaryIdentityChanged(
  startup: BinaryIdentity,
  current: BinaryIdentity | null,
): boolean {
  if (current === null) return true
  if (startup.target !== current.target) return true
  if (startup.version !== current.version) return true
  return startup.mtimeMs !== current.mtimeMs
}

/**
 * Official `an()` (`chunk@302249702.js @107200`):
 * Spawn a detached successor supervisor after releasing the current daemon lock
 * when an on-disk binary upgrade is detected.
 */
export function spawnUpgradeSuccessor(opts: {
  origin: string
  jsonPath?: string
  spawnedBy?: string
  cwd?: string
  spawnFn?: typeof spawnCli
}): ChildProcess | null {
  const successorArgs = [
    'daemon',
    'run',
    '--origin',
    opts.origin,
    ...(opts.jsonPath ? ['--json-path', opts.jsonPath] : []),
    ...(opts.spawnedBy ? ['--spawned-by', opts.spawnedBy] : []),
  ]
  const launch = buildCliLaunch(successorArgs, { env: { ...process.env } })
  const doSpawn = opts.spawnFn ?? spawnCli
  try {
    const child = doSpawn(launch, {
      cwd: opts.cwd ?? tryProcessCwd(),
      stdio: 'ignore',
      detached: true,
    })
    child.unref?.()
    return child
  } catch (err) {
    console.error(
      `[daemon] upgrade self-respawn failed: ${err instanceof Error ? err.message : String(err)}`,
    )
    return null
  }
}

// ---------------------------------------------------------------------------
// Transient daemon idle-exit controller — Official `P()` (`chunk@302249702.js @73500`)
// ---------------------------------------------------------------------------

export const TRANSIENT_IDLE_GRACE_MS = 5_000
export const TRANSIENT_STARTUP_IDLE_GRACE_MS = 15_000

export interface TransientIdleExitController {
  onKeepAliveChange(): void
  dispose(): void
  isTimerArmed(): boolean
}

export function createTransientIdleExitController(opts: {
  origin: string
  getActiveCount: () => number
  isShuttingDown: () => boolean
  onIdleExit: () => void
  log?: (msg: string) => void
  idleGraceMs?: number
  startupIdleGraceMs?: number
}): TransientIdleExitController {
  const idleGraceMs = opts.idleGraceMs ?? TRANSIENT_IDLE_GRACE_MS
  const startupIdleGraceMs =
    opts.startupIdleGraceMs ?? TRANSIENT_STARTUP_IDLE_GRACE_MS
  const log = opts.log ?? (msg => console.log(`[daemon] ${msg}`))

  let idleTimer: ReturnType<typeof setTimeout> | null = null
  let everHadClient = false
  let disposed = false

  function cancelTimer(): void {
    if (idleTimer !== null) {
      clearTimeout(idleTimer)
      idleTimer = null
    }
  }

  function onKeepAliveChange(): void {
    if (disposed || opts.origin !== 'transient' || opts.isShuttingDown()) {
      return
    }
    if (opts.getActiveCount() > 0) {
      everHadClient = true
      cancelTimer()
      return
    }
    if (idleTimer !== null) return

    const graceMs = everHadClient ? idleGraceMs : startupIdleGraceMs
    idleTimer = setTimeout(() => {
      idleTimer = null
      if (disposed || opts.isShuttingDown()) return
      if (opts.getActiveCount() > 0) {
        everHadClient = true
        return
      }
      log(`idle ${Math.round(graceMs / 1000)}s with no clients — exiting`)
      logEvent('tengu_daemon_idle_exit', {
        grace_ms: graceMs,
        never_had_client: !everHadClient,
      })
      opts.onIdleExit()
    }, graceMs)
    idleTimer.unref?.()
  }

  return {
    onKeepAliveChange,
    dispose() {
      disposed = true
      cancelTimer()
    },
    isTimerArmed: () => idleTimer !== null,
  }
}

// ---------------------------------------------------------------------------
// Daemon Config Hot-Reload Reconciler — Official `Mt()` (`chunk@302249702.js @62500`)
// ---------------------------------------------------------------------------

export interface DaemonConfigReconciler {
  readonly currentConfig: DaemonConfig
  reload(): Promise<{ stopped: number; started: number; restarted: number }>
  dispose(): void
}

export function watchDaemonConfigFile(
  jsonPath: string,
  onChange: () => void,
): () => void {
  const dir = dirname(jsonPath)
  const targetName = basename(jsonPath)
  let watcher: FSWatcher | null = null
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let closed = false

  const trigger = (): void => {
    if (closed) return
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      if (!closed) onChange()
    }, 100)
    debounceTimer.unref?.()
  }

  try {
    watcher = watch(dir, { persistent: false }, (_event, filename) => {
      if (!filename || filename === targetName) {
        trigger()
      }
    })
    watcher.on('error', () => {
      // ignore transient watch errors
    })
  } catch {
    // Parent directory may not exist yet — graceful no-op
  }

  return () => {
    closed = true
    if (debounceTimer) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }
    watcher?.close()
    watcher = null
  }
}

export function createDaemonConfigReconciler(opts: {
  jsonPath: string
  initialConfig: DaemonConfig
  onStartWorker: (id: string, kind: DaemonWorkerKind, config: unknown) => void
  onStopWorker: (
    id: string,
    kind: DaemonWorkerKind,
    cause?: 'reload' | 'upgrade' | 'yield',
  ) => Promise<void> | void
  onRestartWorker: (
    id: string,
    kind: DaemonWorkerKind,
    config: unknown,
  ) => Promise<void> | void
  log?: (msg: string) => void
  enableWatch?: boolean
}): DaemonConfigReconciler {
  const log = opts.log ?? (msg => console.log(`[daemon] ${msg}`))
  let currentConfig = opts.initialConfig
  let chain: Promise<{ stopped: number; started: number; restarted: number }> =
    Promise.resolve({ stopped: 0, started: 0, restarted: 0 })

  const reloadOnce = async (): Promise<{
    stopped: number
    started: number
    restarted: number
  }> => {
    const loaded = await loadDaemonConfig(opts.jsonPath)
    if (!loaded.ok) {
      log(`config reload failed: ${loaded.error} — keeping last-good config`)
      return { stopped: 0, started: 0, restarted: 0 }
    }
    for (const key of loaded.unknownKeys) {
      log(`unknown config key '${key}' — upgrade claude?`)
    }
    const diff = diffDaemonConfig(currentConfig, loaded.config)
    currentConfig = loaded.config

    for (const item of diff.stop) {
      await opts.onStopWorker(item.id, item.kind, 'reload')
      log(`stopped ${item.id}`)
    }
    for (const item of diff.restart) {
      await opts.onRestartWorker(item.id, item.kind, item.config)
      log(`restarted ${item.id}`)
    }
    for (const item of diff.start) {
      opts.onStartWorker(item.id, item.kind, item.config)
      log(`spawned ${item.id}`)
    }

    const counts = {
      stopped: diff.stop.length,
      started: diff.start.length,
      restarted: diff.restart.length,
    }
    if (counts.stopped + counts.started + counts.restarted > 0) {
      log(
        `reload: stopped=${counts.stopped} started=${counts.started} restarted=${counts.restarted}`,
      )
      logEvent('tengu_daemon_config_reload', counts)
    }
    return counts
  }

  const reload = () => {
    chain = chain.then(reloadOnce, reloadOnce)
    return chain
  }

  const stopWatch =
    opts.enableWatch !== false
      ? watchDaemonConfigFile(opts.jsonPath, () => {
          void reload()
        })
      : () => {}

  return {
    get currentConfig() {
      return currentConfig
    },
    reload,
    dispose: stopWatch,
  }
}

/**
 * Daemon supervisor entry point. Called from `cli.tsx` via:
 *   `claude daemon [subcommand]`
 *
 * Manages the daemon supervisor AND background sessions under one namespace.
 *
 * Subcommands:
 *   (none)  — unified status (supervisor + sessions)
 *   start   — start the supervisor with default workers
 *   install — install launchd/systemd user service
 *   uninstall — remove user service
 *   stop    — send SIGTERM to supervisor
 *   status  — unified status (supervisor + sessions)
 *   ps      — alias for status
 *   bg      — start a background session
 *   attach  — attach to a background session
 *   logs    — show session logs
 *   kill    — kill a session
 */
export async function daemonMain(args: string[]): Promise<void> {
  const subcommand = args[0] || 'status'

  switch (subcommand) {
    // --- Supervisor management ---
    case 'start':
      try {
        await runSupervisor(args.slice(1))
      } catch (err) {
        // Official: tengu_daemon_startup_crash
        logEvent('tengu_daemon_startup_crash', {
          error: String(
            err,
          ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        })
        throw err
      }
      break
    case 'run': {
      const runArgs = args.slice(1)
      const originIdx = runArgs.indexOf('--origin')
      const origin =
        originIdx >= 0 && runArgs[originIdx + 1]
          ? runArgs[originIdx + 1]
          : undefined
      const spawnedByIdx = runArgs.indexOf('--spawned-by')
      const spawnedBy =
        spawnedByIdx >= 0 && runArgs[spawnedByIdx + 1]
          ? runArgs[spawnedByIdx + 1]
          : undefined
      // Official: --origin transient → bg supervisor; service/other → full supervisor.
      // Both write daemon.lock so KF asK can detect zombies.
      try {
        if (origin === 'transient') {
          await runBgManagerStandalone({ origin: 'transient', spawnedBy })
        } else {
          await runSupervisor(runArgs, {
            origin: origin === 'service' ? 'service' : origin,
            spawnedBy,
          })
        }
      } catch (err) {
        logEvent('tengu_daemon_startup_crash', {
          error: String(
            err,
          ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        })
        throw err
      }
      break
    }
    case 'install':
      await handleDaemonInstall()
      break
    case 'uninstall':
      await handleDaemonUninstall()
      break
    case 'stop':
      await handleDaemonStop(args.slice(1))
      break

    // --- Unified status ---
    case 'status':
    case 'ps':
      await showUnifiedStatus()
      break

    // --- Session management (delegates to bg.ts) ---
    case 'bg': {
      const bg = await import('../cli/bg.js')
      await bg.handleBgStart(args.slice(1))
      break
    }
    case 'attach': {
      const bg = await import('../cli/bg.js')
      await bg.attachHandler(args[1])
      break
    }
    case 'logs': {
      const bg = await import('../cli/bg.js')
      await bg.logsHandler(args[1])
      break
    }
    case 'kill': {
      const bg = await import('../cli/bg.js')
      await bg.killHandler(args[1])
      break
    }
    // densable gJ_ also reachable as `claude daemon rm <id>`
    case 'rm': {
      const bg = await import('../cli/bg.js')
      await bg.rmHandler(args[1])
      break
    }

    case '--help':
    case '-h':
    case 'help':
      printHelp()
      break
    default:
      console.error(`Unknown daemon subcommand: ${subcommand}`)
      printHelp()
      process.exitCode = 1
  }
}

function printHelp(): void {
  console.log(`
Claude Code Daemon — background process management

USAGE
  claude daemon [subcommand]

SUBCOMMANDS
  status      Show daemon and session status (default)
  start       Start the daemon supervisor
  install     Install as a persistent user service (launchd/systemd)
  uninstall   Remove the persistent user service
  stop        Shut down the supervisor and terminate background sessions
  bg          Start a background session
  attach      Attach to a background session
  logs        Show session logs
  kill        Kill a session
  rm          Delete a session + worktree (works on exited sessions)
  help        Show this help

REPL
  /daemon [subcommand]    Same commands available in interactive mode

OPTIONS (for stop)
  --any                     also stop a transient (non-service) daemon
  --keep-workers            leave detached sessions running

OPTIONS (for start)
  --dir <path>              Working directory (default: current)
  --spawn-mode <mode>       Worker spawn mode: same-dir | worktree (default: same-dir)
  --capacity <N>            Max concurrent sessions per worker (default: 4)
  --permission-mode <mode>  Permission mode for spawned sessions
  --sandbox                 Enable sandbox mode
  --name <name>             Session name
  -h, --help                Show this help
`)
}

/**
 * Show unified status: daemon supervisor + background sessions.
 */
async function showUnifiedStatus(): Promise<void> {
  // 1. Daemon supervisor status
  const result = queryDaemonStatus()
  console.log('=== Daemon Supervisor ===')
  switch (result.status) {
    case 'running': {
      const s = result.state!
      console.log(`  Status:  running`)
      console.log(`  PID:     ${s.pid}`)
      console.log(`  CWD:     ${s.cwd}`)
      console.log(`  Started: ${s.startedAt}`)
      console.log(`  Workers: ${s.workerKinds.join(', ')}`)
      break
    }
    case 'stopped':
      console.log('  Status: stopped')
      break
    case 'stale':
      console.log('  Status: stale (cleaned up)')
      break
  }

  // 2. Background sessions
  console.log('\n=== Background Sessions ===')
  const bg = await import('../cli/bg.js')
  await bg.psHandler([])
}

/**
 * Official denser: `claude daemon install` — launchd/systemd user service.
 */
async function handleDaemonInstall(): Promise<void> {
  const { installDaemonService, isDaemonServiceInstallSupported } =
    await import('./serviceInstall.js')
  if (!isDaemonServiceInstallSupported()) {
    console.error(
      process.env.CLAUDE_CONFIG_DIR
        ? 'service install only supports the default config dir — the launchd/systemd unit is a per-user singleton'
        : `Service install isn't available on this platform — the daemon still runs on demand when a client connects.`,
    )
    process.exitCode = 1
    return
  }
  const result = await installDaemonService()
  if (!result.ok) {
    console.error(`install failed: ${result.error}`)
    if (result.servicePath) {
      console.error(`  (service file was written to ${result.servicePath})`)
    }
    process.exitCode = 1
    return
  }
  console.log(`installed: ${result.servicePath}`)
  // Wait briefly for control socket.
  const { sendControlRequest } = await import('./controlSocket.js')
  const deadline = Date.now() + 5000
  let reachable = false
  while (Date.now() < deadline) {
    const resp = await sendControlRequest(
      { op: 'ping', proto: 1 },
      { timeoutMs: 1000 },
    )
    if (resp.ok) {
      reachable = true
      break
    }
    await new Promise(r => setTimeout(r, 100))
  }
  if (reachable) {
    console.log('daemon is reachable')
  } else {
    console.error(
      'warning: service installed but daemon not reachable within 5s — check `claude daemon logs`',
    )
  }
}

/**
 * Official denser: `claude daemon uninstall`.
 */
async function handleDaemonUninstall(): Promise<void> {
  const { uninstallDaemonService } = await import('./serviceInstall.js')
  const result = await uninstallDaemonService()
  if (!result.ok) {
    console.error(`uninstall failed: ${result.error}`)
    process.exitCode = 1
    return
  }
  console.log('uninstalled')
}

/**
 * densable LTt — warn on unexpected stop args (ignore known flags + debug).
 */
function warnIgnoredDaemonArgs(args: string[], allowed: string[]): void {
  const ignored: string[] = []
  for (let n = 0; n < args.length; n++) {
    const o = args[n]!
    if (allowed.includes(o)) continue
    if (
      o === '--debug' ||
      o === '-d' ||
      o === '--debug-to-stderr' ||
      o === '-d2e' ||
      o.startsWith('--debug=') ||
      o.startsWith('--debug-file=')
    ) {
      continue
    }
    if (o === '--debug-file' && n + 1 < args.length) {
      n++
      continue
    }
    ignored.push(o)
  }
  if (ignored.length > 0) {
    console.error(`warning: extra arguments ignored: ${ignored.join(' ')}`)
  }
}

function pluralDaemonUnit(n: number, unit: string): string {
  return n === 1 ? unit : `${unit}s`
}

export type SignalExitResult = 'exited' | 'timed-out' | 'eperm'

/**
 * SEA `hmt` (#797): send `signal` to `pid` and poll every `pollMs` (default 50ms)
 * up to `gracefulMs` (default 2000ms) until the process exits.
 */
export async function signalAndWaitForExit(
  pid: number,
  options: {
    signal?: NodeJS.Signals
    gracefulMs?: number
    pollMs?: number
    killFn?: (pid: number, signal?: NodeJS.Signals | 0) => void
  } = {},
): Promise<SignalExitResult> {
  const signal = options.signal ?? 'SIGTERM'
  const gracefulMs = options.gracefulMs ?? 2000
  const pollMs = options.pollMs ?? 50
  const killFn =
    options.killFn ?? ((p, s) => process.kill(p, s as NodeJS.Signals))

  if (pid <= 1) return 'eperm'
  try {
    killFn(pid, signal)
  } catch (err) {
    const code =
      err && typeof err === 'object' && 'code' in err
        ? String((err as { code?: unknown }).code)
        : ''
    if (code === 'EPERM') return 'eperm'
    return 'exited'
  }

  const deadline = Date.now() + gracefulMs
  while (true) {
    const timedOut = Date.now() >= deadline
    try {
      killFn(pid, 0)
    } catch {
      return 'exited'
    }
    if (timedOut) return 'timed-out'
    await new Promise<void>(resolve => setTimeout(resolve, pollMs))
  }
}

/**
 * densable case "stop" — control-socket shutdown first; never SIGTERM an
 * unverified lock holder; require `--any` for transient (non-service) daemons.
 */
async function handleDaemonStop(args: string[]): Promise<void> {
  const keepWorkers = args.includes('--keep-workers')
  const anyFlag = args.includes('--any')
  warnIgnoredDaemonArgs(args, ['--keep-workers', '--any'])

  const formatStopped = (reaped: number): string =>
    keepWorkers || reaped === 0
      ? 'stopped'
      : `stopped (terminated ${reaped} ${pluralDaemonUnit(reaped, 'background session')})`

  const finish = async (
    ok: boolean,
    reaped: number,
    metric: string = 'daemon_stop_failed',
  ): Promise<void> => {
    logEvent('tengu_daemon_control', {
      op_stop:
        true as unknown as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      ok: ok as unknown as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      reaped:
        reaped as unknown as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      holderUnverified: (metric ===
        'daemon_stop_holder_unverified') as unknown as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    process.exitCode = ok ? 0 : 1
  }

  const { isDaemonServiceInstalled, stopDaemonService } = await import(
    './serviceInstall.js'
  )
  const serviceInstalled = await isDaemonServiceInstalled().catch(() => false)

  // densable hk / UTe classification
  let verified: DaemonLockData | null = null
  let holder: DaemonLockData | null = null
  let stalePid: number | undefined

  const alive = await readAliveDaemonLock().catch(() => null)
  if (alive && isDaemonLockSignalable(alive)) {
    verified = alive
    holder = alive
  } else if (alive) {
    holder = alive
  }

  if (!holder) {
    const raw = await readDaemonLockLoose().catch(() => null)
    if (raw && isDaemonPidRaceLive(raw.pid)) {
      const kind = await classifyDaemonLockHolder(raw)
      if (kind === 'stale') {
        stalePid = raw.pid
      } else if (kind === 'verified') {
        verified = raw
        holder = raw
      } else {
        holder = raw
      }
    }
  }

  // Gate: without service, refuse unless --any
  if (!serviceInstalled && holder && !anyFlag) {
    if (verified) {
      console.error(
        `no background service is installed, but a daemon is running (pid=${holder.pid}, origin=${holder.origin ?? 'unknown'}). Run \`claude daemon stop --any\` to stop it.`,
      )
    } else {
      console.error(
        `no background service is installed, but pid=${holder.pid} is holding the daemon lock. Run \`claude daemon stop --any\` to stop any background sessions and report on the holder.`,
      )
    }
    await finish(false, 0)
    return
  }

  // Preferred: control socket shutdown
  const { sendControlRequest } = await import('./controlSocketClient.js')
  const { PROTO_VERSION } = await import('./bgWorker.js')
  const shut = await sendControlRequest(
    {
      proto: PROTO_VERSION,
      op: 'shutdown',
      reapWorkers: !keepWorkers,
    },
    { timeoutMs: 5000 },
  )

  const { clientBgReapAll, formatUnverifiedKeptNote } = await import(
    './clientBgReap.js'
  )
  const warnKept = (kept: number): void => {
    if (kept > 0) console.error(formatUnverifiedKeptNote(kept))
  }

  if (shut.ok && shut.op === 'shutdown') {
    // densable: wUs({supervisorKilledAll:!0}) unless --keep-workers; Math.max
    const client = keepWorkers
      ? { reaped: 0, kept: 0 }
      : await clientBgReapAll({ supervisorKilledAll: true })
    warnKept(client.kept)
    const controlReaped =
      typeof shut.reaped === 'number' && Number.isFinite(shut.reaped)
        ? shut.reaped
        : 0
    const reaped = Math.max(controlReaped, client.reaped)
    if (serviceInstalled) {
      const svc = await stopDaemonService()
      if (!svc.ok) {
        console.error(`stop failed: ${svc.error}`)
        await finish(false, reaped)
        return
      }
    }
    console.log(formatStopped(reaped))
    if (!serviceInstalled) {
      console.log(
        'note: the next `claude agents` or `claude --bg` will start a new one',
      )
    }
    await finish(true, reaped)
    return
  }

  // Fallback: service stop OR verified SIGTERM + wait + SIGKILL (never unverified; never win32 kill)
  let stopped = false
  let stopOutcome: 'exited' | 'timed-out' | 'unverified' | undefined
  let sentSigkill = false
  if (serviceInstalled) {
    const svc = await stopDaemonService()
    if (!svc.ok) {
      console.error(`stop failed: ${svc.error}`)
      await finish(false, 0)
      return
    }
    stopped = true
  } else if (verified && process.platform !== 'win32') {
    const termRes = await signalAndWaitForExit(verified.pid, {
      signal: 'SIGTERM',
      gracefulMs: 2000,
    })
    if (termRes === 'eperm') {
      console.error(
        `could not stop daemon (pid=${verified.pid}): EPERM (running as another user — try with elevated privileges)`,
      )
      await finish(false, 0)
      return
    }
    if (termRes === 'exited') {
      stopped = true
    } else if (isDaemonLockSignalable(verified)) {
      sentSigkill = true
      const killRes = await signalAndWaitForExit(verified.pid, {
        signal: 'SIGKILL',
        gracefulMs: 2000,
      })
      if (killRes === 'exited') {
        stopped = true
      } else {
        stopOutcome = 'timed-out'
      }
    } else {
      stopOutcome = 'unverified'
    }
  }

  // densable wUs after fallback (no supervisorKilledAll) unless --keep-workers
  const client = keepWorkers ? { reaped: 0, kept: 0 } : await clientBgReapAll()
  warnKept(client.kept)
  const reaped = client.reaped

  if (verified && !stopped && process.platform === 'win32') {
    console.error(
      (reaped > 0 ? `terminated ${reaped} background session(s); ` : '') +
        `supervisor (pid=${verified.pid}) is still running — stop it with \`taskkill /PID ${verified.pid}\` or close the terminal it was started in.`,
    )
    await finish(false, reaped)
    return
  }

  if (verified && !stopped) {
    const lockPath = getDaemonLockPath()
    const detail =
      stopOutcome === 'timed-out'
        ? 'after SIGKILL. A process that outlives SIGKILL is usually waiting inside the operating system, for example on a network drive that stopped answering, and exits by itself once that wait ends. Until then, `claude agents` and `claude --bg` cannot start a new daemon. `claude daemon status` says "not running" once it has gone; if it never goes, restart the computer.'
        : sentSigkill
          ? 'after SIGKILL, and could no longer be verified as the daemon. It should exit shortly. If `claude agents` or `claude --bg` still cannot start a new daemon in a minute, restart the computer.'
          : `2s after SIGTERM, and could no longer be verified as the daemon, so it was not sent SIGKILL. While it runs, \`claude agents\` and \`claude --bg\` may not be able to start a new daemon. Re-run \`claude daemon stop --any${keepWorkers ? ' --keep-workers' : ''}\`. If that does not stop it, run \`ps -ww -o args= -p ${verified.pid}\`: if that shows Claude Code started with "daemon", stop it with \`kill -9 ${verified.pid}\`. If it shows anything else, another program probably has that pid: leave it alone, and delete ${lockPath}.`
    console.error(
      (reaped > 0
        ? `terminated ${reaped} background ${pluralDaemonUnit(reaped, 'session')}; `
        : '') +
        `the daemon was not stopped: pid=${verified.pid} is still running ${detail}${keepWorkers ? ' No sessions were ended.' : ''}`,
    )
    await finish(false, reaped, 'daemon_stop_still_running')
    return
  }

  if (!stopped && !verified && holder) {
    const lockPath = getDaemonLockPath()
    console.error(
      (reaped > 0
        ? `terminated ${reaped} background ${pluralDaemonUnit(reaped, 'session')}; `
        : '') +
        `the daemon was not stopped: pid=${holder.pid} is holding ${lockPath} but could not be verified as the daemon, so it was not signalled. If no daemon is running, delete that file; if pid ${holder.pid} is a live process you own, stop it yourself.`,
    )
    await finish(false, reaped, 'daemon_stop_holder_unverified')
    return
  }

  if (stalePid !== undefined) {
    console.error(
      `note: ${getDaemonLockPath()} is stale (pid=${stalePid} is not the daemon). The next daemon start reclaims it automatically.`,
    )
  }

  if (!stopped && !verified && reaped === 0) {
    console.log('no daemon running')
  } else {
    console.log(formatStopped(reaped))
    if (!serviceInstalled && verified) {
      console.log(
        'note: the next `claude agents` or `claude --bg` will start a new one',
      )
    }
  }
  await finish(true, reaped)
}

/**
 * Parse supervisor arguments from CLI.
 */
function parseSupervisorArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {}
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (arg === '--dir' && i + 1 < args.length) {
      result.dir = resolve(args[++i]!)
    } else if (arg.startsWith('--dir=')) {
      result.dir = resolve(arg.slice('--dir='.length))
    } else if (arg === '--spawn-mode' && i + 1 < args.length) {
      result.spawnMode = args[++i]!
    } else if (arg.startsWith('--spawn-mode=')) {
      result.spawnMode = arg.slice('--spawn-mode='.length)
    } else if (arg === '--capacity' && i + 1 < args.length) {
      result.capacity = args[++i]!
    } else if (arg.startsWith('--capacity=')) {
      result.capacity = arg.slice('--capacity='.length)
    } else if (arg === '--permission-mode' && i + 1 < args.length) {
      result.permissionMode = args[++i]!
    } else if (arg.startsWith('--permission-mode=')) {
      result.permissionMode = arg.slice('--permission-mode='.length)
    } else if (arg === '--sandbox') {
      result.sandbox = '1'
    } else if (arg === '--name' && i + 1 < args.length) {
      result.name = args[++i]!
    } else if (arg.startsWith('--name=')) {
      result.name = arg.slice('--name='.length)
    } else if (arg === '--json-path' && i + 1 < args.length) {
      result.jsonPath = resolve(args[++i]!)
    } else if (arg.startsWith('--json-path=')) {
      result.jsonPath = resolve(arg.slice('--json-path='.length))
    }
  }
  return result
}

function sendWorkerShutdownIpc(
  child: ChildProcess | null,
  cause?: 'upgrade' | 'reload' | 'yield',
): void {
  if (!child || child.killed) return
  try {
    if (typeof child.send === 'function' && child.connected) {
      const msg: SupervisorToWorkerIpcMessage = {
        type: 'shutdown',
        ...(cause ? { cause } : {}),
      }
      child.send(msg)
    }
  } catch {
    // IPC channel may already be closed
  }
}

async function stopWorkerGracefully(
  worker: WorkerState,
  cause?: 'upgrade' | 'reload' | 'yield',
  graceMs = 30_000,
): Promise<void> {
  worker.stopping = true
  if (worker.restartTimer) {
    clearTimeout(worker.restartTimer)
    worker.restartTimer = null
  }
  const child = worker.process
  if (!child || child.exitCode !== null) return

  sendWorkerShutdownIpc(child, cause)
  if (!child.killed) {
    try {
      child.kill('SIGTERM')
    } catch {
      // already exited
    }
  }

  await new Promise<void>(resolveStop => {
    if (child.exitCode !== null) {
      resolveStop()
      return
    }
    let killTimer: ReturnType<typeof setTimeout> | null = null
    child.once('exit', () => {
      if (killTimer) {
        clearTimeout(killTimer)
        killTimer = null
      }
      resolveStop()
    })
    killTimer = setTimeout(() => {
      if (child.exitCode === null) {
        try {
          child.kill('SIGKILL')
        } catch {
          // ignore
        }
      }
      resolveStop()
    }, graceMs)
    killTimer.unref?.()
  })
}

/**
 * Run the daemon supervisor loop. Reads & watches `daemon.json`
 * (`tengu_daemon_config_reload`), coordinates OAuth IPC (`K9i`), probes on-disk
 * binary upgrades (spawning a detached successor), and restarts crashed workers
 * with exponential backoff.
 */
async function runSupervisor(
  args: string[],
  lockOpts?: { origin?: string; spawnedBy?: string },
): Promise<void> {
  const config = parseSupervisorArgs(args)
  const dir = config.dir || resolve('.')
  const jsonPath = config.jsonPath || getDefaultDaemonConfigPath()

  console.log(`[daemon] supervisor starting in ${dir}`)

  // Load daemon.json (falling back gracefully to CLI remoteControl config when absent)
  const loaded = await loadDaemonConfig(jsonPath)
  let initialConfig: DaemonConfig
  if (loaded.ok) {
    for (const key of loaded.unknownKeys) {
      console.log(`[daemon] unknown config key '${key}' — upgrade claude?`)
    }
    initialConfig = loaded.config
    if (!loaded.existed) {
      const cliFallback = buildRemoteControlConfigFromEnv({
        ...process.env,
        DAEMON_WORKER_DIR: dir,
        ...(config.name ? { DAEMON_WORKER_NAME: config.name } : {}),
        DAEMON_WORKER_SPAWN_MODE: config.spawnMode || 'same-dir',
        DAEMON_WORKER_CAPACITY: config.capacity || '4',
        ...(config.permissionMode
          ? { DAEMON_WORKER_PERMISSION: config.permissionMode }
          : {}),
        DAEMON_WORKER_SANDBOX: config.sandbox || '0',
        DAEMON_WORKER_CREATE_SESSION: '1',
      })
      initialConfig = {
        ...initialConfig,
        remoteControl: [cliFallback],
      }
    }
  } else {
    console.error(
      `[daemon] config load failed: ${loaded.error} — idling until daemon.json is fixed`,
    )
    initialConfig = emptyDaemonConfig()
  }

  const workerMap = new Map<string, WorkerState>()
  const makeWorkerState = (
    id: string,
    kind: DaemonWorkerKind,
    workerCfg: unknown,
  ): WorkerState => ({
    id,
    kind,
    config: workerCfg,
    process: null,
    backoffMs: BACKOFF_INITIAL_MS,
    failureCount: 0,
    parked: false,
    stopping: false,
    lastStartTime: 0,
    restartTimer: null,
  })

  for (const kind of ['heartbeat', 'scheduled', 'remoteControl'] as const) {
    const specs = initialConfig[kind] ?? []
    for (let i = 0; i < specs.length; i++) {
      const id = `${kind}:${i}`
      workerMap.set(id, makeWorkerState(id, kind, specs[i]))
    }
  }

  // Official: tengu_daemon_start
  logEvent('tengu_daemon_start', {
    workers: [...workerMap.values()]
      .map(w => w.kind)
      .join(',') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })

  const startedAtMs = Date.now()
  // Official daemon.lock (EvK) — KF asK / oAO ENOCONN probe.
  // Official tG4: claim slot (bW + optional yield) BEFORE write.
  const {
    installDaemonLock,
    clearDaemonLockIfOwned,
    claimDaemonSupervisorSlot,
    detectDaemonLockRace,
  } = await import('./daemonLock.js')
  const origin = lockOpts?.origin ?? 'service'
  const lockOwner = { pid: process.pid, startedAt: startedAtMs }

  const slot = await claimDaemonSupervisorSlot({
    origin,
    log: msg => console.log(`[daemon] ${formatDaemonLogMessage(msg)}`),
  })
  if (!slot.ok) {
    if (slot.askedYield) {
      logEvent('tengu_daemon_start_yield_failed', {})
    }
    process.exitCode = 1
    return
  }

  let identityFields: { procStart?: unknown; procStartFt?: unknown } = {}
  try {
    const { readProcessStartIdentityFields } = await import('./daemonLock.js')
    identityFields = await readProcessStartIdentityFields(lockOwner.pid)
  } catch {
    identityFields = {}
  }
  const lockWritten = await installDaemonLock({
    pid: lockOwner.pid,
    version: MACRO.VERSION,
    startedAt: lockOwner.startedAt,
    origin,
    ...identityFields,
    ...(lockOpts?.spawnedBy ? { spawnedBy: lockOpts.spawnedBy } : {}),
  })
  if (!lockWritten) {
    const raced = await detectDaemonLockRace(lockOwner)
    if (raced) {
      console.log(
        `[daemon] another daemon won the lock race (pid=${raced.pid}) — exiting`,
      )
      process.exitCode = 1
      return
    }
    console.error('[daemon] failed to write daemon.lock — exiting')
    process.exitCode = 1
    return
  }
  {
    const raced = await detectDaemonLockRace(lockOwner)
    if (raced) {
      console.log(
        `[daemon] another daemon won the lock race (pid=${raced.pid}) — exiting`,
      )
      process.exitCode = 1
      return
    }
  }

  const syncDaemonState = (): void => {
    writeDaemonState({
      pid: process.pid,
      cwd: dir,
      startedAt: new Date(startedAtMs).toISOString(),
      workerKinds: [...workerMap.values()].map(w => w.kind),
      lastStatus: 'running',
    })
  }
  syncDaemonState()

  const controller = new AbortController()

  // Official `K9i`: Supervisor-side OAuth IPC coordinator
  const authManager = createSupervisorAuthManager({
    signal: controller.signal,
    log: msg => console.log(`[daemon] ${formatDaemonLogMessage(msg)}`),
  })
  await authManager.ready

  // Probe live on-disk binary identity at startup (official `Ot`)
  const binaryPath = process.execPath
  const startupBinaryIdentity = await probeBinaryIdentity(binaryPath, {
    fallbackVersion: typeof MACRO !== 'undefined' ? MACRO.VERSION : 'unknown',
  })

  let lockCleared = false
  const clearOwnedLock = async (): Promise<void> => {
    if (lockCleared) return
    lockCleared = true
    await clearDaemonLockIfOwned(lockOwner)
  }

  let upgradeDetected = false
  let shutdownCause: 'upgrade' | 'reload' | 'yield' | undefined

  const shutdown = (cause?: 'upgrade' | 'reload' | 'yield') => {
    if (controller.signal.aborted) return
    shutdownCause = cause
    console.log(
      `[daemon] supervisor shutting down${cause ? ` (${cause})` : ''}...`,
    )
    controller.abort()
    removeDaemonState()
    for (const w of workerMap.values()) {
      w.stopping = true
      if (w.restartTimer) {
        clearTimeout(w.restartTimer)
        w.restartTimer = null
      }
      sendWorkerShutdownIpc(w.process, cause)
      if (w.process && !w.process.killed) {
        w.process.kill('SIGTERM')
      }
    }
  }
  const onSigTerm = () => shutdown()
  const onSigInt = () => shutdown()
  process.on('SIGTERM', onSigTerm)
  process.on('SIGINT', onSigInt)

  // Periodic on-disk binary upgrade check (official `We()` / `Ot` / `Br`)
  const upgradePollState: DaemonUpgradePollState = {
    refusedStaleTarget: null,
    deferredLauncherLogged: false,
  }
  let versionCheckRunning = false
  const versionCheckInterval = setInterval(() => {
    if (
      controller.signal.aborted ||
      upgradeDetected ||
      versionCheckRunning ||
      !startupBinaryIdentity
    ) {
      return
    }
    versionCheckRunning = true
    void (async () => {
      try {
        const currentIdentity = await probeBinaryIdentity(binaryPath, {
          startupIdentity: startupBinaryIdentity,
        })
        if (!hasBinaryIdentityChanged(startupBinaryIdentity, currentIdentity)) {
          upgradePollState.refusedStaleTarget = null
          return
        }
        const currentVersion =
          currentIdentity === null
            ? `${startupBinaryIdentity.version}-deleted`
            : currentIdentity.version === startupBinaryIdentity.version
              ? `${currentIdentity.version}+mtime-${Math.trunc(currentIdentity.mtimeMs)}`
              : currentIdentity.version
        const result = evaluateDaemonUpgradePoll({
          startupVersion: startupBinaryIdentity.version,
          currentVersion,
          origin,
          state: upgradePollState,
        })
        if (result.shouldRestart) {
          upgradeDetected = true
          shutdown('upgrade')
        }
      } finally {
        versionCheckRunning = false
      }
    })()
  }, 30_000)
  versionCheckInterval.unref?.()

  // Spawn initial workers
  for (const worker of workerMap.values()) {
    if (!controller.signal.aborted) {
      spawnWorker(worker, dir, config, controller.signal, authManager)
    }
  }

  // Watch daemon.json & dynamically reconcile desired workers (`tengu_daemon_config_reload`)
  const reconciler = createDaemonConfigReconciler({
    jsonPath,
    initialConfig,
    log: msg => console.log(`[daemon] ${formatDaemonLogMessage(msg)}`),
    onStartWorker: (id, kind, workerCfg) => {
      if (controller.signal.aborted) return
      const worker = makeWorkerState(id, kind, workerCfg)
      workerMap.set(id, worker)
      spawnWorker(worker, dir, config, controller.signal, authManager)
      syncDaemonState()
    },
    onStopWorker: async (id, _kind, cause) => {
      const worker = workerMap.get(id)
      if (!worker) return
      workerMap.delete(id)
      await stopWorkerGracefully(worker, cause)
      syncDaemonState()
    },
    onRestartWorker: async (id, kind, workerCfg) => {
      const existing = workerMap.get(id)
      if (existing) {
        await stopWorkerGracefully(existing, 'reload')
      }
      if (controller.signal.aborted) return
      const replacement = makeWorkerState(id, kind, workerCfg)
      workerMap.set(id, replacement)
      spawnWorker(replacement, dir, config, controller.signal, authManager)
      syncDaemonState()
    },
  })

  // Wait for abort signal
  await new Promise<void>(resolveWait => {
    if (controller.signal.aborted) {
      resolveWait()
      return
    }
    controller.signal.addEventListener('abort', () => resolveWait(), {
      once: true,
    })
  })

  // Clean up watcher, interval, and signal handlers
  reconciler.dispose()
  clearInterval(versionCheckInterval)
  process.off('SIGTERM', onSigTerm)
  process.off('SIGINT', onSigInt)

  // Wait for all workers to exit
  await Promise.all(
    [...workerMap.values()].map(w => stopWorkerGracefully(w, shutdownCause)),
  )

  authManager.dispose()

  // Official CvK — release lock only if still ours (pid+startedAt) BEFORE
  // spawning the detached upgrade successor so it acquires daemon.lock cleanly.
  await clearOwnedLock()

  if (upgradeDetected) {
    console.log('[daemon] spawning detached successor for upgrade...')
    spawnUpgradeSuccessor({
      origin,
      jsonPath,
      spawnedBy: lockOpts?.spawnedBy,
      cwd: dir,
    })
  }

  console.log('[daemon] supervisor stopped')
}

/**
 * Spawn a worker child process with Node IPC channel (`stdio: ['pipe', 'pipe', 'pipe', 'ipc']`),
 * piped stdin JSON config (`{ config, initialAccessToken }`), and supervisor OAuth IPC wiring.
 */
function spawnWorker(
  worker: WorkerState,
  dir: string,
  config: Record<string, string>,
  signal: AbortSignal,
  authManager?: SupervisorAuthManager,
): void {
  if (signal.aborted || worker.parked || worker.stopping) return

  worker.lastStartTime = Date.now()

  const env: Record<string, string | undefined> = {
    ...process.env,
    DAEMON_WORKER_DIR: dir,
    DAEMON_WORKER_NAME: config.name,
    DAEMON_WORKER_SPAWN_MODE: config.spawnMode || 'same-dir',
    DAEMON_WORKER_CAPACITY: config.capacity || '4',
    DAEMON_WORKER_PERMISSION: config.permissionMode,
    DAEMON_WORKER_SANDBOX: config.sandbox || '0',
    DAEMON_WORKER_CREATE_SESSION: '1',
    CLAUDE_CODE_SESSION_KIND: 'daemon-worker',
  }

  console.log(`[daemon] spawning worker '${worker.id}'`)

  const launch = buildCliLaunch([`--daemon-worker=${worker.kind}`], { env })

  const child = spawnCli(launch, {
    cwd: dir,
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
  })

  worker.process = child

  // Pipe validated worker config + initialAccessToken on stdin (official `chunk@302249702.js @57600`)
  child.stdin?.on('error', err => {
    console.error(`[daemon] worker '${worker.id}' stdin error: ${err.message}`)
  })
  try {
    child.stdin?.write(
      `${JSON.stringify({
        config: worker.config,
        initialAccessToken: authManager?.getAccessToken(),
      })}\n`,
    )
    child.stdin?.end()
  } catch {
    // stdin already closed
  }

  authManager?.attachWorker(child)

  // Pipe worker stdout/stderr to supervisor with prefix
  child.stdout?.on('data', (data: Buffer) => {
    const lines = data.toString().trimEnd().split('\n')
    for (const line of lines) {
      console.log(`  [${worker.id}] ${line}`)
    }
  })
  child.stderr?.on('data', (data: Buffer) => {
    const lines = data.toString().trimEnd().split('\n')
    for (const line of lines) {
      console.error(`  [${worker.id}] ${line}`)
    }
  })

  child.on('exit', (code, sig) => {
    worker.process = null
    authManager?.detachWorker(child)

    if (signal.aborted || worker.stopping) {
      // Supervisor or hot-reload is stopping this worker, don't restart
      return
    }

    if (code === EXIT_CODE_PERMANENT) {
      console.error(
        `[daemon] worker '${worker.id}' exited with permanent error — parking`,
      )
      logEvent('tengu_daemon_worker_permanent_exit', {
        kind: worker.kind as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        exit_code: code ?? -1,
      })
      worker.parked = true
      return
    }

    // Check for rapid failure (crashed within 10s of starting)
    const runDuration = Date.now() - worker.lastStartTime
    if (runDuration < 10_000) {
      worker.failureCount++
      logEvent('tengu_daemon_worker_crash', {
        kind: worker.kind as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        exit_code: code ?? -1,
        failure_count: worker.failureCount,
        run_duration_ms: runDuration,
        rapid: true,
      })
      if (worker.failureCount >= MAX_RAPID_FAILURES) {
        console.error(
          `[daemon] worker '${worker.id}' failed ${worker.failureCount} times rapidly — parking`,
        )
        worker.parked = true
        return
      }
    } else {
      logEvent('tengu_daemon_worker_crash', {
        kind: worker.kind as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        exit_code: code ?? -1,
        failure_count: 0,
        run_duration_ms: runDuration,
        rapid: false,
      })
      // Ran for a reasonable time, reset failure count
      worker.failureCount = 0
      worker.backoffMs = BACKOFF_INITIAL_MS
    }

    console.log(
      `[daemon] worker '${worker.id}' exited (code=${code}, signal=${sig}), restarting in ${worker.backoffMs}ms`,
    )

    worker.restartTimer = setTimeout(() => {
      worker.restartTimer = null
      if (!signal.aborted && !worker.parked && !worker.stopping) {
        spawnWorker(worker, dir, config, signal, authManager)
      }
    }, worker.backoffMs)
    worker.restartTimer.unref?.()

    // Exponential backoff
    worker.backoffMs = Math.min(
      worker.backoffMs * BACKOFF_MULTIPLIER,
      BACKOFF_CAP_MS,
    )
  })
}

/**
 * Run the bg manager as a standalone daemon process.
 * Used by FleetView auto-start / official Ay6 transient spawn.
 * Writes official daemon.lock so KF asK can signal zombies.
 */
async function runBgManagerStandalone(opts?: {
  origin?: string
  spawnedBy?: string
}): Promise<void> {
  const { startBgManager } = await import('./bgManager.js')
  const {
    installDaemonLock,
    clearDaemonLockIfOwned,
    claimDaemonSupervisorSlot,
    detectDaemonLockRace,
  } = await import('./daemonLock.js')

  console.log('[daemon] bg-manager starting...')

  const startedAt = Date.now()
  const lockOwner = { pid: process.pid, startedAt }
  const origin = opts?.origin ?? 'transient'

  // Official tG4: claim slot before write (transient never displaces a live lock).
  const slot = await claimDaemonSupervisorSlot({
    origin,
    log: msg => console.log(`[daemon] ${formatDaemonLogMessage(msg)}`),
  })
  if (!slot.ok) {
    if (slot.askedYield) {
      logEvent('tengu_daemon_start_yield_failed', {})
    }
    process.exitCode = 1
    return
  }

  // densable R9d→R0o: exclusive install; never rename-over a live peer lock.
  // Same stamp as main daemon path: UHt/jMt → procStartFt under FFI, else procStart.
  // Do NOT write raw readProcessStartIdentity into procStart only — pickProcessStartIdentity
  // voids legacy procStart when win32 FFI is active.
  let identityFields: { procStart?: unknown; procStartFt?: unknown } = {}
  try {
    const { readProcessStartIdentityFields } = await import('./daemonLock.js')
    identityFields = await readProcessStartIdentityFields(lockOwner.pid)
  } catch {
    identityFields = {}
  }
  const lockWritten = await installDaemonLock({
    pid: lockOwner.pid,
    version: MACRO.VERSION,
    startedAt: lockOwner.startedAt,
    origin,
    ...identityFields,
    ...(opts?.spawnedBy ? { spawnedBy: opts.spawnedBy } : {}),
  })
  if (!lockWritten) {
    const raced = await detectDaemonLockRace(lockOwner)
    if (raced) {
      console.log(
        `[daemon] another daemon won the lock race (pid=${raced.pid}) — exiting`,
      )
      process.exitCode = 1
      return
    }
    console.error('[daemon] failed to write daemon.lock — exiting')
    process.exitCode = 1
    return
  }
  {
    const raced = await detectDaemonLockRace(lockOwner)
    if (raced) {
      console.log(
        `[daemon] another daemon won the lock race (pid=${raced.pid}) — exiting`,
      )
      process.exitCode = 1
      return
    }
  }

  // Official Q — ownership-gated CvK; once only.
  let lockCleared = false
  const clearOwnedLock = async (): Promise<void> => {
    if (lockCleared) return
    lockCleared = true
    await clearDaemonLockIfOwned(lockOwner)
  }

  // manager assigned after startBgManager; shutdown/onYield/idleExit close over the let.
  let manager: Awaited<ReturnType<typeof startBgManager>> | null = null
  let shuttingDown = false
  let keepAlive: ReturnType<typeof setInterval> | null = null

  const idleExit = createTransientIdleExitController({
    origin,
    getActiveCount: () =>
      (manager?.leaseCount() ?? 0) + (manager?.liveHandleCount() ?? 0),
    isShuttingDown: () => shuttingDown,
    log: msg => console.log(`[daemon] ${formatDaemonLogMessage(msg)}`),
    onIdleExit: () => {
      void shutdown('idle_exit')
    },
  })

  const shutdown = async (
    reason?: string,
    closeOpts?: { displaced?: boolean; skipPathCleanup?: boolean },
  ): Promise<void> => {
    if (shuttingDown) return
    shuttingDown = true
    idleExit.dispose()
    if (keepAlive) {
      clearInterval(keepAlive)
      keepAlive = null
    }
    console.log(
      `[daemon] bg-manager shutting down${reason ? ` (${reason})` : ''}...`,
    )
    try {
      // densable 2.1.214 #26: yield/handover close({skipUnlink/displaced}) so we
      // do not unlink the successor's control socket path.
      await manager?.close(closeOpts)
    } catch {
      // best-effort
    }
    removeDaemonState('bg-manager')
    // densable CvK: only clear lock if still owned — successor may have rewritten it
    await clearOwnedLock()
    process.exit(0)
  }

  // Official tG4 h(): only transient yields; service/foreground refuse.
  // Workers stay on disk for re-adoption by the successor supervisor.
  const onYield = (): boolean => {
    if (origin !== 'transient') return false
    if (!shuttingDown) {
      console.log(
        '[daemon] yielding to a foreground/service daemon — bg workers will be re-adopted',
      )
      logEvent('tengu_daemon_yield', {})
      // densable: te.close({skipPathCleanup:!0}) / close({displaced:true})
      void shutdown('yield', { displaced: true, skipPathCleanup: true })
    }
    return true
  }

  manager = await startBgManager({
    onLog: (msg: string) => console.log(`  ${formatDaemonLogMessage(msg)}`),
    onYield,
    onKeepAliveChange: () => idleExit.onKeepAliveChange(),
  })

  console.log('[daemon] bg-manager ready')

  // Legacy state file (status / stop helpers)
  writeDaemonState({
    pid: process.pid,
    cwd: tryProcessCwd(),
    startedAt: new Date(startedAt).toISOString(),
    workerKinds: ['bg-manager'],
    lastStatus: 'running',
  })

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM')
  })
  process.on('SIGINT', () => {
    void shutdown('SIGINT')
  })

  // Official `P()` (`chunk@302249702.js @73500`): arm idle-exit right after ready
  // and re-check periodically so transient standalone daemons exit cleanly once
  // all handles finish and no client leases remain.
  idleExit.onKeepAliveChange()
  keepAlive = setInterval(() => {
    if (!manager || shuttingDown) return
    idleExit.onKeepAliveChange()
  }, 10_000)
  keepAlive.unref()
}
