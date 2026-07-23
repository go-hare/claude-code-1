/**
 * Official Wy_ / KF denser — ensure daemon running with install prompt.
 *
 * KF order (official 2.1.210 client-attach):
 *   1. oAO(forceTransient) — nudge skew probe; "up" → done
 *   2. ssK service installed? + iL6 stale exec?
 *   3. if service && !stale: asK → nL6 start → oCH(5000)
 *   4. if !service && !forceTransient && ask mode: askInstall
 *   5. asK (if not already on service path)
 *   6. Ay6 daemon run --origin transient --spawned-by <json>
 *   7. oCH(30000); if elapsed>60s && fail, oCH(5000) clock-jump retry
 */

import { createInterface } from 'readline'
import { realpath, lstat } from 'fs/promises'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../services/analytics/index.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import { isInBundledMode } from '../utils/bundledMode.js'
import { getGlobalConfig, saveGlobalConfig } from '../utils/config.js'
import { logForDebugging } from '../utils/debug.js'
import { getPlatform } from '../utils/platform.js'
import {
  planDaemonColdStart,
  resolveDaemonColdStartModeFull,
} from '../utils/residualFinalEnvGates.js'
import { gt } from '../utils/semver.js'
import { getUserBinDir } from '../utils/xdg.js'
import { isVersionedNativeBinary } from '../utils/cliLaunch.js'
import { sendControlRequest } from './controlSocketClient.js'
import {
  buildSpawnedByPayload,
  readAliveDaemonLock,
  signalSupervisorRestart,
} from './daemonLock.js'
import {
  installDaemonService,
  isDaemonServiceExecStale,
  isDaemonServiceInstallSupported,
  isDaemonServiceInstalled,
  startDaemonService,
} from './serviceInstall.js'
import { getControlSocketPath } from './bgWorker.js'
import { join } from 'path'

export type DaemonInstallAnswer = 'yes' | 'once' | 'never' | 'no'

export type EnsureDaemonRunningResult = {
  ok: boolean
  reason?: string
  askInstall?: boolean
  manager: { close(): Promise<void> } | null
}

export function isDaemonInstallPromptDismissed(): boolean {
  return getGlobalConfig().daemonInstallPromptDismissed === true
}

export function setDaemonInstallPromptDismissed(dismissed: boolean): void {
  saveGlobalConfig(current => {
    if (current.daemonInstallPromptDismissed === dismissed) return current
    return { ...current, daemonInstallPromptDismissed: dismissed }
  })
}

/**
 * Official _wO — readline prompt on stderr (does not disturb stdout TUI).
 */
export async function promptDaemonInstallAnswer(
  question = "Install as a service now? [y/N/never, or 'once' just for now] ",
): Promise<DaemonInstallAnswer> {
  if (!process.stdin.isTTY || !process.stderr.isTTY) return 'no'
  if (process.env.CI === 'true' || process.env.CI === '1') return 'no'

  const rl = createInterface({
    input: process.stdin,
    output: process.stderr,
  })
  try {
    const raw = await new Promise<string>(resolve => {
      rl.once('close', () => resolve('n'))
      rl.question(question, resolve)
    })
    const k = raw.trim().toLowerCase()
    if (k === 'y' || k === 'yes') return 'yes'
    if (k === 'once' || k === 'o') return 'once'
    if (k === 'never') return 'never'
    return 'no'
  } finally {
    rl.close()
  }
}

/**
 * Official oCH — poll control ping until deadline (default IA timeout 5s/attempt).
 */
export async function waitForDaemonReachable(
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const resp = await sendControlRequest(
      { op: 'ping', proto: 1 },
      // Official oCH uses IA default 5000; keep short so dead socket fails fast
      // on platforms where connect hangs (named pipe), match asK 1000 for poll.
      { timeoutMs: 1000 },
    )
    if (resp.ok) return true
    await new Promise(r => setTimeout(r, 100))
  }
  return false
}

/**
 * Official osK — realpath + mtimeMs, or null when unreadable.
 */
async function binaryMtimeMs(path: string): Promise<number | null> {
  try {
    return (await lstat(await realpath(path))).mtimeMs
  } catch {
    return null
  }
}

/**
 * Official aAO — client binary path from WE densable.
 *   versioned native → ~/.local/bin/claude
 *   bundled         → process.execPath
 *   unbundled/script → process.argv[1] (entry script)
 */
