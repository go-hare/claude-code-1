/**
 * densable 2.1.247 #10 — qb flushedEscapePrefix for split `<35;150;7M`.
 */
import { describe, expect, test } from 'bun:test'
import {
  INITIAL_STATE,
  parseMultipleKeypresses,
  type ParsedInput,
} from '../parse-keypress.js'

function typedSequences(items: ParsedInput[]): string {
  return items
    .filter((i): i is Extract<ParsedInput, { kind: 'key' }> => i.kind === 'key')
    .map(i => i.sequence ?? '')
    .join('')
}

describe('densable 2.1.247 #10 flushedEscapePrefix', () => {
  test('INITIAL_STATE has empty flushedEscapePrefix', () => {
    expect(INITIAL_STATE.flushedEscapePrefix).toBe('')
  })

  test('flush of ESC[ parks flushedEscapePrefix', () => {
    let state = INITIAL_STATE
    let items: ParsedInput[]
    ;[items, state] = parseMultipleKeypresses(state, '\x1b[')
    expect(state.incomplete).toBe('\x1b[')
    expect(state.flushedEscapePrefix).toBe('')
    ;[items, state] = parseMultipleKeypresses(state, null)
    expect(state.flushedEscapePrefix).toBe('\x1b[')
    expect(typedSequences(items)).not.toContain('35;150;7')
  })

  test('parked ESC[ then <35;150;7M is mouse, not typed residue', () => {
    let [, state] = parseMultipleKeypresses(INITIAL_STATE, '\x1b[')
    ;[, state] = parseMultipleKeypresses(state, null)
    expect(state.flushedEscapePrefix).toBe('\x1b[')
    const [items, next] = parseMultipleKeypresses(state, '<35;150;7M')
    expect(next.flushedEscapePrefix).toBe('')
    expect(typedSequences(items)).not.toContain('35;150;7M')
    expect(typedSequences(items)).not.toContain('<35')
    expect(
      items.some(
        i =>
          i.kind === 'mouse' ||
          (i.kind === 'key' &&
            (i.name === 'mouse' || i.sequence?.includes('<35'))),
      ),
    ).toBe(true)
  })

  test('non-mouse leftover after parked ESC[ is not forced into SGR', () => {
    let [, state] = parseMultipleKeypresses(INITIAL_STATE, '\x1b[')
    ;[, state] = parseMultipleKeypresses(state, null)
    const [items] = parseMultipleKeypresses(state, 'hello')
    expect(typedSequences(items)).toContain('hello')
  })
})
