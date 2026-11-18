import { describe, expect, test } from 'bun:test'
import type { Command } from 'src/commands.js'
import {
  formatCommandsWithinBudget,
  formatSkillListingName,
} from '../prompt.js'

function makeSkill(
  name: string,
  userFacingName?: string,
  description = 'Does something useful',
): Command {
  return {
    type: 'prompt',
    name,
    description,
    isEnabled: () => true,
    isHidden: false,
    progressMessage: 'running',
    userFacingName: () => userFacingName ?? name,
    source: 'plugin',
    getPromptForCommand: async () => [],
  } as unknown as Command
}

describe('SkillTool 2.1.290 #91 qrn(e, n)', () => {
  test('appends (userFacingName) when alias is safe, distinct, not :suffix, and resolves to cmd', () => {
    const cmd = makeSkill('my-plugin:long-skill-name', 'short-alias')
    const other = makeSkill('other-plugin:helper', 'helper')
    expect(formatSkillListingName(cmd, [cmd, other])).toBe(
      'my-plugin:long-skill-name (short-alias)',
    )
    expect(formatSkillListingName(other, [cmd, other])).toBe(
      'other-plugin:helper',
    )
  })

  test('omits alias when it collides or has unsafe characters', () => {
    const first = makeSkill('plugin-a:skill', 'shared')
    const second = makeSkill('plugin-b:skill', 'shared')
    // findCommand('shared', [first, second]) returns first, so second should not show (shared)
    expect(formatSkillListingName(second, [first, second])).toBe(
      'plugin-b:skill',
    )

    const unsafe = makeSkill('plugin-c:skill', 'bad alias!')
    expect(formatSkillListingName(unsafe, [unsafe])).toBe('plugin-c:skill')
  })

  test('formatCommandsWithinBudget includes qrn alias in listing', () => {
    const cmd = makeSkill('my-plugin:deploy-app', 'deploy', 'Deploy the app')
    const out = formatCommandsWithinBudget([cmd], 200_000)
    expect(out).toContain('- my-plugin:deploy-app (deploy): Deploy the app')
  })
})
