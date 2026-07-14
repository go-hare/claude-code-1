/**
 * Official 2.1.207 StreamingMarkdown freeze helpers (ths/isd/dpo/asd).
 * Pure-function coverage — no Ink render.
 */
import { describe, expect, test } from 'bun:test'
import {
  STREAM_MD_FREEZE_CHARS,
  STREAM_MD_SOFT_TAIL_CHARS,
  createStreamMarkdownState,
  findClosingFenceEnd,
  isClosingFenceLine,
  softSplitIndex,
  updateOpenFence,
} from '../Markdown.js'

describe('createStreamMarkdownState', () => {
  test('starts empty', () => {
    expect(createStreamMarkdownState()).toEqual({
      chunks: [],
      frozenSource: '',
      gapAfterChunks: false,
      stablePrefix: '',
      openFence: null,
    })
  })
})

describe('isClosingFenceLine / updateOpenFence', () => {
  test('opens on fence line and closes on matching fence', () => {
    expect(updateOpenFence(null, '```ts\n')).toBe('```ts')
    expect(updateOpenFence('```ts', 'code\n')).toBe('```ts')
    expect(updateOpenFence('```ts', '```\n')).toBeNull()
  })

  test('tilde fences and longer closers', () => {
    expect(updateOpenFence(null, '~~~~\n')).toBe('~~~~')
    expect(isClosingFenceLine('~~~', '~~~~', '')).toBe(true)
    expect(isClosingFenceLine('```', '``', '')).toBe(false)
    expect(isClosingFenceLine('```', '```', 'ts')).toBe(false)
  })

  test('nested-looking open inside open fence does not close early', () => {
    // Opening while already open is ignored until a real close.
    expect(updateOpenFence('```', '```js\n')).toBe('```')
  })
})

describe('findClosingFenceEnd', () => {
  test('returns index past closing fence + newline', () => {
    const src = 'const x = 1\n```\nmore'
    expect(findClosingFenceEnd(src, '```ts')).toBe('const x = 1\n```\n'.length)
  })

  test('returns -1 when still open', () => {
    expect(findClosingFenceEnd('still open\n', '```')).toBe(-1)
  })
})

describe('softSplitIndex', () => {
  test('prefers last newline when present late enough', () => {
    const body = `${'a'.repeat(3000)}\n${'b'.repeat(2000)}`
    const idx = softSplitIndex(body)
    expect(idx).toBe(3001) // after the newline
    expect(body[idx - 1]).toBe('\n')
  })

  test('keeps roughly SOFT_TAIL when no good break', () => {
    const body = 'x'.repeat(STREAM_MD_FREEZE_CHARS + 500)
    const idx = softSplitIndex(body)
    // soft split leaves ~SOFT_TAIL in the live tail
    expect(body.length - idx).toBeLessThanOrEqual(STREAM_MD_SOFT_TAIL_CHARS + 2)
    expect(idx).toBeGreaterThan(STREAM_MD_FREEZE_CHARS / 2)
  })
})
