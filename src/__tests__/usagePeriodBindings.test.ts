import { describe, expect, test } from 'bun:test'
import type { Key } from '@anthropic/ink'
import { resolveKey } from '@anthropic/ink'
import { DEFAULT_BINDINGS } from '../keybindings/defaultBindings.js'
import { parseBindings } from '../keybindings/parser.js'
import { KEYBINDING_ACTIONS } from '../keybindings/schema.js'

/**
 * densable Usage breakdown: d/w → settings:periodDay/periodWeek on Settings
 * context (handlers mount in Usage.tsx UsageBreakdown when scan has signal).
 */
describe('densable settings:periodDay/Week (Usage d/w)', () => {
  test('schema actions present', () => {
    expect(KEYBINDING_ACTIONS).toContain('settings:periodDay')
    expect(KEYBINDING_ACTIONS).toContain('settings:periodWeek')
  })

  test('defaultBindings Settings maps d/w', () => {
    const block = DEFAULT_BINDINGS.find(b => b.context === 'Settings')
    expect(block).toBeDefined()
    expect(block!.bindings.d).toBe('settings:periodDay')
    expect(block!.bindings.w).toBe('settings:periodWeek')
  })

  test('resolveKey d/w in Settings last-wins', () => {
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
    expect(resolveKey('d', bare, ['Settings', 'Global'], bindings)).toEqual({
      type: 'match',
      action: 'settings:periodDay',
    })
    expect(resolveKey('w', bare, ['Settings', 'Global'], bindings)).toEqual({
      type: 'match',
      action: 'settings:periodWeek',
    })
  })
})
