import { describe, expect, test } from 'bun:test'
import {
  ADVISOR_STALL_GRACE_CAP_MS,
  ADVISOR_STALL_POLL_MS,
  decideAdvisorNetworkStallPoll,
  remainingRetryMs,
  resolveAdvisorStallGraceMs,
} from '../advisorNetworkStall.js'

describe('resolveAdvisorStallGraceMs (densable dt/Gt)', () => {
  test('dt is min(byte, stream) when watchdog on', () => {
    const { dt, graceMs } = resolveAdvisorStallGraceMs({
      byteIdleTimeoutMs: 180_000,
      streamWatchdogEnabled: true,
      streamIdleTimeoutMs: 300_000,
    })
    expect(dt).toBe(180_000)
    // Gt = min(90000, 180000-20000) = 90000
    expect(graceMs).toBe(ADVISOR_STALL_GRACE_CAP_MS)
  })

  test('dt ignores stream floor when watchdog off', () => {
    const { dt, graceMs } = resolveAdvisorStallGraceMs({
      byteIdleTimeoutMs: 60_000,
      streamWatchdogEnabled: false,
      streamIdleTimeoutMs: 300_000,
    })
    expect(dt).toBe(60_000)
    // min(90000, 60000-20000) = 40000
    expect(graceMs).toBe(40_000)
  })

  test('poll and cap constants match densable Avs/gSy', () => {
    expect(ADVISOR_STALL_POLL_MS).toBe(20_000)
    expect(ADVISOR_STALL_GRACE_CAP_MS).toBe(90_000)
  })
})

describe('decideAdvisorNetworkStallPoll', () => {
  const base = {
    streamStartedAt: 1_000,
    now: 25_000,
    wallNow: 1_700_000_000_000,
    graceMs: 90_000,
    dt: 180_000,
  }

  test('reschedules when lastAt advanced', () => {
    const d = decideAdvisorNetworkStallPoll({
      ...base,
      lastAtAtSchedule: 10_000,
      lastAtNow: 12_000,
      isAdvisorInProgress: false,
    })
    expect(d).toEqual({ action: 'reschedule' })
  })

  test('advisor in progress within grace suppresses stalled UI', () => {
    // idle = now - lastAt = 25000 - 20000 = 5000 < 90000
    const d = decideAdvisorNetworkStallPoll({
      ...base,
      lastAtAtSchedule: 20_000,
      lastAtNow: 20_000,
      isAdvisorInProgress: true,
    })
    expect(d).toEqual({ action: 'reschedule' })
  })

  test('advisor past grace surfaces stalled with deadline', () => {
    // idle = 25000 - 1000 = 24000; grace 20_000 → stalled
    const d = decideAdvisorNetworkStallPoll({
      ...base,
      lastAtAtSchedule: 1_000,
      lastAtNow: 1_000,
      isAdvisorInProgress: true,
      graceMs: 20_000,
      dt: 180_000,
      now: 25_000,
    })
    expect(d.action).toBe('stalled')
    if (d.action === 'stalled') {
      expect(d.status.kind).toBe('stalled')
      // Ss = 24000; deadline = wall + max(0, 180000-24000)
      expect(d.status.deadline).toBe(base.wallNow + 156_000)
    }
  })

  test('non-advisor silence surfaces stalled even under grace window', () => {
    const d = decideAdvisorNetworkStallPoll({
      ...base,
      lastAtAtSchedule: 20_000,
      lastAtNow: 20_000,
      isAdvisorInProgress: false,
      now: 25_000, // idle 5s
      graceMs: 90_000,
    })
    expect(d.action).toBe('stalled')
  })

  test('lastAt===0 uses streamStartedAt for Ss', () => {
    const d = decideAdvisorNetworkStallPoll({
      ...base,
      lastAtAtSchedule: 0,
      lastAtNow: 0,
      streamStartedAt: 1_000,
      now: 31_000,
      isAdvisorInProgress: false,
      dt: 100_000,
    })
    expect(d.action).toBe('stalled')
    if (d.action === 'stalled') {
      // Ss = 30000; deadline = wall + 70000
      expect(d.status.deadline).toBe(base.wallNow + 70_000)
    }
  })
})

describe('remainingRetryMs', () => {
  test('ceil to whole seconds then *1000', () => {
    const now = 1_000_000
    expect(remainingRetryMs(now + 1500, now)).toBe(2000)
    expect(remainingRetryMs(now + 999, now)).toBe(1000)
    expect(remainingRetryMs(now - 100, now)).toBe(0)
  })
})
