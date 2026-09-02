import { type ChildProcess } from 'child_process'
import { resolve } from 'path'
import { tryProcessCwd } from '../utils/cachePaths.js'
import { buildCliLaunch, spawnCli } from '../utils/cliLaunch.js'
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

interface WorkerState {
  kind: string
  process: ChildProcess | null
  backoffMs: number
  failureCount: number
  parked: boolean
  lastStartTime: number
  restartTimer: ReturnType<typeof setTimeout> | null
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

  // Fallback: service stop OR verified SIGTERM (never unverified; never win32 kill)
  let stopped = false
  if (serviceInstalled) {
    const svc = await stopDaemonService()
    if (!svc.ok) {
      console.error(`stop failed: ${svc.error}`)
      await finish(false, 0)
      return
    }
    stopped = true
  } else if (verified && process.platform !== 'win32') {
    try {
      process.kill(verified.pid, 'SIGTERM')
      stopped = true
    } catch (err) {
      const code =
        err && typeof err === 'object' && 'code' in err
          ? String((err as { code?: unknown }).code)
          : ''
      if (code === 'ESRCH') {
        stopped = true
      } else {
        const eperm =
          code === 'EPERM'
            ? ' (running as another user — try with elevated privileges)'
            : ''
        const msg = err instanceof Error ? err.message : String(err)
        console.error(
          `could not stop daemon (pid=${verified.pid}): ${msg}${eperm}`,
        )
        await finish(false, 0)
        return
      }
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
    }
  }
  return result
}

/**
 * Run the daemon supervisor loop. Spawns workers and restarts them
 * on crash with exponential backoff.
 */
