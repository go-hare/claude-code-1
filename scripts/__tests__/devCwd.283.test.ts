/**
 * densable 2.1.283 — bun `scripts/dev.ts` must pin spawn cwd to the repo
 * (`src/` aliases) while preserving the caller's cwd in PWD so cli.tsx can
 * chdir before createBootstrapSession snapshots originalCwd.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '../..')

describe('scripts/dev.ts spawn cwd vs SDK originalCwd (densable 2.1.283)', () => {
  test('pins Bun.spawnSync cwd to projectRoot for module resolution', () => {
    const src = readFileSync(join(ROOT, 'scripts/dev.ts'), 'utf8')
    expect(src).toContain('cwd: projectRoot')
    expect(src).toContain('PWD: projectRoot')
    expect(src).toContain('CLAUDE_CODE_CALLER_CWD: callerCwd')
  })

  test('cli.tsx restores PWD from CLAUDE_CODE_CALLER_CWD without chdir', () => {
    const src = readFileSync(
      join(ROOT, 'src/entrypoints/cli.tsx'),
      'utf8',
    )
    expect(src).toContain('process.env.CLAUDE_CODE_CALLER_CWD')
    expect(src).toContain('process.env.PWD = callerCwd')
    expect(src).not.toContain('process.chdir(callerCwd)')
    const importIdx = src.indexOf("import('../utils/startupProfiler.js')")
    const callerIdx = src.indexOf('process.env.CLAUDE_CODE_CALLER_CWD')
    expect(importIdx).toBeGreaterThan(0)
    expect(callerIdx).toBeGreaterThan(importIdx)
  })

  test('createBootstrapSession prefers CLAUDE_CODE_CALLER_CWD', () => {
    const src = readFileSync(join(ROOT, 'src/utils/sessionRoot.ts'), 'utf8')
    expect(src).toContain('CLAUDE_CODE_CALLER_CWD')
    expect(src).toContain('caller && caller.length > 0 ? caller : cwd()')
  })

  test('print.ts ask() uses session getCwd not process.cwd', () => {
    const src = readFileSync(join(ROOT, 'src/cli/print.ts'), 'utf8')
    expect(src).not.toContain("import { cwd } from 'process'")
    expect(src).toContain('cwd: getCwd()')
    expect(src).not.toContain('cwd: cwd()')
  })
})
