/**
 * densable 2.1.251 #20 — Ztt expired Login row + Wd Profile via Aqt.
 * odn 401 retry is LEFT (no matching local API-client call site).
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
