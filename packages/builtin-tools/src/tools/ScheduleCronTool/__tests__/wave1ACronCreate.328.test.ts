import { afterEach, describe, expect, test } from 'bun:test'
import { listAllCronTasks, removeCronTasks } from 'src/utils/cronTasks.js'
import {
  getLoadedFunctionHooksModules,
  setLoadedFunctionHooksModules,
} from 'src/utils/plugins/functionHooksModules.js'
import { getPluginHookRegistration } from 'src/utils/plugins/loadPluginHooks.js'
import {
  CronCreateTool,
  formatCronNextRunTime,
  isUnnamedPluginScheduleRefused,
  resolveCronPluginProvenance,
  UNNAMED_PLUGIN_SCHEDULE_REFUSED_MESSAGE,
} from '../CronCreateTool.js'

const prevLoadedModules = [...getLoadedFunctionHooksModules()]
const createdTaskIds: string[] = []

afterEach(async () => {
  setLoadedFunctionHooksModules([...prevLoadedModules])
  getPluginHookRegistration().hookRegistrationInFlight = undefined
  if (createdTaskIds.length > 0) {
    await removeCronTasks([...createdTaskIds])
    createdTaskIds.length = 0
  }
})

describe('Wave 1A CronCreateTool Parity (P2-#11)', () => {
  test('validateInput refuses unnamed plugin subagent schedules with errorCode 5 when non-builtin mods are loaded or registration is in flight', async () => {
    // No non-builtin mods and no registration in flight -> allowed
    setLoadedFunctionHooksModules([])
    expect(isUnnamedPluginScheduleRefused({ pluginUnnamed: true })).toBe(false)

    // With a non-builtin plugin module loaded -> refused with errorCode: 5
    setLoadedFunctionHooksModules([
      { name: 'third-party-mod', patterns: ['classic.Stop'], tier: 'user' },
    ])
    expect(isUnnamedPluginScheduleRefused({ pluginUnnamed: true })).toBe(true)
    // Named hookCaller is NOT refused
    expect(
      isUnnamedPluginScheduleRefused({
        pluginUnnamed: true,
        hookCaller: 'third-party-mod',
      }),
    ).toBe(false)

    const validation = await CronCreateTool.validateInput!(
      { cron: '*/5 * * * *', prompt: 'check status' },
      { pluginUnnamed: true } as never,
    )
    expect(validation).toEqual({
      result: false,
      message: UNNAMED_PLUGIN_SCHEDULE_REFUSED_MESSAGE,
      errorCode: 5,
    })

    // Also refused when hookRegistrationInFlight is active even if no mods loaded yet
    setLoadedFunctionHooksModules([])
    getPluginHookRegistration().hookRegistrationInFlight = Promise.resolve()
    expect(isUnnamedPluginScheduleRefused({ pluginUnnamed: true })).toBe(true)
  })

  test('call forwards plugin provenance to addCronTask (hookCaller unless hookServesModel)', async () => {
    expect(resolveCronPluginProvenance({ hookCaller: 'acme-plugin' })).toBe(
      'acme-plugin',
    )
    expect(
      resolveCronPluginProvenance({
        hookCaller: 'acme-plugin',
        hookServesModel: true,
      }),
    ).toBeUndefined()

    const out = await CronCreateTool.call(
      { cron: '*/5 * * * *', prompt: 'ping', recurring: true, durable: false },
      { hookCaller: 'acme-plugin' } as never,
    )
    createdTaskIds.push(out.data.id)
    const tasks = await listAllCronTasks()
    const saved = tasks.find(t => t.id === out.data.id)
    expect(saved?.plugin).toBe('acme-plugin')
  })

  test('mapToolResultToToolResultBlockParam includes Next run when nextFireAt is present and omits when undefined', () => {
    const sampleMs = new Date(2026, 3, 15, 14, 30, 0).getTime()
    const expectedLabel = formatCronNextRunTime(sampleMs)

    const recurringWithNext =
      CronCreateTool.mapToolResultToToolResultBlockParam(
        {
          id: 'abc12345',
          humanSchedule: 'Every 5 minutes',
          recurring: true,
          durable: false,
          nextFireAt: sampleMs,
        },
        'tu-cron-1',
      )
    expect(recurringWithNext.content).toContain(`Next run: ${expectedLabel}.`)

    const oneShotWithoutNext =
      CronCreateTool.mapToolResultToToolResultBlockParam(
        {
          id: 'def67890',
          humanSchedule: 'At 2:30 PM',
          recurring: false,
          durable: true,
        },
        'tu-cron-2',
      )
    expect(oneShotWithoutNext.content).not.toContain('Next run:')
  })
})