export function clientBinaryPath(): string {
  if (isVersionedNativeBinary(process.execPath)) {
    return join(getUserBinDir(), 'claude')
  }
  if (isInBundledMode() || !process.argv[1]) {
    return process.execPath
  }
  return process.argv[1]
}

export type DaemonBinaryTakeoverInput = {
  daemonVersion: string
  daemonOrigin: string | undefined
  daemonTarget: string | undefined
  clientVersion: string
  clientTarget: string
  daemonMtimeMs: number | null
  clientMtimeMs: number | null
}

/**
 * Official sAO — should this client retire a live transient daemon?
 *
 * Only transient daemons. Same version → keep (short-circuit before mtime).
 * Same launchTarget → keep. When daemon has no launchTarget, fall back to
 * semver gt(client, daemon). When versions differ and both have targets,
 * newer client mtime wins.
 */
export function shouldRetireStaleDaemonBinary(
  input: DaemonBinaryTakeoverInput,
): boolean {
  if (input.daemonOrigin !== 'transient') return false
  if (input.daemonVersion === input.clientVersion) return false
  if (
    input.daemonTarget !== undefined &&
    input.daemonTarget === input.clientTarget
  ) {
    return false
  }
  if (!input.daemonTarget) {
    try {
      return gt(input.clientVersion, input.daemonVersion)
    } catch {
      return false
    }
  }
  if (input.clientMtimeMs === null || input.daemonMtimeMs === null) {
    return false
  }
  return input.clientMtimeMs > input.daemonMtimeMs
}

/**
 * Surface a daemon lifecycle message. When `quiet` (left-arrow / mid alt-screen
 * handoff), only log — raw stderr would paint over a frozen Ink frame and flash
 * the terminal. CLI entry (`claude agents`) keeps stderr so users still see why
 * the supervisor restarted.
 */
function surfaceDaemonLifecycleMsg(msg: string, quiet: boolean): void {
  logForDebugging(msg, { level: 'warn' })
  if (!quiet) {
    process.stderr.write(msg.endsWith('\n') ? msg : `${msg}\n`)
  }
}

/**
 * Official tAO — retire a live transient daemon when this client is a newer
 * binary so subsequent bg sessions run the current build.
 *
 * Gates (official):
 *   1. nudge version already === client version → no-op
 *   2. tengu_bg_binary_takeover feature (default true)
 *   3. service-installed → leave service alone
 *   4. ask-mode cold start + interactive + not dismissed + !forceTransient
 *      → defer (install prompt path owns the decision)
 *   5. sAO comparison on lock vs client binary
 *   6. SIGTERM (then SIGKILL) supervisor until exited
 *
 * @param quiet When true, do not write takeover notice to stderr (debug log only).
 */
export async function tryBinaryTakeover(
  nudgeVersion: unknown,
  forceTransient: boolean,
  quiet = false,
): Promise<boolean> {
  const clientVersion = MACRO.VERSION
  if (typeof nudgeVersion === 'string' && nudgeVersion === clientVersion) {
    return false
  }
  if (
    getFeatureValue_CACHED_MAY_BE_STALE('tengu_bg_binary_takeover', true) !==
    true
  ) {
    return false
  }
  if (await isDaemonServiceInstalled().catch(() => false)) {
    return false
  }
  if (
    !forceTransient &&
    resolveDaemonColdStartModeFull() === 'ask' &&
    process.stdout.isTTY === true &&
    process.stdin.isTTY === true &&
    !isDaemonInstallPromptDismissed()
  ) {
    return false
  }

  let clientTarget: string
  try {
    clientTarget = await realpath(clientBinaryPath())
  } catch {
    return false
  }

  const lock = await readAliveDaemonLock().catch(() => null)
  if (!lock) return false

  const [clientMtimeMs, daemonMtimeMs] = await Promise.all([
    binaryMtimeMs(clientTarget),
    lock.launchTarget
      ? binaryMtimeMs(lock.launchTarget)
      : Promise.resolve(null),
  ])

  if (
    !shouldRetireStaleDaemonBinary({
      daemonVersion: lock.version,
      daemonOrigin: lock.origin,
      daemonTarget: lock.launchTarget,
      clientVersion,
      clientTarget,
      daemonMtimeMs,
      clientMtimeMs,
    })
  ) {
    return false
  }

  let signalled = await signalSupervisorRestart(lock.pid)
  if (signalled === 'timed-out') {
    try {
      process.kill(lock.pid, 'SIGKILL')
    } catch {
      // already gone
    }
    signalled = await signalSupervisorRestart(lock.pid, { gracefulMs: 500 })
    // After SIGKILL, C__ may still report exited via kill(0) failure path.
    // signalSupervisorRestart on dead pid returns 'exited'.
  }
  if (signalled !== 'exited') {
    return false
  }

  // Official N(..., { level: 'warn' }) — surface on stderr so the user sees
  // why their agents session just restarted the supervisor. Quiet during
  // left-arrow handoff: REPL already unmounted but alt-screen still frozen.
  surfaceDaemonLifecycleMsg(
    `bg: daemon pid ${lock.pid} runs ${lock.version}; this binary (${clientVersion}) is a newer build — retired the stale daemon so new sessions use the current binary`,
    quiet,
  )
  logEvent('tengu_bg_daemon_binary_takeover', {
    daemon_age_ms: Date.now() - lock.startedAt,
  })
  return true
}

