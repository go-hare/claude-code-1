/**
 * densable 2.1.251 #53 — Pbt skips ListInferenceProfiles when the host flag
 * is on and the session model is a provider id. NU is first-party id → key.
 */
import { beforeAll, describe, expect, mock, test } from 'bun:test'
import { debugMock } from '../../../../tests/mocks/debug.js'
import { logMock } from '../../../../tests/mocks/log.js'

mock.module('src/utils/log.ts', logMock)
mock.module('src/utils/debug.ts', debugMock)

const {
  FIRST_PARTY_ID_TO_KEY,
  getBedrockModelStrings,
  sessionModelIsProviderId,
  shouldSkipHostManagedBedrockProfileDiscovery,
} = await import('../modelStrings.js')
const { getBedrockInferenceProfiles } = await import('../bedrock.js')
const { setMainLoopModelOverride } = await import('src/bootstrap/state.js')
const {
  listBedrockFallbackCandidates,
  listBedrockUpgradeCandidates,
  listMantleFallbackCandidates,
  listVertexFallbackCandidates,
  listVertexUpgradeCandidates,
  readHostManagedAdminPin,
} = await import('../hostManagedProfileLists.js')

describe('densable 2.1.251 #53 host-managed bedrock discovery', () => {
  beforeAll(() => {
    setMainLoopModelOverride(undefined)
  })

  test('alias and blank are not provider ids', () => {
    expect(sessionModelIsProviderId(null)).toBe(false)
    expect(sessionModelIsProviderId('')).toBe(false)
    expect(sessionModelIsProviderId('  ')).toBe(false)
    expect(sessionModelIsProviderId('opus')).toBe(false)
    expect(sessionModelIsProviderId('Sonnet')).toBe(false)
    expect(sessionModelIsProviderId('opus[1m]')).toBe(false)
    expect(
      sessionModelIsProviderId('anthropic.claude-sonnet-4-5-20250929-v1:0'),
    ).toBe(true)
    expect(sessionModelIsProviderId('claude-sonnet-4-5-20250929')).toBe(false)
    expect(sessionModelIsProviderId('claude-opus-4-6')).toBe(false)
    expect(Object.hasOwn(FIRST_PARTY_ID_TO_KEY, 'claude-opus-4-6')).toBe(true)
  })

  test('S/F/R/U/B return [] on the host flag; zje returns undefined', async () => {
    const host = { CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST: '1' }
    expect(await listBedrockUpgradeCandidates(host)).toEqual([])
    expect(await listBedrockFallbackCandidates(host)).toEqual([])
    expect(await listVertexUpgradeCandidates(host)).toEqual([])
    expect(await listVertexFallbackCandidates(host)).toEqual([])
    expect(await listMantleFallbackCandidates(host)).toEqual([])
    expect(readHostManagedAdminPin('admin-pin', host)).toBeUndefined()
    expect(readHostManagedAdminPin('admin-pin', {})).toBe('admin-pin')
    expect(readHostManagedAdminPin('  ', {})).toBeUndefined()
    expect(readHostManagedAdminPin(null, {})).toBeUndefined()
  })

  test('skip only when host flag is on and the model id is concrete', () => {
    const host = { CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST: '1' }
    expect(
      shouldSkipHostManagedBedrockProfileDiscovery(
        host,
        'anthropic.claude-sonnet-4-5-20250929-v1:0',
      ),
    ).toBe(true)
    expect(shouldSkipHostManagedBedrockProfileDiscovery(host, 'opus')).toBe(
      false,
    )
    expect(shouldSkipHostManagedBedrockProfileDiscovery(host, '')).toBe(false)
    expect(shouldSkipHostManagedBedrockProfileDiscovery(host, null)).toBe(false)
    expect(
      shouldSkipHostManagedBedrockProfileDiscovery(
        { CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST: '0' },
        'anthropic.claude-sonnet-4-5-20250929-v1:0',
      ),
    ).toBe(false)
    expect(
      shouldSkipHostManagedBedrockProfileDiscovery(
        {},
        'anthropic.claude-sonnet-4-5-20250929-v1:0',
      ),
    ).toBe(false)
  })

  test('session start with host flag and model id does not list profiles', async () => {
    const previousHost = process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST
    const previousModel = process.env.ANTHROPIC_MODEL
    process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST = '1'
    process.env.ANTHROPIC_MODEL = 'anthropic.claude-sonnet-4-5-20250929-v1:0'
    const profiles = getBedrockInferenceProfiles as unknown as {
      cache?: { size: number }
    }
    const before = profiles.cache?.size ?? 0
    try {
      const strings = await getBedrockModelStrings()
      expect(strings).toBeTruthy()
      expect(Object.keys(strings).length).toBeGreaterThan(0)
      expect(profiles.cache?.size ?? 0).toBe(before)
    } finally {
      if (previousHost === undefined) {
        delete process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST
      } else {
        process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST = previousHost
      }
      if (previousModel === undefined) {
        delete process.env.ANTHROPIC_MODEL
      } else {
        process.env.ANTHROPIC_MODEL = previousModel
      }
    }
  })
})
