import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { resetModelStringsForTestingOnly } from 'src/bootstrap/state.js'
import {
  resetSettingsCache,
  setSessionSettingsCache,
} from 'src/utils/settings/settingsCache.js'
import { ALL_MODEL_CONFIGS } from '../configs.js'
import {
  FABLE_DESCRIPTION_FOR_MODEL,
  FABLE_SLOGAN,
  applyPinnedFablePickerValue,
  getCustomFableOption,
  getFable5Option,
  insertFablePickerOption,
  isCustomFamilyModelEnv,
  isFablePickerInsertValue,
  isFablePickerRowValue,
  isSameFablePickerRow,
  maybeInsertFablePickerRow,
  pickerFamilyOf,
  type FablePickerOption,
} from '../fablePicker.js'

/**
 * Official 2.1.239 URa / wyp / W4r / G4r / Iyp / kci / Rci / C0v Fable gates.
 */

const envKeys = [
  'ANTHROPIC_DEFAULT_FABLE_MODEL',
  'ANTHROPIC_DEFAULT_FABLE_MODEL_NAME',
  'ANTHROPIC_DEFAULT_FABLE_MODEL_DESCRIPTION',
  'ANTHROPIC_BASE_URL',
  '_CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL',
] as const

const savedEnv: Record<string, string | undefined> = {}

function resetPickerState(): void {
  resetSettingsCache()
  setSessionSettingsCache({ settings: {}, errors: [] })
  resetModelStringsForTestingOnly()
}

function option(
  value: string | null,
  label = String(value),
): FablePickerOption {
  return { value, label, description: label }
}

