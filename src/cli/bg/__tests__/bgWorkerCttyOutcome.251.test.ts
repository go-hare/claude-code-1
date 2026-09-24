import { beforeEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  _,
  applyBgWorkerCttyOutcome,
  doesOwnControllingTerminal,
  g,
  J,
  rNt,
  resetOwnsControllingTerminalForTests,
} from '../bgWorkerCttyOutcome.js'

const src = readFileSync(
  join(import.meta.dir, '../bgWorkerCttyOutcome.ts'),
  'utf8',
)

describe('bg worker ctty outcome callees (251 #33)', () => {
  beforeEach(() => {
    resetOwnsControllingTerminalForTests()
  })

  test('gold names rNt/_/g/J are the uo switch callees', () => {
    expect(src).toContain('export function rNt(): void')
    expect(src).toContain('zy().markOwnsControllingTerminal()')
    expect(src).toContain('nNt.of(getBootstrapSessionHost())')
    expect(src).toContain('export function _(')
    expect(src).toContain("logEvent('tengu_feature_ok'")
    expect(src).toContain('export function g(')
    expect(src).toContain("logEvent('tengu_feature_sad'")
    expect(src).toContain('export function J(')
    expect(src).toContain('logForDiagnosticsNoPII(n, t, i)')
    expect(src).toContain(
      "switch ((J('info', 'bg_worker_ctty', { outcome: t }), t))",
    )
  })

  test('rNt marks the host-keyed bag; sad outcomes do not', () => {
    expect(doesOwnControllingTerminal()).toBe(false)
    applyBgWorkerCttyOutcome('unsupported')
    expect(doesOwnControllingTerminal()).toBe(false)
    applyBgWorkerCttyOutcome('already')
    expect(doesOwnControllingTerminal()).toBe(true)
    resetOwnsControllingTerminalForTests()
    applyBgWorkerCttyOutcome('acquired')
    expect(doesOwnControllingTerminal()).toBe(true)
    resetOwnsControllingTerminalForTests()
    applyBgWorkerCttyOutcome('failed')
    applyBgWorkerCttyOutcome('ffi_unavailable')
    applyBgWorkerCttyOutcome('not_a_tty')
    applyBgWorkerCttyOutcome('switched_off')
    expect(doesOwnControllingTerminal()).toBe(false)
    rNt()
    expect(doesOwnControllingTerminal()).toBe(true)
  })

  test('_/g/J do not throw; J is diagnostics not emacs', () => {
    _('bg_worker_ctty')
    g('bg_worker_ctty', 'failed')
    J('info', 'bg_worker_ctty', { outcome: 'acquired' })
    expect(typeof J).toBe('function')
  })
})
