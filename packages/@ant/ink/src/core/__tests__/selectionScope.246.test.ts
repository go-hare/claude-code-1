/**
 * densable 2.1.246 `Cy(root, col, row)` — selectionScope walker.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { createNode, type DOMElement } from '../dom.js'
import { nodeCache } from '../node-cache.js'
import { selectionScopeAt } from '../selection.js'

const inkSrc = readFileSync(join(import.meta.dir, '../ink.tsx'), 'utf8')
const selSrc = readFileSync(join(import.meta.dir, '../selection.ts'), 'utf8')

function box(
  style: DOMElement['style'],
  layout: { x: number; y: number; width: number; height: number },
  parent?: DOMElement,
): DOMElement {
  const node = createNode('ink-box')
  node.style = style
  node.parentNode = parent
  if (parent) parent.childNodes.push(node)
  nodeCache.set(node, layout)
  return node
}

describe('densable 2.1.246 Cy selectionScopeAt', () => {
  test('ink startSelection and multi-click pass Cy(rootNode)', () => {
    expect(inkSrc).toContain('selectionScopeAt(this.rootNode, col, row)')
    expect(
      inkSrc.match(/selectionScopeAt\(this\.rootNode, col, row\)/g)?.length,
    ).toBe(2)
  })

  test('no selectionScope ancestor → undefined', () => {
    const root = box(
      { overflow: 'hidden' },
      { x: 0, y: 0, width: 20, height: 4 },
    )
    box({}, { x: 2, y: 1, width: 8, height: 1 }, root)
    expect(selectionScopeAt(root, 3, 1)).toBeUndefined()
  })

  test('first selectionScope seeds x1/x2; overflow parent clamps', () => {
    const root = box(
      { overflowX: 'hidden' },
      { x: 0, y: 0, width: 10, height: 4 },
    )
    const scoped = box(
      { selectionScope: true },
      { x: 2, y: 1, width: 12, height: 2 },
      root,
    )
    const hit = box({}, { x: 3, y: 1, width: 4, height: 1 }, scoped)
    const scope = selectionScopeAt(root, 4, 1)
    expect(scope?.node).toBe(scoped)
    expect(scope).toEqual({ x1: 2, x2: 10, node: scoped })
    expect(hit.style.selectionScope).toBeUndefined()
  })

  test('source-locks official x2>x1 drop', () => {
    expect(selSrc).toContain('scope && scope.x2 > scope.x1 ? scope : undefined')
  })
})
