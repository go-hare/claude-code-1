import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, test } from 'bun:test'

describe('usage Loops table 243', () => {
  test('Usage.tsx renders SEA Xu headers', () => {
    const src = readFileSync(
      join(import.meta.dir, '../Settings/Usage.tsx'),
      'utf8',
    )
    expect(src).toContain('LoopsUsageTable')
    expect(src).toContain('text="every"')
    expect(src).toContain('text="runs"')
    expect(src).toContain('text="tokens"')
    expect(src).toContain('text="per run"')
    expect(src).toContain('text="last run"')
  })
})
