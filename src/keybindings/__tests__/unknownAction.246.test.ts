/**
 * densable 2.1.246 #26 — unknown action is ignored; default keeps the key.
 */
import { describe, expect, test } from 'bun:test'
import { parseBindings } from '../parser.js'
import { isKnownKeybindingAction } from '../schema.js'
import {
  keepResolvedUserBindings,
  suggestUnknownKeybindingAction,
  validateUserConfig,
} from '../validate.js'

describe('unknown keybinding action (2.1.246 #26)', () => {
  test('I: catalog actions and command: prefix are known', () => {
    expect(isKnownKeybindingAction('chat:submit')).toBe(true)
    expect(isKnownKeybindingAction('command:help')).toBe(true)
    expect(isKnownKeybindingAction('chat:submt')).toBe(false)
  })

  test('sn: edit-distance 1 suggests the catalog name', () => {
    expect(suggestUnknownKeybindingAction('chat:submt')).toBe(
      'Did you mean "chat:submit"?',
    )
  })

  test('sn: unknown namespace lists Valid "chat:" actions', () => {
    const hint = suggestUnknownKeybindingAction('chat:not-a-real-action')
    expect(hint.startsWith('Valid "chat:" actions:')).toBe(true)
    expect(hint).toContain('chat:submit')
  })

  test('validate reports ignored + suggestion', () => {
    const warnings = validateUserConfig([
      { context: 'Chat', bindings: { enter: 'chat:submt' } },
    ])
    const unknown = warnings.find(w => w.type === 'invalid_action')
    expect(unknown?.severity).toBe('error')
    expect(unknown?.message).toContain(
      'Unknown action "chat:submt" for "enter"',
    )
    expect(unknown?.message).toContain('this binding is ignored')
    expect(unknown?.suggestion).toBe('Did you mean "chat:submit"?')
  })

  test('R drops unknown actions so defaults keep the key', () => {
    const parsed = parseBindings([
      { context: 'Chat', bindings: { enter: 'chat:submt', escape: null } },
    ])
    const kept = keepResolvedUserBindings(parsed)
    expect(kept).toEqual([
      {
        chord: parsed[1]!.chord,
        action: null,
        context: 'Chat',
      },
    ])
  })
})
