import { describe, expect, test } from 'bun:test'
import {
  formatTranscriptTailFrame,
  stripControlChars,
  stripNonSgrAnsi,
} from '../attachTranscriptPreview.js'

describe('attachTranscriptPreview v2.1.290 (#29 escaping)', () => {
  test('stripControlChars strips ANSI, OSC, C0/C1, and expands tabs', () => {
    const dirty = '\x1b[31mred\x1b[0m\t\x1b]0;title\x07\x00\x7f\x80clean\r\v\f'
    expect(stripControlChars(dirty)).toBe('red  clean')
  })

  test('stripNonSgrAnsi preserves SGR colors and removes cursor/OSC escapes', () => {
    const mixed =
      '\x1b[1;32mhello\x1b[0m\x1b[2J\x1b]8;;https://evil\x07world\x1b[H'
    expect(stripNonSgrAnsi(mixed)).toBe('\x1b[1;32mhello\x1b[0mworld')
  })

  test('formatTranscriptTailFrame escapes injected terminal sequences in transcript', () => {
    const line = JSON.stringify({
      type: 'user',
      message: { content: 'hi \x1b]0;pwn\x07\x1b[2Jthere' },
    })
    const frame = formatTranscriptTailFrame(line, 80, 20, { colorLevel: 0 })
    expect(frame).not.toBeNull()
    expect(frame).toContain('hi there')
    expect(frame).not.toContain('pwn')
  })
})
