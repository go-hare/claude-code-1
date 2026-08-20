import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getIsNonInteractiveSession } from '../../bootstrap/state.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import type { Command, LocalCommandResult } from '../../types/command.js'
import { isFullscreenEnvEnabled } from '../../utils/fullscreen.js'
import { isTuiJustSwitchedFromFullscreen } from '../../utils/residualFinalEnvGates.js'
import {
  getSettingsForSource,
  updateSettingsForSource,
} from '../../utils/settings/settings.js'

/**
 * Path to the TUI-mode marker file.
 *
 * When this file exists, the user has opted in to flicker-free TUI mode
 * (alternate screen buffer via CLAUDE_CODE_NO_FLICKER=1). The marker is
 * session-independent: it persists across restarts so the user only needs to
 * run `/tui on` once.
 *
 * Official 2.1.210 also persists `settings.tui` ("default" | "fullscreen"),
 * which `isFullscreenEnvEnabled()` reads. `/tui on|off` writes both the
 * legacy marker and settings.tui so opt-out survives default-on fullscreen.
 *
 * Shell-profile integration: add the following to ~/.bashrc / ~/.zshrc to
 * auto-enable TUI mode when the marker is present:
 *
 *   [ -f "$HOME/.claude/.tui-mode" ] && export CLAUDE_CODE_NO_FLICKER=1
 *
 * Note: setting CLAUDE_CODE_NO_FLICKER at runtime cannot retroactively enter
 * the alternate screen buffer — the Ink render tree is already mounted. The
 * change takes effect on the NEXT session start.
 */
export function getTuiMarkerPath(): string {
  return join(getClaudeConfigHomeDir(), '.tui-mode')
}

/**
 * Returns true when the TUI-mode marker file is present, meaning the user has
 * opted in to flicker-free alternate-screen rendering.
 */
export function isTuiModeEnabled(): boolean {
  return existsSync(getTuiMarkerPath())
}

/**
 * Persist settings.tui so isFullscreenEnvEnabled() honors /tui on|off under
 * the official default-on fullscreen policy (settings.tui beats auto default).
 * Best-effort — marker + env inject still work if settings write fails.
 */
export function persistTuiSettings(target: 'fullscreen' | 'default'): {
  error: Error | null
} {
  try {
    return updateSettingsForSource('userSettings', { tui: target })
  } catch (e) {
    return { error: e instanceof Error ? e : new Error(String(e)) }
  }
}

/** Read userSettings.tui when present. */
export function readPersistedTuiSetting():
  | 'default'
  | 'fullscreen'
  | undefined {
  try {
    const tui = (
      getSettingsForSource('userSettings') as { tui?: string } | null
    )?.tui
    if (tui === 'default' || tui === 'fullscreen') return tui
  } catch {
    // settings unavailable
  }
  return undefined
}

/**
 * Whether the user has an active opt-in for fullscreen TUI via marker OR
 * settings.tui=fullscreen. Used for toggle direction under default-on.
 */
export function isTuiOptedIn(): boolean {
  if (isTuiModeEnabled()) return true
  return readPersistedTuiSetting() === 'fullscreen'
}

/**
 * Whether the user has explicitly opted out via settings.tui=default.
 * Under default-on, absent marker alone is NOT off.
 */
export function isTuiOptedOut(): boolean {
  return readPersistedTuiSetting() === 'default'
}

const USAGE_TEXT = [
  'Usage: /tui [subcommand]',
  '',
  '  (no args)   Toggle flicker-free TUI mode (alternate screen buffer)',
  '  on          Enable TUI mode',
  '  off         Disable TUI mode',
  '  status      Show current TUI mode state',
  '',
  'TUI mode uses the ANSI alternate screen buffer (\\x1b[?1049h) so the',
  'Claude Code UI occupies a clean full-screen area with no scroll-back',
  'flicker.  Preference is stored in settings.tui and ~/.claude/.tui-mode',
  'and takes effect on the next session start.',
  '',
  'Shell-profile integration (auto-enable on every start):',
  '  [ -f "$HOME/.claude/.tui-mode" ] && export CLAUDE_CODE_NO_FLICKER=1',
  '',
  'Environment override:',
  '  CLAUDE_CODE_NO_FLICKER=1   force on (overrides settings)',
  '  CLAUDE_CODE_NO_FLICKER=0   force off (overrides settings)',
].join('\n')

/**
 * Official env inject for child relaunch after /tui switch.
 * Full process relaunch (OLt/PNe) is denser; densable path records the target
 * so bounce detection (`isTuiJustSwitchedFromFullscreen`) can fire on next session.
 */
export function buildTuiJustSwitchedEnv(
  target: 'fullscreen' | 'default',
): Record<string, string> {
  return { CLAUDE_CODE_TUI_JUST_SWITCHED: target }
}