describe('fablePicker 239', () => {
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

  describe('URa getFable5Option', () => {
    test('1P-style providers use alias fable and Hyp+Pyp copy', () => {
      const row = getFable5Option('firstParty')
      expect(row.value).toBe('fable')
      expect(row.label).toBe('Fable')
      expect(row.description.startsWith(`Fable 5 · ${FABLE_SLOGAN}`)).toBe(true)
      expect(row.descriptionForModel).toBe(FABLE_DESCRIPTION_FOR_MODEL)
      expect(getFable5Option('anthropicAws').value).toBe('fable')
      expect(getFable5Option('gateway').value).toBe('fable')
    })

    test('true 3P uses catalog fable5 id', () => {
      expect(getFable5Option('bedrock').value).toBe(
        ALL_MODEL_CONFIGS.fable5.bedrock,
      )
      expect(getFable5Option('openai').value).toBe(
        ALL_MODEL_CONFIGS.fable5.openai,
      )
    })

    test('description has no $10/$50 pricing', () => {
      expect(getFable5Option('firstParty').description).not.toMatch(/\$\d+/)
    })
  })

  describe('wyp getCustomFableOption / Rci', () => {
    test('absent on firstParty official API even when env is set', () => {
      process.env.ANTHROPIC_DEFAULT_FABLE_MODEL = 'custom-fable'
      expect(isCustomFamilyModelEnv('firstParty')).toBe(false)
      expect(getCustomFableOption('firstParty')).toBeUndefined()
    })

    test('returns custom row on 3P', () => {
      process.env.ANTHROPIC_DEFAULT_FABLE_MODEL = 'custom-fable'
      process.env.ANTHROPIC_DEFAULT_FABLE_MODEL_NAME = 'My Fable'
      process.env.ANTHROPIC_DEFAULT_FABLE_MODEL_DESCRIPTION = 'Pinned Fable'
      expect(getCustomFableOption('bedrock')).toEqual({
        value: 'fable',
        label: 'My Fable',
        description: 'Pinned Fable',
        descriptionForModel: 'Pinned Fable (custom-fable)',
      })
    })

    test('returns custom row on firstParty when base URL is not official', () => {
      process.env.ANTHROPIC_DEFAULT_FABLE_MODEL = 'custom-fable'
      process.env.ANTHROPIC_BASE_URL = 'https://proxy.example.com'
      expect(isCustomFamilyModelEnv('firstParty')).toBe(true)
      expect(getCustomFableOption('firstParty')).toEqual({
        value: 'fable',
        label: 'custom-fable',
        description: 'Custom Fable model',
        descriptionForModel: 'Custom Fable model (custom-fable)',
      })
    })

    test('returns custom row on anthropicAws', () => {
      process.env.ANTHROPIC_DEFAULT_FABLE_MODEL = 'aws-fable'
      expect(getCustomFableOption('anthropicAws')?.value).toBe('fable')
    })
  })

  describe('W4r insertFablePickerOption', () => {
    const insertDeps = {
      defaultModelSetting: 'sonnet',
      unrestrictedList: true,
    }

    test('non-fable values push', () => {
      const rows = [option(null, 'Default')]
      insertFablePickerOption(rows, option('opus'), insertDeps)
      expect(rows.map(r => r.value)).toEqual([null, 'opus'])
    })

    test('no Default unshifts fable', () => {
      const rows = [option('opus')]
      insertFablePickerOption(rows, getFable5Option('firstParty'), insertDeps)
      expect(rows[0]?.value).toBe('fable')
    })

    test('PAYG 1P-style list inserts after the opus cluster', () => {
      const rows = [
        option(null, 'Default'),
        option('opus'),
        option('claude-opus-4-8'),
        option('sonnet'),
        option('haiku'),
      ]
      insertFablePickerOption(rows, getFable5Option('firstParty'), {
        defaultModelSetting: 'opus',
        unrestrictedList: true,
      })
      expect(rows.map(r => r.value)).toEqual([
        null,
        'opus',
        'claude-opus-4-8',
        'fable',
        'sonnet',
        'haiku',
      ])
    })

    test('3P concrete sonnet after Default + default sonnet skips sonnet cluster', () => {
      const rows = [
        option(null, 'Default'),
        option(ALL_MODEL_CONFIGS.sonnet5.bedrock),
        option(ALL_MODEL_CONFIGS.opus5.bedrock),
        option('haiku'),
      ]
      insertFablePickerOption(rows, getFable5Option('bedrock'), {
        defaultModelSetting: 'sonnet',
        unrestrictedList: true,
      })
      expect(rows.map(r => r.value)).toEqual([
        null,
        ALL_MODEL_CONFIGS.sonnet5.bedrock,
        ALL_MODEL_CONFIGS.fable5.bedrock,
        ALL_MODEL_CONFIGS.opus5.bedrock,
        'haiku',
      ])
    })
  })

  describe('C0v maybeInsertFablePickerRow', () => {
    const insertDeps = {
      defaultModelSetting: 'sonnet',
      unrestrictedList: true,
    }

    test('subscriber lists do not hardcode URa', () => {
      const rows = [option(null, 'Default'), option('opus')]
      maybeInsertFablePickerRow(rows, {
        isSubscriber: true,
        provider: 'firstParty',
        insertDeps,
      })
      expect(rows.some(r => r.label === 'Fable')).toBe(false)
    })

    test('firstParty PAYG does not hardcode URa', () => {
      const rows = [option(null, 'Default'), option('opus')]
      maybeInsertFablePickerRow(rows, {
        isSubscriber: false,
        provider: 'firstParty',
        insertDeps,
      })
      expect(rows.some(r => r.label === 'Fable')).toBe(false)
    })

    test('gateway PAYG does not hardcode URa', () => {
      const rows = [option(null, 'Default'), option('opus')]
      maybeInsertFablePickerRow(rows, {
        isSubscriber: false,
        provider: 'gateway',
        insertDeps,
      })
      expect(rows.some(r => r.label === 'Fable')).toBe(false)
    })

    test('anthropicAws PAYG inserts URa alias', () => {
      const rows = [option(null, 'Default'), option('opus'), option('sonnet')]
      maybeInsertFablePickerRow(rows, {
        isSubscriber: false,
        provider: 'anthropicAws',
        insertDeps: {
          defaultModelSetting: 'opus',
          unrestrictedList: true,
        },
      })
      const fable = rows.find(r => r.label === 'Fable')
      expect(fable?.value).toBe('fable')
      expect(rows.map(r => r.value)).toEqual([null, 'opus', 'fable', 'sonnet'])
    })

    test('true 3P inserts URa with catalog id', () => {
      const rows = [option(null, 'Default'), option('haiku')]
      maybeInsertFablePickerRow(rows, {
        isSubscriber: false,
        provider: 'bedrock',
        insertDeps,
      })
      expect(rows.some(r => r.value === ALL_MODEL_CONFIGS.fable5.bedrock)).toBe(
        true,
      )
    })

    test('3P custom env wins over URa', () => {
      process.env.ANTHROPIC_DEFAULT_FABLE_MODEL = 'my-fable'
      const rows = [option(null, 'Default'), option('haiku')]
      maybeInsertFablePickerRow(rows, {
        isSubscriber: false,
        provider: 'bedrock',
        insertDeps,
      })
      const fable = rows.find(r => r.value === 'fable')
      expect(fable?.description).toBe('Custom Fable model')
      expect(rows.some(r => r.value === ALL_MODEL_CONFIGS.fable5.bedrock)).toBe(
        false,
      )
    })
  })

  describe('I0v applyPinnedFablePickerValue', () => {
    const insertDeps = {
      defaultModelSetting: 'sonnet',
      unrestrictedList: true,
    }

    test('rewrites an Iyp-same row to the pinned value', () => {
      const rows = [
        option(null, 'Default'),
        {
          value: 'fable',
          label: 'Fable',
          description: `Fable 5 · ${FABLE_SLOGAN}`,
        },
        option('haiku'),
      ]
      applyPinnedFablePickerValue(rows, 'fable[1m]', {
        ...insertDeps,
        provider: 'firstParty',
      })
      expect(rows.map(r => r.value)).toEqual([null, 'fable[1m]', 'haiku'])
      expect(rows[1]?.label).toBe('Fable')
    })

    test('inserts URa copy with pinned value when no fable row exists', () => {
      const rows = [option(null, 'Default'), option('opus'), option('haiku')]
      applyPinnedFablePickerValue(rows, 'claude-fable-5', {
        defaultModelSetting: 'opus',
        unrestrictedList: true,
        provider: 'firstParty',
      })
      const fable = rows.find(r => r.value === 'claude-fable-5')
      expect(fable?.label).toBe('Fable')
      expect(fable?.description.startsWith(`Fable 5 · ${FABLE_SLOGAN}`)).toBe(
        true,
      )
      expect(rows.map(r => r.value)).toEqual([
        null,
        'opus',
        'claude-fable-5',
        'haiku',
      ])
    })
  })

  describe('G4r / Iyp / kci', () => {
    test('Iyp matches fable aliases and claude-fable-5 ids', () => {
      expect(isFablePickerRowValue('fable')).toBe(true)
      expect(isFablePickerRowValue('fable[1m]')).toBe(true)
      expect(isFablePickerRowValue('claude-fable-5')).toBe(true)
      expect(isFablePickerRowValue('us.anthropic.claude-fable-5')).toBe(true)
      expect(isFablePickerRowValue('opus')).toBe(false)
    })

    test('G4r uses fht includes, which is wider than Iyp', () => {
      expect(isFablePickerInsertValue('prefix-claude-fable-5-extra')).toBe(true)
      expect(isFablePickerRowValue('prefix-claude-fable-5-extra')).toBe(false)
      expect(isFablePickerInsertValue('opus')).toBe(false)
    })

    test('z4r Iyp treats alias and catalog id as the same row', () => {
      expect(
        isSameFablePickerRow({ value: 'fable' }, { value: 'claude-fable-5' }),
      ).toBe(true)
      expect(isSameFablePickerRow({ value: 'opus' }, { value: 'fable' })).toBe(
        false,
      )
    })

    test('kci maps family tokens', () => {
      expect(pickerFamilyOf('claude-fable-5')).toBe('fable')
      expect(pickerFamilyOf('opus[1m]')).toBe('opus')
      expect(pickerFamilyOf('best')).toBe(null)
    })
  })
})
