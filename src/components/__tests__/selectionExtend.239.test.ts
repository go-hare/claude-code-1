// densable 2.1.239 #30 — selection:extend* so selection:copy keeps Shift+Arrow.
import { describe, expect, test } from 'bun:test'
import type { FocusMove, ScrollBoxHandle, SelectionState } from '@anthropic/ink'
import { DEFAULT_BINDINGS } from '../../keybindings/defaultBindings.js'
import { KEYBINDING_ACTIONS } from '../../keybindings/schema.js'
import {
  extendSelectionByKey,
  isSelectionVirtuallyInverted,
} from '../ScrollKeybindingHandler.js'

function scrollBindings(): Record<string, string | null> {
  return DEFAULT_BINDINGS.find(b => b.context === 'Scroll')?.bindings ?? {}
}

function stubScroll(partial: {
  getViewportTop: () => number
  getViewportHeight: () => number
  getScrollHeight: () => number
  getScrollTop: () => number
  getPendingDelta: () => number
  scrollBy: (dy: number) => void
}): ScrollBoxHandle {
  return partial as unknown as ScrollBoxHandle
}

function state(partial: Partial<SelectionState>): SelectionState {
  return {
    anchor: { col: 0, row: 2 },
    focus: { col: 3, row: 2 },
    isDragging: false,
    anchorSpan: null,
    scrolledOffAbove: [],
    scrolledOffBelow: [],
    scrolledOffAboveSW: [],
    scrolledOffBelowSW: [],
    lastPressHadAlt: false,
    ...partial,
  }
}

describe('densable 2.1.239 #30 selection:extend bindings', () => {
  test('Scroll default keys match official shift+arrow / home / end', () => {
    const scroll = scrollBindings()
    expect(scroll['shift+left']).toBe('selection:extendLeft')
    expect(scroll['shift+right']).toBe('selection:extendRight')
    expect(scroll['shift+up']).toBe('selection:extendUp')
    expect(scroll['shift+down']).toBe('selection:extendDown')
    expect(scroll['shift+home']).toBe('selection:extendLineStart')
    expect(scroll['shift+end']).toBe('selection:extendLineEnd')
    expect(scroll['ctrl+shift+c']).toBe('selection:copy')
  })

  test('schema lists the six extend actions', () => {
    expect(KEYBINDING_ACTIONS).toContain('selection:extendLeft')
    expect(KEYBINDING_ACTIONS).toContain('selection:extendRight')
    expect(KEYBINDING_ACTIONS).toContain('selection:extendUp')
    expect(KEYBINDING_ACTIONS).toContain('selection:extendDown')
    expect(KEYBINDING_ACTIONS).toContain('selection:extendLineStart')
    expect(KEYBINDING_ACTIONS).toContain('selection:extendLineEnd')
  })
})

describe('isSelectionVirtuallyInverted', () => {
  test('false when virtual rows are missing', () => {
    expect(isSelectionVirtuallyInverted(state({}))).toBe(false)
  })

  test('true when both virtual endpoints sit above the clamped rows', () => {
    expect(
      isSelectionVirtuallyInverted(
        state({
          virtualAnchorRow: 0,
          virtualFocusRow: 1,
          anchor: { col: 0, row: 4 },
          focus: { col: 0, row: 5 },
        }),
      ),
    ).toBe(true)
  })

  test('false when virtual endpoints straddle the clamped rows', () => {
    expect(
      isSelectionVirtuallyInverted(
        state({
          virtualAnchorRow: 0,
          virtualFocusRow: 8,
          anchor: { col: 0, row: 4 },
          focus: { col: 0, row: 5 },
        }),
      ),
    ).toBe(false)
  })
})

