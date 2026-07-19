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
 * KeyboardEvent.key = official fag + fork isSgrMouseResidue + mixed scrub.
 * Main prompt inserts e.key with no sji, so progressive param / leading-`<`
 * residue and Image+SGR walls must empty / scrub here.
 */
describe('KeyboardEvent SGR mouse fragment suppress (fag + residue)', () => {
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
    // Multi-char nameless text with letters is not residue
    expect(new KeyboardEvent(nameless('[MAX]')).key).toBe('[MAX]')
  })

  test('incomplete orphan SGR prefix matching fag is empty', () => {
    expect(new KeyboardEvent(nameless('[<64;19;')).key).toBe('')
  })

  test('glued complete + param residue is emptied (fork residue sink)', () => {
    expect(new KeyboardEvent(nameless('[<65;23;12M5;23;12M')).key).toBe('')
    expect(new KeyboardEvent(nameless('5;23;12M')).key).toBe('')
  })

  test('live leading-< progressive desync is emptied', () => {
    // Screenshot residue: ESC and often `[` lost during wheel flood.
    expect(
      new KeyboardEvent(nameless('<64;32;19M4;32;19M32;19M;19M<65;32;19M')).key,
    ).toBe('')
    expect(new KeyboardEvent(nameless('<64;32;19M')).key).toBe('')
    expect(new KeyboardEvent(nameless('4;32;19M')).key).toBe('')
    expect(new KeyboardEvent(nameless('32;19M')).key).toBe('')
    expect(new KeyboardEvent(nameless(';19M')).key).toBe('')
  })

  test('mixed image chip + SGR keeps chip only (scrub embedded)', () => {
    expect(
      new KeyboardEvent(nameless('[Image #2][<65;23;12M5;23;12M')).key,
    ).toBe('[Image #2]')
  })

  test('live image wall + M-param + orphan SGR keeps chips only', () => {
    // Screenshot: [Image #1]…[Image #4]M5;12;11M[<65;12;11M
    expect(
      new KeyboardEvent(nameless('[Image #4]M5;12;11M[<65;12;11M')).key,
    ).toBe('[Image #4]')
    expect(
      new KeyboardEvent(
        nameless(
          '[Image #1][Image #2][Image #3][Image #4]M5;12;11M[<65;12;11M',
        ),
      ).key,
    ).toBe('[Image #1][Image #2][Image #3][Image #4]')
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

  test('pure MMMM is emptied by residue sink (not typed)', () => {
    expect(new KeyboardEvent(nameless('MMMM')).key).toBe('')
  })

  test('2-param residue col;rowM is emptied', () => {
    expect(new KeyboardEvent(nameless('17;19M')).key).toBe('')
    expect(new KeyboardEvent(nameless('17;19m')).key).toBe('')
  })

  test('mixed finalizer + digit noise (MMM8MMMM) is emptied', () => {
    expect(new KeyboardEvent(nameless('MMM8MMMM')).key).toBe('')
    expect(new KeyboardEvent(nameless('MM64MM')).key).toBe('')
    // Lone single finalizer + digit still types (not multi-finalizer desync)
    expect(new KeyboardEvent(nameless('M8')).key).toBe('M8')
  })

  test('short progressive tail 4M / 12m is emptied (scroll residual)', () => {
    // Live Apple Terminal: peel leaves last coord + M in the prompt.
    expect(new KeyboardEvent(nameless('4M')).key).toBe('')
    expect(new KeyboardEvent(nameless('12m')).key).toBe('')
    expect(new KeyboardEvent(nameless('64M')).key).toBe('')
    // Bare M still types; longer digit runs (not typical coords) still type
    expect(new KeyboardEvent(nameless('M')).key).toBe('M')
    expect(new KeyboardEvent(nameless('1234M')).key).toBe('1234M')
  })

  test('mixed chip + short 4M tail keeps chip only', () => {
    expect(new KeyboardEvent(nameless('[Image #1]4M')).key).toBe('[Image #1]')
  })

  test('incomplete param run without finalizer is emptied', () => {
    expect(new KeyboardEvent(nameless('64;32;19')).key).toBe('')
    expect(new KeyboardEvent(nameless('32;19')).key).toBe('')
    // Bare number is still typed
    expect(new KeyboardEvent(nameless('64')).key).toBe('64')
  })

  test('lone M after wheel still has key "M" at KeyboardEvent layer (absorb is App)', () => {
    // densable Q_g also returns "M" for lone finalizer — absorption is
    // time-windowed in processKeysInBatch, not in fag/keyFromParsed.
    expect(new KeyboardEvent(nameless('M')).key).toBe('M')
  })
})
