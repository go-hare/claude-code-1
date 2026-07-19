import { describe, expect, test } from 'bun:test'
import { DEFAULT_BINDINGS } from '../keybindings/defaultBindings.js'
import { KEYBINDING_ACTIONS } from '../keybindings/schema.js'

describe('theme:editCustom (densable ThemePicker)', () => {
  test('is a registered keybinding action', () => {
    expect(KEYBINDING_ACTIONS).toContain('theme:editCustom')
  })

  test('default ThemePicker binds ctrl+e', () => {
    const block = DEFAULT_BINDINGS.find(b => b.context === 'ThemePicker')
    expect(block?.bindings['ctrl+e']).toBe('theme:editCustom')
    expect(block?.bindings['ctrl+t']).toBe('theme:toggleSyntaxHighlighting')
  })
})
