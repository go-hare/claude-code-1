import { describe, expect, test } from 'bun:test'
import { InputEvent } from '../events/input-event.js'
import { KeyboardEvent } from '../events/keyboard-event.js'
import {
  INITIAL_STATE,
  parseMultipleKeypresses,
  type ParsedInput,
} from '../parse-keypress.js'

function names(items: ParsedInput[]): string[] {
  return items.map(i => {
    if (i.kind === 'key') return i.name || (i.isPasted ? 'paste' : 'key')
    if (i.kind === 'mouse') return `mouse:${i.button}:${i.action}`
    return `response`
  })
}

function sequences(items: ParsedInput[]): string[] {
  return items.map(i => i.sequence ?? '')
}

/**
 * Official densable ZXc (2.1.210) text-branch orphan recovery is whole-token
 * only:
 *   /^\[<\d+;\d+;\d+[Mm]$/
 *   /^\[M[\x60-\x7f][\x20-\uffff]{2}$/
 * Bursts / incomplete / embedded / param residue are NOT peeled or held —
 * they stay as text tokens. InputEvent sji empties multi-codepoint non-paste;
 * KeyboardEvent fag empties ESC-prefixed / pure orphan bursts.
 * No pendingSgrPrefix / absorb window (those were fork-only extras).
 */