/**
 * Official bounce: env was fullscreen and user is switching to default.
 * Used for product-feedback / downsell survey gating on denser paths.
 */
export function isTuiBounceToDefault(
  target: 'fullscreen' | 'default',
): boolean {
  return target === 'default' && isTuiJustSwitchedFromFullscreen()
}

/**
 * densable bsr/OVe residual after /tui setting save — inject TUI_JUST_SWITCHED
 * and (when SPAWN_TUI_RELAUNCH) process-relaunch with Bxa `--model` pin so a
 * prior /model override is not lost.
 */
async function applyTuiRelaunchAfterSwitch(
  target: 'fullscreen' | 'default',
): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { acceptTuiRelaunch } =
      require('../../utils/cliRelaunch.js') as typeof import('../../utils/cliRelaunch.js')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getSessionId } =
      require('../../bootstrap/state.js') as typeof import('../../bootstrap/state.js')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { transcriptHasBytes } =
      require('../../utils/sessionStorage.js') as typeof import('../../utils/sessionStorage.js')
    const hasNonEmptyTranscript = await transcriptHasBytes()
    const result = acceptTuiRelaunch({
      target,
      sessionId: getSessionId(),
      hasNonEmptyTranscript,
      screenReaderEnv: {},
    })
    if (result.mode === 'spawned' && result.spawn.ok) {
      process.exit(result.spawn.status ?? 0)
    }
  } catch {
    // densable optional — marker/settings already persisted
  }
}

async function enableTui(): Promise<LocalCommandResult> {
  const markerPath = getTuiMarkerPath()
  mkdirSync(getClaudeConfigHomeDir(), { recursive: true })
  writeFileSync(markerPath, new Date().toISOString(), 'utf8')
  const settingsResult = persistTuiSettings('fullscreen')
  // densable FJi — /tui fullscreen clears sticky auto-disable + strikes.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { clearFullscreenStickyAutoDisable } =
      require('../../utils/fullscreen.js') as typeof import('../../utils/fullscreen.js')
    clearFullscreenStickyAutoDisable()
  } catch {
    // optional
  }
  // Densable residual: mark intended renderer for next process (official injects on relaunch).
  Object.assign(process.env, buildTuiJustSwitchedEnv('fullscreen'))
  await applyTuiRelaunchAfterSwitch('fullscreen')
  return {
    type: 'text',
    value: [
      '## TUI mode enabled',
      '',
      `Marker written: \`${markerPath}\``,
      'settings.tui set to `fullscreen`',
      settingsResult.error
        ? `Warning: could not persist settings.tui (${settingsResult.error.message})`
        : '',
      '',
      'Flicker-free alternate-screen rendering will be active on the next',
      'session start.  Add this to your shell profile to make it permanent:',
      '',
      '  [ -f "$HOME/.claude/.tui-mode" ] && export CLAUDE_CODE_NO_FLICKER=1',
      '',
      'To disable: `/tui off`',
    ]
      .filter(Boolean)
      .join('\n'),
  }
}

async function disableTui(): Promise<LocalCommandResult> {
  const markerPath = getTuiMarkerPath()
  const hadMarker = existsSync(markerPath)
  const hadOptOut = isTuiOptedOut()
  if (hadMarker) {
    unlinkSync(markerPath)
  }
  // Always persist settings.tui=default — under official default-on fullscreen,
  // removing the marker alone does not opt out (isFullscreenEnvEnabled → true).
  const settingsResult = persistTuiSettings('default')
  if (!hadMarker && hadOptOut && !settingsResult.error) {
    return {
      type: 'text',
      value: 'TUI mode was not active.',
    }
  }
  // Official bounce: env was fullscreen and target is default.
  const bounce = isTuiBounceToDefault('default')
  Object.assign(process.env, buildTuiJustSwitchedEnv('default'))
  await applyTuiRelaunchAfterSwitch('default')
  return {
    type: 'text',
    value: [
      '## TUI mode disabled',
      '',
      hadMarker
        ? `Marker removed: \`${markerPath}\``
        : 'Marker was already absent.',
      'settings.tui set to `default` (opts out of default-on fullscreen)',
      settingsResult.error
        ? `Warning: could not persist settings.tui (${settingsResult.error.message})`
        : '',
      '',
      'Standard (non-alternate-screen) rendering will be used on the next',
      'session start (unless CLAUDE_CODE_NO_FLICKER=1 forces on).',
      '',
      bounce
        ? 'Bounce detected (fullscreen → default). Product feedback may prompt on denser paths.'
        : '',
      'To re-enable: `/tui on`',
    ]
      .filter(Boolean)
      .join('\n'),
  }
}

