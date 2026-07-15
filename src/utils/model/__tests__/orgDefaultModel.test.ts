import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

type CacheShape = {
  name: string
  updated_at: string
  data_source: string
  override_user_selection: boolean
  orgUuid?: string
}

let mockCache: CacheShape | null = null
let mockOrgUuid: string | undefined

// Pure config surface — do not call real getGlobalConfig (mock.module replaces it).
function configMock() {
  return {
    getGlobalConfig: () => ({
      orgModelDefaultCache: mockCache,
      oauthAccount:
        mockOrgUuid === undefined
          ? undefined
          : {
              organizationUuid: mockOrgUuid,
              accountUuid: 'acct-test',
            },
    }),
    saveGlobalConfig: () => {},
  }
}

mock.module('../../config.js', configMock)
mock.module('src/utils/config.js', configMock)
mock.module('src/utils/config.ts', configMock)

const {
  getDefaultModelAttributionBadge,
  getOrgModelDefaultCache,
  getResolvedOrgDefaultModel,
  shouldOrgDefaultOverrideUserSelection,
} = await import('../orgDefaultModel.js')

const originalProvider = process.env.CLAUDE_CODE_USE_BEDROCK

describe('orgDefaultModel', () => {
  beforeEach(() => {
    // Ensure first-party provider for org default resolution.
    delete process.env.CLAUDE_CODE_USE_BEDROCK
    delete process.env.CLAUDE_CODE_USE_VERTEX
    delete process.env.CLAUDE_CODE_USE_FOUNDRY
    mockCache = null
    mockOrgUuid = undefined
  })

  afterEach(() => {
    if (originalProvider !== undefined) {
      process.env.CLAUDE_CODE_USE_BEDROCK = originalProvider
    }
    mockCache = null
    mockOrgUuid = undefined
  })

  test('getDefaultModelAttributionBadge maps org / enforced / tier', () => {
    expect(getDefaultModelAttributionBadge('org')).toBe(' · Org default')
    expect(getDefaultModelAttributionBadge('enforced')).toBe(
      ' · Set by your organization',
    )
    expect(getDefaultModelAttributionBadge('entitlement')).toBe(
      ' · Set by your organization',
    )
    expect(getDefaultModelAttributionBadge('tier')).toBe('')
  })

  test('getOrgModelDefaultCache returns null without cache', () => {
    mockCache = null
    expect(getOrgModelDefaultCache()).toBeNull()
  })

  test('orgUuid binding: four combinations', () => {
    const base = {
      name: 'claude-old-org-model',
      updated_at: '2026-01-01T00:00:00Z',
      data_source: 'bootstrap',
      override_user_selection: true,
    }

    // 1) cache.orgUuid = org-old, current org = undefined → reject (no leak)
    mockCache = { ...base, orgUuid: 'org-old' }
    mockOrgUuid = undefined
    expect(getOrgModelDefaultCache()).toBeNull()

    // 2) cache.orgUuid = org-old, current org = org-old → accept
    mockOrgUuid = 'org-old'
    expect(getOrgModelDefaultCache()?.name).toBe('claude-old-org-model')
    expect(shouldOrgDefaultOverrideUserSelection()).toBe(true)

    // 3) cache.orgUuid = org-old, current org = org-new → reject
    mockOrgUuid = 'org-new'
    expect(getOrgModelDefaultCache()).toBeNull()

    // 4) unbound legacy cache + current org set → reject
    mockCache = { ...base }
    mockOrgUuid = 'org-new'
    expect(getOrgModelDefaultCache()).toBeNull()

    // 5) unbound legacy cache + no current org → accept (same identity: null)
    mockOrgUuid = undefined
    expect(getOrgModelDefaultCache()?.name).toBe('claude-old-org-model')
  })

  test('getResolvedOrgDefaultModel null off firstParty', () => {
    mockCache = {
      name: 'm',
      updated_at: 't',
      data_source: 'bootstrap',
      override_user_selection: false,
      orgUuid: 'org-1',
    }
    mockOrgUuid = 'org-1'
    process.env.CLAUDE_CODE_USE_BEDROCK = '1'
    expect(getResolvedOrgDefaultModel()).toBeNull()
  })
})
