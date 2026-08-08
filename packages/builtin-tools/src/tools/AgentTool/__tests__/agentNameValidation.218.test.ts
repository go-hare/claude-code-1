import { describe, expect, test } from 'bun:test'
import { validateAgentMarkdownName } from '../loadAgentsDir.js'

describe('validateAgentMarkdownName (densable 2.1.218 #33)', () => {
  test('accepts plain agent names', () => {
    expect(validateAgentMarkdownName('code-reviewer')).toEqual({
      ok: true,
      name: 'code-reviewer',
    })
  })

  test('rejects names containing colon (plugin namespacing)', () => {
    const r = validateAgentMarkdownName('my:agent')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toContain('must not contain ":"')
      expect(r.error).toContain('plugin namespacing')
    }
  })

  test('rejects names starting with hyphen', () => {
    const r = validateAgentMarkdownName('-sneaky')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toContain('must not start with "-"')
    }
  })

  test('NFKC-normalizes before checks', () => {
    // fullwidth colon U+FF1A → ":" under NFKC
    const fullwidthColon = 'my\uFF1Aagent'
    const r = validateAgentMarkdownName(fullwidthColon)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toContain('must not contain ":"')
    }
  })
})
