import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const src = readFileSync(join(import.meta.dir, '../gitDiff.ts'), 'utf8')

describe('densable 2.1.283 git workspace diff caps', () => {
  test('5s timeout, 50 files, 1MB/file, _t=500 lstat', () => {
    expect(src).toContain('const GIT_TIMEOUT_MS = 5000')
    expect(src).toContain('const MAX_FILES = 50')
    expect(src).toContain('const MAX_DIFF_SIZE_BYTES = 1_000_000')
    expect(src).toContain('const UNTRACKED_LSTAT_CAP = 500')
  })
})
