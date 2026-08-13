/**
 * densable 2.1.229 #12 — MCP OAuth redirect uses 127.0.0.1 (not localhost).
 */
import { describe, expect, test } from 'bun:test'
import { buildRedirectUri } from '../oauthPort.js'

describe('densable 2.1.229 eBr buildRedirectUri', () => {
  test('uses 127.0.0.1 with /callback path', () => {
    expect(buildRedirectUri(3118)).toBe('http://127.0.0.1:3118/callback')
    expect(buildRedirectUri(49152)).toBe('http://127.0.0.1:49152/callback')
  })

  test('does not use localhost hostname', () => {
    expect(buildRedirectUri(3118)).not.toContain('localhost')
  })
})
