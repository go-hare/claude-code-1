/**
 * densable wTg — serializeNodeRows reads cachedLayout (nodeCache), no Yoga.
 */
import { describe, expect, test } from 'bun:test'
import { serializeNodeRows } from '../axcScreenSerialize.js'
import { createNode } from '../dom.js'
import { nodeCache } from '../node-cache.js'
import { CharPool, createScreen, HyperlinkPool, StylePool } from '../screen.js'

function makeFrame(width: number, height: number) {
  const stylePool = new StylePool()
  const screen = createScreen(
    width,
    height,
    stylePool,
    new CharPool(),
    new HyperlinkPool(),
  )
  return {
    frame: {
      screen,
      viewport: { width, height },
      cursor: { x: 0, y: 0, visible: true },
    },
    stylePool,
  }
}

describe('serializeNodeRows (gold wTg)', () => {
  test('null node → []', () => {
    const { frame, stylePool } = makeFrame(8, 6)
    expect(serializeNodeRows(frame, stylePool, null)).toEqual([])
  })

  test('no nodeCache → [] even when Yoga has a box', () => {
    const { frame, stylePool } = makeFrame(8, 6)
    const node = createNode('ink-box')
    node.yogaNode?.setWidth(8)
    node.yogaNode?.setHeight(3)
    node.yogaNode?.calculateLayout(8, 3)
    expect(node.yogaNode?.getComputedHeight()).toBe(3)
    expect(serializeNodeRows(frame, stylePool, node)).toEqual([])
  })

  test('uses nodeCache y/height, not Yoga', () => {
    const { frame, stylePool } = makeFrame(8, 6)
    const node = createNode('ink-box')
    node.yogaNode?.setWidth(8)
    node.yogaNode?.setHeight(5)
    node.yogaNode?.calculateLayout(8, 5)
    nodeCache.set(node, { x: 0, y: 2, width: 8, height: 2 })
    const rows = serializeNodeRows(frame, stylePool, node)
    expect(rows).toHaveLength(2)
  })

  test('height<=0 cache → []', () => {
    const { frame, stylePool } = makeFrame(8, 6)
    const node = createNode('ink-box')
    nodeCache.set(node, { x: 0, y: 0, width: 8, height: 0 })
    expect(serializeNodeRows(frame, stylePool, node)).toEqual([])
  })
})
