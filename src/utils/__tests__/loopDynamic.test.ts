import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

/** Controllable GrowthBook stub — tests opt into jKe/YKu/Cfr via setGate. */
const growthbookGates = new Map<string, boolean>()

mock.module('src/services/analytics/growthbook.js', () => ({
  getFeatureValue_CACHED_MAY_BE_STALE: (key: string, defaultValue: unknown) =>
    growthbookGates.has(key) ? growthbookGates.get(key) : defaultValue,
  getFeatureValue_CACHED_WITH_REFRESH: (key: string, defaultValue: unknown) =>
    growthbookGates.has(key) ? growthbookGates.get(key) : defaultValue,
}))

mock.module('src/services/analytics/index.js', () => ({
  logEvent: () => {},
}))

mock.module('src/utils/debug.js', () => ({
  logForDebugging: () => {},
}))

import {
  getLoopConsecutiveKeepalives,
  getLoopEnded,
  getLoopTickInFlightPrompt,
  getSessionCronTasks,
  removeSessionCronTasks,
  setLoopConsecutiveKeepalives,
  setLoopEnded,
  setLoopTickInFlightPrompt,
} from '../../bootstrap/state.js'
import {
  LOOP_KEEPALIVE_BUDGET,
  LOOP_WAKEUP_MAX_SECONDS,
  LOOP_WAKEUP_MIN_SECONDS,
  cancelLoopWakeupsOnUserAbort,
  clampWakeupDelaySeconds,
  hasPendingLoopWakeups,
  scheduleKeepaliveWakeup,
  scheduleModelWakeup,
  settleLoopTickAfterIdle,
  snapToNextMinute,
  stopDynamicLoop,
} from '../loopDynamic.js'

function setGate(key: string, value: boolean): void {
  growthbookGates.set(key, value)
}

function clearGates(): void {
  growthbookGates.clear()
}

function resetLoopSession(): void {
  setLoopEnded(false)
  setLoopConsecutiveKeepalives(0)
  setLoopTickInFlightPrompt(null)
  const ids = getSessionCronTasks().map(t => t.id)
  if (ids.length) removeSessionCronTasks(ids)
}

describe('clampWakeupDelaySeconds', () => {
  test('clamps below min to 60', () => {
    const r = clampWakeupDelaySeconds(10, Date.now(), {
      recurringFrac: 0,
      recurringCapMs: 0,
      oneShotMaxMs: 0,
      oneShotFloorMs: 0,
      oneShotMinuteMod: 1,
      recurringMaxAgeMs: 0,
      cacheLeadMs: 0,
    })
    expect(r.clamped).toBe(LOOP_WAKEUP_MIN_SECONDS)
    expect(r.wasClamped).toBe(true)
  })

  test('clamps above max to 3600', () => {
    const r = clampWakeupDelaySeconds(99999, Date.now(), {
      recurringFrac: 0,
      recurringCapMs: 0,
      oneShotMaxMs: 0,
      oneShotFloorMs: 0,
      oneShotMinuteMod: 1,
      recurringMaxAgeMs: 0,
      cacheLeadMs: 0,
    })
    expect(r.clamped).toBe(LOOP_WAKEUP_MAX_SECONDS)
    expect(r.wasClamped).toBe(true)
  })

  test('NaN → min', () => {
    const r = clampWakeupDelaySeconds(Number.NaN, Date.now(), {
      recurringFrac: 0,
      recurringCapMs: 0,
      oneShotMaxMs: 0,
      oneShotFloorMs: 0,
      oneShotMinuteMod: 1,
      recurringMaxAgeMs: 0,
      cacheLeadMs: 0,
    })
    expect(r.clamped).toBe(LOOP_WAKEUP_MIN_SECONDS)
    expect(r.wasClamped).toBe(true)
  })
})

describe('snapToNextMinute', () => {
  test('ceils partial minute', () => {
    const base = new Date('2026-01-01T12:00:30.000Z').getTime()
    const snapped = snapToNextMinute(base)
    const d = new Date(snapped)
    expect(d.getSeconds()).toBe(0)
    expect(d.getMilliseconds()).toBe(0)
    expect(snapped).toBeGreaterThan(base)
  })
})

