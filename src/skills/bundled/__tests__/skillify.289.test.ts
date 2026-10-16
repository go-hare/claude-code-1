import { afterEach, describe, expect, test } from 'bun:test'

const g = globalThis as unknown as { MACRO?: { VERSION: string } }
g.MACRO = { VERSION: 'test' }

const { clearBundledSkills, getBundledSkills } = await import(
  '../../bundledSkills.js'
)
const { registerSkillifySkill } = await import('../skillify.js')

describe('gold 2.1.289 skillify BODY', () => {
  afterEach(() => {
    clearBundledSkills()
  })

  test('prompt reviews the conversation above, not a session_memory dump', async () => {
    const prev = process.env.USER_TYPE
    process.env.USER_TYPE = 'ant'
    try {
      clearBundledSkills()
      registerSkillifySkill()
      const skill = getBundledSkills().find(s => s.name === 'skillify')
      expect(skill?.type).toBe('prompt')
      if (!skill || skill.type !== 'prompt') throw new Error('expected prompt')
      const blocks = await skill.getPromptForCommand('deploy flow', {
        options: {},
        messages: [],
      } as never)
      const text = blocks.map(b => (b.type === 'text' ? b.text : '')).join('')
      expect(text).toContain('# Skillify')
      expect(text).toContain('Review the conversation above')
      expect(text).toContain('Bash(gh *)')
      expect(text).toContain('deploy flow')
      expect(text).not.toContain('<session_memory>')
    } finally {
      if (prev === undefined) delete process.env.USER_TYPE
      else process.env.USER_TYPE = prev
    }
  })
})
