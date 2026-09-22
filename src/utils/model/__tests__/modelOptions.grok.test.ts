import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { resetModelStringsForTestingOnly } from 'src/bootstrap/state.js'
import {
  resetSettingsCache,
  setSessionSettingsCache,
} from 'src/utils/settings/settingsCache.js'
import { GROK_MODEL_OPTIONS } from '../grokModels.js'
import { getModelOptions } from '../modelOptions.js'

const envKeys = [
  'USER_TYPE',
  'CLAUDE_CODE_USE_GROK',
  'CLAUDE_CODE_USE_OPENAI',
  'CLAUDE_CODE_USE_GEMINI',
  'OPENAI_AUTH_MODE',
  'ANTHROPIC_CUSTOM_MODEL_OPTION',
] as const

const savedEnv: Record<string, string | undefined> = {}

function resetPickerState(): void {
  resetSettingsCache()
  setSessionSettingsCache({ settings: {}, errors: [] })
  resetModelStringsForTestingOnly()
}

describe('getModelOptions per-provider catalogs', () => {
  beforeEach(() => {
    for (const key of envKeys) {
      savedEnv[key] = process.env[key]
      delete process.env[key]
    }
    resetPickerState()
  })

  afterEach(() => {
    for (const key of envKeys) {
      if (savedEnv[key] !== undefined) {
        process.env[key] = savedEnv[key]
      } else {
        delete process.env[key]
      }
    }
    resetPickerState()
  })

  test('grok provider lists catalogued Grok ids, not Claude family aliases', () => {
    setSessionSettingsCache({
      settings: { modelType: 'grok' },
      errors: [],
    })
    const values = getModelOptions().map(opt => opt.value)
    expect(values[0]).toBeNull()
    for (const row of GROK_MODEL_OPTIONS) {
      expect(values).toContain(row.value)
    }
    expect(values).toContain('grok-4.7')
    expect(values).not.toContain('sonnet')
    expect(values).not.toContain('opus')
    expect(values).not.toContain('haiku')
    expect(values).not.toContain('gpt-5.6-sol')
    expect(values).not.toContain('kimi-k3')
  })

  test('openai API provider lists GPT catalog ids, not Grok', () => {
    setSessionSettingsCache({
      settings: { modelType: 'openai' },
      errors: [],
    })
    const values = getModelOptions().map(opt => opt.value)
    expect(values[0]).toBeNull()
    expect(values).toContain('gpt-5.6-sol')
    expect(values).toContain('gpt-5.5')
    expect(values).not.toContain('grok-4.7')
    expect(values).not.toContain('sonnet')
  })

  test('firstParty does not list leftover vendor catalogs', () => {
    setSessionSettingsCache({
      settings: { modelType: 'anthropic' },
      errors: [],
    })
    const values = getModelOptions().map(opt => opt.value)
    expect(values[0]).toBeNull()
    expect(values).not.toContain('grok-4.7')
    expect(values).not.toContain('gpt-5.6-sol')
    expect(values).not.toContain('kimi-k3')
  })
})
