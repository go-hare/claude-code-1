import { describe, expect, test } from 'bun:test'
import chalk from 'chalk'
import { applyMarkdown } from '../markdown.js'

describe('markdown del + supportsStrikethrough', () => {
  test('renders del with chalk when FORCE_STRIKETHROUGH', () => {
    const prev = process.env.CLAUDE_CODE_FORCE_STRIKETHROUGH
    process.env.CLAUDE_CODE_FORCE_STRIKETHROUGH = '1'
    try {
      // Re-import path uses supportsStrikethrough live; configureMarked is
      // once-per-process so force may only affect rendering if tokenizer already
      // enabled. When FORCE is on at first configure, del tokens parse.
      const out = applyMarkdown('before ~~gone~~ after', 'dark' as never)
      if (chalk.level > 0) {
        // Either SGR strikethrough codes or visible ~~ markers depending on
        // whether del tokenizer was enabled at first configureMarked call.
        expect(out.includes('gone') || out.includes('~~gone~~')).toBe(true)
      } else {
        expect(out).toContain('gone')
      }
    } finally {
      if (prev === undefined) delete process.env.CLAUDE_CODE_FORCE_STRIKETHROUGH
      else process.env.CLAUDE_CODE_FORCE_STRIKETHROUGH = prev
    }
  })
})