describe('orphan SGR/X10 mouse tails (official ZXc whole-token)', () => {
  test('single orphaned wheel-down tail becomes wheeldown', () => {
    const [items] = parseMultipleKeypresses(INITIAL_STATE, '[<65;11;10M')
    expect(names(items)).toEqual(['wheeldown'])
  })

  test('burst of orphaned wheel tails stays text (sji/fag empty insert)', () => {
    const burst = '[<65;11;10M[<65;11;10M[<65;11;10M[<65;11;10M[<65;11;10M'
    const [items] = parseMultipleKeypresses(INITIAL_STATE, burst)
    expect(names(items).every(n => n !== 'wheeldown' && n !== 'wheelup')).toBe(
      true,
    )
    for (const item of items) {
      if (item.kind === 'key') {
        expect(new InputEvent(item).input).toBe('')
        // pure orphan burst matches fag
        expect(new KeyboardEvent(item).key).toBe('')
      }
    }
  })

  test('orphaned wheel-up single token', () => {
    const [items] = parseMultipleKeypresses(INITIAL_STATE, '[<64;5;3M')
    expect(names(items)).toEqual(['wheelup'])
  })

  test('orphaned click tail becomes ParsedMouse (not typed text)', () => {
    const [items] = parseMultipleKeypresses(INITIAL_STATE, '[<0;12;8M')
    expect(items).toHaveLength(1)
    expect(items[0]!.kind).toBe('mouse')
    if (items[0]!.kind === 'mouse') {
      expect(items[0].button).toBe(0)
      expect(items[0].action).toBe('press')
      expect(items[0].col).toBe(12)
      expect(items[0].row).toBe(8)
    }
  })

  test('typed text after complete orphan is not whole-token — stays text', () => {
    const [items] = parseMultipleKeypresses(INITIAL_STATE, '[<65;1;1Mhello')
    expect(names(items).every(n => n !== 'wheeldown')).toBe(true)
    for (const item of items) {
      if (item.kind === 'key') {
        expect(new InputEvent(item).input).toBe('')
      }
    }
  })

  test('typed [MAX] is not swallowed as X10 wheel', () => {
    const [items] = parseMultipleKeypresses(INITIAL_STATE, '[MAX]')
    expect(names(items).every(n => n !== 'wheelup' && n !== 'wheeldown')).toBe(
      true,
    )
    expect(sequences(items).join('')).toContain('[MAX]')
  })

  test('intact ESC-prefixed SGR still works (non-orphan path)', () => {
    const [items] = parseMultipleKeypresses(
      INITIAL_STATE,
      '\x1b[<65;11;10M\x1b[<64;11;10M',
    )
    expect(names(items)).toEqual(['wheeldown', 'wheelup'])
  })

  test('incomplete orphan SGR prefix is text (no hold across chunks)', () => {
    const [items, state] = parseMultipleKeypresses(INITIAL_STATE, '[<64;19;15')
    expect(state.incomplete).toBe('')
    expect(state).not.toHaveProperty('pendingSgrPrefix')
    expect(items.length).toBeGreaterThanOrEqual(1)
    for (const item of items) {
      if (item.kind === 'key') {
        expect(new InputEvent(item).input).toBe('')
      }
    }
  })

  test('multi-chunk incomplete body + M does NOT complete as wheel', () => {
    // Official densable: no pendingSgrPrefix. Each chunk is independent text.
    let state = INITIAL_STATE
    let items: ParsedInput[]
    ;[items, state] = parseMultipleKeypresses(state, '[<65;23;12')
    expect(names(items).every(n => n !== 'wheeldown')).toBe(true)
    ;[items, state] = parseMultipleKeypresses(state, 'M')
    // Single "M" types (official can type late finalizer after desync)
    expect(items).toHaveLength(1)
    if (items[0]!.kind === 'key') {
      expect(items[0].sequence).toBe('M')
      expect(new InputEvent(items[0]).input).toBe('M')
    }
  })

  test('typed M alone still inserts', () => {
    const [items] = parseMultipleKeypresses(INITIAL_STATE, 'M')
    expect(items).toHaveLength(1)
    expect(items[0]!.kind).toBe('key')
    if (items[0]!.kind === 'key') {
      expect(items[0].sequence).toBe('M')
      expect(items[0].name).toBe('m')
      expect(new InputEvent(items[0]).input).toBe('M')
    }
  })

  test('typed M after a complete wheel still inserts (no absorb window)', () => {
    let state = INITIAL_STATE
    let items: ParsedInput[]
    ;[items, state] = parseMultipleKeypresses(state, '\x1b[<65;23;12M')
    expect(names(items)).toEqual(['wheeldown'])
    ;[items, state] = parseMultipleKeypresses(state, 'M')
    expect(items).toHaveLength(1)
    if (items[0]!.kind === 'key') {
      expect(items[0].sequence).toBe('M')
      expect(new InputEvent(items[0]).input).toBe('M')
    }
  })

  test('2-param residue col;rowM is not recovered as mouse (live 17;19M)', () => {
    const [items] = parseMultipleKeypresses(INITIAL_STATE, '17;19M')
    expect(names(items).every(n => n !== 'wheeldown' && n !== 'wheelup')).toBe(
      true,
    )
    for (const item of items) {
      if (item.kind === 'key') {
        expect(new InputEvent(item).input).toBe('')
      }
    }
  })

  test('SGR embedded after image placeholder is not peeled (official)', () => {
    const [items] = parseMultipleKeypresses(
      INITIAL_STATE,
      '[Image #2][<64;19;15M[<65;19;15M[Image #3]',
    )
    expect(names(items).every(n => n !== 'wheeldown' && n !== 'wheelup')).toBe(
      true,
    )
    for (const item of items) {
      if (item.kind === 'key') {
        expect(new InputEvent(item).input).toBe('')
      }
    }
  })

  test('leading-< complete wheel is not recovered (official whole-token needs [)', () => {
    // Official only re-ESC's `\[<…M` whole token, not leading-`<` alone.
    const [items] = parseMultipleKeypresses(INITIAL_STATE, '<65;11;10M')
    expect(names(items).every(n => n !== 'wheeldown')).toBe(true)
    for (const item of items) {
      if (item.kind === 'key') {
        expect(new InputEvent(item).input).toBe('')
      }
    }
  })

  test('flush of incomplete ESC+[ yields nameless sequence emptied by fag/sji', () => {
    let state = INITIAL_STATE
    let items: ParsedInput[]
    ;[items, state] = parseMultipleKeypresses(state, '\x1b[')
    expect(items).toHaveLength(0)
    expect(state.incomplete).toBe('\x1b[')
    ;[items, state] = parseMultipleKeypresses(state, null)
    expect(items.length).toBeGreaterThanOrEqual(1)
    for (const item of items) {
      if (item.kind === 'key') {
        expect(new InputEvent(item).input).toBe('')
        expect(new KeyboardEvent(item).key).toBe('')
      }
    }
  })

  test('pure MMMM multi-char is emptied by sji and fork residue sink', () => {
    const [items] = parseMultipleKeypresses(INITIAL_STATE, 'MMMM')
    expect(items).toHaveLength(1)
    if (items[0]!.kind === 'key') {
      // InputEvent sji: multi-codepoint non-paste → ""
      expect(new InputEvent(items[0]).input).toBe('')
      // KeyboardEvent: fork isSgrMouseResidue (main prompt inserts e.key, no sji)
      expect(new KeyboardEvent(items[0]).key).toBe('')
    }
  })

  test('live progressive desync and glued residue empty at KE insert path', () => {
    const cases = [
      '<64;32;19M4;32;19M32;19M;19M<65;32;19M',
      '[<65;23;12M5;23;12M',
      '5;23;12M',
      'MMM8MMMM',
      '64;32;19',
    ]
    for (const seq of cases) {
      const [items] = parseMultipleKeypresses(INITIAL_STATE, seq)
      expect(items.length).toBeGreaterThanOrEqual(1)
      for (const item of items) {
        if (item.kind === 'key') {
          expect(new InputEvent(item).input).toBe('')
          expect(new KeyboardEvent(item).key).toBe('')
        }
      }
    }
  })
})
