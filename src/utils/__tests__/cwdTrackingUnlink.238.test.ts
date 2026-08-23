/**
 * densable 2.1.238 #12 — `$0f` cwd-tracking unlink gate.
 *
 * Gold: if child still running (pid set, exitCode===null, signalCode===null)
 * defer unlink until `exit`; else unlink now. Abort/kill coverage is the
 * exit-defer path, not a second invent cleanup.
 */
import { describe, expect, test } from 'bun:test'
import { shouldDeferCwdTrackingUnlink } from '../Shell.js'

describe('densable 2.1.238 #12 $0f cwd-tracking unlink', () => {
  test('still-running child defers unlink until exit', () => {
    expect(
      shouldDeferCwdTrackingUnlink({
        pid: 4242,
        exitCode: null,
        signalCode: null,
      }),
    ).toBe(true)
  })

  test('already-exited child unlinks immediately', () => {
    expect(
      shouldDeferCwdTrackingUnlink({
        pid: 4242,
        exitCode: 0,
        signalCode: null,
      }),
    ).toBe(false)
  })

  test('signaled child unlinks immediately', () => {
    expect(
      shouldDeferCwdTrackingUnlink({
        pid: 4242,
        exitCode: null,
        signalCode: 'SIGTERM',
      }),
    ).toBe(false)
  })

  test('pid-less spawn unlinks immediately', () => {
    expect(
      shouldDeferCwdTrackingUnlink({
        exitCode: null,
        signalCode: null,
      }),
    ).toBe(false)
  })
})
