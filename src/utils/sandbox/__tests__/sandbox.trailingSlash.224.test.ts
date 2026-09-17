/**
 * Pin stripTrailingSlashForSandbox tests to non-Windows — densable Mmr is a
 * no-op when getPlatform()==='windows'. Without an explicit mock, a prior
 * suite that left macos leaked made these pass on Windows hosts; restoring
 * platform correctly exposed the alone-red.
 */
import { afterAll, describe, expect, mock, test } from 'bun:test'
import * as realPlatform from 'src/utils/platform.js'
import { snapshotModuleExports } from '../../../../tests/mocks/settings.js'

const platformSnap = snapshotModuleExports(realPlatform)
mock.module('src/utils/platform.js', () => ({
  ...platformSnap,
  getPlatform: () => 'macos' as const,
}))
afterAll(() => {
  mock.module('src/utils/platform.js', () => ({ ...platformSnap }))
})

const { stripTrailingSlashForSandbox } = await import('../sandbox-adapter.js')

describe('densable 2.1.224 #10 stripTrailingSlashForSandbox (Mmr)', () => {
  test('strips trailing slash on deny-style absolute path', () => {
    expect(stripTrailingSlashForSandbox('/Users/me/.aws/')).toBe(
      '/Users/me/.aws',
    )
    expect(stripTrailingSlashForSandbox('/Users/me/.aws//')).toBe(
      '/Users/me/.aws',
    )
  })

  test('keeps root slash', () => {
    expect(stripTrailingSlashForSandbox('/')).toBe('/')
  })

  test('no-op when no trailing slash', () => {
    expect(stripTrailingSlashForSandbox('/Users/me/.aws')).toBe(
      '/Users/me/.aws',
    )
  })

  test('preserves trailing slash on glob paths (directory-glob semantics)', () => {
    expect(stripTrailingSlashForSandbox('/Users/me/.aws/**/')).toBe(
      '/Users/me/.aws/**/',
    )
    expect(stripTrailingSlashForSandbox('/tmp/foo?/')).toBe('/tmp/foo?/')
    expect(stripTrailingSlashForSandbox('/tmp/[a-z]/')).toBe('/tmp/[a-z]/')
  })

  test('evenAfterGlob forces strip even with *', () => {
    expect(
      stripTrailingSlashForSandbox('/Users/me/.aws/**/', {
        evenAfterGlob: true,
      }),
    ).toBe('/Users/me/.aws/**')
  })
})
