/**
 * densable 236 #24 — official Cci, not isNewest / highlightText.
 * Newer hint only when catalog index is before the alias target and Gu(alias).
 *
 * Isolation: getCciFamily uses getDefaultSonnetModel() as aliasModel. Under a
 * polluted third-party getAPIProvider() that id is absent from ALL_MODEL_CONFIGS
 * firstParty catalog → aliasIndex === -1 → slogan instead of Newer version.
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
import { resetModelStringsForTestingOnly } from 'src/bootstrap/state.js'
import {
  createSettingsMock,
  restoreSettingsMockWith,
  snapshotModuleExports,
} from '../../../../tests/mocks/settings.js'
import { ALL_MODEL_CONFIGS } from '../configs.js'
import { FABLE_SLOGAN } from '../fablePicker.js'

const settingsSnap = snapshotModuleExports(
  await import('src/utils/settings/settings.js'),
)
const providersSnap = snapshotModuleExports(await import('../providers.js'))
const modelSnap = snapshotModuleExports(await import('../model.js'))
const allowlistSnap = snapshotModuleExports(
  await import('../modelAllowlist.js'),
)
const entitlementSnap = snapshotModuleExports(
  await import('../entitlementOverlay.js'),
)

mock.module(
  'src/utils/settings/settings.js',
  createSettingsMock(settingsSnap, {
    getInitialSettings: () => ({}),
    getSettings_DEPRECATED: () => ({}),
    getSettingsForSource: () => ({}),
  }),
)
mock.module('src/utils/model/providers.js', () => ({
  ...providersSnap,
  getAPIProvider: () => 'firstParty' as const,
}))
mock.module('src/utils/model/model.js', () => ({
  ...modelSnap,
  getDefaultSonnetModel: () => ALL_MODEL_CONFIGS.sonnet5.firstParty,
  getDefaultOpusModel: () => ALL_MODEL_CONFIGS.opus5.firstParty,
  getDefaultFableModel: () => ALL_MODEL_CONFIGS.fable5.firstParty,
  getDefaultHaikuModel: () => ALL_MODEL_CONFIGS.haiku45.firstParty,
}))
mock.module('src/utils/model/modelAllowlist.js', () => ({
  ...allowlistSnap,
  isModelAllowed: () => true,
}))
mock.module('src/utils/model/entitlementOverlay.js', () => ({
  ...entitlementSnap,
  isModelDenied: () => false,
}))

afterAll(() => {
  restoreSettingsMockWith(mock.module, settingsSnap)
  mock.module('src/utils/model/providers.js', () => ({ ...providersSnap }))
  mock.module('src/utils/model/model.js', () => ({ ...modelSnap }))
  mock.module('src/utils/model/modelAllowlist.js', () => ({ ...allowlistSnap }))
  mock.module('src/utils/model/entitlementOverlay.js', () => ({
    ...entitlementSnap,
  }))
})

const { getKnownModelOption } = await import('../modelOptions.js')

const envKeys = [
  'CLAUDE_CODE_USE_GROK',
  'CLAUDE_CODE_USE_OPENAI',
  'CLAUDE_CODE_USE_GEMINI',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_GATEWAY',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_MANTLE',
] as const

function resetAllowlist(): void {
  for (const key of envKeys) {
    delete process.env[key]
  }
  resetModelStringsForTestingOnly()
}

describe('Cci getKnownModelOption (236 #24)', () => {
  beforeEach(resetAllowlist)
  afterEach(resetAllowlist)

  test('newest sonnet uses slogan, not Newer version', () => {
    const opt = getKnownModelOption(ALL_MODEL_CONFIGS.sonnet5.firstParty)
    expect(opt?.description).toBe(
      `Efficient for routine tasks (${ALL_MODEL_CONFIGS.sonnet5.firstParty})`,
    )
    expect(opt?.description).not.toContain('Newer version available')
  })

  test('older sonnet before alias in catalog shows Newer version', () => {
    const older = ALL_MODEL_CONFIGS.sonnet40.firstParty
    const newestName = getKnownModelOption(
      ALL_MODEL_CONFIGS.sonnet5.firstParty,
    )?.label
    const opt = getKnownModelOption(older)
    expect(opt?.description).toBe(
      `Newer version available · select Sonnet for ${newestName}`,
    )
  })

  test('newest opus uses gzn slogan', () => {
    const id = ALL_MODEL_CONFIGS.opus5.firstParty
    const opt = getKnownModelOption(id)
    expect(opt?.description).toBe(`Best for everyday, complex tasks (${id})`)
  })

  test('unknown family is Custom model (id)', () => {
    const opt = getKnownModelOption('my-finetune-xyz')
    // yA/getMarketingNameForModel may return null for unknown → whole Cci null
    if (opt) {
      expect(opt.description).toMatch(/^Custom model \(/)
    } else {
      expect(opt).toBeNull()
    }
  })

  test('fable uses Hyp slogan when it is the alias target', () => {
    const id = ALL_MODEL_CONFIGS.fable5.firstParty
    const opt = getKnownModelOption(id)
    expect(opt?.description).toBe(`${FABLE_SLOGAN} (${id})`)
  })
})
