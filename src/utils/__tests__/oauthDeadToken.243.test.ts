/**
 * densable 2.1.243 #23 residual — official `ql` / `Ms` / `zk` / `Wk` / `Vk` / `$s`.
 */
import { afterEach, describe, expect, test } from 'bun:test'

import {
  ACCOUNT_ON_HOLD,
  applyDeadOAuthRefreshTokenMutate,
  clearOAuthAccountOnHoldCaches,
  isOAuthRefreshDeadInvalidGrant,
  isOAuthRefreshTokenDead,
  isOAuthRefreshTokenKnownDead,
  isOAuthScopeExpansionAttempted,
  isStoredOAuthRefreshTokenCleared,
  markDeadOAuthRefreshToken,
  OAuthRefreshDeadError,
  recordOAuthScopeExpansionAttempt,
  parseAccountOnHoldBody,
  parseOAuthErrorBody,
  registerAccountOnHoldGateReader,
} from '../accountOnHold.js'

const prevReader = registerAccountOnHoldGateReader(null)
const prevHost = process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST

afterEach(() => {
  registerAccountOnHoldGateReader(prevReader)
  clearOAuthAccountOnHoldCaches()
  if (prevHost === undefined) {
    delete process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST
  } else {
    process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST = prevHost
  }
})

function axiosErr(
  status: number,
  data: unknown,
): Error & { isAxiosError: true; response: { status: number; data: unknown } } {
  const err = new Error('oauth') as Error & {
    isAxiosError: true
    response: { status: number; data: unknown }
  }
  err.isAxiosError = true
  err.response = { status, data }
  return err
}

describe('densable 2.1.243 ql / Ms', () => {
  test('ql reads error string or error.type; non-objects have no code', () => {
    expect(parseOAuthErrorBody(null)).toEqual({
      code: undefined,
      description: undefined,
    })
    expect(parseOAuthErrorBody('{"error":"invalid_grant"}')).toEqual({
      code: undefined,
      description: undefined,
    })
    expect(parseOAuthErrorBody({ error: 'invalid_grant' })).toEqual({
      code: 'invalid_grant',
      description: undefined,
    })
    expect(
      parseOAuthErrorBody({
        error: { type: 'invalid_grant' },
        error_description: 'revoked',
      }),
    ).toEqual({ code: 'invalid_grant', description: 'revoked' })
  })

  test('Ms is axios 400/401 invalid_grant that is not Yl', () => {
    registerAccountOnHoldGateReader(() => true)
    expect(
      isOAuthRefreshDeadInvalidGrant(axiosErr(400, { error: 'invalid_grant' })),
    ).toBe(true)
    expect(
      isOAuthRefreshDeadInvalidGrant(
        axiosErr(401, { error: { type: 'invalid_grant' } }),
      ),
    ).toBe(true)
    expect(
      isOAuthRefreshDeadInvalidGrant(axiosErr(403, { error: 'invalid_grant' })),
    ).toBe(false)
    expect(
      isOAuthRefreshDeadInvalidGrant(
        axiosErr(400, {
          error: 'invalid_grant',
          error_description: ACCOUNT_ON_HOLD,
        }),
      ),
    ).toBe(false)
    expect(
      parseAccountOnHoldBody({
        error: 'invalid_grant',
        error_description: ACCOUNT_ON_HOLD,
      }),
    ).not.toBeNull()
  })
})

describe('densable 2.1.243 zk / Wk / Vk mutate / $s', () => {
  test('zk is empty refresh or $s.has; host-managed miss is false', () => {
    expect(isOAuthRefreshTokenDead({ refreshToken: '' })).toBe(true)
    expect(isOAuthRefreshTokenDead({ refreshToken: 'live-rt' })).toBe(false)
    process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST = '1'
    expect(isOAuthRefreshTokenDead(null)).toBe(false)
    delete process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST
    expect(isOAuthRefreshTokenDead(null)).toBeUndefined()
  })

  test('Wk is stored refreshToken === ""', () => {
    expect(isStoredOAuthRefreshTokenCleared(null)).toBe(false)
    expect(
      isStoredOAuthRefreshTokenCleared({
        claudeAiOauth: { refreshToken: 'rt' },
      }),
    ).toBe(false)
    expect(
      isStoredOAuthRefreshTokenCleared({
        claudeAiOauth: { refreshToken: '' },
      }),
    ).toBe(true)
  })

  test('Vk mutate only clears when stored refresh equals e', () => {
    const keep = {
      claudeAiOauth: {
        refreshToken: 'other',
        accessToken: 'a',
        expiresAt: 9,
        scopes: ['user:inference'],
      },
    }
    expect(applyDeadOAuthRefreshTokenMutate(keep, 'rt')).toBe(keep)
    const hit = {
      extra: true,
      claudeAiOauth: {
        refreshToken: 'rt',
        accessToken: 'a',
        expiresAt: 9,
        scopes: ['user:inference'],
      },
    }
    expect(applyDeadOAuthRefreshTokenMutate(hit, 'rt')).toEqual({
      extra: true,
      claudeAiOauth: {
        refreshToken: '',
        accessToken: '',
        expiresAt: 0,
        scopes: ['user:inference'],
      },
    })
  })

  test('Vk marks $s even when disk refresh does not match; z0 clears $s', async () => {
    expect(isOAuthRefreshTokenKnownDead('test-rt-never-real')).toBe(false)
    await markDeadOAuthRefreshToken('test-rt-never-real')
    expect(isOAuthRefreshTokenKnownDead('test-rt-never-real')).toBe(true)
    expect(
      isOAuthRefreshTokenDead({ refreshToken: 'test-rt-never-real' }),
    ).toBe(true)
    clearOAuthAccountOnHoldCaches()
    expect(isOAuthRefreshTokenKnownDead('test-rt-never-real')).toBe(false)
  })

  test('Z9 OAuthRefreshDeadError uses official sentence', () => {
    const err = new OAuthRefreshDeadError()
    expect(err.name).toBe('OAuthRefreshDeadError')
    expect(err.message).toBe(
      'OAuth refresh token is no longer valid; run /login to re-authenticate',
    )
  })
})

describe('densable 2.1.243 oi / $0 / G0', () => {
  test('$0 caps at K0=32 FIFO and G0 reads oi.has; z0 clears oi', () => {
    for (let i = 0; i < 32; i++) {
      recordOAuthScopeExpansionAttempt(`rt-${i}`)
    }
    expect(isOAuthScopeExpansionAttempted('rt-0')).toBe(true)
    recordOAuthScopeExpansionAttempt('rt-32')
    expect(isOAuthScopeExpansionAttempted('rt-0')).toBe(false)
    expect(isOAuthScopeExpansionAttempted('rt-32')).toBe(true)
    clearOAuthAccountOnHoldCaches()
    expect(isOAuthScopeExpansionAttempted('rt-32')).toBe(false)
  })
})
