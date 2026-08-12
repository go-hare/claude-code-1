/**
 * densable 2.1.224 #10 — sandbox deny trailing slash must not be bypassable.
 * Gold: Mmr strips trailing `/` on non-Windows non-glob paths.
 */
import { describe, expect, test } from 'bun:test'
import { stripTrailingSlashForSandbox } from '../sandbox-adapter.js'

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
