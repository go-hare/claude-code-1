/**
 * densable 2.1.251 #31 — uen remaining overage arms + mhe() member/group zero.
 *
 * Gold uen @184961866: member_* / group_zero ask admin via mhe(); remaining
 * overage arms are out_of_credits / inner hqe / seat_tier_* /
 * org_service_level_disabled / den(Gj progress-saved). Do not invent arms.
 *
 * auth billing mocks use snapshot+afterAll restore (same isolation as
 * rateLimitMessages.individualSpend.221.test.ts). GrowthBook is mocked so
 * tengu_vellum_anchor (Gj) can be toggled without touching process-global
 * envOverrides parsing.
 */
import { afterAll, afterEach, describe, expect, mock, test } from 'bun:test'
import { snapshotModuleExports } from '../../../tests/mocks/settings.js'
import type { ClaudeAILimits } from '../claudeAiLimits.js'
import * as realAuth from 'src/utils/auth.js'
import * as realBilling from 'src/utils/billing.js'
import * as realGrowthbook from '../analytics/growthbook.js'
import { formatResetTime } from 'src/utils/format.js'

const authSnap = snapshotModuleExports(realAuth)
const billingSnap = snapshotModuleExports(realBilling)
const growthbookSnap = snapshotModuleExports(realGrowthbook)

const getSubscriptionTypeMock = mock(() => 'team' as string | null)
const hasClaudeAiBillingAccessMock = mock(() => false)
const getOauthAccountInfoMock = mock(
  (): { billingType?: string; hasExtraUsageEnabled?: boolean } | undefined =>
    undefined,
)
const getFeatureValueMock = mock((_key: string, fallback: unknown) => fallback)

