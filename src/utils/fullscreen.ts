import { spawnSync } from 'child_process'
import { hostname as osHostname } from 'os'
import { existsSync } from 'fs'
import { join } from 'path'
import { onExit } from 'signal-exit'
import { getIsInteractive } from '../bootstrap/state.js'
import { logForDebugging } from './debug.js'
import {
  getClaudeConfigHomeDir,
  isEnvDefinedFalsy,
  isEnvTruthy,
} from './envUtils.js'
import { execFileNoThrow } from './execFileNoThrow.js'
import { isProcessRunning } from './genericProcessUtils.js'
import { getPlatform } from './platform.js'
import { isAlternateScreenDisabled } from './residualUiEnvGates.js'
import type { GlobalConfig } from './config.js'

let loggedTmuxCcDisable = false
let loggedWinSshDisable = false
let checkedTmuxMouseHint = false
/** Test-only override for official yMi windows check (process.platform). */
let windowsPlatformOverride: boolean | undefined

/**
 * densable Rse.crashAutoOff — session latch set by iIh reconcile / sticky honour.
 * Honoured by Ps/isFullscreenEnvEnabled after env force-on, before host checks.
 */
let crashAutoOff = false

/** densable Qbw — sticky strike threshold. */
export const FULLSCREEN_BOOT_STICKY_STRIKES = 2
/** densable eSw — healthy after first frame (ms). */
export const FULLSCREEN_BOOT_HEALTHY_AFTER_MS = 10_000
/** densable tSw — pending alive TTL (ms). */
export const FULLSCREEN_BOOT_PENDING_TTL_MS = 600_000
/** densable rSw — cross-host pending TTL (ms, ~30d). */
export const FULLSCREEN_BOOT_CROSS_HOST_TTL_MS = 2_592_000_000

/** densable oSw — classic fallback stderr (single strike). */
export const FULLSCREEN_CLASSIC_FALLBACK_MESSAGE = `Claude Code's fullscreen renderer didn't finish starting last time on this machine, so this launch is using the classic renderer. It will try fullscreen again next launch; /tui default keeps the classic renderer.
`
/** densable iSw — sticky-off stderr (tripped). */
export const FULLSCREEN_STICKY_OFF_MESSAGE = `Claude Code's fullscreen renderer has repeatedly failed to start on this machine, so it has been turned off here. Run /tui fullscreen to try it again (this also resets after an update).
`

/** densable rIh — arm-eligible gate reasons. */
const FULLSCREEN_CANARY_ARM_REASON_LIST = [
  'settings_on',
  'upsell_trial_on',
  'ant_default',
  'downsell_on',
  'gb_on',
] as const
export type FullscreenCanaryArmReason =
  (typeof FULLSCREEN_CANARY_ARM_REASON_LIST)[number]
export const FULLSCREEN_CANARY_ARM_REASONS = new Set<string>(
  FULLSCREEN_CANARY_ARM_REASON_LIST,
)

export function isFullscreenCanaryArmReason(
  reason: string,
): reason is FullscreenCanaryArmReason {
  return FULLSCREEN_CANARY_ARM_REASONS.has(reason)
}

export type FullscreenBootPendingEntry = NonNullable<
  GlobalConfig['fullscreenBootPending']
>[string]

export type FullscreenBootReconcileContext = {
  now: number
  version: string
  host: string
  platform: string
  ownPid: number
  isGone: (pid: number) => boolean
  stickyStrikes?: number
}

export type FullscreenBootDecision =
  | { kind: 'none' }
  | { kind: 'disabled' }
  | {
      kind: 'strike'
      strikes: number
      newStrikes: number
      pendingAgeMs: number
    }
  | {
      kind: 'tripped'
      strikes: number
      newStrikes: number
      pendingAgeMs: number
    }
  | { kind: 'pending_alive' }

export type FullscreenBootConfigSlice = Pick<
  GlobalConfig,
  'fullscreenBootPending' | 'fullscreenBootStrikes' | 'fullscreenAutoDisabled'
>

type CanaryState =
  | { status: 'idle' }
  | {
      status: 'armed'
      pid: number
      cleanup: () => void
      onHealthy?: () => void | Promise<void>
      healthyAfterMs: number
      firstFrameAt: number | undefined
      timer: ReturnType<typeof setTimeout> | undefined
    }
  | { status: 'settled' }

/** densable hQ — canary FSM. */
let canaryState: CanaryState = { status: 'idle' }
/** densable h_r — last armed pid for exit-hook withdraw. */
let canaryArmedPid: number | undefined
let canaryExitHook: (() => void) | undefined

function isTuiModeMarkerPresent(): boolean {
  try {
    return existsSync(join(getClaudeConfigHomeDir(), '.tui-mode'))
  } catch {
    return false
  }
}

/**
 * MACRO.VERSION is injected by bun -d / Bun.build define. Unit tests may run
 * without defines — typeof guard avoids ReferenceError (unlike try/catch on TDZ).
 */
function packageVersion(): string {
  return typeof MACRO !== 'undefined' ? MACRO.VERSION : '0.0.0-test'
}

