/**
 * densable 2.1.218 #5 — multi-line paste Ctrl+J → chat:newline (not literal "j").
 *
 * densable 2.1.212+ defaultBindings: Chat context `'ctrl+j': 'chat:newline'`.
 * Terminals that encode pasted newlines as Ctrl+J rely on this binding so
 * paste expands to real newlines instead of collapsing with `j` separators.
 *
 * Scope: **binding table only** — not a full bracketed-paste integration test.
 */
import { describe, expect, test } from 'bun:test'
import { DEFAULT_BINDINGS } from '../defaultBindings.js'

describe('densable 2.1.218 #5 ctrl+j → chat:newline', () => {
  test('Chat context binds ctrl+j to chat:newline', () => {
    const chat = DEFAULT_BINDINGS.find(b => b.context === 'Chat')
    expect(chat).toBeDefined()
    expect(chat!.bindings['ctrl+j']).toBe('chat:newline')
  })

  test('enter remains chat:submit (newline is not submit)', () => {
    const chat = DEFAULT_BINDINGS.find(b => b.context === 'Chat')
    expect(chat!.bindings.enter).toBe('chat:submit')
    expect(chat!.bindings['ctrl+j']).not.toBe('chat:submit')
  })
})
