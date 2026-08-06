/**
 * densable 2.1.212 #43 — forceLoginMethod multi-surface enforcement (A9t / Stt).
 */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

const mockGetInitialSettings = mock(() => ({}) as Record<string, unknown>)
const mockGetSettingsForSource = mock(
  (_source: string) => null as Record<string, unknown> | null,
)
const mockGetPolicySettingsOrigin = mock(
  () => null as 'remote' | 'plist' | 'hklm' | 'file' | 'hkcu' | null,
)
const mockGetEnabledSettingSources = mock(
  () =>
    [
      'userSettings',
      'projectSettings',
      'localSettings',
      'flagSettings',
      'policySettings',
    ] as const,
)
const mockIsHostManagedProviderAuth = mock(() => false)
const mockLogEvent = mock((_name?: string, _props?: unknown) => {})

mock.module('../settings/settings.js', () => ({
  getInitialSettings: () => mockGetInitialSettings(),
  getSettingsForSource: (s: string) => mockGetSettingsForSource(s),
  getPolicySettingsOrigin: () => mockGetPolicySettingsOrigin(),
}))

mock.module('../settings/constants.js', () => ({
  getEnabledSettingSources: () => [...mockGetEnabledSettingSources()],
}))

mock.module('../aws.js', () => ({
  isHostManagedProviderAuth: () => mockIsHostManagedProviderAuth(),
}))

mock.module('../../services/analytics/index.js', () => ({
  logEvent: (name: string, props?: unknown) => mockLogEvent(name, props),
}))

const {
  isAdminManagedPolicyOrigin,
  resolveEffectiveForceLoginMethod,
  validateForcedLoginMethod,
  resolveInteractiveForceLoginMethod,
  FORCE_LOGIN_GATEWAY_CLI_MESSAGE,
  SETUP_TOKEN_FORCE_LOGIN_REFUSED_SUFFIX,
  INSTALL_GITHUB_APP_FORCE_LOGIN_REFUSED_SUFFIX,
} = await import('../forceLoginMethod.js')

beforeEach(() => {
  mockGetInitialSettings.mockReset()
  mockGetSettingsForSource.mockReset()
  mockGetPolicySettingsOrigin.mockReset()
  mockGetEnabledSettingSources.mockReset()
  mockIsHostManagedProviderAuth.mockReset()
  mockLogEvent.mockReset()
  mockGetInitialSettings.mockReturnValue({})
  mockGetSettingsForSource.mockReturnValue(null)
  mockGetPolicySettingsOrigin.mockReturnValue(null)
  mockGetEnabledSettingSources.mockReturnValue([
    'userSettings',
    'projectSettings',
    'localSettings',
    'flagSettings',
    'policySettings',
  ] as const)
  mockIsHostManagedProviderAuth.mockReturnValue(false)
})

afterEach(() => {
  mockGetInitialSettings.mockReset()
})

describe('densable #43 isAdminManagedPolicyOrigin (h5t)', () => {
  test('helper/plist/hklm/file are admin-managed', () => {
    expect(isAdminManagedPolicyOrigin('helper')).toBe(true)
    expect(isAdminManagedPolicyOrigin('plist')).toBe(true)
    expect(isAdminManagedPolicyOrigin('hklm')).toBe(true)
    expect(isAdminManagedPolicyOrigin('file')).toBe(true)
  })

  test('remote/hkcu/null are not admin-managed for gateway pin', () => {
    expect(isAdminManagedPolicyOrigin('remote')).toBe(false)
    expect(isAdminManagedPolicyOrigin('hkcu')).toBe(false)
    expect(isAdminManagedPolicyOrigin(null)).toBe(false)
  })
})

describe('densable #43 resolveEffectiveForceLoginMethod (A9t)', () => {
  test('admin policy gateway pin returns gateway', () => {
    mockGetPolicySettingsOrigin.mockReturnValue('file')
    mockGetSettingsForSource.mockImplementation(source =>
      source === 'policySettings' ? { forceLoginMethod: 'gateway' } : null,
    )
    expect(resolveEffectiveForceLoginMethod()).toBe('gateway')
  })

  test('merged gateway without admin origin is stripped', () => {
    mockGetPolicySettingsOrigin.mockReturnValue(null)
    mockGetInitialSettings.mockReturnValue({ forceLoginMethod: 'gateway' })
    expect(resolveEffectiveForceLoginMethod()).toBeUndefined()
  })

  test('claudeai / console pass through', () => {
    mockGetInitialSettings.mockReturnValue({ forceLoginMethod: 'claudeai' })
    expect(resolveEffectiveForceLoginMethod()).toBe('claudeai')
    mockGetInitialSettings.mockReturnValue({ forceLoginMethod: 'console' })
    expect(resolveEffectiveForceLoginMethod()).toBe('console')
  })
})

