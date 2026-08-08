/**
 * densable 2.1.218 Batch D:
 * - Ozs formatDeletedTextAnnouncement
 * - pWr / GJc announce queue
 * - materializeScreenReaderLines preserveRanges trailing space (#13)
 */
import { afterEach, describe, expect, test } from 'bun:test'
import {
  announceDeletedText,
  clearScreenReaderAnnouncements,
  drainScreenReaderAnnouncements,
  formatDeletedTextAnnouncement,
  peekScreenReaderAnnouncements,
} from '../screenReaderAnnounce.js'
import {
  materializeScreenReaderLines,
  mergePreserveRanges,
} from '../screenReaderPark.js'
import {
  extractScreenReaderOutput,
  type ScreenReaderDOMNode,
} from '../screenReaderTree.js'
import type { DOMElement, TextNode } from '../dom.js'

afterEach(() => {
  clearScreenReaderAnnouncements()
})

describe('formatDeletedTextAnnouncement (densable Ozs)', () => {
  test('empty kill → undefined', () => {
    expect(formatDeletedTextAnnouncement('')).toBeUndefined()
  })

  test('mask → deleted', () => {
    expect(formatDeletedTextAnnouncement('secret', '*')).toBe('deleted')
  })

  test('whitespace-only newline → new line', () => {
    expect(formatDeletedTextAnnouncement('\n')).toBe('new line')
    expect(formatDeletedTextAnnouncement('  \n  ')).toBe('new line')
  })

  test('whitespace-only tab → tab', () => {
    expect(formatDeletedTextAnnouncement('\t')).toBe('tab')
  })

  test('whitespace-only space → space', () => {
    expect(formatDeletedTextAnnouncement('   ')).toBe('space')
  })

  test('normal text collapses newlines and trims', () => {
    expect(formatDeletedTextAnnouncement(' hello\nworld ')).toBe('hello world')
  })
})

describe('announce queue (densable pWr / GJc)', () => {
  test('drain returns and clears', () => {
    announceDeletedText('foo')
    announceDeletedText('bar')
    expect(peekScreenReaderAnnouncements()).toEqual(['foo', 'bar'])
    expect(drainScreenReaderAnnouncements()).toEqual(['foo', 'bar'])
    expect(drainScreenReaderAnnouncements()).toEqual([])
  })

  test('caps at 16', () => {
    for (let i = 0; i < 20; i++) announceDeletedText(`k${i}`)
    const q = drainScreenReaderAnnouncements()
    expect(q.length).toBe(16)
    expect(q[0]).toBe('k4')
    expect(q[15]).toBe('k19')
  })
})

describe('materializeScreenReaderLines preserveRanges (densable #13)', () => {
  test('default trims trailing spaces', () => {
    const { lines } = materializeScreenReaderLines('hello  ', 80)
    expect(lines).toEqual(['hello'])
  })

  test('preserveRanges keep trailing spaces on last segment', () => {
    const text = 'hello  '
    const { lines } = materializeScreenReaderLines(text, 80, [[0, text.length]])
    expect(lines).toEqual(['hello  '])
  })

  test('merge overlapping ranges', () => {
    expect(
      mergePreserveRanges([
        [0, 5],
        [3, 8],
        [10, 12],
      ]),
    ).toEqual([
      [0, 8],
      [10, 12],
    ])
  })
})

describe('extractScreenReaderOutput preserveWhitespace', () => {
  function text(value: string): TextNode {
    return {
      nodeName: '#text',
      nodeValue: value,
      parentNode: undefined,
      style: {},
    }
  }

  function inkText(
    children: ScreenReaderDOMNode[],
    accessibility?: { preserveWhitespace?: boolean },
  ): DOMElement {
    const node: DOMElement = {
      nodeName: 'ink-text',
      attributes: {},
      childNodes: children as DOMElement['childNodes'],
      parentNode: undefined,
      style: {},
      dirty: false,
      accessibility,
    }
    for (const c of children) {
      c.parentNode = node
    }
    return node
  }

  test('preserveWhitespace marks full range', () => {
    const node = inkText([text('hi  ')], { preserveWhitespace: true })
    const out = extractScreenReaderOutput(node)
    expect(out.text).toBe('hi  ')
    expect(out.preserveRanges).toEqual([[0, 4]])
  })
})
