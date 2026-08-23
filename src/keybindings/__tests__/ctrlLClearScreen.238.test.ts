/**
 * densable 2.1.238 #36 — Chat ctrl+l / cmd+k only forceRedraw (not /clear).
 *
 * Gold: Global does NOT bind ctrl+l. Chat binds
 *   ctrl+l → chat:clearInput
 *   cmd+k  → chat:clearScreen
 * PromptInput maps both actions to the same dT tick → useLayoutEffect
 * forceRedraw. Binding-table only — not a full Ink redraw integration test.
 */
import { describe, expect, test } from 'bun:test'
import { DEFAULT_BINDINGS } from '../defaultBindings.js'
import { KEYBINDING_ACTIONS } from '../schema.js'

describe('densable 2.1.238 #36 fullscreen ctrl+l / cmd+k repaint-only', () => {
  test('Global does not bind ctrl+l (gold: no app:redraw default key)', () => {
    const global = DEFAULT_BINDINGS.find(b => b.context === 'Global')
    expect(global).toBeDefined()
    expect(global!.bindings['ctrl+l']).toBeUndefined()
  })

  test('Chat binds ctrl+l → chat:clearInput and cmd+k → chat:clearScreen', () => {
    const chat = DEFAULT_BINDINGS.find(b => b.context === 'Chat')
    expect(chat).toBeDefined()
    expect(chat!.bindings['ctrl+l']).toBe('chat:clearInput')
    expect(chat!.bindings['cmd+k']).toBe('chat:clearScreen')
  })

  test('schema lists both chat clear actions (SEA order: newline, clearScreen, …, clearInput)', () => {
    expect(KEYBINDING_ACTIONS).toContain('chat:clearScreen')
    expect(KEYBINDING_ACTIONS).toContain('chat:clearInput')
    const newline = KEYBINDING_ACTIONS.indexOf('chat:newline')
    const clearScreen = KEYBINDING_ACTIONS.indexOf('chat:clearScreen')
    const clearInput = KEYBINDING_ACTIONS.indexOf('chat:clearInput')
    expect(clearScreen).toBeGreaterThan(newline)
    expect(clearInput).toBeGreaterThan(clearScreen)
  })
})
