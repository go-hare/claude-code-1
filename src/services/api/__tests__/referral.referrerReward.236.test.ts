import { afterAll, describe, expect, mock, test } from 'bun:test'
import { snapshotModuleExports } from '../../../../tests/mocks/settings.js'
import * as realConfig from '../../../utils/config.js'
import * as realAuth from '../../../utils/auth.js'

const configSnap = snapshotModuleExports(realConfig)
const authSnap = snapshotModuleExports(realAuth)

let mockOrgId: string | undefined = 'org-test'
let mockReward: unknown

function configMock() {
  return {
    ...configSnap,
    getGlobalConfig: () => ({
      ...(configSnap.getGlobalConfig as typeof realConfig.getGlobalConfig)(),
      passesEligibilityCache:
        mockOrgId === undefined
          ? undefined
          : {
              [mockOrgId]: {
                eligible: true,
                remaining_passes: 1,
                referrer_reward: mockReward,
                timestamp: Date.now(),
              },
            },
    }),
  }
}

function authMock() {
  return {
    ...authSnap,
    getOauthAccountInfo: () =>
      mockOrgId
        ? {
            organizationUuid: mockOrgId,
            accountUuid: 'acct',
          }
        : undefined,
    isClaudeAISubscriber: () => true,
    getSubscriptionType: () => 'max' as const,
  }
}

mock.module('../../../utils/config.js', configMock)
mock.module('src/utils/config.js', configMock)
mock.module('src/utils/config.ts', configMock)
mock.module('../../../utils/auth.js', authMock)
mock.module('src/utils/auth.js', authMock)
mock.module('src/utils/auth.ts', authMock)

afterAll(() => {
  mock.module('../../../utils/config.js', () => ({ ...configSnap }))
  mock.module('src/utils/config.js', () => ({ ...configSnap }))
  mock.module('src/utils/config.ts', () => ({ ...configSnap }))
  mock.module('../../../utils/auth.js', () => ({ ...authSnap }))
  mock.module('src/utils/auth.js', () => ({ ...authSnap }))
  mock.module('src/utils/auth.ts', () => ({ ...authSnap }))
})

const { getCachedReferrerReward } = await import('../referral.js')

describe('getCachedReferrerReward (densable VsT)', () => {
  test('returns parsed reward for valid shape', () => {
    mockOrgId = 'org-test'
    mockReward = { amount_minor_units: 500, currency: 'USD' }
    expect(getCachedReferrerReward()).toEqual({
      amount_minor_units: 500,
      currency: 'USD',
    })
  })

  test('malformed reward safeParse → null', () => {
    mockOrgId = 'org-test'
    mockReward = { amount_minor_units: 'nope', currency: 'US' }
    expect(getCachedReferrerReward()).toBeNull()
    mockReward = null
    expect(getCachedReferrerReward()).toBeNull()
    mockReward = { amount_minor_units: 1, currency: 'TOOLONG' }
    expect(getCachedReferrerReward()).toBeNull()
  })
})
