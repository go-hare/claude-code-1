import { describe, expect, test } from 'bun:test'
import { KeyboardEvent } from '@anthropic/ink'
import type { ParsedKey } from '@anthropic/ink'
import { PASTE_THRESHOLD } from '../../utils/imagePaste.js'

/**
 * usePasteHandler is React-hook based; these tests cover pure contracts of
 * official densable d7r (2.1.210) that the hook must implement:
 * - sanitize focus-sequence tails
 * - pkt=800 large-key → paste
 * - event.key === "return" mid-paste defer
 * - empty paste + macOS/WSL → clipboard image path
 * - no-onPaste synthetic KeyboardEvent insert
 */

function sanitizePastedText(rawText: string): string {
  return rawText.replace(/\[I$/, '').replace(/\[O$/, '')
}

/** Mirror of official d7r `b(w)` return-defer + pkt gates (no React). */
function d7rKeyGate(
  event: KeyboardEvent,
  opts: {
    pastePending: boolean
    hasPasteHandler: boolean
  },
): 'defer-return' | 'as-paste' | 'forward' {
  if (opts.pastePending && event.key === 'return') {
    return 'defer-return'
  }
  if (
    opts.hasPasteHandler &&
    !event.ctrl &&
    !event.meta &&
    event.key.length > PASTE_THRESHOLD &&
    !event.defaultPrevented
  ) {
    return 'as-paste'
  }
  return 'forward'
}

function parsed(partial: Partial<ParsedKey> & { sequence: string }): ParsedKey {
  return {
    kind: 'key',
    name: '',
    fn: false,
    ctrl: false,
    meta: false,
    shift: false,
    option: false,
    super: false,
    raw: partial.sequence,
    isPasted: false,
    ...partial,
  }
}

describe('paste text sanitization (usePasteHandler contract)', () => {
  test('strips trailing orphan focus-in/out sequences', () => {
    expect(sanitizePastedText('hello[I')).toBe('hello')
    expect(sanitizePastedText('hello[O')).toBe('hello')
    expect(sanitizePastedText('hello')).toBe('hello')
  })

  test('preserves multi-line and image-path-like content', () => {
    const multi = '/tmp/a.png\n/tmp/b.png'
    expect(sanitizePastedText(multi)).toBe(multi)
  })

  test('empty paste remains empty (clipboard image path)', () => {
    expect(sanitizePastedText('')).toBe('')
  })
})

describe('d7r handleKeyDown gates (official densable 2.1.210)', () => {
  test('uses event.key === "return" (not only name) while paste pending', () => {
    const ret = new KeyboardEvent(parsed({ sequence: '\r', name: 'return' }))
    expect(ret.key).toBe('return')
    expect(d7rKeyGate(ret, { pastePending: true, hasPasteHandler: true })).toBe(
      'defer-return',
    )
  })

  test('return is not deferred when paste not pending', () => {
    const ret = new KeyboardEvent(parsed({ sequence: '\r', name: 'return' }))
    expect(
      d7rKeyGate(ret, { pastePending: false, hasPasteHandler: true }),
    ).toBe('forward')
  })

  test('key longer than pkt(800) routes as paste', () => {
    const big = 'x'.repeat(PASTE_THRESHOLD + 1)
    const e = new KeyboardEvent(parsed({ sequence: big }))
    expect(e.key.length).toBe(PASTE_THRESHOLD + 1)
    expect(d7rKeyGate(e, { pastePending: false, hasPasteHandler: true })).toBe(
      'as-paste',
    )
  })

  test('key at exactly pkt is not treated as paste', () => {
    const exact = 'x'.repeat(PASTE_THRESHOLD)
    const e = new KeyboardEvent(parsed({ sequence: exact }))
    expect(d7rKeyGate(e, { pastePending: false, hasPasteHandler: true })).toBe(
      'forward',
    )
  })

  test('ctrl/meta large payload is not paste-routed', () => {
    const big = 'x'.repeat(PASTE_THRESHOLD + 1)
    const e = new KeyboardEvent(
      parsed({ sequence: big, ctrl: true, name: 'v' }),
    )
    // ctrl letter → key is name "v" via fag, not the sequence — still not paste
    expect(d7rKeyGate(e, { pastePending: false, hasPasteHandler: true })).toBe(
      'forward',
    )
  })

  test('PASTE_THRESHOLD matches official pkt=800', () => {
    expect(PASTE_THRESHOLD).toBe(800)
  })
})

describe('d7r deliverText fallback (no onPaste)', () => {
  test('synthesizes isPasted KeyboardEvent with sequence as key text', () => {
    // Official: t(new kKt({kind:"key", name:void 0, sequence:w, raw:w, isPasted:!0}))
    const text = 'pasted-without-handler'
    const synthetic = new KeyboardEvent({
      kind: 'key',
      name: undefined,
      sequence: text,
      raw: text,
      ctrl: false,
      meta: false,
      shift: false,
      option: false,
      super: false,
      fn: false,
      isPasted: true,
    })
    expect(synthetic.key).toBe(text)
    expect(synthetic.name).toBe('')
  })
})
