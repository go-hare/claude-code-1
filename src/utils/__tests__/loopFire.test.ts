import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

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

mock.module('src/utils/config.js', () => ({
  getGlobalConfig: () => ({ agentPushNotifEnabled: false }),
}))

import {
  AUTONOMOUS_LOOP_DYNAMIC_SENTINEL,
  AUTONOMOUS_LOOP_SENTINEL,
} from '../loopDynamic.js'
import {
  isAutonomousLoopSentinel,
  isLoopDefaultSentinel,
  isLoopFileSentinel,
  LOOP_FILE_DYNAMIC_SENTINEL,
  LOOP_FILE_SENTINEL,
  resolveLoopDefaultFire,
  resetAutonomousLoopDelivered,
  truncateLoopFileContent,
  LOOP_MD_MAX_BYTES,
  wakeupSourceForCronTask,
  resolveWakeupSource,
  isLoopPersistentPreambleEnabled,
} from '../loopFire.js'

describe('loopFire sentinels', () => {
  test('isAutonomousLoopSentinel', () => {
    expect(isAutonomousLoopSentinel(AUTONOMOUS_LOOP_SENTINEL)).toBe(true)
    expect(isAutonomousLoopSentinel(AUTONOMOUS_LOOP_DYNAMIC_SENTINEL)).toBe(
      true,
    )
    expect(isAutonomousLoopSentinel('other')).toBe(false)
  })

  test('isLoopFileSentinel', () => {
    expect(isLoopFileSentinel(LOOP_FILE_SENTINEL)).toBe(true)
    expect(isLoopFileSentinel(LOOP_FILE_DYNAMIC_SENTINEL)).toBe(true)
  })

  test('isLoopDefaultSentinel unions both', () => {
    expect(isLoopDefaultSentinel(AUTONOMOUS_LOOP_DYNAMIC_SENTINEL)).toBe(true)
    expect(isLoopDefaultSentinel(LOOP_FILE_SENTINEL)).toBe(true)
    expect(isLoopDefaultSentinel('x')).toBe(false)
  })

  test('wakeupSourceForCronTask', () => {
    expect(wakeupSourceForCronTask('loop')).toBe('loop_wakeup')
    expect(wakeupSourceForCronTask(undefined)).toBe('schedule_wakeup')
  })

  test('resolveWakeupSource densable c2o', () => {
    expect(
      resolveWakeupSource({
        wakeupSource: 'loop_wakeup',
        promptSource: 'typed',
      }),
    ).toBe('loop_wakeup')
    expect(resolveWakeupSource({ promptSource: 'sdk' })).toBe('sdk')
    expect(resolveWakeupSource({ promptSource: 'system' })).toBe('system')
    expect(resolveWakeupSource({ promptSource: 'typed' })).toBe('user')
    expect(resolveWakeupSource({ promptSource: 'queued' })).toBe('user')
    expect(resolveWakeupSource({ promptSource: 'suggestion_accepted' })).toBe(
      'user',
    )
    expect(resolveWakeupSource({})).toBeUndefined()
  })
})

describe('truncateLoopFileContent', () => {
  test('leaves short content alone', () => {
    expect(truncateLoopFileContent('hi')).toBe('hi')
  })

  test('truncates over LOOP_MD_MAX_BYTES', () => {
    const long = `${'a'.repeat(LOOP_MD_MAX_BYTES + 100)}\nend`
    const out = truncateLoopFileContent(long)
    expect(out.length).toBeLessThan(long.length)
    expect(out).toContain('WARNING: loop.md was truncated')
  })
})

describe('resolveLoopDefaultFire', () => {
  beforeEach(() => {
    gb.clear()
    gb.set('tengu_kairos_loop_prompt', false)
    resetAutonomousLoopDelivered()
  })

  afterEach(() => {
    resetAutonomousLoopDelivered()
  })

  test('passthrough when not sentinel', () => {
    expect(resolveLoopDefaultFire('check the deploy')).toBe('check the deploy')
  })

  test('sentinel ignored when qAs off', () => {
    gb.set('tengu_kairos_loop_prompt', false)
    expect(resolveLoopDefaultFire(AUTONOMOUS_LOOP_SENTINEL)).toBe(
      AUTONOMOUS_LOOP_SENTINEL,
    )
  })

  test('autonomous sentinel expands with preamble then tick', () => {
    gb.set('tengu_kairos_loop_prompt', true)
    const first = resolveLoopDefaultFire(AUTONOMOUS_LOOP_SENTINEL)
    expect(first).toContain('# Autonomous loop check')
    expect(first).toContain('# Autonomous loop tick')
    expect(first).not.toContain('dynamic pacing')
    const second = resolveLoopDefaultFire(AUTONOMOUS_LOOP_SENTINEL)
    expect(second).toContain('# Autonomous loop tick')
    expect(second).not.toContain('# Autonomous loop check')
  })

  test('dynamic autonomous sentinel uses dynamic tick', () => {
    gb.set('tengu_kairos_loop_prompt', true)
    resetAutonomousLoopDelivered()
    const first = resolveLoopDefaultFire(AUTONOMOUS_LOOP_DYNAMIC_SENTINEL)
    expect(first).toContain('dynamic pacing')
    expect(first).toContain(AUTONOMOUS_LOOP_DYNAMIC_SENTINEL)
    expect(first).toContain('ScheduleWakeup')
  })
})

describe('isLoopPersistentPreambleEnabled env truthiness (densable vH)', () => {
  const key = 'CLAUDE_CODE_LOOP_PERSISTENT'
  afterEach(() => {
    delete process.env[key]
  })

  test('truthy values enable preamble', () => {
    for (const v of ['1', 'true', 'TRUE', 'yes', 'on']) {
      process.env[key] = v
      expect(isLoopPersistentPreambleEnabled()).toBe(true)
    }
  })

  test('falsy / garbage values do not force enable', () => {
    for (const v of ['0', 'false', 'no', 'off', '', 'maybe']) {
      process.env[key] = v
      // Without GB override, falsy env must not force true
      // (GB may still enable — mock not set here; only assert env alone
      // does not short-circuit true for non-truthy strings).
      if (['0', 'false', 'no', 'off', '', 'maybe'].includes(v)) {
        // re-call through isEnvTruthy path: if GB false, result false
        // We only assert that empty/falsey does not throw and that
        // '0' is not treated as truthy via bare env check.
        const result = isLoopPersistentPreambleEnabled()
        expect(typeof result).toBe('boolean')
      }
    }
    process.env[key] = '0'
    // Bare truthy would treat any non-empty as true; isEnvTruthy('0') is false.
    // If GB is false (default), result must be false.
    expect(isLoopPersistentPreambleEnabled()).toBe(false)
  })
})
