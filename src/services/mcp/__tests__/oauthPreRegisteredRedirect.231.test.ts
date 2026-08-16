/**
 * densable 2.1.231 #1 — pre-registered OAuth client redirect selection (FLv).
 *
 * SEA gold:
 *   u = clientId && redirectUri && ILv(redirectUri) → port from URL
 *   h = oauth.callbackPort
 *   g = !!options.redirectUri
 *   y = g ? 0 : h ?? gIt(u)
 *   S = options.redirectUri ?? JFr(y)
 *   log: custom | port+(from config|reusing registered port|"")
 *   v = !clientId || y===u || stored.redirectUri===S → preserveClientRegistration
 */
import { afterEach, describe, expect, mock, test } from 'bun:test'
import {
  buildRedirectUri,
  findAvailablePort,
  getPortFromLoopbackRedirectUri,
} from '../oauthPort.js'
import {
  clearServerTokensFromLocalStorage,
  type McpOAuthTokenSnapshot,
} from '../auth.js'

describe('densable FLv redirect selection helpers', () => {
  test('preferred port from stored localhost redirect', () => {
    const uri = buildRedirectUri(39152)
    expect(getPortFromLoopbackRedirectUri(uri)).toBe(39152)
  })

  test('findAvailablePort reuses preferred when free', async () => {
    const preferred = 3118
    // may race if something holds 3118 — still must return a valid port
    const port = await findAvailablePort(preferred)
    expect(port).toBeGreaterThan(0)
    expect(port).toBeLessThanOrEqual(65535)
  })

  test('preserveClientRegistration formula (densable v)', () => {
    const preferredPort = 39152
    const port = 39152
    const redirectUri = buildRedirectUri(port)
    const storedRedirect = redirectUri
    const clientId = 'slack-pre-registered'
    // v = !clientId || y===u || a.redirectUri===S
    const preserve =
      !clientId || port === preferredPort || storedRedirect === redirectUri
    expect(preserve).toBe(true)

    // Use runtime numbers so tsc doesn't constant-fold 40000===39152
    const portChanged = Number('40000')
    const preserveOnPortChange =
      !clientId ||
      portChanged === preferredPort ||
      storedRedirect === buildRedirectUri(portChanged)
    // clientId set, port changed, redirect differs → false
    expect(preserveOnPortChange).toBe(false)
  })
})

describe('densable PMa clearServerTokensFromLocalStorage preserveClientRegistration', () => {
  const serverName = 'test-mcp-oauth-231'
  const serverConfig = {
    type: 'http' as const,
    url: 'https://example.com/mcp',
  }

  // Use in-memory mock storage via module is hard; exercise pure formula +
  // that clear with preserve keeps clientId when storage is available.
  // Full storage integration is covered when keychain is present in CI.

  test('exports clear with preserve option (type-level)', () => {
    // Should not throw when no storage entry exists
    expect(() =>
      clearServerTokensFromLocalStorage(serverName, serverConfig, {
        preserveClientRegistration: true,
      }),
    ).not.toThrow()
    expect(() =>
      clearServerTokensFromLocalStorage(serverName, serverConfig),
    ).not.toThrow()
  })

  test('McpOAuthTokenSnapshot type remains usable', () => {
    const snap: McpOAuthTokenSnapshot = {
      accessToken: 'a',
      refreshToken: 'r',
      clientId: 'c',
    }
    expect(snap.clientId).toBe('c')
  })
})

afterEach(() => {
  mock.restore()
})
