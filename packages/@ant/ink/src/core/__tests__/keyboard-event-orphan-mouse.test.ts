import { describe, expect, test } from 'bun:test'
import { KeyboardEvent } from '../events/keyboard-event.js'
import type { ParsedKey } from '../parse-keypress.js'

function nameless(sequence: string): ParsedKey {
  return {
    kind: 'key',
    name: '',
    fn: false,
    ctrl: false,
    meta: false,
    shift: false,
    option: false,
    super: false,
    sequence,
    raw: sequence,
    isPasted: false,
  }
}

describe('KeyboardEvent SGR mouse fragment suppress (official $z5)', () => {
  test('single orphaned SGR tail is not typed as e.key', () => {
    expect(new KeyboardEvent(nameless('[<65;11;10M')).key).toBe('')
  })

  test('burst of orphaned SGR tails (fast scroll) is not typed as e.key', () => {
    const burst = '[<65;11;10M[<65;11;10M[<65;11;10M[<65;11;10M'
    expect(new KeyboardEvent(nameless(burst)).key).toBe('')
  })

  test('ESC-prefixed sequence with no name is swallowed', () => {
    expect(new KeyboardEvent(nameless('\x1b[<65;11;10M')).key).toBe('')
  })

  test('named wheeldown still reports name', () => {
    const key: ParsedKey = {
      ...nameless('\x1b[<65;11;10M'),
      name: 'wheeldown',
    }
    expect(new KeyboardEvent(key).key).toBe('wheeldown')
  })

  test('normal printable text still works', () => {
    expect(new KeyboardEvent(nameless('a')).key).toBe('a')
    expect(new KeyboardEvent(nameless('[MAX]')).key).toBe('[MAX]')
  })
})
