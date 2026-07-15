import { describe, expect, test } from 'bun:test'
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

describe('orphan SGR/X10 mouse tails', () => {
  test('single orphaned wheel-down tail becomes wheeldown', () => {
    const [items] = parseMultipleKeypresses(INITIAL_STATE, '[<65;11;10M')
    expect(names(items)).toEqual(['wheeldown'])
  })

  test('burst of orphaned wheel tails (fast scroll) does not leak as text', () => {
    // Repro: top→bottom flick batches many orphaned tails in one read after
    // ESC was flushed alone during a heavy render. Old ^...$ match failed
    // and the whole string typed into the prompt as [<65;11;10M[<65;...
    const burst = '[<65;11;10M[<65;11;10M[<65;11;10M[<65;11;10M[<65;11;10M'
    const [items] = parseMultipleKeypresses(INITIAL_STATE, burst)
    expect(names(items)).toEqual([
      'wheeldown',
      'wheeldown',
      'wheeldown',
      'wheeldown',
      'wheeldown',
    ])
    // No leftover printable garbage key whose sequence is the raw burst.
    for (const item of items) {
      expect(item.kind).toBe('key')
      if (item.kind === 'key') {
        expect(item.name).toBe('wheeldown')
        expect((item.sequence ?? '').startsWith('\x1b[<65;')).toBe(true)
      }
    }
  })

  test('orphaned wheel-up and mixed directions', () => {
    const [items] = parseMultipleKeypresses(
      INITIAL_STATE,
      '[<64;5;3M[<65;5;3M[<64;5;3M',
    )
    expect(names(items)).toEqual(['wheelup', 'wheeldown', 'wheelup'])
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

  test('prefix peel leaves non-mouse typed text after tails', () => {
    const [items] = parseMultipleKeypresses(INITIAL_STATE, '[<65;1;1Mhello')
    expect(names(items)[0]).toBe('wheeldown')
    // Remaining text becomes a key with sequence "hello"
    const rest = items.slice(1)
    expect(rest.length).toBeGreaterThanOrEqual(1)
    expect(sequences(rest).join('')).toContain('hello')
  })

  test('typed [MAX] is not swallowed as X10 wheel', () => {
    const [items] = parseMultipleKeypresses(INITIAL_STATE, '[MAX]')
    // Must not become wheel*/mouse — should remain as text/key content.
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
})
