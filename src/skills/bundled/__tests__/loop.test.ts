import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from 'bun:test'
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import { debugMock } from '../../../../tests/mocks/debug.js'
import { snapshotModuleExports } from '../../../../tests/mocks/settings.js'

const gb = new Map<string, unknown>()

const realGrowthbook = await import('../../../services/analytics/growthbook.js')
const growthbookSnap = snapshotModuleExports(realGrowthbook)

const realAnalytics = await import('../../../services/analytics/index.js')
const analyticsSnap = snapshotModuleExports(realAnalytics)

const realConfig = await import('../../../utils/config.js')
const configSnap = snapshotModuleExports(realConfig)

const realCronPrompt = await import(
  '@claude-code/builtin-tools/tools/ScheduleCronTool/prompt.js'
)
const cronPromptSnap = snapshotModuleExports(realCronPrompt)

beforeAll(() => {
  mock.module('src/services/analytics/growthbook.js', () => ({
    ...growthbookSnap,
    getFeatureValue_CACHED_MAY_BE_STALE: (
      key: string,
      defaultValue: unknown,
    ) =>
      gb.has(key)
        ? gb.get(key)
        : growthbookSnap.getFeatureValue_CACHED_MAY_BE_STALE(key, defaultValue),
    getFeatureValue_CACHED_WITH_REFRESH: (
      key: string,
      defaultValue: unknown,
      refreshIntervalMs?: number,
    ) =>
      gb.has(key)
        ? gb.get(key)
        : growthbookSnap.getFeatureValue_CACHED_WITH_REFRESH(
            key,
            defaultValue,
            refreshIntervalMs ?? 0,
          ),
  }))

  mock.module('src/services/analytics/index.js', () => ({
    ...analyticsSnap,
    logEvent: () => {},
  }))

  mock.module('src/utils/debug.js', debugMock)

  mock.module('src/utils/config.js', () => ({
    ...configSnap,
    getGlobalConfig: () => ({
      ...((configSnap.getGlobalConfig as () => object)() ?? {}),
      agentPushNotifEnabled: false,
    }),
  }))

  // Cron gate always on for skill registration
  mock.module(
    '@claude-code/builtin-tools/tools/ScheduleCronTool/prompt.js',
    () => ({
      ...cronPromptSnap,
      CRON_CREATE_TOOL_NAME: 'CronCreate',
      CRON_DELETE_TOOL_NAME: 'CronDelete',
      DEFAULT_MAX_AGE_DAYS: 7,
      isKairosCronEnabled: () => true,
    }),
  )
})

afterAll(() => {
  mock.module('src/services/analytics/growthbook.js', () => ({
    ...growthbookSnap,
  }))
  mock.module('src/services/analytics/index.js', () => ({ ...analyticsSnap }))
  mock.module('src/utils/config.js', () => ({ ...configSnap }))
  mock.module(
    '@claude-code/builtin-tools/tools/ScheduleCronTool/prompt.js',
    () => ({
      ...cronPromptSnap,
    }),
  )
})

import type { PromptCommand } from '../../../types/command.js'
import { clearBundledSkills, getBundledSkills } from '../../bundledSkills.js'
import { registerLoopSkill } from '../loop.js'

function asPrompt(c: { type: string }): PromptCommand {
  return c as unknown as PromptCommand
}

function textOf(blocks: ContentBlockParam[]): string {
  return blocks.map(b => (b.type === 'text' ? b.text : '')).join('')
}

describe('registerLoopSkill', () => {
  beforeEach(() => {
    gb.clear()
    gb.set('tengu_kairos_loop_dynamic', false)
    gb.set('tengu_kairos_loop_prompt', false)
    clearBundledSkills()
    registerLoopSkill()
  })

  afterEach(() => {
    clearBundledSkills()
  })

  test('registers loop skill with 289 metadata', () => {
    const skill = getBundledSkills().find(s => s.name === 'loop')
    expect(skill).toBeDefined()
    expect(skill!.type).toBe('prompt')
    expect(skill!.userInvocable).toBe(true)
    expect(skill!.menuDescription).toBe(
      'Repeat a prompt or command on an interval (e.g. /loop 5m /foo)',
    )
    expect(skill!.aliases).toEqual(['proactive'])
    expect(asPrompt(skill!).argsMayContainSlashCommands).toBe(true)
  })

  test('empty args → autonomous dynamic default (248 jKe always-on)', async () => {
    const skill = asPrompt(getBundledSkills().find(s => s.name === 'loop')!)
    const blocks = await skill.getPromptForCommand('', {
      options: {},
    } as never)
    const text = textOf(blocks)
    expect(text).toContain('autonomous default with dynamic pacing')
    expect(text).toContain('<<autonomous-loop-dynamic>>')
    expect(text).toContain('Consecutive `noop: true` ticks collapse')
  })

  test('jKe on + no interval → dynamic mode prompt', async () => {
    gb.set('tengu_kairos_loop_dynamic', true)
    clearBundledSkills()
    registerLoopSkill()
    const skill = asPrompt(getBundledSkills().find(s => s.name === 'loop')!)
    const blocks = await skill.getPromptForCommand('check the deploy', {
      options: {},
    } as never)
    const text = textOf(blocks)
    expect(text).toContain('Dynamic mode')
    expect(text).toContain('ScheduleWakeup')
    expect(text).toContain('/loop check the deploy')
    expect(text).toContain('Consecutive `noop: true` ticks collapse')
  })

  test('jKe on + leading interval → still mentions CronCreate fixed path', async () => {
    gb.set('tengu_kairos_loop_dynamic', true)
    clearBundledSkills()
    registerLoopSkill()
    const skill = asPrompt(getBundledSkills().find(s => s.name === 'loop')!)
    const blocks = await skill.getPromptForCommand('5m check deploy', {
      options: {},
    } as never)
    const text = textOf(blocks)
    // Dynamic builder includes fixed-interval section with CronCreate
    expect(text).toContain('CronCreate')
    expect(text).toContain('Fixed-interval mode')
  })

  test('qAs + empty + jKe → autonomous dynamic default', async () => {
    gb.set('tengu_kairos_loop_dynamic', true)
    gb.set('tengu_kairos_loop_prompt', true)
    clearBundledSkills()
    registerLoopSkill()
    const skill = asPrompt(getBundledSkills().find(s => s.name === 'loop')!)
    const blocks = await skill.getPromptForCommand('', {
      options: {},
    } as never)
    const text = textOf(blocks)
    expect(text).toContain('autonomous default with dynamic pacing')
    expect(text).toContain('<<autonomous-loop-dynamic>>')
    expect(text).toContain('# Autonomous loop check')
  })
})