/**
 * Cached result from `tmux display-message -p '#{client_control_mode}'`.
 * undefined = not yet queried (or probe failed) — env heuristic stays authoritative.
 */
let tmuxControlModeProbed: boolean | undefined

/**
 * Env-var heuristic for iTerm2's tmux integration mode (`tmux -CC` / `tmux -2CC`).
 *
 * In `-CC` mode, iTerm2 renders tmux panes as native splits — tmux runs
 * as a server (TMUX is set) but iTerm2 is the actual terminal emulator
 * for each pane, so TERM_PROGRAM stays `iTerm.app` and TERM is iTerm2's
 * default (xterm-*). Contrast with regular tmux-inside-iTerm2, where tmux
 * overwrites TERM_PROGRAM to `tmux` and sets TERM to screen-* or tmux-*.
 *
 * This heuristic has known holes (SSH often doesn't propagate TERM_PROGRAM;
 * .tmux.conf can override TERM) — probeTmuxControlModeSync() is the
 * authoritative backstop. Kept as a zero-subprocess fast path.
 */
function isTmuxControlModeEnvHeuristic(): boolean {
  if (!process.env.TMUX) return false
  if (process.env.TERM_PROGRAM !== 'iTerm.app') return false
  // Belt-and-suspenders: in regular tmux TERM is screen-* or tmux-*;
  // in -CC mode iTerm2 sets its own TERM (xterm-*).
  const term = process.env.TERM ?? ''
  return !term.startsWith('screen') && !term.startsWith('tmux')
}

/**
 * Sync one-shot probe: asks tmux directly whether this client is in control
 * mode via `#{client_control_mode}`. Runs on first isTmuxControlMode() call
 * when the env heuristic can't decide; result is cached.
 *
 * Sync (spawnSync) because the answer gates whether we enter fullscreen — an
 * async probe raced against React render and lost: coder-tmux (ssh → tmux -CC
 * on a remote box) doesn't propagate TERM_PROGRAM, so the env heuristic missed,
 * and by the time the async probe resolved we'd already entered alt-screen with
 * mouse tracking enabled. Mouse wheel is dead in iTerm2's -CC integration, so
 * users couldn't scroll at all.
 *
 * Cost: one ~5ms subprocess, only when $TMUX is set AND $TERM_PROGRAM is unset
 * (the SSH-into-tmux case). Local iTerm2 -CC and non-tmux paths skip the spawn.
 *
 * The TMUX env check MUST come first — without it, display-message would
 * query whatever tmux server happens to be running rather than our client.
 */
function probeTmuxControlModeSync(): void {
  // Seed cache with heuristic result so early returns below don't leave it
  // undefined — isTmuxControlMode() is called 15+ times per render, and an
  // undefined cache would re-enter this function (re-spawning tmux in the
  // failure case) on every call.
  tmuxControlModeProbed = isTmuxControlModeEnvHeuristic()
  if (tmuxControlModeProbed) return
  if (!process.env.TMUX) return
  // Only probe when iTerm might be involved: TERM_PROGRAM is iTerm.app
  // (covered above) or not set (SSH often doesn't propagate it). When
  // TERM_PROGRAM is explicitly a non-iTerm terminal, skip — tmux -CC is
  // an iTerm-only feature, so the subprocess would be wasted.
  if (process.env.TERM_PROGRAM) return
  let result
  try {
    result = spawnSync(
      'tmux',
      ['display-message', '-p', '#{client_control_mode}'],
      { encoding: 'utf8', timeout: 2000 },
    )
  } catch {
    // spawnSync can throw on some platforms (e.g. ENOENT on Windows if tmux
    // is absent and the runtime surfaces it as an exception rather than in
    // result.error). Treat the same as a non-zero exit.
    return
  }
  // Non-zero exit / spawn error: tmux too old (format var added in 2.4) or
  // unavailable. Keep the heuristic result cached.
  if (result.status !== 0) return
  tmuxControlModeProbed = result.stdout.trim() === '1'
}

/**
 * True when running under `tmux -CC` (iTerm2 integration mode).
 *
 * The alt-screen / mouse-tracking path in fullscreen mode is unrecoverable
 * in -CC mode (double-click corrupts terminal state; mouse wheel is dead),
 * so callers auto-disable fullscreen.
 *
 * Lazily probes tmux on first call when the env heuristic can't decide.
 */
export function isTmuxControlMode(): boolean {
  if (tmuxControlModeProbed === undefined) probeTmuxControlModeSync()
  return tmuxControlModeProbed ?? false
}

export function _resetTmuxControlModeProbeForTesting(): void {
  tmuxControlModeProbed = undefined
  loggedTmuxCcDisable = false
  loggedWinSshDisable = false
  windowsPlatformOverride = undefined
}

/**
 * Official yMi densable — Windows over SSH (ConPTY re-rendering is broken
 * under alt-screen). Matches Ot()==="windows" (process.platform==="win32")
 * + SSH_* env triple.
 */
