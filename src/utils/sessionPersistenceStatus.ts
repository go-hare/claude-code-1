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
 *   function x0t(){
 *     if (FORCE_SESSION_PERSISTENCE) return false
 *     if (!(CHILD_SESSION && G1() && !Og())) return false
 *     return !iGh()  // tmux global env exception
 *   }
 *
 * UI copy (densable gIf / SIf):
 * - skip_prompt_history / nested_marker startup warnings
 * - writer degraded live warning (separate module)
 */

import { isSessionPersistenceDisabled } from 'src/bootstrap/state.js'
import { isEnvTruthy } from 'src/utils/envUtils.js'
import { isForceSessionPersistenceEnabled } from 'src/utils/forceSessionPersistence.js'
import { shouldSkipPromptHistory } from 'src/utils/residualFinalEnvGates.js'
import { isChildSession } from 'src/utils/sessionRoleEnv.js'

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
 * densable x0t — inherited CHILD_SESSION marker suppresses persistence
 * unless FORCE is set. densable also gates on G1()&&!Og() and tmux iGh();
 * product 1:1 for the env surface: CHILD_SESSION truthy + not FORCE.
 */
export function isNestedMarkerSuppressingPersistence(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (isForceSessionPersistenceEnabled(env)) return false
  if (!isChildSession(env)) return false
  return true
}

/**
 * densable Gsn — why session transcript writes are suppressed, or null.
 * Note: local also has cleanupPeriodDays===0 in SessionFileManager; that is
 * orthogonal and not part of densable Gsn (not user-warned the same way).
 */
export function getPersistenceSuppressCause(
  env: NodeJS.ProcessEnv = process.env,
): PersistenceSuppressCause | null {
  const allowTestPersistence = isEnvTruthy(env.TEST_ENABLE_SESSION_PERSISTENCE)
  if (getNodeEnv() === 'test' && !allowTestPersistence) {
    return 'test_env'
  }
  // densable ere() — bootstrap sessionPersistenceDisabled only.
  // Local isSessionPersistenceDisabled already returns false under FORCE.
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
