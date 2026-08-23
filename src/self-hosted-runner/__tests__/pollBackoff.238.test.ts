/**
 * densable 2.1.238 #10 Zdu/w5y/E5y — pollWork HTTP timeout 10s + timeout/transport
 * exponential backoff + 5xx lease clamp. Does **not** invent warmup_complete.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'bun:test'
import { POLL_WORK_TIMEOUT_MS } from '../runnerApi.js'
import {
  POLL_5XX_LEASE_FLOOR_MS,
  POLL_ERROR_RETRY_MS,
  POLL_LEASE_SAFETY_PAD_MS,
  POLL_TIMEOUT_BACKOFF_BASE_MS,
  POLL_TIMEOUT_BACKOFF_CAP_MS,
  clampPollDelayToLease,
  timeoutTransportBackoffMs,
} from '../rootRunner.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')

describe('densable 2.1.238 #10 Zdu poll timeout', () => {
  test('Zdu pollWork timeout is 10_000 (not 30s)', () => {
    expect(POLL_WORK_TIMEOUT_MS).toBe(10_000)
    const src = readFileSync(
      join(ROOT, 'self-hosted-runner/runnerApi.ts'),
      'utf8',
    )
    expect(src).toContain('timeout: POLL_WORK_TIMEOUT_MS')
    expect(src).not.toMatch(/pollWork[\s\S]{0,400}timeout:\s*30_000/)
  })
})

describe('densable 2.1.238 #10 w5y timeout/transport backoff', () => {
  test('constants match SEA i5y/SoC/voC/ToC', () => {
    expect(POLL_TIMEOUT_BACKOFF_BASE_MS).toBe(2_000)
    expect(POLL_TIMEOUT_BACKOFF_CAP_MS).toBe(20_000)
    expect(POLL_TIMEOUT_BACKOFF_CAP_MS).toBe(POLL_ERROR_RETRY_MS)
    expect(POLL_LEASE_SAFETY_PAD_MS).toBe(12_000)
    expect(POLL_5XX_LEASE_FLOOR_MS).toBe(5_000)
  })

  test('attempt=1 is ~1–2s (half-jitter of 2s cap, no lease)', () => {
    const lo = timeoutTransportBackoffMs(1, undefined, Date.now(), () => 0)
    const hi = timeoutTransportBackoffMs(
      1,
      undefined,
      Date.now(),
      () => 0.999999,
    )
    expect(lo).toBe(1_000)
    expect(hi).toBeGreaterThanOrEqual(1_000)
    expect(hi).toBeLessThanOrEqual(2_000)
  })

  test('attempt grows exponentially then caps at SoC=20s', () => {
    const a4 = timeoutTransportBackoffMs(4, undefined, Date.now(), () => 1)
    // cap = min(20000, 2000 * 2^3) = 16000; random=1 → 16000
    expect(a4).toBe(16_000)
    const a10 = timeoutTransportBackoffMs(10, undefined, Date.now(), () => 1)
    expect(a10).toBe(POLL_TIMEOUT_BACKOFF_CAP_MS)
  })
})

describe('densable 2.1.238 #10 E5y lease clamp', () => {
  test('no / invalid lease leaves delay unchanged', () => {
    expect(clampPollDelayToLease(20_000, undefined, 5_000, 0)).toBe(20_000)
    expect(clampPollDelayToLease(20_000, 'not-a-date', 5_000, 0)).toBe(20_000)
  })

  test('clamps to max(floor, remaining - voC)', () => {
    const now = 1_000_000
    const lease = new Date(now + 20_000).toISOString()
    // remaining=20000, pad=12000 → 8000; floor=5000 → min(20000, 8000)=8000
    expect(clampPollDelayToLease(20_000, lease, 5_000, now)).toBe(8_000)
  })

  test('5xx floor ToC=5000 when remaining-pad is smaller', () => {
    const now = 1_000_000
    const lease = new Date(now + 13_000).toISOString()
    // remaining=13000, pad=12000 → 1000; floor=5000 → 5000
    expect(
      clampPollDelayToLease(20_000, lease, POLL_5XX_LEASE_FLOOR_MS, now),
    ).toBe(5_000)
  })

  test('w5y also clamps through E5y with i5y floor', () => {
    const now = 1_000_000
    const lease = new Date(now + 13_000).toISOString()
    // jittered attempt=1 random=1 → 2000; remaining-pad=1000; floor=2000 → 2000
    expect(timeoutTransportBackoffMs(1, lease, now, () => 1)).toBe(2_000)
  })

  test('poll loop source gold: 404 does not reset consecutiveTimeout; no warmup_complete', () => {
    const src = readFileSync(
      join(ROOT, 'self-hosted-runner/rootRunner.ts'),
      'utf8',
    )
    expect(src).toContain('consecutiveTimeout++')
    expect(src).toContain('timeoutTransportBackoffMs(')
    expect(src).toContain('clampPollDelayToLease(')
    expect(src).toContain('POLL_5XX_LEASE_FLOOR_MS')
    expect(src).not.toContain('warmup_complete')
  })
})
