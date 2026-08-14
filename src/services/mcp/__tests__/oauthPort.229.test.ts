/**
 * densable MCP OAuth redirect URI host.
 *
 * 2.1.229 changelog mentioned 127.0.0.1 for strict AS; SEA **2.1.231** gold
 * `JFr` is `http://localhost:${port}/callback` (pre-registered clients / Slack).
 * This file keeps the historical name; assertions track **231 SEA 1:1**.
 */
import { describe, expect, test } from 'bun:test'
import {
  buildRedirectUri,
  getPortFromLoopbackRedirectUri,
  isLoopbackOAuthRedirectUri,
  REDIRECT_PORT_FALLBACK,
} from '../oauthPort.js'

describe('densable 2.1.231 JFr buildRedirectUri', () => {
  test('uses localhost with /callback path (SEA JFr)', () => {
    expect(buildRedirectUri(3118)).toBe('http://localhost:3118/callback')
    expect(buildRedirectUri(49152)).toBe('http://localhost:49152/callback')
    expect(buildRedirectUri()).toBe(
      `http://localhost:${REDIRECT_PORT_FALLBACK}/callback`,
    )
  })

  test('ILv: loopback hosts 127.0.0.1 and localhost', () => {
    expect(isLoopbackOAuthRedirectUri('http://localhost:3118/callback')).toBe(
      true,
    )
    expect(isLoopbackOAuthRedirectUri('http://127.0.0.1:3118/callback')).toBe(
      true,
    )
    expect(isLoopbackOAuthRedirectUri('https://localhost:3118/callback')).toBe(
      false,
    )
    expect(isLoopbackOAuthRedirectUri('http://example.com/callback')).toBe(
      false,
    )
  })

  test('getPortFromLoopbackRedirectUri for densable preferred port u', () => {
    expect(
      getPortFromLoopbackRedirectUri('http://localhost:39152/callback'),
    ).toBe(39152)
    expect(
      getPortFromLoopbackRedirectUri('http://127.0.0.1:3118/callback'),
    ).toBe(3118)
    expect(
      getPortFromLoopbackRedirectUri('https://evil.com:443/callback'),
    ).toBeUndefined()
    expect(getPortFromLoopbackRedirectUri(undefined)).toBeUndefined()
  })
})
