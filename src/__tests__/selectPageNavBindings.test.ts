import { describe, expect, test } from 'bun:test'
import { DEFAULT_BINDINGS } from '../keybindings/defaultBindings.js'
import { KEYBINDING_ACTIONS } from '../keybindings/schema.js'

describe('densable Select page/first/last bindings', () => {
  test('actions registered in schema', () => {
    for (const a of [
      'select:pageUp',
      'select:pageDown',
      'select:first',
      'select:last',
      'plugin:favorite',
    ] as const) {
      expect(KEYBINDING_ACTIONS).toContain(a)
    }
  })

  test('defaultBindings Select keys match densable', () => {
    const block = DEFAULT_BINDINGS.find(b => b.context === 'Select')
    expect(block?.bindings.pageup).toBe('select:pageUp')
    expect(block?.bindings.pagedown).toBe('select:pageDown')
    expect(block?.bindings.home).toBe('select:first')
    expect(block?.bindings.end).toBe('select:last')
    // baseline still present
    expect(block?.bindings.up).toBe('select:previous')
    expect(block?.bindings.down).toBe('select:next')
    expect(block?.bindings.enter).toBe('select:accept')
    expect(block?.bindings.escape).toBe('select:cancel')
  })
})
