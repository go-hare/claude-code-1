import { describe, expect, test } from 'bun:test'
import { DEFAULT_BINDINGS } from '../keybindings/defaultBindings.js'
import { KEYBINDING_ACTIONS } from '../keybindings/schema.js'

describe('densable Footer x:footer:close', () => {
  test('action registered in schema', () => {
    expect(KEYBINDING_ACTIONS).toContain('footer:close')
  })

  test('defaultBindings Footer x key', () => {
    const block = DEFAULT_BINDINGS.find(b => b.context === 'Footer')
    expect(block?.bindings.x).toBe('footer:close')
    expect(block?.bindings.enter).toBe('footer:openSelected')
    expect(block?.bindings.escape).toBe('footer:clearSelection')
  })
})
