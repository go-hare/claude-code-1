/**
 * densable 2.1.239 #6 — monthly spend-cap copy also names the session/weekly
 * (or Opus/Sonnet) window reset. Official Kvi(); p() Fable-5 extra-usage gate
 * is not mapped (no seven_day_overage_included in tip).
 *
 * Spread real auth/billing snapshots + afterAll restore — same isolation as
 * rateLimitMessages.individualSpend.221.test.ts.
 */
import { afterAll, afterEach, describe, expect, mock, test } from 'bun:test'
import { snapshotModuleExports } from '../../../tests/mocks/settings.js'
import type { ClaudeAILimits } from '../claudeAiLimits.js'
import * as realAuth from 'src/utils/auth.js'
import * as realBilling from 'src/utils/billing.js'
import { formatResetTime } from 'src/utils/format.js'

const authSnap = snapshotModuleExports(realAuth)
const billingSnap = snapshotModuleExports(realBilling)

const getSubscriptionTypeMock = mock(() => 'team' as string | null)
const hasClaudeAiBillingAccessMock = mock(() => false)

function authMock() {
  return {
    ...authSnap,
    getOauthAccountInfo: () => undefined,
    getSubscriptionType: getSubscriptionTypeMock,
    isOverageProvisioningAllowed: () => true,
  }
}

function billingMock() {
  return {
    ...billingSnap,
    hasClaudeAiBillingAccess: hasClaudeAiBillingAccessMock,
  }
}

mock.module('src/utils/auth.js', authMock)
mock.module('src/utils/auth.ts', authMock)
mock.module('src/utils/billing.js', billingMock)
mock.module('src/utils/billing.ts', billingMock)

const { getRateLimitErrorMessage } = await import('../rateLimitMessages.js')

afterAll(() => {
  mock.module('src/utils/auth.js', () => ({ ...authSnap }))
  mock.module('src/utils/auth.ts', () => ({ ...authSnap }))
  mock.module('src/utils/billing.js', () => ({ ...billingSnap }))
  mock.module('src/utils/billing.ts', () => ({ ...billingSnap }))
})

afterEach(() => {
  getSubscriptionTypeMock.mockReset()
  getSubscriptionTypeMock.mockImplementation(() => 'team')
  hasClaudeAiBillingAccessMock.mockReset()
  hasClaudeAiBillingAccessMock.mockImplementation(() => false)
})

const RESETS_AT = Math.floor(Date.now() / 1000) + 3600
const RESET_TIME = formatResetTime(RESETS_AT, true)

function rejected(partial: Partial<ClaudeAILimits>): ClaudeAILimits {
  return {
    status: 'rejected',
    unifiedRateLimitFallbackAvailable: false,
    isUsingOverage: false,
    overageDisabledReason: 'org_spend_cap_reached',
    ...partial,
  }
}

describe('getRateLimitErrorMessage densable 2.1.239 spend-cap reset hint', () => {
  test('team + five_hour → session limit reset after spend-cap suffix', () => {
    const msg = getRateLimitErrorMessage(
      rejected({ rateLimitType: 'five_hour', resetsAt: RESETS_AT }),
      'claude-opus-4-6',
    )
    expect(msg).toContain('individual spend limit')
    expect(msg).toContain(
      'run /usage-credits to ask your admin for a higher limit',
    )
    expect(msg).toContain(` · your session limit resets ${RESET_TIME}`)
  })

  test('team + seven_day → weekly limit reset', () => {
    const msg = getRateLimitErrorMessage(
      rejected({ rateLimitType: 'seven_day', resetsAt: RESETS_AT }),
      'claude-sonnet-4-6',
    )
    expect(msg).toContain(` · your weekly limit resets ${RESET_TIME}`)
  })

  test('team + seven_day_opus → Opus limit reset', () => {
    const msg = getRateLimitErrorMessage(
      rejected({ rateLimitType: 'seven_day_opus', resetsAt: RESETS_AT }),
      'claude-opus-4-6',
    )
    expect(msg).toContain(` · your Opus limit resets ${RESET_TIME}`)
  })

  test('enterprise + seven_day_sonnet → weekly limit ($Wa)', () => {
    getSubscriptionTypeMock.mockImplementation(() => 'enterprise')
    hasClaudeAiBillingAccessMock.mockImplementation(() => true)
    const msg = getRateLimitErrorMessage(
      rejected({ rateLimitType: 'seven_day_sonnet', resetsAt: RESETS_AT }),
      'claude-sonnet-4-6',
    )
    expect(msg).toContain(` · your weekly limit resets ${RESET_TIME}`)
    expect(msg).not.toContain('Sonnet limit')
  })

  test('max + seven_day_sonnet → Sonnet limit ($Wa)', () => {
    getSubscriptionTypeMock.mockImplementation(() => 'max')
    hasClaudeAiBillingAccessMock.mockImplementation(() => true)
    const msg = getRateLimitErrorMessage(
      rejected({ rateLimitType: 'seven_day_sonnet', resetsAt: RESETS_AT }),
      'claude-sonnet-4-6',
    )
    expect(msg).toContain('monthly spend limit')
    expect(msg).toContain(` · your Sonnet limit resets ${RESET_TIME}`)
  })

  test('overage type or missing resetsAt → no session/weekly hint', () => {
    expect(
      getRateLimitErrorMessage(
        rejected({ rateLimitType: 'overage', resetsAt: RESETS_AT }),
        'claude-opus-4-6',
      ),
    ).not.toContain(' · your ')
    const noReset = getRateLimitErrorMessage(
      rejected({ rateLimitType: 'five_hour' }),
      'claude-opus-4-6',
    )
    expect(noReset).not.toContain('session limit resets')
    expect(noReset).not.toContain('weekly limit resets')
  })
})