export function isWindowsOverSSH(): boolean {
  const isWindows = windowsPlatformOverride ?? process.platform === 'win32'
  if (!isWindows) return false
  return Boolean(
    process.env.SSH_CONNECTION || process.env.SSH_CLIENT || process.env.SSH_TTY,
  )
}

/** Test-only: force/clear the windows branch of isWindowsOverSSH. */
export function _setWindowsPlatformForTesting(
  isWindows: boolean | undefined,
): void {
  windowsPlatformOverride = isWindows
}

/**
 * Fullscreen / no-flicker alt-screen gate.
 *
 * Official P8t densable (2.1.210) + local bg-session force-on:
 *   1. DISABLE_ALTERNATE_SCREEN / NO_FLICKER=0 → off
 *   2. bg session / NO_FLICKER=1 → on
 *   3. Windows over SSH (yMi) → off
 *   4. tmux -CC → off (mouse/alt-screen unrecoverable)
 *   5. settings.tui "default"|"fullscreen" when set
 *   6. default → on
 */
export function isFullscreenEnvEnabled(): boolean {
  // Official CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN force-off (_Mi).
  if (isAlternateScreenDisabled()) {
    return false
  }
  // bg sessions always use fullscreen (official Qi: SESSION_KIND==="bg" → true)
  if (process.env.CLAUDE_CODE_SESSION_KIND === 'bg') return true
  // Explicit user opt-out always wins.
  if (isEnvDefinedFalsy(process.env.CLAUDE_CODE_NO_FLICKER)) return false
  // Explicit opt-in overrides auto-detection (escape hatch).
  // Official isNoFlickerEnabled densable force-on.
  try {
    const { isNoFlickerEnabled } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./residualFinalEnvGates.js') as typeof import('./residualFinalEnvGates.js')
    if (isNoFlickerEnabled()) return true
  } catch {
    if (isEnvTruthy(process.env.CLAUDE_CODE_NO_FLICKER)) return true
  }
  // densable Ps: crashAutoOff session latch (sticky NDn honoured via iIh/aIh → latch).
  if (crashAutoOff) return false
  // Official yMi: Windows over SSH auto-off (before settings.tui / after force-on).
  if (isWindowsOverSSH()) {
    if (!loggedWinSshDisable) {
      loggedWinSshDisable = true
      logForDebugging(
        'fullscreen disabled: Windows over SSH (ConPTY re-rendering) detected · set CLAUDE_CODE_NO_FLICKER=1 to override',
      )
    }
    return false
  }
  // Auto-disable under tmux -CC: alt-screen + mouse tracking corrupts
  // terminal state on double-click and mouse wheel is dead. Official P8t:
  // before settings.tui so settings cannot re-enable a broken host.
  if (isTmuxControlMode()) {
    if (!loggedTmuxCcDisable) {
      loggedTmuxCcDisable = true
      logForDebugging(
        'fullscreen disabled: tmux -CC (iTerm2 integration mode) detected · set CLAUDE_CODE_NO_FLICKER=1 to override',
      )
    }
    return false
  }
  // Official settings.tui via merged settings (zn().tui densable).
  try {
    const { getInitialSettings } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./settings/settings.js') as typeof import('./settings/settings.js')
    const tui = getInitialSettings()?.tui
    if (tui === 'default') return false
    if (tui === 'fullscreen') return true
  } catch {
    // settings unavailable (early boot / tests) — fall through
  }
  // Official default-on (PR #21439 / 2.1.210 external ships / P8t).
  return true
}

/**
 * Official Qi densable — gate for non-renderer fullscreen *features*
 * (focus view, etc.). Distinct from P8t / isFullscreenEnvEnabled which wraps
 * AlternateScreen and defaults ON.
 *
 * After env/tmux/win-ssh/settings, falls through to:
 *   tengu_amber_creek downsell → true
 *   tengu_pewter_brook GB (default false) → true/false
 */
export function isFullscreenFeatureGateEnabled(): boolean {
  // local-agent sessions never get feature gate (official JF()==="local-agent")
  if (process.env.CLAUDE_CODE_ENTRYPOINT === 'local-agent') return false
  if (process.env.CLAUDE_CODE_SESSION_KIND === 'bg') return true
  if (isAlternateScreenDisabled()) return false
  if (isEnvDefinedFalsy(process.env.CLAUDE_CODE_NO_FLICKER)) return false
  try {
    const { isNoFlickerEnabled } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./residualFinalEnvGates.js') as typeof import('./residualFinalEnvGates.js')
    if (isNoFlickerEnabled()) return true
  } catch {
    if (isEnvTruthy(process.env.CLAUDE_CODE_NO_FLICKER)) return true
  }
  // densable bQt: crashAutoOff || NDn() force-off before host/settings/GB.
  if (crashAutoOff || isFullscreenStickyAutoDisabled()) return false
  if (isTmuxControlMode()) return false
  if (isWindowsOverSSH()) return false
  try {
    const { getInitialSettings } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./settings/settings.js') as typeof import('./settings/settings.js')
    const tui = getInitialSettings()?.tui
    if (tui === 'fullscreen') return true
    if (tui === 'default') return false
  } catch {
    // fall through
  }
  try {
    const { getFeatureValue_CACHED_MAY_BE_STALE } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../services/analytics/growthbook.js') as typeof import('../services/analytics/growthbook.js')
    // Official k2h / tengu_amber_creek downsell force-on
    if (getFeatureValue_CACHED_MAY_BE_STALE('tengu_amber_creek', false)) {
      return true
    }
    // Official tengu_pewter_brook default false — coerce so non-boolean GB
    // stubs (null/undefined) fail closed rather than leaking null outward.
    return Boolean(
      getFeatureValue_CACHED_MAY_BE_STALE('tengu_pewter_brook', false),
    )
  } catch {
    return false
  }
}

