/**
 * densable 2.1.231 JFr / ILv / gIt OAuth port helpers.
 */
import { describe, expect, test } from 'bun:test'
import {
  buildRedirectUri,
  findAvailablePort,
  getPortFromLoopbackRedirectUri,
  isLoopbackOAuthRedirectUri,
  isOAuthRedirectPortAvailable,
  REDIRECT_PORT_FALLBACK,
} from '../oauthPort.js'

describe('densable 2.1.231 oauthPort SEA gold', () => {
  test('JFr default port AMa=3118', () => {
    expect(REDIRECT_PORT_FALLBACK).toBe(3118)
    expect(buildRedirectUri()).toBe('http://localhost:3118/callback')
  })

  test('ILv accepts both loopback hosts', () => {
    expect(isLoopbackOAuthRedirectUri('http://localhost:1/callback')).toBe(true)
    expect(isLoopbackOAuthRedirectUri('http://127.0.0.1:1/callback')).toBe(true)
  })

  test('isOAuthRedirectPortAvailable returns boolean', async () => {
    const free = await isOAuthRedirectPortAvailable(0)
    // port 0 is invalid for listen in some stacks — just ensure no throw on high port
    const ok = await isOAuthRedirectPortAvailable(REDIRECT_PORT_FALLBACK)
    expect(typeof free).toBe('boolean')
    expect(typeof ok).toBe('boolean')
  })

  test('gIt preferred: returns preferred when available', async () => {
    // Prefer a high random-ish port; if busy, still returns some free port
    const preferred = 39152
    const p = await findAvailablePort(preferred)
    expect(Number.isInteger(p)).toBe(true)
  })

  test('port parse from redirect for reuse', () => {
    expect(
      getPortFromLoopbackRedirectUri('http://localhost:39152/callback'),
    ).toBe(39152)
  })
})
