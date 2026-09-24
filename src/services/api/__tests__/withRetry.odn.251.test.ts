/**
 * densable 2.1.251 #20 odn — 401/TX retry arms before x-should-retry.
 * Gold: wl()+Xt.accessToken / !$V()+Wd / AL; then header / bare 401+lAe.
 */
import { describe, expect, test } from 'bun:test'
import { APIError } from '@anthropic-ai/sdk'
import { readFileSync } from 'fs'
import { join } from 'path'
import { shouldRetry } from '../withRetry.js'

function apiErr(
  status: number,
  message: string,
  headers?: Record<string, string>,
): APIError {
  return new APIError(
    status,
    { type: 'error', error: { type: 'authentication_error', message } },
    message,
    new Headers(headers),
  )
}

describe('densable 2.1.251 #20 odn shouldRetry arms', () => {
  test('odn places wl/Wd/AL before x-should-retry and keeps TX + bare 401', () => {
    const src = readFileSync(join(import.meta.dir, '../withRetry.ts'), 'utf8')
    // Anchor shouldRetry(error — not shouldRetry529
    const start = src.indexOf('export function shouldRetry(error')
    const end = src.indexOf('export function getDefaultMaxRetries')
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    const odn = src.slice(start, end)

    expect(odn).toContain('isAnthropicAuthEnabled()')
    expect(odn).toContain('isUsableStoredClaudeAiLogin(oauthTokens)')
    expect(odn).toContain('isProfileAuthActive({')
    expect(odn).toContain('oauthTokens?.accessToken')
    // local $V = hasAnthropicApiKeyAuth (Gg-safe; no CI throw)
    expect(odn).toContain('!hasAnthropicApiKeyAuth()')
    expect(odn).toContain('isHostAuthTokenRefreshAvailable()')
    expect(odn).toContain('isOAuthTokenRevokedError(error)')
    expect(odn).toContain('error.status === 401')
    expect(odn).toContain('clearApiKeyHelperCache()')

    const odnMarker = odn.indexOf('densable odn:')
    expect(odnMarker).toBeGreaterThan(-1)
    const afterOdn = odn.slice(odnMarker)
    const alAt = afterOdn.indexOf(
      'isHostAuthTokenRefreshAvailable() && error.status === 401',
    )
    const headerAt = afterOdn.indexOf("headers?.get('x-should-retry')")
    expect(alAt).toBeGreaterThan(-1)
    expect(headerAt).toBeGreaterThan(alAt)
  })

  test('x-should-retry:false still blocks bare non-auth statuses', () => {
    const err = apiErr(400, 'bad request', { 'x-should-retry': 'false' })
    expect(shouldRetry(err)).toBe(false)
  })

  test('TX revoked is classified as oauth revoked', () => {
    const src = readFileSync(join(import.meta.dir, '../withRetry.ts'), 'utf8')
    expect(src).toContain('error.status === 403')
    expect(src).toContain('OAuth token has been revoked')
  })
})
