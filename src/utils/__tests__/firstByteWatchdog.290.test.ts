import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  checkStreamIdleSuspend,
  detectStreamSuspend,
  StreamSuspendedError,
} from '../firstByteWatchdog.js'

describe('v2.1.290 #89 streamIdleTimer sleep-suspend detection', () => {
  test('detectStreamSuspend detects system suspend when timer fires early monotonically with large wall jump', () => {
    const idleMs = 300_000
    const res = detectStreamSuspend(
      {
        monotonicNow: () => 10_000,
        now: () => 1_700_250_000_000,
      },
      {
        armedAt: 0,
        wallArmedAt: 1_700_000_000_000,
        idleMs,
      },
    )
    expect(res.lateMs).toBe(-290_000)
    expect(res.sleptMs).toBe(249_990_000)
    expect(res.suspended).toBe(true)
  })

  test('checkStreamIdleSuspend returns StreamSuspendedError on suspend and undefined on normal idle', () => {
    const idleMs = 300_000
    const suspendedErr = checkStreamIdleSuspend(
      {
        monotonicNow: () => 20_000,
        now: () => 1_000_200_000,
      },
      {
        armedAt: 0,
        wallArmedAt: 1_000_000_000,
        idleMs,
      },
    )
    expect(suspendedErr).toBeInstanceOf(StreamSuspendedError)
    expect(suspendedErr?.sleptMs).toBe(180_000)

    const normalTimeout = checkStreamIdleSuspend(
      {
        monotonicNow: () => 300_050,
        now: () => 1_000_300_050,
      },
      {
        armedAt: 0,
        wallArmedAt: 1_000_000_000,
        idleMs,
      },
    )
    expect(normalTimeout).toBeUndefined()
  })

  test('claude.ts wires checkStreamIdleSuspend into streamIdleTimer', () => {
    const src = readFileSync(
      join(import.meta.dir, '../../services/api/claude.ts'),
      'utf8',
    )
    expect(src).toContain('checkStreamIdleSuspend')
    expect(src).toContain('streamSuspendedError')
  })
})
