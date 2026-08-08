import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { clearBundledSkills, getBundledSkills } from '../../bundledSkills.js'
import { registerDeepResearchSkill } from '../deepResearch.js'

describe('densable 2.1.218 #29: /deep-research user-only', () => {
  beforeEach(() => {
    clearBundledSkills()
  })

  afterEach(() => {
    clearBundledSkills()
  })

  test('registerDeepResearchSkill sets disableModelInvocation + userInvocable', () => {
    registerDeepResearchSkill()
    const skill = getBundledSkills().find(s => s.name === 'deep-research')
    expect(skill).toBeDefined()
    expect(skill?.userInvocable).toBe(true)
    expect(skill?.disableModelInvocation).toBe(true)
  })

  test('prompt expands to Workflow deep-research invocation', async () => {
    registerDeepResearchSkill()
    const skill = getBundledSkills().find(s => s.name === 'deep-research')
    expect(skill?.type).toBe('prompt')
    if (skill?.type !== 'prompt') return
    const blocks = await skill.getPromptForCommand('quantum computing trends', {
      // minimal context — getPromptForCommand only uses args
    } as never)
    const text = blocks.map(b => ('text' in b ? b.text : '')).join('\n')
    expect(text).toContain('Workflow({ name: "deep-research"')
    expect(text).toContain('quantum computing trends')
  })
})
