import { describe, expect, test } from 'bun:test'
import type { Key } from '@anthropic/ink'
import { resolveKey } from '@anthropic/ink'
import { DEFAULT_BINDINGS } from '../keybindings/defaultBindings.js'
import { parseBindings } from '../keybindings/parser.js'
import { KEYBINDING_ACTIONS } from '../keybindings/schema.js'

describe('densable plugin:favorite', () => {
  test('action registered in schema', () => {
    expect(KEYBINDING_ACTIONS).toContain('plugin:favorite')
  })

  test('defaultBindings Plugin f → plugin:favorite', () => {
    const block = DEFAULT_BINDINGS.find(b => b.context === 'Plugin')
    expect(block?.bindings.f).toBe('plugin:favorite')
    expect(block?.bindings.space).toBe('plugin:toggle')
    expect(block?.bindings.i).toBe('plugin:install')
  })

  test('resolveKey maps f to plugin:favorite in Plugin context', () => {
    const bindings = parseBindings(DEFAULT_BINDINGS)
    const bare = {
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
    } as Key
    expect(resolveKey('f', bare, ['Plugin', 'Global'], bindings)).toEqual({
      type: 'match',
      action: 'plugin:favorite',
    })
  })
})
