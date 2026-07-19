import { describe, expect, test } from 'bun:test'
import { shouldAbsorbLateSgrFinalizer } from '../../components/App.js'
import {
  INITIAL_STATE,
  parseMultipleKeypresses,
  type ParsedKey,
} from '../parse-keypress.js'

function key(sequence: string, extra: Partial<ParsedKey> = {}): ParsedKey {
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
    ...extra,
  }
}

/** Real parseKeypress shape for printable "M"/"m". */
function parseLetter(seq: 'M' | 'm'): ParsedKey {
  const [items] = parseMultipleKeypresses(INITIAL_STATE, seq)
  const item = items[0]
  if (!item || item.kind !== 'key') {
    throw new Error(`expected key for ${seq}`)
  }
  return item
}

describe('shouldAbsorbLateSgrFinalizer (post-wheel desync sink)', () => {
  test('real parse of M has name=m and shift=true', () => {
    const m = parseLetter('M')
    expect(m.name).toBe('m')
    expect(m.shift).toBe(true)
    expect(m.sequence).toBe('M')
    const lower = parseLetter('m')
    expect(lower.name).toBe('m')
    expect(lower.shift).toBe(false)
  })

  test('absorbs real-parsed lone M/m within 80ms of wheel/mouse', () => {
    const t0 = 1000
    expect(shouldAbsorbLateSgrFinalizer(parseLetter('M'), t0, t0 + 10)).toBe(
      true,
    )
    expect(shouldAbsorbLateSgrFinalizer(parseLetter('m'), t0, t0 + 79)).toBe(
      true,
    )
    // Nameless still accepted if something peels name off
    expect(shouldAbsorbLateSgrFinalizer(key('M'), t0, t0 + 10)).toBe(true)
  })

  test('does not absorb after window expires', () => {
    const t0 = 1000
    expect(shouldAbsorbLateSgrFinalizer(parseLetter('M'), t0, t0 + 81)).toBe(
      false,
    )
    expect(shouldAbsorbLateSgrFinalizer(parseLetter('m'), t0, t0 + 500)).toBe(
      false,
    )
  })

  test('does not absorb without prior mouse/wheel activity', () => {
    expect(shouldAbsorbLateSgrFinalizer(parseLetter('M'), 0, 1000)).toBe(false)
  })

  test('does not absorb other named or multi-char keys', () => {
    const t0 = 1000
    expect(
      shouldAbsorbLateSgrFinalizer(key('M', { name: 'a' }), t0, t0 + 5),
    ).toBe(false)
    expect(shouldAbsorbLateSgrFinalizer(key('MM'), t0, t0 + 5)).toBe(false)
    expect(shouldAbsorbLateSgrFinalizer(key('4M'), t0, t0 + 5)).toBe(false)
    expect(
      shouldAbsorbLateSgrFinalizer(key('a', { name: 'a' }), t0, t0 + 5),
    ).toBe(false)
  })

  test('does not absorb pasted or modified M', () => {
    const t0 = 1000
    expect(
      shouldAbsorbLateSgrFinalizer(
        key('M', { name: 'm', shift: true, isPasted: true }),
        t0,
        t0 + 5,
      ),
    ).toBe(false)
    expect(
      shouldAbsorbLateSgrFinalizer(
        key('M', { name: 'm', shift: true, ctrl: true }),
        t0,
        t0 + 5,
      ),
    ).toBe(false)
    expect(
      shouldAbsorbLateSgrFinalizer(
        key('M', { name: 'm', shift: true, meta: true }),
        t0,
        t0 + 5,
      ),
    ).toBe(false)
  })

  test('legitimate M still types long after scroll', () => {
    // User types "M" a second after scrolling — must insert.
    expect(shouldAbsorbLateSgrFinalizer(parseLetter('M'), 1000, 2000)).toBe(
      false,
    )
  })
})
