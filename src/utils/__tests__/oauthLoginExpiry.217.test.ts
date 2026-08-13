import { afterAll, afterEach, describe, expect, mock, test } from 'bun:test'
import { snapshotModuleExports } from '../../../tests/mocks/settings.js'
import * as realProviders from 'src/utils/model/providers.js'

let provider: string = 'firstParty'
let subscriber = true
let tokens: {
  refreshTokenExpiresAt?: number | null
  expiresAt?: number | null
} | null = null

const providersSnap = snapshotModuleExports(realProviders)

mock.module('src/utils/model/providers.js', () => ({
  ...providersSnap,
  getAPIProvider: () => provider,
}))

mock.module('src/utils/auth.js', () => ({
  isClaudeAISubscriber: () => subscriber,
  getClaudeAIOAuthTokens: () => tokens,
}))

import {
  formatLoginExpiryWarningText,
  getLoginExpiryWarning,
  LOGIN_EXPIRY_DAY_MS,
  LOGIN_EXPIRY_WARNING_WINDOW_MS,
  resolveRefreshTokenExpiresAt,
} from '../oauthLoginExpiry.js'

afterEach(() => {
  provider = 'firstParty'
  subscriber = true
  tokens = null
})

afterAll(() => {
  mock.module('src/utils/model/providers.js', () => ({ ...providersSnap }))
})

describe('getLoginExpiryWarning densable mAr (2.1.217 #16)', () => {
  test('window is 3 days', () => {
    expect(LOGIN_EXPIRY_WARNING_WINDOW_MS).toBe(3 * LOGIN_EXPIRY_DAY_MS)
  })

  test('returns daysLeft inside 3-day window', () => {
    const now = 1_700_000_000_000
    tokens = {
      refreshTokenExpiresAt: now + 2 * LOGIN_EXPIRY_DAY_MS,
      expiresAt: now + 60_000,
    }
    const w = getLoginExpiryWarning(now)
    expect(w?.daysLeft).toBe(2)
  })

  test('null when remaining > 3 days', () => {
    const now = 1_700_000_000_000
    tokens = {
      refreshTokenExpiresAt: now + 4 * LOGIN_EXPIRY_DAY_MS,
      expiresAt: now + 60_000,
    }
    expect(getLoginExpiryWarning(now)).toBeNull()
  })

  test('null when already expired', () => {
    const now = 1_700_000_000_000
    tokens = {
      refreshTokenExpiresAt: now - 1,
      expiresAt: now - 1,
    }
    expect(getLoginExpiryWarning(now)).toBeNull()
  })

  test('null for non-firstParty', () => {
    provider = 'openai'
    const now = 1_700_000_000_000
    tokens = {
      refreshTokenExpiresAt: now + LOGIN_EXPIRY_DAY_MS,
      expiresAt: now + 60_000,
    }
    expect(getLoginExpiryWarning(now)).toBeNull()
  })

  test('format copy matches densable', () => {
    expect(formatLoginExpiryWarningText(1)).toBe(
      'Your login expires in 1 day · run /login to renew',
    )
    expect(formatLoginExpiryWarningText(3)).toBe(
      'Your login expires in 3 days · run /login to renew',
    )
  })
})

describe('resolveRefreshTokenExpiresAt densable EXn', () => {
  test('seconds → absolute ms', () => {
    const before = Date.now()
    const at = resolveRefreshTokenExpiresAt(3600)
    expect(at).toBeGreaterThanOrEqual(before + 3600 * 1000)
    expect(at).toBeLessThanOrEqual(Date.now() + 3600 * 1000)
  })

  test('missing without fallback → undefined', () => {
    expect(resolveRefreshTokenExpiresAt(undefined)).toBeUndefined()
  })
})
