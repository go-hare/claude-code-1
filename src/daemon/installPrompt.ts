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
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../services/analytics/index.js'
import { getGlobalConfig, saveGlobalConfig } from '../utils/config.js'
import { getPlatform } from '../utils/platform.js'
import { planDaemonColdStart } from '../utils/residualFinalEnvGates.js'
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
import { lstat } from 'fs/promises'

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
 * Official oAO — nudge skew / restart probe (max 10s).
 * Returns "up" when daemon is healthy enough to skip spawn.
 * Binary-takeover (tAO) is not ported here; always treat non-restarting nudge as up.
 */
export async function probeDaemonSkew(
  _forceTransient: boolean,
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
        // Local: no binary-takeover denser yet → treat as up.
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
 */
export async function restartZombieSupervisor(): Promise<string | null> {
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

  process.stderr.write(
    `bg: supervisor pid ${lock.pid} alive but control socket unreachable — signalling restart\n`,
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
 */
export async function ensureDaemonRunning(opts?: {
  forceTransient?: boolean
  /** When false, never show install prompt (headless). Default: TTY. */
  mayPromptInstall?: boolean
  /** Official onStarting — called once before service/transient start work. */
  onStarting?: () => void
}): Promise<EnsureDaemonRunningResult> {
  const t0 = Date.now()
  const forceTransient = opts?.forceTransient ?? false

  // 1. oAO — fast path when daemon already healthy.
  if ((await probeDaemonSkew(forceTransient)) === 'up') {
    return { ok: true, manager: null }
  }

  const mayPrompt =
    opts?.mayPromptInstall ??
    (process.stdout.isTTY === true &&
      process.stdin.isTTY === true &&
      process.stderr.isTTY === true)

  const emitStarting = (): void => {
    opts?.onStarting?.()
    if (mayPrompt) {
      process.stderr.write('Starting daemon…\n')
    }
  }

  // 2. ssK + iL6
  const serviceInstalled = await isDaemonServiceInstalled().catch(() => false)
  const stale =
    serviceInstalled && (await isDaemonServiceExecStale().catch(() => false))
  if (stale) {
    logEvent('tengu_bg_daemon_service_stale_exec', {})
    process.stderr.write(
      "daemon service exec path is stale (binary deleted) — falling back to transient spawn. Run 'claude daemon install' to repair.\n",
    )
  }

  // 3. Service path: asK → start → oCH(5s)
  let triedService = false
  if (serviceInstalled && !stale) {
    triedService = true
    emitStarting()
    const zombieFail = await restartZombieSupervisor()
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
    process.stderr.write(
      `daemon service did not become reachable within 5s${
        startRes.ok ? '' : ` (${startRes.error})`
      } — falling back to transient spawn. Run 'claude daemon install' to repair.\n`,
    )
  }

  // 4. ask_install (official: only when !service && !forceTransient)
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
    const zombieFail = await restartZombieSupervisor()
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