/**
 * Official t3e densable — diagnostic reason string for the fullscreen gate.
 * Matches official labels for analytics/debug; not used for control flow.
 */
export type FullscreenGateReason =
  | 'bg_forced_on'
  | 'sr_auto_off'
  | 'env_off'
  | 'env_on'
  | 'crash_auto_off'
  | 'tmux_cc_auto_off'
  | 'win_ssh_auto_off'
  | 'settings_on'
  | 'settings_off'
  | 'upsell_trial_on'
  | 'ant_default'
  | 'downsell_on'
  | 'gb_on'
  | 'gb_off'
  /** @deprecated prefer ant_default (densable xse) */
  | 'default_on'

export function getFullscreenGateReason(): FullscreenGateReason {
  if (process.env.CLAUDE_CODE_SESSION_KIND === 'bg') return 'bg_forced_on'
  if (isAlternateScreenDisabled()) return 'env_off'
  if (isEnvDefinedFalsy(process.env.CLAUDE_CODE_NO_FLICKER)) return 'env_off'
  try {
    const { isNoFlickerEnabled } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./residualFinalEnvGates.js') as typeof import('./residualFinalEnvGates.js')
    if (isNoFlickerEnabled()) return 'env_on'
  } catch {
    if (isEnvTruthy(process.env.CLAUDE_CODE_NO_FLICKER)) return 'env_on'
  }
  // densable xse: crashAutoOff before host auto-offs.
  if (crashAutoOff) return 'crash_auto_off'
  if (isTmuxControlMode()) return 'tmux_cc_auto_off'
  if (isWindowsOverSSH()) return 'win_ssh_auto_off'
  try {
    const { getInitialSettings } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./settings/settings.js') as typeof import('./settings/settings.js')
    const tui = getInitialSettings()?.tui
    // densable: settings.tui unset + trial marker → upsell_trial_on (sNr residual).
    if (tui === 'fullscreen') return 'settings_on'
    if (tui === undefined && isTuiModeMarkerPresent()) return 'upsell_trial_on'
    if (tui === 'default') return 'settings_off'
  } catch {
    // fall through
  }
  try {
    const { getFeatureValue_CACHED_MAY_BE_STALE } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../services/analytics/growthbook.js') as typeof import('../services/analytics/growthbook.js')
    if (getFeatureValue_CACHED_MAY_BE_STALE('tengu_amber_creek', false)) {
      return 'downsell_on'
    }
    if (getFeatureValue_CACHED_MAY_BE_STALE('tengu_pewter_brook', false)) {
      return 'gb_on'
    }
    // tip P8t renderer defaults ON when GB pewter is off — densable ant_default.
    // (SEA Ps falls through to GB false; tip keeps default-on, so arm via ant_default.)
    return 'ant_default'
  } catch {
    // densable xse ant_default when GB path unavailable (P8t default-on).
    return 'ant_default'
  }
}

/**
 * Official Lfe densable mouse mode:
 * - DISABLE_MOUSE set → "off" when truthy, else "full"
 * - else DISABLE_MOUSE_CLICKS set → "scroll" when truthy, else "full"
 * - else "full"
 *
 * "full" = tracking + clicks; "scroll" = tracking, no clicks; "off" = no tracking.
 */
export type MouseTrackingMode = 'off' | 'scroll' | 'full'

export function resolveMouseTrackingMode(
  env: NodeJS.ProcessEnv = process.env,
): MouseTrackingMode {
  if (env.CLAUDE_CODE_DISABLE_MOUSE !== undefined) {
    return isEnvTruthy(env.CLAUDE_CODE_DISABLE_MOUSE) ? 'off' : 'full'
  }
  if (env.CLAUDE_CODE_DISABLE_MOUSE_CLICKS !== undefined) {
    return isEnvTruthy(env.CLAUDE_CODE_DISABLE_MOUSE_CLICKS) ? 'scroll' : 'full'
  }
  return 'full'
}

/**
 * Whether fullscreen mode should enable any SGR mouse tracking.
 * Set CLAUDE_CODE_DISABLE_MOUSE=1 to keep alt-screen + virtualized scroll
 * (keyboard PgUp/PgDn/Ctrl+Home/End still work) but skip mouse capture,
 * so tmux/kitty/terminal-native copy-on-select keeps working.
 *
 * Compare with CLAUDE_CODE_NO_FLICKER=0 which is all-or-nothing — it also
 * disables alt-screen and virtualized scrollback.
 */
