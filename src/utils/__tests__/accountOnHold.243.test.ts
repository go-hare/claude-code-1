import { afterEach, describe, expect, test } from 'bun:test'

import { AnthropicProfileOauthError } from '../anthropicProfile.js'
import {
  ACCOUNT_ON_HOLD,
  ACCOUNT_ON_HOLD_FALLBACK_URL,
  ACCOUNT_ON_HOLD_USE_PREFIX,
  clearOAuthAccountOnHoldCaches,
  formatAccountOnHoldUseMessage,
  getOAuthAccountOnHold,
  getOAuthRefreshAccountOnHoldUrl,
  getProfileAccountOnHold,
  isAccountOnHoldAppealLine,
  isOAuthRefreshAccountOnHoldError,
  isOAuthRefreshTokenOnHold,
  parseAccountOnHoldBody,
  registerAccountOnHoldGateReader,
  rememberOAuthAccountOnHold,
  sanitizeAccountOnHoldUrl,
} from '../accountOnHold.js'

const prevReader = registerAccountOnHoldGateReader(null)

afterEach(() => {
  registerAccountOnHoldGateReader(prevReader)
  clearOAuthAccountOnHoldCaches()
})

function axiosHold(
  status: number,
  data: unknown,
): Error & { isAxiosError: true; response: { status: number; data: unknown } } {
  const err = new Error('hold') as Error & {
    isAxiosError: true
    response: { status: number; data: unknown }
  }
  err.isAxiosError = true
  err.response = { status, data }
  return err
}

describe('densable 2.1.243 he / P / v', () => {
  test('he is false when the gate reader is missing or off', () => {
    const line = formatAccountOnHoldUseMessage(ACCOUNT_ON_HOLD_FALLBACK_URL)
    expect(isAccountOnHoldAppealLine(line)).toBe(false)
    registerAccountOnHoldGateReader(() => false)
    expect(isAccountOnHoldAppealLine(line)).toBe(false)
  })

  test('he is true for prefix + already-sanitized restricted URL when gated', () => {
    registerAccountOnHoldGateReader(() => true)
    expect(
      isAccountOnHoldAppealLine(
        formatAccountOnHoldUseMessage(ACCOUNT_ON_HOLD_FALLBACK_URL),
      ),
    ).toBe(true)
  })

  test('he is false when the URL would be rewritten by P', () => {
    registerAccountOnHoldGateReader(() => true)
    expect(
      isAccountOnHoldAppealLine(
        `${ACCOUNT_ON_HOLD_USE_PREFIX}http://evil.example/phish`,
      ),
    ).toBe(false)
    expect(
      isAccountOnHoldAppealLine(`${ACCOUNT_ON_HOLD_USE_PREFIX}not-a-url`),
    ).toBe(false)
  })

  test('P allowlists claude.ai / anthropic.com https and otherwise falls back', () => {
    expect(sanitizeAccountOnHoldUrl(ACCOUNT_ON_HOLD_FALLBACK_URL)).toBe(
      ACCOUNT_ON_HOLD_FALLBACK_URL,
    )
    expect(
      sanitizeAccountOnHoldUrl('https://user:x@claude.ai/restricted'),
    ).toBe(ACCOUNT_ON_HOLD_FALLBACK_URL)
    expect(sanitizeAccountOnHoldUrl('http://claude.ai/restricted')).toBe(
      ACCOUNT_ON_HOLD_FALLBACK_URL,
    )
  })
})

describe('densable 2.1.243 W / Yl / V0 / Xl / uT', () => {
  const holdBody = {
    error: 'invalid_grant',
    error_description: ACCOUNT_ON_HOLD,
    error_uri: ACCOUNT_ON_HOLD_FALLBACK_URL,
  }

  test('W is null when the gate is off', () => {
    registerAccountOnHoldGateReader(() => false)
    expect(parseAccountOnHoldBody(holdBody)).toBeNull()
  })

  test('W sanitizes error_uri through P and fills the restricted fallback', () => {
    registerAccountOnHoldGateReader(() => true)
    expect(parseAccountOnHoldBody(holdBody)).toEqual({
      url: ACCOUNT_ON_HOLD_FALLBACK_URL,
    })
    expect(
      parseAccountOnHoldBody({
        error: 'access_denied',
        error_description: ACCOUNT_ON_HOLD,
      }),
    ).toEqual({ url: ACCOUNT_ON_HOLD_FALLBACK_URL })
    expect(
      parseAccountOnHoldBody({
        error: 'invalid_grant',
        error_description: ACCOUNT_ON_HOLD,
        error_uri: 'http://evil.example/phish',
      }),
    ).toEqual({ url: ACCOUNT_ON_HOLD_FALLBACK_URL })
  })

  test('V0 is null when Hs misses the current refresh token', () => {
    rememberOAuthAccountOnHold('other-rt', ACCOUNT_ON_HOLD_FALLBACK_URL)
    expect(getOAuthAccountOnHold()).toBeNull()
  })

  test('Hs.set then Hs.has is true for that refresh token', () => {
    expect(isOAuthRefreshTokenOnHold('rt-1')).toBe(false)
    rememberOAuthAccountOnHold('rt-1', ACCOUNT_ON_HOLD_FALLBACK_URL)
    expect(isOAuthRefreshTokenOnHold('rt-1')).toBe(true)
    clearOAuthAccountOnHoldCaches()
    expect(isOAuthRefreshTokenOnHold('rt-1')).toBe(false)
  })

  test('Xl is Yl on axios 400/401/403 and false otherwise', () => {
    registerAccountOnHoldGateReader(() => true)
    expect(isOAuthRefreshAccountOnHoldError(axiosHold(400, holdBody))).toBe(
      true,
    )
    expect(isOAuthRefreshAccountOnHoldError(axiosHold(401, holdBody))).toBe(
      true,
    )
    expect(isOAuthRefreshAccountOnHoldError(axiosHold(403, holdBody))).toBe(
      true,
    )
    expect(isOAuthRefreshAccountOnHoldError(axiosHold(500, holdBody))).toBe(
      false,
    )
    expect(isOAuthRefreshAccountOnHoldError(new Error('nope'))).toBe(false)
  })

  test('Xl is false when the gate is off even if the body matches', () => {
    registerAccountOnHoldGateReader(() => false)
    expect(isOAuthRefreshAccountOnHoldError(axiosHold(400, holdBody))).toBe(
      false,
    )
  })

  test('uT falls back to aT when Yl misses', () => {
    registerAccountOnHoldGateReader(() => true)
    expect(getOAuthRefreshAccountOnHoldUrl(new Error('nope'))).toBe(
      ACCOUNT_ON_HOLD_FALLBACK_URL,
    )
    expect(getOAuthRefreshAccountOnHoldUrl(axiosHold(400, holdBody))).toBe(
      ACCOUNT_ON_HOLD_FALLBACK_URL,
    )
  })

  test('Upe / Ee reads W from a profile 400/401/403 body', () => {
    registerAccountOnHoldGateReader(() => true)
    expect(
      getProfileAccountOnHold(
        new AnthropicProfileOauthError('hold', 400, holdBody),
      ),
    ).toEqual({ url: ACCOUNT_ON_HOLD_FALLBACK_URL })
    expect(
      getProfileAccountOnHold(
        new AnthropicProfileOauthError('x', 500, holdBody),
      ),
    ).toBeNull()
    expect(getProfileAccountOnHold(new Error('nope'))).toBeNull()
  })
})
