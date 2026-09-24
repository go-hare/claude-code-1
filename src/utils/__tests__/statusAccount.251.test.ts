/**
 * densable 2.1.251 #20 — Ztt expired Login + Wd Profile; odn 401 profile arms.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { isOAuthRefreshTokenDead } from '../accountOnHold.js'
import { isUsableStoredClaudeAiLogin } from '../anthropicProfile.js'

describe('densable 2.1.251 #20 Ztt /status account rows', () => {
  test('Ztt expired arm and Wd Profile use locked callees', () => {
    const src = readFileSync(join(import.meta.dir, '../status.tsx'), 'utf8')
    const start = src.indexOf('function isStatusOauthRefreshDead')
    const end = src.indexOf('export async function loadGithubWebStatusProperty')
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    const ztt = src.slice(start, end)

    expect(ztt).toContain('Expired \\u2014 log in again')
    expect(ztt).toContain("label: 'Login'")
    expect(ztt).toContain('isAnthropicAuthEnabled()')
    expect(ztt).toContain('isStatusOauthRefreshDead()')
    expect(ztt).toContain('isOAuthRefreshTokenDead(getClaudeAIOAuthTokens())')
    expect(ztt).toContain(
      'isStoredOAuthRefreshTokenCleared(getSecureStorage().read())',
    )
    expect(ztt).toContain('getOauthAccountInfo()')
    expect(ztt).toContain('oauth?.organizationName')
    expect(ztt).toContain('oauth?.emailAddress')
    expect(ztt).toContain('isUsableStoredClaudeAiLogin(tokens)')
    expect(ztt).toContain('isProfileAuthActive({ storedClaudeAiLogin })')
    expect(ztt).toContain("label: 'Profile'")
    // gold Ztt: `${e.subscription} account` (lowercase)
    expect(ztt).toContain('} account`')
    expect(ztt).not.toContain('} Account`')
    // xJ: else if(t!=="profile")r.tokenSource=t
    expect(ztt).toContain('accountInfo.tokenSource && !profileActive')
    expect(ztt).not.toContain('Boolean(getClaudeAIOAuthTokens()?.accessToken)')
    expect(src).not.toContain('status===401')
  })

  test('TYe VN treats empty or known-dead refresh as dead', () => {
    expect(isOAuthRefreshTokenDead({ refreshToken: '' })).toBe(true)
    expect(isOAuthRefreshTokenDead({ refreshToken: 'live-rt' })).toBe(false)
  })

  test('Aqt is not a bare accessToken check', () => {
    expect(
      isUsableStoredClaudeAiLogin({
        accessToken: 'tok',
        scopes: ['user:inference'],
      }),
    ).toBe(true)
    expect(isUsableStoredClaudeAiLogin({ accessToken: 'tok' })).toBe(false)
  })
})

describe('densable 2.1.251 #20 odn 401 profile arms', () => {
  test('odn wl/Wd/AL arms sit before x-should-retry in shouldRetry', () => {
    const src = readFileSync(
      join(import.meta.dir, '../../services/api/withRetry.ts'),
      'utf8',
    )
    // Anchor shouldRetry(error — not shouldRetry529
    const srStart = src.indexOf('export function shouldRetry(error')
    const nextExport = src.indexOf(
      '\nexport function getDefaultMaxRetries',
      srStart + 1,
    )
    expect(srStart).toBeGreaterThan(-1)
    const body = src.slice(
      srStart,
      nextExport === -1 ? srStart + 12000 : nextExport,
    )
    const odnMarker = body.indexOf('densable odn:')
    const headerMarker = body.indexOf("headers?.get('x-should-retry')")
    expect(odnMarker).toBeGreaterThan(-1)
    expect(headerMarker).toBeGreaterThan(odnMarker)

    // wl()+Xt: Anthropic auth + accessToken + (401|TX), composed !Wd
    expect(body).toContain('isAnthropicAuthEnabled()')
    expect(body).toContain('oauthTokens?.accessToken')
    expect(body).toContain('error.status === 401 || revoked')
    // !$V()+Wd — local $V probe is hasAnthropicApiKeyAuth (Gg-safe / no CI throw)
    expect(body).toContain('!hasAnthropicApiKeyAuth()')
    expect(body).toContain('profileActive')
    // AL()
    expect(body).toContain(
      'isHostAuthTokenRefreshAvailable() && error.status === 401',
    )
    // Aqt not bare accessToken
    expect(body).toContain('isUsableStoredClaudeAiLogin(oauthTokens)')
    expect(body).not.toContain(
      'Boolean(\n                  getClaudeAIOAuthTokens()?.accessToken',
    )
  })
})