export function isMouseTrackingEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return resolveMouseTrackingMode(env) !== 'off'
}

/**
 * densable mode string for `<AlternateScreen mouseTracking={...}>`.
 * Prefer this over `isMouseTrackingEnabled()` so "scroll" can enable
 * 1000+1006 only (no 1002/1003 any-motion flood on Apple Terminal).
 */
export function mouseTrackingProp(
  env: NodeJS.ProcessEnv = process.env,
): MouseTrackingMode {
  return resolveMouseTrackingMode(env)
}

/**
 * Whether mouse click handling is disabled (clicks/drags ignored, wheel still
 * works). Set CLAUDE_CODE_DISABLE_MOUSE_CLICKS=1 to prevent accidental clicks
 * from triggering cursor positioning, text selection, or message expansion.
 *
 * Fullscreen-specific — only reachable when CLAUDE_CODE_NO_FLICKER is active.
 * Official Lfe: "scroll" mode disables clicks; "off" also has no clicks.
 */
export function isMouseClicksDisabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const mode = resolveMouseTrackingMode(env)
  return mode === 'scroll' || mode === 'off'
}

/**
 * True when the fullscreen alt-screen layout is actually rendering —
 * requires an interactive REPL session AND the env var not explicitly
 * set falsy. Headless paths (--print, SDK, in-process teammates) never
 * enter fullscreen, so features that depend on alt-screen re-rendering
 * should gate on this.
 */
export function isFullscreenActive(): boolean {
  return getIsInteractive() && isFullscreenEnvEnabled()
}

/**
 * One-time hint for tmux users in fullscreen with `mouse off`.
 *
 * tmux's `mouse` option is session-scoped by design — there is no
 * pane-level equivalent. We used to `tmux set mouse on` when entering
 * alt-screen so wheel scrolling worked, but that changed mouse behavior
 * for every sibling pane (vim, less, shell) and leaked on kill-pane or
 * when multiple CC instances raced on restore. Now we leave tmux state
 * alone — same as vim/less/htop — and just tell the user their options.
 *
 * Fire-and-forget from REPL startup. Returns the hint text once per
 * session if TMUX is set, fullscreen is active, and tmux's current
 * `mouse` option is off; null otherwise.
 */
export async function maybeGetTmuxMouseHint(): Promise<string | null> {
  if (!process.env.TMUX) return null
  // tmux -CC auto-disables fullscreen above, but belt-and-suspenders.
  if (!isFullscreenActive() || isTmuxControlMode()) return null
  if (checkedTmuxMouseHint) return null
  checkedTmuxMouseHint = true
  // -A includes inherited values: `show -v mouse` returns empty when the
  // option is set globally (`set -g mouse on` in .tmux.conf) but not at
  // session level — which is the common case. -A gives the effective value.
  const { stdout, code } = await execFileNoThrow(
    'tmux',
    ['show', '-Av', 'mouse'],
    { useCwd: false, timeout: 2000 },
  )
  if (code !== 0 || stdout.trim() === 'on') return null
  return "tmux detected · scroll with PgUp/PgDn · or add 'set -g mouse on' to ~/.tmux.conf for wheel scroll"
}

/** Test-only: reset module-level once-per-session flags. */
export function _resetForTesting(): void {
  loggedTmuxCcDisable = false
  loggedWinSshDisable = false
  checkedTmuxMouseHint = false
  windowsPlatformOverride = undefined
  crashAutoOff = false
  if (canaryState.status === 'armed') {
    canaryState.cleanup()
    if (canaryState.timer !== undefined) clearTimeout(canaryState.timer)
  }
  canaryState = { status: 'idle' }
  canaryArmedPid = undefined
}

// ── densable 2.1.236 GAP #5 fullscreen boot canary ──────────────────────────

/** densable NDn — sticky auto-disable for current VERSION. */
export function isFullscreenStickyAutoDisabled(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getGlobalConfig } =
      require('./config.js') as typeof import('./config.js')
    return (
      getGlobalConfig().fullscreenAutoDisabled?.version === packageVersion()
    )
  } catch {
    return false
  }
}

export function getCrashAutoOff(): boolean {
  return crashAutoOff
}

export function setCrashAutoOff(value: boolean): void {
  crashAutoOff = value
}

/** densable oIh */
export function getFullscreenBootHost(): string {
  try {
    return osHostname()
  } catch {
    return 'unknown'
  }
}

/** densable nSw */
export function buildFullscreenBootReconcileContext(
  now: number = Date.now(),
): FullscreenBootReconcileContext {
  return {
    now,
    version: packageVersion(),
    host: getFullscreenBootHost(),
    platform: getPlatform(),
    ownPid: process.pid,
    isGone: (pid: number) => !isProcessRunning(pid),
  }
}

/**
 * densable eIh — pure reconcile of pending/strikes/sticky from boot canary state.
 */
