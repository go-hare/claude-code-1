import { afterEach, describe, expect, test } from 'bun:test'
import {
  SessionRefsGate,
  isSessionRefsSyncEnabled,
  latchCcrSessionId,
  resetSessionRefsGateForTests,
} from '../sessionRefsGate.js'

const saved: Record<string, string | undefined> = {}

function pinEnv(patch: Record<string, string | undefined>): void {
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in saved)) saved[k] = process.env[k]
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  resetSessionRefsGateForTests()
}

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
    delete saved[k]
  }
  resetSessionRefsGateForTests()
})

describe('leftover 239 Fhr / E4s sessionRefsGate', () => {
  test('Fhr false without SYNC_SESSION_REFS', () => {
    pinEnv({
      CLAUDE_CODE_SYNC_SESSION_REFS: undefined,
      CLAUDE_CODE_SESSION_ID: 'cse_abc',
    })
    expect(isSessionRefsSyncEnabled()).toBe(false)
  })

  test('Fhr latches true when SYNC_SESSION_REFS + cse_* session', () => {
    pinEnv({
      CLAUDE_CODE_SYNC_SESSION_REFS: '1',
      CLAUDE_CODE_SESSION_ID: 'cse_abc',
    })
    expect(isSessionRefsSyncEnabled()).toBe(true)
    expect(latchCcrSessionId()).toBe('cse_abc')
  })

  test('Fhr ignores non-CCR session ids', () => {
    pinEnv({
      CLAUDE_CODE_SYNC_SESSION_REFS: '1',
      CLAUDE_CODE_SESSION_ID: 'local-uuid',
    })
    expect(isSessionRefsSyncEnabled()).toBe(false)
  })

  test('czt latches any cse_/session_ prefix (Mf!==id)', () => {
    pinEnv({
      CLAUDE_CODE_SYNC_SESSION_REFS: '0',
      CLAUDE_CODE_SESSION_ID: 'session_xyz',
    })
    expect(isSessionRefsSyncEnabled()).toBe(true)
    expect(latchCcrSessionId()).toBe('session_xyz')
  })

  test('E4s latchSyncEnabled sticks', () => {
    const gate = new SessionRefsGate()
    expect(gate.syncEnabled()).toBeUndefined()
    expect(gate.latchSyncEnabled(true)).toBe(true)
    expect(isSessionRefsSyncEnabled(gate, {})).toBe(true)
  })
})
