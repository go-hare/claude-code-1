import { describe, expect, test } from 'bun:test'
import {
  expandPasteVariants,
  findInlinePastedSpans,
  findNonOverlappingPasteSpans,
  getInlinePastedStrings,
} from '../history.js'
import type { PastedContent } from '../utils/config.js'

describe('v2.1.290 overlapping paste & NFD expanded paste (#107, #119)', () => {
  test('#119 expandPasteVariants normalizes NFD to NFC and strips leading combining marks', () => {
    const nfd = '\u0301cafe\u0301'
    const variants = expandPasteVariants(nfd)
    expect(variants).toContain(nfd)
    expect(variants).toContain('\u0301caf\u00e9')
    expect(variants).toContain('caf\u00e9')
  })

  test('#119 getInlinePastedStrings includes NFC-normalized variants of NFD inline pastes', () => {
    const pasted: Record<number, PastedContent> = {
      1: {
        id: 1,
        type: 'text',
        content: 're\u0301sume\u0301',
        inline: true,
      } as PastedContent,
    }
    const strings = getInlinePastedStrings(pasted)
    expect(strings).toContain('r\u00e9sum\u00e9')
    expect(strings).toContain('re\u0301sume\u0301')
  })

  test('#107 findInlinePastedSpans merges overlapping inline paste spans and skips ref placeholders', () => {
    const pasted: Record<number, PastedContent> = {
      1: {
        id: 1,
        type: 'text',
        content: 'alpha beta',
        inline: true,
      } as PastedContent,
      2: {
        id: 2,
        type: 'text',
        content: 'beta gamma',
        inline: true,
      } as PastedContent,
    }
    const input = 'prefix alpha beta gamma [Pasted text #1 +1 lines] alpha beta'
    const spans = findInlinePastedSpans(input, pasted)
    expect(spans).toEqual([
      [7, 17],
      [17, 23],
      [50, 60],
    ])
  })

  test('#107 findNonOverlappingPasteSpans resolves overlapping and adjacent pastes', () => {
    const text = 'hello world and world peace'
    const spans = findNonOverlappingPasteSpans(text, [
      'hello world',
      'world peace',
    ])
    expect(spans).toEqual([
      { from: 0, to: 11 },
      { from: 16, to: 27 },
    ])
  })
})
