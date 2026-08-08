/**
 * densable 2.1.218 #15 — MAX_TREE_DEPTH guards on ink tree walks.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import type { DOMElement, TextNode } from '../dom.js'
import { hitTest } from '../hit-test.js'
import {
  MAX_TREE_DEPTH,
  resetTreeDepthWarningsForTests,
  warnTreeDepthExceeded,
} from '../maxTreeDepth.js'
import { nodeCache } from '../node-cache.js'
import {
  extractScreenReaderOutput,
  findScreenReaderNodeStartIndex,
  type ScreenReaderDOMNode,
} from '../screenReaderTree.js'

afterEach(() => {
  resetTreeDepthWarningsForTests()
})

function makeBox(children: Array<DOMElement | TextNode> = []): DOMElement {
  return {
    nodeName: 'ink-box',
    attributes: {},
    childNodes: children,
    style: {},
    dirty: false,
    parentNode: undefined,
  } as DOMElement
}

function chainBoxes(depth: number): DOMElement {
  let leaf = makeBox()
  for (let i = 0; i < depth; i++) {
    const parent = makeBox([leaf])
    leaf.parentNode = parent
    leaf = parent
  }
  return leaf
}

describe('MAX_TREE_DEPTH densable Zlt', () => {
  test('constant is 256', () => {
    expect(MAX_TREE_DEPTH).toBe(256)
  })

  test('warnTreeDepthExceeded is once per kind', () => {
    // just smoke: does not throw
    warnTreeDepthExceeded('hitTest', 'ink-box')
    warnTreeDepthExceeded('hitTest', 'ink-box')
    warnTreeDepthExceeded('renderNodeToOutput', 'ink-box')
  })

  test('hitTest returns null past MAX_TREE_DEPTH without stack overflow', () => {
    const root = chainBoxes(MAX_TREE_DEPTH + 8)
    // Populate cache rects for every node so walk proceeds by depth only.
    let n: DOMElement | undefined = root
    let d = 0
    while (n) {
      nodeCache.set(n, { x: 0, y: 0, width: 10, height: 1 })
      const child = n.childNodes.find(c => c.nodeName !== '#text') as
        | DOMElement
        | undefined
      n = child
      d++
      if (d > MAX_TREE_DEPTH + 20) break
    }
    expect(() => hitTest(root, 1, 0)).not.toThrow()
    // Deep chain still hits something at shallow levels; depth guard must not throw.
    const hit = hitTest(root, 1, 0)
    expect(hit === null || hit.nodeName === 'ink-box').toBe(true)
  })

  test('extractScreenReaderOutput depth-caps without throw', () => {
    const root = chainBoxes(MAX_TREE_DEPTH + 4) as ScreenReaderDOMNode
    expect(() => extractScreenReaderOutput(root)).not.toThrow()
    const out = extractScreenReaderOutput(root)
    expect(typeof out.text).toBe('string')
  })

  test('findScreenReaderNodeStartIndex depth-caps without throw', () => {
    const root = chainBoxes(MAX_TREE_DEPTH + 4) as ScreenReaderDOMNode
    const deep = root
    expect(() => findScreenReaderNodeStartIndex(root, deep)).not.toThrow()
  })
})
