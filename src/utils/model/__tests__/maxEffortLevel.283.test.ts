import { afterAll, afterEach, describe, expect, mock, test } from 'bun:test'
import * as realSettings from 'src/utils/settings/settings.js'
import {
  createSettingsMock,
  restoreSettingsMockWith,
  snapshotModuleExports,
} from '../../../../tests/mocks/settings.js'

const settingsSnap = snapshotModuleExports(realSettings)

let sources: Record<string, Record<string, unknown>> = {}

mock.module(
  'src/utils/settings/settings.js',
  createSettingsMock(settingsSnap, {
    getSettingsForSource: (source: string) => sources[source] ?? {},
    getInitialSettings: () => ({}),
  }),
)

afterEach(() => {
  sources = {}
})

afterAll(() => {
  restoreSettingsMockWith(mock.module, settingsSnap)
})

const {
  clampEffortToOrgLimit,
  getCombinedMaxEffortLevel,
  getSettingsMaxEffortLevel,
} = await import('../effortCatalog.js')
const { formatOrgEffortExceedMessage } = await import('../../effort.js')

describe('maxEffortLevel densable 2.1.283', () => {
  test('settings cap applies on every provider including Bedrock', () => {
    sources = { userSettings: { maxEffortLevel: 'medium' } }
    process.env.CLAUDE_CODE_USE_BEDROCK = '1'
    expect(getSettingsMaxEffortLevel('claude-opus-5-5')).toBe('medium')
    expect(getCombinedMaxEffortLevel('claude-opus-5-5')).toBe('medium')
    expect(clampEffortToOrgLimit('xhigh', 'claude-opus-5-5')).toBe('medium')
    delete process.env.CLAUDE_CODE_USE_BEDROCK
  })

  test('lowest settings file wins; per-model replaces top-level', () => {
    sources = {
      userSettings: { maxEffortLevel: 'high' },
      policySettings: { maxEffortLevel: 'low' },
    }
    expect(getSettingsMaxEffortLevel('claude-opus-5-5')).toBe('low')

    sources = {
      userSettings: {
        maxEffortLevel: 'low',
        modelSettings: {
          'claude-opus-5-5': { maxEffortLevel: 'high' },
        },
      },
    }
    expect(getSettingsMaxEffortLevel('claude-opus-5-5')).toBe('high')
    expect(getSettingsMaxEffortLevel('claude-sonnet-5')).toBe('low')
  })

  test('"max" exempts the model from the top-level cap', () => {
    sources = {
      userSettings: {
        maxEffortLevel: 'medium',
        modelSettings: {
          'claude-opus-5-5': { maxEffortLevel: 'max' },
        },
      },
    }
    expect(getSettingsMaxEffortLevel('claude-opus-5-5')).toBe(null)
    expect(getSettingsMaxEffortLevel('claude-sonnet-5')).toBe('medium')
  })

  test('APo copy names settings or organization', () => {
    sources = { userSettings: { maxEffortLevel: 'medium' } }
    expect(formatOrgEffortExceedMessage('xhigh', 'claude-opus-5-5')).toContain(
      'set by your settings or organization',
    )
  })
})
