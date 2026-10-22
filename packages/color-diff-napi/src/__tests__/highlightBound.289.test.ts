/**
 * densable 2.1.289 `C` / `b` / `te` / `oe` / `ie` / `z` / `Se`.
 * Caps highlight.js so short blocks with many unclosed `<` or nested `${`
 * throw instead of freezing the terminal.
 */
import { describe, expect, test } from 'bun:test'
import hljsCore from 'highlight.js/lib/core'
import javascript from 'highlight.js/lib/languages/javascript'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  bindDefaultHighlightBudget,
  bindHighlightBudget,
  HighlightBoundError,
  HIGHLIGHT_BOUND_BASE,
  HIGHLIGHT_BOUND_CONSTRUCTOR,
  HIGHLIGHT_BOUND_MAX_HEIGHT,
  HIGHLIGHT_BOUND_PER_CHAR,
  HIGHLIGHT_BOUND_PER_SUBLANG,
  HIGHLIGHT_BOUND_SUBLANGUAGE_CAP,
  resolveHljsApi,
} from '../highlightBound.js'

const COLOR_FILE = readFileSync(join(import.meta.dir, '../index.ts'), 'utf8')

function freshHljs() {
  const hljs = hljsCore.newInstance()
  hljs.registerLanguage('javascript', javascript)
  bindDefaultHighlightBudget(resolveHljsApi(hljs))
  return hljs
}

describe('densable 2.1.289 Se highlight bound', () => {
  test('gold constants', () => {
    expect(HIGHLIGHT_BOUND_MAX_HEIGHT).toBe(32)
    expect(HIGHLIGHT_BOUND_SUBLANGUAGE_CAP).toBe(64)
    expect(HIGHLIGHT_BOUND_BASE).toBe(4096)
    expect(HIGHLIGHT_BOUND_PER_CHAR).toBe(24)
    expect(HIGHLIGHT_BOUND_PER_SUBLANG).toBe(3)
    expect(HIGHLIGHT_BOUND_CONSTRUCTOR).toBe(16)
    expect(new HighlightBoundError().message).toBe(
      'highlighting this text takes more work than its length allows',
    )
    expect(new HighlightBoundError().name).toBe('HighlightBoundError')
  })

  test('ColorFile binds Se and drops the language after a bound throw', () => {
    expect(COLOR_FILE).toContain(
      'bindDefaultHighlightBudget(resolveHljsApi(cachedHljs))',
    )
    expect(COLOR_FILE).toContain('state.lang = null')
  })

  test('second Se is a no-op once the emitter is bounded', () => {
    const hljs = freshHljs()
    const first = hljs.highlightAuto('', [])._emitter?.constructor
    bindHighlightBudget(resolveHljsApi(hljs), HIGHLIGHT_BOUND_SUBLANGUAGE_CAP)
    const second = hljs.highlightAuto('', [])._emitter?.constructor
    expect(first).toBe(second)
  })

  test('emitter is Bounded after Se', () => {
    const hljs = freshHljs()
    const ctor = hljs.highlightAuto('', [])._emitter?.constructor as {
      isBounded?: boolean
      name?: string
    }
    expect(ctor?.isBounded).toBe(true)
    expect(
      hljs.highlight('const x = 1', { language: 'javascript' }).value,
    ).toContain('x')
  })
})
