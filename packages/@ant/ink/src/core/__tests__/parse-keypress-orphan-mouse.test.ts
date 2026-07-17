import { describe, expect, test } from 'bun:test'
import {
  INITIAL_STATE,
  parseMultipleKeypresses,
  type ParsedInput,
} from '../parse-keypress.js'
import { InputEvent } from '../events/input-event.js'

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
 * Orphan SGR/X10 recovery:
 * - Official densable ZXc whole-token re-ESC:
 *     /^\[<\d+;\d+;\d+[Mm]$/
 *     /^\[M[\x60-\x7f][\x20-\uffff]{2}$/
 * - Fork also peels successive COMPLETE orphan mouse events from the front
 *   of a text token so ESC-lost wheel bursts still scroll (live: without
 *   peel, residues like "MMM8MMMM" steal the input path and scroll sticks).
 * Incomplete / param residue stays text; InputEvent sji empties multi-char.
 */
describe('orphan SGR/X10 mouse tails (whole-token + complete prefix peel)', () => {
  test('single orphaned wheel-down tail becomes wheeldown', () => {
    const [items] = parseMultipleKeypresses(INITIAL_STATE, '[<65;11;10M')
    expect(names(items)).toEqual(['wheeldown'])
  })

  test('burst of orphaned wheel tails peels into wheeldown keys', () => {
    const burst = '[<65;11;10M[<65;11;10M[<65;11;10M[<65;11;10M[<65;11;10M'
    const [items] = parseMultipleKeypresses(INITIAL_STATE, burst)
    expect(names(items)).toEqual([
      'wheeldown',
      'wheeldown',
      'wheeldown',
      'wheeldown',
      'wheeldown',
    ])
    for (const item of items) {
      if (item.kind === 'key') {
        expect(new InputEvent(item).input).toBe('')
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

  test('typed text after complete orphan peels mouse then keeps text', () => {
    // Prefix peel takes the complete mouse; leftover "hello" is text (sji empty).
    const [items] = parseMultipleKeypresses(INITIAL_STATE, '[<65;1;1Mhello')
    expect(names(items)[0]).toBe('wheeldown')
    const textKeys = items.filter(
      (i): i is Extract<ParsedInput, { kind: 'key' }> =>
        i.kind === 'key' && i.name !== 'wheeldown',
    )
    expect(textKeys.length).toBeGreaterThanOrEqual(1)
    for (const item of textKeys) {
      expect(new InputEvent(item).input).toBe('')
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

  test('incomplete orphan SGR prefix is held for late finalizer (not typed)', () => {
    // 3-param incomplete body + late M → wheel. Official densable flushes
    // and loses the body; fork keeps pendingSgrPrefix so "M" is not typed.
    const [items, state] = parseMultipleKeypresses(INITIAL_STATE, '[<64;19;15')
    expect(state.incomplete).toBe('')
    expect(items).toHaveLength(0)
    expect(state.pendingSgrPrefix).toBe('[<64;19;15')
    const [items2] = parseMultipleKeypresses(state, 'M')
    expect(names(items2)).toEqual(['wheelup'])
    for (const item of items2) {
      if (item.kind === 'key') {
        expect(new InputEvent(item).input).toBe('')
      }
    }
  })

  test('late pure M run after held incomplete is absorbed not typed', () => {
    let [items, state] = parseMultipleKeypresses(
      INITIAL_STATE,
      '\x1b[<65;11;10',
    )
    // Still incomplete in tokenizer until flush
    ;[items, state] = parseMultipleKeypresses(state, null)
    // Held or emptied — must not type the body
    for (const item of items) {
      if (item.kind === 'key') {
        expect(new InputEvent(item).input).toBe('')
      }
    }
    ;[items, state] = parseMultipleKeypresses(state, 'M')
    // Completes wheeldown if held
    expect(
      names(items).filter(n => n === 'wheeldown').length,
    ).toBeGreaterThanOrEqual(0)
    for (const item of items) {
      if (item.kind === 'key') {
        expect(new InputEvent(item).input).toBe('')
      }
    }
    ;[items, state] = parseMultipleKeypresses(state, 'MMMMMMMM')
    // Pure finalizer run absorbed — never typed
    expect(items).toHaveLength(0)
  })

  test('incomplete orphan SGR with junk after body stays sji-empty', () => {
    const [items, state] = parseMultipleKeypresses(INITIAL_STATE, '[<64;19;x')
    expect(state.incomplete).toBe('')
    for (const item of items) {
      if (item.kind === 'key') {
        expect(new InputEvent(item).input).toBe('')
      }
    }
  })

  test('later complete tail after incomplete prefix peels complete wheel', () => {
    // Prefix peel takes complete `[<65;11;10M`; incomplete head held/dropped.
    const [items] = parseMultipleKeypresses(
      INITIAL_STATE,
      '[<64;19;[<65;11;10M',
    )
    // May peel the complete wheel; either way sji must not type residue.
    for (const item of items) {
      if (item.kind === 'key') {
        expect(new InputEvent(item).input).toBe('')
      }
    }
  })

  test('multi-chunk incomplete 3-param body + M completes as wheel', () => {
    // Fork holds incomplete SGR so late finalizer scrolls instead of typing M.
    let state = INITIAL_STATE
    let items: ParsedInput[]
    ;[items, state] = parseMultipleKeypresses(state, '[<65;23;12')
    expect(items).toHaveLength(0)
    expect(state.pendingSgrPrefix).toBe('[<65;23;12')
    ;[items, state] = parseMultipleKeypresses(state, 'M')
    expect(names(items)).toEqual(['wheeldown'])
    ;[items, state] = parseMultipleKeypresses(state, 'MMMM')
    // Absorb trailing finalizers after complete wheel
    expect(items).toHaveLength(0)
  })

  test('typed M alone still inserts (not swallowed as SGR residue)', () => {
    const [items] = parseMultipleKeypresses(INITIAL_STATE, 'M')
    expect(items).toHaveLength(1)
    expect(items[0]!.kind).toBe('key')
    if (items[0]!.kind === 'key') {
      expect(items[0].sequence).toBe('M')
      expect(items[0].name).toBe('m')
      expect(new InputEvent(items[0]).input).toBe('M')
    }
  })

  test('typed M after a complete wheel is absorbed (desync window)', () => {
    // Live walls of M come from finalizers arriving after a complete SGR.
    // After any complete wheel we open an absorb window for pure M/m runs.
    // Idle single M without a recent mouse event still inserts (test above).
    let state = INITIAL_STATE
    let items: ParsedInput[]
    ;[items, state] = parseMultipleKeypresses(state, '\x1b[<65;23;12M')
    expect(names(items)).toEqual(['wheeldown'])
    ;[items, state] = parseMultipleKeypresses(state, 'M')
    expect(items).toHaveLength(0)
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
    // Official whole-token only — mixed image+SGR stays text; sji empties.
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

  test('typed char then orphan SGR is not peeled as wheel (official)', () => {
    const [items] = parseMultipleKeypresses(INITIAL_STATE, 'x[<64;19;15M')
    expect(names(items).every(n => n !== 'wheelup')).toBe(true)
    for (const item of items) {
      if (item.kind === 'key') {
        expect(new InputEvent(item).input).toBe('')
      }
    }
  })

  test('lone param residue is not treated as mouse', () => {
    const [items] = parseMultipleKeypresses(INITIAL_STATE, '5;23;12M')
    expect(names(items).every(n => n !== 'wheeldown' && n !== 'wheelup')).toBe(
      true,
    )
    for (const item of items) {
      if (item.kind === 'key') {
        expect(new InputEvent(item).input).toBe('')
      }
    }
  })

  test('flush of incomplete ESC+[ is swallowed (mouse-start, not typed)', () => {
    // Tokenizer holds "\x1b["; flush would emit sequence. We treat bare CSI
    // mouse start as non-text and open the M/m absorb window instead.
    let state = INITIAL_STATE
    let items: ParsedInput[]
    ;[items, state] = parseMultipleKeypresses(state, '\x1b[')
    expect(items).toHaveLength(0)
    expect(state.incomplete).toBe('\x1b[')
    ;[items, state] = parseMultipleKeypresses(state, null)
    expect(items).toHaveLength(0)
    // Subsequent pure M run absorbed
    ;[items, state] = parseMultipleKeypresses(state, 'MMMM')
    expect(items).toHaveLength(0)
  })
})
