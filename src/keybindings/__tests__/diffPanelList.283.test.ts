import { describe, expect, test } from 'bun:test'
import { DEFAULT_BINDINGS } from '../defaultBindings.js'
import { KEYBINDING_ACTIONS, KEYBINDING_CONTEXTS } from '../schema.js'

describe('densable 2.1.283 uncommitted panel list keybinding', () => {
  test('Global binds list window chords; Chat ctrl+l stays clearInput', () => {
    const global = DEFAULT_BINDINGS.find(b => b.context === 'Global')
    expect(global?.bindings['ctrl+up']).toBe('app:diffFileListUp')
    expect(global?.bindings['ctrl+down']).toBe('app:diffFileListDown')
    expect(global?.bindings['meta+up']).toBe('app:diffFileListUp')
    expect(global?.bindings['meta+down']).toBe('app:diffFileListDown')
    expect(global?.bindings['ctrl+l']).toBeUndefined()
    const chat = DEFAULT_BINDINGS.find(b => b.context === 'Chat')
    expect(chat?.bindings['ctrl+l']).toBe('chat:clearInput')
    const panel = DEFAULT_BINDINGS.find(b => b.context === 'DiffPanel')
    expect(panel?.bindings['ctrl+x b']).toBe('app:cycleDiffBase')
  })

  test('schema lists DiffPanel + list actions', () => {
    expect(KEYBINDING_CONTEXTS).toContain('DiffPanel')
    expect(KEYBINDING_ACTIONS).toContain('app:diffFileListUp')
    expect(KEYBINDING_ACTIONS).toContain('app:diffFileListDown')
  })
})
