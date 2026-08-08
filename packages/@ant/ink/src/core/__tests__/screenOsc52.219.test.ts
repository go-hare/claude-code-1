/**
 * densable 2.1.219 #11 — GNU screen chunked OSC 52 (jCu=76).
 */
import { describe, expect, test } from 'bun:test'
import {
  formatScreenOsc52Clipboard,
  SCREEN_OSC52_B64_CHUNK,
} from '../termio/osc.js'

describe('densable 2.1.219 formatScreenOsc52Clipboard', () => {
  test('chunk size is densable jCu=76', () => {
    expect(SCREEN_OSC52_B64_CHUNK).toBe(76)
  })

  test('short payload is single DCS segment', () => {
    const b64 = 'aGVsbG8=' // "hello"
    const seq = formatScreenOsc52Clipboard(b64)
    expect(seq.startsWith('\x1bP\x1b]52;c;')).toBe(true)
    expect(seq.endsWith('\x07\x1b\\')).toBe(true)
    expect(seq).toContain(b64)
    // no mid-payload DCS reopen for short base64
    expect(seq.split('\x1bP').length).toBe(2) // leading only
  })

  test('long base64 is chunked at 76 with DCS reopen', () => {
    const b64 = 'A'.repeat(200)
    const seq = formatScreenOsc52Clipboard(b64)
    // densable join: ST + ESC P between chunks
    expect(seq).toContain('\x1b\\\x1bP')
    // 200/76 → 3 chunks → 3 DCS opens (initial + 2 reopens)
    expect(seq.split('\x1bP').length - 1).toBe(3)
    // payload reconstructs
    const inner = seq
      .replaceAll('\x1bP', '')
      .replaceAll('\x1b\\', '')
      .replaceAll('\x07', '')
      .replace('\x1b]52;c;', '')
    expect(inner).toBe(b64)
  })

  test('does not double ESC inside base64 chunks', () => {
    // base64 alphabet has no ESC; sequence should only have intentional ESC at DCS/OSC boundaries
    const b64 = Buffer.from('x'.repeat(100)).toString('base64')
    const seq = formatScreenOsc52Clipboard(b64)
    expect(seq.includes('\x1b\x1b')).toBe(false)
  })
})
