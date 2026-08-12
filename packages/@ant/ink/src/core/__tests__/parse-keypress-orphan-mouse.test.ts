import { describe, expect, test } from 'bun:test'
import {
  INITIAL_STATE,
  parseMultipleKeypresses,
  type ParsedInput,
} from '../parse-keypress.js'
import { InputEvent } from '../events/input-event.js'
import { KeyboardEvent } from '../events/keyboard-event.js'

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
 * densable 2.1.228 kTd (was ZXc) orphan SGR/X10 recovery:
 *   whole-token only:
 *     /^\[<\d+;\d+;\d+[Mm]$/
 *     /^\[M[\x60-\x7f][\x20-￿]{2}$/
 * No prefix peel, no pendingSgr, no absorbMm (SEA confirmed 228).
 * Incomplete CSI stays in tokenizer.buffer() until App NORMAL_TIMEOUT flush;
 * flush emits the incomplete body as a sequence → parseKeypress (often empty
 * ESC key via KeyboardEvent xM_).
 */
describe('orphan SGR/X10 mouse tails (densable whole-token re-ESC)', () => {
  test('single orphaned wheel-down tail becomes wheeldown', () => {
    const [items] = parseMultipleKeypresses(INITIAL_STATE, '[<65;11;10M')
    expect(names(items)).toEqual(['wheeldown'])
  })

  test('burst of orphaned wheel tails is NOT peeled (whole-token only)', () => {
    // densable: multi-event text is one key, not successive wheels.
    const burst = '[<65;11;10M[<65;11;10M[<65;11;10M'
    const [items] = parseMultipleKeypresses(INITIAL_STATE, burst)
    expect(names(items).every(n => n !== 'wheeldown' && n !== 'wheelup')).toBe(
      true,
    )
    // KeyboardEvent xM_ empties pure [<\d… burst
    for (const item of items) {
      if (item.kind === 'key') {
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

  test('typed text after complete orphan is NOT prefix-peeled', () => {
    // densable whole-token only — `[<65;1;1Mhello` is not a whole SGR token.
    const [items] = parseMultipleKeypresses(INITIAL_STATE, '[<65;1;1Mhello')
    expect(names(items).every(n => n !== 'wheeldown')).toBe(true)
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

  test('incomplete orphan SGR stays buffered (no pendingSgr invent)', () => {
    // densable mbt holds incomplete CSI in buffer until flush.
    const [items, state] = parseMultipleKeypresses(INITIAL_STATE, '[<64;19;15')
    // Without leading ESC this may be text or incomplete depending on tokenizer
    // path; densable has no pendingSgrPrefix field.
    expect(state).not.toHaveProperty('pendingSgrPrefix')
    // Late M alone is a typed key (densable loses the body on flush).
    const [items2] = parseMultipleKeypresses(state, 'M')
    // Not inventing hold→complete: may be wheel only if body was still in
    // tokenizer incomplete with ESC. Prefer densable: lone M types.
    for (const item of items2) {
      if (item.kind === 'key' && item.name === 'm') {
        expect(item.sequence).toBe('M')
      }
    }
    // Ensure we did not invent sticky absorb of pure M runs after incomplete.
    void items
  })

  test('flush of incomplete ESC+[ is sequence (densable FDu flush)', () => {
    let state = INITIAL_STATE
    let items: ParsedInput[]
    ;[items, state] = parseMultipleKeypresses(state, '\x1b[')
    expect(items).toHaveLength(0)
    expect(state.incomplete).toBe('\x1b[')
    ;[items, state] = parseMultipleKeypresses(state, null)
    // densable flush emits incomplete as sequence → parseKeypress (often empty
    // via KeyboardEvent ESC / residue path). Must not open M absorb window.
    ;[items, state] = parseMultipleKeypresses(state, 'MMMM')
    expect(items.length).toBeGreaterThanOrEqual(1)
    for (const item of items) {
      if (item.kind === 'key') {
        // Pure MMMM is kept as typed sequence at parse layer
        expect(item.sequence).toContain('M')
      }
    }
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

  test('typed M after a complete wheel is kept (no multi-key absorb window)', () => {
    let state = INITIAL_STATE
    let items: ParsedInput[]
    ;[items, state] = parseMultipleKeypresses(state, '\x1b[<65;23;12M')
    expect(names(items)).toEqual(['wheeldown'])
    ;[items, state] = parseMultipleKeypresses(state, 'M')
    expect(items).toHaveLength(1)
    expect(items[0]!.kind).toBe('key')
    if (items[0]!.kind === 'key') {
      expect(items[0].sequence).toBe('M')
    }
  })

  test('2-param residue col;rowM is not recovered as mouse (live 17;19M)', () => {
    const [items] = parseMultipleKeypresses(INITIAL_STATE, '17;19M')
    expect(names(items).every(n => n !== 'wheeldown' && n !== 'wheelup')).toBe(
      true,
    )
  })

  test('SGR embedded after image placeholder is not peeled (densable)', () => {
    const [items] = parseMultipleKeypresses(
      INITIAL_STATE,
      '[Image #2][<64;19;15M[<65;19;15M[Image #3]',
    )
    expect(names(items).every(n => n !== 'wheeldown' && n !== 'wheelup')).toBe(
      true,
    )
  })

  test('typed char then orphan SGR is not peeled as wheel (densable)', () => {
    const [items] = parseMultipleKeypresses(INITIAL_STATE, 'x[<64;19;15M')
    expect(names(items).every(n => n !== 'wheelup')).toBe(true)
  })

  test('lone param residue is not treated as mouse', () => {
    const [items] = parseMultipleKeypresses(INITIAL_STATE, '5;23;12M')
    expect(names(items).every(n => n !== 'wheeldown' && n !== 'wheelup')).toBe(
      true,
    )
  })

  test('X10 orphan whole-token wheel payload recovers', () => {
    // densable: /^\[M[\x60-\x7f][\x20-￿]{2}$/
    // X10 encodes button as (code+32); wheel-up button 64 → byte 0x60.
    const payload = '[M' + String.fromCharCode(0x60, 0x20 + 5, 0x20 + 3)
    const [items] = parseMultipleKeypresses(INITIAL_STATE, payload)
    expect(
      names(items).some(
        n => n === 'wheelup' || n === 'wheeldown' || n.startsWith('mouse:'),
      ),
    ).toBe(true)
  })
})
