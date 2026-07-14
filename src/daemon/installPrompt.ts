/**
 * Official Wy_ denser — interactive cold-start install prompt when
 * planDaemonColdStart returns ask_install.
 *
 * Answers:
 *   yes   → install persistent service
 *   once  → spawn transient (no dismiss)
 *   never → dismiss forever + spawn transient
 *   no    → leave daemon down
 */

import { createInterface } from 'readline'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../services/analytics/index.js'
import { getGlobalConfig, saveGlobalConfig } from '../utils/config.js'
import { planDaemonColdStart } from '../utils/residualFinalEnvGates.js'
import { startBgManager } from './bgManager.js'
import { sendControlRequest } from './controlSocket.js'
import {
  installDaemonService,
  isDaemonServiceInstallSupported,
} from './serviceInstall.js'

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

async function waitForDaemonReachable(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const resp = await sendControlRequest(
      { op: 'ping', proto: 1 },
      { timeoutMs: 1000 },
    )
    if (resp.ok) return true
    await new Promise(r => setTimeout(r, 100))
  }
  return false
}

/**
 * Official KF / ensureDaemonRunning denser with install prompt.
 */
export async function ensureDaemonRunning(opts?: {
  forceTransient?: boolean
  /** When false, never show install prompt (headless). Default: TTY. */
  mayPromptInstall?: boolean
}): Promise<EnsureDaemonRunningResult> {
  const resp = await sendControlRequest(
    { op: 'ping', proto: 1 },
    { timeoutMs: 2000 },
  )
  if (resp.ok) return { ok: true, manager: null }

  const mayPrompt =
    opts?.mayPromptInstall ??
    (process.stdout.isTTY === true &&
      process.stdin.isTTY === true &&
      process.stderr.isTTY === true)

  const plan = planDaemonColdStart({
    forceTransient: opts?.forceTransient,
    mayPromptInstall: mayPrompt,
    installPromptDismissed: isDaemonInstallPromptDismissed(),
  })

  if (plan.action === 'ask_install') {
    logEvent('tengu_bg_daemon_cold_start_ask', {})
    // Non-interactive or CI: surface reason without prompt.
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
        const reachable = await waitForDaemonReachable(5000)
        if (reachable) return { ok: true, manager: null }
        return {
          ok: false,
          manager: null,
          reason:
            "service installed but the daemon did not become reachable within 5s — check 'claude daemon status'",
        }
      }
      case 'once':
        // fall through to transient below
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

  // In-process transient daemon (fork-reliable path).
  process.stderr.write('Starting daemon…\n')
  try {
    const manager = await startBgManager({ onLog: () => {} })
    return { ok: true, manager }
  } catch (err) {
    const reason = errorToReason(err)
    logEvent('tengu_bg_daemon_spawn_failed', {
      reason:
        reason as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    return { ok: false, manager: null, reason }
  }
}

function errorToReason(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}
