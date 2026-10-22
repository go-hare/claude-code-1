import { describe, expect, mock, test } from 'bun:test'

import {
  applyTerminalTitle,
  clearTerminalTitle,
} from '../use-terminal-title.js'

describe('applyTerminalTitle (densable phe)', () => {
  test('emits OSC 0 when writeRaw is set', () => {
    const writeRaw = mock((_s: string) => {})
    applyTerminalTitle('✳ Claude Code', writeRaw)
    expect(writeRaw).toHaveBeenCalledTimes(1)
    expect(writeRaw.mock.calls[0]?.[0]).toBe('\x1b]0;✳ Claude Code\x07')
  })

  test('gold if(!r)return — no-op without writeRaw', () => {
    const before = process.title
    applyTerminalTitle('claude', null)
    expect(process.title).toBe(before)
  })
})

describe('clearTerminalTitle (densable phe inverse)', () => {
  test('emits CLEAR_TERMINAL_TITLE (OSC 0 empty + BEL)', () => {
    const writeRaw = mock((_s: string) => {})
    clearTerminalTitle(writeRaw)
    expect(writeRaw).toHaveBeenCalledTimes(1)
    expect(writeRaw.mock.calls[0]?.[0]).toBe('\x1b]0;\x07')
  })

  test('gold if(!r)return — no-op without writeRaw', () => {
    const writeRaw = mock(() => {})
    clearTerminalTitle(null)
    expect(writeRaw).not.toHaveBeenCalled()
  })
})
