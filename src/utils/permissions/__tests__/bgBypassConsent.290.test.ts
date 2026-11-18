import { beforeEach, describe, expect, mock, test } from 'bun:test'

let mockIsBg = false
let mockPolicySkip = false
let mockUserSkip = false
let mockBypassAccepted = false

mock.module('src/utils/concurrentSessions.js', () => ({
  isBgSession: () => mockIsBg,
  isBgSessionWithoutTerminal: () => mockIsBg,
}))

mock.module('src/utils/config.js', () => ({
  getGlobalConfig: () => ({
    bypassPermissionsModeAccepted: mockBypassAccepted,
  }),
}))

mock.module('src/utils/settings/settings.js', () => ({
  canTrustAdminPolicyCascade: () => true,
  getPolicySettingsOrigin: () => undefined,
  getSettings_DEPRECATED: () => ({}),
  getSettingsFilePathForSource: () => undefined,
  getSettingsForSource: (source: string) => {
    if (source === 'policySettings') {
      return mockPolicySkip
        ? { skipDangerousModePermissionPrompt: true }
        : undefined
    }
    if (source === 'userSettings') {
      return mockUserSkip
        ? { skipDangerousModePermissionPrompt: true }
        : undefined
    }
    return undefined
  },
  getUseAutoModeDuringPlan: () => false,
  hasAutoModeOptIn: () => false,
}))

const {
  BG_BYPASS_DOWNGRADED_NOTIFICATION,
  hasVouchedSkipDangerousModePermissionPrompt,
  isUnconsentedBgBypass,
} = await import('../permissionSetup.js')

describe('v2.1.290 #113 bypassPermissionsModeAccepted worker guard', () => {
  beforeEach(() => {
    mockIsBg = false
    mockPolicySkip = false
    mockUserSkip = false
    mockBypassAccepted = false
  })

  test('non-bg session never triggers unconsented bg bypass', () => {
    mockIsBg = false
    expect(isUnconsentedBgBypass('bypassPermissions')).toBe(false)
    expect(isUnconsentedBgBypass('default')).toBe(false)
  })

  test('bg session without user/policy skipDangerousModePermissionPrompt or bypassPermissionsModeAccepted is unconsented', () => {
    mockIsBg = true
    expect(hasVouchedSkipDangerousModePermissionPrompt()).toBe(false)
    expect(isUnconsentedBgBypass('bypassPermissions')).toBe(true)
    expect(isUnconsentedBgBypass('acceptEdits')).toBe(false)
    expect(BG_BYPASS_DOWNGRADED_NOTIFICATION).toContain(
      'Permission mode downgraded to default:',
    )
  })

  test('bg session with bypassPermissionsModeAccepted in global config is consented', () => {
    mockIsBg = true
    mockBypassAccepted = true
    expect(isUnconsentedBgBypass('bypassPermissions')).toBe(false)
  })

  test('bg session with userSettings or policySettings skipDangerousModePermissionPrompt is consented', () => {
    mockIsBg = true
    mockUserSkip = true
    expect(hasVouchedSkipDangerousModePermissionPrompt()).toBe(true)
    expect(isUnconsentedBgBypass('bypassPermissions')).toBe(false)

    mockUserSkip = false
    mockPolicySkip = true
    expect(hasVouchedSkipDangerousModePermissionPrompt()).toBe(true)
    expect(isUnconsentedBgBypass('bypassPermissions')).toBe(false)
  })
})
