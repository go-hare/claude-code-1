import { describe, expect, mock, test } from 'bun:test'
import type { Command } from '../../types/command.js'
import {
  annotateSkillFromExtraDir,
  bareSkillName,
  findScopedSkillVariants,
  formatUnknownSkillMessage,
  isSkillForkRecursion,
  isValidSkillToolName,
  maybeNoteScopedSkillVariants,
  mergeDynamicSkillsDensable,
  qualifyScopedSkillCommand,
  scopedSkillName,
  skillRootProjectRelativeToCwd,
  suggestClosestSkillName,
} from '../scopeSkillCommand.js'

mock.module('../../services/analytics/index.js', () => ({
  logEvent: () => {},
  logEventAsync: async () => {},
}))

function promptSkill(partial: {
  name: string
  skillRoot?: string
  description?: string
  unqualifiedName?: string
  loadedFrom?: string
  hasUserSpecifiedDescription?: boolean
  whenToUse?: string
  disableModelInvocation?: boolean
  context?: 'inline' | 'fork'
}): Command {
  return {
    type: 'prompt',
    name: partial.name,
    description: partial.description ?? 'd',
    progressMessage: 'running',
    contentLength: 1,
    source: 'projectSettings',
    skillRoot: partial.skillRoot,
    unqualifiedName: partial.unqualifiedName,
    loadedFrom: partial.loadedFrom ?? 'skills',
    hasUserSpecifiedDescription: partial.hasUserSpecifiedDescription ?? true,
    whenToUse: partial.whenToUse,
    disableModelInvocation: partial.disableModelInvocation,
    context: partial.context,
    getPromptForCommand: async () => [],
  } as Command
}

