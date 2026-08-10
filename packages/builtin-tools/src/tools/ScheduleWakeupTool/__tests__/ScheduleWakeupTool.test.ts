import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

// Mutable GrowthBook values for jKe / Cfr
const gb = new Map<string, unknown>()

mock.module('src/services/analytics/growthbook.js', () => ({
  getFeatureValue_CACHED_MAY_BE_STALE: (key: string, defaultValue: unknown) =>
    gb.has(key) ? gb.get(key) : defaultValue,
  getFeatureValue_CACHED_WITH_REFRESH: (key: string, defaultValue: unknown) =>
    gb.has(key) ? gb.get(key) : defaultValue,
}))

mock.module('src/services/analytics/index.js', () => ({
  logEvent: () => {},
}))

mock.module('src/utils/debug.js', () => ({
  logForDebugging: () => {},
}))

mock.module('src/utils/auth.js', () => ({
  isClaudeAISubscriber: () => false,
}))

import {
  addSessionCronTask,
  getSessionCronTasks,
  removeSessionCronTasks,
  setLoopEnded,
} from 'src/bootstrap/state.js'
import {
  ScheduleWakeupInputError,
  ScheduleWakeupTool,
} from '../ScheduleWakeupTool.js'

describe('ScheduleWakeupTool', () => {
  beforeEach(() => {
    gb.clear()
    // densable jKe default false
    gb.set('tengu_kairos_loop_dynamic', false)
    gb.set('tengu_loop_noop_fold', false)
    setLoopEnded(false)
    const ids = getSessionCronTasks().map(t => t.id)
    if (ids.length) removeSessionCronTasks(ids)
  })

  afterEach(() => {
    const ids = getSessionCronTasks().map(t => t.id)
    if (ids.length) removeSessionCronTasks(ids)
  })

  test('name is ScheduleWakeup and shouldDefer is true', () => {
    expect(ScheduleWakeupTool.name).toBe('ScheduleWakeup')
    expect(ScheduleWakeupTool.shouldDefer).toBe(true)
    expect(ScheduleWakeupTool.userFacingName()).toBe('')
  })

  test('stop:true cancels pending loop wakeups and returns stopped', async () => {
    addSessionCronTask({
      id: 'loop1',
      cron: '0 0 * * *',
      prompt: 'p',
      createdAt: Date.now(),
      kind: 'loop',
    })
    addSessionCronTask({
      id: 'cron1',
      cron: '0 0 * * *',
      prompt: 'other',
      createdAt: Date.now(),
    })
    const result = await ScheduleWakeupTool.call({ stop: true } as never)
    expect(result.data.stopped).toBe(true)
    expect(result.data.cancelledWakeups).toBe(1)
    expect(result.data.scheduledFor).toBe(0)
    // non-loop cron untouched
    expect(getSessionCronTasks().map(t => t.id)).toEqual(['cron1'])
  })

  test('rejects missing delaySeconds/reason when not stop', async () => {
    await expect(
      ScheduleWakeupTool.call({ prompt: 'x' } as never),
    ).rejects.toMatchObject({ name: 'ScheduleWakeupInputError' })
  })

  test('rejects missing prompt when not stop', async () => {
    await expect(
      ScheduleWakeupTool.call({ delaySeconds: 120, reason: 'r' } as never),
    ).rejects.toBeInstanceOf(ScheduleWakeupInputError)
  })

  test('gate_off when jKe false — zeros and no schedule', async () => {
    gb.set('tengu_kairos_loop_dynamic', false)
    const result = await ScheduleWakeupTool.call({
      delaySeconds: 120,
      reason: 'watch CI',
      prompt: 'check CI',
    } as never)
    expect(result.data).toEqual({
      scheduledFor: 0,
      clampedDelaySeconds: 0,
      wasClamped: false,
    })
    expect(getSessionCronTasks().filter(t => t.kind === 'loop')).toHaveLength(0)
  })

  test('schedules loop wakeup when jKe true', async () => {
    gb.set('tengu_kairos_loop_dynamic', true)
    const result = await ScheduleWakeupTool.call({
      delaySeconds: 120,
      reason: 'watch CI',
      prompt: 'check CI',
    } as never)
    expect(result.data.scheduledFor).toBeGreaterThan(Date.now())
    expect(result.data.clampedDelaySeconds).toBeGreaterThanOrEqual(60)
    expect(result.data.clampedDelaySeconds).toBeLessThanOrEqual(3600)
    const loops = getSessionCronTasks().filter(t => t.kind === 'loop')
    expect(loops).toHaveLength(1)
    expect(loops[0]?.prompt).toBe('check CI')
  })

  test('clamps delaySeconds outside [60,3600]', async () => {
    gb.set('tengu_kairos_loop_dynamic', true)
    const result = await ScheduleWakeupTool.call({
      delaySeconds: 10,
      reason: 'too short',
      prompt: 'p',
    } as never)
    expect(result.data.wasClamped).toBe(true)
    expect(result.data.clampedDelaySeconds).toBe(60)
  })

  test('mapToolResult stop with zero cancelled mentions CronDelete', () => {
    const block = ScheduleWakeupTool.mapToolResultToToolResultBlockParam(
      {
        scheduledFor: 0,
        clampedDelaySeconds: 0,
        wasClamped: false,
        stopped: true,
        cancelledWakeups: 0,
      },
      'tu1',
    )
    expect(block.content).toContain('CronDelete')
    expect(block.content).toContain('Loop stopped')
    expect(block.content).toContain('Monitor')
    expect(block.content).toContain('TaskStop')
  })

  test('mapToolResult scheduled message includes time', () => {
    const scheduledFor = Date.now() + 120_000
    const block = ScheduleWakeupTool.mapToolResultToToolResultBlockParam(
      {
        scheduledFor,
        clampedDelaySeconds: 120,
        wasClamped: false,
      },
      'tu2',
    )
    expect(String(block.content)).toMatch(/Next wakeup scheduled for /)
  })

  test('mapToolResult gate_off / aged_out zeros', () => {
    const block = ScheduleWakeupTool.mapToolResultToToolResultBlockParam(
      {
        scheduledFor: 0,
        clampedDelaySeconds: 0,
        wasClamped: false,
      },
      'tu3',
    )
    expect(block.content).toContain('Wakeup not scheduled')
  })

  test('checkPermissions auto → passthrough', async () => {
    const result = await ScheduleWakeupTool.checkPermissions!({ stop: true }, {
      getAppState: () => ({
        toolPermissionContext: { mode: 'auto' },
      }),
    } as never)
    expect(result.behavior).toBe('passthrough')
  })

  test('checkPermissions non-auto → allow', async () => {
    const result = await ScheduleWakeupTool.checkPermissions!({ stop: true }, {
      getAppState: () => ({
        toolPermissionContext: { mode: 'default' },
      }),
    } as never)
    expect(result.behavior).toBe('allow')
  })

  test('toAutoClassifierInput stop branch', () => {
    expect(ScheduleWakeupTool.toAutoClassifierInput!({ stop: true })).toContain(
      'stop the /loop',
    )
  })
})
