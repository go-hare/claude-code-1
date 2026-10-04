import { describe, expect, test } from 'bun:test'
import { createLayoutNode } from '../layout/engine.js'
import applyStyles from '../styles.js'

describe('undefined maxWidth is unconstrained', () => {
  test('maxWidth: undefined does not clamp a stretched row to 0', () => {
    const col = createLayoutNode()
    applyStyles(col, { flexDirection: 'column', width: 80 })
    const row = createLayoutNode()
    applyStyles(row, { flexDirection: 'row', maxWidth: undefined })
    col.insertChild(row, 0)
    col.calculateLayout(80)
    expect(col.getComputedWidth()).toBe(80)
    expect(row.getComputedWidth()).toBe(80)
  })

  test('numeric maxWidth still clamps', () => {
    const col = createLayoutNode()
    applyStyles(col, { flexDirection: 'column', width: 80 })
    const row = createLayoutNode()
    applyStyles(row, { flexDirection: 'row', maxWidth: 40 })
    col.insertChild(row, 0)
    col.calculateLayout(80)
    expect(row.getComputedWidth()).toBe(40)
  })
})
