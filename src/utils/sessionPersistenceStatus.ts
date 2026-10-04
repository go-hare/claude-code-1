/**
 * densable 2.1.217 #2 — transcript persistence suppress cause (Gsn / TO / x0t).
 *
 * densable:
 *   function TO(){ return Gsn() !== null }
 *   function Gsn(){
 *     if (test && !TEST_ENABLE_SESSION_PERSISTENCE) return "test_env"
 *     if (ere()) return "explicit_disable"  // sessionPersistenceDisabled flag
 *     if (CLAUDE_CODE_SKIP_PROMPT_HISTORY) return "skip_prompt_history"
 *     if (x0t()) return "nested_marker"
 *     return null
 *   }
 *   function x0t(){  // leftover P$e @ 178053668
 *     if (FORCE_SESSION_PERSISTENCE) return false
 *     if (!(CHILD_SESSION && _u() && !nl())) return false
 *     return !isChildSessionMarkerAmbientInTmux()
 *   }
 *   _u = launchOptions.isInteractive(); nl = teammate (agentId+teamName).
 *   SDK/print isInteractive=false → inherited CHILD_SESSION does NOT skip writes.
 *
 * UI copy (densable gIf / SIf):
 * - skip_prompt_history / nested_marker startup warnings
 * - writer degraded live warning (separate module)
 */

import { spawnSync } from 'node:child_process'
import {
  getIsInteractive,
  isSessionPersistenceDisabled,
} from 'src/bootstrap/state.js'
import { isEnvTruthy } from 'src/utils/envUtils.js'
import { isForceSessionPersistenceEnabled } from 'src/utils/forceSessionPersistence.js'
import { shouldSkipPromptHistory } from 'src/utils/residualFinalEnvGates.js'
import { isChildSession } from 'src/utils/sessionRoleEnv.js'
import { isTeammate } from 'src/utils/teammate.js'

/** Match sessionStorage.getNodeEnv without circular import. */
function getNodeEnv(): string {
  return process.env.NODE_ENV || 'development'
}

export type PersistenceSuppressCause =
  | 'test_env'
  | 'explicit_disable'
  | 'skip_prompt_history'
  | 'nested_marker'

/**
 * densable C / vzo @ 178053668 — tmux `show-environment -g` lists
 * CLAUDE_CODE_CHILD_SESSION= as ambient (inherited into every pane).
 * Ambient marker must not suppress writes (gold P$e `return !ambient`).
 */
function isChildSessionMarkerAmbientInTmux(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!env.TMUX) return false
  try {
    const result = spawnSync('tmux', ['show-environment', '-g'], {
      encoding: 'utf8',
      timeout: 250,
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    })
    if (result.status !== 0 || typeof result.stdout !== 'string') return false
    return result.stdout
      .split('\n')
      .some(line => line.startsWith('CLAUDE_CODE_CHILD_SESSION='))
  } catch {
    return false
  }
}

/**
 * densable P$e / x0t @ 178053668.
 * CHILD_SESSION suppresses only when the session is interactive AND not a
 * teammate. SDK/print (`isInteractive=false`) still writes JSONL so
 * get_session_info / get_session_messages can read the just-finished sid.
 */
export function isNestedMarkerSuppressingPersistence(
  env: NodeJS.ProcessEnv = process.env,
  opts?: { interactive?: boolean; isTeammate?: boolean },
): boolean {
  if (isForceSessionPersistenceEnabled(env)) return false
  if (!isChildSession(env)) return false
  const interactive = opts?.interactive ?? getIsInteractive()
  if (!interactive) return false
  const teammate = opts?.isTeammate ?? isTeammate()
  if (teammate) return false
  if (isChildSessionMarkerAmbientInTmux(env)) return false
  return true
}

/**
 * densable Gsn — why session transcript writes are suppressed, or null.
 * cleanupPeriodDays is retention only (gold schema: never disables writes).
 */
export function getPersistenceSuppressCause(
  env: NodeJS.ProcessEnv = process.env,
): PersistenceSuppressCause | null {
  const allowTestPersistence = isEnvTruthy(env.TEST_ENABLE_SESSION_PERSISTENCE)
  if (getNodeEnv() === 'test' && !allowTestPersistence) {
    return 'test_env'
  }
  // densable ere() — bootstrap sessionPersistenceDisabled only (qC).
  // FORCE is official Kce/x0t nested_marker only — not in qC.
  if (isSessionPersistenceDisabled()) {
    return 'explicit_disable'
  }
  if (shouldSkipPromptHistory(env)) {
    return 'skip_prompt_history'
  }
  if (isNestedMarkerSuppressingPersistence(env)) {
    return 'nested_marker'
  }
  return null
}

/** densable TO() */
export function isPersistenceSuppressed(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return getPersistenceSuppressCause(env) !== null
}

/** densable gIf — user-visible causes only (skip_prompt_history | nested_marker) */
export function getUserVisiblePersistenceSuppressCause(
  env: NodeJS.ProcessEnv = process.env,
): 'skip_prompt_history' | 'nested_marker' | null {
  const cause = getPersistenceSuppressCause(env)
  if (cause === 'skip_prompt_history' || cause === 'nested_marker') {
    return cause
  }
  return null
}

export function formatPersistenceSuppressedPrimary(
  cause: 'skip_prompt_history' | 'nested_marker',
): string {
  if (cause === 'skip_prompt_history') {
    return 'Transcript saving is off — CLAUDE_CODE_SKIP_PROMPT_HISTORY is set'
  }
  return 'Transcript saving is off — inherited CLAUDE_CODE_CHILD_SESSION marker'
}

export function formatPersistenceSuppressedHint(
  cause: 'skip_prompt_history' | 'nested_marker',
): string {
  if (cause === 'skip_prompt_history') {
    return '· --resume will not find this session; if unintended, unset it and restart'
  }
  return '· restart with CLAUDE_CODE_FORCE_SESSION_PERSISTENCE=1 to keep future transcripts'
}

export function formatPersistenceSuppressedNotificationText(
  cause: 'skip_prompt_history' | 'nested_marker',
): string {
  return `${formatPersistenceSuppressedPrimary(cause)} ${formatPersistenceSuppressedHint(cause)}`
}
