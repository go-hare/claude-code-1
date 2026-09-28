import { describe, expect, test } from 'bun:test'
import { parseChord, parseBindings } from '@anthropic/ink'
import { DEFAULT_BINDINGS } from '../defaultBindings.js'
import { KEYBINDING_ACTIONS } from '../schema.js'
import {
  formatSendNowHint,
  isNewlineLikeSendNowChord,
} from '../shortcutFormat.js'

describe('densable 2.1.283 chat:sendNow / queueSubmit', () => {
  test('Chat binds send-now and queue-submit; ctrl+l stays clearInput', () => {
    const chat = DEFAULT_BINDINGS.find(b => b.context === 'Chat')
    expect(chat).toBeDefined()
    expect(chat!.bindings['ctrl+x enter']).toBe('chat:queueSubmit')
    expect(chat!.bindings['ctrl+x ctrl+s']).toBe('chat:sendNow')
    expect(chat!.bindings['ctrl+enter']).toBe('chat:sendNow')
    expect(chat!.bindings['ctrl+l']).toBe('chat:clearInput')
    expect(chat!.bindings['ctrl+l']).not.toBe('app:toggleTranscript')
  })

  test('schema lists chat:sendNow and chat:queueSubmit after chat:submit', () => {
    expect(KEYBINDING_ACTIONS).toContain('chat:sendNow')
    expect(KEYBINDING_ACTIONS).toContain('chat:queueSubmit')
    const submit = KEYBINDING_ACTIONS.indexOf('chat:submit')
    expect(KEYBINDING_ACTIONS.indexOf('chat:queueSubmit')).toBe(submit + 1)
    expect(KEYBINDING_ACTIONS.indexOf('chat:sendNow')).toBe(submit + 2)
  })

  test('WinTerm hint skips enter+ctrl so ctrl+x ctrl+s shows', () => {
    expect(isNewlineLikeSendNowChord(parseChord('ctrl+enter'))).toBe(true)
    expect(isNewlineLikeSendNowChord(parseChord('ctrl+x ctrl+s'))).toBe(false)
    const parsed = parseBindings(DEFAULT_BINDINGS)
    expect(formatSendNowHint(parsed, true)).toBe('ctrl+x ctrl+s')
    expect(formatSendNowHint(parsed, false)).toBe('ctrl+Enter')
  })
})
