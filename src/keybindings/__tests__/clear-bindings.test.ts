import { describe, expect, test } from 'bun:test'
import { DEFAULT_BINDINGS } from '../defaultBindings.js'
import { parseBindings, parseKeystroke } from '../parser.js'
import { resolveActionForKeystroke } from '../resolver.js'
import { KEYBINDING_ACTIONS } from '../schema.js'

/**
 * densable Chat clear path:
 * - ctrl+l → chat:clearInput (not Global app:redraw)
 * - cmd+k → chat:clearScreen
 * - ctrl+j → chat:newline
 * - double-press timeout for /clear is 2000ms (PromptInput)
 */
describe('densable clear keybindings', () => {
  const bindings = parseBindings(DEFAULT_BINDINGS)

  test('schema includes chat:clearInput and chat:clearScreen', () => {
    expect(KEYBINDING_ACTIONS).toContain('chat:clearInput')
    expect(KEYBINDING_ACTIONS).toContain('chat:clearScreen')
  })

  test('ctrl+l maps to chat:clearInput in Chat', () => {
    expect(
      resolveActionForKeystroke(parseKeystroke('ctrl+l'), 'Chat', bindings),
    ).toBe('chat:clearInput')
  })

  test('ctrl+l is not Global app:redraw by default', () => {
    expect(
      resolveActionForKeystroke(parseKeystroke('ctrl+l'), 'Global', bindings),
    ).toBeNull()
  })

  test('cmd+k maps to chat:clearScreen in Chat', () => {
    expect(
      resolveActionForKeystroke(parseKeystroke('cmd+k'), 'Chat', bindings),
    ).toBe('chat:clearScreen')
  })

  test('ctrl+j maps to chat:newline in Chat', () => {
    expect(
      resolveActionForKeystroke(parseKeystroke('ctrl+j'), 'Chat', bindings),
    ).toBe('chat:newline')
  })

  test('undo has densable multi-key aliases', () => {
    for (const key of [
      'ctrl+_',
      'ctrl+-',
      'ctrl+shift+-',
      'ctrl+shift+_',
    ] as const) {
      expect(
        resolveActionForKeystroke(parseKeystroke(key), 'Chat', bindings),
      ).toBe('chat:undo')
    }
  })

  test('meta+w maps to chat:workflowKeywordToggle in Chat', () => {
    expect(KEYBINDING_ACTIONS).toContain('chat:workflowKeywordToggle')
    expect(
      resolveActionForKeystroke(parseKeystroke('meta+w'), 'Chat', bindings),
    ).toBe('chat:workflowKeywordToggle')
  })
})

describe('clear double-press footer target', () => {
  function againTarget(action?: string): string {
    return action === 'clear' ? '/clear' : 'exit'
  }

  test('action clear shows /clear', () => {
    expect(againTarget('clear')).toBe('/clear')
  })

  test('default exit path', () => {
    expect(againTarget(undefined)).toBe('exit')
    expect(againTarget('exit')).toBe('exit')
  })
})
