import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { resetModelStringsForTestingOnly } from 'src/bootstrap/state.js'
import {
  resetSettingsCache,
  setSessionSettingsCache,
} from 'src/utils/settings/settingsCache.js'
import { resolveCatalogFamilyModelString } from '../catalogFamilyDefault.js'
import { ALL_MODEL_CONFIGS } from '../configs.js'
import { getAgentModelOptions } from '../agent.js'
import { getModelStrings } from '../modelStrings.js'

describe('resolveCatalogFamilyModelString (official SZo)', () => {
  beforeEach(() => {
    resetSettingsCache()
    setSessionSettingsCache({ settings: {}, errors: [] })
    resetModelStringsForTestingOnly()
  })

  afterEach(() => {
    resetSettingsCache()
    resetModelStringsForTestingOnly()
  })

  test('fable maps to modelStrings.fable5', () => {
    const strings = getModelStrings()
    expect(
      resolveCatalogFamilyModelString('fable', strings, 'firstParty'),
    ).toBe(strings.fable5)
    expect(strings.fable5).toBe(ALL_MODEL_CONFIGS.fable5.firstParty)
  })

  test('fable on bedrock uses fable5 bedrock id', () => {
    const strings = getModelStrings()
    // SZo reads t[i] from the strings object passed in (already provider-resolved)
    const bedrockStrings = {
      ...strings,
      fable5: ALL_MODEL_CONFIGS.fable5.bedrock,
    }
    expect(
      resolveCatalogFamilyModelString('fable', bedrockStrings, 'bedrock'),
    ).toBe(ALL_MODEL_CONFIGS.fable5.bedrock)
  })

  test('unknown alias is undefined (Ema falls through to e.fable5)', () => {
    expect(
      resolveCatalogFamilyModelString('nope', getModelStrings(), 'firstParty'),
    ).toBeUndefined()
  })
})

describe('getAgentModelOptions Que', () => {
  test('includes official Que fable before inherit', () => {
    const values = getAgentModelOptions().map(o => o.value)
    expect(values).toEqual(['sonnet', 'opus', 'haiku', 'fable', 'inherit'])
    expect(getAgentModelOptions().find(o => o.value === 'fable')).toEqual({
      value: 'fable',
      label: 'Fable',
      description:
        'Fable 5 - most capable for your hardest and longest-running tasks',
    })
  })
})