describe('scopeSkillCommand densable NMy/XEs/FMy', () => {
  test('scopedSkillName densable XEs', () => {
    expect(scopedSkillName('pkgs/api', 'deploy')).toBe('pkgs/api:deploy')
  })

  test('skillRootProjectRelativeToCwd densable NMy', () => {
    const cwd = '/repo'
    const skill = promptSkill({
      name: 'foo',
      skillRoot: '/repo/pkgs/api/.claude/skills/foo',
    })
    expect(skillRootProjectRelativeToCwd(skill, cwd)).toBe('pkgs/api')
    expect(
      skillRootProjectRelativeToCwd(
        promptSkill({ name: 'x', skillRoot: '/other/.claude/skills/x' }),
        cwd,
      ),
    ).toBeNull()
  })

  test('qualifyScopedSkillCommand sets unqualifiedName', () => {
    const q = qualifyScopedSkillCommand(
      promptSkill({ name: 'deploy', skillRoot: '/r/p/.claude/skills/deploy' }),
      'pkgs/api',
      true,
    )
    expect(q.name).toBe('pkgs/api:deploy')
    expect(q.type === 'prompt' && q.unqualifiedName).toBe('deploy')
    expect(q.description).toContain('scoped to pkgs/api/')
    expect(q.userFacingName?.()).toBe('pkgs/api:deploy')
  })

  test('annotateSkillFromExtraDir keeps name', () => {
    const a = annotateSkillFromExtraDir(
      promptSkill({ name: 'unique' }),
      'pkgs/api',
    )
    expect(a.name).toBe('unique')
    expect(a.description).toContain('from pkgs/api/.claude/skills')
  })

  test('mergeDynamicSkillsDensable qualifies collisions', () => {
    const base = [
      promptSkill({
        name: 'deploy',
        skillRoot: '/repo/.claude/skills/deploy',
      }),
    ]
    const dynamic = [
      promptSkill({
        name: 'deploy',
        skillRoot: '/repo/pkgs/api/.claude/skills/deploy',
      }),
      promptSkill({
        name: 'only-extra',
        skillRoot: '/repo/pkgs/api/.claude/skills/only-extra',
      }),
    ]
    const out = mergeDynamicSkillsDensable(base, dynamic, '/repo')
    const names = out.map(c => c.name)
    expect(names).toContain('deploy')
    expect(names).toContain('pkgs/api:deploy')
    expect(names).toContain('only-extra')
    const qualified = out.find(c => c.name === 'pkgs/api:deploy')
    expect(qualified?.type === 'prompt' && qualified.unqualifiedName).toBe(
      'deploy',
    )
  })

  test('bareSkillName densable lye', () => {
    expect(bareSkillName(promptSkill({ name: 'deploy' }))).toBe('deploy')
    expect(
      bareSkillName(
        promptSkill({ name: 'pkgs/api:deploy', unqualifiedName: 'deploy' }),
      ),
    ).toBe('deploy')
  })

  test('isValidSkillToolName densable ber', () => {
    expect(isValidSkillToolName('')).toBe(false)
    expect(isValidSkillToolName('deploy')).toBe(true)
    expect(isValidSkillToolName('a'.repeat(257))).toBe(false)
  })

  test('findScopedSkillVariants densable zrs', () => {
    const cmds = [
      promptSkill({ name: 'deploy' }),
      promptSkill({
        name: 'pkgs/api:deploy',
        unqualifiedName: 'deploy',
      }),
      promptSkill({
        name: 'pkgs/web:deploy',
        unqualifiedName: 'deploy',
        disableModelInvocation: true,
      }),
    ]
    const found = findScopedSkillVariants(cmds, 'deploy')
    expect(found.map(c => c.name)).toEqual(['pkgs/api:deploy'])
  })

  test('formatUnknownSkillMessage densable skill_invoke_not_found variants', () => {
    const cmds = [
      promptSkill({ name: 'deploy' }),
      promptSkill({
        name: 'pkgs/api:deploy',
        unqualifiedName: 'deploy',
      }),
    ]
    const msg = formatUnknownSkillMessage('deploy', cmds)
    expect(msg).toContain('Directory-scoped variants exist')
    expect(msg).toContain('pkgs/api:deploy')
  })

  test('formatUnknownSkillMessage densable _it did-you-mean', () => {
    const cmds = [
      promptSkill({ name: 'deploy' }),
      promptSkill({ name: 'review' }),
    ]
    const msg = formatUnknownSkillMessage('deply', cmds)
    expect(msg).toContain('Did you mean deploy?')
  })

  test('isSkillForkRecursion densable skill_invoke_fork_recursion', () => {
    const forked = promptSkill({ name: 'deploy', context: 'fork' })
    const forkedQualified = promptSkill({
      name: 'pkgs/api:deploy',
      unqualifiedName: 'deploy',
      context: 'fork',
    })
    const inline = promptSkill({ name: 'deploy', context: 'inline' })
    expect(isSkillForkRecursion(forked, 'deploy')).toBe(true)
    expect(isSkillForkRecursion(forkedQualified, 'deploy')).toBe(true)
    expect(isSkillForkRecursion(forked, 'other')).toBe(false)
    expect(isSkillForkRecursion(forked, undefined)).toBe(false)
    expect(isSkillForkRecursion(inline, 'deploy')).toBe(false)
  })

  test('suggestClosestSkillName densable _it', () => {
    expect(
      suggestClosestSkillName('deply', [{ name: 'deploy' }], {
        maxEditDistance: 2,
      }),
    ).toBe('deploy')
    expect(
      suggestClosestSkillName('zzz', [{ name: 'deploy' }], {
        maxEditDistance: 2,
      }),
    ).toBeUndefined()
  })

  test('maybeNoteScopedSkillVariants densable aWr note text', async () => {
    const { clearDynamicSkills, setDynamicSkillsForTests } = await import(
      '../loadSkillsDir.js'
    )
    const bare = promptSkill({ name: 'deploy' })
    const variant = promptSkill({
      name: 'pkgs/api:deploy',
      unqualifiedName: 'deploy',
    })
    // densable _io empty → null
    clearDynamicSkills()
    expect(
      maybeNoteScopedSkillVariants(bare, {
        tools: [{ name: 'Skill' }] as never,
        commands: [bare, variant],
      }),
    ).toBeNull()

    setDynamicSkillsForTests([variant])
    try {
      const note = maybeNoteScopedSkillVariants(bare, {
        tools: [{ name: 'Skill' }] as never,
        commands: [bare, variant],
      })
      expect(note).not.toBeNull()
      const text =
        typeof note?.message.content === 'string'
          ? note.message.content
          : JSON.stringify(note?.message.content)
      expect(text).toContain('Directory-scoped variants')
      expect(text).toContain('pkgs/api:deploy')
      expect(text).toContain('pkgs/api/')
      // already-qualified invoker → no note
      expect(
        maybeNoteScopedSkillVariants(variant, {
          tools: [{ name: 'Skill' }] as never,
          commands: [bare, variant],
        }),
      ).toBeNull()
    } finally {
      clearDynamicSkills()
    }
  })
})
