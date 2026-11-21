import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { marked } from 'marked'
import { join } from 'path'
import {
  type CliHighlight,
  HIGHLIGHT_MESSAGE_WORK_BUDGET,
  peekCliHighlight,
} from '../../utils/cliHighlight.js'
import { formatToken } from '../../utils/markdown.js'
import {
  _clearHighlightCacheForTest,
  collectCodeTokensInDocumentOrder,
  prehighlightCodeTokens,
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

  test('#398 & 2.1.328 passes shared work budget down to highlighter and windows huge markdown', () => {
    let calls = 0
    const seenWork: Array<{ left: number }> = []
    const fakeHighlight: CliHighlight = {
      supportsLanguage: () => true,
      highlight(code, opts) {
        calls++
        if (opts?.work) {
          seenWork.push(opts.work)
          // Simulate real highlighter exhausting the shared work budget
          opts.work.left -= HIGHLIGHT_MESSAGE_WORK_BUDGET + 1
        }
        return code
      },
    }
    const wrapped = wrapHighlightWithCacheAndBudget(
      fakeHighlight,
      'dark',
      true,
    )!
    expect(wrapped.highlight('const x = 1', { language: 'ts' })).toBe(
      'const x = 1',
    )
    expect(calls).toBe(1)
    expect(seenWork.length).toBe(1)
    expect(seenWork[0]!.left).toBeLessThanOrEqual(0)

    // Next block sees exhausted work.left <= 0 and skips highlighting
    const nextOut = wrapped.highlight('const y = 2', { language: 'ts' })
    expect(nextOut).toContain('const y = 2')
    expect(calls).toBe(1)

    // Official 2.1.328 (Cr): plaintext blocks never consume budget or emit cap notices
    const plainOut = wrapped.highlight('plain text block', {
      language: 'plaintext',
    })
    expect(plainOut).toBe('plain text block')
    expect(calls).toBe(1)

    // Real peekCliHighlight() charges real highlight.js emitter work onto work.left
    const real = peekCliHighlight()
    expect(real).not.toBeNull()
    const work = { left: HIGHLIGHT_MESSAGE_WORK_BUDGET }
    const sample =
      'export function add(a: number, b: number): number { return a + b; }\n'.repeat(
        20,
      )
    real!.highlight(sample, { language: 'typescript', work })
    expect(work.left).toBeLessThan(HIGHLIGHT_MESSAGE_WORK_BUDGET)
    expect(HIGHLIGHT_MESSAGE_WORK_BUDGET - work.left).not.toBe(sample.length)

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
        if (opts?.work) {
          opts.work.left -= 800_000
        }
        return `<hl:${opts?.language}>${code}</hl>`
      },
    }

    const wrapped = wrapHighlightWithCacheAndBudget(fakeHighlight, 'dark')!
    // Massive plaintext block must NOT consume budget or call rawHighlight
    const hugePlain = 'p'.repeat(2_000_000)
    expect(wrapped.highlight(hugePlain, { language: 'plaintext' })).toBe(
      hugePlain,
    )
    expect(wrapped.highlight(hugePlain, {})).toBe(hugePlain)
    expect(wrapped.highlight(hugePlain, { language: 'text' })).toBe(hugePlain)
    expect(calls).toBe(0)

    // Highlight a real TS block and cache-hit it repeatedly — budget must not drain on cache hits
    const bigTs = 'x'.repeat(1_000)
    const first = wrapped.highlight(bigTs, { language: 'ts' })
    expect(first).toBe(`<hl:ts>${bigTs}</hl>`)
    expect(calls).toBe(1)

    // Repeat identical block 5 times — all cache hits, budget stays intact
    for (let i = 0; i < 5; i++) {
      expect(wrapped.highlight(bigTs, { language: 'ts' })).toBe(first)
    }
    expect(calls).toBe(1)

    // Another new TS block still fits inside remaining work budget
    const second = wrapped.highlight('const z = 3', { language: 'ts' })
    expect(second).toBe('<hl:ts>const z = 3</hl>')
    expect(calls).toBe(2)
  })

  test('P1-#19: formatToken passes fence token so byFence reuses output across re-renders and prehighlightCodeTokens walks nested tokens in document order', () => {
    const md = [
      '> Quoted code first:',
      '> ```ts',
      '> const first = 1',
      '> ```',
      '',
      '- List item with code second:',
      '',
      '  ```ts',
      '  const second = 2',
      '  ```',
      '',
      '```ts',
      'const third = 3',
      '```',
    ].join('\n')
    const tokens = marked.lexer(md)
    const ordered = collectCodeTokensInDocumentOrder(tokens)
    expect(ordered.map(t => t.text.trim())).toEqual([
      'const first = 1',
      'const second = 2',
      'const third = 3',
    ])

    const seenOrder: string[] = []
    const seenFences: unknown[] = []
    const fakeHighlight: CliHighlight = {
      supportsLanguage: () => true,
      highlight(code, opts) {
        seenOrder.push(code.trim())
        seenFences.push(opts?.fence)
        if (opts?.work) {
          // Allow 1st and 2nd fences to highlight; exhaust budget on 2nd so 3rd stops
          opts.work.left -= Math.ceil(HIGHLIGHT_MESSAGE_WORK_BUDGET * 0.6)
        }
        return `<hl>${code}</hl>`
      },
    }

    const wrapped = wrapHighlightWithCacheAndBudget(
      fakeHighlight,
      'dark',
      true,
    )!
    prehighlightCodeTokens(tokens, 'dark', wrapped)

    // Strict top-to-bottom document order: blockquote -> list -> top-level
    expect(seenOrder).toEqual(['const first = 1', 'const second = 2'])
    expect(seenFences[0]).toBe(ordered[0])
    expect(seenFences[1]).toBe(ordered[1])

    // Rendering the 3rd (top-level) token later hits byFence — no extra highlight calls
    // and preserves the over-budget output computed during document-order walk
    const thirdOut = formatToken(ordered[2]!, 'dark', 0, null, null, wrapped)
    expect(thirdOut).not.toContain('<hl>')
    expect(thirdOut).toContain('const third = 3')
    expect(seenOrder).toEqual(['const first = 1', 'const second = 2'])

    // Re-rendering the 1st (blockquote) token on resize hits byFence directly —
    // does NOT re-call rawHighlight and does NOT get stopped by the now-exhausted budget!
    const firstAgain = formatToken(ordered[0]!, 'dark', 0, null, null, wrapped)
    expect(firstAgain).toContain('<hl>const first = 1</hl>')
    expect(seenOrder).toEqual(['const first = 1', 'const second = 2'])
  })
})