describe('scheduleModelWakeup / stopDynamicLoop', () => {
  beforeEach(() => {
    clearGates()
    resetLoopSession()
  })

  afterEach(() => {
    clearGates()
    resetLoopSession()
    delete process.env.CLAUDE_CODE_LOOP_KEEPALIVE
  })

  test('schedules kind:loop session cron', () => {
    const r = scheduleModelWakeup(120, 'do work', 'reason')
    expect(r).not.toBeNull()
    expect(r!.clampedDelaySeconds).toBeGreaterThanOrEqual(60)
    const loops = getSessionCronTasks().filter(t => t.kind === 'loop')
    expect(loops).toHaveLength(1)
    expect(loops[0]?.prompt).toBe('do work')
    expect(getLoopEnded()).toBe(false)
  })

  test('stopDynamicLoop cancels pending and marks ended', () => {
    scheduleModelWakeup(120, 'p', 'r')
    const n = stopDynamicLoop()
    expect(n).toBe(1)
    expect(getSessionCronTasks().filter(t => t.kind === 'loop')).toHaveLength(0)
    expect(getLoopEnded()).toBe(true)
  })

  test('second schedule supersedes prior loop wakeup', () => {
    scheduleModelWakeup(120, 'p', 'r1')
    scheduleModelWakeup(180, 'p', 'r2')
    expect(getSessionCronTasks().filter(t => t.kind === 'loop')).toHaveLength(1)
  })

  test('hasPendingLoopWakeups / cancelLoopWakeupsOnUserAbort', () => {
    expect(hasPendingLoopWakeups()).toBe(false)
    scheduleModelWakeup(120, 'p', 'r')
    expect(hasPendingLoopWakeups()).toBe(true)
    const n = cancelLoopWakeupsOnUserAbort()
    expect(n).toBe(1)
    expect(hasPendingLoopWakeups()).toBe(false)
    expect(getLoopEnded()).toBe(true)
  })

  test('cancelLoopWakeupsOnUserAbort clears in-flight only', () => {
    setLoopTickInFlightPrompt('in-flight-prompt')
    const n = cancelLoopWakeupsOnUserAbort()
    expect(n).toBe(0)
    expect(getLoopEnded()).toBe(true)
    expect(getLoopTickInFlightPrompt()).toBeNull()
  })

  test('cancelLoopWakeupsOnUserAbort remote_cancel reason still ends loop', () => {
    scheduleModelWakeup(120, 'p', 'r')
    const n = cancelLoopWakeupsOnUserAbort('remote_cancel')
    expect(n).toBe(1)
    expect(hasPendingLoopWakeups()).toBe(false)
    expect(getLoopEnded()).toBe(true)
  })

  test('scheduleKeepaliveWakeup gate_off when jKe default false', () => {
    setLoopEnded(false)
    setLoopConsecutiveKeepalives(0)
    const r = scheduleKeepaliveWakeup('p')
    expect(r).toBeNull()
    expect(getLoopEnded()).toBe(true)
  })

  test('scheduleKeepaliveWakeup arms when jKe on and budget free', () => {
    setGate('tengu_kairos_loop_dynamic', true)
    setLoopEnded(false)
    setLoopConsecutiveKeepalives(0)
    const r = scheduleKeepaliveWakeup('p')
    expect(r).not.toBeNull()
    expect(r!.clampedDelaySeconds).toBeGreaterThanOrEqual(
      LOOP_WAKEUP_MIN_SECONDS,
    )
    expect(hasPendingLoopWakeups()).toBe(true)
    expect(getLoopConsecutiveKeepalives()).toBe(1)
    expect(getLoopEnded()).toBe(false)
  })

  test('scheduleKeepaliveWakeup budget exhausted ends loop without arming', () => {
    setGate('tengu_kairos_loop_dynamic', true)
    setLoopEnded(false)
    setLoopConsecutiveKeepalives(LOOP_KEEPALIVE_BUDGET)
    const r = scheduleKeepaliveWakeup('p')
    expect(r).toBeNull()
    expect(getLoopEnded()).toBe(true)
    expect(hasPendingLoopWakeups()).toBe(false)
  })
})

