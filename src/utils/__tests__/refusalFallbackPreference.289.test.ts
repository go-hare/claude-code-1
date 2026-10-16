/**
 * densable 2.1.289 Ba / qa / Efn / U1e — refusal-fallback preference ask.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  REFUSAL_PREFERENCE_CATEGORY_COPY,
  SWITCH_MODELS_ON_FLAG_LABELS,
  TENG_JAZZY_GOBLET,
  coerceSwitchModelsOnFlagConfigInput,
  formatSwitchModelsOnFlagConfigValue,
  refusalFallbackPreferenceLead,
} from '../refusalFallback.js'

const root = join(import.meta.dir, '../../..')

describe('densable 2.1.289 refusal_fallback_preference', () => {
  test('B9 labels', () => {
    expect(SWITCH_MODELS_ON_FLAG_LABELS.switchAutomatically).toBe(
      'Switch automatically',
    )
    expect(SWITCH_MODELS_ON_FLAG_LABELS.askEachTime).toBe('Ask each time')
    expect(SWITCH_MODELS_ON_FLAG_LABELS.notAskedYet).toBe('Not asked yet')
  })

  test('Xft gate name', () => {
    expect(TENG_JAZZY_GOBLET).toBe('tengu_jazzy_goblet')
  })

  test('U1e / E7 / k7 lead copy', () => {
    expect(refusalFallbackPreferenceLead('Opus', 'opus', null)).toBe(
      "Opus's safeguards flagged this message. This sometimes happens with safe, normal conversations.",
    )
    expect(refusalFallbackPreferenceLead('Opus', 'opus', 'cyber')).toContain(
      REFUSAL_PREFERENCE_CATEGORY_COPY.cyber,
    )
    expect(refusalFallbackPreferenceLead('Opus', 'opus', 'bio')).toContain(
      REFUSAL_PREFERENCE_CATEGORY_COPY.bio,
    )
  })

  test('ro / coerce B9 config labels', () => {
    expect(formatSwitchModelsOnFlagConfigValue(true)).toBe(
      SWITCH_MODELS_ON_FLAG_LABELS.switchAutomatically,
    )
    expect(formatSwitchModelsOnFlagConfigValue(false)).toBe(
      SWITCH_MODELS_ON_FLAG_LABELS.askEachTime,
    )
    expect(coerceSwitchModelsOnFlagConfigInput('true')).toBe(
      SWITCH_MODELS_ON_FLAG_LABELS.switchAutomatically,
    )
    expect(coerceSwitchModelsOnFlagConfigInput('Ask each time')).toBe(
      SWITCH_MODELS_ON_FLAG_LABELS.askEachTime,
    )
    expect(coerceSwitchModelsOnFlagConfigInput('nope')).toBeUndefined()
  })

  test('source-lock Ba / qa / Efn / query ke', () => {
    const refusal = readFileSync(
      join(root, 'src/utils/refusalFallback.ts'),
      'utf8',
    )
    expect(refusal).toContain("source: 'refusal_fallback_preference'")
    expect(refusal).toContain("header: 'Model switch'")
    expect(refusal).toContain("via: 'first_flag_prompt'")
    expect(refusal).toContain('preferenceQuestionPending')
    expect(refusal).toContain('shouldAskRefusalFallbackPreference')
    expect(refusal).toContain('askRefusalFallbackPreference')

    const query = readFileSync(join(root, 'src/query.ts'), 'utf8')
    expect(query).toContain('refusalFallbackPreferencePending')
    expect(query).toContain('askRefusalFallbackPreference')
    expect(query).toContain('refusal-fallback-edit')

    const claude = readFileSync(
      join(root, 'src/services/api/claude.ts'),
      'utf8',
    )
    expect(claude).toContain('refusalFallbackPreferencePending')
    expect(claude).toContain('skip FXl')

    const config = readFileSync(
      join(root, 'src/components/Settings/Config.tsx'),
      'utf8',
    )
    expect(config).toContain('formatSwitchModelsOnFlagConfigValue')
    expect(config).toContain('coerceSwitchModelsOnFlagConfigInput')
    expect(config).toContain(
      "persistSwitchModelsOnFlag(enabled, 'config', storageV5)",
    )
    expect(config).toContain('pickToCommit: true')
  })
})