/**
 * Official oAO — nudge skew / restart probe (max 10s).
 * Returns "up" when daemon is healthy enough to skip spawn.
 * On healthy non-restarting nudge, runs tAO binary-takeover; if takeover
 * retires the stale transient supervisor, returns "down" so KF respawns.
 *
 * @param quiet Suppress stderr from binary-takeover notices (mid TUI handoff).
 */
export async function probeDaemonSkew(
  forceTransient: boolean,
  quiet = false,
): Promise<'up' | 'down'> {
  const started = Date.now()
  let sawLive = false
  let lastKind: 'restarting' | 'etimeout' | 'enoconn' = 'restarting'
  const deadline = Date.now() + 10_000

  while (Date.now() < deadline) {
    const resp = await sendControlRequest(
      { op: 'nudge', proto: 1 },
      { timeoutMs: 1000 },
    )

    if (resp.ok && resp.op === 'nudge') {
      sawLive = true
      if (!resp.restarting) {
        // Official: if tAO(version, forceTransient) → 'down' to respawn.
        if (await tryBinaryTakeover(resp.version, forceTransient, quiet)) {
          return 'down'
        }
        if (Date.now() - started > 200) {
          logEvent('tengu_bg_skew_nudge', {
            converged: true,
            duration_ms: Date.now() - started,
          })
        }
        return 'up'
      }
      lastKind = 'restarting'
      await new Promise(r => setTimeout(r, 100))
      continue
    }

    if (!resp.ok && resp.code === 'ETIMEOUT') {
      sawLive = true
      lastKind = 'etimeout'
      await new Promise(r => setTimeout(r, 100))
      continue
    }

    if (!resp.ok && resp.code === 'ENOCONN') {
      if (!sawLive) {
        const lock = await readAliveDaemonLock().catch(() => null)
        if (lock) sawLive = true
      }
      if (!sawLive) return 'down'
      lastKind = 'enoconn'
      await new Promise(r => setTimeout(r, 100))
      continue
    }

    // Unexpected shape but connected — treat as up (official fallthrough).
    return 'up'
  }

  logEvent('tengu_bg_skew_nudge', {
    converged: false,
    restarting: lastKind === 'restarting',
    etimeout: lastKind === 'etimeout',
    enoconn: lastKind === 'enoconn',
  })
  return 'down'
}

/**
 * Official asK — lock alive but control socket dead → signal restart.
 * Returns error reason string on EPERM, else null (caller may continue spawn).
 *
 * @param quiet Suppress stderr (mid TUI handoff); still logs + analytics.
 */
