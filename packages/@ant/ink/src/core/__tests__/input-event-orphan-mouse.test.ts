import { describe, expect, test } from 'bun:test'
import { InputEvent } from '../events/input-event.js'
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

describe('InputEvent SGR mouse fragment suppress', () => {
  test('single complete orphan SGR is empty input', () => {
    expect(new InputEvent(nameless('[<65;11;10M')).input).toBe('')
  })

  test('burst of orphan SGR tails is empty input', () => {
    const burst = '[<65;11;10M[<65;11;10M[<64;19;15M'
    expect(new InputEvent(nameless(burst)).input).toBe('')
  })

  test('incomplete orphan SGR prefix is empty input', () => {
    expect(new InputEvent(nameless('[<64;19;')).input).toBe('')
  })

  test('single-codepoint text still inserts (official sji)', () => {
    expect(new InputEvent(nameless('a')).input).toBe('a')
    expect(new InputEvent(nameless('M')).input).toBe('M')
    // Fullwidth colon is one codepoint — must still type.
    expect(new InputEvent(nameless('：')).input).toBe('：')
  })

  test('multi-codepoint non-paste is empty (official sji)', () => {
    // Official sji: [...e.key].length===1 ? e.key : ""
    // This is why official never inserts "17;19M" / "hello"-as-one-key /
    // orphan bursts into the prompt without residual-regex sinks.
    expect(new InputEvent(nameless('hello')).input).toBe('')
    expect(new InputEvent(nameless('[MAX]')).input).toBe('')
    expect(new InputEvent(nameless('17;19M')).input).toBe('')
  })

  test('bracketed paste multi-char still keeps content', () => {
    const pasted: ParsedKey = {
      ...nameless('hello pasted'),
      isPasted: true,
    }
    expect(new InputEvent(pasted).input).toBe('hello pasted')
  })

  test('named wheeldown has empty input (official lag)', () => {
    const wheel: ParsedKey = {
      kind: 'key',
      name: 'wheeldown',
      fn: false,
      ctrl: false,
      meta: false,
      shift: false,
      option: false,
      super: false,
      sequence: '\x1b[<65;18;16M',
      raw: '\x1b[<65;18;16M',
      isPasted: false,
    }
    expect(new InputEvent(wheel).input).toBe('')
    expect(new InputEvent(wheel).key.wheelDown).toBe(true)
  })

  test('ESC-prefixed orphan SGR burst is empty after strip', () => {
    expect(
      new InputEvent(nameless('\x1b[<65;18;16M\x1b[<65;18;16M')).input,
    ).toBe('')
  })

  test('mixed image chip + SGR is empty via official sji (multi-codepoint)', () => {
    // Residual scrub would leave "[Image #2]"; official sji then drops it
    // because [...input].length !== 1 and isPasted is false.
    expect(
      new InputEvent(nameless('[Image #2][<65;18;16M[<65;18;16M')).input,
    ).toBe('')
  })

  test('glued complete + param residue is empty input', () => {
    // Live screenshot: "[<65;23;12M5;23;12M" — second event lost "[<"
    expect(new InputEvent(nameless('[<65;23;12M5;23;12M')).input).toBe('')
  })

  test('pure param residue alone is empty input', () => {
    expect(new InputEvent(nameless('5;23;12M')).input).toBe('')
  })

  test('live residue MMM8MMMM is empty input (sji multi-codepoint)', () => {
    expect(new InputEvent(nameless('MMM8MMMM')).input).toBe('')
    expect(new InputEvent(nameless('MMMM')).input).toBe('')
  })

  test('legitimate single M still inserts', () => {
    expect(new InputEvent(nameless('M')).input).toBe('M')
    expect(new InputEvent(nameless('m')).input).toBe('m')
  })

  test('pure MMMM finalizer run is empty input', () => {
    expect(new InputEvent(nameless('MMMM')).input).toBe('')
  })

  test('2-param residue col;rowM is empty input (live 17;19M)', () => {
    expect(new InputEvent(nameless('17;19M')).input).toBe('')
    expect(new InputEvent(nameless('17;19m')).input).toBe('')
  })

  test('flushed incomplete CSI opener ESC+[ is empty (live [[[[ leak)', () => {
    // App NORMAL_TIMEOUT flush of tokenizer buffer "\x1b[" emits a nameless
    // sequence. Official fag empties ESC-prefixed; without that, strip leaves
    // bare "[" and sji inserts it (collapse-scroll "[[[[[[[[[[").
    expect(new InputEvent(nameless('\x1b[')).input).toBe('')
    expect(new InputEvent(nameless('\x1b[<')).input).toBe('')
    expect(new InputEvent(nameless('\x1b[<65;23;12')).input).toBe('')
  })

  test('typed bare [ still inserts', () => {
    expect(new InputEvent(nameless('[')).input).toBe('[')
  })

  test('ESC+alnum meta still inserts letter (ink Alt path)', () => {
    const altA: ParsedKey = {
      ...nameless('\x1ba'),
      meta: true,
    }
    expect(new InputEvent(altA).input).toBe('a')
    expect(new InputEvent(altA).key.meta).toBe(true)
  })
})
