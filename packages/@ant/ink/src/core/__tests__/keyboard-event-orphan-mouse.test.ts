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

/**
 * KeyboardEvent.key follows official densable fag only:
 *   - space / ctrl / single printable / named / ESC empty
 *   - pure orphan SGR burst: /^(\[<\d[\d;]*[Mm]?)+$/
 * Multi-char residue (17;19M, MMMM, glued param tails) is NOT emptied here —
 * official sji at InputEvent drops multi-codepoint non-paste input.
 */
describe('KeyboardEvent SGR mouse fragment suppress (official fag)', () => {
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
    const e = new KeyboardEvent(key)
    expect(e.key).toBe('wheeldown')
    expect(e.name).toBe('wheeldown')
  })

  test('normal printable text still works', () => {
    expect(new KeyboardEvent(nameless('a')).key).toBe('a')
    // Multi-char nameless text passes through fag (sji empties at InputEvent)
    expect(new KeyboardEvent(nameless('[MAX]')).key).toBe('[MAX]')
  })

  test('incomplete orphan SGR prefix matching fag is empty', () => {
    // fag: \[<\d[\d;]*[Mm]?  — incomplete tail still matches without finalizer
    expect(new KeyboardEvent(nameless('[<64;19;')).key).toBe('')
  })

  test('glued complete + param residue is NOT pure fag — passes as key text', () => {
    // Official fag only pure-burst; glued "…M5;23;12M" fails ^...$ and returns seq.
    // InputEvent sji then empties multi-codepoint non-paste.
    expect(new KeyboardEvent(nameless('[<65;23;12M5;23;12M')).key).toBe(
      '[<65;23;12M5;23;12M',
    )
    expect(new KeyboardEvent(nameless('5;23;12M')).key).toBe('5;23;12M')
  })

  test('mixed image chip + SGR passes as key text (sji empties later)', () => {
    expect(
      new KeyboardEvent(nameless('[Image #2][<65;23;12M5;23;12M')).key,
    ).toBe('[Image #2][<65;23;12M5;23;12M')
  })

  test('legitimate single M still inserts', () => {
    expect(new KeyboardEvent(nameless('M')).key).toBe('M')
    expect(new KeyboardEvent(nameless('m')).key).toBe('m')
  })

  test('exposes official name + sequence fields for tS_ blacklist', () => {
    const wheel: ParsedKey = {
      ...nameless('\x1b[<65;11;10M'),
      name: 'wheeldown',
    }
    const e = new KeyboardEvent(wheel)
    expect(e.name).toBe('wheeldown')
    expect(e.key).toBe('wheeldown')
    expect(e.sequence).toBe('\x1b[<65;11;10M')

    const typed = new KeyboardEvent(nameless('hello'))
    expect(typed.name).toBe('')
    expect(typed.key).toBe('hello')
  })

  test('pure MMMM is NOT emptied by fag (sji empties at InputEvent)', () => {
    expect(new KeyboardEvent(nameless('MMMM')).key).toBe('MMMM')
  })

  test('2-param residue col;rowM is NOT emptied by fag (sji empties later)', () => {
    expect(new KeyboardEvent(nameless('17;19M')).key).toBe('17;19M')
    expect(new KeyboardEvent(nameless('17;19m')).key).toBe('17;19m')
  })
})