export async function restartZombieSupervisor(
  quiet = false,
): Promise<string | null> {
  const lock = await readAliveDaemonLock().catch(() => null)
  if (!lock || Date.now() - lock.startedAt <= 5000) return null

  const ping = await sendControlRequest(
    { op: 'ping', proto: 1 },
    { timeoutMs: 1000 },
  )
  const meta = {
    started_ago_ms: Date.now() - lock.startedAt,
    origin_transient: lock.origin === 'transient',
    origin_service: lock.origin === 'service',
    version_skew: lock.version !== MACRO.VERSION,
  }

  // Alive enough (or slow) — not a zombie.
  if (ping.ok || ping.code === 'ETIMEOUT') {
    logEvent('tengu_bg_daemon_zombie_false_positive', {
      ...meta,
      recheck_etimeout: !ping.ok,
    })
    return null
  }

  let sockExists = false
  try {
    await lstat(getControlSocketPath())
    sockExists = true
  } catch {
    sockExists = false
  }

  surfaceDaemonLifecycleMsg(
    `bg: supervisor pid ${lock.pid} alive but control socket unreachable — signalling restart`,
    quiet,
  )

  const signalled = await signalSupervisorRestart(lock.pid)
  if (signalled === 'eperm') {
    return 'daemon socket missing; could not restart supervisor (EPERM)'
  }

  logEvent('tengu_bg_daemon_zombie_restart', {
    pid: lock.pid,
    ...meta,
    sock_exists: sockExists,
  })
  return null
}

/**
 * Official KF / ensureDaemonRunning denser with install prompt.
 *
 * `quiet`: suppress all stderr lifecycle chatter (takeover, Starting…, service
 * fallthrough). Use during left-arrow REPL→Agents handoff when alt-screen is
 * still frozen — stderr would collide with the footer and flash the window.
 * Install prompt still requires interactive stderr and is skipped when quiet.
 */
