import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { resetModelStringsForTestingOnly } from 'src/bootstrap/state.js'
import {
  resetSettingsCache,
  setSessionSettingsCache,
} from 'src/utils/settings/settingsCache.js'
import { ALL_MODEL_CONFIGS } from '../configs.js'
import { getDefaultFableModel, parseUserSpecifiedModel } from '../model.js'

/**
 * Official 2.1.239 XNn / Ema / parseUserSpecifiedModel case"fable":
 *   ANTHROPIC_DEFAULT_FABLE_MODEL ?? claude-fable-5
 *   UV (firstParty + official API): strip [1m]
 *   alias fable[1m] appends [1m] only when !UV && default has no [1m]
 */

const envKeys = [
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_OPENAI',
  'CLAUDE_CODE_USE_GEMINI',
  'CLAUDE_CODE_USE_GROK',
  'CLAUDE_CODE_USE_GATEWAY',
  'ANTHROPIC_DEFAULT_FABLE_MODEL',
  'ANTHROPIC_BASE_URL',
  '_CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL',
] as const

const savedEnv: Record<string, string | undefined> = {}

function resetProviderState(): void {
  resetSettingsCache()
  setSessionSettingsCache({ settings: {}, errors: [] })
  resetModelStringsForTestingOnly()
}

describe('getDefaultFableModel', () => {
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

  test('returns claude-fable-5 on firstParty', () => {
    expect(getDefaultFableModel()).toBe(ALL_MODEL_CONFIGS.fable5.firstParty)
  })

  test('returns bedrock fable5 id on 3P (Ema e.fable5)', () => {
    process.env.CLAUDE_CODE_USE_BEDROCK = '1'
    expect(getDefaultFableModel()).toBe(ALL_MODEL_CONFIGS.fable5.bedrock)
  })

  test('honors ANTHROPIC_DEFAULT_FABLE_MODEL', () => {
    process.env.ANTHROPIC_DEFAULT_FABLE_MODEL = 'custom-fable'
    expect(getDefaultFableModel()).toBe('custom-fable')
  })

  test('strips [1m] from env override on firstParty official API', () => {
    process.env.ANTHROPIC_DEFAULT_FABLE_MODEL = 'custom-fable[1m]'
    expect(getDefaultFableModel()).toBe('custom-fable')
  })

  test('keeps [1m] on env override when not firstParty official API', () => {
    process.env.CLAUDE_CODE_USE_BEDROCK = '1'
    process.env.ANTHROPIC_DEFAULT_FABLE_MODEL = 'custom-fable[1m]'
    expect(getDefaultFableModel()).toBe('custom-fable[1m]')
  })
})

describe('parseUserSpecifiedModel fable', () => {
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

  test('fable resolves to default fable model', () => {
    expect(parseUserSpecifiedModel('fable')).toBe('claude-fable-5')
  })

  test('fable[1m] does not append [1m] on firstParty official API', () => {
    expect(parseUserSpecifiedModel('fable[1m]')).toBe('claude-fable-5')
  })

  test('fable[1m] appends [1m] on 3P', () => {
    process.env.CLAUDE_CODE_USE_BEDROCK = '1'
    expect(parseUserSpecifiedModel('fable[1m]')).toBe(
      `${ALL_MODEL_CONFIGS.fable5.bedrock}[1m]`,
    )
  })
})
