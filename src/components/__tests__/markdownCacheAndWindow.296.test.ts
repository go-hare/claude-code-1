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

    // Official 2.1.328 (Cr): plaintext blocks never consume budget or emit cap notices
    const plainOut = wrapped.highlight('plain text block', {
      language: 'plaintext',
    })
    expect(plainOut).toBe('plain text block')
    expect(calls).toBe(1)

    const src = readFileSync(join(import.meta.dir, '../Markdown.tsx'), 'utf8')
    expect(src).toContain('splitMarkdownWindows')
    expect(src).toContain('WINDOW_LINE_LIMIT = 1000')
    // Per-render fresh budget inside MarkdownBody's content-dependent useMemo
    expect(src).toContain(
      'const highlight = wrapHighlightWithCacheAndBudget(rawHighlight, theme, skipHighlightCache)',
    )
    // Official 2.1.328: leftoverHint uses dimColor, not color="subtle"
    expect(src).toContain('<Text dimColor> {leftoverHint}</Text>')
    expect(src).toContain('pushBlock(<Text dimColor>{leftoverHint}</Text>')
    expect(src).not.toContain('<Text color="subtle"> {leftoverHint}</Text>')
    expect(src).not.toContain('<Text color="subtle">{leftoverHint}</Text>')
  })

  test('2.1.328: plaintext blocks and cache hits do not drain highlight budget', () => {
    let calls = 0
    const fakeHighlight: CliHighlight = {
      supportsLanguage: () => true,
      highlight(code, opts) {
        calls++
        return `<hl:${opts?.language}>${code}</hl>`
      },
    }

    const wrapped = wrapHighlightWithCacheAndBudget(fakeHighlight, 'dark')!
    // Massive plaintext block (> 1.6M chars) must NOT consume budget or call rawHighlight
    const hugePlain = 'p'.repeat(2_000_000)
    expect(wrapped.highlight(hugePlain, { language: 'plaintext' })).toBe(
      hugePlain,
    )
    expect(wrapped.highlight(hugePlain, {})).toBe(hugePlain)
    expect(wrapped.highlight(hugePlain, { language: 'text' })).toBe(hugePlain)
    expect(calls).toBe(0)

    // Highlight a real TS block and cache-hit it repeatedly — budget must not drain on cache hits
    const bigTs = 'x'.repeat(1_000_000)
    const first = wrapped.highlight(bigTs, { language: 'ts' })
    expect(first).toBe(`<hl:ts>${bigTs}</hl>`)
    expect(calls).toBe(1)

    // Repeat identical block 5 times (5M chars total) — all cache hits, budget stays intact
    for (let i = 0; i < 5; i++) {
      expect(wrapped.highlight(bigTs, { language: 'ts' })).toBe(first)
    }
    expect(calls).toBe(1)

    // Another new TS block still fits inside remaining 600k budget
    const second = wrapped.highlight('const z = 3', { language: 'ts' })
    expect(second).toBe('<hl:ts>const z = 3</hl>')
    expect(calls).toBe(2)
  })
})