export function reconcileFullscreenBootConfig(
  config: FullscreenBootConfigSlice,
  ctx: FullscreenBootReconcileContext,
): { next: FullscreenBootConfigSlice; decision: FullscreenBootDecision } {
  const stickyStrikes = ctx.stickyStrikes ?? FULLSCREEN_BOOT_STICKY_STRIKES
  const pending: Record<string, FullscreenBootPendingEntry> = {
    ...(config.fullscreenBootPending ?? {}),
  }
  let autoDisabled = config.fullscreenAutoDisabled
  let strikes =
    config.fullscreenBootStrikes?.version === ctx.version
      ? config.fullscreenBootStrikes.count
      : 0
  if (autoDisabled && autoDisabled.version !== ctx.version) {
    autoDisabled = undefined
  }

  let newStrikes = 0
  let hasAlivePending = false
  let pendingAgeMs = Number.POSITIVE_INFINITY

  for (const [key, entry] of Object.entries(pending)) {
    const pid = Number(key)
    if (
      !Number.isInteger(pid) ||
      pid < 1 ||
      typeof entry !== 'object' ||
      !entry
    ) {
      delete pending[key]
      continue
    }
    const age = Math.max(0, ctx.now - entry.startedAt)
    if (entry.host !== ctx.host || entry.platform !== ctx.platform) {
      if (age > FULLSCREEN_BOOT_CROSS_HOST_TTL_MS) delete pending[key]
      continue
    }
    if (entry.died !== undefined || pid === ctx.ownPid || ctx.isGone(pid)) {
      delete pending[key]
      if (entry.version === ctx.version) {
        newStrikes += 1
        pendingAgeMs = Math.min(pendingAgeMs, age)
      }
    } else if (age > FULLSCREEN_BOOT_PENDING_TTL_MS) {
      delete pending[key]
    } else {
      hasAlivePending = true
    }
  }

  let decision: FullscreenBootDecision = { kind: 'none' }
  if (autoDisabled) {
    decision = { kind: 'disabled' }
  } else if (newStrikes > 0) {
    strikes += newStrikes
    const age = Number.isFinite(pendingAgeMs) ? pendingAgeMs : 0
    if (strikes >= stickyStrikes) {
      autoDisabled = {
        version: ctx.version,
        at: ctx.now,
        strikes,
      }
      decision = {
        kind: 'tripped',
        strikes,
        newStrikes,
        pendingAgeMs: age,
      }
      strikes = 0
    } else {
      decision = {
        kind: 'strike',
        strikes,
        newStrikes,
        pendingAgeMs: age,
      }
    }
  } else if (hasAlivePending) {
    decision = { kind: 'pending_alive' }
  }

  return {
    next: {
      fullscreenBootPending:
        Object.keys(pending).length > 0 ? pending : undefined,
      fullscreenBootStrikes:
        strikes > 0 ? { count: strikes, version: ctx.version } : undefined,
      fullscreenAutoDisabled: autoDisabled,
    },
    decision,
  }
}

/** densable tIh — whether boot canary fields changed. */
export function fullscreenBootConfigChanged(
  a: FullscreenBootConfigSlice,
  b: FullscreenBootConfigSlice,
): boolean {
  const keys = (c: FullscreenBootConfigSlice) =>
    Object.keys(c.fullscreenBootPending ?? {})
      .sort()
      .join(',')
  return (
    keys(a) !== keys(b) ||
    (a.fullscreenBootStrikes?.count ?? 0) !==
      (b.fullscreenBootStrikes?.count ?? 0) ||
    a.fullscreenBootStrikes?.version !== b.fullscreenBootStrikes?.version ||
    a.fullscreenAutoDisabled?.version !== b.fullscreenAutoDisabled?.version ||
    a.fullscreenAutoDisabled?.at !== b.fullscreenAutoDisabled?.at
  )
}

/** densable d7o — map gate reason → renderer mode. */
export function fullscreenModeForGateReason(
  reason: FullscreenGateReason,
): 'fullscreen' | 'default' {
  switch (reason) {
    case 'env_on':
    case 'bg_forced_on':
    case 'settings_on':
    case 'upsell_trial_on':
    case 'ant_default':
    case 'default_on':
    case 'downsell_on':
    case 'gb_on':
      return 'fullscreen'
    default:
      return 'default'
  }
}

/** densable sIh — clear pending for pid; optionally clear strikes (healthy). */
export function clearFullscreenBootHealthy<T extends FullscreenBootConfigSlice>(
  config: T,
  pid: number,
  clearStrikes: boolean,
): T {
  const hadPending = config.fullscreenBootPending?.[String(pid)] !== undefined
  if (!hadPending && !(clearStrikes && config.fullscreenBootStrikes)) {
    return config
  }
  let pending = config.fullscreenBootPending
  if (hadPending && pending) {
    const { [String(pid)]: _removed, ...rest } = pending
    pending = Object.keys(rest).length > 0 ? rest : undefined
  }
  return {
    ...config,
    fullscreenBootPending: pending,
    fullscreenBootStrikes: clearStrikes
      ? undefined
      : config.fullscreenBootStrikes,
  } as T
}

