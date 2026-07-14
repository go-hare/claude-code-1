import { describe, expect, test } from 'bun:test'
import {
  extractScreenReaderText,
  findScreenReaderNodeStartIndex,
  sanitizeScreenReaderText,
  type ScreenReaderDOMNode,
} from '../screenReaderTree.js'
import type { DOMElement, TextNode } from '../dom.js'

function text(value: string): TextNode {
  return {
    nodeName: '#text',
    nodeValue: value,
    parentNode: undefined,
    style: {},
  }
}

function box(
  children: ScreenReaderDOMNode[],
  opts?: {
    flexDirection?: 'row' | 'column' | 'row-reverse' | 'column-reverse'
    accessibility?: {
      hidden?: boolean
      label?: string
      role?: string
      state?: Record<string, boolean | undefined>
    }
  },
): DOMElement & { accessibility?: NonNullable<typeof opts>['accessibility'] } {
  const node = {
    nodeName: 'ink-box' as const,
    attributes: {},
    childNodes: children as DOMElement['childNodes'],
    parentNode: undefined,
    style: { flexDirection: opts?.flexDirection ?? 'column' },
    dirty: false,
    accessibility: opts?.accessibility,
  }
  for (const c of children) {
    c.parentNode = node as DOMElement
  }
  return node
}

function inkText(children: ScreenReaderDOMNode[]): DOMElement {
  const node: DOMElement = {
    nodeName: 'ink-text',
    attributes: {},
    childNodes: children as DOMElement['childNodes'],
    parentNode: undefined,
    style: {},
    dirty: false,
  }
  for (const c of children) {
    c.parentNode = node
  }
  return node
}

describe('sanitizeScreenReaderText', () => {
  test('keeps plain text', () => {
    expect(sanitizeScreenReaderText('hello')).toBe('hello')
  })

  test('strips ANSI and control chars', () => {
    expect(sanitizeScreenReaderText('\x1b[31mhi\x1b[0m')).toBe('hi')
    expect(sanitizeScreenReaderText('a\x07b')).toBe('ab')
  })

  test('keeps tab and newline', () => {
    expect(sanitizeScreenReaderText('a\tb\nc')).toBe('a\tb\nc')
  })
})

describe('extractScreenReaderText', () => {
  test('joins column children with newlines', () => {
    const root = box([inkText([text('hi')]), inkText([text('world')])], {
      flexDirection: 'column',
    })
    expect(extractScreenReaderText(root)).toBe('hi\nworld')
  })

  test('joins row children with spaces', () => {
    const root = box([inkText([text('a')]), inkText([text('b')])], {
      flexDirection: 'row',
    })
    expect(extractScreenReaderText(root)).toBe('a b')
  })

  test('uses accessibility label and role', () => {
    const root = box([inkText([text('x')])], {
      accessibility: { label: 'Search', role: 'button' },
    })
    expect(extractScreenReaderText(root)).toBe('button: Search')
  })

  test('skips hidden nodes', () => {
    const root = box(
      [
        box([inkText([text('visible')])]),
        box([inkText([text('gone')])], { accessibility: { hidden: true } }),
      ],
      { flexDirection: 'column' },
    )
    expect(extractScreenReaderText(root)).toBe('visible')
  })
})

describe('findScreenReaderNodeStartIndex', () => {
  test('returns offset of nested box', () => {
    const target = box([inkText([text('line1')])])
    const root = box([inkText([text('line0')]), target], {
      flexDirection: 'column',
    })
    // "line0\n" = 6 chars before target
    expect(findScreenReaderNodeStartIndex(root, target)).toBe(6)
  })

  test('returns 0 for root', () => {
    const root = box([inkText([text('x')])])
    expect(findScreenReaderNodeStartIndex(root, root)).toBe(0)
  })

  test('returns null when target not found', () => {
    const root = box([inkText([text('x')])])
    const other = box([inkText([text('y')])])
    expect(findScreenReaderNodeStartIndex(root, other)).toBeNull()
  })
})
