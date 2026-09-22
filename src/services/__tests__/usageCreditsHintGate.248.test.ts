/**
 * densable 2.1.248 #38 — v_() / Nde() usage-credits hint gate.
 *
 * SEA Nde() @184100558 sha=c8ad9d2a1a2d348e:
 *   v_() ? " · run /usage-credits to ask your admin for a higher limit"
 *       : " · ask your admin for a higher limit"
 * v_(): DISABLE_EXTRA_USAGE_COMMAND → false; kS() is `return null` in 248;
 *       else Zur() = isOverageProvisioningAllowed (DN is #6).
 *
 * Spread real auth/billing snapshots + afterAll restore — same isolation as
 * rateLimitMessages.individualSpend.221.test.ts.
 */
import { afterAll, afterEach, describe, expect, mock, test } from 'bun:test'
import { snapshotModuleExports } from '../../../tests/mocks/settings.js'
import type { ClaudeAILimits } from '../claudeAiLimits.js'
import * as realAuth from 'src/utils/auth.js'
import * as realBilling from 'src/utils/billing.js'

const authSnap = snapshotModuleExports(realAuth)
const billingSnap = snapshotModuleExports(realBilling)

const getSubscriptionTypeMock = mock(() => 'team' as string | null)
const hasClaudeAiBillingAccessMock = mock(() => false)
const isOverageProvisioningAllowedMock = mock(() => true)

const NDE_ASK_WITH_COMMAND =
  ' · run /usage-credits to ask your admin for a higher limit'
const NDE_ASK_WITHOUT_COMMAND = ' · ask your admin for a higher limit'
const RAISE_WITH_COMMAND =
  ' · run /usage-credits to raise it, or visit claude.ai/admin-settings/usage'
const RAISE_WITHOUT_COMMAND =
  ' · visit claude.ai/admin-settings/usage to raise it'

