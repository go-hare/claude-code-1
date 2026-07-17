import { describe, expect, test } from 'bun:test'
import { KeyboardEvent } from '@anthropic/ink'
import type { ParsedKey } from '../../../packages/@ant/ink/src/core/parse-keypress.js'
import {
  FUNCTIONAL_KEY_NAMES,
  insertInputFromKeyboardEvent,
  keyFromKeyboardEvent,
} from '../keyboardEventInput.js'

function key(partial: Partial<ParsedKey> & { sequence: string }): ParsedKey {
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

describe('insertInputFromKeyboardEvent (official tS_ + insert(q.key))', () => {
  test('single printable inserts via e.key', () => {
    const e = new KeyboardEvent(key({ sequence: 'a', name: 'a' }))
    expect(insertInputFromKeyboardEvent(e)).toBe('a')
  })

  test('multi-char typed batch inserts whole e.key (official ZXc + fag)', () => {
    const e = new KeyboardEvent(key({ sequence: 'hello' }))
    expect(e.key).toBe('hello')
    expect(insertInputFromKeyboardEvent(e)).toBe('hello')
  })

  test('CJK / emoji multi-char batch inserts', () => {
    expect(
      insertInputFromKeyboardEvent(
        new KeyboardEvent(key({ sequence: '你好' })),
      ),
    ).toBe('你好')
    expect(
      insertInputFromKeyboardEvent(new KeyboardEvent(key({ sequence: '🙂' }))),
    ).toBe('🙂')
  })

  test('wheelup/wheeldown/mouse in tS_ never insert', () => {
    for (const name of ['wheelup', 'wheeldown', 'mouse'] as const) {
      const e = new KeyboardEvent(key({ sequence: `\x1b[<65;1;1M`, name }))
      expect(FUNCTIONAL_KEY_NAMES.has(name)).toBe(true)
      expect(insertInputFromKeyboardEvent(e)).toBe('')
    }
  })

  test('enter name yields newline; return yields empty (submit via mapKey)', () => {
    const enter = new KeyboardEvent(key({ sequence: '\n', name: 'enter' }))
    expect(insertInputFromKeyboardEvent(enter)).toBe('\n')
    expect(keyFromKeyboardEvent(enter).return).toBe(false)

    const ret = new KeyboardEvent(key({ sequence: '\r', name: 'return' }))
    expect(insertInputFromKeyboardEvent(ret)).toBe('')
    expect(keyFromKeyboardEvent(ret).return).toBe(true)
  })

  test('arrows / tab / escape / backspace do not insert key name text', () => {
    for (const name of [
      'up',
      'down',
      'left',
      'right',
      'tab',
      'escape',
      'backspace',
      'delete',
      'home',
      'end',
    ] as const) {
      const e = new KeyboardEvent(key({ sequence: name, name }))
      expect(insertInputFromKeyboardEvent(e)).toBe('')
    }
  })

  test('f-keys and pageup/pagedown in tS_ never insert', () => {
    for (const name of [
      'f1',
      'f12',
      'pageup',
      'pagedown',
      'insert',
      'clear',
    ] as const) {
      const e = new KeyboardEvent(key({ sequence: name, name }))
      expect(insertInputFromKeyboardEvent(e)).toBe('')
    }
  })

  test('space name inserts literal space', () => {
    const e = new KeyboardEvent(key({ sequence: ' ', name: 'space' }))
    expect(e.key).toBe(' ')
    expect(insertInputFromKeyboardEvent(e)).toBe(' ')
  })

  test('ctrl letter keeps key letter with ctrl flag (mapKey path)', () => {
    const e = new KeyboardEvent(
      key({ sequence: '\x03', name: 'c', ctrl: true }),
    )
    expect(e.key).toBe('c')
    expect(e.ctrl).toBe(true)
    // Not in tS_, key length >= 1 — insert path would pass "c" but mapKey
    // handles key.ctrl first. Payload is still "c" for handleCtrl map.
    expect(insertInputFromKeyboardEvent(e)).toBe('c')
    expect(keyFromKeyboardEvent(e).ctrl).toBe(true)
  })

  test('ESC-prefixed nameless residue empties via fag', () => {
    const e = new KeyboardEvent(key({ sequence: '\x1b[<65;11;10M' }))
    expect(e.key).toBe('')
    expect(insertInputFromKeyboardEvent(e)).toBe('')
  })

  test('pure orphan SGR burst empties via fag', () => {
    const e = new KeyboardEvent(key({ sequence: '[<65;11;10M[<64;19;15M' }))
    expect(e.key).toBe('')
    expect(insertInputFromKeyboardEvent(e)).toBe('')
  })
})
