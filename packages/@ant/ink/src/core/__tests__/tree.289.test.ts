import { describe, expect, test } from 'bun:test'
import { createNode } from '../dom.js'
import { InkTree } from '../tree.js'
import Yoga from '../yoga-layout/index.js'

describe('densable 2.1.289 jd InkTree', () => {
  test('box/text append marks layoutStale via scheduleRenderFrom', () => {
    const root = createNode('ink-root')
    let rendered = 0
    root.onRender = () => {
      rendered++
    }
    const tree = new InkTree(root)
    const box = tree.box()
    tree.append(root, box)
    expect(root.childNodes).toHaveLength(1)
    expect(root.layoutStale).toBe(true)
    expect(rendered).toBe(1)
    const label = tree.text('hi')
    tree.append(box, label)
    expect(rendered).toBe(2)
  })

  test('foreign node throws', () => {
    const root = createNode('ink-root')
    const tree = new InkTree(root)
    const outsider = createNode('ink-box')
    expect(() => tree.append(root, outsider)).toThrow(/not this tree/)
  })

  test('rect() is undefined without cachedLayout (gold cache-miss return)', () => {
    const root = createNode('ink-root')
    const tree = new InkTree(root)
    const span = tree.span('x')
    expect(span.cachedLayout).toBeUndefined()
    expect(tree.rect(span)).toBeUndefined()
    const box = tree.box()
    expect(box.yogaNode).toBeDefined()
    expect(box.cachedLayout).toBeUndefined()
    expect(tree.rect(box)).toBeUndefined()
  })

  test('rect() returns cachedLayout when present', () => {
    const root = createNode('ink-root')
    const tree = new InkTree(root)
    const box = tree.box()
    box.cachedLayout = { x: 1, y: 2, width: 3, height: 4 }
    expect(tree.rect(box)).toEqual({ x: 1, y: 2, width: 3, height: 4 })
  })

  test('create still marks own', () => {
    const root = createNode('ink-root')
    const tree = new InkTree(root)
    const box = tree.box()
    expect(() => tree.setStyle(box, { flexGrow: 1 })).not.toThrow()
    const outsider = createNode('ink-box')
    expect(() => tree.setStyle(outsider, {})).toThrow(/not this tree/)
  })

  test('tree.box inherits yogaNode.config from root (densable _r)', () => {
    const yogaConfig = Yoga.Config.create()
    const root = createNode('ink-root', yogaConfig)
    const tree = new InkTree(root)
    const box = tree.box()
    expect(box.yogaNode?.config).toBe(root.yogaNode?.config)
    expect(box.yogaNode?.config).toBe(yogaConfig)
  })

  test('text() uses densable Zn("wrap") not box defaults', () => {
    const root = createNode('ink-root')
    const tree = new InkTree(root)
    const label = tree.text('hi')
    expect(label.style).toEqual({
      flexGrow: 0,
      flexShrink: 1,
      flexDirection: 'row',
      textWrap: 'wrap',
    })
  })

  test('mustHold: span only inside text; box/text cannot nest in text', () => {
    const root = createNode('ink-root')
    const tree = new InkTree(root)
    const box = tree.box()
    const label = tree.text('hi')
    const nested = tree.span('x')
    tree.append(root, box)
    tree.append(box, label)
    expect(() => tree.append(box, nested)).toThrow(/span only goes inside text/)
    expect(() => tree.append(label, box)).toThrow(/only a span/)
    tree.append(label, nested)
    expect(label.childNodes).toContain(nested)
  })
})
