import { describe, expect, test } from 'bun:test'
import { parseUrlPattern, urlMatchesPattern } from '../execHttpHook.js'

describe('execHttpHook urlMatchesPattern (official R8 / #24 zzpunycode)', () => {
  test('matches wildcard subdomain and path', () => {
    expect(
      urlMatchesPattern(
        'https://api.example.com/v1/hook',
        'https://*.example.com/*',
      ),
    ).toBe(true)
    expect(
      urlMatchesPattern('https://evil.com/v1/hook', 'https://*.example.com/*'),
    ).toBe(false)
  })

  test('matches wildcard port :*', () => {
    expect(
      urlMatchesPattern(
        'https://example.com:8443/hook',
        'https://example.com:*/hook',
      ),
    ).toBe(true)
    expect(
      urlMatchesPattern(
        'https://example.com/hook',
        'https://example.com:*/hook',
      ),
    ).toBe(true)
  })

  test('protects xn-- punycode labels containing * wildcards via zzpunycode', () => {
    expect(
      urlMatchesPattern(
        'https://xn--bcher-kva.example.com/hook',
        'https://xn--*.example.com/hook',
      ),
    ).toBe(true)
    expect(
      urlMatchesPattern(
        'https://other.example.com/hook',
        'https://xn--*.example.com/hook',
      ),
    ).toBe(false)
  })

  test('parseUrlPattern preserves xn-- wildcard hostname via zzpunycode protection', () => {
    expect(parseUrlPattern('https://xn--*.example.com/hook')?.hostname).toBe(
      'xn--*.example.com',
    )
    expect(parseUrlPattern('https://api.example.com:*/hook')?.port).toBe('0')
  })

  test('matches trailing-slash-free origin pattern against any path', () => {
    expect(
      urlMatchesPattern('https://example.com/a/b?c=1', 'https://example.com'),
    ).toBe(true)
    expect(
      urlMatchesPattern('https://example.com/a/b', 'https://example.com/'),
    ).toBe(false)
  })
})
