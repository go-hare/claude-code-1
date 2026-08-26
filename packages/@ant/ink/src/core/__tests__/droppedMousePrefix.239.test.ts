import { describe, expect, test } from 'bun:test'
import {
  INITIAL_STATE,
  isHeldSgrMousePrefix,
  parkIncompleteMousePrefix,
  parseMultipleKeypresses,
  type ParsedInput,
} from '../parse-keypress.js'
import { InputEvent } from '../events/input-event.js'

function names(items: ParsedInput[]): string[] {
  return items.map(i => {
    if (i.kind === 'key') return i.name || (i.isPasted ? 'paste' : 'key')
    if (i.kind === 'mouse') return `mouse:${i.button}:${i.action}`
    return 'response'
  })
}

function typedSequences(items: ParsedInput[]): string[] {
  return items
    .filter((i): i is Extract<ParsedInput, { kind: 'key' }> => i.kind === 'key')
    .map(i => i.sequence ?? '')
}

describe('droppedMousePrefix (densable Qyf / Qpr / Jyf)', () => {
  test('Qpr holds incomplete ESC[< digits; prefix', () => {
    expect(isHeldSgrMousePrefix('\x1b[<35;150;7')).toBe(true)
    expect(isHeldSgrMousePrefix('\x1b[<')).toBe(true)
    expect(isHeldSgrMousePrefix('\x1b[')).toBe(false)
    expect(isHeldSgrMousePrefix('35;150;7M')).toBe(false)
    expect(isHeldSgrMousePrefix(`\x1b[<${'1'.repeat(30)}`)).toBe(false)
  })

  test('split CSI then M completes as mouse (no typed residue)', () => {
    let state = INITIAL_STATE
    let items: ParsedInput[]
    ;[items, state] = parseMultipleKeypresses(state, '\x1b[<35;150;7')
    expect(items).toEqual([])
    expect(state.incomplete).toBe('\x1b[<35;150;7')
    expect(state.droppedMousePrefix).toBe('')
    ;[items, state] = parseMultipleKeypresses(state, 'M')
    expect(
      names(items).some(n => n.startsWith('mouse:') || n === 'mouse'),
    ).toBe(true)
    expect(typedSequences(items).join('')).not.toContain('35;150;7')
  })

  test('flush of Qpr prefix holds in tokenizer (does not type)', () => {
    let state = INITIAL_STATE
    let items: ParsedInput[]
    ;[items, state] = parseMultipleKeypresses(state, '\x1b[<35;150;7')
    ;[items, state] = parseMultipleKeypresses(state, null)
    expect(items).toEqual([])
    expect(state.incomplete).toBe('\x1b[<35;150;7')
    expect(state.droppedMousePrefix).toBe('')
    ;[items, state] = parseMultipleKeypresses(state, 'M')
    expect(typedSequences(items).join('')).not.toContain('35;150;7')
    expect(
      names(items).every(n => n !== '3' && n !== '5' && n !== 'number'),
    ).toBe(true)
  })

  test('Jyf park then M drops completed report (changelog 35;150;7M)', () => {
    let [, state] = parseMultipleKeypresses(INITIAL_STATE, '\x1b[<35;150;7')
    state = parkIncompleteMousePrefix(state)
    expect(state.incomplete).toBe('')
    expect(state.droppedMousePrefix).toBe('\x1b[<35;150;7')
    const [items, next] = parseMultipleKeypresses(state, 'M')
    expect(items).toEqual([])
    expect(next.droppedMousePrefix).toBe('')
  })

  test('Jyf park of ESC[< then residue 35;150;7M is dropped not typed', () => {
    let [, state] = parseMultipleKeypresses(INITIAL_STATE, '\x1b[<')
    state = parkIncompleteMousePrefix(state)
    expect(state.droppedMousePrefix).toBe('\x1b[<')
    const [items] = parseMultipleKeypresses(state, '35;150;7M')
    expect(items).toEqual([])
    expect(typedSequences(items).join('')).not.toContain('35;150;7M')
  })

  test('Jyf park then leftover hello after completed mouse is typed', () => {
    let [, state] = parseMultipleKeypresses(INITIAL_STATE, '\x1b[<35;150;7')
    state = parkIncompleteMousePrefix(state)
    const [items] = parseMultipleKeypresses(state, 'Mhello')
    expect(typedSequences(items).join('')).toContain('hello')
    expect(typedSequences(items).join('')).not.toContain('35;150;7')
  })

  test('too-long Xyf prefix on flush parks into droppedMousePrefix', () => {
    const long = `\x1b[<${'1'.repeat(30)}`
    let [, state] = parseMultipleKeypresses(INITIAL_STATE, long)
    expect(isHeldSgrMousePrefix(state.incomplete)).toBe(false)
    expect(state.incomplete.startsWith('\x1b[<')).toBe(true)
    const [items, next] = parseMultipleKeypresses(state, null)
    expect(items).toEqual([])
    expect(next.incomplete).toBe('')
    expect(next.droppedMousePrefix).toBe(long)
  })

  test('typed M alone still inserts', () => {
    const [items] = parseMultipleKeypresses(INITIAL_STATE, 'M')
    expect(items).toHaveLength(1)
    expect(items[0]!.kind).toBe('key')
    if (items[0]!.kind === 'key') {
      expect(items[0].sequence).toBe('M')
      expect(new InputEvent(items[0]).input).toBe('M')
    }
  })
})
