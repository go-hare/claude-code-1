import { describe, expect, test } from 'bun:test'
import applyStyles from '../styles.js'
import { createNode, createTextNode } from '../dom.js'

function layoutStreamingText(text: string, width: number) {
  const col = createNode('ink-box')
  applyStyles(col.yogaNode!, { flexDirection: 'column', width })
  const inkText = createNode('ink-text')
  inkText.style = {
    flexGrow: 0,
    flexShrink: 1,
    flexDirection: 'row',
    textWrap: 'wrap-stream',
  }
  applyStyles(inkText.yogaNode!, inkText.style)
  const leaf = createTextNode(text)
  leaf.parentNode = inkText
  inkText.childNodes.push(leaf)
  col.yogaNode!.insertChild(inkText.yogaNode!, 0)
  col.yogaNode!.calculateLayout(width)
  return inkText.yogaNode!
}

describe('densable h1 wrap-stream measure (before fits-in-container)', () => {
  test('a short open sentence is height 0 (last visual row dropped)', () => {
    const node = layoutStreamingText('short', 80)
    expect(node.getComputedHeight()).toBe(0)
  })

  test('a wrapping first paragraph keeps height after the pop', () => {
    const node = layoutStreamingText('A'.repeat(50), 10)
    expect(node.getComputedHeight()).toBeGreaterThan(0)
  })

  test('in-flow ● next to wrap-stream is still height 1 (lone bullet)', () => {
    const col = createNode('ink-box')
    applyStyles(col.yogaNode!, { flexDirection: 'column', width: 80 })
    const row = createNode('ink-box')
    applyStyles(row.yogaNode!, { flexDirection: 'row' })
    const bullet = createNode('ink-text')
    applyStyles(bullet.yogaNode!, {
      flexGrow: 0,
      flexShrink: 1,
      flexDirection: 'row',
    })
    const bulletLeaf = createTextNode('●')
    bulletLeaf.parentNode = bullet
    bullet.childNodes.push(bulletLeaf)
    const stream = createNode('ink-text')
    stream.style = {
      flexGrow: 0,
      flexShrink: 1,
      flexDirection: 'row',
      textWrap: 'wrap-stream',
    }
    applyStyles(stream.yogaNode!, stream.style)
    const streamLeaf = createTextNode('short')
    streamLeaf.parentNode = stream
    stream.childNodes.push(streamLeaf)
    col.yogaNode!.insertChild(row.yogaNode!, 0)
    row.yogaNode!.insertChild(bullet.yogaNode!, 0)
    row.yogaNode!.insertChild(stream.yogaNode!, 1)
    col.yogaNode!.calculateLayout(80)
    expect(bullet.yogaNode!.getComputedHeight()).toBe(1)
    expect(row.yogaNode!.getComputedHeight()).toBeGreaterThanOrEqual(1)
  })
})
