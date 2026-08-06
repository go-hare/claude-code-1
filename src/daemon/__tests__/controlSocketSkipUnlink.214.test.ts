/**
 * densable 2.1.214 #26 — control socket close({skipUnlink}) must not unlink path.
 * Pure source/contract mirrors (no live dual-supervisor).
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const ROOT = join(import.meta.dir, '..')

describe('densable aAp close skipUnlink #26', () => {
  test('controlSocket close accepts skipUnlink and gates unlink', () => {
    const src = readFileSync(join(ROOT, 'controlSocket.ts'), 'utf8')
    expect(src).toContain('skipUnlink')
    expect(src).toContain('server.unref()')
    expect(src).toMatch(/if \(opts\?\.skipUnlink\)/)
    expect(src).toMatch(/!skipUnlinkSticky && process\.platform !== 'win32'/)
  })

  test('bgManager close forwards displaced/skipPathCleanup → skipUnlink', () => {
    const src = readFileSync(join(ROOT, 'bgManager.ts'), 'utf8')
    expect(src).toContain('BgManagerCloseOpts')
    expect(src).toContain('displaced')
    expect(src).toContain('skipPathCleanup')
    expect(src).toMatch(/controlSocket\.close\(\{\s*skipUnlink\s*\}\)/)
    // densable: rm instance dir only when !G && !skipPathCleanup
    expect(src).toMatch(/!displaced/)
    expect(src).toMatch(/!skipPathCleanup/)
  })

  test('yield shutdown passes displaced+skipPathCleanup', () => {
    const src = readFileSync(join(ROOT, 'main.ts'), 'utf8')
    expect(src).toContain(
      "shutdown('yield', { displaced: true, skipPathCleanup: true })",
    )
  })
})

describe('densable close skipUnlink pure gate', () => {
  function shouldUnlinkControlSocketPath(opts: {
    skipUnlink?: boolean
    platform: string
  }): boolean {
    if (opts.skipUnlink) return false
    return opts.platform !== 'win32'
  }

  function shouldRmInstanceDir(opts: {
    displaced?: boolean
    skipPathCleanup?: boolean
    handleCount: number
    parseFailed: boolean
    platform: string
  }): boolean {
    const displaced = opts.displaced ?? false
    const skipPathCleanup = opts.skipPathCleanup ?? false
    return (
      !displaced &&
      !skipPathCleanup &&
      opts.handleCount === 0 &&
      !opts.parseFailed &&
      opts.platform !== 'win32'
    )
  }

  test('yield skipUnlink never unlinks', () => {
    expect(
      shouldUnlinkControlSocketPath({ skipUnlink: true, platform: 'linux' }),
    ).toBe(false)
  })

  test('normal unix close unlinks', () => {
    expect(
      shouldUnlinkControlSocketPath({ skipUnlink: false, platform: 'linux' }),
    ).toBe(true)
  })

  test('windows never unlinks path file', () => {
    expect(
      shouldUnlinkControlSocketPath({ skipUnlink: false, platform: 'win32' }),
    ).toBe(false)
  })

  test('displaced skips instance dir rm', () => {
    expect(
      shouldRmInstanceDir({
        displaced: true,
        handleCount: 0,
        parseFailed: false,
        platform: 'linux',
      }),
    ).toBe(false)
  })

  test('normal empty manager rms instance dir on unix', () => {
    expect(
      shouldRmInstanceDir({
        handleCount: 0,
        parseFailed: false,
        platform: 'linux',
      }),
    ).toBe(true)
  })
})
