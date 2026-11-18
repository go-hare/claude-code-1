import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

describe('#88 & #90 sandbox-adapter getFsReadConfig Linux/WSL glob & memoization', () => {
  test('sandbox-adapter.ts contains fsReadConfigMemo, Linux/WSL glob short-circuit, and try/catch fallback', () => {
    const src = readFileSync(
      join(import.meta.dir, 'sandbox-adapter.ts'),
      'utf8',
    )
    expect(src).toContain('fsReadConfigMemo')
    expect(src).toContain("platform === 'linux' || platform === 'wsl'")
    expect(src).toContain('hasGlobCharacters(stripTrailingGlob(p))')
    expect(src).toContain('buildRawFsReadConfig')
    expect(src).toContain(
      '[sandbox] getFsReadConfig threw; falling back to raw deny lists',
    )
  })
})
