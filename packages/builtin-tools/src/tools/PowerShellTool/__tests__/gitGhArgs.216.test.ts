/**
 * densable 2.1.216 #31 — PowerShell git/gh RO argument validation (I5g/oDu/XIu).
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { isGhSafe, isGitSafe } from '../readOnlyValidation.js'

describe('PowerShell isGitSafe densable I5g/oDu (2.1.216 #31)', () => {
  test('allows plain read-only git status', () => {
    expect(isGitSafe(['status'])).toBe(true)
  })

  test('allows git --namespace skip-by-2 then status', () => {
    // namespace is oDu (value-taking) but NOT I5g (dangerous reject)
    expect(isGitSafe(['--namespace', 'foo', 'status'])).toBe(true)
  })

  test('rejects --git-dir / --work-tree / --bare (I5g)', () => {
    expect(isGitSafe(['--git-dir', '.git', 'status'])).toBe(false)
    expect(isGitSafe(['--work-tree=/tmp', 'status'])).toBe(false)
    expect(isGitSafe(['--bare', 'status'])).toBe(false)
  })

  test('rejects --attr-source and --shallow-file (I5g)', () => {
    expect(isGitSafe(['--attr-source', 'HEAD', 'status'])).toBe(false)
    expect(isGitSafe(['--shallow-file', 'x', 'status'])).toBe(false)
  })

  test('rejects -c / -C and attached short forms', () => {
    expect(isGitSafe(['-c', 'core.pager=cat', 'status'])).toBe(false)
    expect(isGitSafe(['-C', '/tmp', 'status'])).toBe(false)
    expect(isGitSafe(['-ccore.pager=sh', 'log'])).toBe(false)
    expect(isGitSafe(['-C/tmp', 'status'])).toBe(false)
  })

  test('rejects $ variable args', () => {
    expect(isGitSafe(['diff', '$VAR'])).toBe(false)
  })

  test('ls-remote rejects any positional (densable JIu)', () => {
    expect(isGitSafe(['ls-remote'])).toBe(true)
    expect(isGitSafe(['ls-remote', 'origin'])).toBe(false)
    expect(isGitSafe(['ls-remote', '--', 'origin'])).toBe(false)
    expect(isGitSafe(['ls-remote', 'https://evil.example/repo.git'])).toBe(
      false,
    )
  })

  test('unicode dash normalize still rejects dangerous globals', () => {
    // en-dash form of --git-dir would not match Set without qAe
    expect(isGitSafe([`\u2013\u2013git-dir`, '.git', 'status'])).toBe(false)
  })
})

describe('PowerShell isGhSafe densable XIu (2.1.216 #31)', () => {
  test('always returns false (no RO auto-allow for gh)', () => {
    expect(isGhSafe([])).toBe(false)
    expect(isGhSafe(['pr', 'view', '1'])).toBe(false)
    expect(isGhSafe(['version'])).toBe(false)
  })

  test('source contracts densable I5g/oDu/XIu', () => {
    const src = readFileSync(
      join(import.meta.dir, '../readOnlyValidation.ts'),
      'utf8',
    )
    expect(src).toContain("'--bare'")
    expect(src).toContain("'--shallow-file'")
    expect(src).toContain('export function isGhSafe')
    expect(src).toMatch(/export function isGhSafe[\s\S]*?return false/)
  })
})
