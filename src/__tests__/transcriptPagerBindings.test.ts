import { describe, expect, test } from 'bun:test'
import type { Key, ScrollBoxHandle } from '@anthropic/ink'
import { resolveKey } from '@anthropic/ink'
import {
  applyModalPagerAction,
  modalPagerAction,
} from '../components/ScrollKeybindingHandler.js'
import { DEFAULT_BINDINGS } from '../keybindings/defaultBindings.js'
import { parseBindings } from '../keybindings/parser.js'
import { KEYBINDING_ACTIONS } from '../keybindings/schema.js'

describe('densable Transcript pager bindings', () => {
  test('scroll pager actions registered in schema', () => {
    for (const action of [
      'scroll:halfPageUp',
      'scroll:halfPageDown',
      'scroll:fullPageUp',
      'scroll:fullPageDown',
      'scroll:lineUp',
      'scroll:lineDown',
      'scroll:top',
      'scroll:bottom',
    ] as const) {
      expect(KEYBINDING_ACTIONS).toContain(action)
    }
  })

  test('defaultBindings Transcript densable pager map', () => {
    const block = DEFAULT_BINDINGS.find(b => b.context === 'Transcript')
    expect(block).toBeDefined()
    const b = block!.bindings
    expect(b['ctrl+u']).toBe('scroll:halfPageUp')
    expect(b['ctrl+d']).toBe('scroll:halfPageDown')
    expect(b['ctrl+b']).toBe('scroll:fullPageUp')
    expect(b['ctrl+f']).toBe('scroll:fullPageDown')
    expect(b['ctrl+n']).toBe('scroll:lineDown')
    expect(b['ctrl+p']).toBe('scroll:lineUp')
    expect(b.g).toBe('scroll:top')
    expect(b['shift+g']).toBe('scroll:bottom')
    expect(b.j).toBe('scroll:lineDown')
    expect(b.k).toBe('scroll:lineUp')
    expect(b.space).toBe('scroll:fullPageDown')
    expect(b.b).toBe('scroll:fullPageUp')
    expect(b.up).toBe('scroll:lineUp')
    expect(b.down).toBe('scroll:lineDown')
    expect(b.home).toBe('scroll:top')
    expect(b.end).toBe('scroll:bottom')
    // exit / show-all preserved
    expect(b['ctrl+e']).toBe('transcript:toggleShowAll')
    expect(b.q).toBe('transcript:exit')
    expect(b.escape).toBe('transcript:exit')
  })

  test('Scroll context does not default-bind half/full page keys', () => {
    const block = DEFAULT_BINDINGS.find(b => b.context === 'Scroll')
    expect(block).toBeDefined()
    const b = block!.bindings
    expect(b['ctrl+u']).toBeUndefined()
    expect(b['ctrl+d']).toBeUndefined()
    expect(b['ctrl+b']).toBeUndefined()
    expect(b['ctrl+f']).toBeUndefined()
    expect(b.g).toBeUndefined()
    expect(b.j).toBeUndefined()
    expect(b.space).toBeUndefined()
  })

  test('active Transcript last-wins over Global app:exit on ctrl+d', () => {
    const bindings = parseBindings(DEFAULT_BINDINGS)
    const key = {
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
      ctrl: true,
      shift: false,
      fn: false,
      tab: false,
      backspace: false,
      delete: false,
      meta: false,
      super: false,
    } as Key
    // Without Transcript: Global owns ctrl+d → app:exit
    expect(resolveKey('d', key, ['Global'], bindings)).toEqual({
      type: 'match',
      action: 'app:exit',
    })
    // With Transcript active (densable last-wins in DEFAULT order): pager
    expect(resolveKey('d', key, ['Transcript', 'Global'], bindings)).toEqual({
      type: 'match',
      action: 'scroll:halfPageDown',
    })
    expect(resolveKey('u', key, ['Transcript', 'Global'], bindings)).toEqual({
      type: 'match',
      action: 'scroll:halfPageUp',
    })
    // ctrl+c: transcript:exit when Transcript active
    expect(resolveKey('c', key, ['Transcript', 'Global'], bindings)).toEqual({
      type: 'match',
      action: 'transcript:exit',
    })
    // Search-open path: no Transcript elevate → Scroll resolve stays Global
    // so ctrl+d is app:exit (not halfPage stolen via Scroll handlers)
    expect(resolveKey('d', key, ['Scroll', 'Global'], bindings)).toEqual({
      type: 'match',
      action: 'app:exit',
    })
  })
})

describe('modalPagerAction (legacy raw-input map, still used by tests/helpers)', () => {
  const bare = {
    ctrl: false,
    meta: false,
    shift: false,
    upArrow: false,
    downArrow: false,
    home: false,
    end: false,
  }

  test('ctrl+u/d/b/f map to half/full page', () => {
    expect(modalPagerAction('u', { ...bare, ctrl: true })).toBe('halfPageUp')
    expect(modalPagerAction('d', { ...bare, ctrl: true })).toBe('halfPageDown')
    expect(modalPagerAction('b', { ...bare, ctrl: true })).toBe('fullPageUp')
    expect(modalPagerAction('f', { ...bare, ctrl: true })).toBe('fullPageDown')
  })

  test('g/G/j/k/space/b arrows home/end', () => {
    expect(modalPagerAction('g', bare)).toBe('top')
    expect(modalPagerAction('G', bare)).toBe('bottom')
    expect(modalPagerAction('g', { ...bare, shift: true })).toBe('bottom')
    expect(modalPagerAction('j', bare)).toBe('lineDown')
    expect(modalPagerAction('k', bare)).toBe('lineUp')
    expect(modalPagerAction(' ', bare)).toBe('fullPageDown')
    expect(modalPagerAction('b', bare)).toBe('fullPageUp')
    expect(modalPagerAction('', { ...bare, upArrow: true })).toBe('lineUp')
    expect(modalPagerAction('', { ...bare, downArrow: true })).toBe('lineDown')
    expect(modalPagerAction('', { ...bare, home: true })).toBe('top')
    expect(modalPagerAction('', { ...bare, end: true })).toBe('bottom')
  })
})

describe('applyModalPagerAction', () => {
  function makeHandle(
    overrides: Partial<ScrollBoxHandle> = {},
  ): ScrollBoxHandle {
    let scrollTop = 50
    const viewportHeight = 20
    const scrollHeight = 200
    return {
      getScrollTop: () => scrollTop,
      getViewportHeight: () => viewportHeight,
      getScrollHeight: () => scrollHeight,
      getPendingDelta: () => 0,
      getViewportTop: () => 0,
      scrollBy: (d: number) => {
        scrollTop += d
      },
      scrollTo: (y: number) => {
        scrollTop = y
      },
      scrollToBottom: () => {
        scrollTop = Math.max(0, scrollHeight - viewportHeight)
      },
      ...overrides,
    } as ScrollBoxHandle
  }

  test('half/full page and top/bottom', () => {
    const jumps: number[] = []
    const s = makeHandle()
    expect(applyModalPagerAction(s, 'halfPageDown', d => jumps.push(d))).toBe(
      false,
    )
    expect(jumps.at(-1)).toBe(10)
    expect(applyModalPagerAction(s, 'fullPageUp', d => jumps.push(d))).toBe(
      false,
    )
    expect(jumps.at(-1)).toBe(-20)
    expect(applyModalPagerAction(s, 'top', d => jumps.push(d))).toBe(false)
    expect(s.getScrollTop()).toBe(0)
    expect(applyModalPagerAction(s, 'bottom', () => {})).toBe(true)
    expect(s.getScrollTop()).toBe(180)
  })
})
