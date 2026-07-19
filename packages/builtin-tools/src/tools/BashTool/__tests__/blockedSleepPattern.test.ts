/**
 * densable mOg / NZn — leading sleep block residual.
 */
import { describe, expect, test } from 'bun:test'
import {
  BLOCKED_LEADING_SLEEP_MIN_SECONDS,
  detectBlockedSleepPattern,
} from '../BashTool.js'

describe('detectBlockedSleepPattern densable mOg', () => {
  test('threshold constant is densable NZn=25', () => {
    expect(BLOCKED_LEADING_SLEEP_MIN_SECONDS).toBe(25)
  })

  test('allows short sleeps under NZn', () => {
    expect(detectBlockedSleepPattern('sleep 2')).toBeNull()
    expect(detectBlockedSleepPattern('sleep 24')).toBeNull()
    expect(detectBlockedSleepPattern('sleep 0.5')).toBeNull()
  })

  test('blocks standalone sleep >= NZn', () => {
    expect(detectBlockedSleepPattern('sleep 25')).toBe('standalone sleep 25')
    expect(detectBlockedSleepPattern('sleep 30')).toBe('standalone sleep 30')
  })

  test('blocks leading sleep followed by more command', () => {
    const r = detectBlockedSleepPattern('sleep 30 && echo ready')
    expect(r).toContain('sleep 30 followed by:')
  })

  test('ignores non-leading sleep', () => {
    expect(detectBlockedSleepPattern('echo hi && sleep 30')).toBeNull()
  })
})
