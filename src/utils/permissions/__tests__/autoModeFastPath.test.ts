/**
 * Official 2.1.207: auto-mode fast-path exclude (cDg) + allowlist (ZHg/NDu).
 *
 * cDg = Agent / CronCreate / RemoteTrigger / ScheduleWakeup
 *   (+ optional SPAWN_LOCAL / REQUEUE_SESSION — absent in this fork)
 * acceptEdits fast path: !isAutoModeFastPathExcludedTool
 * allowlist: Agent must not be in SAFE set (207 NDu has no re-check; fork
 *   additionally guards exclusion on allowlist for defense-in-depth)
 */
import { describe, expect, test } from 'bun:test'
import {
  isAutoModeAllowlistedTool,
  isAutoModeFastPathExcludedTool,
} from '../classifierDecision.js'

describe('isAutoModeFastPathExcludedTool (cDg)', () => {
  test('excludes Agent / CronCreate / RemoteTrigger / ScheduleWakeup', () => {
    expect(isAutoModeFastPathExcludedTool('Agent')).toBe(true)
    expect(isAutoModeFastPathExcludedTool('CronCreate')).toBe(true)
    expect(isAutoModeFastPathExcludedTool('RemoteTrigger')).toBe(true)
    expect(isAutoModeFastPathExcludedTool('ScheduleWakeup')).toBe(true)
  })

  test('does not exclude Read / Bash / CronList / Edit', () => {
    expect(isAutoModeFastPathExcludedTool('Read')).toBe(false)
    expect(isAutoModeFastPathExcludedTool('Bash')).toBe(false)
    expect(isAutoModeFastPathExcludedTool('CronList')).toBe(false)
    expect(isAutoModeFastPathExcludedTool('Edit')).toBe(false)
  })
})

describe('isAutoModeAllowlistedTool (ZHg/NDu name half)', () => {
  test('includes Read / Grep / Glob', () => {
    expect(isAutoModeAllowlistedTool('Read')).toBe(true)
    expect(isAutoModeAllowlistedTool('Grep')).toBe(true)
    expect(isAutoModeAllowlistedTool('Glob')).toBe(true)
  })

  test('does not include Bash / Edit / Write', () => {
    expect(isAutoModeAllowlistedTool('Bash')).toBe(false)
    expect(isAutoModeAllowlistedTool('Edit')).toBe(false)
    expect(isAutoModeAllowlistedTool('Write')).toBe(false)
  })

  test('Agent is never allowlisted (must hit classifier)', () => {
    expect(isAutoModeAllowlistedTool('Agent')).toBe(false)
    expect(isAutoModeAllowlistedTool('CronCreate')).toBe(false)
    expect(isAutoModeAllowlistedTool('RemoteTrigger')).toBe(false)
    expect(isAutoModeAllowlistedTool('ScheduleWakeup')).toBe(false)
  })
})

describe('Agent fast-path invariant vs 207', () => {
  test('excluded tools cannot pass either pure fast-path gate', () => {
    for (const name of [
      'Agent',
      'CronCreate',
      'RemoteTrigger',
      'ScheduleWakeup',
    ]) {
      // acceptEdits path gates on exclusion first
      expect(isAutoModeFastPathExcludedTool(name)).toBe(true)
      // allowlist path: tool is not safe-allowlisted either
      expect(isAutoModeAllowlistedTool(name)).toBe(false)
    }
  })

  test('Read can use allowlist fast path and is not excluded', () => {
    expect(isAutoModeFastPathExcludedTool('Read')).toBe(false)
    expect(isAutoModeAllowlistedTool('Read')).toBe(true)
  })
})
