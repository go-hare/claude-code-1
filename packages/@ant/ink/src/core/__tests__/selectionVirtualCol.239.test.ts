import { describe, expect, test } from 'bun:test'
import {
  clearSelection,
  createSelectionState,
  selectionColRange,
  selectionOwnsScroll,
  shiftSelection,
  startSelection,
} from '../selection.js'

describe('densable 2.1.239 SelectionState scope + virtualFocusCol', () => {
  test('o9r full width when scope is unset', () => {
    const s = createSelectionState()
    expect(selectionColRange(s, 80)).toEqual({ lo: 0, hi: 79 })
  })

  test('d7a stores scope; o9r clamps to [x1, x2)', () => {
    const s = createSelectionState()
    startSelection(s, 3, 2, { x1: 2, x2: 10 })
    expect(s.scope).toEqual({ x1: 2, x2: 10 })
    expect(s.anchor).toEqual({ col: 3, row: 2 })
    expect(selectionColRange(s, 80)).toEqual({ lo: 2, hi: 9 })
  })

  test('ybf restores virtualFocusCol when the row comes back in view', () => {
    const s = createSelectionState()
    startSelection(s, 7, 4)
    s.focus = { col: 7, row: 1 }
    s.isDragging = false
    // Only focus overshoots (anchor stays in view) so we do not clear.
    shiftSelection(s, -2, 0, 5, 40)
    expect(s.virtualFocusRow).toBe(-1)
    expect(s.virtualFocusCol).toBe(7)
    expect(s.focus).toEqual({ col: 0, row: 0 })
    expect(s.anchor).toEqual({ col: 7, row: 2 })
    shiftSelection(s, 2, 0, 5, 40)
    expect(s.virtualFocusCol).toBeUndefined()
    expect(s.focus).toEqual({ col: 7, row: 1 })
    expect(s.anchor).toEqual({ col: 7, row: 4 })
  })

  test('ybf keeps selection when both ends leave the viewport', () => {
    const s = createSelectionState()
    startSelection(s, 2, 1)
    s.focus = { col: 4, row: 2 }
    s.isDragging = false
    shiftSelection(s, -8, 0, 5, 40)
    expect(s.anchor).not.toBeNull()
    expect(s.focus).not.toBeNull()
    expect(s.virtualAnchorRow).toBe(-7)
    expect(s.virtualFocusRow).toBe(-6)
  })

  test('OEc: unset node owns any scroll; set node must match getDomElement', () => {
    const s = createSelectionState()
    const dom = { id: 'scroll-a' }
    expect(selectionOwnsScroll(s, { getDomElement: () => dom })).toBe(true)
    expect(selectionOwnsScroll(null, { getDomElement: () => dom })).toBe(true)
    s.scope = { x1: 0, x2: 10, node: dom }
    expect(selectionOwnsScroll(s, { getDomElement: () => dom })).toBe(true)
    expect(
      selectionOwnsScroll(s, { getDomElement: () => ({ id: 'other' }) }),
    ).toBe(false)
    expect(selectionOwnsScroll(s, null)).toBe(false)
  })

  test('aYn clear drops scope and virtual cols', () => {
    const s = createSelectionState()
    startSelection(s, 1, 0, { x1: 0, x2: 4 })
    s.virtualFocusCol = 2
    clearSelection(s)
    expect(s.scope).toBeUndefined()
    expect(s.virtualFocusCol).toBeUndefined()
    expect(s.virtualAnchorCol).toBeUndefined()
  })
})
