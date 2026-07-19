import { describe, expect, test } from 'bun:test'
import { getEffectiveContextWindowSize } from '../autoCompact.js'

describe('getEffectiveContextWindowSize densable autoCompactWindow residual', () => {
  test('session autoCompactWindow caps context when env unset', () => {
    const prev = process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW
    delete process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW
    try {
      const uncapped = getEffectiveContextWindowSize('claude-sonnet-4-6')
      const capped = getEffectiveContextWindowSize(
        'claude-sonnet-4-6',
        200_000,
      )
      // Cap only applies when smaller than model window - reserved tokens.
      expect(capped).toBeLessThanOrEqual(uncapped)
      expect(capped).toBeLessThanOrEqual(200_000)
    } finally {
      if (prev === undefined) {
        delete process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW
      } else {
        process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW = prev
      }
    }
  })

  test('undefined autoCompactWindow matches single-arg call', () => {
    const a = getEffectiveContextWindowSize('claude-sonnet-4-6')
    const b = getEffectiveContextWindowSize('claude-sonnet-4-6', undefined)
    expect(a).toBe(b)
  })
})
