import { describe, expect, test } from 'bun:test'
import type { Key } from '@anthropic/ink'
import { resolveKey } from '@anthropic/ink'
import { DEFAULT_BINDINGS } from '../keybindings/defaultBindings.js'
import { parseBindings } from '../keybindings/parser.js'
import { KEYBINDING_ACTIONS } from '../keybindings/schema.js'

/**
 * densable Skills dialog: t → settings:sortByTokens (token-desc sort toggle).
 * Handler lives on SkillsMenu; binding resolves via Settings context.
 */
describe('densable settings:sortByTokens (Skills t)', () => {
  test('schema action present', () => {
    expect(KEYBINDING_ACTIONS).toContain('settings:sortByTokens')
  })

  test('defaultBindings Settings maps t → settings:sortByTokens', () => {
    const block = DEFAULT_BINDINGS.find(b => b.context === 'Settings')
    expect(block).toBeDefined()
    expect(block!.bindings.t).toBe('settings:sortByTokens')
  })

  test('resolveKey t in Settings context', () => {
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
    expect(resolveKey('t', bare, ['Settings', 'Global'], bindings)).toEqual({
      type: 'match',
      action: 'settings:sortByTokens',
    })
  })
})
