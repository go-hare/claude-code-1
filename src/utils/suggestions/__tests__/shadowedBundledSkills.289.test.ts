import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Command } from '../../../types/command.js'
import { dropShadowedBundledSkills } from '../commandSuggestions.js'

const prompt = (name: string, source: string): Command =>
  ({
    type: 'prompt',
    name,
    source,
    description: name,
  }) as unknown as Command

describe('dropShadowedBundledSkills (densable 2.1.289 xLt)', () => {
  test('user skill shadows the bundled skill of the same name', () => {
    const user = prompt('code-review', 'userSettings')
    const bundled = prompt('code-review', 'bundled')
    const other = prompt('simplify', 'bundled')
    expect(dropShadowedBundledSkills([user, bundled, other])).toEqual([
      user,
      other,
    ])
  })

  test('a bundled skill that comes first is kept', () => {
    const bundled = prompt('code-review', 'bundled')
    const user = prompt('code-review', 'userSettings')
    expect(dropShadowedBundledSkills([bundled, user])).toEqual([bundled, user])
  })

  test('returns the same array (cached) when nothing is shadowed', () => {
    const list = [prompt('a', 'bundled'), prompt('b', 'userSettings')]
    expect(dropShadowedBundledSkills(list)).toBe(list)
    expect(dropShadowedBundledSkills(list)).toBe(list)
  })

  test('/code-review is registered as a bundled skill', () => {
    const src = readFileSync(
      join(import.meta.dir, '../../../commands/codeReview.ts'),
      'utf8',
    )
    expect(src).toContain("source: 'bundled' as const")
    expect(src).toContain(
      "menuDescription: 'Review the current diff or a PR for bugs and cleanups'",
    )
    expect(src).toContain('isEnabled: () => !isBundledSkillKillSwitchOn()')
  })
})
