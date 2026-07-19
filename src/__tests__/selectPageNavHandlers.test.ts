import { describe, expect, test } from 'bun:test'
import { DEFAULT_BINDINGS } from '../keybindings/defaultBindings.js'
import { KEYBINDING_ACTIONS } from '../keybindings/schema.js'

/**
 * densable CustomSelect page/first/last — bindings + handlers already wired in
 * use-select-input.ts (focusNextPage/focusPreviousPage/focusOption).
 * This guards schema/defaultBindings cohesion.
 */
describe('densable Select page/first/last cohesion', () => {
  test('schema + defaultBindings + handler action names align', () => {
    const block = DEFAULT_BINDINGS.find(b => b.context === 'Select')
    expect(block).toBeDefined()
    for (const [key, action] of [
      ['pageup', 'select:pageUp'],
      ['pagedown', 'select:pageDown'],
      ['home', 'select:first'],
      ['end', 'select:last'],
    ] as const) {
      expect(KEYBINDING_ACTIONS).toContain(action)
      expect(block!.bindings[key]).toBe(action)
    }
  })
})
