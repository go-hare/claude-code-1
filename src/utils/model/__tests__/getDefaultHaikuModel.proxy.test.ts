import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { resetModelStringsForTestingOnly } from 'src/bootstrap/state.js'
import {
  resetSettingsCache,
  setSessionSettingsCache,
} from 'src/utils/settings/settingsCache.js'
import {
  getDefaultHaikuModel,
  getDefaultOpusModel,
  getDefaultSonnetModel,
  getSmallFastModel,
} from '../model.js'
import { getModelStrings } from '../modelStrings.js'

const envKeys = [
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_OPENAI',
  'CLAUDE_CODE_USE_GEMINI',
  'CLAUDE_CODE_USE_GROK',
  'CLAUDE_CODE_USE_GATEWAY',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_BASE_URL',
  '_CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL',
] as const

const savedEnv: Record<string, string | undefined> = {}

function resetProviderState(): void {
  resetSettingsCache()
  setSessionSettingsCache({ settings: {}, errors: [] })
  resetModelStringsForTestingOnly()
}

describe('getDefaultHaikuModel custom host', () => {
  beforeEach(() => {
    for (const key of envKeys) {
      savedEnv[key] = process.env[key]
      delete process.env[key]
    }
    resetProviderState()
  })

  afterEach(() => {
    for (const key of envKeys) {
      if (savedEnv[key] !== undefined) {
        process.env[key] = savedEnv[key]
      } else {
        delete process.env[key]
      }
    }
    resetProviderState()
  })

  test('official Anthropic host keeps catalog haiku', () => {
    expect(getDefaultHaikuModel()).toBe(getModelStrings().haiku45)
  })

  test('custom ANTHROPIC_BASE_URL uses the user-specified model', () => {
    process.env.ANTHROPIC_BASE_URL = 'https://proxy.example/v1'
    process.env.ANTHROPIC_MODEL = 'my-proxy-sonnet'
    expect(getDefaultHaikuModel()).toBe('my-proxy-sonnet')
  })

  test('custom host ignores Claude-family ANTHROPIC_DEFAULT_HAIKU_MODEL', () => {
    process.env.ANTHROPIC_BASE_URL = 'http://127.0.0.1:15721'
    process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL = 'claude-haiku-4-5'
    process.env.ANTHROPIC_MODEL = 'grok-4.6'
    expect(getDefaultHaikuModel()).toBe('grok-4.6')
    expect(getSmallFastModel()).toBe('grok-4.6')
  })

  test('custom host remaps Claude-family sonnet/opus env to the user model', () => {
    process.env.ANTHROPIC_BASE_URL = 'http://127.0.0.1:15721'
    process.env.ANTHROPIC_DEFAULT_SONNET_MODEL = 'claude-sonnet-5'
    process.env.ANTHROPIC_DEFAULT_OPUS_MODEL = 'claude-opus-5'
    process.env.ANTHROPIC_MODEL = 'grok-4.6'
    expect(getDefaultSonnetModel()).toBe('grok-4.6')
    expect(getDefaultOpusModel()).toBe('grok-4.6')
  })

  test('official host keeps ANTHROPIC_DEFAULT_HAIKU_MODEL', () => {
    process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL = 'claude-haiku-4-5'
    expect(getDefaultHaikuModel()).toBe('claude-haiku-4-5')
  })

  test('custom host keeps a non-Claude ANTHROPIC_DEFAULT_HAIKU_MODEL', () => {
    process.env.ANTHROPIC_BASE_URL = 'https://api.x.ai/v1'
    process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL = 'grok-4.5'
    process.env.ANTHROPIC_MODEL = 'grok-4.6'
    expect(getDefaultHaikuModel()).toBe('grok-4.5')
  })
})
