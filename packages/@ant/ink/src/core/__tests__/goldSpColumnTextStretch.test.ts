import { describe, expect, test } from 'bun:test'
import { createLayoutNode } from '../layout/engine.js'
import { LayoutMeasureMode } from '../layout/node.js'
import applyStyles from '../styles.js'
import measureText from '../measure-text.js'

const TEXT = '● Agent "Verify n events race" finished'

function inkTextStyles() {
  return {
    flexGrow: 0,
    flexShrink: 1,
    flexDirection: 'row' as const,
    textWrap: 'wrap' as const,
  }
}

function attachMeasure(
  node: ReturnType<typeof createLayoutNode>,
  text: string,
) {
  node.setMeasureFunc((width, widthMode) => {
    const dims = measureText(text, width)
    if (dims.width <= width) return dims
    if (widthMode === LayoutMeasureMode.Undefined) {
      return measureText(text, Number.POSITIVE_INFINITY)
    }
    const wrapped = measureText(text, width)
    return wrapped
  })
}

describe('gold Sp column Text stretch', () => {
  test('column 80 → Text (ink default) width is 80 not min-content', () => {
    const col = createLayoutNode()
    applyStyles(col, { flexDirection: 'column', width: 80 })
    const text = createLayoutNode()
    applyStyles(text, inkTextStyles())
    attachMeasure(text, TEXT)
    col.insertChild(text, 0)
    col.calculateLayout(80)
    expect(col.getComputedWidth()).toBe(80)
    expect(text.getComputedWidth()).toBe(80)
    expect(text.getComputedHeight()).toBe(1)
  })

  test('nested gold Sp: outer column 80 → inner column → Text is 80', () => {
    const outer = createLayoutNode()
    applyStyles(outer, { flexDirection: 'column', width: 80 })
    const inner = createLayoutNode()
    applyStyles(inner, { flexDirection: 'column' })
    const text = createLayoutNode()
    applyStyles(text, inkTextStyles())
    attachMeasure(text, TEXT)
    inner.insertChild(text, 0)
    outer.insertChild(inner, 0)
    outer.calculateLayout(80)
    expect(outer.getComputedWidth()).toBe(80)
    expect(inner.getComputedWidth()).toBe(80)
    expect(text.getComputedWidth()).toBe(80)
    expect(text.getComputedHeight()).toBe(1)
  })

  test('measureText reports unwrapped line width even when height wraps', () => {
    const dims = measureText(TEXT, 1)
    expect(dims.width).toBe(TEXT.length)
    expect(dims.height).toBe(TEXT.length)
  })
})