/** densable FJi — clear sticky + strikes (/tui fullscreen / version bump path). */
export function clearFullscreenStickyAutoDisable(): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { saveGlobalConfig } =
      require('./config.js') as typeof import('./config.js')
    saveGlobalConfig(current =>
      current.fullscreenAutoDisabled === undefined &&
      current.fullscreenBootStrikes === undefined
        ? current
        : {
            ...current,
            fullscreenAutoDisabled: undefined,
            fullscreenBootStrikes: undefined,
          },
    )
  } catch {
    // config unavailable
  }
}

/**
 * densable iIh — launch reconcile: apply eIh, set crashAutoOff, stderr oSw/iSw.
 */
export function reconcileFullscreenBootAtLaunch(
  now: number = Date.now(),
): FullscreenBootDecision {
  const reason = getFullscreenGateReason()
  if (
    reason === 'env_on' ||
    reason === 'bg_forced_on' ||
    isEnvTruthy(process.env.CLAUDE_CODE_EXIT_AFTER_FIRST_RENDER)
  ) {
    return { kind: 'none' }
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getGlobalConfig, saveGlobalConfig } =
    require('./config.js') as typeof import('./config.js')

  const ctx = buildFullscreenBootReconcileContext(now)
  const current = getGlobalConfig()
  const { next, decision } = reconcileFullscreenBootConfig(current, ctx)
  if (fullscreenBootConfigChanged(current, next)) {
    saveGlobalConfig(prev => {
      const again = reconcileFullscreenBootConfig(prev, ctx).next
      return fullscreenBootConfigChanged(prev, again)
        ? { ...prev, ...again }
        : prev
    })
  }

  if (
    decision.kind === 'strike' ||
    decision.kind === 'tripped' ||
    decision.kind === 'disabled'
  ) {
    crashAutoOff = true
    const wouldBeFullscreen =
      fullscreenModeForGateReason(reason) === 'fullscreen'
    if (decision.kind !== 'disabled') {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { logEvent } =
          require('../services/analytics/index.js') as typeof import('../services/analytics/index.js')
        type AnalyticsTag =
          import('../services/analytics/index.js').AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
        logEvent('tengu_fullscreen_crash_auto_off', {
          sticky: decision.kind === 'tripped',
          strikes: decision.strikes,
          new_strikes: decision.newStrikes,
          pending_age_ms: decision.pendingAgeMs,
          would_be_entry_path: reason as AnalyticsTag,
          overrides_fullscreen: wouldBeFullscreen,
        })
      } catch {
        // analytics optional
      }
      if (wouldBeFullscreen) {
        process.stderr.write(
          decision.kind === 'tripped'
            ? FULLSCREEN_STICKY_OFF_MESSAGE
            : FULLSCREEN_CLASSIC_FALLBACK_MESSAGE,
        )
      }
    }
    logForDebugging(
      `fullscreen disabled: a previous fullscreen launch on this machine died before it was healthy (${decision.kind}) · /tui fullscreen or CLAUDE_CODE_NO_FLICKER=1 to override`,
    )
  } else if (decision.kind !== 'none') {
    logForDebugging(`fullscreen boot canary: ${decision.kind}`)
  }
  return decision
}

function ensureCanaryExitHook(): void {
  if (canaryExitHook !== undefined) return
  // densable backup withdraw — no self-pid isProcessRunning gate (always true).
  // Primary SEA $a dispose is registered in armFullscreenBootCanary cleanup.
  canaryExitHook = () => {
    if (canaryArmedPid === undefined) return
    const pid = canaryArmedPid
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { saveGlobalConfig } =
        require('./config.js') as typeof import('./config.js')
      saveGlobalConfig(current =>
        clearFullscreenBootHealthy(current, pid, false),
      )
    } catch {
      // ignore
    }
  }
  process.on('exit', canaryExitHook)
}

/**
 * densable aIh — arm canary when entering fullscreen via eligible reason.
 * Returns whether canary is armed after the call.
 */
