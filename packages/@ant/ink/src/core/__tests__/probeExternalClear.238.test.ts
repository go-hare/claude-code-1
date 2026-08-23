/**
 * densable 2.1.238 #36 — probeExternalClear 1-based clamp + emittedRows.
 *
 * Gold: r=(i)=>Math.min(Math.max(i.y+1,1), stdoutSize().rows, i.emittedRows)
 * When rows===1, r always ≤1 → never wipe. Binding-table / clamp unit only.
 */
import { describe, expect, test } from 'bun:test'

function rowOf(
  cursor: { y: number; emittedRows: number },
  rows: number,
): number {
  return Math.min(Math.max(cursor.y + 1, 1), rows, cursor.emittedRows)
}

describe('densable 2.1.238 #36 probeExternalClear 1-row clamp', () => {
  test('1-row nvim: parked y=0 still clamps to 1 → no wipe', () => {
    expect(rowOf({ y: 0, emittedRows: 1 }, 1)).toBe(1)
    expect(rowOf({ y: 5, emittedRows: 24 }, 1)).toBe(1)
  })

  test('normal fullscreen: y≥1 reports row>1 so wipe is possible', () => {
    expect(rowOf({ y: 5, emittedRows: 24 }, 24)).toBe(6)
    expect(rowOf({ y: 0, emittedRows: 24 }, 24)).toBe(1)
  })

  test('emittedRows caps the clamp (stale park after shrink)', () => {
    expect(rowOf({ y: 10, emittedRows: 3 }, 24)).toBe(3)
  })
})
