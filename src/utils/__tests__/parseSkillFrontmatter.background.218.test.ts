import { describe, expect, test } from 'bun:test'
import { parseSkillFrontmatterFields } from '../../skills/loadSkillsDir.js'

describe('parseSkillFrontmatterFields background (densable 2.1.218 #34)', () => {
  test('context:fork defaults background true when omitted', () => {
    const parsed = parseSkillFrontmatterFields(
      { context: 'fork', description: 'd' },
      'body',
      'demo',
    )
    expect(parsed.executionContext).toBe('fork')
    expect(parsed.background).toBe(true)
  })

  test('context:fork + background:false opts out', () => {
    const parsed = parseSkillFrontmatterFields(
      { context: 'fork', background: 'false', description: 'd' },
      'body',
      'demo',
    )
    expect(parsed.background).toBe(false)
  })

  test('context:fork accepts yes/no/on/off/1/0 (218 bool literals)', () => {
    expect(
      parseSkillFrontmatterFields(
        { context: 'fork', background: 'yes', description: 'd' },
        'body',
        'a',
      ).background,
    ).toBe(true)
    expect(
      parseSkillFrontmatterFields(
        { context: 'fork', background: 'off', description: 'd' },
        'body',
        'b',
      ).background,
    ).toBe(false)
    expect(
      parseSkillFrontmatterFields(
        { context: 'fork', background: 0, description: 'd' },
        'body',
        'c',
      ).background,
    ).toBe(false)
  })

  test('inline context leaves background undefined when omitted', () => {
    const parsed = parseSkillFrontmatterFields(
      { description: 'd' },
      'body',
      'inline-skill',
    )
    expect(parsed.executionContext).toBeUndefined()
    expect(parsed.background).toBeUndefined()
  })
})
