/**
 * densable 2.1.221 #13 — individual spend limit vs org monthly spend limit.
 */
import { afterEach, describe, expect, mock, test } from 'bun:test'
import type { ClaudeAILimits } from '../claudeAiLimits.js'

const getSubscriptionTypeMock = mock(() => 'team' as string | null)
const hasClaudeAiBillingAccessMock = mock(() => false)

mock.module('src/utils/auth.js', () => ({
  getOauthAccountInfo: () => undefined,
  getSubscriptionType: getSubscriptionTypeMock,
  isOverageProvisioningAllowed: () => true,
}))
mock.module('src/utils/billing.js', () => ({
  hasClaudeAiBillingAccess: hasClaudeAiBillingAccessMock,
}))

const { getRateLimitErrorMessage } = await import('../rateLimitMessages.js')

afterEach(() => {
  getSubscriptionTypeMock.mockReset()
  getSubscriptionTypeMock.mockImplementation(() => 'team')
  hasClaudeAiBillingAccessMock.mockReset()
  hasClaudeAiBillingAccessMock.mockImplementation(() => false)
})

function rejected(partial: Partial<ClaudeAILimits>): ClaudeAILimits {
  return {
    status: 'rejected',
    unifiedRateLimitFallbackAvailable: false,
    isUsingOverage: false,
    ...partial,
  }
}

describe('getRateLimitErrorMessage densable 2.1.221 individual spend', () => {
  test('team + org_spend_cap_reached → individual spend limit (member)', () => {
    getSubscriptionTypeMock.mockImplementation(() => 'team')
    hasClaudeAiBillingAccessMock.mockImplementation(() => false)
    const msg = getRateLimitErrorMessage(
      rejected({ overageDisabledReason: 'org_spend_cap_reached' }),
      'claude-opus-4-6',
    )
    expect(msg).toContain('individual spend limit')
    expect(msg).toContain(
      'run /usage-credits to ask your admin for a higher limit',
    )
    expect(msg).not.toContain("org's monthly spend limit")
  })

  test('enterprise + org_spend_cap_reached + billing access → raise + admin settings', () => {
    getSubscriptionTypeMock.mockImplementation(() => 'enterprise')
    hasClaudeAiBillingAccessMock.mockImplementation(() => true)
    const msg = getRateLimitErrorMessage(
      rejected({ overageDisabledReason: 'org_spend_cap_reached' }),
      'claude-opus-4-6',
    )
    expect(msg).toContain('individual spend limit')
    expect(msg).toContain(
      'run /usage-credits to raise it, or visit claude.ai/admin-settings/usage',
    )
  })

  test('team + org_level_disabled_until → org monthly spend limit', () => {
    getSubscriptionTypeMock.mockImplementation(() => 'team')
    hasClaudeAiBillingAccessMock.mockImplementation(() => false)
    const msg = getRateLimitErrorMessage(
      rejected({ overageDisabledReason: 'org_level_disabled_until' }),
      'claude-sonnet-4-6',
    )
    expect(msg).toContain("org's monthly spend limit")
    expect(msg).not.toContain('individual spend limit')
  })

  test('max consumer + org_spend_cap_reached + billing → monthly spend limit URL', () => {
    getSubscriptionTypeMock.mockImplementation(() => 'max')
    hasClaudeAiBillingAccessMock.mockImplementation(() => true)
    const msg = getRateLimitErrorMessage(
      rejected({ overageDisabledReason: 'org_spend_cap_reached' }),
      'claude-opus-4-6',
    )
    expect(msg).toContain('monthly spend limit')
    expect(msg).toContain('claude.ai/settings/usage?from=cc_cli_limit_message')
  })
})
