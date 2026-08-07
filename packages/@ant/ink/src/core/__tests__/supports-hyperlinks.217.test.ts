import { describe, expect, test } from 'bun:test'
import { supportsHyperlinks } from '../supports-hyperlinks.js'

describe('supportsHyperlinks FORCE_HYPERLINK (densable 2.1.217 #15)', () => {
  test('FORCE_HYPERLINK=0 forces false even when stdout claims support', () => {
    expect(
      supportsHyperlinks({
        env: { FORCE_HYPERLINK: '0' },
        stdoutSupported: true,
      }),
    ).toBe(false)
  })

  test('FORCE_HYPERLINK=1 forces true even when stdout unsupported', () => {
    expect(
      supportsHyperlinks({
        env: { FORCE_HYPERLINK: '1' },
        stdoutSupported: false,
      }),
    ).toBe(true)
  })

  test('FORCE_HYPERLINK empty still forces (non-zero parse path)', () => {
    // densable Mms: if(r) return !(r.length>0 && parseInt===0)
    // empty string is falsy in densable if(r) — but key present:
    // our forceHyperlinkOverride: raw===undefined → true; '' → parseInt NaN !== 0 → true
    expect(
      supportsHyperlinks({
        env: { FORCE_HYPERLINK: '' },
        stdoutSupported: false,
      }),
    ).toBe(true)
  })

  test('without FORCE falls through to stdoutSupported', () => {
    expect(
      supportsHyperlinks({
        env: {},
        stdoutSupported: true,
      }),
    ).toBe(true)
    expect(
      supportsHyperlinks({
        env: {},
        stdoutSupported: false,
      }),
    ).toBe(false)
  })
})
