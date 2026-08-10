import { describe, expect, test } from 'bun:test'
import { neutralizeChannelPreviewText } from '../channelPreviewSanitize.js'

describe('neutralizeChannelPreviewText (densable 211 channel preview)', () => {
  test('strips RLO / LRO / PDF bidi overrides', () => {
    const s = `safe\u202Eevil\u202C`
    expect(neutralizeChannelPreviewText(s)).toBe('safeevil')
  })

  test('strips zero-width and BOM', () => {
    const s = `a\u200Bb\u200Cc\u200Dd\uFEFFe`
    expect(neutralizeChannelPreviewText(s)).toBe('abcde')
  })

  test('strips look-alike curly quotes but keeps ASCII double quote', () => {
    const s = `"ok"\u201Cspoof\u201D`
    expect(neutralizeChannelPreviewText(s)).toBe('"ok"spoof')
  })

  test('strips C0/C1 controls', () => {
    const s = `a\x00b\x1bc\x7fd`
    expect(neutralizeChannelPreviewText(s)).toBe('abcd')
  })

  test('preserves printable JSON body', () => {
    const s = '{"cmd":"echo hi"}'
    expect(neutralizeChannelPreviewText(s)).toBe(s)
  })
})
