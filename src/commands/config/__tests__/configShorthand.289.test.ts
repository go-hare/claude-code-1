/**
 * densable 2.1.289 n0t / Ge / ye / uo / B9 /config key=value.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  booleanOfInput,
  isFalsyInput,
  isTruthyInput,
} from '../../../utils/booleanOfInput.js'
import { SWITCH_MODELS_ON_FLAG_LABELS } from '../../../utils/refusalFallback.js'
import {
  applyConfigSetting,
  findConfigSetting,
  formatConfigShorthandResult,
  formatConfigShorthandUsage,
  isConfigHelpOrListToken,
  parseConfigKeyValueArgs,
  type ConfigSettingRow,
} from '../configShorthand.js'

const root = join(import.meta.dir, '../../../..')

describe('densable 2.1.289 booleanOfInput Le/Ss', () => {
  test('Le / Ss / booleanOfInput', () => {
    expect(isTruthyInput('true')).toBe(true)
    expect(isTruthyInput('1')).toBe(true)
    expect(isTruthyInput('yes')).toBe(true)
    expect(isTruthyInput('on')).toBe(true)
    expect(isFalsyInput('false')).toBe(true)
    expect(isFalsyInput('0')).toBe(true)
    expect(isFalsyInput('no')).toBe(true)
    expect(isFalsyInput('off')).toBe(true)
    expect(booleanOfInput('true')).toBe(true)
    expect(booleanOfInput('false')).toBe(false)
    expect(booleanOfInput('nope')).toBeUndefined()
    expect(booleanOfInput('')).toBeUndefined()
  })
})

describe('densable 2.1.289 n0t / Ge / uo', () => {
  test('n0t one pair allows spaces in the value', () => {
    expect(parseConfigKeyValueArgs('switchModelsOnFlag=Ask each time')).toEqual(
      [{ key: 'switchModelsOnFlag', raw: 'Ask each time' }],
    )
  })

  test('n0t multiple pairs require each token to contain =', () => {
    expect(parseConfigKeyValueArgs('a=1 b=2')).toEqual([
      { key: 'a', raw: '1' },
      { key: 'b', raw: '2' },
    ])
    expect(parseConfigKeyValueArgs('a=1 nope')).toEqual([
      { key: 'a', raw: '1 nope' },
    ])
    expect(parseConfigKeyValueArgs('help')).toBeNull()
  })

  test('help / list tokens', () => {
    expect(isConfigHelpOrListToken('help')).toBe(true)
    expect(isConfigHelpOrListToken('--help')).toBe(true)
    expect(isConfigHelpOrListToken('list')).toBe(true)
    expect(isConfigHelpOrListToken('switchModelsOnFlag=true')).toBe(false)
  })

  test('Ge exact id then unique case-insensitive', () => {
    const rows: ConfigSettingRow[] = [
      {
        id: 'tips',
        label: 'Show tips',
        type: 'boolean',
        value: true,
        onChange: () => undefined,
      },
      {
        id: 'TipsExtra',
        label: 'Other',
        type: 'boolean',
        value: false,
        onChange: () => undefined,
      },
    ]
    expect(findConfigSetting('tips', rows)?.id).toBe('tips')
    expect(findConfigSetting('TIPS', rows)?.id).toBe('tips')
    expect(findConfigSetting('missing', rows)).toBeUndefined()
  })

  test('uo enum coerce B9 + usage omits consentGated', async () => {
    const rows: ConfigSettingRow[] = [
      {
        id: 'switchModelsOnFlag',
        label: 'Switch models when a message is flagged',
        type: 'enum',
        value: SWITCH_MODELS_ON_FLAG_LABELS.switchAutomatically,
        options: [
          SWITCH_MODELS_ON_FLAG_LABELS.switchAutomatically,
          SWITCH_MODELS_ON_FLAG_LABELS.askEachTime,
        ],
        coerce: raw => {
          const o = raw.trim().toLowerCase()
          if (o === 'true' || o === 'switch automatically') {
            return SWITCH_MODELS_ON_FLAG_LABELS.switchAutomatically
          }
          if (o === 'false' || o === 'ask each time') {
            return SWITCH_MODELS_ON_FLAG_LABELS.askEachTime
          }
          return undefined
        },
        onChange: () => undefined,
      },
      {
        id: 'gated',
        label: 'Gated',
        type: 'boolean',
        value: true,
        consentGated: true,
        onChange: () => undefined,
      },
    ]
    const set = await applyConfigSetting('switchModelsOnFlag', 'false', rows)
    expect(set.ok).toBe(true)
    expect(set.message).toContain('Ask each time')
    const missing = await applyConfigSetting('nope', 'true', rows)
    expect(missing.ok).toBe(false)
    expect(missing.message).toContain("isn't a /config setting")
    const usage = formatConfigShorthandUsage(rows)
    expect(usage).toContain('switchModelsOnFlag=')
    expect(usage).not.toContain('gated=')
  })

  test('Nat withholds save-failure off-box', () => {
    expect(
      formatConfigShorthandResult(
        {
          ok: false,
          kind: 'save-failure',
          message: "Couldn't save tips: disk",
        },
        true,
      ),
    ).toBe("Couldn't save this setting (detail withheld on this connection).")
    expect(
      formatConfigShorthandResult(
        { ok: false, kind: 'refusal', message: 'nope' },
        true,
      ),
    ).toBe('nope')
  })

  test('source-lock Gje / n0t / B9 coerce host', () => {
    const shorthand = readFileSync(
      join(root, 'src/commands/config/configShorthand.ts'),
      'utf8',
    )
    expect(shorthand).toContain("isn't a /config setting")
    expect(shorthand).toContain("can't be enabled with key=value")
    expect(shorthand).toContain('tengu_config_shorthand')
    const index = readFileSync(
      join(root, 'src/commands/config/index.ts'),
      'utf8',
    )
    expect(index).toContain('configNonInteractive')
    expect(index).toContain("description: 'Set a setting by key'")
    expect(index).toContain('getArgumentCompletions')
    const jsx = readFileSync(
      join(root, 'src/commands/config/config.tsx'),
      'utf8',
    )
    expect(jsx).toContain('applyConfigShorthandFromArgs')
    expect(jsx).toContain('isConfigHelpOrListToken')
    const configUi = readFileSync(
      join(root, 'src/components/Settings/Config.tsx'),
      'utf8',
    )
    expect(configUi).toContain('export function hKe')
    expect(configUi).toContain('export function weConfigPluginRows')
    expect(configUi).toContain('export function ceFromCommandContext')
    expect(configUi).toContain("id: 'autoCompact'")
    expect(configUi).toContain("id: 'tips'")
    expect(shorthand).toContain('hKe(ceFromCommandContext(context))')
    expect(shorthand).toContain('weConfigPluginRows')
    expect(shorthand).not.toContain('coreSwitchModelsOnFlagRow')
  })
})
