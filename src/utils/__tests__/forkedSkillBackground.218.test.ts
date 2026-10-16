import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  getIsNonInteractiveSession,
  setIsInteractive,
} from '../../bootstrap/state.js'
import { FORKED_SKILL_LAUNCH_TAG } from '../../constants/xml.js'
import type { CommandBase, PromptCommand } from '../../types/command.js'
import {
  assertForkedSkillResumeAllowed,
  formatForkedSkillLaunchMarker,
  ForkedSkillResumeRefusedError,
  shouldBackgroundForkedSkill,
} from '../forkedSkillBackground.js'

function forkCmd(
  overrides: Partial<CommandBase & PromptCommand> = {},
): CommandBase & PromptCommand {
  return {
    type: 'prompt',
    name: 'demo',
    description: 'demo',
    progressMessage: 'running',
    contentLength: 0,
    source: 'builtin',
    context: 'fork',
    getPromptForCommand: async () => [{ type: 'text', text: 'x' }],
    ...overrides,
  }
}

describe('shouldBackgroundForkedSkill (densable 2.1.218 Cvo)', () => {
  let prevInteractive: boolean

  beforeEach(() => {
    prevInteractive = !getIsNonInteractiveSession()
    setIsInteractive(true)
  })

  afterEach(() => {
    setIsInteractive(prevInteractive)
  })

  test('defaults true when background is undefined', () => {
    expect(shouldBackgroundForkedSkill(forkCmd())).toBe(true)
  })

  test('respects background: false opt-out', () => {
    expect(shouldBackgroundForkedSkill(forkCmd({ background: false }))).toBe(
      false,
    )
  })

  test('respects background: true', () => {
    expect(shouldBackgroundForkedSkill(forkCmd({ background: true }))).toBe(
      true,
    )
  })

  test('forceSync disables background', () => {
    expect(shouldBackgroundForkedSkill(forkCmd(), true)).toBe(false)
  })

  test('non-interactive session disables background', () => {
    setIsInteractive(false)
    expect(shouldBackgroundForkedSkill(forkCmd())).toBe(false)
  })

  test('CLAUDE_CODE_DISABLE_BACKGROUND_TASKS disables background', () => {
    const prev = process.env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS
    process.env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS = '1'
    try {
      expect(shouldBackgroundForkedSkill(forkCmd())).toBe(false)
    } finally {
      if (prev === undefined) {
        delete process.env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS
      } else {
        process.env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS = prev
      }
    }
  })
})

describe('formatForkedSkillLaunchMarker (densable 2.1.218 gsd)', () => {
  test('wraps JSON payload in forked-skill-launch tag', () => {
    const marker = formatForkedSkillLaunchMarker({
      agentId: 'agent-abc',
      skillName: 'demo',
      description: '/demo args',
    })
    expect(marker.startsWith(`<${FORKED_SKILL_LAUNCH_TAG}>`)).toBe(true)
    expect(marker.endsWith(`</${FORKED_SKILL_LAUNCH_TAG}>`)).toBe(true)
    const json = marker.slice(
      FORKED_SKILL_LAUNCH_TAG.length + 2,
      -(FORKED_SKILL_LAUNCH_TAG.length + 3),
    )
    // escapeXml only escapes <>& — plain JSON body remains parseable
    expect(JSON.parse(json)).toEqual({
      agentId: 'agent-abc',
      skillName: 'demo',
      description: '/demo args',
    })
  })

  test('truncates long descriptions to 4096 chars', () => {
    const long = 'x'.repeat(5000)
    const marker = formatForkedSkillLaunchMarker({
      agentId: 'a',
      skillName: 's',
      description: long,
    })
    const json = marker.slice(
      FORKED_SKILL_LAUNCH_TAG.length + 2,
      -(FORKED_SKILL_LAUNCH_TAG.length + 3),
    )
    const parsed = JSON.parse(json) as { description: string }
    expect(parsed.description.length).toBe(4096)
  })
})

describe('assertForkedSkillResumeAllowed (densable Ywo subset)', () => {
  test('skips when no forkedSkillName witness (not a forked-skill agent)', async () => {
    await assertForkedSkillResumeAllowed({ agentId: 'a1' })
  })

  test('cold witness with unresolved skill refuses', async () => {
    await expect(
      assertForkedSkillResumeAllowed({
        agentId: 'a1',
        forkedSkillName: 'this-skill-does-not-exist-ywo-289',
      }),
    ).rejects.toMatchObject({
      name: 'ForkedSkillResumeRefusedError',
      code: 'forked_skill_resume_skill_unresolved',
    } satisfies Partial<ForkedSkillResumeRefusedError>)
  })
})

describe('assertForkedSkillResumeAllowed Ywo overlay (289)', () => {
  test('source lock: syncedSkills + Z7 veto unique English', async () => {
    const { readFileSync } = await import('fs')
    const src = readFileSync(
      new URL('../forkedSkillBackground.ts', import.meta.url),
      'utf-8',
    )
    expect(src).toContain('forked_skill_resume_sync_vetoed')
    expect(src).toContain('forked_skill_resume_allowed_tools_failed')
    expect(src).toContain('replaceCommandRules: true')
    expect(src).toContain('frozenCommandDenies')
    expect(src).toContain('input.frozenCommandDenies')
    expect(src).toContain('an account-synced skill that is currently disabled')
    expect(src).toContain('isForkCapableSkill')
    expect(src).toContain('resolveTrustedSkillAllowedTools')
  })
})
