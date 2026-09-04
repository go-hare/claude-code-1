import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'

describe('densable 2.1.243 #51 sandboxed Bash prompt hosts', () => {
  test('prompt no longer lists allowedHosts in networkConfig', () => {
    const src = readFileSync(join(import.meta.dir, '../prompt.ts'), 'utf8')
    expect(src).toContain('do not list allowedHosts')
    expect(src).not.toMatch(
      /networkConfig = \{[\s\S]*allowedHosts: dedup\(networkRestrictionConfig/,
    )
  })
})