async function runSupervisor(
  args: string[],
  lockOpts?: { origin?: string; spawnedBy?: string },
): Promise<void> {
  const config = parseSupervisorArgs(args)
  const dir = config.dir || resolve('.')

  console.log(`[daemon] supervisor starting in ${dir}`)

  const workers: WorkerState[] = [
    {
      kind: 'remoteControl',
      process: null,
      backoffMs: BACKOFF_INITIAL_MS,
      failureCount: 0,
      parked: false,
      lastStartTime: 0,
      restartTimer: null,
    },
  ]

  // Official: tengu_daemon_start
  logEvent('tengu_daemon_start', {
    workers: workers
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
    log: msg => console.log(`[daemon] ${msg}`),
  })
  if (!slot.ok) {
    // Official: yield failure → e_('daemon_start','daemon_start_yield_failed');
    // otherwise SH('daemon_start') and exit 1.
    if (slot.askedYield) {
      logEvent('tengu_daemon_start_yield_failed', {})
    }
    process.exitCode = 1
    return
  }

  // densable: R9d exclusive create; R0o only when peer pid is dead (never clobber live).
  // Stamp procStart / procStartFt (UHt/jMt) so cI/iPs can refuse PID reuse.
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
  // Official: re-read after write; if another live pid owns it, exit.
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

  // Write daemon state file so other CLI processes can query/stop us
  writeDaemonState({
    pid: process.pid,
    cwd: dir,
    startedAt: new Date(startedAtMs).toISOString(),
    workerKinds: workers.map(w => w.kind),
    lastStatus: 'running',
  })

  const controller = new AbortController()

  // Record startup version for self-restart detection
  const startupVersion = process.env.CLAUDE_CODE_VERSION || 'unknown'

  // Official Q: once, ownership-gated CvK. Awaited at end of run path so
  // unlink finishes before process exit (void fire-and-forget left zombies).
  let lockCleared = false
  const clearOwnedLock = async (): Promise<void> => {
    if (lockCleared) return
    lockCleared = true
    await clearDaemonLockIfOwned(lockOwner)
  }

  // Graceful shutdown — signal workers; lock cleared after they drain below.
  const shutdown = () => {
    console.log('[daemon] supervisor shutting down...')
    controller.abort()
    removeDaemonState()
    for (const w of workers) {
      if (w.restartTimer) {
        clearTimeout(w.restartTimer)
        w.restartTimer = null
      }
      if (w.process && !w.process.killed) {
        w.process.kill('SIGTERM')
      }
    }
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)

  // Periodic version check for self-restart on upgrade
  const versionCheckInterval = setInterval(() => {
    const currentVersion = process.env.CLAUDE_CODE_VERSION || 'unknown'
    if (currentVersion !== startupVersion && currentVersion !== 'unknown') {
      console.log(
        `[daemon] version changed from ${startupVersion} to ${currentVersion} — restarting`,
      )
      logEvent('tengu_daemon_self_restart_on_upgrade', {
        old_version:
          startupVersion as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        new_version:
          currentVersion as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      shutdown()
    }
  }, 30_000) // Check every 30s
  versionCheckInterval.unref?.()

  // Spawn and supervise workers
  for (const worker of workers) {
    if (!controller.signal.aborted) {
      spawnWorker(worker, dir, config, controller.signal)
    }
  }

  // Wait for abort signal
  await new Promise<void>(resolve => {
    if (controller.signal.aborted) {
      resolve()
      return
    }
    controller.signal.addEventListener('abort', () => resolve(), { once: true })
  })

  // Clean up version check interval
  clearInterval(versionCheckInterval)

  // Wait for all workers to exit
  await Promise.all(
    workers
      .filter(w => w.process && w.process.exitCode === null)
      .map(
        w =>
          new Promise<void>(resolve => {
            if (!w.process || w.process.exitCode !== null) {
              resolve()
              return
            }
            let killTimer: ReturnType<typeof setTimeout> | null = null
            w.process.on('exit', () => {
              if (killTimer) {
                clearTimeout(killTimer)
                killTimer = null
              }
              resolve()
            })
            // Force kill after grace period
            killTimer = setTimeout(() => {
              if (w.process && w.process.exitCode === null) {
                w.process.kill('SIGKILL')
              }
              resolve()
            }, 30_000)
            killTimer.unref?.()
          }),
      ),
  )

  // Official CvK — only if lock still ours (pid+startedAt).
  await clearOwnedLock()
  console.log('[daemon] supervisor stopped')
}

/**
 * Spawn a worker child process with the appropriate env vars.
 */
function spawnWorker(
  worker: WorkerState,
  dir: string,
  config: Record<string, string>,
  signal: AbortSignal,
): void {
  if (signal.aborted || worker.parked) return

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

  console.log(`[daemon] spawning worker '${worker.kind}'`)

  const launch = buildCliLaunch([`--daemon-worker=${worker.kind}`], { env })

  const child = spawnCli(launch, {
    cwd: dir,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  worker.process = child

  // Pipe worker stdout/stderr to supervisor with prefix
  child.stdout?.on('data', (data: Buffer) => {
    const lines = data.toString().trimEnd().split('\n')
    for (const line of lines) {
      console.log(`  ${line}`)
    }
  })
  child.stderr?.on('data', (data: Buffer) => {
    const lines = data.toString().trimEnd().split('\n')
    for (const line of lines) {
      console.error(`  ${line}`)
    }
  })

  child.on('exit', (code, sig) => {
    worker.process = null

    if (signal.aborted) {
      // Supervisor is shutting down, don't restart
      return
    }

    if (code === EXIT_CODE_PERMANENT) {
      console.error(
        `[daemon] worker '${worker.kind}' exited with permanent error — parking`,
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
          `[daemon] worker '${worker.kind}' failed ${worker.failureCount} times rapidly — parking`,
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
      `[daemon] worker '${worker.kind}' exited (code=${code}, signal=${sig}), restarting in ${worker.backoffMs}ms`,
    )

    worker.restartTimer = setTimeout(() => {
      worker.restartTimer = null
      if (!signal.aborted && !worker.parked) {
        spawnWorker(worker, dir, config, signal)
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
    log: msg => console.log(`[daemon] ${msg}`),
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

  // manager assigned after startBgManager; shutdown/onYield close over the let.
  let manager: Awaited<ReturnType<typeof startBgManager>> | null = null
  let shuttingDown = false
  const shutdown = async (
    reason?: string,
    closeOpts?: { displaced?: boolean; skipPathCleanup?: boolean },
  ): Promise<void> => {
    if (shuttingDown) return
    shuttingDown = true
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
    onLog: (msg: string) => console.log(`  ${msg}`),
    onYield,
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

  // Keep alive
  const keepAlive = setInterval(() => {
    // Transient mode: exit if no active sessions for 30s
    if (!manager) return
    const hasActive = [...manager.handles.values()].some(h => !h.record.outcome)
    if (!hasActive && manager.handles.size > 0) {
      // All sessions completed — stay alive for a bit in case new dispatches come
    }
  }, 10_000)
  keepAlive.unref()
}
