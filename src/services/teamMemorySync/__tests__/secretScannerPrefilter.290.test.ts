import { describe, expect, test } from 'bun:test'
import {
  redactSecrets,
  redactSecretsForDisplay,
  scanForSecrets,
} from '../secretScanner.js'

describe('secretScanner prefilter + lookahead protection (v2.1.290 #103/#115)', () => {
  test('loose-jwt redacts eyJ JWTs and resists long non-eyJ run backtracking', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'
    expect(redactSecrets(`token=${jwt}`)).toBe('token=[REDACTED]')

    // Prefilter /eyJ/ + lookahead protects against quadratic backtracking on long runs without eyJ
    const longRun =
      'a'.repeat(50_000) + '.' + 'b'.repeat(20) + '.' + 'c'.repeat(20)
    const start = performance.now()
    expect(redactSecrets(longRun)).toBe(longRun)
    expect(performance.now() - start).toBeLessThan(200)
  })

  test('anthropic-oauth-token uses run lookahead and handles long hyphenated runs quickly', () => {
    const token = 'sk-ant-oat01-' + 'a'.repeat(30)
    expect(scanForSecrets(`auth=${token}`)).toEqual([
      { ruleId: 'anthropic-oauth-token', label: 'Anthropic OAuth Token' },
    ])
    expect(redactSecrets(`auth=${token}`)).toBe('auth=[REDACTED]')

    // Long [\w-]+ run without sk-ant-oat prefix should be skipped by prefilter quickly
    const longWord = 'x-'.repeat(25_000)
    const start = performance.now()
    expect(scanForSecrets(longWord)).toEqual([])
    expect(redactSecretsForDisplay(longWord)).toBe(longWord)
    expect(performance.now() - start).toBeLessThan(200)
  })

  test('gitlab-* displayRun supports routable .xxxxxxxxx suffix and resists long [=\\w-] runs', () => {
    const pat = 'glpat-' + 'a'.repeat(20)
    const routablePat = `${pat}.012345678`
    expect(redactSecretsForDisplay(`TOKEN=${pat}`)).toBe('TOKEN=[REDACTED]')
    // Routable suffix has '.' which DISPLAY_PATH_CHARS skips in display redaction,
    // while full redactSecrets redacts the entire routable token.
    expect(redactSecrets(`TOKEN=${routablePat}`)).toBe('TOKEN=[REDACTED]')

    // Long [=\w-] run without glpat- etc. should be skipped by prefilter in display redact
    const longEqualsRun = 'a='.repeat(25_000)
    const start = performance.now()
    expect(redactSecretsForDisplay(longEqualsRun)).toBe(longEqualsRun)
    expect(performance.now() - start).toBeLessThan(200)
  })
})
