/**
 * densable excludeDynamicSections residual (#96):
 * yNy static env, ESo/nvs parse, mB SIMPLE empty prefix.
 */
import { describe, expect, test } from 'bun:test'
import {
  computeStaticEnvInfo,
  getSystemPrompt,
  parseExcludedDynamicSection,
} from '../prompts.js'

describe('parseExcludedDynamicSection densable nvs', () => {
  test('splits "# Heading" body into key/value', () => {
    expect(parseExcludedDynamicSection('# Environment\ncwd line\nmore')).toEqual(
      ['Environment', 'cwd line\nmore'],
    )
  })

  test('heading-only body yields empty value', () => {
    expect(parseExcludedDynamicSection('# Scratchpad Directory')).toEqual([
      'Scratchpad Directory',
      '',
    ])
  })

  test('rejects body without "# " heading', () => {
    expect(() => parseExcludedDynamicSection('no heading')).toThrow(
      /expected section body to start with a "# <heading>" line/,
    )
  })
})

describe('computeStaticEnvInfo densable yNy', () => {
  test('omits cwd and git while keeping model line', () => {
    const text = computeStaticEnvInfo('claude-opus-4-7')
    expect(text.startsWith('# Environment')).toBe(true)
    expect(text).toContain('You are powered by the model')
    expect(text).not.toContain('Primary working directory:')
    expect(text).not.toContain('Is a git repository:')
    expect(text).toContain('Claude Code is available as a CLI')
  })
})

describe('getSystemPrompt excludeDynamicSections densable mB/afs', () => {
  test('SIMPLE + excludeDynamicSections returns empty array', async () => {
    const prev = process.env.CLAUDE_CODE_SIMPLE
    process.env.CLAUDE_CODE_SIMPLE = '1'
    try {
      const empty = await getSystemPrompt([], 'claude-opus-4-7', undefined, undefined, {
        excludeDynamicSections: true,
      })
      expect(empty).toEqual([])
      const full = await getSystemPrompt([], 'claude-opus-4-7')
      expect(full.length).toBeGreaterThan(0)
      expect(full[0]).toContain('CWD:')
    } finally {
      if (prev === undefined) {
        delete process.env.CLAUDE_CODE_SIMPLE
      } else {
        process.env.CLAUDE_CODE_SIMPLE = prev
      }
    }
  })
})