describe('settleLoopTickAfterIdle (aPt + XKu harness)', () => {
  beforeEach(() => {
    clearGates()
    resetLoopSession()
    delete process.env.CLAUDE_CODE_LOOP_KEEPALIVE
  })

  afterEach(() => {
    clearGates()
    resetLoopSession()
    delete process.env.CLAUDE_CODE_LOOP_KEEPALIVE
  })

  test('no-op when aPt is empty', () => {
    const r = settleLoopTickAfterIdle()
    expect(r).toEqual({ hadInFlight: false, keepalive: undefined })
  })

  test('clears aPt when in-flight is set (YKu off)', () => {
    setLoopTickInFlightPrompt('<<autonomous-loop-dynamic>>')
    const r = settleLoopTickAfterIdle()
    expect(r.hadInFlight).toBe(true)
    expect(r.keepalive).toBeUndefined()
    expect(getLoopTickInFlightPrompt()).toBeNull()
    expect(settleLoopTickAfterIdle().hadInFlight).toBe(false)
  })

  test('does not XKu when a model wakeup is already pending', () => {
    scheduleModelWakeup(120, 'p', 'r')
    setLoopTickInFlightPrompt('p')
    // Even with YKu env on, rmt() blocks XKu
    process.env.CLAUDE_CODE_LOOP_KEEPALIVE = '1'
    setGate('tengu_kairos_loop_dynamic', true)
    const r = settleLoopTickAfterIdle()
    expect(r.hadInFlight).toBe(true)
    expect(r.keepalive).toBeUndefined()
    expect(hasPendingLoopWakeups()).toBe(true)
    // still only the model-scheduled one
    expect(getSessionCronTasks().filter(t => t.kind === 'loop')).toHaveLength(1)
  })

  test('armKeepalive:false clears aPt without XKu even when gates on', () => {
    setGate('tengu_kairos_loop_dynamic', true)
    process.env.CLAUDE_CODE_LOOP_KEEPALIVE = '1'
    setLoopTickInFlightPrompt('p')
    const r = settleLoopTickAfterIdle({ armKeepalive: false })
    expect(r.hadInFlight).toBe(true)
    expect(r.keepalive).toBeUndefined()
    expect(getLoopTickInFlightPrompt()).toBeNull()
    expect(hasPendingLoopWakeups()).toBe(false)
  })

  test('YKu+jKe on + no pending → XKu arms keepalive', () => {
    setGate('tengu_kairos_loop_dynamic', true)
    process.env.CLAUDE_CODE_LOOP_KEEPALIVE = '1'
    setLoopTickInFlightPrompt('p')
    const r = settleLoopTickAfterIdle()
    expect(r.hadInFlight).toBe(true)
    expect(r.keepalive).not.toBeNull()
    expect(r.keepalive).not.toBeUndefined()
    expect(hasPendingLoopWakeups()).toBe(true)
    expect(getLoopConsecutiveKeepalives()).toBe(1)
  })

  test('after Vwo, settle is no-op (no re-arm)', () => {
    setGate('tengu_kairos_loop_dynamic', true)
    process.env.CLAUDE_CODE_LOOP_KEEPALIVE = '1'
    scheduleModelWakeup(120, 'p', 'r')
    setLoopTickInFlightPrompt('p')
    cancelLoopWakeupsOnUserAbort('user_abort')
    expect(getLoopTickInFlightPrompt()).toBeNull()
    expect(hasPendingLoopWakeups()).toBe(false)
    const r = settleLoopTickAfterIdle()
    expect(r).toEqual({ hadInFlight: false, keepalive: undefined })
    expect(hasPendingLoopWakeups()).toBe(false)
  })

  test('keepalive budget exhausted via settle ends loop', () => {
    setGate('tengu_kairos_loop_dynamic', true)
    process.env.CLAUDE_CODE_LOOP_KEEPALIVE = '1'
    setLoopConsecutiveKeepalives(LOOP_KEEPALIVE_BUDGET)
    setLoopTickInFlightPrompt('p')
    const r = settleLoopTickAfterIdle()
    expect(r.hadInFlight).toBe(true)
    expect(r.keepalive).toBeNull()
    expect(getLoopEnded()).toBe(true)
    expect(hasPendingLoopWakeups()).toBe(false)
  })
})
