/**
 * densable 2.1.228 #13 — cross-session-message envelope + sender label.
 */
import { describe, expect, test } from 'bun:test'
import {
  buildCrossSessionMessageAttrs,
  parseCrossSessionOpenAttrs,
  prettyCrossSessionFromAddress,
  resolveCrossSessionSenderLabel,
  sanitizeCrossSessionDisplayName,
  wrapCrossSessionMessage,
} from '../crossSessionMessage.js'

describe('densable 2.1.228 #13 sanitizeCrossSessionDisplayName (Tte)', () => {
  test('trims and ellipsizes past 64 codepoints', () => {
    expect(sanitizeCrossSessionDisplayName('  hello  ')).toBe('hello')
    const long = 'a'.repeat(70)
    const out = sanitizeCrossSessionDisplayName(long)
    expect(out.endsWith('…')).toBe(true)
    expect([...out].length).toBe(65)
  })
})

describe('densable 2.1.228 #13 prettyCrossSessionFromAddress (lhm)', () => {
  test('uds sock basename; bridge untitled; path basename', () => {
    expect(prettyCrossSessionFromAddress('uds:/tmp/claude-123.sock')).toBe(
      'claude-123',
    )
    expect(prettyCrossSessionFromAddress('bridge:session_abc')).toBe(
      '(untitled)',
    )
    expect(prettyCrossSessionFromAddress('/var/run/peer.sock')).toBe('peer')
  })
})

describe('densable 2.1.228 #13 resolveCrossSessionSenderLabel', () => {
  test('prefers from-name over from address (RC session name)', () => {
    expect(
      resolveCrossSessionSenderLabel({
        from: 'bridge:session_x',
        fromName: 'my-rc-session',
      }),
    ).toBe('my-rc-session')
  })

  test('falls back to pretty from then peer', () => {
    expect(resolveCrossSessionSenderLabel({ from: 'uds:/tmp/a.sock' })).toBe(
      'a',
    )
    expect(resolveCrossSessionSenderLabel({})).toBe('peer')
  })
})

describe('densable 2.1.228 #13 wrapCrossSessionMessage (I6y/fbr)', () => {
  test('builds from + from-name attrs', () => {
    const attrs = buildCrossSessionMessageAttrs({
      from: 'bridge:sid',
      fromName: 'Title',
      fromMode: 'prompting',
    })
    expect(attrs).toContain('from="bridge:sid"')
    expect(attrs).toContain('from-name="Title"')
    expect(attrs).toContain('from-mode="prompting"')
  })

  test('wraps body and is idempotent for full envelope', () => {
    const wrapped = wrapCrossSessionMessage('hello', {
      from: 'uds:/tmp/x.sock',
      fromName: 'lab',
    })
    expect(wrapped).toContain('<cross-session-message')
    expect(wrapped).toContain('from-name="lab"')
    expect(wrapped).toContain('hello')
    expect(wrapCrossSessionMessage(wrapped, { from: 'other' })).toBe(wrapped)
  })

  test('parse open attrs', () => {
    const text =
      '<cross-session-message from="bridge:s" from-name="rc-name">\nbody\n</cross-session-message>'
    expect(parseCrossSessionOpenAttrs(text)).toEqual({
      from: 'bridge:s',
      fromName: 'rc-name',
    })
  })
})
