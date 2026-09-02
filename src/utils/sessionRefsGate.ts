/**
 * leftover 2.1.239 E4s / czt / vtw / Fhr — session-refs sync latch.
 *
 * Official czt latches CLAUDE_CODE_SESSION_ID when Mf(id)!==id
 * (Mf strips `session_`/`cse_`). CLI has no session-host object — E4s
 * is a process singleton (forks share root in leftover).
 */

/** leftover 239 E4s */
export class SessionRefsGate {
  #ccrSessionID: string | undefined
  #syncEnabled: boolean | undefined

  ccrSessionID(): string | undefined {
    return this.#ccrSessionID
  }

  latchCcrSessionID(id: string): void {
    this.#ccrSessionID = id
  }

  syncEnabled(): boolean | undefined {
    return this.#syncEnabled
  }

  latchSyncEnabled(value: boolean): boolean {
    this.#syncEnabled = value
    return value
  }

  reset(): void {
    this.#ccrSessionID = undefined
    this.#syncEnabled = undefined
  }
}

const gate = new SessionRefsGate()

export function getSessionRefsGate(): SessionRefsGate {
  return gate
}

export function resetSessionRefsGateForTests(): void {
  gate.reset()
}

/** leftover 239 Mf — strip cse_/session_ prefix. */
export function stripCcrSessionPrefix(id: string): string {
  return id.replace(/^(?:session|cse)_/, '')
}

/** leftover 239 czt */
export function latchCcrSessionId(
  sessionGate: SessionRefsGate = gate,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (sessionGate.ccrSessionID() === undefined) {
    const raw = env.CLAUDE_CODE_SESSION_ID
    if (raw && stripCcrSessionPrefix(raw) !== raw) {
      sessionGate.latchCcrSessionID(raw)
    }
  }
  return sessionGate.ccrSessionID()
}

/** leftover 239 vtw */
export function hasLatchedCcrSession(
  sessionGate: SessionRefsGate = gate,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return latchCcrSessionId(sessionGate, env) !== undefined
}

/** leftover 239 Fhr */
export function isSessionRefsSyncEnabled(
  sessionGate: SessionRefsGate = gate,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const latched = sessionGate.syncEnabled()
  if (latched !== undefined) return latched
  return sessionGate.latchSyncEnabled(
    Boolean(env.CLAUDE_CODE_SYNC_SESSION_REFS) &&
      hasLatchedCcrSession(sessionGate, env),
  )
}
