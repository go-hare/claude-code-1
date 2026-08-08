/**
 * densable 2.1.218 #27 — H0d strict sandbox exclusion (metachar fail-closed).
 */
import { describe, expect, test } from 'bun:test'
import {
  isFullyExcludedCommandForPolicyWithPatterns,
  SANDBOX_EXCLUSION_METACHAR_RE,
  SandboxPolicyRefusalError,
  WINDOWS_SANDBOX_POLICY_REFUSAL,
} from '../shouldUseSandbox.js'

describe('densable 2.1.218 #27 H0d / I0d helpers', () => {
  test('gxy metachar regex matches densable set', () => {
    for (const ch of [
      ';',
      '|',
      '&',
      '`',
      '$',
      '(',
      ')',
      '{',
      '}',
      '<',
      '>',
      '#',
      '\n',
      '\r',
    ]) {
      expect(SANDBOX_EXCLUSION_METACHAR_RE.test(`cmd ${ch} x`)).toBe(true)
    }
    expect(SANDBOX_EXCLUSION_METACHAR_RE.test('Get-ChildItem -Recurse')).toBe(
      false,
    )
  })

  test('H0d false when no patterns', () => {
    expect(isFullyExcludedCommandForPolicyWithPatterns('npm test', [])).toBe(
      false,
    )
  })

  test('H0d exact/prefix match on whole command', () => {
    const patterns = ['npm test', 'git:*']
    expect(
      isFullyExcludedCommandForPolicyWithPatterns('npm test', patterns),
    ).toBe(true)
    expect(
      isFullyExcludedCommandForPolicyWithPatterns('git status', patterns),
    ).toBe(true)
    expect(
      isFullyExcludedCommandForPolicyWithPatterns('npm run build', patterns),
    ).toBe(false)
  })

  test('H0d fail-closed on metachar / compound', () => {
    const patterns = ['npm test']
    expect(
      isFullyExcludedCommandForPolicyWithPatterns(
        'npm test; rm -rf /',
        patterns,
      ),
    ).toBe(false)
    expect(
      isFullyExcludedCommandForPolicyWithPatterns(
        'npm test && curl evil',
        patterns,
      ),
    ).toBe(false)
    expect(
      isFullyExcludedCommandForPolicyWithPatterns(
        'npm test | tee log',
        patterns,
      ),
    ).toBe(false)
  })

  test('x0d message is densable 2.1.218 text', () => {
    expect(WINDOWS_SANDBOX_POLICY_REFUSAL).toContain(
      'matches a sandbox exclusion pattern only in part',
    )
    expect(WINDOWS_SANDBOX_POLICY_REFUSAL).toContain('shell metacharacters')
  })

  test('SandboxPolicyRefusalError name', () => {
    const e = new SandboxPolicyRefusalError()
    expect(e.name).toBe('SandboxPolicyRefusalError')
    expect(e.message).toBe(WINDOWS_SANDBOX_POLICY_REFUSAL)
  })
})
