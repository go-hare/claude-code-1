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

  test('fable maps to modelStrings.fable51 (densable 2.1.283)', () => {
    const strings = getModelStrings()
    expect(
      resolveCatalogFamilyModelString('fable', strings, 'firstParty'),
    ).toBe(strings.fable51)
    expect(strings.fable51).toBe(ALL_MODEL_CONFIGS.fable51.firstParty)
  })

  test('fable on gateway uses fable5 (283 aliases.per_provider)', () => {
    const strings = getModelStrings()
    const gatewayStrings = {
      ...strings,
      fable5: ALL_MODEL_CONFIGS.fable5.gateway,
    }
    expect(
      resolveCatalogFamilyModelString('fable', gatewayStrings, 'gateway'),
    ).toBe(ALL_MODEL_CONFIGS.fable5.gateway)
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
