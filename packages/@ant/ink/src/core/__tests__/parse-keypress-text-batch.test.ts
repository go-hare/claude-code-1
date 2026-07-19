import { describe, expect, test } from 'bun:test'
import { InputEvent } from '../events/input-event.js'
import { KeyboardEvent } from '../events/keyboard-event.js'
import {
  INITIAL_STATE,
  parseMultipleKeypresses,
  type ParsedInput,
} from '../parse-keypress.js'

function keyItems(items: ParsedInput[]) {
  return items.filter(
    (i): i is Extract<ParsedInput, { kind: 'key' }> => i.kind === 'key',
  )
}

describe('text token batch (official densable tokenizer + ZXc + sji/fag)', () => {
  test('tokenizer peels o\\r into char + return', () => {
    const [items] = parseMultipleKeypresses(INITIAL_STATE, 'o\r')
    const keys = keyItems(items)
    expect(keys.map(k => k.name || k.sequence)).toEqual(['o', 'return'])
    expect(new InputEvent(keys[0]!).input).toBe('o')
    expect(new InputEvent(keys[1]!).key.return).toBe(true)
    expect(new InputEvent(keys[1]!).input).toBe('')
  })

  test('tokenizer peels hello\\r into chars text + return (typed batch one key)', () => {
    const [items] = parseMultipleKeypresses(INITIAL_STATE, 'hello\r')
    const keys = keyItems(items)
    // Official ZXc: whole "hello" text token → one key; CR peeled by tokenizer
    expect(
      keys.map(k => (k.name === 'return' ? 'return' : k.sequence)),
    ).toEqual(['hello', 'return'])
    // sji empties multi-codepoint; fag keeps sequence for KeyboardEvent insert
    expect(new InputEvent(keys[0]!).input).toBe('')
    expect(new KeyboardEvent(keys[0]!).key).toBe('hello')
    expect(new InputEvent(keys[1]!).key.return).toBe(true)
  })

  test('typed multi-char batch hello stays one key (official ZXc)', () => {
    const [items] = parseMultipleKeypresses(INITIAL_STATE, 'hello')
    const keys = keyItems(items)
    expect(keys).toHaveLength(1)
    expect(keys[0]!.sequence).toBe('hello')
    expect(new InputEvent(keys[0]!).input).toBe('')
    expect(new KeyboardEvent(keys[0]!).key).toBe('hello')
  })

  test('CJK batch stays one key; fag exposes full string', () => {
    const [items] = parseMultipleKeypresses(INITIAL_STATE, '你好')
    const keys = keyItems(items)
    expect(keys).toHaveLength(1)
    expect(new InputEvent(keys[0]!).input).toBe('')
    expect(new KeyboardEvent(keys[0]!).key).toBe('你好')
  })

  test('SGR param residue stays text; sji + residue sink empty insert', () => {
    // Official densable ZXc has no residual sink — token stays one nameless key.
    // InputEvent sji empties multi-codepoint; fork KeyboardEvent residue sink
    // also empties (main prompt inserts e.key with no sji).
    const [items] = parseMultipleKeypresses(INITIAL_STATE, '17;19M')
    expect(items).toHaveLength(1)
    const k = keyItems(items)[0]!
    expect(new InputEvent(k).input).toBe('')
    expect(new KeyboardEvent(k).key).toBe('')
  })

  test('[MAX] stays one key and sji empties', () => {
    const [items] = parseMultipleKeypresses(INITIAL_STATE, '[MAX]')
    expect(items).toHaveLength(1)
    expect(new InputEvent(keyItems(items)[0]!).input).toBe('')
  })

  test('bare \\n maps to enter; sji input is \\n; key.return is false', () => {
    const [items] = parseMultipleKeypresses(INITIAL_STATE, '\n')
    const k = keyItems(items)[0]!
    expect(k.name).toBe('enter')
    // Official sji: only name "return" sets key.return; enter → input "\n"
    expect(new InputEvent(k).key.return).toBe(false)
    expect(new InputEvent(k).input).toBe('\n')
  })

  test('CRLF batch collapses to single return via tokenizer', () => {
    const [items] = parseMultipleKeypresses(INITIAL_STATE, 'hi\r\n')
    const keys = keyItems(items)
    expect(keys.map(k => k.name || k.sequence)).toEqual(['hi', 'return'])
    expect(new InputEvent(keys[1]!).key.return).toBe(true)
    expect(new InputEvent(keys[1]!).input).toBe('')
  })

  test('astral emoji batch stays one key; fag keeps emoji', () => {
    const [items] = parseMultipleKeypresses(INITIAL_STATE, '🙂🙂')
    const keys = keyItems(items)
    expect(keys).toHaveLength(1)
    expect(new InputEvent(keys[0]!).input).toBe('')
    expect(new KeyboardEvent(keys[0]!).key).toBe('🙂🙂')
  })

  test('mixed ASCII + emoji batch stays one key', () => {
    const [items] = parseMultipleKeypresses(INITIAL_STATE, 'hello🙂')
    const keys = keyItems(items)
    expect(keys).toHaveLength(1)
    expect(new KeyboardEvent(keys[0]!).key).toBe('hello🙂')
    expect(new InputEvent(keys[0]!).input).toBe('')
  })

  test('emoji text + CR peels return for submit', () => {
    const [items] = parseMultipleKeypresses(INITIAL_STATE, 'hi🙂\r')
    const keys = keyItems(items)
    expect(
      keys.map(k => (k.name === 'return' ? 'return' : k.sequence)),
    ).toEqual(['hi🙂', 'return'])
    expect(new KeyboardEvent(keys[0]!).key).toBe('hi🙂')
    expect(new InputEvent(keys[keys.length - 1]!).key.return).toBe(true)
  })

  test('pure MMMM residue stays text; sji + residue sink empty insert', () => {
    // Official ZXc has no absorb window — multi-char is one key; sji empties.
    // Fork KE isSgrMouseResidue empties pure finalizer runs ≥2 (main insert path).
    const [items] = parseMultipleKeypresses(INITIAL_STATE, 'MMMM')
    expect(items).toHaveLength(1)
    const k = keyItems(items)[0]!
    expect(new InputEvent(k).input).toBe('')
    expect(new KeyboardEvent(k).key).toBe('')
  })

  test('live residue MMM8MMMM stays text; sji + residue sink empty insert', () => {
    // Official densable leaves mixed finalizer+digit noise as text (sji empties).
    // Fork KE residue sink empties MMM8MMMM so main prompt never types it.
    const [items] = parseMultipleKeypresses(INITIAL_STATE, 'MMM8MMMM')
    expect(items).toHaveLength(1)
    const k = keyItems(items)[0]!
    expect(new InputEvent(k).input).toBe('')
    expect(new KeyboardEvent(k).key).toBe('')
  })
})
