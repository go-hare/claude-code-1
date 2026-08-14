/**
 * densable 2.1.232 #49 — custom-agents startup tip removed.
 * Source-level lock: tipRegistry must not reintroduce the id or copy.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'bun:test'

const tipRegistrySrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../tipRegistry.ts'),
  'utf8',
)

describe('tipRegistry densable 2.1.232 #49', () => {
  test('does not register custom-agents tip id', () => {
    expect(tipRegistrySrc).not.toMatch(/id:\s*['"]custom-agents['"]/)
  })

  test('does not ship Use /agents optimize startup copy', () => {
    expect(tipRegistrySrc).not.toContain(
      'Use /agents to optimize specific tasks',
    )
  })

  test('still keeps agent-flag tip', () => {
    expect(tipRegistrySrc).toMatch(/id:\s*['"]agent-flag['"]/)
  })
})
