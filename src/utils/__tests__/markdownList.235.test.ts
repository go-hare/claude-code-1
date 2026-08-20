import { describe, expect, test } from 'bun:test'
import stripAnsi from 'strip-ansi'
import {
  applyMarkdown,
  formatListMarker,
  getOrderedMarkerBody,
  LIST_INDENT_CAP,
  listNumberRange,
  protectOrderedListMarkers,
  shouldUseInkListLayout,
  spaces,
} from '../markdown.js'
import { marked, type Tokens } from 'marked'

function plain(md: string): string {
  return stripAnsi(applyMarkdown(md, 'dark' as never))
}

describe('densable 2.1.235 #3 md-list OIl + hanging', () => {
  test('LIST_INDENT_CAP is densable OIl=32', () => {
    expect(LIST_INDENT_CAP).toBe(32)
  })

  test('nested unordered list uses hanging nest indent (2 per level) until cap', () => {
    const out = plain(`- a
  - b
    - c
      - d
        - e`)
    expect(out).toBe(`- a
  - b
    - c
      - d
        - e`)
  })

  test('deep nest indent never exceeds OIl=32', () => {
    let md = '- d0'
    let indent = ''
    for (let i = 1; i <= 20; i++) {
      indent += '  '
      md += `\n${indent}- d${i}`
    }
    const lines = plain(md).split('\n')
    for (const line of lines) {
      const leading = line.match(/^(\s*)/)?.[1]?.length ?? 0
      expect(leading).toBeLessThanOrEqual(LIST_INDENT_CAP)
    }
    const lastLeading = lines.at(-1)?.match(/^(\s*)/)?.[1]?.length ?? 0
    expect(lastLeading).toBe(LIST_INDENT_CAP)
  })

  test('ordered markers: depth1 decimal, depth2 alpha, depth3 roman', () => {
    const out = plain(`1. one
   1. two
      1. three
         1. four`)
    expect(out).toBe(`1. one
   a. two
      i. three
         1. four`)
  })

  test('formatListMarker / G5T gates match densable MIl', () => {
    expect(formatListMarker(0, null)).toBe('-')
    expect(formatListMarker(0, { number: 2, first: 1, last: 3 })).toBe('2.')
    expect(formatListMarker(1, { number: 1, first: 1, last: 3 })).toBe('a.')
    expect(formatListMarker(2, { number: 1, first: 1, last: 3 })).toBe('i.')
    // first < 1 → fall back to decimal at alpha depth
    expect(getOrderedMarkerBody(2, { number: 1, first: 0, last: 3 })).toBe('1')
    // last > 3999 → fall back to decimal at roman depth
    expect(getOrderedMarkerBody(3, { number: 1, first: 1, last: 4000 })).toBe(
      '1',
    )
  })

  test('listNumberRange treats empty start as 1 (densable DIl)', () => {
    const list = {
      type: 'list',
      ordered: true,
      start: '',
      items: [{}, {}, {}],
    } as unknown as Tokens.List
    expect(listNumberRange(list)).toEqual({ first: 1, last: 3 })
  })

  test('hanging wrap prefixes continuation lines under marker', () => {
    // Soft-break continuation inside one list item (two text lines).
    const out = plain(`- first line
  second line continues`)
    const lines = out.split('\n')
    expect(lines[0]).toBe('- first line')
    // hanging = markerWidth("-")+1 = 2 spaces
    expect(lines[1]).toBe('  second line continues')
  })

  test('GFM task list renders densable [x]/[ ] box after marker', () => {
    expect(plain('- [x] done\n- [ ] todo')).toBe(`- [x] done
- [ ] todo`)
  })

  test('spaces / protectOrderedListMarkers helpers', () => {
    expect(spaces(0)).toBe('')
    expect(spaces(3)).toBe('   ')
    expect(spaces(Number.NaN)).toBe('')
    expect(protectOrderedListMarkers('see 1) next')).toBe('see 1) next')
  })

  test('shouldUseInkListLayout accepts shallow lists and rejects huge nests', () => {
    const small = marked.lexer('- a\n  - b')
    expect(shouldUseInkListLayout(small)).toBe(true)

    let deep = '- x'
    let indent = ''
    for (let i = 0; i < 70; i++) {
      indent += '  '
      deep += `\n${indent}- x`
    }
    const huge = marked.lexer(deep)
    expect(shouldUseInkListLayout(huge)).toBe(false)
  })
})