export async function ensureDaemonRunning(opts?: {
  forceTransient?: boolean
  /** When false, never show install prompt (headless). Default: TTY. */
  mayPromptInstall?: boolean
  /** Official onStarting — called once before service/transient start work. */
  onStarting?: () => void
  /**
   * Suppress stderr lifecycle messages (binary takeover, Starting…, service
   * fallthrough). Debug log still receives them. Default false.
   */
  quiet?: boolean
}): Promise<EnsureDaemonRunningResult> {
  const t0 = Date.now()
  const forceTransient = opts?.forceTransient ?? false
  const quiet = opts?.quiet ?? false

  // 1. oAO — fast path when daemon already healthy.
  if ((await probeDaemonSkew(forceTransient, quiet)) === 'up') {
    return { ok: true, manager: null }
  }

  const mayPrompt =
    !quiet &&
    (opts?.mayPromptInstall ??
      (process.stdout.isTTY === true &&
        process.stdin.isTTY === true &&
        process.stderr.isTTY === true))

  const emitStarting = (): void => {
    opts?.onStarting?.()
    if (mayPrompt) {
      process.stderr.write('Starting daemon…\n')
    } else if (quiet) {
      logForDebugging('Starting daemon…', { level: 'info' })
    }
  }

  // 2. ssK + iL6
  const serviceInstalled = await isDaemonServiceInstalled().catch(() => false)
  const stale =
    serviceInstalled && (await isDaemonServiceExecStale().catch(() => false))
  if (stale) {
    logEvent('tengu_bg_daemon_service_stale_exec', {})
    surfaceDaemonLifecycleMsg(
      "daemon service exec path is stale (binary deleted) — falling back to transient spawn. Run 'claude daemon install' to repair.",
      quiet,
    )
  }

  // 3. Service path: asK → start → oCH(5s)
  let triedService = false
  if (serviceInstalled && !stale) {
    triedService = true
    emitStarting()
    const zombieFail = await restartZombieSupervisor(quiet)
    if (zombieFail) {
      return { ok: false, manager: null, reason: zombieFail }
    }
    const startRes = await startDaemonService()
    const reachable = await waitForDaemonReachable(5000)
    const platform = getPlatform()
    logEvent('tengu_bg_daemon_install', {
      outcome_ok: reachable,
      via_service: true,
      fresh_install: false,
      duration_ms: Date.now() - t0,
      platform_darwin: platform === 'macos',
      platform_linux: platform === 'linux' || platform === 'wsl',
      platform_windows: platform === 'windows',
    })
    if (reachable) return { ok: true, manager: null }
    logEvent('tengu_bg_daemon_service_poll_fallthrough', {
      sr_ok: startRes.ok,
    })
    surfaceDaemonLifecycleMsg(
      `daemon service did not become reachable within 5s${
        startRes.ok ? '' : ` (${startRes.error})`
      } — falling back to transient spawn. Run 'claude daemon install' to repair.`,
      quiet,
    )
  }

  // 4. ask_install (official: only when !service && !forceTransient)
  // quiet path never prompts — install Dialog would corrupt frozen alt-screen.
  if (!serviceInstalled && !forceTransient) {
    const plan = planDaemonColdStart({
      forceTransient,
      mayPromptInstall: mayPrompt,
      installPromptDismissed: isDaemonInstallPromptDismissed(),
    })

    if (plan.action === 'ask_install') {
      logEvent('tengu_bg_daemon_cold_start_ask', {})
      if (
        !mayPrompt ||
        !process.stdin.isTTY ||
        !process.stderr.isTTY ||
        process.env.CI === 'true' ||
        process.env.CI === '1'
      ) {
        return {
          ok: false,
          askInstall: true,
          manager: null,
          reason: plan.reason,
        }
      }

      process.stderr.write(
        "No background daemon is running.\nInstalling it as a service keeps the background daemon running across reboot so 'claude agents' stays available.\n",
      )
      const answer = await promptDaemonInstallAnswer()
      logEvent('tengu_bg_daemon_cold_start_ask_answer', {
        answer_yes: answer === 'yes',
        answer_once: answer === 'once',
        answer_never: answer === 'never',
      })

      switch (answer) {
        case 'yes': {
          if (!isDaemonServiceInstallSupported()) {
            process.stderr.write(
              `Service install isn't available here. Falling back to a transient daemon for now.\n`,
            )
            break
          }
          process.stderr.write('Installing daemon service…\n')
          const installed = await installDaemonService()
          if (!installed.ok) {
            process.stderr.write(
              `Service install failed (${installed.error}). Falling back to a transient daemon for now.\n`,
            )
            break
          }
          process.stderr.write(
            `Installed: ${installed.servicePath}\nRun 'claude daemon uninstall' to undo.\n`,
          )
          // Fresh install enables+starts on systemd; launchd bootstrap runs unit.
          // Poll 5s like service path.
          const reachable = await waitForDaemonReachable(5000)
          if (reachable) return { ok: true, manager: null }
          process.stderr.write(
            `service installed but the daemon did not become reachable within 5s — falling back to transient.\n`,
          )
          break
        }
        case 'once':
          break
        case 'never':
          setDaemonInstallPromptDismissed(true)
          break
        case 'no':
          return {
            ok: false,
            askInstall: true,
            manager: null,
            reason: plan.reason,
          }
      }
    }
  }

  // 5. Transient path — asK if we did not already do service path.
  if (!triedService) {
    emitStarting()
    const zombieFail = await restartZombieSupervisor(quiet)
    if (zombieFail) {
      return { ok: false, manager: null, reason: zombieFail }
    }
  } else if (mayPrompt && !opts?.onStarting) {
    // Service path already printed Starting…; avoid double if only stderr path.
  }

  // 6–7. Ay6 + oCH(30000) + optional clock-jump oCH(5000)
  try {
    await spawnDetachedTransientDaemon()
    let reachable = await waitForDaemonReachable(30_000)
    const elapsed = Date.now() - t0
    const clockJump = elapsed > 60_000
    if (!reachable && clockJump) {
      reachable = await waitForDaemonReachable(5000)
    }
    const platform = getPlatform()
    logEvent('tengu_bg_daemon_install', {
      outcome_ok: reachable,
      via_service: false,
      fresh_install: false,
      clock_jump: clockJump,
      duration_ms: Date.now() - t0,
      platform_darwin: platform === 'macos',
      platform_linux: platform === 'linux' || platform === 'wsl',
      platform_windows: platform === 'windows',
    })
    if (reachable) return { ok: true, manager: null }
    return {
      ok: false,
      manager: null,
      reason: 'daemon did not become reachable within 30s',
    }
  } catch (err) {
    const reason = errorToReason(err)
    logEvent('tengu_bg_daemon_spawn_failed', {
      reason:
        reason as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    return { ok: false, manager: null, reason }
  }
}

/**
 * Official Ay6 densable — spawn `daemon run --origin transient --spawned-by …`
 * so the control socket outlives the parent (Windows: WMI then rsK; Unix: rsK).
 */
async function spawnDetachedTransientDaemon(): Promise<void> {
  const { spawnDaemonCli } = await import('../utils/wmiSpawn.js')
  const spawnedBy = buildSpawnedByPayload()
  const result = await spawnDaemonCli([
    'daemon',
    'run',
    '--origin',
    'transient',
    '--spawned-by',
    spawnedBy,
  ])
  if (!result.success) {
    throw new Error(result.error ?? 'failed to spawn transient daemon')
  }
}

function errorToReason(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}
