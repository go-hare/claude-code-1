import { describe, expect, test } from 'bun:test'
import {
  isBothEndsVirtualOvershoot,
  selectionFocusMoveForKey,
} from '../components/ScrollKeybindingHandler.js'
import { DEFAULT_BINDINGS } from '../keybindings/defaultBindings.js'
import { KEYBINDING_ACTIONS } from '../keybindings/schema.js'
import type { Key } from '@anthropic/ink'
import type { SelectionState } from '@anthropic/ink'

function key(partial: Partial<Key>): Key {
  return {
    upArrow: false,
    downArrow: false,
    leftArrow: false,
    rightArrow: false,
    pageDown: false,
    pageUp: false,
    home: false,
    end: false,
    return: false,
    escape: false,
    ctrl: false,
    shift: false,
    tab: false,
    backspace: false,
    delete: false,
    meta: false,
    super: false,
    ...partial,
  } as Key
}

describe('selection:extend* densable bindings', () => {
  test('actions registered in schema', () => {
    for (const a of [
      'selection:extendLeft',
      'selection:extendRight',
      'selection:extendUp',
      'selection:extendDown',
      'selection:extendLineStart',
      'selection:extendLineEnd',
      'selection:clear',
      'selection:copy',
      'scroll:pageUp',
    ] as const) {
      expect(KEYBINDING_ACTIONS).toContain(a)
    }
  })

  test('Scroll defaults bind shift+nav to extend', () => {
    const block = DEFAULT_BINDINGS.find(b => b.context === 'Scroll')
    expect(block?.bindings['shift+left']).toBe('selection:extendLeft')
    expect(block?.bindings['shift+right']).toBe('selection:extendRight')
    expect(block?.bindings['shift+up']).toBe('selection:extendUp')
    expect(block?.bindings['shift+down']).toBe('selection:extendDown')
    expect(block?.bindings['shift+home']).toBe('selection:extendLineStart')
    expect(block?.bindings['shift+end']).toBe('selection:extendLineEnd')
  })
})

describe('selectionFocusMoveForKey', () => {
  test('maps shift+arrows/home/end', () => {
    expect(
      selectionFocusMoveForKey(key({ shift: true, leftArrow: true })),
    ).toBe('left')
    expect(
      selectionFocusMoveForKey(key({ shift: true, rightArrow: true })),
    ).toBe('right')
    expect(selectionFocusMoveForKey(key({ shift: true, upArrow: true }))).toBe(
      'up',
    )
    expect(
      selectionFocusMoveForKey(key({ shift: true, downArrow: true })),
    ).toBe('down')
    expect(selectionFocusMoveForKey(key({ shift: true, home: true }))).toBe(
      'lineStart',
    )
    expect(selectionFocusMoveForKey(key({ shift: true, end: true }))).toBe(
      'lineEnd',
    )
  })
  test('ignores without shift or with meta', () => {
    expect(selectionFocusMoveForKey(key({ leftArrow: true }))).toBe(null)
    expect(
      selectionFocusMoveForKey(
        key({ shift: true, meta: true, leftArrow: true }),
      ),
    ).toBe(null)
  })
})

describe('isBothEndsVirtualOvershoot (densable bnt)', () => {
  test('false without virtual rows', () => {
    const s = {
      anchor: { col: 0, row: 5 },
      focus: { col: 3, row: 8 },
    } as SelectionState
    expect(isBothEndsVirtualOvershoot(s)).toBe(false)
  })
  test('true when both virtual rows overshoot same edge', () => {
    const s = {
      anchor: { col: 0, row: 5 },
      focus: { col: 3, row: 5 },
      virtualAnchorRow: 2,
      virtualFocusRow: 1,
    } as SelectionState
    expect(isBothEndsVirtualOvershoot(s)).toBe(true)
  })
})
