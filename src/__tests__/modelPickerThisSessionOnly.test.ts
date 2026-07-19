import { describe, expect, test } from 'bun:test'
import { DEFAULT_BINDINGS } from '../keybindings/defaultBindings.js'
import { KEYBINDING_ACTIONS } from '../keybindings/schema.js'

describe('densable modelPicker:thisSessionOnly', () => {
  test('action registered in schema', () => {
    expect(KEYBINDING_ACTIONS).toContain('modelPicker:thisSessionOnly')
  })

  test('defaultBindings ModelPicker s key', () => {
    const block = DEFAULT_BINDINGS.find(b => b.context === 'ModelPicker')
    expect(block?.bindings.s).toBe('modelPicker:thisSessionOnly')
    expect(block?.bindings.left).toBe('modelPicker:decreaseEffort')
    expect(block?.bindings.right).toBe('modelPicker:increaseEffort')
    expect(block?.bindings.space).toBe('modelPicker:toggle1M')
  })
})
