/**
 * densable 2.1.228 #11 — query.ts wires St helper on BOTH completed-tool and
 * remaining-tool mid-turn paths (not only one of them).
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const querySrc = readFileSync(join(import.meta.dir, '../../query.ts'), 'utf8')

describe('densable 2.1.228 #11 query.ts St wiring', () => {
  test('imports accumulateToolResultForMidTurn', () => {
    expect(querySrc).toContain(
      "from './query/accumulateToolResultForMidTurn.js'",
    )
    expect(querySrc).toContain('accumulateToolResultForMidTurn')
  })

  test('calls helper at least twice (completed + remaining tool-update paths)', () => {
    // Match call sites, not the import line
    const callRe = /accumulateToolResultForMidTurn\s*\(/g
    const calls = querySrc.match(callRe) ?? []
    expect(calls.length).toBeGreaterThanOrEqual(2)
  })

  test('helper lives next to toolResults accumulation (mid-turn)', () => {
    // Each call should be near a toolResults push context
    let idx = 0
    let found = 0
    while (true) {
      const next = querySrc.indexOf('accumulateToolResultForMidTurn(', idx)
      if (next < 0) break
      found++
      const window = querySrc.slice(Math.max(0, next - 200), next + 200)
      expect(window).toMatch(/toolResults/)
      idx = next + 1
    }
    expect(found).toBeGreaterThanOrEqual(2)
  })
})
