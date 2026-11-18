import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

describe('inProcessRunner DISABLE_COMPACT guard (#1256)', () => {
  test('gates teammate auto-compaction on !isEnvTruthy(process.env.DISABLE_COMPACT)', () => {
    const src = readFileSync(
      join(import.meta.dir, '..', 'inProcessRunner.ts'),
      'utf8',
    )
    expect(src).toContain('!isEnvTruthy(process.env.DISABLE_COMPACT)')
    const idxGuard = src.indexOf('!isEnvTruthy(process.env.DISABLE_COMPACT)')
    const idxThreshold = src.indexOf(
      'getAutoCompactThreshold(toolUseContext.options.mainLoopModel)',
    )
    expect(idxGuard).toBeGreaterThan(-1)
    expect(idxThreshold).toBeGreaterThan(idxGuard)
  })
})
