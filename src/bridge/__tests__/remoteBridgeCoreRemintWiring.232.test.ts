/**
 * densable 2.1.232 #39 — remoteBridgeCore remint wiring source lock.
 * Product path wires Ls/flight/G7/Hde without inventing live network e2e.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const corePath = join(import.meta.dir, '../remoteBridgeCore.ts')
const core = readFileSync(corePath, 'utf8')

describe('densable 232 #39 remoteBridgeCore remint wiring', () => {
  test('imports remintRecovery surface used by densable Ls/nn/G7', () => {
    expect(core).toContain("from './remintRecovery.js'")
    for (const sym of [
      'CLOSE_CODE_RECOVERY',
      'createRecoveryFlight',
      'disposeTransportClose',
      'remintBackoffMs',
    ]) {
      expect(core).toContain(sym)
    }
  })

  test('handleTransportClose uses disposeTransportClose (Ls)', () => {
    expect(core).toContain('function handleTransportClose')
    expect(core).toContain('disposeTransportClose({')
    expect(core).toContain('createRecoveryFlight()')
  })

  test('G7 teleported suppress on remint + rebuild', () => {
    expect(core).toContain('suppressed_teleported')
    expect(core).toContain('bridge_repl_v2_remint_loop_teleported')
    expect(core).toContain('SESSION_TELEPORTED_DETAIL')
  })

  test('remint loop uses remintCap + remintBackoffMs', () => {
    expect(core).toContain('remintCap')
    expect(core).toContain('remintBackoffMs(remintAttempts')
    expect(core).toContain('bridge_repl_v2_remint_loop_entered')
  })
})