describe('extendSelectionByKey', () => {
  test('returns false when there is no selection', () => {
    const moved: FocusMove[] = []
    expect(
      extendSelectionByKey(
        'left',
        {
          hasSelection: () => false,
          getState: () => null,
          moveFocus: m => {
            moved.push(m)
          },
        },
        null,
        { current: null },
      ),
    ).toBe(false)
    expect(moved).toEqual([])
  })

  test('skips moveFocus when the selection is virtually inverted', () => {
    const moved: FocusMove[] = []
    const sel = state({
      virtualAnchorRow: 0,
      virtualFocusRow: 0,
      anchor: { col: 0, row: 3 },
      focus: { col: 0, row: 3 },
    })
    expect(
      extendSelectionByKey(
        'left',
        {
          hasSelection: () => true,
          getState: () => sel,
          moveFocus: m => {
            moved.push(m)
          },
        },
        null,
        { current: null },
      ),
    ).toBeUndefined()
    expect(moved).toEqual([])
  })

  test('moveFocus for left/right/home/end', () => {
    const moved: FocusMove[] = []
    const api = {
      hasSelection: () => true,
      getState: () => state({}),
      moveFocus: (m: FocusMove) => {
        moved.push(m)
      },
    }
    expect(extendSelectionByKey('left', api, null, { current: null })).toBe(
      true,
    )
    expect(extendSelectionByKey('lineEnd', api, null, { current: null })).toBe(
      true,
    )
    expect(moved).toEqual(['left', 'lineEnd'])
  })

  test('up at viewport top edge scrolls and does not moveFocus', () => {
    const moved: FocusMove[] = []
    const scrolled: number[] = []
    const lastCopied = { current: 'cached' as string | null }
    const sel = state({
      anchor: { col: 2, row: 12 },
      focus: { col: 4, row: 10 },
    })
    const scroll = stubScroll({
      getViewportTop: () => 10,
      getViewportHeight: () => 8,
      getScrollHeight: () => 40,
      getScrollTop: () => 3,
      getPendingDelta: () => 0,
      scrollBy: (dy: number) => {
        scrolled.push(dy)
      },
    })
    expect(
      extendSelectionByKey(
        'up',
        {
          hasSelection: () => true,
          getState: () => sel,
          moveFocus: m => {
            moved.push(m)
          },
        },
        scroll,
        lastCopied,
      ),
    ).toBeUndefined()
    expect(moved).toEqual([])
    expect(scrolled).toEqual([-1])
    expect(lastCopied.current).toBe(null)
    expect(sel.focus).toEqual({ col: 4, row: 10 })
    expect(sel.virtualFocusRow).toBe(9)
  })

  test('up at top edge with scrollTop=0 does not scroll or moveFocus', () => {
    const moved: FocusMove[] = []
    const scrolled: number[] = []
    const sel = state({
      anchor: { col: 2, row: 12 },
      focus: { col: 4, row: 10 },
    })
    expect(
      extendSelectionByKey(
        'up',
        {
          hasSelection: () => true,
          getState: () => sel,
          moveFocus: m => {
            moved.push(m)
          },
        },
        stubScroll({
          getViewportTop: () => 10,
          getViewportHeight: () => 8,
          getScrollHeight: () => 40,
          getScrollTop: () => 0,
          getPendingDelta: () => 0,
          scrollBy: (dy: number) => {
            scrolled.push(dy)
          },
        }),
        { current: 'cached' },
      ),
    ).toBeUndefined()
    expect(moved).toEqual([])
    expect(scrolled).toEqual([])
    expect(sel.virtualFocusRow).toBeUndefined()
  })

  test('up when focus is inside the viewport still moveFocus', () => {
    const moved: FocusMove[] = []
    const sel = state({
      anchor: { col: 2, row: 12 },
      focus: { col: 4, row: 14 },
    })
    expect(
      extendSelectionByKey(
        'up',
        {
          hasSelection: () => true,
          getState: () => sel,
          moveFocus: m => {
            moved.push(m)
          },
        },
        stubScroll({
          getViewportTop: () => 10,
          getViewportHeight: () => 8,
          getScrollHeight: () => 40,
          getScrollTop: () => 3,
          getPendingDelta: () => 0,
          scrollBy: () => {
            throw new Error('must not scroll')
          },
        }),
        { current: null },
      ),
    ).toBe(true)
    expect(moved).toEqual(['up'])
  })
})
