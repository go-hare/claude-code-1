import { describe, expect, test } from 'bun:test'
import {
  isUnnamedPluginScheduleRefused,
  ScheduleWakeupInputError,
  ScheduleWakeupTool,
  UNNAMED_PLUGIN_SCHEDULE_REFUSAL,
} from '../ScheduleWakeupTool.js'

describe('v2.1.290 #82: ScheduleWakeup unnamed plugin guard', () => {
  test('isUnnamedPluginScheduleRefused returns false when hookCaller is set or pluginUnnamed is false', () => {
    expect(isUnnamedPluginScheduleRefused(undefined)).toBe(false)
    expect(
      isUnnamedPluginScheduleRefused({
        hookCaller: 'acme',
        pluginUnnamed: true,
      }),
    ).toBe(false)
    expect(
      isUnnamedPluginScheduleRefused({
        pluginUnnamed: false,
      }),
    ).toBe(false)
  })

  test('ScheduleWakeupInputError and UNNAMED_PLUGIN_SCHEDULE_REFUSAL match gold copy', () => {
    expect(UNNAMED_PLUGIN_SCHEDULE_REFUSAL).toContain(
      'A plugin started or resumed this subagent',
    )
    expect(ScheduleWakeupTool.name).toBe('ScheduleWakeup')
    expect(new ScheduleWakeupInputError('test').name).toBe(
      'ScheduleWakeupInputError',
    )
  })
})
