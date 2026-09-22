/**
 * Official 2.1.239 L4 leftover on the local print/SDK host:
 * family alias fable steps via XNn (getDefaultFableModel), not the haiku else.
 * Suggestion candidates include official qOe fable / fable[1m].
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { resetModelStringsForTestingOnly } from 'src/bootstrap/state.js'
import {
  resetSettingsCache,
  setSessionSettingsCache,
} from 'src/utils/settings/settingsCache.js'
import { ALL_MODEL_CONFIGS } from '../configs.js'
import { getDefaultFableModel } from '../model.js'
import {
  decidePrintSetModel,
  recognizePrintModel,
  stepFamilyAliasToAllowed,
  unrecognizedModelMessage,
} from '../printSetModel.js'

const envKeys = [
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_OPENAI',
  'CLAUDE_CODE_USE_GEMINI',
  'CLAUDE_CODE_USE_GROK',
  'CLAUDE_CODE_USE_GATEWAY',
  'ANTHROPIC_DEFAULT_FABLE_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_BASE_URL',
  '_CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL',
] as const

const savedEnv: Record<string, string | undefined> = {}

function resetProviderState(): void {
  for (const key of envKeys) {
    delete process.env[key]
  }
  resetSettingsCache()
  // Empty cache blocks disk modelType (e.g. grok) without pinning anthropic
  // for co-suites that intentionally exercise third-party providers.
  setSessionSettingsCache({ settings: {}, errors: [] })
  resetModelStringsForTestingOnly()
}

beforeEach(() => {
  for (const key of envKeys) {
    savedEnv[key] = process.env[key]
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

describe('printSetModel 239 fable leftover', () => {
  test('stepFamilyAliasToAllowed(fable) uses XNn, not haiku', () => {
    expect(stepFamilyAliasToAllowed('fable')).toBe(getDefaultFableModel())
    expect(stepFamilyAliasToAllowed('fable')).toBe(
      ALL_MODEL_CONFIGS.fable5.firstParty,
    )
    expect(stepFamilyAliasToAllowed('fable')?.includes('haiku')).toBe(false)
  })

  test('fable[1m] never steps to haiku', () => {
    const stepped = stepFamilyAliasToAllowed('fable[1m]')
    expect(stepped?.includes('haiku') ?? false).toBe(false)
  })

  test('haiku still maps to the haiku default', () => {
    const stepped = stepFamilyAliasToAllowed('haiku')
    expect(stepped).toBeTruthy()
    expect(stepped?.toLowerCase()).toContain('haiku')
  })

  test('print set_model recognizes fable', () => {
    expect(recognizePrintModel('fable').recognized).toBe(true)
    const d = decidePrintSetModel('fable', undefined)
    expect(d.ok).toBe(true)
    if (!d.ok) return
    expect(d.model.toLowerCase()).toContain('fable')
  })

  test('unrecognized fab suggests fable', () => {
    expect(unrecognizedModelMessage('fab', 'fable')).toBe(
      'Model "fab" is not a recognized model id. Did you mean \'fable\'?',
    )
  })
})
