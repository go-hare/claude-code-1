import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

let mockOrigin: string | null = null
let mockPolicy: Record<string, unknown> | null = null
let mockUser: Record<string, unknown> | null = null
let mockInitial: Record<string, unknown> = {}

mock.module('../settings/settings.js', () => ({
  getInitialSettings: () => mockInitial,
  getPolicySettingsOrigin: () => mockOrigin,
  getSettingsForSource: (source: string) => {
    if (source === 'policySettings') return mockPolicy
    if (source === 'userSettings') return mockUser
    return null
  },
  loadManagedFileSettings: () => ({ settings: null, errors: [] }),
}))

const {
  getUserForceLoginGatewayUrl,
  resolveInteractiveForceLoginMethod,
  shouldRejectSavedGatewayLogin,
} = await import('../forceLoginMethod.js')

beforeEach(() => {
  mockOrigin = null
  mockPolicy = null
  mockUser = null
  mockInitial = {}
})

describe('v2.1.295-296 forceLoginMethod gateway (#351, #496)', () => {
  test('honors userSettings forceLoginMethod: gateway and forceLoginGatewayUrl when no managed settings exist (#351)', () => {
    mockUser = {
      forceLoginMethod: 'gateway',
      forceLoginGatewayUrl: 'https://gateway.user.example.com',
    }
    mockInitial = { ...mockUser }

    expect(getUserForceLoginGatewayUrl()).toBe(
      'https://gateway.user.example.com',
    )
    const resolved = resolveInteractiveForceLoginMethod()
    expect(resolved.forceLoginMethod).toBe('gateway')
    expect(resolved.forceLoginGatewayUrl).toBe(
      'https://gateway.user.example.com',
    )
    expect(resolved.gatewayForced).toBe(true)
  })

  test('keeps saved gateway login when policySettings sets forceLoginMethod: gateway with no forceLoginGatewayUrl (#496)', () => {
    mockOrigin = 'file'
    mockPolicy = {
      forceLoginMethod: 'gateway',
    }

    expect(
      shouldRejectSavedGatewayLogin('https://saved.gateway.example.com'),
    ).toBe(false)
  })

  test('rejects saved gateway login when policySettings pins a different forceLoginGatewayUrl', () => {
    mockOrigin = 'file'
    mockPolicy = {
      forceLoginMethod: 'gateway',
      forceLoginGatewayUrl: 'https://pinned.gateway.example.com',
    }

    expect(
      shouldRejectSavedGatewayLogin('https://other.gateway.example.com'),
    ).toBe(true)
    expect(
      shouldRejectSavedGatewayLogin('https://pinned.gateway.example.com'),
    ).toBe(false)
  })

  test('claudeAiLimits.ts allows gateway spend limit when CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC is set (#376)', () => {
    const src = readFileSync(
      join(import.meta.dir, '../../services/claudeAiLimits.ts'),
      'utf8',
    )
    expect(src).toContain(
      "if (isEssentialTrafficOnly() && getAPIProvider() !== 'gateway')",
    )
  })
})