export async function callTui(args: string): Promise<LocalCommandResult> {
  const sub = args.trim().toLowerCase()

  // ── status ──────────────────────────────────────────────────────────
  if (sub === 'status') {
    const enabled = isTuiModeEnabled()
    const markerPath = getTuiMarkerPath()
    const settingsTui = readPersistedTuiSetting()
    const envVal = process.env.CLAUDE_CODE_NO_FLICKER
    let envLine: string
    if (envVal === '1' || envVal === 'true') {
      envLine = 'CLAUDE_CODE_NO_FLICKER=1 (forced on via env var)'
    } else if (envVal === '0' || envVal === 'false') {
      envLine = 'CLAUDE_CODE_NO_FLICKER=0 (forced off via env var)'
    } else {
      envLine = 'CLAUDE_CODE_NO_FLICKER not set'
    }
    let effective: string
    try {
      effective = isFullscreenEnvEnabled()
        ? 'fullscreen (effective)'
        : 'default (effective)'
    } catch {
      effective = 'unknown'
    }
    // densable /tui status suffixes for crash_auto_off / sticky / pending.
    let canarySuffix = ''
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getCrashAutoOff, isFullscreenStickyAutoDisabled } =
        require('../../utils/fullscreen.js') as typeof import('../../utils/fullscreen.js')
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getGlobalConfig } =
        require('../../utils/config.js') as typeof import('../../utils/config.js')
      // densable BLOCK E: sticky-only → repeatedly-failed; crashAutoOff OR
      // pending → didn't-finish (do not OR sticky with crashAutoOff).
      if (isFullscreenStickyAutoDisabled()) {
        canarySuffix =
          '(fullscreen was turned off on this machine after it repeatedly failed to start; /tui fullscreen retries)'
      } else if (
        getCrashAutoOff() ||
        Object.keys(getGlobalConfig().fullscreenBootPending ?? {}).length > 0
      ) {
        canarySuffix =
          "(a fullscreen launch on this machine didn't finish starting last time; /tui fullscreen retries)"
      }
    } catch {
      // optional
    }
    return {
      type: 'text',
      value: [
        '## TUI Mode Status',
        '',
        `  Marker file:  ${enabled ? 'present' : 'absent'} (\`${markerPath}\`)`,
        `  settings.tui: ${settingsTui ?? '(unset — default-on fullscreen)'}`,
        `  Marker mode:  ${enabled ? 'enabled' : 'disabled'}`,
        `  Effective:    ${effective}`,
        `  Env var:      ${envLine}`,
        canarySuffix ? `  Canary:       ${canarySuffix}` : '',
        '',
        'Note: changes take effect on the next session start.',
      ]
        .filter(Boolean)
        .join('\n'),
    }
  }

  // ── on / fullscreen ──────────────────────────────────────────────────
  if (sub === 'on' || sub === 'fullscreen') {
    return await enableTui()
  }

  // ── off / default ────────────────────────────────────────────────────
  if (sub === 'off' || sub === 'default') {
    return await disableTui()
  }

  // ── toggle ───────────────────────────────────────────────────────────
  // Under default-on: toggle off when currently effective fullscreen OR
  // user has opted in; toggle on when settings.tui=default.
  if (sub === '' || sub === 'toggle') {
    if (isTuiOptedOut()) {
      return await enableTui()
    }
    // Opted in via marker/settings, or default-on with no preference → off.
    if (isTuiOptedIn() || isFullscreenEnvEnabled()) {
      return await disableTui()
    }
    return await enableTui()
  }

  // ── unknown subcommand ───────────────────────────────────────────────
  return {
    type: 'text',
    value: [`Unknown subcommand: "${sub}"`, '', USAGE_TEXT].join('\n'),
  }
}

const tuiCommand: Command = {
  type: 'local-jsx',
  name: 'tui',
  description:
    'Manage flicker-free TUI mode. Open actions or run: status, on, off, toggle',
  isHidden: false,
  isEnabled: () => !getIsNonInteractiveSession(),
  argumentHint: '[status|on|off|toggle]',
  bridgeSafe: true,
  getBridgeInvocationError: args =>
    args.trim()
      ? undefined
      : 'Use /tui status/on/off/toggle over Remote Control.',
  load: () => import('./panel.js'),
}

export const tuiNonInteractive: Command = {
  type: 'local',
  name: 'tui',
  description:
    'Toggle flicker-free TUI mode (alternate screen buffer). Subcommands: on, off, status',
  isHidden: false,
  isEnabled: () => getIsNonInteractiveSession(),
  supportsNonInteractive: true,
  bridgeSafe: true,
  load: async () => ({
    call: callTui,
  }),
}

export default tuiCommand
