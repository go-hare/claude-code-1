import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import type { CliHighlight } from '../../utils/cliHighlight.js'
import {
  _clearHighlightCacheForTest,
  wrapHighlightWithCacheAndBudget,
} from '../Markdown.js'

describe('2.1.295 #398 & 2.1.296 #537 Markdown highlight cache & windowing', () => {
  afterEach(() => {
    _clearHighlightCacheForTest()
  })

  test('#537 caches syntax-highlighted code blocks across wrapper instances (ctrl+o toggle)', () => {
    let calls = 0
    const fakeHighlight: CliHighlight = {
      supportsLanguage: () => true,
      highlight(code, opts) {
        calls++
        return `<hl:${opts?.language ?? 'plain'}>${code}</hl>`
      },
    }

    const first = wrapHighlightWithCacheAndBudget(fakeHighlight, 'dark')!
    const out1 = first.highlight('const x = 1', { language: 'ts' })
    expect(out1).toBe('<hl:ts>const x = 1</hl>')
    expect(calls).toBe(1)

    // New wrapper instance simulating unmount/remount on ctrl+o toggle
    const second = wrapHighlightWithCacheAndBudget(fakeHighlight, 'dark')!
    const out2 = second.highlight('const x = 1', { language: 'ts' })
    expect(out2).toBe(out1)
    expect(calls).toBe(1)

    // Different theme misses cache
    const third = wrapHighlightWithCacheAndBudget(fakeHighlight, 'light')!
    third.highlight('const x = 1', { language: 'ts' })
    expect(calls).toBe(2)

    // skipHighlightCache bypasses cache
    const uncached = wrapHighlightWithCacheAndBudget(
      fakeHighlight,
      'dark',
      true,
    )!
    uncached.highlight('const x = 1', { language: 'ts' })
    expect(calls).toBe(3)
  })

  test('#398 caps per-message highlight work budget and windows huge markdown', () => {
    let calls = 0
    const fakeHighlight: CliHighlight = {
      supportsLanguage: () => true,
      highlight(code) {
        calls++
        return code
      },
    }
    const wrapped = wrapHighlightWithCacheAndBudget(
      fakeHighlight,
      'dark',
      true,
    )!
    const bigBlock = 'a'.repeat(1_600_005)
    expect(wrapped.highlight(bigBlock, { language: 'ts' })).toBe(bigBlock)
    expect(calls).toBe(1)

    // Next block exceeds budget and skips highlighting
    const nextOut = wrapped.highlight('const y = 2', { language: 'ts' })
    expect(nextOut).toContain('const y = 2')
    expect(calls).toBe(1)

    const src = readFileSync(join(import.meta.dir, '../Markdown.tsx'), 'utf8')
    expect(src).toContain('splitMarkdownWindows')
    expect(src).toContain('WINDOW_LINE_LIMIT = 1000')
  })
})
