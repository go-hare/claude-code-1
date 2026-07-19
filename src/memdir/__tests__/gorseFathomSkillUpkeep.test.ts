import { describe, expect, test } from 'bun:test'
import {
  getProjectSkillUpkeepSection,
  isGorseFathomSkillUpkeepEnabled,
  PROJECT_SKILL_UPKEEP_BODY,
} from '../memoryTypes.js'

describe('gorse_fathom skill upkeep densable sFr/aFr', () => {
  test('off by default inject', () => {
    expect(isGorseFathomSkillUpkeepEnabled(false)).toBe(false)
    expect(getProjectSkillUpkeepSection(false)).toEqual([])
  })

  test('on returns project skill upkeep section', () => {
    expect(isGorseFathomSkillUpkeepEnabled(true)).toBe(true)
    const section = getProjectSkillUpkeepSection(true)
    expect(section[0]).toBe('## Project skill upkeep')
    expect(section.join('\n')).toContain(PROJECT_SKILL_UPKEEP_BODY.slice(0, 40))
    expect(section.join('\n')).toContain('.claude/skills/')
    expect(section.join('\n')).toContain('verify')
  })
})
