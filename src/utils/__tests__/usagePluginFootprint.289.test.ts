import { describe, expect, test } from 'bun:test'
import type { Command } from '../../types/command.js'
import {
  aggregatePluginSkillListing,
  skillListingChars,
  skillListingCharsPerToken,
  skillListingCharBudget,
  skillListingDescription,
  skillListingDisplayName,
  SKILL_LISTING_CHARS_PER_TOKEN,
} from '../usagePluginFootprint.js'

function promptCmd(partial: {
  name: string
  description?: string
  whenToUse?: string
  pluginName?: string
  disableModelInvocation?: boolean
  userFacingName?: () => string
  aliases?: string[]
}): Command {
  return {
    type: 'prompt',
    name: partial.name,
    description: partial.description ?? 'desc',
    whenToUse: partial.whenToUse,
    disableModelInvocation: partial.disableModelInvocation,
    userFacingName: partial.userFacingName,
    aliases: partial.aliases,
    progressMessage: 'x',
    contentLength: 1,
    source: 'plugin',
    pluginInfo: partial.pluginName
      ? {
          pluginManifest: { name: partial.pluginName },
          repository: 'r',
        }
      : undefined,
    async getPromptForCommand() {
      return []
    },
  } as Command
}

describe('densable _Rt plugin skill-listing footprint', () => {
  test('Mft joins description and whenToUse', () => {
    expect(skillListingDescription({ description: 'd', whenToUse: 'w' })).toBe(
      'd - w',
    )
    expect(skillListingDescription({ description: 'd' })).toBe('d')
  })

  test('Eh / Yh returns 4 for rF models and 3 for newer families', () => {
    expect(skillListingCharsPerToken(undefined)).toBe(4)
    expect(skillListingCharsPerToken('claude-sonnet-4-6')).toBe(4)
    expect(skillListingCharsPerToken('claude-opus-4-6')).toBe(4)
    expect(skillListingCharsPerToken('claude-opus-4-7')).toBe(3)
    expect(skillListingCharsPerToken('claude-fable-5-1')).toBe(3)
  })

  test('Rwt / XDt uses userFacingName and Hs collision check', () => {
    const bare = promptCmd({
      name: 'plugin:deploy',
      userFacingName: () => 'deploy',
      pluginName: 'plugin',
    })
    expect(skillListingDisplayName(bare, [bare])).toBe('plugin:deploy')

    const custom = promptCmd({
      name: 'plugin:deploy',
      userFacingName: () => 'ship',
      pluginName: 'plugin',
    })
    expect(skillListingDisplayName(custom, [custom])).toBe(
      'plugin:deploy (ship)',
    )

    const winner = promptCmd({
      name: 'ship',
      pluginName: 'other',
    })
    expect(skillListingDisplayName(custom, [winner, custom])).toBe(
      'plugin:deploy',
    )
  })

  test('h char count is 2+name+2+desc+1', () => {
    const cmd = promptCmd({
      name: 'p:skill',
      description: 'hello',
      pluginName: 'p',
    })
    expect(skillListingChars(cmd, [cmd])).toBe(
      2 + 'p:skill'.length + 2 + 'hello'.length + 1,
    )
  })

  test('Oft default budget is context*charsPerToken*0.01', () => {
    const prev = process.env.SLASH_COMMAND_TOOL_CHAR_BUDGET
    delete process.env.SLASH_COMMAND_TOOL_CHAR_BUDGET
    try {
      expect(skillListingCharBudget(200_000, 4)).toBe(8000)
      expect(skillListingCharBudget(1_000_000, 3)).toBe(30_000)
    } finally {
      if (prev === undefined) delete process.env.SLASH_COMMAND_TOOL_CHAR_BUDGET
      else process.env.SLASH_COMMAND_TOOL_CHAR_BUDGET = prev
    }
  })

  test('_Rt groups prompt plugin skills and skips disableModelInvocation', () => {
    const cmds = [
      promptCmd({
        name: 'alpha:one',
        description: 'a',
        pluginName: 'alpha',
      }),
      promptCmd({
        name: 'alpha:two',
        description: 'bb',
        pluginName: 'alpha',
        disableModelInvocation: true,
      }),
      promptCmd({ name: 'local', description: 'no plugin' }),
    ]
    const foot = aggregatePluginSkillListing(
      cmds,
      SKILL_LISTING_CHARS_PER_TOKEN,
    )
    expect(foot.byPlugin).toHaveLength(1)
    expect(foot.byPlugin[0]!.pluginName).toBe('alpha')
    expect(foot.byPlugin[0]!.skillCount).toBe(1)
    expect(foot.totalTokens).toBeGreaterThan(0)
  })
})
