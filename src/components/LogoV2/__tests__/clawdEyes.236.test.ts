/**
 * densable 2.1.236 #18 — Clawd eyes/feet (239 SEA Bwg / KB).
 * iTerm uses the standard table; there is no iTerm.app branch.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const src = readFileSync(join(import.meta.dir, '../Clawd.tsx'), 'utf8')

describe('densable 236 #18 Clawd Bwg poses', () => {
  test('standard KB matches 239 Bwg glyphs + even feet', () => {
    expect(src).toContain("r1E: '▛███▛█'")
    expect(src).toContain("r1E: '▟███▟█'")
    expect(src).toContain("r1E: '█▟███▟'")
    expect(src).toContain("r2R: '█▀'")
    expect(src).toContain("r1R: '▄'")
    expect(src).toContain("r2R: '█▘'")
    expect(src).toContain("{'  '}▝▝ ▝▝{'  '}")
    expect(src).not.toContain("r1E: '▛███▜'")
    expect(src).not.toContain("▘▘ ▝▝{'  '}")
  })

  test('no iTerm TERM_PROGRAM branch; Apple stays _ta', () => {
    expect(src).not.toContain("env.terminal === 'iTerm.app'")
    expect(src).not.toContain('fontSize')
    expect(src).toContain("env.terminal === 'Apple_Terminal'")
    expect(src).toContain('isScreenReaderModeEnabled()')
  })
})
