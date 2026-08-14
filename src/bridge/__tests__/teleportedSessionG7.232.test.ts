import { afterEach, describe, expect, test } from 'bun:test'
import {
  clearTeleportedSessionId,
  isTeleportedSessionId,
  markTeleportedSessionId,
  normalizeTeleportedSessionId,
  setTeleportedSessionInfo,
} from '../../bootstrap/state.js'
import { SESSION_TELEPORTED_DETAIL } from '../remintRecovery.js'

/**
 * densable 2.1.232 #39 — G7 / zNn teleportedSessionIds.
 * Gold: Dm strip session_|cse_; zNn add FIFO 64; G7 has; Ljp delete.
 */
describe('teleportedSessionIds densable G7/zNn', () => {
  afterEach(() => {
    // best-effort clear ids used in tests
    for (const id of [
      'session_abc',
      'cse_abc',
      'plain-uuid-1',
      'session_a',
      'session_b',
      'cse_xyz',
    ]) {
      clearTeleportedSessionId(id)
    }
    // clear cap-fill keys
    for (let i = 0; i < 70; i++) {
      clearTeleportedSessionId(`session_cap_${i}`)
    }
  })

  test('Dm normalizes session_/cse_ prefix', () => {
    expect(normalizeTeleportedSessionId('session_abc')).toBe('abc')
    expect(normalizeTeleportedSessionId('cse_abc')).toBe('abc')
    expect(normalizeTeleportedSessionId('plain-uuid-1')).toBe('plain-uuid-1')
  })

  test('zNn mark + G7 has; same bare id across prefixes', () => {
    expect(isTeleportedSessionId('session_abc')).toBe(false)
    markTeleportedSessionId('session_abc')
    expect(isTeleportedSessionId('session_abc')).toBe(true)
    expect(isTeleportedSessionId('cse_abc')).toBe(true)
    expect(isTeleportedSessionId('abc')).toBe(true)
  })

  test('Ljp clear removes G7', () => {
    markTeleportedSessionId('session_a')
    expect(isTeleportedSessionId('session_a')).toBe(true)
    clearTeleportedSessionId('cse_a')
    expect(isTeleportedSessionId('session_a')).toBe(false)
  })

  test('FIFO cap 64', () => {
    for (let i = 0; i < 70; i++) {
      markTeleportedSessionId(`session_cap_${i}`)
    }
    // oldest 0..5 should be gone
    expect(isTeleportedSessionId('session_cap_0')).toBe(false)
    expect(isTeleportedSessionId('session_cap_5')).toBe(false)
    // newest still present
    expect(isTeleportedSessionId('session_cap_69')).toBe(true)
    expect(isTeleportedSessionId('session_cap_6')).toBe(true)
  })

  test('setTeleportedSessionInfo also zNn-marks id', () => {
    setTeleportedSessionInfo({ sessionId: 'cse_xyz' })
    expect(isTeleportedSessionId('session_xyz')).toBe(true)
    expect(isTeleportedSessionId('cse_xyz')).toBe(true)
  })

  test('fail detail gold', () => {
    expect(SESSION_TELEPORTED_DETAIL).toBe('Session teleported to cloud')
  })
})
