/**
 * densable 2.1.224 #26 — Bash tool description gold bullet
 * Avoid calling getSimplePrompt() (pulls auth/model via git instructions).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'

const GOLD = 'Command output is displayed to you, not reliably to the user.'

describe('densable 2.1.224 #26 Bash tool description', () => {
  test('prompt.ts embeds SEA gold bullet', () => {
    const src = readFileSync(join(import.meta.dir, '../prompt.ts'), 'utf8')
    expect(src).toContain(GOLD)
    // densable places it among # Instructions bullets (not only a comment)
    expect(src).toMatch(
      /['"]Command output is displayed to you, not reliably to the user\.['"]/,
    )
  })
})