describe('densable #43 validateForcedLoginMethod (Stt)', () => {
  test('no pin always valid', () => {
    expect(validateForcedLoginMethod(true)).toEqual({ valid: true })
    expect(validateForcedLoginMethod(false)).toEqual({ valid: true })
  })

  test('gateway pin rejects non-interactive surfaces', () => {
    mockGetPolicySettingsOrigin.mockReturnValue('file')
    mockGetSettingsForSource.mockImplementation(source =>
      source === 'policySettings' ? { forceLoginMethod: 'gateway' } : null,
    )
    const r = validateForcedLoginMethod(true)
    expect(r.valid).toBe(false)
    if (!r.valid) {
      expect(r.message).toContain("forceLoginMethod is 'gateway'")
      expect(r.message).toContain('interactive terminal')
    }
  })

  test('claudeai pin allows claudeai path only', () => {
    mockGetInitialSettings.mockReturnValue({ forceLoginMethod: 'claudeai' })
    mockGetSettingsForSource.mockImplementation(source =>
      source === 'policySettings' ? { forceLoginMethod: 'claudeai' } : null,
    )
    expect(validateForcedLoginMethod(true)).toEqual({ valid: true })
    const r = validateForcedLoginMethod(false)
    expect(r.valid).toBe(false)
    if (!r.valid) {
      expect(r.message).toContain("forceLoginMethod is 'claudeai'")
    }
  })

  test('console pin allows console path only', () => {
    mockGetInitialSettings.mockReturnValue({ forceLoginMethod: 'console' })
    mockGetSettingsForSource.mockImplementation(source =>
      source === 'userSettings' ? { forceLoginMethod: 'console' } : null,
    )
    expect(validateForcedLoginMethod(false)).toEqual({ valid: true })
    const r = validateForcedLoginMethod(true)
    expect(r.valid).toBe(false)
    if (!r.valid) {
      expect(r.message).toContain("forceLoginMethod is 'console'")
    }
  })

  test('host-managed provider skips pin and logs', () => {
    mockIsHostManagedProviderAuth.mockReturnValue(true)
    mockGetInitialSettings.mockReturnValue({ forceLoginMethod: 'claudeai' })
    expect(validateForcedLoginMethod(false)).toEqual({ valid: true })
    expect(mockLogEvent).toHaveBeenCalled()
  })
})

describe('densable #43 resolveInteractiveForceLoginMethod', () => {
  test('admin gateway + url prefill', () => {
    mockGetPolicySettingsOrigin.mockReturnValue('file')
    mockGetSettingsForSource.mockImplementation(source =>
      source === 'policySettings'
        ? {
            forceLoginMethod: 'gateway',
            forceLoginGatewayUrl: 'https://gateway.example.com',
          }
        : null,
    )
    mockGetInitialSettings.mockReturnValue({ forceLoginMethod: 'gateway' })
    const r = resolveInteractiveForceLoginMethod()
    expect(r.forceLoginMethod).toBe('gateway')
    expect(r.forceLoginGatewayUrl).toBe('https://gateway.example.com')
    expect(r.gatewayForced).toBe(true)
  })

  test('prop overrides settings for claudeai/console', () => {
    mockGetInitialSettings.mockReturnValue({ forceLoginMethod: 'console' })
    const r = resolveInteractiveForceLoginMethod('claudeai')
    expect(r.forceLoginMethod).toBe('claudeai')
  })
})

describe('densable #43 refusal copy constants', () => {
  test('CLI gateway / setup-token / install-github-app suffixes', () => {
    expect(FORCE_LOGIN_GATEWAY_CLI_MESSAGE).toContain('interactive /login')
    expect(SETUP_TOKEN_FORCE_LOGIN_REFUSED_SUFFIX).toContain(
      'long-lived Claude.ai',
    )
    expect(INSTALL_GITHUB_APP_FORCE_LOGIN_REFUSED_SUFFIX).toContain(
      'API key instead',
    )
  })
})
