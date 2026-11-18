import { describe, expect, test } from 'bun:test'
import type { Command } from '../../types/command.js'
import {
  disambiguateAddDirSkills,
  getAddDirSkillPrefix,
  HOST_SKILL_CATALOG_DIR,
  parseHostSkillCatalog,
} from '../loadSkillsDir.js'
import {
  applySyncedSkillShadowFilter,
  isAccountSyncedSkill,
  isFromHostCatalog,
} from '../syncedSkillsHarden.js'

function makePromptCmd(
  overrides: Partial<Command> & { name: string },
): Command {
  return {
    type: 'prompt',
    description: 'desc',
    hasUserSpecifiedDescription: true,
    allowedTools: [],
    argumentHint: undefined,
    argNames: undefined,
    whenToUse: undefined,
    version: undefined,
    model: undefined,
    disableModelInvocation: false,
    userInvocable: true,
    contentLength: 10,
    source: 'projectSettings',
    loadedFrom: 'skills',
    userFacingName: () => overrides.name,
    getPromptForCommand: async () => [],
    ...overrides,
  } as Command
}

describe('#975 host skill catalog & #1144 --add-dir disambiguation', () => {
  test('#975 parseHostSkillCatalog validates 1..64 folder names and rejects invalid input', () => {
    const valid = parseHostSkillCatalog('{"skills":["pdf-tools","my_skill.1"]}')
    expect(valid).not.toBeNull()
    expect(valid!.dir).toBe(HOST_SKILL_CATALOG_DIR)
    expect([...valid!.skills]).toEqual(['pdf-tools', 'my_skill.1'])

    expect(parseHostSkillCatalog(undefined)).toBeNull()
    expect(parseHostSkillCatalog('{"skills":[]}')).toBeNull()
    expect(parseHostSkillCatalog('{"skills":[".."]}')).toBeNull()
    expect(parseHostSkillCatalog('{"skills":["bad/name"]}')).toBeNull()
  })

  test('#975 fromHostCatalog skills are not treated as account syncedSkills and survive shadow filter', () => {
    const hostSkill = makePromptCmd({
      name: 'dir-plugin-skill',
      source: 'userSettings',
      loadedFrom: 'syncedSkills',
    })
    ;(hostSkill as Command & { fromHostCatalog?: boolean }).fromHostCatalog =
      true

    const accountSkill = makePromptCmd({
      name: 'local-cmd',
      source: 'userSettings',
      loadedFrom: 'syncedSkills',
    })
    const localCmd = makePromptCmd({
      name: 'local-cmd',
      source: 'projectSettings',
      loadedFrom: 'skills',
    })

    expect(isFromHostCatalog(hostSkill)).toBe(true)
    expect(isAccountSyncedSkill(hostSkill)).toBe(false)
    expect(isAccountSyncedSkill(accountSkill)).toBe(true)

    const filtered = applySyncedSkillShadowFilter([
      localCmd,
      accountSkill,
      hostSkill,
    ])
    expect(filtered.map(c => c.name)).toEqual(['local-cmd', 'dir-plugin-skill'])
  })

  test('#1144 disambiguates colliding --add-dir skill as <folder>:<name>', () => {
    const cwd = '/repo/main'
    const primary = makePromptCmd({
      name: 'deploy',
      skillRoot: '/repo/main/.claude/skills/deploy',
    })
    const addDir = makePromptCmd({
      name: 'deploy',
      skillRoot: '/extra/ops-pack/.claude/skills/deploy',
    })

    expect(getAddDirSkillPrefix(primary, cwd)).toBeNull()
    expect(getAddDirSkillPrefix(addDir, cwd)).toBe('ops-pack')

    const result = disambiguateAddDirSkills([primary, addDir], cwd)
    expect(result.map(c => c.name)).toEqual(['deploy', 'ops-pack:deploy'])
    expect(result[1]!.userFacingName?.()).toBe('ops-pack:deploy')
    expect((result[1] as { unqualifiedName?: string }).unqualifiedName).toBe(
      'deploy',
    )
  })
})
