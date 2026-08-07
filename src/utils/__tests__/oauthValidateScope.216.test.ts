/**
 * densable 2.1.216 #17 — pure JKn scope set for Chrome oauth validate.
 * Accepts user:profile | user:office | user:ccr_inference only.
 */
import { describe, expect, test } from 'bun:test'
import { oauthScopesAcceptedByValidate } from '../auth.js'

describe('oauthScopesAcceptedByValidate (densable JKn)', () => {
  test('null / undefined / non-array → false', () => {
    expect(oauthScopesAcceptedByValidate(null)).toBe(false)
    expect(oauthScopesAcceptedByValidate(undefined)).toBe(false)
  })

  test('empty scopes → false', () => {
    expect(oauthScopesAcceptedByValidate([])).toBe(false)
  })

  test('user:inference only (env-var / setup-token default) → false', () => {
    expect(oauthScopesAcceptedByValidate(['user:inference'])).toBe(false)
  })

  test('user:profile (WCe) → true', () => {
    expect(
      oauthScopesAcceptedByValidate(['user:profile', 'user:inference']),
    ).toBe(true)
  })

  test('user:office alone → true', () => {
    expect(oauthScopesAcceptedByValidate(['user:office'])).toBe(true)
  })

  test('user:ccr_inference alone → true', () => {
    expect(oauthScopesAcceptedByValidate(['user:ccr_inference'])).toBe(true)
  })

  test('unrelated scopes only → false', () => {
    expect(
      oauthScopesAcceptedByValidate(['user:mcp_servers', 'user:file_upload']),
    ).toBe(false)
  })
})
