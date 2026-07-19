import { describe, expect, test } from 'bun:test'
import {
  commandMatchesName,
  filterCommandsBySkillAllowlist,
  type CommandBase,
} from '../command.js'

function cmd(
  name: string,
  opts?: { aliases?: string[]; userFacingName?: string },
): CommandBase {
  return {
    name,
    description: name,
    aliases: opts?.aliases,
    userFacingName: opts?.userFacingName
      ? () => opts.userFacingName!
      : undefined,
  }
}

describe('commandMatchesName densable Z$u', () => {
  test('matches name, userFacingName, alias', () => {
    const c = cmd('plugin:foo', {
      aliases: ['f'],
      userFacingName: 'foo',
    })
    expect(commandMatchesName(c, 'plugin:foo')).toBe(true)
    expect(commandMatchesName(c, 'foo')).toBe(true)
    expect(commandMatchesName(c, 'f')).toBe(true)
    expect(commandMatchesName(c, 'bar')).toBe(false)
  })
})

describe('filterCommandsBySkillAllowlist densable Jte', () => {
  const skills = [
    cmd('review'),
    cmd('plugin:deploy', { userFacingName: 'deploy' }),
    cmd('org:lint', { aliases: ['linter'] }),
  ]

  test('undefined allowlist returns all', () => {
    expect(filterCommandsBySkillAllowlist(skills, undefined)).toEqual(skills)
  })

  test('exact and userFacing and alias matches', () => {
    expect(
      filterCommandsBySkillAllowlist(skills, ['review', 'deploy']).map(
        s => s.name,
      ),
    ).toEqual(['review', 'plugin:deploy'])
    expect(
      filterCommandsBySkillAllowlist(skills, ['linter']).map(s => s.name),
    ).toEqual(['org:lint'])
  })

  test('suffix :name match densable r.name.endsWith(`:${n}`)', () => {
    expect(
      filterCommandsBySkillAllowlist(skills, ['lint']).map(s => s.name),
    ).toEqual(['org:lint'])
  })

  test('empty allowlist filters to none', () => {
    expect(filterCommandsBySkillAllowlist(skills, [])).toEqual([])
  })
})