function authMock() {
  return {
    ...authSnap,
    getOauthAccountInfo: getOauthAccountInfoMock,
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

function growthbookMock() {
  return {
    ...growthbookSnap,
    getFeatureValue_CACHED_MAY_BE_STALE: getFeatureValueMock,
  }
}

mock.module('src/utils/auth.js', authMock)
mock.module('src/utils/auth.ts', authMock)
mock.module('src/utils/billing.js', billingMock)
mock.module('src/utils/billing.ts', billingMock)
mock.module('src/services/analytics/growthbook.js', growthbookMock)
mock.module('../analytics/growthbook.js', growthbookMock)
mock.module('./analytics/growthbook.js', growthbookMock)

const { getRateLimitErrorMessage, getUsageCreditsAskAdminHint } = await import(
  '../rateLimitMessages.js'
)

afterAll(() => {
  mock.module('src/utils/auth.js', () => ({ ...authSnap }))
  mock.module('src/utils/auth.ts', () => ({ ...authSnap }))
  mock.module('src/utils/billing.js', () => ({ ...billingSnap }))
  mock.module('src/utils/billing.ts', () => ({ ...billingSnap }))
  mock.module('src/services/analytics/growthbook.js', () => ({
    ...growthbookSnap,
  }))
  mock.module('../analytics/growthbook.js', () => ({ ...growthbookSnap }))
  mock.module('./analytics/growthbook.js', () => ({ ...growthbookSnap }))
})

afterEach(() => {
  getSubscriptionTypeMock.mockReset()
  getSubscriptionTypeMock.mockImplementation(() => 'team')
  hasClaudeAiBillingAccessMock.mockReset()
  hasClaudeAiBillingAccessMock.mockImplementation(() => false)
  getOauthAccountInfoMock.mockReset()
  getOauthAccountInfoMock.mockImplementation(() => undefined)
  getFeatureValueMock.mockReset()
  getFeatureValueMock.mockImplementation((_key, fallback) => fallback)
})

function rejected(
  reason: ClaudeAILimits['overageDisabledReason'],
  extra: Partial<ClaudeAILimits> = {},
): ClaudeAILimits {
  return {
    status: 'rejected',
    unifiedRateLimitFallbackAvailable: false,
    overageDisabledReason: reason,
    ...extra,
  }
}

function rejectedOverage(
  reason: ClaudeAILimits['overageDisabledReason'],
  extra: Partial<ClaudeAILimits> = {},
): ClaudeAILimits {
  return {
    status: 'rejected',
    unifiedRateLimitFallbackAvailable: false,
    overageStatus: 'rejected',
    overageDisabledReason: reason,
    ...extra,
  }
}

const RESETS_AT = Math.floor(Date.now() / 1000) + 3600
const RESET_TIME = formatResetTime(RESETS_AT, true)

describe('densable 2.1.251 #31 usage-credits zero limit', () => {
  test('member allocation disabled asks an admin', () => {
    const hint = getUsageCreditsAskAdminHint()
    const message = getRateLimitErrorMessage(
      rejected('member_level_disabled'),
      'claude-sonnet-4-6',
    )
    expect(message).toBe(
      `Your usage allocation has been disabled by your admin${hint}`,
    )
    expect(message?.startsWith("You've hit your")).toBe(false)
  })

  test('member zero credit limit uses the same sentence', () => {
    const message = getRateLimitErrorMessage(
      rejected('member_zero_credit_limit'),
      'claude-sonnet-4-6',
    )
    expect(message).toBe(
      `Your usage allocation has been disabled by your admin${getUsageCreditsAskAdminHint()}`,
    )
  })

  test("group zero credit limit is the group's $0 sentence", () => {
    const message = getRateLimitErrorMessage(
      rejected('group_zero_credit_limit'),
      'claude-sonnet-4-6',
    )
    expect(message).toBe(
      `Your group's usage limit is set to $0${getUsageCreditsAskAdminHint()}`,
    )
  })

  test('seat_tier reasons are the seat-type sentence', () => {
    const zero = getRateLimitErrorMessage(
      rejectedOverage('seat_tier_zero_credit_limit'),
      'claude-sonnet-4-6',
    )
    const disabled = getRateLimitErrorMessage(
      rejectedOverage('seat_tier_level_disabled'),
      'claude-sonnet-4-6',
    )
    expect(zero).toBe("Your seat type doesn't include usage credits")
    expect(disabled).toBe(zero)
    expect(zero).not.toContain('ask your admin')
    expect(zero).not.toContain('/usage-credits')
  })

  test('seat_tier on usage_based is the usage (not credits) sentence', () => {
    getOauthAccountInfoMock.mockImplementation(() => ({
      billingType: 'usage_based',
    }))
    expect(
      getRateLimitErrorMessage(
        rejectedOverage('seat_tier_zero_credit_limit'),
        'claude-sonnet-4-6',
      ),
    ).toBe("Your seat type doesn't include usage")
  })

  test('org_service_level_disabled is the org service sentence', () => {
    const message = getRateLimitErrorMessage(
      rejectedOverage('org_service_level_disabled'),
      'claude-sonnet-4-6',
    )
    expect(message).toBe('This service is disabled for your org')
    expect(message).not.toContain('ask your admin')
    expect(message).not.toContain('ask the admin')
  })

  test('out_of_credits is usage credits, not extra usage', () => {
    const message = getRateLimitErrorMessage(
      rejectedOverage('out_of_credits'),
      'claude-sonnet-4-6',
    )
    expect(message).toBe("You're out of usage credits")
    expect(message).not.toContain('extra usage')
  })

  test('out_of_credits + reset + Gj() appends progress saved', () => {
    getFeatureValueMock.mockImplementation((key, fallback) =>
      key === 'tengu_vellum_anchor' ? true : fallback,
    )
    const message = getRateLimitErrorMessage(
      rejectedOverage('out_of_credits', { resetsAt: RESETS_AT }),
      'claude-sonnet-4-6',
    )
    expect(message).toBe(
      `You're out of usage credits · resets ${RESET_TIME} · progress saved`,
    )
  })

  test('out_of_credits usage_based is org out-of-usage copy', () => {
    getOauthAccountInfoMock.mockImplementation(() => ({
      billingType: 'usage_based',
    }))
    hasClaudeAiBillingAccessMock.mockImplementation(() => false)
    expect(
      getRateLimitErrorMessage(
        rejectedOverage('out_of_credits'),
        'claude-sonnet-4-6',
      ),
    ).toBe('Your org is out of usage · contact your admin')

    hasClaudeAiBillingAccessMock.mockImplementation(() => true)
    expect(
      getRateLimitErrorMessage(
        rejectedOverage('out_of_credits'),
        'claude-sonnet-4-6',
      ),
    ).toBe('Your org is out of usage · add funds to continue')
  })

  test('den five_hour / seven_day / opus pass Gj progressSavedSuffix', () => {
    getFeatureValueMock.mockImplementation((key, fallback) =>
      key === 'tengu_vellum_anchor' ? true : fallback,
    )
    expect(
      getRateLimitErrorMessage(
        {
          status: 'rejected',
          unifiedRateLimitFallbackAvailable: false,
          rateLimitType: 'five_hour',
          resetsAt: RESETS_AT,
        },
        'claude-sonnet-4-6',
      ),
    ).toBe(
      `You've hit your session limit · resets ${RESET_TIME} · progress saved`,
    )
    expect(
      getRateLimitErrorMessage(
        {
          status: 'rejected',
          unifiedRateLimitFallbackAvailable: false,
          rateLimitType: 'seven_day',
          resetsAt: RESETS_AT,
        },
        'claude-sonnet-4-6',
      ),
    ).toBe(
      `You've hit your weekly limit · resets ${RESET_TIME} · progress saved`,
    )
    expect(
      getRateLimitErrorMessage(
        {
          status: 'rejected',
          unifiedRateLimitFallbackAvailable: false,
          rateLimitType: 'seven_day_opus',
          resetsAt: RESETS_AT,
        },
        'claude-opus-4-6',
      ),
    ).toBe(`You've hit your Opus limit · resets ${RESET_TIME} · progress saved`)
  })

  test('inner hqe overage-rejected is individual/org monthly usage limit', () => {
    // usage_based so outer hqe (spend copy) is skipped; inner arm fires.
    getOauthAccountInfoMock.mockImplementation(() => ({
      billingType: 'usage_based',
    }))
    expect(
      getRateLimitErrorMessage(
        rejectedOverage('org_spend_cap_reached', {
          overageResetsAt: RESETS_AT,
        }),
        'claude-sonnet-4-6',
      ),
    ).toBe(`You've hit your individual usage limit · resets ${RESET_TIME}`)
    expect(
      getRateLimitErrorMessage(
        rejectedOverage('org_level_disabled_until', {
          overageResetsAt: RESETS_AT,
        }),
        'claude-sonnet-4-6',
      ),
    ).toBe(`You've hit your org's monthly usage limit · resets ${RESET_TIME}`)
  })
})
