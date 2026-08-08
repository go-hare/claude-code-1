/**
 * densable 2.1.218 #18 — turn duration uses monotonic performance.now(),
 * not Date.now() (avoids negative/wrong duration after clock adjust).
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const replSrc = readFileSync(join(import.meta.dir, '../REPL.tsx'), 'utf8')
const spinnerSrc = readFileSync(
  join(import.meta.dir, '../../components/Spinner.tsx'),
  'utf8',
)

describe('densable 2.1.218 #18 monotonic turn duration', () => {
  test('REPL documents densable #18 and uses performance.now for turn timing', () => {
    expect(replSrc).toContain('densable 2.1.218 #18')
    expect(replSrc).toContain('performance.now()')
    // turn duration computation sites
    expect(replSrc).toMatch(/performance\.now\(\)\s*-\s*loadingStartTimeRef/)
  })

  test('REPL does not use Date.now for loadingStartTimeRef turn clock', () => {
    // the turn-duration path should not assign loadingStartTimeRef from Date.now
    const assignMatches = [
      ...replSrc.matchAll(/loadingStartTimeRef\.current\s*=\s*([^;\n]+)/g),
    ].map(m => m[1]!.trim())
    expect(assignMatches.length).toBeGreaterThan(0)
    for (const rhs of assignMatches) {
      expect(rhs).not.toContain('Date.now')
      // allow performance.now or 0 resets
      expect(
        rhs.includes('performance.now') ||
          rhs === '0' ||
          rhs.includes('undefined') ||
          rhs.includes('null'),
      ).toBe(true)
    }
  })

  test('Spinner uses performance.now aligned with loadingStartTimeRef', () => {
    expect(spinnerSrc).toContain('performance.now()')
    expect(spinnerSrc).toContain('densable #18')
  })
})
