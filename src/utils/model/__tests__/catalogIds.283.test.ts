import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { resetModelStringsForTestingOnly } from 'src/bootstrap/state.js'
import {
  resetSettingsCache,
  setSessionSettingsCache,
} from 'src/utils/settings/settingsCache.js'
import { ALL_MODEL_CONFIGS } from '../configs.js'
import { lookupEffortCatalog } from '../effortCatalog.js'
import {
  firstPartyNameToCanonical,
  getBestModel,
  getDefaultFableModel,
  getDefaultOpusModel,
  getMarketingNameForModel,
} from '../model.js'
import { resolveCatalogAlias } from '../modelCatalogCapabilities.js'

const envKeys = [
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_OPENAI',
  'CLAUDE_CODE_USE_GEMINI',
  'CLAUDE_CODE_USE_GROK',
  'CLAUDE_CODE_USE_GATEWAY',
  'ANTHROPIC_DEFAULT_FABLE_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
] as const

const savedEnv: Record<string, string | undefined> = {}

function resetProviderState(): void {
  resetSettingsCache()
  setSessionSettingsCache({ settings: {}, errors: [] })
  resetModelStringsForTestingOnly()
}

describe('densable 2.1.283 catalog ids', () => {
  beforeEach(() => {
    for (const key of envKeys) {
      savedEnv[key] = process.env[key]
      delete process.env[key]
    }
    resetProviderState()
  })

  afterEach(() => {
    for (const key of envKeys) {
      if (savedEnv[key] !== undefined) process.env[key] = savedEnv[key]
      else delete process.env[key]
    }
    resetProviderState()
  })

  test('keeps unsuffixed fable-5 / opus-5 and adds 5-1 / 5-5', () => {
    expect(ALL_MODEL_CONFIGS.fable5.firstParty).toBe('claude-fable-5')
    expect(ALL_MODEL_CONFIGS.fable51.firstParty).toBe('claude-fable-5-1')
    expect(ALL_MODEL_CONFIGS.opus5.firstParty).toBe('claude-opus-5')
    expect(ALL_MODEL_CONFIGS.opus55.firstParty).toBe('claude-opus-5-5')
  })

  test('ix() tests 5-1/5-5 before unsuffixed family', () => {
    expect(firstPartyNameToCanonical('claude-fable-5-1')).toBe(
      'claude-fable-5-1',
    )
    expect(firstPartyNameToCanonical('claude-fable-5')).toBe('claude-fable-5')
    expect(firstPartyNameToCanonical('claude-opus-5-5')).toBe('claude-opus-5-5')
    expect(firstPartyNameToCanonical('claude-opus-5')).toBe('claude-opus-5')
  })

  test('firstParty live defaults are fable51 / opus55', () => {
    expect(getDefaultFableModel()).toBe('claude-fable-5-1')
    expect(getDefaultOpusModel()).toBe('claude-opus-5-5')
  })

  test('gateway fable/best still Fable 5 per 283 aliases', () => {
    expect(resolveCatalogAlias('fable', 'gateway')).toBe('claude-fable-5')
    expect(resolveCatalogAlias('fable')).toBe('claude-fable-5-1')
    expect(resolveCatalogAlias('opus')).toBe('claude-opus-5-5')
    expect(resolveCatalogAlias('opus', 'gateway')).toBe('claude-opus-4-7')
  })

  test('best alias is Fable (catalog best:"fable")', () => {
    expect(getBestModel()).toBe('claude-fable-5-1')
  })

  test('effort catalog rows: opus-5-5 default medium, fable-5-1 high', () => {
    expect(lookupEffortCatalog('claude-opus-5-5')?.defaultEffort).toBe('medium')
    expect(lookupEffortCatalog('claude-opus-5')?.defaultEffort).toBe('high')
    expect(lookupEffortCatalog('claude-fable-5-1')?.defaultEffort).toBe('high')
  })

  test('marketing names distinguish 5.5 / 5.1', () => {
    expect(getMarketingNameForModel('claude-opus-5-5')).toBe('Opus 5.5')
    expect(getMarketingNameForModel('claude-opus-5-5[1m]')).toBe(
      'Opus 5.5 (1M context)',
    )
    expect(getMarketingNameForModel('claude-fable-5-1')).toBe('Fable 5.1')
    expect(getMarketingNameForModel('claude-opus-5')).toBe('Opus 5')
    expect(getMarketingNameForModel('claude-fable-5')).toBe('Fable 5')
  })
})
