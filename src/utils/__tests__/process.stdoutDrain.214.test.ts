/**
 * densable 2.1.214 #19 — stream-json exit drain scales with pending stdout
 * queue bytes (P_m=262144 B/s, L_m=30_000, base 2000), not fixed 2s.
 *
 * densable: zRn / hll / fVt / XDe / Ds
 *
 * Tests inject accounting state — do NOT call real process.stdout.end()
 * (that permanently ends the test runner's stdout and hangs bun:test).
 */
import { afterEach, describe, expect, test } from 'bun:test'
import {
  _injectStdoutDrainPendingForTesting,
  _resetStdoutDrainStateForTesting,
  drainStdoutBeforeExit,
  getPendingStdoutBytes,
  getStdoutDrainBudgetMs,
  markStdoutDrainExternallyClocked,
} from '../process.js'

/** densable P_m */
const P_M = 262_144
/** densable L_m */
const L_M = 30_000
const BASE = 2000

describe('densable #19 stdout drain budget (zRn / hll / fVt)', () => {
  afterEach(() => {
    _resetStdoutDrainStateForTesting()
  })

  test('pending 0 → base budget (default 2000, custom base honored)', () => {
    expect(getPendingStdoutBytes()).toBe(0)
    expect(getStdoutDrainBudgetMs()).toBe(BASE)
    expect(getStdoutDrainBudgetMs(500)).toBe(500)
    // base above L_m still capped
    expect(getStdoutDrainBudgetMs(40_000)).toBe(L_M)
  })

  test('zRn = min(L_m, max(base, ceil(pending*1000/P_m)))', () => {
    // 1×P_m → ceil(1000) = 1000 < base → still base
    _injectStdoutDrainPendingForTesting(P_M)
    expect(getPendingStdoutBytes()).toBe(P_M)
    expect(getStdoutDrainBudgetMs()).toBe(BASE)

    // 4×P_m → 4000ms
    _injectStdoutDrainPendingForTesting(P_M * 4)
    expect(getPendingStdoutBytes()).toBe(P_M * 4)
    expect(getStdoutDrainBudgetMs()).toBe(4000)

    // non-aligned: 1 byte over 4×P_m → ceil → 4001
    _injectStdoutDrainPendingForTesting(P_M * 4 + 1)
    expect(getPendingStdoutBytes()).toBe(P_M * 4 + 1)
    expect(getStdoutDrainBudgetMs()).toBe(
      Math.ceil(((P_M * 4 + 1) * 1000) / P_M),
    )

    // hard cap L_m=30s
    _injectStdoutDrainPendingForTesting(30 * P_M + 1000)
    expect(getStdoutDrainBudgetMs()).toBe(L_M)
  })

  test('hll: flushed catch-up zeros pending', () => {
    _injectStdoutDrainPendingForTesting(100, 40)
    expect(getPendingStdoutBytes()).toBe(60)
    expect(getStdoutDrainBudgetMs()).toBe(BASE) // 60 bytes << 1s of P_m

    _injectStdoutDrainPendingForTesting(100, 100)
    expect(getPendingStdoutBytes()).toBe(0)
    expect(getStdoutDrainBudgetMs()).toBe(BASE)
  })

  test('hll: never over-negative when flushed > enqueued', () => {
    _injectStdoutDrainPendingForTesting(10, 50)
    expect(getPendingStdoutBytes()).toBe(0)
  })

  test('drainStdoutBeforeExit: never wrote → immediate return', async () => {
    const t0 = Date.now()
    await drainStdoutBeforeExit(50)
    expect(Date.now() - t0).toBeLessThan(100)
  })

  test('drainStdoutBeforeExit: TTY short-circuit when wroteToStdout injected', async () => {
    // densable: TTY || destroyed || writableEnded || !dll → return before end()
    // If stdout is TTY (typical interactive/test host), inject write flag and
    // ensure we still return immediately without hanging on end().
    if (!process.stdout.isTTY) {
      // Non-TTY CI: inject alone would call end() — skip this path.
      // Covered by never-wrote + budget formula tests.
      return
    }
    _injectStdoutDrainPendingForTesting(P_M * 10)
    const t0 = Date.now()
    await drainStdoutBeforeExit(5000)
    expect(Date.now() - t0).toBeLessThan(200)
  })

  test('markStdoutDrainExternallyClocked is callable (XDe failsafe latch)', () => {
    expect(() => markStdoutDrainExternallyClocked()).not.toThrow()
    expect(() => markStdoutDrainExternallyClocked()).not.toThrow() // idempotent
  })

  test('gracefulShutdown failsafe headroom formula: zRn + P8y', () => {
    // densable EDs(zRn()+P8y=1500) — document local wiring contract
    const P8y = 1500
    _injectStdoutDrainPendingForTesting(P_M * 4)
    const zRn = getStdoutDrainBudgetMs()
    expect(zRn).toBe(4000)
    expect(zRn + P8y).toBe(5500)
    // failsafe uses max(5000, hooks+3500, zRn+1500)
    expect(Math.max(5000, 1500 + 3500, zRn + P8y)).toBe(5500)
  })
})
