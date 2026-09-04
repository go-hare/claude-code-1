import { describe, expect, test } from 'bun:test'
import type { LspToolChange } from '../activateAfterInstall.js'

describe('densable 2.1.243 #28 reload cache impact formula', () => {
  test('wouldInvalidateCache includes lspToolChange (Fn)', () => {
    const rows: Array<[boolean, LspToolChange, boolean, boolean, boolean]> = [
      // mcpChanged, lspToolChange, toolSearch, tokens, expected
      [false, 'removes', false, true, true],
      [false, null, false, true, false],
      [true, null, false, true, true],
      [false, 'adds', true, true, false],
      [false, 'removes', false, false, false],
    ]
    for (const [
      mcpChanged,
      lspToolChange,
      toolSearch,
      tokens,
      expected,
    ] of rows) {
      const wouldInvalidateCache =
        (mcpChanged || lspToolChange !== null) && !toolSearch && tokens
      expect(wouldInvalidateCache).toBe(expected)
    }
  })
})
