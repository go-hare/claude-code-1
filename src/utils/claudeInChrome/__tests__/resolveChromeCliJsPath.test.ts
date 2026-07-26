import { describe, expect, test } from 'bun:test'
import { existsSync } from 'fs'
import { resolveChromeCliJsPath } from '../setup.js'

describe('resolveChromeCliJsPath', () => {
  test('resolves an existing entry (dist/cli.js or src/entrypoints/cli.tsx)', () => {
    const path = resolveChromeCliJsPath()
    expect(path.length).toBeGreaterThan(0)
    expect(existsSync(path)).toBe(true)
    // Never the broken bare repo-root cli.js when that file is missing
    if (!existsSync(path)) {
      throw new Error('unreachable')
    }
    expect(path.endsWith('cli.js') || path.endsWith('cli.tsx')).toBe(true)
  })
})