function authMock() {
  return {
    ...authSnap,
    getOauthAccountInfo: () => undefined,
    getSubscriptionType: getSubscriptionTypeMock,
    isOverageProvisioningAllowed: isOverageProvisioningAllowedMock,
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

const {
  getRateLimitErrorMessage,
  getUsageCreditsAskAdminHint,
  isUsageCreditsHintEnabled,
} = await import('../rateLimitMessages.js')
const { getFableConsentCopy, planFablePurchaseIntent } = await import(
  'src/utils/fableConsent.js'
)

const ORIGINAL_DISABLE = process.env.DISABLE_EXTRA_USAGE_COMMAND

function restoreDisableEnv(): void {
  if (ORIGINAL_DISABLE === undefined) {
    delete process.env.DISABLE_EXTRA_USAGE_COMMAND
  } else {
    process.env.DISABLE_EXTRA_USAGE_COMMAND = ORIGINAL_DISABLE
  }
}

afterAll(() => {
  restoreDisableEnv()
  mock.module('src/utils/auth.js', () => ({ ...authSnap }))
  mock.module('src/utils/auth.ts', () => ({ ...authSnap }))
  mock.module('src/utils/billing.js', () => ({ ...billingSnap }))
  mock.module('src/utils/billing.ts', () => ({ ...billingSnap }))
})

afterEach(() => {
  restoreDisableEnv()
  getSubscriptionTypeMock.mockReset()
  getSubscriptionTypeMock.mockImplementation(() => 'team')
  hasClaudeAiBillingAccessMock.mockReset()
  hasClaudeAiBillingAccessMock.mockImplementation(() => false)
  isOverageProvisioningAllowedMock.mockReset()
  isOverageProvisioningAllowedMock.mockImplementation(() => true)
})

function rejected(partial: Partial<ClaudeAILimits>): ClaudeAILimits {
  return {
    status: 'rejected',
    unifiedRateLimitFallbackAvailable: false,
    isUsingOverage: false,
    overageDisabledReason: 'org_spend_cap_reached',
    ...partial,
  }
}

describe('densable 2.1.248 #38 usage-credits hint gate', () => {
  test('Nde() gold strings follow v_()', () => {
    delete process.env.DISABLE_EXTRA_USAGE_COMMAND
    isOverageProvisioningAllowedMock.mockImplementation(() => true)
    expect(isUsageCreditsHintEnabled()).toBe(true)
    expect(getUsageCreditsAskAdminHint()).toBe(NDE_ASK_WITH_COMMAND)

    process.env.DISABLE_EXTRA_USAGE_COMMAND = '1'
    expect(isUsageCreditsHintEnabled()).toBe(false)
    expect(getUsageCreditsAskAdminHint()).toBe(NDE_ASK_WITHOUT_COMMAND)
    expect(getUsageCreditsAskAdminHint()).not.toContain('/usage-credits')
  })

  test('v_() DISABLE uses isEnvTruthy — 0/false/off keep hints on', () => {
    isOverageProvisioningAllowedMock.mockImplementation(() => true)
    for (const value of ['0', 'false', 'FALSE', 'no', 'off', '']) {
      process.env.DISABLE_EXTRA_USAGE_COMMAND = value
      expect(isUsageCreditsHintEnabled()).toBe(true)
      expect(getUsageCreditsAskAdminHint()).toBe(NDE_ASK_WITH_COMMAND)
    }
    for (const value of ['1', 'true', 'TRUE', 'yes', 'on']) {
      process.env.DISABLE_EXTRA_USAGE_COMMAND = value
      expect(isUsageCreditsHintEnabled()).toBe(false)
      expect(getUsageCreditsAskAdminHint()).toBe(NDE_ASK_WITHOUT_COMMAND)
    }
  })

  test('v_() is false when Zur() is false even if DISABLE is unset', () => {
    delete process.env.DISABLE_EXTRA_USAGE_COMMAND
    isOverageProvisioningAllowedMock.mockImplementation(() => false)
    expect(isUsageCreditsHintEnabled()).toBe(false)
    expect(getUsageCreditsAskAdminHint()).toBe(NDE_ASK_WITHOUT_COMMAND)
  })

  test('team spend-cap member copy drops /usage-credits when DISABLE is set', () => {
    process.env.DISABLE_EXTRA_USAGE_COMMAND = '1'
    const msg = getRateLimitErrorMessage(rejected({}), 'claude-opus-4-6')
    expect(msg).toContain('individual spend limit')
    expect(msg).toContain('ask your admin for a higher limit')
    expect(msg).not.toContain('/usage-credits')
    expect(msg).toContain(NDE_ASK_WITHOUT_COMMAND.trim())
  })

  test('team spend-cap member copy still suggests /usage-credits when available', () => {
    delete process.env.DISABLE_EXTRA_USAGE_COMMAND
    const msg = getRateLimitErrorMessage(rejected({}), 'claude-opus-4-6')
    expect(msg).toContain(NDE_ASK_WITH_COMMAND.trim())
  })

  test('billing-access raise copy uses gold false branch when DISABLE is set', () => {
    process.env.DISABLE_EXTRA_USAGE_COMMAND = '1'
    getSubscriptionTypeMock.mockImplementation(() => 'enterprise')
    hasClaudeAiBillingAccessMock.mockImplementation(() => true)
    const msg = getRateLimitErrorMessage(rejected({}), 'claude-opus-4-6')
    expect(msg).toContain(RAISE_WITHOUT_COMMAND.trim())
    expect(msg).not.toContain('/usage-credits')
    expect(msg).not.toContain(RAISE_WITH_COMMAND.trim())
  })

  test('billing-access raise copy still suggests /usage-credits when available', () => {
    delete process.env.DISABLE_EXTRA_USAGE_COMMAND
    getSubscriptionTypeMock.mockImplementation(() => 'enterprise')
    hasClaudeAiBillingAccessMock.mockImplementation(() => true)
    const msg = getRateLimitErrorMessage(rejected({}), 'claude-opus-4-6')
    expect(msg).toContain(RAISE_WITH_COMMAND.trim())
  })

  test('fable purchase-intent omits /usage-credits commandHint when DISABLE is set', () => {
    delete process.env.DISABLE_EXTRA_USAGE_COMMAND
    expect(
      planFablePurchaseIntent({
        choice: 'consent',
        lane: 'no_credits_yet',
      }),
    ).toEqual({ next: 'open_purchase', commandHint: '/usage-credits' })

    process.env.DISABLE_EXTRA_USAGE_COMMAND = '1'
    expect(
      planFablePurchaseIntent({
        choice: 'consent',
        lane: 'out_of_credits',
      }),
    ).toEqual({ next: 'open_purchase' })
  })

  test('fable consent copy and purchase-intent follow v_() / Zur()', () => {
    delete process.env.DISABLE_EXTRA_USAGE_COMMAND
    isOverageProvisioningAllowedMock.mockImplementation(() => true)
    expect(getFableConsentCopy().body).toContain('/usage-credits')

    isOverageProvisioningAllowedMock.mockImplementation(() => false)
    expect(getFableConsentCopy().body).toBe(
      "You're out of usage credits. /model to switch models.",
    )
    expect(getFableConsentCopy().body).not.toContain('/usage-credits')
    expect(
      planFablePurchaseIntent({
        choice: 'consent',
        lane: 'out_of_credits',
      }),
    ).toEqual({ next: 'open_purchase' })
  })
})