export async function armFullscreenBootCanary(options?: {
  onHealthy?: () => void | Promise<void>
  healthyAfterMs?: number
}): Promise<boolean> {
  if (canaryState.status !== 'idle') {
    return canaryState.status === 'armed'
  }
  // densable HM() ≈ alt-screen capable interactive path; tip uses isFullscreenActive helpers.
  if (
    isAlternateScreenDisabled() ||
    isEnvTruthy(process.env.CLAUDE_CODE_EXIT_AFTER_FIRST_RENDER)
  ) {
    return false
  }
  const stickyReason = getFullscreenGateReason()
  if (
    !crashAutoOff &&
    isFullscreenStickyAutoDisabled() &&
    isFullscreenCanaryArmReason(stickyReason)
  ) {
    crashAutoOff = true
    logForDebugging(
      'fullscreen disabled: turned off on this machine after repeated failed starts (recorded sticky auto-disable, honoured at REPL mount) · /tui fullscreen or CLAUDE_CODE_NO_FLICKER=1 to override',
    )
  }
  if (!isFullscreenEnvEnabled()) return false
  const reason = getFullscreenGateReason()
  if (!isFullscreenCanaryArmReason(reason)) {
    return false
  }

  const pid = process.pid
  const stamp: FullscreenBootPendingEntry = {
    startedAt: Date.now(),
    version: packageVersion(),
    host: getFullscreenBootHost(),
    platform: getPlatform(),
  }
  // densable $a → cIh(healthy|withdrawn): dispose while still armed settles.
  // healthy when firstFrameAt seen and clean exitCode; else withdrawn.
  // Do not invent uv()/_1s(); backup process.exit hook still withdraws only.
  let disposeExit: (() => void) | undefined
  const cleanup = () => {
    disposeExit?.()
    disposeExit = undefined
  }
  ensureCanaryExitHook()
  canaryState = {
    status: 'armed',
    pid,
    cleanup,
    onHealthy: options?.onHealthy,
    healthyAfterMs: options?.healthyAfterMs ?? FULLSCREEN_BOOT_HEALTHY_AFTER_MS,
    firstFrameAt: undefined,
    timer: undefined,
  }
  canaryArmedPid = pid
  disposeExit = onExit((exitCode, _signal) => {
    if (canaryState.status !== 'armed') return
    const firstFrameAt = canaryState.firstFrameAt
    const clean = exitCode === undefined || exitCode === 0
    const outcome =
      firstFrameAt !== undefined && clean ? 'healthy' : 'withdrawn'
    void settleFullscreenBootCanary(outcome).catch(() => {})
  })
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { saveGlobalConfig } =
      require('./config.js') as typeof import('./config.js')
    await Promise.resolve(
      saveGlobalConfig(current => {
        const existing = current.fullscreenBootPending?.[String(pid)]
        // densable: do not overwrite same-pid pending that already died render_error.
        if (existing?.died === 'render_error') {
          return current
        }
        return {
          ...current,
          fullscreenBootPending: {
            ...current.fullscreenBootPending,
            [String(pid)]: stamp,
          },
        }
      }),
    )
  } catch (err) {
    logForDebugging(
      `fullscreen boot canary arm failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    )
  }
  return canaryState.status === 'armed'
}

/** densable lIh — note first frame; schedule healthy settle. */
export function noteFullscreenBootFirstFrame(now: number = Date.now()): void {
  if (
    canaryState.status !== 'armed' ||
    canaryState.firstFrameAt !== undefined
  ) {
    return
  }
  canaryState.firstFrameAt = now
  const healthyAfterMs = canaryState.healthyAfterMs
  canaryState.timer = setTimeout(() => {
    void settleFullscreenBootCanary('healthy').catch(err => {
      logForDebugging(
        `fullscreen boot canary healthy settle failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      )
    })
  }, healthyAfterMs)
  canaryState.timer.unref?.()
}

/** densable cIh */
export async function settleFullscreenBootCanary(
  outcome: 'healthy' | 'withdrawn',
): Promise<void> {
  if (canaryState.status !== 'armed') return
  const { pid, cleanup, timer, onHealthy } = canaryState
  canaryState = { status: 'settled' }
  cleanup()
  if (timer !== undefined) clearTimeout(timer)
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { saveGlobalConfig } =
      require('./config.js') as typeof import('./config.js')
    await Promise.resolve(
      saveGlobalConfig(current =>
        clearFullscreenBootHealthy(current, pid, outcome === 'healthy'),
      ),
    )
  } catch {
    // ignore
  }
  if (canaryArmedPid === pid) canaryArmedPid = undefined
  logForDebugging(`fullscreen boot canary: ${outcome}`)
  if (outcome === 'healthy' && onHealthy) {
    try {
      await onHealthy()
    } catch (err) {
      logForDebugging(
        `fullscreen boot canary onHealthy failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      )
    }
  }
}

/**
 * densable $Ji — mark armed pending as died:"render_error".
 * Returns true when a pending entry was updated.
 */
export async function markFullscreenBootRenderError(): Promise<boolean> {
  if (canaryState.status !== 'armed') return false
  const { pid, cleanup, timer } = canaryState
  canaryState = { status: 'settled' }
  cleanup()
  if (timer !== undefined) clearTimeout(timer)
  if (canaryArmedPid === pid) canaryArmedPid = undefined
  let updated = false
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { saveGlobalConfig } =
      require('./config.js') as typeof import('./config.js')
    await Promise.resolve(
      saveGlobalConfig(current => {
        const entry = current.fullscreenBootPending?.[String(pid)]
        if (entry === undefined || entry.died !== undefined) return current
        updated = true
        return {
          ...current,
          fullscreenBootPending: {
            ...current.fullscreenBootPending,
            [String(pid)]: { ...entry, died: 'render_error' },
          },
        }
      }),
    )
  } catch {
    // ignore
  }
  logForDebugging('fullscreen boot canary: failure recorded')
  return updated
}

export function getFullscreenBootCanaryStatus(): CanaryState['status'] {
  return canaryState.status
}
