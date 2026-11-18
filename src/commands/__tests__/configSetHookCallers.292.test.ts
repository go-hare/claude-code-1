import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('/fast and /output-style config.set hook wiring (#407)', () => {
  test('fast.tsx imports and calls saveFastModeWithConfigSetHook in both picker and shortcut paths', () => {
    const src = readFileSync(join(import.meta.dir, '../fast/fast.tsx'), 'utf8')
    expect(src).toContain(
      "import { saveFastModeWithConfigSetHook } from './index.js'",
    )
    const calls = src.match(/saveFastModeWithConfigSetHook\(/g) ?? []
    expect(calls.length).toBeGreaterThanOrEqual(2)
    expect(src).toContain("hookResult.kind === 'refused'")
  })

  test('output-style.tsx imports and calls saveOutputStyleWithConfigSetHook', () => {
    const src = readFileSync(
      join(import.meta.dir, '../output-style/output-style.tsx'),
      'utf8',
    )
    expect(src).toContain(
      "import { saveOutputStyleWithConfigSetHook } from './index.js'",
    )
    expect(src).toContain('saveOutputStyleWithConfigSetHook(')
    expect(src).toContain("hookResult.kind === 'refused'")
    expect(src).toContain('hookResult.saved !== match')
  })
})
