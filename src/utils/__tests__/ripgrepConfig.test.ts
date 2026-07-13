import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'

// Test the pure fallback function directly — no mock.module needed,
// so this test cannot pollute other tests in the same Bun process.
// See CLAUDE.md "Mock 使用规范" for why we avoid business-module mocking.
const { resolveBundledRipgrep, resolveBuiltinWithFallback } = await import(
  '../ripgrep.js'
)

// Real temp dir with a real (or removed) fake rg binary to control existsSync.
const tmpDir = join(
  globalThis.process.env.TMPDIR || '/tmp',
  'ripgrep-config-test',
)
const vendorDir = join(
  tmpDir,
  'vendor',
  'ripgrep',
  `${process.arch}-${process.platform}`,
)
const rgPath = join(vendorDir, process.platform === 'win32' ? 'rg.exe' : 'rg')

describe('resolveBuiltinWithFallback', () => {
  beforeAll(() => {
    mkdirSync(vendorDir, { recursive: true })
    writeFileSync(rgPath, '')
  })

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  test('builtin exists -> mode=builtin, no note', () => {
    const result = resolveBuiltinWithFallback(rgPath)
    expect(result.mode).toBe('builtin')
    expect(result.command).toBe(rgPath)
    expect(result.note).toBeUndefined()
  })

  test('builtin candidates choose the first existing path', () => {
    const result = resolveBuiltinWithFallback([
      join(tmpDir, 'missing-rg'),
      rgPath,
    ])
    expect(result.mode).toBe('builtin')
    expect(result.command).toBe(rgPath)
    expect(result.note).toBeUndefined()
  })

  test('Windows bundled mode prefers a vendored rg binary', () => {
    const executablePath = join(tmpDir, 'claude.exe')
    const result = resolveBundledRipgrep(
      [join(tmpDir, 'missing-rg.exe'), rgPath],
      'win32',
      executablePath,
    )

    expect(result.mode).toBe('builtin')
    expect(result.command).toBe(rgPath)
    expect(result.args).toEqual([])
    expect(result.argv0).toBeUndefined()
  })

  test('Windows bundled mode never falls back to embedded argv0 dispatch', () => {
    rmSync(rgPath)
    const executablePath = join(tmpDir, 'claude.exe')
    const result = resolveBundledRipgrep(
      [rgPath],
      'win32',
      executablePath,
      null,
    )

    expect(result.mode).toBe('builtin')
    expect(result.command).toBe(rgPath)
    expect(result.argv0).toBeUndefined()
    writeFileSync(rgPath, '')
  })

  test('non-Windows bundled mode keeps embedded argv0 dispatch', () => {
    const executablePath = join(tmpDir, 'claude')
    const result = resolveBundledRipgrep([rgPath], 'linux', executablePath)

    expect(result.mode).toBe('embedded')
    expect(result.command).toBe(executablePath)
    expect(result.args).toEqual(['--no-config'])
    expect(result.argv0).toBe('rg')
  })

  test('builtin missing + system rg available -> mode=system, note set', () => {
    rmSync(rgPath)
    const result = resolveBuiltinWithFallback(
      rgPath,
      '/usr/local/bin/rg', // explicit system rg path
      'testplatform',
    )
    expect(result.mode).toBe('system')
    expect(result.command).toBe('rg')
    expect(result.note).toContain('fallback')
    expect(result.note).toContain('testplatform')
    // Restore for subsequent tests
    writeFileSync(rgPath, '')
  })

  test('builtin missing + system rg missing -> mode=builtin, note set', () => {
    rmSync(rgPath)
    const result = resolveBuiltinWithFallback(
      rgPath,
      null, // no system rg
      'testplatform',
    )
    expect(result.mode).toBe('builtin')
    expect(result.command).toBe(rgPath)
    expect(result.note).toContain('no ripgrep available')
    expect(result.note).toContain('testplatform')
    writeFileSync(rgPath, '')
  })

  test('uses process.platform when platform param omitted', () => {
    rmSync(rgPath)
    const result = resolveBuiltinWithFallback(rgPath, null)
    expect(result.note).toContain(process.platform)
    writeFileSync(rgPath, '')
  })
})
