import { describe, expect, test } from 'bun:test'
import type { Key } from '@anthropic/ink'
import { resolveKey } from '@anthropic/ink'
import { DEFAULT_BINDINGS } from '../keybindings/defaultBindings.js'
import { parseBindings } from '../keybindings/parser.js'
import { KEYBINDING_ACTIONS } from '../keybindings/schema.js'

describe('densable Settings half-page + period bindings', () => {
  test('schema actions present', () => {
    for (const a of [
      'settings:periodDay',
      'settings:periodWeek',
      'settings:sortByTokens',
      'scroll:halfPageUp',
      'scroll:halfPageDown',
    ] as const) {
      expect(KEYBINDING_ACTIONS).toContain(a)
    }
  })

  test('defaultBindings Settings densable map', () => {
    const block = DEFAULT_BINDINGS.find(b => b.context === 'Settings')
    expect(block).toBeDefined()
    const b = block!.bindings
    expect(b.d).toBe('settings:periodDay')
    expect(b.w).toBe('settings:periodWeek')
    expect(b.t).toBe('settings:sortByTokens')
    expect(b['ctrl+u']).toBe('scroll:halfPageUp')
    expect(b['ctrl+d']).toBe('scroll:halfPageDown')
    // fork keeps enter → settings:close (densable: select:accept)
    expect(b.enter).toBe('settings:close')
  })

  test('Settings last-wins over Global on ctrl+d/u', () => {
    const bindings = parseBindings(DEFAULT_BINDINGS)
    const ctrl = {
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
    expect(resolveKey('d', ctrl, ['Global'], bindings)).toEqual({
      type: 'match',
      action: 'app:exit',
    })
    expect(resolveKey('d', ctrl, ['Settings', 'Global'], bindings)).toEqual({
      type: 'match',
      action: 'scroll:halfPageDown',
    })
    expect(resolveKey('u', ctrl, ['Settings', 'Global'], bindings)).toEqual({
      type: 'match',
      action: 'scroll:halfPageUp',
    })
  })
})
