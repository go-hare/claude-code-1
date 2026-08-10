import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'

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

// Cron gate always on for skill registration
mock.module(
  '@claude-code/builtin-tools/tools/ScheduleCronTool/prompt.js',
  () => ({
    CRON_CREATE_TOOL_NAME: 'CronCreate',
    CRON_DELETE_TOOL_NAME: 'CronDelete',
    DEFAULT_MAX_AGE_DAYS: 7,
    isKairosCronEnabled: () => true,
  }),
)

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

  test('registers loop skill', () => {
    const skill = getBundledSkills().find(s => s.name === 'loop')
    expect(skill).toBeDefined()
    expect(skill!.type).toBe('prompt')
    expect(skill!.userInvocable).toBe(true)
  })

  test('empty args → usage when jKe off', async () => {
    const skill = asPrompt(getBundledSkills().find(s => s.name === 'loop')!)
    const blocks = await skill.getPromptForCommand('', {
      options: {},
    } as never)
    const text = textOf(blocks)
    expect(text).toContain('Usage: /loop')
    expect(text).toContain('defaults to 10m')
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
