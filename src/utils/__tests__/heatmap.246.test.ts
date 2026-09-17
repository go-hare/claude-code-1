/**
 * densable 2.1.246 #27 — heatmap O0 local calendar date, not UTC ISO.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { toLocalDateString } from '../heatmap.js'
import { toDateString } from '../statsCache.js'

const HEATMAP = readFileSync(join(import.meta.dir, '../heatmap.ts'), 'utf8')

describe('densable 2.1.246 #27 heatmap O0', () => {
  test('O0 is local Y-M-D, not statsCache.toDateString', () => {
    expect(HEATMAP).toContain('const year = date.getFullYear()')
    expect(HEATMAP).toContain('date.getMonth() + 1')
    expect(HEATMAP).toContain('date.getDate()')
    expect(HEATMAP).toContain('toLocalDateString(currentDate)')
    expect(HEATMAP).not.toContain("from './statsCache.js'")
  })

  test('toLocalDateString matches local calendar', () => {
    const d = new Date(2026, 8, 6, 0, 0, 0, 0)
    expect(toLocalDateString(d)).toBe('2026-09-06')
  })

  test('east-of-UTC midnight ISO is the previous day; O0 stays local', () => {
    const d = new Date(2026, 8, 6, 0, 0, 0, 0)
    if (d.getTimezoneOffset() >= 0) return
    expect(toDateString(d)).toBe('2026-09-05')
    expect(toLocalDateString(d)).toBe('2026-09-06')
  })
})
