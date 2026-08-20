import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from 'bun:test'
import * as realConfig from '../../config.js'
import { snapshotModuleExports } from '../../../../tests/mocks/settings.js'

type CacheShape = {
  name: string
  updated_at: string
  data_source: string
  override_user_selection: boolean
  orgUuid?: string
}

let mockCache: CacheShape | null = null
let mockOrgUuid: string | undefined

// Snapshot BEFORE mock — live namespace rebinds under Bun mock.module.
// Thin { getGlobalConfig, saveGlobalConfig } drops checkHasTrustDialogAccepted
// and no-ops saveGlobalConfig, breaking installPrompt co-suites.
const configSnap = snapshotModuleExports(realConfig)
const realGetGlobalConfig =
  configSnap.getGlobalConfig as typeof realConfig.getGlobalConfig

function configMock() {
  return {
    ...configSnap,
    getGlobalConfig: () => ({
      ...realGetGlobalConfig(),
      orgModelDefaultCache: mockCache,
      oauthAccount:
        mockOrgUuid === undefined
          ? undefined
          : {
              organizationUuid: mockOrgUuid,
              accountUuid: 'acct-test',
            },
    }),
  }
}

mock.module('../../config.js', configMock)
mock.module('src/utils/config.js', configMock)
mock.module('src/utils/config.ts', configMock)
afterAll(() => {
  mock.module('../../config.js', () => ({ ...configSnap }))
  mock.module('src/utils/config.js', () => ({ ...configSnap }))
  mock.module('src/utils/config.ts', () => ({ ...configSnap }))
})

const {
  getDefaultModelAttributionBadge,
  getOrgModelDefaultCache,
  getResolvedOrgDefaultModel,
  resolveAnthropicDefaultModelEnv,
  shouldOrgDefaultOverrideUserSelection,
} = await import('../orgDefaultModel.js')
const { setInitialEnvDefaultModel } = await import(
  '../../../bootstrap/state.js'
)

const originalProvider = process.env.CLAUDE_CODE_USE_BEDROCK
const originalDefaultModel = process.env.ANTHROPIC_DEFAULT_MODEL

describe('orgDefaultModel', () => {
  beforeEach(() => {
    // Ensure first-party provider for org default resolution.
    delete process.env.CLAUDE_CODE_USE_BEDROCK
    delete process.env.CLAUDE_CODE_USE_VERTEX
    delete process.env.CLAUDE_CODE_USE_FOUNDRY
    delete process.env.ANTHROPIC_DEFAULT_MODEL
    setInitialEnvDefaultModel(undefined)
    mockCache = null
    mockOrgUuid = undefined
  })

  afterEach(() => {
    if (originalProvider !== undefined) {
      process.env.CLAUDE_CODE_USE_BEDROCK = originalProvider
    }
    if (originalDefaultModel === undefined) {
      delete process.env.ANTHROPIC_DEFAULT_MODEL
    } else {
      process.env.ANTHROPIC_DEFAULT_MODEL = originalDefaultModel
    }
    setInitialEnvDefaultModel(undefined)
    mockCache = null
    mockOrgUuid = undefined
  })

  test('getDefaultModelAttributionBadge maps org / enforced / env / tier', () => {
    expect(getDefaultModelAttributionBadge('org')).toBe(' · Org default')
    expect(getDefaultModelAttributionBadge('enforced')).toBe(
      ' · Set by your organization',
    )
    expect(getDefaultModelAttributionBadge('entitlement')).toBe(
      ' · Set by your organization',
    )
    expect(getDefaultModelAttributionBadge('env')).toBe(
      ' · Set by ANTHROPIC_DEFAULT_MODEL',
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

  test('resolveAnthropicDefaultModelEnv returns live env value', () => {
    process.env.ANTHROPIC_DEFAULT_MODEL = 'claude-sonnet-4-6'
    expect(resolveAnthropicDefaultModelEnv()).toBe('claude-sonnet-4-6')
  })

  test('resolveAnthropicDefaultModelEnv treats default/inherit/plan aliases as inert', () => {
    process.env.ANTHROPIC_DEFAULT_MODEL = 'default'
    expect(resolveAnthropicDefaultModelEnv()).toBeNull()
    process.env.ANTHROPIC_DEFAULT_MODEL = 'inherit'
    expect(resolveAnthropicDefaultModelEnv()).toBeNull()
    process.env.ANTHROPIC_DEFAULT_MODEL = 'opusplan'
    expect(resolveAnthropicDefaultModelEnv()).toBeNull()
    process.env.ANTHROPIC_DEFAULT_MODEL = 'haiku'
    expect(resolveAnthropicDefaultModelEnv()).toBeNull()
  })

  test('resolveAnthropicDefaultModelEnv prefers latched startup value', () => {
    process.env.ANTHROPIC_DEFAULT_MODEL = 'claude-live'
    setInitialEnvDefaultModel('claude-latched')
    expect(resolveAnthropicDefaultModelEnv()).toBe('claude-latched')
    setInitialEnvDefaultModel(null)
    expect(resolveAnthropicDefaultModelEnv()).toBeNull()
  })
})
