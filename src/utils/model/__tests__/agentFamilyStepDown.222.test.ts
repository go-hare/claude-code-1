/**
 * densable 2.1.222 #8 — org-restricted model:opus family step-down.
 * SEA: coe/a$/K7r — stepDownRestrictedFamilyAliasPick, not parent inherit.
 */
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from 'bun:test'
import * as realSettings from '../../settings/settings.js'
import { snapshotModuleExports } from '../../../../tests/mocks/settings.js'

let mockAvailableModels: string[] | undefined

const settingsSnap = snapshotModuleExports(realSettings)

function settingsMock() {
  return {
    ...settingsSnap,
    getSettings_DEPRECATED: () => ({
      ...(typeof settingsSnap.getSettings_DEPRECATED === 'function'
        ? (settingsSnap.getSettings_DEPRECATED() as object)
        : {}),
      availableModels: mockAvailableModels,
    }),
  }
}

mock.module('../../settings/settings.js', settingsMock)
mock.module('src/utils/settings/settings.js', settingsMock)
mock.module('src/utils/settings/settings.ts', settingsMock)

const { aliasMatchesParentTier, getAgentModel } = await import('../agent.js')
const {
  familyTokenAtBoundary,
  newestAllowedModelInFamily,
  stepDownRestrictedFamilyAliasPick,
} = await import('../modelAllowlist.js')

afterAll(() => {
  mock.module('../../settings/settings.js', () => ({ ...settingsSnap }))
  mock.module('src/utils/settings/settings.js', () => ({ ...settingsSnap }))
  mock.module('src/utils/settings/settings.ts', () => ({ ...settingsSnap }))
})

describe('familyTokenAtBoundary (densable Lts)', () => {
  test('matches opus in claude-opus-4-5', () => {
    expect(familyTokenAtBoundary('claude-opus-4-5', 'opus')).toBe(true)
  })
  test('does not match opus inside opusplan', () => {
    expect(familyTokenAtBoundary('opusplan', 'opus')).toBe(false)
  })
})

describe('newestAllowedModelInFamily / stepDown (densable K7r/a$)', () => {
  beforeEach(() => {
    mockAvailableModels = undefined
  })
  afterEach(() => {
    mockAvailableModels = undefined
  })

  test('no availableModels → stepDown returns null', () => {
    mockAvailableModels = undefined
    expect(stepDownRestrictedFamilyAliasPick('opus')).toBeNull()
  })

  test('allowlist opus-4-5 only → newest in family is 4.5', () => {
    mockAvailableModels = ['opus-4-5']
    const newest = newestAllowedModelInFamily('opus')
    expect(newest).toBe('claude-opus-4-5-20251101')
    expect(stepDownRestrictedFamilyAliasPick('opus')).toBe(
      'claude-opus-4-5-20251101',
    )
  })

  test('allowlist full family alias opus → newest catalog opus', () => {
    mockAvailableModels = ['opus']
    const newest = newestAllowedModelInFamily('opus')
    expect(newest).toContain('opus')
    expect(stepDownRestrictedFamilyAliasPick('opus')).toBe(newest)
  })
})

describe('getAgentModel (densable 2.1.222 #8)', () => {
  const parentOpus5 = 'claude-opus-5'
  const parentSonnet = 'claude-sonnet-5'

  beforeEach(() => {
    mockAvailableModels = undefined
    delete process.env.CLAUDE_CODE_SUBAGENT_MODEL
  })
  afterEach(() => {
    mockAvailableModels = undefined
    delete process.env.CLAUDE_CODE_SUBAGENT_MODEL
  })

  test('aliasMatchesParentTier opus/sonnet/haiku/fable', () => {
    expect(aliasMatchesParentTier('opus', parentOpus5)).toBe(true)
    expect(aliasMatchesParentTier('sonnet', parentOpus5)).toBe(false)
    expect(aliasMatchesParentTier('sonnet', parentSonnet)).toBe(true)
    expect(aliasMatchesParentTier('opus[1m]', parentOpus5)).toBe(false)
  })

  test('unrestricted: model opus + parent opus → parent exact (Idp)', () => {
    mockAvailableModels = undefined
    expect(getAgentModel('opus', parentOpus5)).toBe(parentOpus5)
  })

  test('restricted to opus-4-5: model opus + parent opus5 → step down, not parent', () => {
    mockAvailableModels = ['opus-4-5']
    const resolved = getAgentModel('opus', parentOpus5)
    expect(resolved).toBe('claude-opus-4-5-20251101')
    expect(resolved).not.toBe(parentOpus5)
  })

  test('restricted to opus-4-5: toolSpecifiedModel opus steps down', () => {
    mockAvailableModels = ['opus-4-5']
    const resolved = getAgentModel('inherit', parentSonnet, 'opus')
    expect(resolved).toBe('claude-opus-4-5-20251101')
  })

  test('inherit still returns parent runtime model', () => {
    mockAvailableModels = ['opus-4-5']
    const resolved = getAgentModel('inherit', parentSonnet)
    // inherit does not re-route through opus allowlist
    expect(resolved).toContain('sonnet')
  })
})
