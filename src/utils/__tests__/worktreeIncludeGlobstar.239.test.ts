// densable 2.1.239 #22 — globstar in .worktreeinclude expands collapsed dirs.
import { describe, expect, test } from 'bun:test'
import ignore from 'ignore'
import { shouldExpandCollapsedWorktreeIncludeDir } from '../worktree.js'

function matcher(patterns: string[]) {
  return ignore().add(patterns)
}

describe('densable 2.1.239 shouldExpandCollapsedWorktreeIncludeDir', () => {
  test('globstar secrets expands config/secrets/', () => {
    const patterns = ['**/secrets/**']
    expect(
      shouldExpandCollapsedWorktreeIncludeDir(
        'config/secrets/',
        patterns,
        matcher(patterns),
      ),
    ).toBe(true)
  })

  test('globstar foo expands vendor/foo/', () => {
    const patterns = ['**/foo']
    expect(
      shouldExpandCollapsedWorktreeIncludeDir(
        'vendor/foo/',
        patterns,
        matcher(patterns),
      ),
    ).toBe(true)
  })

  test('anchored config glob still expands config/secrets/', () => {
    const patterns = ['config/**/*.key']
    expect(
      shouldExpandCollapsedWorktreeIncludeDir(
        'config/secrets/',
        patterns,
        matcher(patterns),
      ),
    ).toBe(true)
  })

  test('unrelated globstar bar does not expand config/secrets/', () => {
    const patterns = ['**/bar']
    expect(
      shouldExpandCollapsedWorktreeIncludeDir(
        'config/secrets/',
        patterns,
        matcher(patterns),
      ),
    ).toBe(false)
  })

  test('matcher.ignores(dir) with trailing slash still expands', () => {
    const patterns = ['tmp/']
    expect(
      shouldExpandCollapsedWorktreeIncludeDir(
        'tmp/',
        patterns,
        matcher(patterns),
      ),
    ).toBe(true)
  })
})
