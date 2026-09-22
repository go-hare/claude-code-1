/**
 * leftover 2.1.239 E4s / czt / vtw / Fhr — session-refs sync latch.
 *
 * Official czt latches CLAUDE_CODE_SESSION_ID when Mf(id)!==id
 * (Mf strips `session_`/`cse_`). Leftover wrappers go through
 * n().sessionRefsGate (Official Te @178530131).
 */

import { getBootstrapSession } from 'src/utils/sessionHost.js'
import { SessionRefsGate } from './sessionSlots.js'

export { SessionRefsGate }

export function getSessionRefsGate(): SessionRefsGate {
  return getBootstrapSession().sessionRefsGate
}

export function resetSessionRefsGateForTests(): void {
  const gate = getBootstrapSession().sessionRefsGate
  gate.latchCcrSessionID(undefined)
  gate.latchSyncEnabled(undefined)
}

/** leftover 239 Mf — strip cse_/session_ prefix. */
export function stripCcrSessionPrefix(id: string): string {
  return id.replace(/^(?:session|cse)_/, '')
}

/** leftover 239 czt */
export function latchCcrSessionId(
  sessionGate: SessionRefsGate = getBootstrapSession().sessionRefsGate,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (sessionGate.ccrSessionID() === undefined) {
    const raw = env.CLAUDE_CODE_SESSION_ID
    if (raw && stripCcrSessionPrefix(raw) !== raw) {
      sessionGate.latchCcrSessionID(raw)
    }
  }
  return sessionGate.ccrSessionID() as string | undefined
}

/** leftover 239 vtw */
export function hasLatchedCcrSession(
  sessionGate: SessionRefsGate = getBootstrapSession().sessionRefsGate,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return latchCcrSessionId(sessionGate, env) !== undefined
}

/** leftover 239 Fhr */
export function isSessionRefsSyncEnabled(
  sessionGate: SessionRefsGate = getBootstrapSession().sessionRefsGate,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const latched = sessionGate.syncEnabled()
  if (latched !== undefined) return latched as boolean
  return sessionGate.latchSyncEnabled(
    Boolean(env.CLAUDE_CODE_SYNC_SESSION_REFS) &&
      hasLatchedCcrSession(sessionGate, env),
  ) as boolean
}
