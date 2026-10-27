import { describe, expect, test } from 'bun:test'
import { KeyboardEvent } from '../events/keyboard-event.js'
import { InputEvent } from '../events/input-event.js'
import {
  INITIAL_STATE,
  parseMultipleKeypresses,
  unicodeFromExtendedKeySequence,
  type ParsedKey,
} from '../parse-keypress.js'

/** Fullwidth colon `：` U+FF1A — common CJK IME punctuation. */
const FULLWIDTH_COLON = '：'
const FULLWIDTH_COLON_CP = 0xff1a // 65306
/** Fullwidth comma `，` U+FF0C. flags=1 (`>1u`) reports this as ASCII `,`. */
const FULLWIDTH_COMMA = '，'
const FULLWIDTH_COMMA_CP = 0xff0c // 65292

function asKey(item: unknown): ParsedKey {
  expect((item as ParsedKey).kind).toBe('key')
  return item as ParsedKey
}

describe('unicode CSI u / fullwidth colon (IME)', () => {
  test('unicodeFromExtendedKeySequence recovers fullwidth colon from CSI u', () => {
    expect(unicodeFromExtendedKeySequence(`\x1b[${FULLWIDTH_COLON_CP}u`)).toBe(
      FULLWIDTH_COLON,
    )
  })

  test('unicodeFromExtendedKeySequence recovers CJK ideograph', () => {
    // 中 U+4E2D = 20013
    expect(unicodeFromExtendedKeySequence('\x1b[20013u')).toBe('中')
  })

  test('unicodeFromExtendedKeySequence converts PUA codepoints (paste Rx)', () => {
    // Caps Lock = 57358. Gold Rx uses fromCodePoint, no private-use skip.
    expect(unicodeFromExtendedKeySequence('\x1b[57358u')).toBe(
      String.fromCodePoint(57358),
    )
  })

  test('parseMultipleKeypresses leaves fullwidth colon primary unnamed', () => {
    const [items] = parseMultipleKeypresses(
      INITIAL_STATE,
      `\x1b[${FULLWIDTH_COLON_CP}u`,
    )
    expect(items).toHaveLength(1)
    const key = asKey(items[0])
    expect(key.name).toBeUndefined()
  })

  test('nameless fullwidth CSI u does not insert (gold T1)', () => {
    const [items] = parseMultipleKeypresses(
      INITIAL_STATE,
      `\x1b[${FULLWIDTH_COLON_CP}u`,
    )
    const key = asKey(items[0])
    expect(new KeyboardEvent(key).key).toBe('')
    expect(new InputEvent(key).input).toBe('')
  })

  test('InputEvent still swallows unmapped Kitty functional keys', () => {
    const [items] = parseMultipleKeypresses(INITIAL_STATE, '\x1b[57358u')
    const event = new InputEvent(asKey(items[0]))
    expect(event.input).toBe('')
  })

  test('ASCII colon CSI u still inserts ":"', () => {
    // U+003A = 58
    const [items] = parseMultipleKeypresses(INITIAL_STATE, '\x1b[58u')
    const event = new InputEvent(asKey(items[0]))
    expect(event.input).toBe(':')
  })

  test('CSI u fullwidth comma primary inserts U+FF0C', () => {
    const [items] = parseMultipleKeypresses(
      INITIAL_STATE,
      `\x1b[${FULLWIDTH_COMMA_CP}u`,
    )
    const key = asKey(items[0])
    expect(key.name).toBeUndefined()
    expect(new KeyboardEvent(key).key).toBe('')
  })

  test('Vy shifted slot inserts; U+FF0C is outside Vy', () => {
    const [wide] = parseMultipleKeypresses(
      INITIAL_STATE,
      `\x1b[44:${FULLWIDTH_COMMA_CP};2u`,
    )
    const wideKey = asKey(wide[0])
    expect(wideKey.name).toBe(',')
    expect(wideKey.shift).toBe(true)
    expect(new KeyboardEvent(wideKey).key).toBe(',')

    const [cjk] = parseMultipleKeypresses(INITIAL_STATE, '\x1b[97:20013;2u')
    const cjkKey = asKey(cjk[0])
    expect(cjkKey.name).toBe('a')
    expect(new KeyboardEvent(cjkKey).key).toBe('中')
  })

  test('raw UTF-8 fullwidth comma text path is unchanged', () => {
    const [items] = parseMultipleKeypresses(INITIAL_STATE, FULLWIDTH_COMMA)
    const key = asKey(items[0])
    expect(key.name).toBe('')
    expect(key.sequence).toBe(FULLWIDTH_COMMA)
    const event = new InputEvent(key)
    expect(event.input).toBe(FULLWIDTH_COMMA)
  })

  test('raw UTF-8 fullwidth colon text path is unchanged', () => {
    const [items] = parseMultipleKeypresses(INITIAL_STATE, FULLWIDTH_COLON)
    const event = new InputEvent(asKey(items[0]))
    expect(event.input).toBe(FULLWIDTH_COLON)
  })

  test('paste mode converts CSI u fullwidth colon to the character', () => {
    const paste =
      '\x1b[200~' + `\x1b[${FULLWIDTH_COLON_CP}u` + 'hello' + '\x1b[201~'
    const [items] = parseMultipleKeypresses(INITIAL_STATE, paste)
    expect(items).toHaveLength(1)
    expect(items[0]).toEqual({
      kind: 'paste',
      text: `${FULLWIDTH_COLON}hello`,
    })
  })

  test('enhanced CSI u with shifted-key subparam inserts fullwidth colon', () => {
    // ESC[58:65306;2u — primary ":" (58), shifted U+FF1A, shift mod
    const [items] = parseMultipleKeypresses(
      INITIAL_STATE,
      `\x1b[58:${FULLWIDTH_COLON_CP};2u`,
    )
    const key = asKey(items[0])
    expect(key.name).toBe(':')
    expect(new KeyboardEvent(key).key).toBe(':')
  })

  test('gold gs does not parse a third text field', () => {
    // ESC[58:65306;2:1;65306u is not gold `gs` (mods is a single integer).
    const [items] = parseMultipleKeypresses(
      INITIAL_STATE,
      `\x1b[58:${FULLWIDTH_COLON_CP};2:1;${FULLWIDTH_COLON_CP}u`,
    )
    const key = asKey(items[0])
    expect(key.sequence).toBe(
      `\x1b[58:${FULLWIDTH_COLON_CP};2:1;${FULLWIDTH_COLON_CP}u`,
    )
    expect(key.name).not.toBe(FULLWIDTH_COLON)
  })

  test('unshifted fullwidth primary past surrogates is unnamed', () => {
    // Gold Fy stops at 55296. U+FF1A is not a name; insert is the raw path.
    const [items] = parseMultipleKeypresses(
      INITIAL_STATE,
      `\x1b[${FULLWIDTH_COLON_CP}u`,
    )
    const key = asKey(items[0])
    expect(key.name).toBeUndefined()
  })

  test('Shift+Enter still maps to return (functional name wins over text)', () => {
    const [items] = parseMultipleKeypresses(INITIAL_STATE, '\x1b[13;2u')
    const key = asKey(items[0])
    expect(key.name).toBe('return')
    expect(key.shift).toBe(true)
    const event = new InputEvent(key)
    expect(event.key.return).toBe(true)
    // return is non-alphanumeric → cleared input (submit path uses key.return)
    expect(event.input).toBe('')
  })

  test('high-byte CSI u UTF-8 fragments reassemble to fullwidth colon', () => {
    // `：` U+FF1A = UTF-8 EF BC 9A = 239, 188, 154
    // Kitty keyboard mode can emit one CSI u per UTF-8 byte (official zXc/p).
    const seq = '\x1b[239u\x1b[188u\x1b[154u'
    const [items] = parseMultipleKeypresses(INITIAL_STATE, seq)
    expect(items).toHaveLength(1)
    const event = new InputEvent(asKey(items[0]))
    expect(event.input).toBe(FULLWIDTH_COLON)
  })

  test('high-byte CSI u fragments reassemble across stdin chunks', () => {
    let state = INITIAL_STATE
    let [items, next] = parseMultipleKeypresses(state, '\x1b[239u')
    state = next
    expect(items).toHaveLength(0)
    expect(state.pendingByteEvents).toHaveLength(1)
    ;[items, next] = parseMultipleKeypresses(state, '\x1b[188u')
    state = next
    expect(items).toHaveLength(0)
    expect(state.pendingByteEvents).toHaveLength(2)
    ;[items, next] = parseMultipleKeypresses(state, '\x1b[154u')
    expect(items).toHaveLength(1)
    expect(next.pendingByteEvents).toHaveLength(0)
    const event = new InputEvent(asKey(items[0]))
    expect(event.input).toBe(FULLWIDTH_COLON)
  })

  test('high-byte CSI u reassembly produces CJK ideograph 中', () => {
    // 中 U+4E2D = E4 B8 AD = 228, 184, 173
    const [items] = parseMultipleKeypresses(
      INITIAL_STATE,
      '\x1b[228u\x1b[184u\x1b[173u',
    )
    expect(items).toHaveLength(1)
    expect(new InputEvent(asKey(items[0])).input).toBe('中')
  })

  test('gold gs does not parse mods:event release subparam', () => {
    // Gold mods is one integer. `1:3` is not a release event.
    const [items] = parseMultipleKeypresses(
      INITIAL_STATE,
      `\x1b[${FULLWIDTH_COLON_CP};1:3u`,
    )
    const key = asKey(items[0])
    expect(key.sequence).toBe(`\x1b[${FULLWIDTH_COLON_CP};1:3u`)
  })

  test('paste high-byte CSI u fragments reassemble to fullwidth colon', () => {
    const paste =
      '\x1b[200~' + '\x1b[239u\x1b[188u\x1b[154u' + 'hello' + '\x1b[201~'
    const [items] = parseMultipleKeypresses(INITIAL_STATE, paste)
    expect(items).toHaveLength(1)
    expect(items[0]).toEqual({
      kind: 'paste',
      text: `${FULLWIDTH_COLON}hello`,
    })
  })

  test('orphan CSI u tail after ESC flush is NOT re-prefixed (densable kTd)', () => {
    // densable 228 kTd only re-ESC whole-token SGR/X10 mouse — not CSI u.
    // App 50ms flush of lone ESC + later `[65306u` stays text (sji multi-char empty).
    const [items] = parseMultipleKeypresses(INITIAL_STATE, '[65306u')
    expect(items).toHaveLength(1)
    const key = asKey(items[0])
    expect(key.sequence).toBe('[65306u')
    const event = new InputEvent(key)
    // multi-codepoint → sji empty on InputEvent; main prompt uses KeyboardEvent
    expect(event.input).toBe('')
  })

  test('orphan progressive CSI u tail is NOT re-prefixed (densable kTd)', () => {
    const [items] = parseMultipleKeypresses(INITIAL_STATE, '[58:65306;2u')
    const key = asKey(items[0])
    expect(key.sequence).toBe('[58:65306;2u')
    expect(new InputEvent(key).input).toBe('')
  })

  test('AltGr CSI u (ctrl+meta) CJK before surrogates clears modifiers', () => {
    // Official NJc/OJc densable. force so WT_SESSION is not required in CI.
    const prev = process.env.CLAUDE_CODE_ALTGR_AS_TEXT
    process.env.CLAUDE_CODE_ALTGR_AS_TEXT = '1'
    try {
      const [items] = parseMultipleKeypresses(INITIAL_STATE, '\x1b[20013;7u')
      const key = asKey(items[0])
      expect(key.ctrl).toBe(false)
      expect(key.meta).toBe(false)
      expect(key.name).toBe('中')
      const event = new InputEvent(key)
      expect(event.input).toBe('中')
      // mapKey routes key.ctrl / key.meta to handleCtrl/Meta — must stay clear
      expect(event.key.ctrl).toBe(false)
      expect(event.key.meta).toBe(false)
    } finally {
      if (prev === undefined) {
        delete process.env.CLAUDE_CODE_ALTGR_AS_TEXT
      } else {
        process.env.CLAUDE_CODE_ALTGR_AS_TEXT = prev
      }
    }
  })

  test('AltGr modifyOtherKeys CJK before surrogates clears modifiers', () => {
    const prev = process.env.CLAUDE_CODE_ALTGR_AS_TEXT
    process.env.CLAUDE_CODE_ALTGR_AS_TEXT = '1'
    try {
      const [items] = parseMultipleKeypresses(INITIAL_STATE, '\x1b[27;7;20013~')
      const key = asKey(items[0])
      expect(key.ctrl).toBe(false)
      expect(key.meta).toBe(false)
      expect(new InputEvent(key).input).toBe('中')
    } finally {
      if (prev === undefined) {
        delete process.env.CLAUDE_CODE_ALTGR_AS_TEXT
      } else {
        process.env.CLAUDE_CODE_ALTGR_AS_TEXT = prev
      }
    }
  })

  test('AltGr auto mode rewrites non-alnum CJK under WT_SESSION', () => {
    const prevAlt = process.env.CLAUDE_CODE_ALTGR_AS_TEXT
    const prevWt = process.env.WT_SESSION
    delete process.env.CLAUDE_CODE_ALTGR_AS_TEXT
    process.env.WT_SESSION = 'test-session'
    try {
      const [items] = parseMultipleKeypresses(INITIAL_STATE, '\x1b[20013;7u')
      const key = asKey(items[0])
      expect(key.ctrl).toBe(false)
      expect(key.meta).toBe(false)
      expect(new InputEvent(key).input).toBe('中')
    } finally {
      if (prevAlt === undefined) {
        delete process.env.CLAUDE_CODE_ALTGR_AS_TEXT
      } else {
        process.env.CLAUDE_CODE_ALTGR_AS_TEXT = prevAlt
      }
      if (prevWt === undefined) {
        delete process.env.WT_SESSION
      } else {
        process.env.WT_SESSION = prevWt
      }
    }
  })

  test('AltGr off keeps ctrl+meta on CJK', () => {
    const prev = process.env.CLAUDE_CODE_ALTGR_AS_TEXT
    process.env.CLAUDE_CODE_ALTGR_AS_TEXT = '0'
    try {
      const [items] = parseMultipleKeypresses(INITIAL_STATE, '\x1b[20013;7u')
      const key = asKey(items[0])
      expect(key.ctrl).toBe(true)
      expect(key.meta).toBe(true)
      expect(key.name).toBe('中')
    } finally {
      if (prev === undefined) {
        delete process.env.CLAUDE_CODE_ALTGR_AS_TEXT
      } else {
        process.env.CLAUDE_CODE_ALTGR_AS_TEXT = prev
      }
    }
  })
})
