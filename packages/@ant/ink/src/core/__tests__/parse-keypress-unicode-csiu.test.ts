import { describe, expect, test } from 'bun:test'
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

  test('unicodeFromExtendedKeySequence does not recover Kitty functional PUA keys', () => {
    // Caps Lock = 57358
    expect(unicodeFromExtendedKeySequence('\x1b[57358u')).toBeUndefined()
  })

  test('parseMultipleKeypresses names fullwidth colon CSI u as the character', () => {
    const [items] = parseMultipleKeypresses(
      INITIAL_STATE,
      `\x1b[${FULLWIDTH_COLON_CP}u`,
    )
    expect(items).toHaveLength(1)
    const key = asKey(items[0])
    expect(key.name).toBe(FULLWIDTH_COLON)
  })

  test('InputEvent inserts fullwidth colon from CSI u (does not swallow)', () => {
    const [items] = parseMultipleKeypresses(
      INITIAL_STATE,
      `\x1b[${FULLWIDTH_COLON_CP}u`,
    )
    const event = new InputEvent(asKey(items[0]))
    expect(event.input).toBe(FULLWIDTH_COLON)
    expect(event.key.ctrl).toBe(false)
    expect(event.key.meta).toBe(false)
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
    const key = asKey(items[0])
    expect(key.isPasted).toBe(true)
    expect(key.sequence).toBe(`${FULLWIDTH_COLON}hello`)
  })

  test('enhanced CSI u with shifted-key subparam inserts fullwidth colon', () => {
    // ESC[58:65306;2u — primary ":" (58), shifted U+FF1A, shift mod
    const [items] = parseMultipleKeypresses(
      INITIAL_STATE,
      `\x1b[58:${FULLWIDTH_COLON_CP};2u`,
    )
    const event = new InputEvent(asKey(items[0]))
    expect(event.input).toBe(FULLWIDTH_COLON)
  })

  test('enhanced CSI u with associated text field inserts fullwidth colon', () => {
    // ESC[58:65306;2:1;65306u — text-as-codepoints field carries U+FF1A
    const [items] = parseMultipleKeypresses(
      INITIAL_STATE,
      `\x1b[58:${FULLWIDTH_COLON_CP};2:1;${FULLWIDTH_COLON_CP}u`,
    )
    const event = new InputEvent(asKey(items[0]))
    expect(event.input).toBe(FULLWIDTH_COLON)
  })

  test('enhanced CSI u event-type subparam on unicode primary still works', () => {
    // ESC[65306;1:1u — primary fullwidth colon, mods=1 event=press
    const [items] = parseMultipleKeypresses(
      INITIAL_STATE,
      `\x1b[${FULLWIDTH_COLON_CP};1:1u`,
    )
    const event = new InputEvent(asKey(items[0]))
    expect(event.input).toBe(FULLWIDTH_COLON)
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

  test('CSI u release event does not insert (press+release no double)', () => {
    const [items] = parseMultipleKeypresses(
      INITIAL_STATE,
      `\x1b[${FULLWIDTH_COLON_CP};1:1u\x1b[${FULLWIDTH_COLON_CP};1:3u`,
    )
    // Only press should insert; release is empty name / no input
    const inputs = items
      .filter(i => i.kind === 'key')
      .map(i => new InputEvent(i as never).input)
      .filter(Boolean)
    expect(inputs).toEqual([FULLWIDTH_COLON])
  })

  test('paste high-byte CSI u fragments reassemble to fullwidth colon', () => {
    const paste =
      '\x1b[200~' + '\x1b[239u\x1b[188u\x1b[154u' + 'hello' + '\x1b[201~'
    const [items] = parseMultipleKeypresses(INITIAL_STATE, paste)
    expect(items).toHaveLength(1)
    const key = asKey(items[0])
    expect(key.isPasted).toBe(true)
    expect(key.sequence).toBe(`${FULLWIDTH_COLON}hello`)
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

  test('AltGr CSI u (ctrl+meta) fullwidth colon clears modifiers for insert', () => {
    // Official NJc/OJc densable. force so WT_SESSION is not required in CI.
    const prev = process.env.CLAUDE_CODE_ALTGR_AS_TEXT
    process.env.CLAUDE_CODE_ALTGR_AS_TEXT = '1'
    try {
      const [items] = parseMultipleKeypresses(
        INITIAL_STATE,
        `\x1b[${FULLWIDTH_COLON_CP};7u`,
      )
      const key = asKey(items[0])
      expect(key.ctrl).toBe(false)
      expect(key.meta).toBe(false)
      expect(key.name).toBe(FULLWIDTH_COLON)
      const event = new InputEvent(key)
      expect(event.input).toBe(FULLWIDTH_COLON)
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

  test('AltGr modifyOtherKeys fullwidth colon clears modifiers', () => {
    const prev = process.env.CLAUDE_CODE_ALTGR_AS_TEXT
    process.env.CLAUDE_CODE_ALTGR_AS_TEXT = '1'
    try {
      const [items] = parseMultipleKeypresses(
        INITIAL_STATE,
        `\x1b[27;7;${FULLWIDTH_COLON_CP}~`,
      )
      const key = asKey(items[0])
      expect(key.ctrl).toBe(false)
      expect(key.meta).toBe(false)
      expect(new InputEvent(key).input).toBe(FULLWIDTH_COLON)
    } finally {
      if (prev === undefined) {
        delete process.env.CLAUDE_CODE_ALTGR_AS_TEXT
      } else {
        process.env.CLAUDE_CODE_ALTGR_AS_TEXT = prev
      }
    }
  })

  test('AltGr auto mode rewrites non-alnum under WT_SESSION', () => {
    const prevAlt = process.env.CLAUDE_CODE_ALTGR_AS_TEXT
    const prevWt = process.env.WT_SESSION
    delete process.env.CLAUDE_CODE_ALTGR_AS_TEXT
    process.env.WT_SESSION = 'test-session'
    try {
      const [items] = parseMultipleKeypresses(
        INITIAL_STATE,
        `\x1b[${FULLWIDTH_COLON_CP};7u`,
      )
      const key = asKey(items[0])
      expect(key.ctrl).toBe(false)
      expect(key.meta).toBe(false)
      expect(new InputEvent(key).input).toBe(FULLWIDTH_COLON)
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

  test('AltGr off keeps ctrl+meta on fullwidth colon', () => {
    const prev = process.env.CLAUDE_CODE_ALTGR_AS_TEXT
    process.env.CLAUDE_CODE_ALTGR_AS_TEXT = '0'
    try {
      const [items] = parseMultipleKeypresses(
        INITIAL_STATE,
        `\x1b[${FULLWIDTH_COLON_CP};7u`,
      )
      const key = asKey(items[0])
      expect(key.ctrl).toBe(true)
      expect(key.meta).toBe(true)
    } finally {
      if (prev === undefined) {
        delete process.env.CLAUDE_CODE_ALTGR_AS_TEXT
      } else {
        process.env.CLAUDE_CODE_ALTGR_AS_TEXT = prev
      }
    }
  })
})
