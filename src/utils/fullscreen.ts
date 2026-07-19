import { spawnSync } from 'child_process'
import { getIsInteractive } from '../bootstrap/state.js'
import { logForDebugging } from './debug.js'
import { isEnvDefinedFalsy, isEnvTruthy } from './envUtils.js'
import { execFileNoThrow } from './execFileNoThrow.js'
import { isAlternateScreenDisabled } from './residualUiEnvGates.js'

let loggedTmuxCcDisable = false
let loggedWinSshDisable = false
let checkedTmuxMouseHint = false
/** Test-only override for official yMi windows check (process.platform). */
let windowsPlatformOverride: boolean | undefined

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
    // Official tengu_pewter_brook default false
    return getFeatureValue_CACHED_MAY_BE_STALE('tengu_pewter_brook', false)
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
  | 'tmux_cc_auto_off'
  | 'win_ssh_auto_off'
  | 'settings_on'
  | 'settings_off'
  | 'downsell_on'
  | 'gb_on'
  | 'gb_off'
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
  if (isTmuxControlMode()) return 'tmux_cc_auto_off'
  if (isWindowsOverSSH()) return 'win_ssh_auto_off'
  try {
    const { getInitialSettings } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./settings/settings.js') as typeof import('./settings/settings.js')
    const tui = getInitialSettings()?.tui
    if (tui === 'fullscreen') return 'settings_on'
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
    return 'gb_off'
  } catch {
    // P8t path has no GB fallthrough — default on
    return 'default_on'
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
}
