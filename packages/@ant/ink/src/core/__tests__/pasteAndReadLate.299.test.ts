import { describe, expect, test } from 'bun:test'
import { KeyboardEvent } from '../events/keyboard-event.js'
import { PasteEvent } from '../events/paste-event.js'
import {
  createKeyReader,
  KEY_READER_NORMAL_MS,
  readKeys,
} from '../keyReader.js'
import { isEscPrefixedKey, splitEscPrefixedKey } from '../parse-keypress.js'
import { createTokenizer } from '../termio/tokenize.js'

describe('2.1.299 #641 non-bracketed paste & PasteEvent sanitization', () => {
  test('non-Kitty ESC _ in x10Mouse mode does not swallow following paste text', () => {
    const tok = createTokenizer({ x10Mouse: true })
    const longBody = 'a'.repeat(80)
    const tokens = tok.feed(`\x1b_notkitty${longBody}`)
    const combinedText = tokens.map(t => t.value).join('')
    expect(combinedText).toContain('notkitty')
    expect(combinedText).toContain(longBody)
  })

  test('PasteEvent strips C1 control chars and tracks rawEmpty / rawEndedWithFocusTail', () => {
    const ev = new PasteEvent('hello\x9dtitle\x07world\x9b[I')
    expect(ev.text).toBe('hellotitleworld[I')
    expect(ev.rawEmpty).toBe(false)
    expect(ev.rawEndedWithFocusTail).toBe(true)
    expect(new PasteEvent('[I').rawEmpty).toBe(true)
  })
})

describe('2.1.301 #864 readLate & ESC-prefixed split primitives', () => {
  test('readKeys marks key readLate=true when explicit readLate or ESC held past timeout', () => {
    const r0 = createKeyReader(0)
    const r1 = readKeys(r0, '\x1b', 10)
    expect(r1.keys).toEqual([])
    expect(r1.reader.parse.incomplete).toBe('\x1b')

    const r2 = readKeys(r1.reader, 'a', 10 + KEY_READER_NORMAL_MS + 5)
    expect(r2.keys.length).toBe(1)
    expect(r2.keys[0]?.kind).toBe('key')
    if (r2.keys[0]?.kind === 'key') {
      expect(r2.keys[0].readLate).toBe(true)
      expect(r2.keys[0].sequence).toBe('\x1ba')
    }
  })

  test('KeyboardEvent.readAsEscapeThenKey and splitEscPrefixedKey split ESC+key', () => {
    const ev = new KeyboardEvent(
      {
        kind: 'key',
        name: 'a',
        fn: false,
        ctrl: false,
        meta: true,
        shift: false,
        option: false,
        super: false,
        sequence: '\x1ba',
        raw: '\x1ba',
        readLate: true,
      },
      { soloKeypress: true },
    )
    expect(ev.readLate).toBe(true)
    expect(ev.isReadAsEscapeThenKey).toBe(false)
    expect(ev.readAsEscapeThenKey()).toBe(true)
    expect(ev.isReadAsEscapeThenKey).toBe(true)

    expect(isEscPrefixedKey('\x1ba')).toBe(true)
    expect(isEscPrefixedKey('\x1b')).toBe(false)
    const split = splitEscPrefixedKey('\x1ba')
    expect(split.length).toBe(2)
    expect(split[0]?.kind === 'key' && split[0].name).toBe('escape')
    expect(split[1]?.kind === 'key' && split[1].name).toBe('a')
  })
})
