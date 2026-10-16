import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { formatHistoryBorderLabel } from '../useArrowKeyHistory.js'

describe('densable Gie History border chip', () => {
  test('hides at index 0 and when edited', () => {
    expect(formatHistoryBorderLabel(0, 24, false)).toBeUndefined()
    expect(formatHistoryBorderLabel(4, 24, true)).toBeUndefined()
  })

  test('bare History while total is loading', () => {
    expect(formatHistoryBorderLabel(4, null, false)).toBe('History')
  })

  test('N/M is 1-based from oldest of known total', () => {
    expect(formatHistoryBorderLabel(4, 24, false)).toBe('History 21/24')
    expect(formatHistoryBorderLabel(1, 24, false)).toBe('History 24/24')
    expect(formatHistoryBorderLabel(24, 24, false)).toBe('History 1/24')
  })

  test('countForProject is exported as countHistoryForProject not _Fo', async () => {
    const hist = await Bun.file(
      join(import.meta.dir, '../../history.ts'),
    ).text()
    expect(hist).toContain('export async function countHistoryForProject')
    expect(hist).not.toContain('export async function _Fo')
    const hook = await Bun.file(
      join(import.meta.dir, '../useArrowKeyHistory.tsx'),
    ).text()
    expect(hook).toContain('countHistoryForProject')
    expect(hook).toContain('lastRecalledValueRef')
    expect(hook).not.toContain('export function Gie')
    expect(hook).not.toContain('export function Hie')
    expect(hook).not.toContain('countHistoryEntries')
  })
})
