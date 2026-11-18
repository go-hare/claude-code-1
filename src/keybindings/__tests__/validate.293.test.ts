import { describe, expect, test } from 'bun:test'
import { validateUserConfig } from '../validate.js'

describe('keybindings validateKeystroke #318', () => {
  test('a lone " " (space key) is valid and produces no errors', () => {
    const warnings = validateUserConfig([
      {
        context: 'Chat',
        bindings: {
          ' ': 'chat:submit',
        },
      },
    ])
    expect(warnings).toEqual([])
  })

  test('keys like "ctrl+ k" with space next to "+" report a parse_error', () => {
    const warnings = validateUserConfig([
      {
        context: 'Chat',
        bindings: {
          'ctrl+ k': 'chat:submit',
        },
      },
    ])
    expect(warnings.length).toBe(1)
    expect(warnings[0]?.type).toBe('parse_error')
    expect(warnings[0]?.severity).toBe('error')
    expect(warnings[0]?.message).toContain(
      'A space next to "+" splits "ctrl+ k" into separate presses, and one of them has no key',
    )
    expect(warnings[0]?.suggestion).toBe('Remove the spaces next to "+"')
  })

  test('empty key part like "ctrl++" still reports Empty key part', () => {
    const warnings = validateUserConfig([
      {
        context: 'Chat',
        bindings: {
          'ctrl++': 'chat:submit',
        },
      },
    ])
    expect(warnings.length).toBe(1)
    expect(warnings[0]?.message).toContain('Empty key part in "ctrl++"')
  })
})
