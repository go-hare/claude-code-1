/**
 * Teammate mode snapshot module.
 *
 * Captures the teammate mode at session startup, following the same pattern
 * as hooksConfigSnapshot.ts. This ensures that runtime config changes don't
 * affect the teammate mode for the current session.
 */

import { resolveUserIntentSetting } from '../../../utils/config.js'
import { logForDebugging } from '../../../utils/debug.js'
import { logError } from '../../../utils/log.js'
import {
  getBootstrapSessionHost,
  HostSlot,
} from '../../../utils/sessionHost.js'

export type TeammateMode =
  | 'auto'
  | 'tmux'
  | 'iterm2'
  | 'windows-terminal'
  | 'in-process'

type TeammateModeSnapshotHostState = {
  /** Captured teammate mode at startup. */
  initialTeammateMode: TeammateMode | null
  /** CLI override (set before capture if --teammate-mode is provided). */
  cliTeammateModeOverride: TeammateMode | null
}

/** Official 2.1.331 [W-388 Hod] — per-host teammate mode snapshot state. */
const teammateModeSnapshotHostSlot =
  new HostSlot<TeammateModeSnapshotHostState>(() => ({
    initialTeammateMode: null,
    cliTeammateModeOverride: null,
  }))

function getSnapshotState(): TeammateModeSnapshotHostState {
  return teammateModeSnapshotHostSlot.of(getBootstrapSessionHost())
}

/**
 * Set the CLI override for teammate mode.
 * Must be called before captureTeammateModeSnapshot().
 */
export function setCliTeammateModeOverride(mode: TeammateMode): void {
  getSnapshotState().cliTeammateModeOverride = mode
}

/**
 * Get the current CLI override, if any.
 * Returns null if no CLI override was set.
 */
export function getCliTeammateModeOverride(): TeammateMode | null {
  return getSnapshotState().cliTeammateModeOverride
}

/**
 * Clear the CLI override and update the snapshot to the new mode.
 * Called when user changes the setting in the UI, allowing their change to take effect.
 *
 * @param newMode - The new mode the user selected (passed directly to avoid race condition)
 */
export function clearCliTeammateModeOverride(newMode: TeammateMode): void {
  const state = getSnapshotState()
  state.cliTeammateModeOverride = null
  state.initialTeammateMode = newMode
  logForDebugging(
    `[TeammateModeSnapshot] CLI override cleared, new mode: ${newMode}`,
  )
}

/**
 * Capture the teammate mode at session startup.
 * Called early in main.tsx, after CLI args are parsed.
 * CLI override takes precedence over config.
 */
export function captureTeammateModeSnapshot(): void {
  const state = getSnapshotState()
  if (state.cliTeammateModeOverride) {
    state.initialTeammateMode = state.cliTeammateModeOverride
    logForDebugging(
      `[TeammateModeSnapshot] Captured from CLI override: ${state.initialTeammateMode}`,
    )
  } else {
    state.initialTeammateMode = resolveUserIntentSetting(
      'teammateMode',
      'auto' as const,
    ).value
    logForDebugging(
      `[TeammateModeSnapshot] Captured from config: ${state.initialTeammateMode}`,
    )
  }
}

/**
 * Get the teammate mode for this session.
 * Returns the snapshot captured at startup, ignoring any runtime config changes.
 */
export function getTeammateModeFromSnapshot(): TeammateMode {
  const state = getSnapshotState()
  if (state.initialTeammateMode === null) {
    // This indicates an initialization bug - capture should happen in setup()
    logError(
      new Error(
        'getTeammateModeFromSnapshot called before capture - this indicates an initialization bug',
      ),
    )
    captureTeammateModeSnapshot()
  }
  // Fallback to 'auto' if somehow still null (shouldn't happen, but safe)
  return state.initialTeammateMode ?? 'auto'
}
