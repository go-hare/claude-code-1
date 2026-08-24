import { describe, expect, test } from 'bun:test'
import type { Key } from '@anthropic/ink'
import {
  createSelectionClearKeyDownCapture,
  shouldClearSelectionOnKey,
  shouldClearSelectionOnNamedKey,
} from '../ScrollKeybindingHandler.js'

function key(partial: Partial<Key>): Key {
  return {
    upArrow: false,
    downArrow: false,
    leftArrow: false,
    rightArrow: false,
    pageDown: false,
    pageUp: false,
    wheelUp: false,
    wheelDown: false,
    home: false,
    end: false,
    return: false,
    escape: false,
    ctrl: false,
    shift: false,
    fn: false,
    tab: false,
    backspace: false,
    delete: false,
    meta: false,
    super: false,
    ...partial,
  }
}

describe('shouldClearSelectionOnKey densable bvh/Jew 2.1.234', () => {
  test('escape does not clear (#45)', () => {
    expect(shouldClearSelectionOnKey(key({ escape: true }))).toBe(false)
  })

  test('pageup/pagedown do not clear', () => {
    expect(shouldClearSelectionOnKey(key({ pageUp: true }))).toBe(false)
    expect(shouldClearSelectionOnKey(key({ pageDown: true }))).toBe(false)
  })

  test('ctrl+home/end do not clear', () => {
    expect(shouldClearSelectionOnKey(key({ home: true, ctrl: true }))).toBe(
      false,
    )
    expect(shouldClearSelectionOnKey(key({ end: true, ctrl: true }))).toBe(
      false,
    )
  })

  test('wheel does not clear', () => {
    expect(shouldClearSelectionOnKey(key({ wheelUp: true }))).toBe(false)
    expect(shouldClearSelectionOnKey(key({ wheelDown: true }))).toBe(false)
  })

  test('shift/meta/super + nav does not clear', () => {
    expect(
      shouldClearSelectionOnKey(key({ leftArrow: true, shift: true })),
    ).toBe(false)
    expect(shouldClearSelectionOnKey(key({ upArrow: true, meta: true }))).toBe(
      false,
    )
    expect(shouldClearSelectionOnKey(key({ home: true, super: true }))).toBe(
      false,
    )
  })

  test('bare printable / bare arrow clears', () => {
    expect(shouldClearSelectionOnKey(key({}))).toBe(true)
    expect(shouldClearSelectionOnKey(key({ leftArrow: true }))).toBe(true)
    expect(shouldClearSelectionOnKey(key({ return: true }))).toBe(true)
  })

  test('bare home/end clear (no ctrl)', () => {
    expect(shouldClearSelectionOnKey(key({ home: true }))).toBe(true)
    expect(shouldClearSelectionOnKey(key({ end: true }))).toBe(true)
  })
})

describe('shouldClearSelectionOnNamedKey densable Jew 2.1.234', () => {
  function named(
    partial: Partial<{
      name: string
      ctrl: boolean
      shift: boolean
      meta: boolean
      superKey: boolean
    }>,
  ) {
    return {
      name: '',
      ctrl: false,
      shift: false,
      meta: false,
      superKey: false,
      ...partial,
    }
  }

  test('escape/pageup/pagedown do not clear', () => {
    expect(shouldClearSelectionOnNamedKey(named({ name: 'escape' }))).toBe(
      false,
    )
    expect(shouldClearSelectionOnNamedKey(named({ name: 'pageup' }))).toBe(
      false,
    )
    expect(shouldClearSelectionOnNamedKey(named({ name: 'pagedown' }))).toBe(
      false,
    )
  })

  test('ctrl+home/end do not clear; shift+arrow does not', () => {
    expect(
      shouldClearSelectionOnNamedKey(named({ name: 'home', ctrl: true })),
    ).toBe(false)
    expect(
      shouldClearSelectionOnNamedKey(named({ name: 'left', shift: true })),
    ).toBe(false)
  })

  test('bare printable / arrow clears', () => {
    expect(shouldClearSelectionOnNamedKey(named({ name: 'a' }))).toBe(true)
    expect(shouldClearSelectionOnNamedKey(named({ name: 'left' }))).toBe(true)
  })
})

describe('createSelectionClearKeyDownCapture densable vvh 2.1.234', () => {
  function makeSelection() {
    let selected = true
    return {
      hasSelection: () => selected,
      clearSelection: () => {
        selected = false
      },
      copySelection: () => {
        selected = false
        return 'x'
      },
      _isSelected: () => selected,
    }
  }

  function event(
    partial: Partial<{
      key: string
      name: string
      ctrl: boolean
      shift: boolean
      meta: boolean
      superKey: boolean
    }>,
  ) {
    let consumed = false
    return {
      key: '',
      name: '',
      ctrl: false,
      shift: false,
      meta: false,
      superKey: false,
      stopImmediatePropagation: () => {
        consumed = true
      },
      preventDefault: () => {
        consumed = true
      },
      wasConsumed: () => consumed,
      ...partial,
    }
  }

  test('escape does not clear when selected', () => {
    const sel = makeSelection()
    const handler = createSelectionClearKeyDownCapture(sel, true)
    const ev = event({ name: 'escape', key: 'Escape' })
    handler(ev)
    expect(sel._isSelected()).toBe(true)
    expect(ev.wasConsumed()).toBe(false)
  })

  test('ctrl+c clears when copyOnSelect true; consumes', () => {
    const sel = makeSelection()
    const handler = createSelectionClearKeyDownCapture(sel, true)
    const ev = event({ key: 'c', name: 'c', ctrl: true })
    handler(ev)
    expect(sel._isSelected()).toBe(false)
    expect(ev.wasConsumed()).toBe(true)
  })

  test('bare letter clears via Jew', () => {
    const sel = makeSelection()
    const handler = createSelectionClearKeyDownCapture(sel, true)
    handler(event({ key: 'a', name: 'a' }))
    expect(sel._isSelected()).toBe(false)
  })
})
