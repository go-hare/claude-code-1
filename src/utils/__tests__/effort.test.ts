import {
  afterAll,
  describe,
  expect,
  test,
  beforeEach,
  afterEach,
  mock,
} from 'bun:test'
import * as realSettings from 'src/utils/settings/settings.js'
import * as realThinking from 'src/utils/thinking.js'
import {
  createSettingsMock,
  restoreSettingsMockWith,
  snapshotModuleExports,
} from '../../../tests/mocks/settings.js'

// Snapshot BEFORE mock.module — live namespace rebinds under Bun mock.module,
// so afterAll `() => realSettings` would restore the mock, not the real module.
const settingsSnap = snapshotModuleExports(realSettings)
const thinkingSnap = snapshotModuleExports(realThinking)

// Mock heavy dependencies to avoid import chain issues.
mock.module('src/utils/thinking.js', () => ({
  ...thinkingSnap,
  isUltrathinkEnabled: () => false,
}))
mock.module(
  'src/utils/settings/settings.js',
  createSettingsMock(settingsSnap, {
    getInitialSettings: () => ({}),
    getSettingsForSource: () => ({}),
  }),
)
mock.module('src/utils/auth.js', () => ({
  isProSubscriber: () => false,
  isMaxSubscriber: () => false,
  isTeamSubscriber: () => false,
}))
mock.module('src/services/analytics/growthbook.js', () => ({
  getFeatureValue_CACHED_MAY_BE_STALE: (_key: string, defaultValue: unknown) =>
    defaultValue ?? {},
}))
mock.module('src/utils/model/modelSupportOverrides.js', () => ({
  get3PModelCapabilityOverride: () => undefined,
}))

afterAll(() => {
  restoreSettingsMockWith(mock.module, settingsSnap)
  mock.module('src/utils/thinking.js', () => ({ ...thinkingSnap }))
})

const {
  isEffortLevel,
  parseEffortValue,
  parseEffortLevelString,
  parseCliEffortArg,
  isValidNumericEffort,
  convertEffortValueToLevel,
  getEffortLevelDescription,
  getEffortSuffix,
  shouldShowEffortUI,
  resolvePickerEffortPersistence,
  modelSupportsEffort,
  modelSupportsMaxEffort,
  modelSupportsXhighEffort,
  getSupportedEffortLevels,
  getDefaultEffortForModel,
  getUltracodeEffortForModel,
  isUltracodeModeActive,
  isUltracodeOfferable,
  isUltracodeEffortAlias,
  resolveBootstrapEffortValue,
  resolveBootstrapUltracodeFlag,
  resolveAppliedEffort,
  clampEffortForModel,
  unpinAllEffortLaunchPins,
  EFFORT_LEVELS,
} = await import('src/utils/effort.js')
const {
  isEffortLaunchPinned,
  resetEffortLaunchPinsForTests,
  clampEffortToOrgLimit,
  getOrgMaxEffortLevel,
  filterEffortLevelsByOrgLimit,
} = await import('src/utils/model/effortCatalog.js')

// densable S8t positive path needs injectable modelAccessCache + firstParty.
// Snapshot real config before mock so co-suites keep saveGlobalConfig.
import * as realConfig from 'src/utils/config.js'
const configSnap = snapshotModuleExports(realConfig)
const realGetGlobalConfig =
  configSnap.getGlobalConfig as typeof realConfig.getGlobalConfig

let modelAccessCacheOverride:
  | Array<{
      apiName: string
      entitled: boolean
      maxEffortLevel?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
    }>
  | undefined

function configMock() {
  return {
    ...configSnap,
    getGlobalConfig: () => {
      const base = realGetGlobalConfig()
      if (modelAccessCacheOverride === undefined) {
        return base
      }
      return {
        ...base,
        modelAccessCache: modelAccessCacheOverride,
      }
    },
  }
}
mock.module('src/utils/config.js', configMock)
// effortCatalog requires('../config.js') relative path
mock.module('../config.js', configMock)
afterAll(() => {
  mock.module('src/utils/config.js', () => ({ ...configSnap }))
  mock.module('../config.js', () => ({ ...configSnap }))
})

// ─── EFFORT_LEVELS constant ────────────────────────────────────────────

describe('EFFORT_LEVELS', () => {
  test('contains the five canonical levels', () => {
    expect(EFFORT_LEVELS).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
  })
})

// ─── isEffortLevel ─────────────────────────────────────────────────────

describe('isEffortLevel', () => {
  test("returns true for 'low'", () => {
    expect(isEffortLevel('low')).toBe(true)
  })

  test("returns true for 'medium'", () => {
    expect(isEffortLevel('medium')).toBe(true)
  })

  test("returns true for 'high'", () => {
    expect(isEffortLevel('high')).toBe(true)
  })

  test("returns true for 'max'", () => {
    expect(isEffortLevel('max')).toBe(true)
  })

  test("returns false for 'invalid'", () => {
    expect(isEffortLevel('invalid')).toBe(false)
  })

  test('returns false for empty string', () => {
    expect(isEffortLevel('')).toBe(false)
  })
})

// ─── parseEffortValue ──────────────────────────────────────────────────

describe('parseEffortValue', () => {
  test('returns undefined for undefined', () => {
    expect(parseEffortValue(undefined)).toBeUndefined()
  })

  test('returns undefined for null', () => {
    expect(parseEffortValue(null)).toBeUndefined()
  })

  test('returns undefined for empty string', () => {
    expect(parseEffortValue('')).toBeUndefined()
  })

  test('returns number for integer input', () => {
    expect(parseEffortValue(42)).toBe(42)
  })

  test('returns string for valid effort level string', () => {
    expect(parseEffortValue('low')).toBe('low')
    expect(parseEffortValue('medium')).toBe('medium')
    expect(parseEffortValue('high')).toBe('high')
    expect(parseEffortValue('max')).toBe('max')
  })

  test('parses numeric string to number', () => {
    expect(parseEffortValue('42')).toBe(42)
  })

  test('returns undefined for invalid string', () => {
    expect(parseEffortValue('invalid')).toBeUndefined()
  })

  test('non-integer number falls through to string parsing (parseInt truncates)', () => {
    // 3.14 fails isValidNumericEffort, then String(3.14) -> "3.14" -> parseInt = 3
    expect(parseEffortValue(3.14)).toBe(3)
  })

  test('handles case-insensitive effort level strings', () => {
    expect(parseEffortValue('LOW')).toBe('low')
    expect(parseEffortValue('HIGH')).toBe('high')
  })

  // densable qlc: med → medium
  test('aliases densable med → medium', () => {
    expect(parseEffortValue('med')).toBe('medium')
    expect(parseEffortValue('MED')).toBe('medium')
    expect(parseEffortValue(' Med ')).toBe('medium')
  })
})

// ─── parseEffortLevelString / parseCliEffortArg (ZSt / YBn) ────────────

describe('parseEffortLevelString', () => {
  test('accepts canonical levels and med alias', () => {
    expect(parseEffortLevelString('high')).toBe('high')
    expect(parseEffortLevelString('med')).toBe('medium')
    expect(parseEffortLevelString('xhigh')).toBe('xhigh')
  })
  test('rejects ultracode and garbage', () => {
    expect(parseEffortLevelString('ultracode')).toBeUndefined()
    expect(parseEffortLevelString('nope')).toBeUndefined()
  })
})

describe('parseCliEffortArg (densable YBn)', () => {
  test('known level → level, no warning', () => {
    expect(parseCliEffortArg('high')).toEqual({
      level: 'high',
      warning: undefined,
    })
    expect(parseCliEffortArg('med')).toEqual({
      level: 'medium',
      warning: undefined,
    })
  })
  test('ultracode alias → level ultracode, no warning', () => {
    expect(parseCliEffortArg('ultracode')).toEqual({
      level: 'ultracode',
      warning: undefined,
    })
  })
  test('unknown → warning + undefined level (soft-ignore)', () => {
    const r = parseCliEffortArg('turbo')
    expect(r.level).toBeUndefined()
    expect(r.warning).toContain("Unknown --effort value 'turbo'")
    expect(r.warning).toContain('low, medium, high, xhigh, max')
    // densable YBn Valid values = cH only — ultracode is XLr alias, not listed
    expect(r.warning).not.toContain('ultracode')
  })
})

// ─── isValidNumericEffort ──────────────────────────────────────────────

describe('isValidNumericEffort', () => {
  test('returns true for integer', () => {
    expect(isValidNumericEffort(50)).toBe(true)
  })

  test('returns true for zero', () => {
    expect(isValidNumericEffort(0)).toBe(true)
  })

  test('returns true for negative integer', () => {
    expect(isValidNumericEffort(-1)).toBe(true)
  })

  test('returns false for float', () => {
    expect(isValidNumericEffort(3.14)).toBe(false)
  })

  test('returns false for NaN', () => {
    expect(isValidNumericEffort(NaN)).toBe(false)
  })

  test('returns false for Infinity', () => {
    expect(isValidNumericEffort(Infinity)).toBe(false)
  })
})

// ─── convertEffortValueToLevel ─────────────────────────────────────────

describe('convertEffortValueToLevel', () => {
  test('returns valid effort level string as-is', () => {
    expect(convertEffortValueToLevel('low')).toBe('low')
    expect(convertEffortValueToLevel('medium')).toBe('medium')
    expect(convertEffortValueToLevel('high')).toBe('high')
    expect(convertEffortValueToLevel('max')).toBe('max')
  })

  test("returns 'high' for unknown string", () => {
    expect(convertEffortValueToLevel('unknown' as any)).toBe('high')
  })

  test("non-ant numeric value returns 'high'", () => {
    const saved = process.env.USER_TYPE
    delete process.env.USER_TYPE

    expect(convertEffortValueToLevel(50)).toBe('high')
    expect(convertEffortValueToLevel(100)).toBe('high')

    process.env.USER_TYPE = saved
  })

  describe('ant numeric mapping', () => {
    let savedUserType: string | undefined

    beforeEach(() => {
      savedUserType = process.env.USER_TYPE
      process.env.USER_TYPE = 'ant'
    })

    afterEach(() => {
      if (savedUserType === undefined) {
        delete process.env.USER_TYPE
      } else {
        process.env.USER_TYPE = savedUserType
      }
    })

    test("value <= 50 maps to 'low'", () => {
      expect(convertEffortValueToLevel(50)).toBe('low')
      expect(convertEffortValueToLevel(0)).toBe('low')
      expect(convertEffortValueToLevel(-10)).toBe('low')
    })

    test("value 51-85 maps to 'medium'", () => {
      expect(convertEffortValueToLevel(51)).toBe('medium')
      expect(convertEffortValueToLevel(85)).toBe('medium')
    })

    test("value 86-100 maps to 'high'", () => {
      expect(convertEffortValueToLevel(86)).toBe('high')
      expect(convertEffortValueToLevel(100)).toBe('high')
    })

    test("value > 100 maps to 'max'", () => {
      expect(convertEffortValueToLevel(101)).toBe('max')
      expect(convertEffortValueToLevel(200)).toBe('max')
    })
  })
})

// ─── getEffortLevelDescription ─────────────────────────────────────────

describe('getEffortLevelDescription', () => {
  test("returns description for 'low'", () => {
    const desc = getEffortLevelDescription('low')
    expect(desc).toContain('Quick')
  })

  test("returns description for 'medium'", () => {
    const desc = getEffortLevelDescription('medium')
    expect(desc).toContain('Balanced')
  })

  test("returns description for 'high'", () => {
    const desc = getEffortLevelDescription('high')
    expect(desc).toContain('Comprehensive')
  })

  test("returns description for 'max'", () => {
    const desc = getEffortLevelDescription('max')
    expect(desc).toContain('Maximum')
  })

  test('max description does not contain model names', () => {
    const desc = getEffortLevelDescription('max')
    expect(desc).not.toContain('Opus')
    expect(desc).not.toContain('DeepSeek')
  })

  test("returns description for 'xhigh'", () => {
    const desc = getEffortLevelDescription('xhigh')
    expect(desc).toContain('Extended reasoning')
  })

  test('xhigh description does not contain model names', () => {
    const desc = getEffortLevelDescription('xhigh')
    expect(desc).not.toContain('Opus')
  })
})

describe('shouldShowEffortUI', () => {
  const saved = {
    CLAUDE_CODE_EFFORT_LEVEL: process.env.CLAUDE_CODE_EFFORT_LEVEL,
    CLAUDE_CODE_USE_OPENAI: process.env.CLAUDE_CODE_USE_OPENAI,
  }

  afterEach(() => {
    if (saved.CLAUDE_CODE_EFFORT_LEVEL === undefined) {
      delete process.env.CLAUDE_CODE_EFFORT_LEVEL
    } else {
      process.env.CLAUDE_CODE_EFFORT_LEVEL = saved.CLAUDE_CODE_EFFORT_LEVEL
    }
    if (saved.CLAUDE_CODE_USE_OPENAI === undefined) {
      delete process.env.CLAUDE_CODE_USE_OPENAI
    } else {
      process.env.CLAUDE_CODE_USE_OPENAI = saved.CLAUDE_CODE_USE_OPENAI
    }
  })

  test('shows effort UI for explicit OpenAI env override on custom model', () => {
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    process.env.CLAUDE_CODE_EFFORT_LEVEL = 'xhigh'

    // unknown id: no catalog row; OpenAI path still shows UI for env override
    expect(shouldShowEffortUI('my-custom-router-v1', undefined)).toBe(true)
  })

  test('hides effort UI for unsupported 3P custom model without explicit override', () => {
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    delete process.env.CLAUDE_CODE_EFFORT_LEVEL

    // truly uncatalogued model on openai provider → no effort UI without override
    expect(shouldShowEffortUI('my-custom-router-v1', undefined)).toBe(false)
  })

  test('shows effort UI for catalogued gpt-5.5 without override', () => {
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    delete process.env.CLAUDE_CODE_EFFORT_LEVEL
    expect(shouldShowEffortUI('gpt-5.5', undefined)).toBe(true)
  })
})

describe('getEffortSuffix', () => {
  const saved = {
    CLAUDE_CODE_EFFORT_LEVEL: process.env.CLAUDE_CODE_EFFORT_LEVEL,
    CLAUDE_CODE_USE_OPENAI: process.env.CLAUDE_CODE_USE_OPENAI,
  }

  afterEach(() => {
    if (saved.CLAUDE_CODE_EFFORT_LEVEL === undefined) {
      delete process.env.CLAUDE_CODE_EFFORT_LEVEL
    } else {
      process.env.CLAUDE_CODE_EFFORT_LEVEL = saved.CLAUDE_CODE_EFFORT_LEVEL
    }
    if (saved.CLAUDE_CODE_USE_OPENAI === undefined) {
      delete process.env.CLAUDE_CODE_USE_OPENAI
    } else {
      process.env.CLAUDE_CODE_USE_OPENAI = saved.CLAUDE_CODE_USE_OPENAI
    }
  })

  test('densable OQe: no logo suffix when only env set (appState undefined)', () => {
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    process.env.CLAUDE_CODE_EFFORT_LEVEL = 'xhigh'
    // densable gates on appState effort only — env alone does not show logo suffix.
    expect(getEffortSuffix('gpt-5.5', undefined)).toBe('')
  })

  test('shows suffix for OpenAI custom model when appState effort is set', () => {
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    delete process.env.CLAUDE_CODE_EFFORT_LEVEL
    expect(getEffortSuffix('gpt-5.5', 'xhigh')).toBe(' with xhigh effort')
  })

  test('clamps unsupported max to high for grok logo suffix', () => {
    delete process.env.CLAUDE_CODE_EFFORT_LEVEL
    expect(getEffortSuffix('grok-4.5', 'max')).toBe(' with high effort')
  })
})

// ─── resolvePickerEffortPersistence ────────────────────────────────────

describe('resolvePickerEffortPersistence', () => {
  test('returns undefined when picked matches model default and no prior persistence', () => {
    const result = resolvePickerEffortPersistence(
      'high',
      'high',
      undefined,
      false,
    )
    expect(result).toBeUndefined()
  })

  test('returns picked when it differs from model default', () => {
    const result = resolvePickerEffortPersistence(
      'low',
      'high',
      undefined,
      false,
    )
    expect(result).toBe('low')
  })

  test('returns picked when priorPersisted is set (even if same as default)', () => {
    const result = resolvePickerEffortPersistence('high', 'high', 'high', false)
    expect(result).toBe('high')
  })

  test('returns picked when toggledInPicker is true (even if same as default)', () => {
    const result = resolvePickerEffortPersistence(
      'high',
      'high',
      undefined,
      true,
    )
    expect(result).toBe('high')
  })

  test('returns undefined picked value when no explicit and matches default', () => {
    const result = resolvePickerEffortPersistence(
      undefined,
      'high' as any,
      undefined,
      false,
    )
    expect(result).toBeUndefined()
  })
})

// ─── densable 2.1.211 model matrix ─────────────────────────────────────

describe('densable effort catalog matrix', () => {
  const savedEnv = {
    CLAUDE_CODE_EFFORT_LEVEL: process.env.CLAUDE_CODE_EFFORT_LEVEL,
    CLAUDE_CODE_USE_OPENAI: process.env.CLAUDE_CODE_USE_OPENAI,
    CLAUDE_CODE_ALWAYS_ENABLE_EFFORT:
      process.env.CLAUDE_CODE_ALWAYS_ENABLE_EFFORT,
  }

  beforeEach(() => {
    delete process.env.CLAUDE_CODE_EFFORT_LEVEL
    delete process.env.CLAUDE_CODE_USE_OPENAI
    delete process.env.CLAUDE_CODE_ALWAYS_ENABLE_EFFORT
    resetEffortLaunchPinsForTests()
  })

  afterEach(() => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    resetEffortLaunchPinsForTests()
  })

  test('opus-4-7: effort yes, default xhigh, max+xhigh yes', () => {
    const m = 'claude-opus-4-7-20250918'
    expect(modelSupportsEffort(m)).toBe(true)
    expect(modelSupportsMaxEffort(m)).toBe(true)
    expect(modelSupportsXhighEffort(m)).toBe(true)
    expect(getDefaultEffortForModel(m)).toBe('xhigh')
    expect(getSupportedEffortLevels(m)).toEqual([
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ])
  })

  test('opus-4-6: default high, xhigh capability no (denylist)', () => {
    const m = 'claude-opus-4-6-20250514'
    expect(modelSupportsEffort(m)).toBe(true)
    expect(modelSupportsMaxEffort(m)).toBe(true)
    expect(modelSupportsXhighEffort(m)).toBe(false)
    // densable LQe: default high (not xhigh) when xhigh denylisted
    expect(getDefaultEffortForModel(m)).toBe('high')
    expect(clampEffortForModel('xhigh', m)).toBe('high')
    expect(getSupportedEffortLevels(m)).toEqual([
      'low',
      'medium',
      'high',
      'max',
    ])
  })

  test('sonnet-4-6: default high, no xhigh, has max', () => {
    const m = 'claude-sonnet-4-6-20250514'
    expect(modelSupportsEffort(m)).toBe(true)
    expect(modelSupportsMaxEffort(m)).toBe(true)
    expect(modelSupportsXhighEffort(m)).toBe(false)
    expect(getDefaultEffortForModel(m)).toBe('high')
    expect(clampEffortForModel('xhigh', m)).toBe('high')
    expect(getSupportedEffortLevels(m)).toEqual([
      'low',
      'medium',
      'high',
      'max',
    ])
  })

  test('haiku-4-5: no effort', () => {
    const m = 'claude-haiku-4-5-20251001'
    expect(modelSupportsEffort(m)).toBe(false)
    expect(modelSupportsMaxEffort(m)).toBe(false)
    expect(modelSupportsXhighEffort(m)).toBe(false)
    expect(getDefaultEffortForModel(m)).toBeUndefined()
    expect(getSupportedEffortLevels(m)).toEqual([])
    expect(resolveAppliedEffort(m, 'high')).toBeUndefined()
  })

  // densable kk: bare/dated sonnet|opus 4.0 effort-denied. getCanonicalName
  // collapses them to claude-*-4 (no -0); must still deny without hitting 4-6/4-7.
  test.each([
    'claude-opus-4',
    'claude-opus-4-0',
    'claude-opus-4-20250514',
    'claude-sonnet-4',
    'claude-sonnet-4-0',
  ])('legacy 4.0 family denied: %s', m => {
    expect(modelSupportsEffort(m)).toBe(false)
    expect(modelSupportsMaxEffort(m)).toBe(false)
    expect(modelSupportsXhighEffort(m)).toBe(false)
    expect(getDefaultEffortForModel(m)).toBeUndefined()
    expect(getSupportedEffortLevels(m)).toEqual([])
    expect(resolveAppliedEffort(m, 'high')).toBeUndefined()
  })

  test('legacy 4.0 exact deny does not over-match opus-4-6 / sonnet-4-6', () => {
    expect(modelSupportsEffort('claude-opus-4-6')).toBe(true)
    expect(modelSupportsEffort('claude-sonnet-4-6')).toBe(true)
    expect(modelSupportsEffort('claude-opus-4-7')).toBe(true)
  })

  test('unknown firstParty model: supports effort, default high', () => {
    const m = 'some-random-model'
    expect(modelSupportsEffort(m)).toBe(true)
    expect(getDefaultEffortForModel(m)).toBe('high')
  })

  test('resolveAppliedEffort: session value wins when unpinned', () => {
    unpinAllEffortLaunchPins()
    expect(resolveAppliedEffort('claude-opus-4-7', 'low')).toBe('low')
  })

  test('resolveAppliedEffort: launch pin forces model default over session', () => {
    // pin is active by default for opus-4-7 until unpin
    resetEffortLaunchPinsForTests()
    expect(resolveAppliedEffort('claude-opus-4-7', 'low')).toBe('xhigh')
  })

  test('resolveAppliedEffort: after unpin, session low sticks', () => {
    resetEffortLaunchPinsForTests()
    unpinAllEffortLaunchPins()
    expect(resolveAppliedEffort('claude-opus-4-7', 'low')).toBe('low')
  })

  test('resolveAppliedEffort: env auto suppresses unless pinned', () => {
    process.env.CLAUDE_CODE_EFFORT_LEVEL = 'auto'
    unpinAllEffortLaunchPins()
    expect(resolveAppliedEffort('claude-sonnet-4-6', 'high')).toBeUndefined()
  })

  test('resolveAppliedEffort: env auto + pin uses model default', () => {
    process.env.CLAUDE_CODE_EFFORT_LEVEL = 'auto'
    resetEffortLaunchPinsForTests()
    expect(resolveAppliedEffort('claude-opus-4-7', 'low')).toBe('xhigh')
  })

  test('resolveAppliedEffort: clamps unsupported xhigh on sonnet-4-6', () => {
    unpinAllEffortLaunchPins()
    expect(resolveAppliedEffort('claude-sonnet-4-6', 'xhigh')).toBe('high')
  })

  test('resolveAppliedEffort: no supports → undefined', () => {
    expect(resolveAppliedEffort('claude-haiku-4-5', 'max')).toBeUndefined()
  })

  // ── fork per-model ladders ───────────────────────────────────────────

  test('gpt-5.6-sol: full ladder, default medium', () => {
    const m = 'gpt-5.6-sol'
    expect(modelSupportsEffort(m)).toBe(true)
    expect(getDefaultEffortForModel(m)).toBe('medium')
    expect(getSupportedEffortLevels(m)).toEqual([
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ])
  })

  test('gpt-5.4-pro: longer match beats gpt-5.4', () => {
    expect(getDefaultEffortForModel('gpt-5.4-pro')).toBe('medium')
    expect(modelSupportsMaxEffort('gpt-5.4-pro')).toBe(true)
    expect(modelSupportsMaxEffort('gpt-5.4-mini')).toBe(false)
  })

  test('grok-4.5: low/medium/high only, default high', () => {
    const m = 'grok-4.5'
    expect(modelSupportsEffort(m)).toBe(true)
    expect(getDefaultEffortForModel(m)).toBe('high')
    expect(getSupportedEffortLevels(m)).toEqual(['low', 'medium', 'high'])
    expect(clampEffortForModel('max', m)).toBe('high')
    expect(clampEffortForModel('xhigh', m)).toBe('high')
  })

  test('kimi-k3: low/high/max, default max; medium clamps to high', () => {
    const m = 'kimi-k3'
    expect(modelSupportsEffort(m)).toBe(true)
    expect(getDefaultEffortForModel(m)).toBe('max')
    expect(getSupportedEffortLevels(m)).toEqual(['low', 'high', 'max'])
    expect(clampEffortForModel('medium', m)).toBe('high')
    expect(clampEffortForModel('xhigh', m)).toBe('max')
  })

  test('kimi-k2.7: no graded effort', () => {
    const m = 'kimi-k2.7-code'
    expect(modelSupportsEffort(m)).toBe(false)
    expect(getDefaultEffortForModel(m)).toBeUndefined()
    expect(getSupportedEffortLevels(m)).toEqual([])
  })

  test('deepseek-v4-pro: high|max only; xhigh→max, medium→high', () => {
    const m = 'deepseek-v4-pro'
    expect(modelSupportsEffort(m)).toBe(true)
    expect(getDefaultEffortForModel(m)).toBe('high')
    expect(getSupportedEffortLevels(m)).toEqual(['high', 'max'])
    expect(clampEffortForModel('low', m)).toBe('high')
    expect(clampEffortForModel('medium', m)).toBe('high')
    expect(clampEffortForModel('xhigh', m)).toBe('max')
    expect(clampEffortForModel('max', m)).toBe('max')
  })

  test('deepseek-v4-flash: same ladder as pro family', () => {
    expect(getSupportedEffortLevels('deepseek-v4-flash')).toEqual([
      'high',
      'max',
    ])
  })

  test('getUltracodeEffortForModel: prefer xhigh when present', () => {
    expect(getUltracodeEffortForModel('claude-opus-4-7')).toBe('xhigh')
    expect(getUltracodeEffortForModel('gpt-5.6-sol')).toBe('xhigh')
  })

  test('getUltracodeEffortForModel: grok-4.5 tops at high (no xhigh)', () => {
    expect(getUltracodeEffortForModel('grok-4.5')).toBe('high')
  })

  test('getUltracodeEffortForModel: deepseek-v4-pro tops at max', () => {
    expect(getUltracodeEffortForModel('deepseek-v4-pro')).toBe('max')
  })

  test('getUltracodeEffortForModel: haiku no effort → undefined', () => {
    expect(getUltracodeEffortForModel('claude-haiku-4-5')).toBeUndefined()
  })

  test('isUltracodeModeActive requires flag + matching wire tier', () => {
    // Flag off → inactive even at xhigh
    expect(isUltracodeModeActive('claude-opus-4-7', 'xhigh', false)).toBe(false)
    // Flag on + wire matches catalog ultracode tier → active
    // (workflows available via default GB mock; pin/env unset)
    delete process.env.CLAUDE_CODE_EFFORT_LEVEL
    // Launch pin can force model default (xhigh) over session low — unpin
    // so we test pure resolveAppliedEffort matching.
    unpinAllEffortLaunchPins()
    expect(isUltracodeModeActive('claude-opus-4-7', 'xhigh', true)).toBe(true)
    // Flag on but session effort not at ultracode wire tier → inactive
    expect(isUltracodeModeActive('claude-opus-4-7', 'low', true)).toBe(false)
    // Grok tops at high — ultracode active when effort is high + flag
    expect(isUltracodeModeActive('grok-4.5', 'high', true)).toBe(true)
    expect(isUltracodeModeActive('grok-4.5', 'medium', true)).toBe(false)
  })

  test('getEffortSuffix densable OQe: wire level even when ultracode active', () => {
    // densable logo suffix is always ` with {wire} effort` — ultracode is a
    // separate notification/border chip, not a different logo suffix.
    delete process.env.CLAUDE_CODE_EFFORT_LEVEL
    expect(getEffortSuffix('claude-opus-4-7', 'xhigh', true)).toBe(
      ' with xhigh effort',
    )
    expect(getEffortSuffix('claude-opus-4-7', 'xhigh', false)).toBe(
      ' with xhigh effort',
    )
    expect(getEffortSuffix('grok-4.5', 'high', true)).toBe(' with high effort')
  })

  test('isUltracodeOfferable false for haiku', () => {
    expect(isUltracodeOfferable('claude-haiku-4-5')).toBe(false)
  })

  test('isUltracodeOfferable uses FE (enableWorkflows), not wIr alone', () => {
    // Default settings mock: enableWorkflows unset → defaultOn true → offerable
    expect(isUltracodeOfferable('claude-opus-4-7')).toBe(true)

    // Thin override: FE off via settings.enableWorkflows=false
    mock.module(
      'src/utils/settings/settings.js',
      createSettingsMock(settingsSnap, {
        getInitialSettings: () => ({ enableWorkflows: false }),
        getSettingsForSource: () => ({}),
      }),
    )
    expect(isUltracodeOfferable('claude-opus-4-7')).toBe(false)
    // Dee also inactive when FE off even if flag+xhigh
    expect(isUltracodeModeActive('claude-opus-4-7', 'xhigh', true)).toBe(false)

    // Restore default empty settings for later tests
    mock.module(
      'src/utils/settings/settings.js',
      createSettingsMock(settingsSnap, {
        getInitialSettings: () => ({}),
        getSettingsForSource: () => ({}),
      }),
    )
    expect(isUltracodeOfferable('claude-opus-4-7')).toBe(true)
  })

  // densable XLr / UBn / Qwi / sAi — CLI + settings bootstrap
  test('isUltracodeEffortAlias only matches ultracode', () => {
    expect(isUltracodeEffortAlias('ultracode')).toBe(true)
    expect(isUltracodeEffortAlias('ULTRACODE')).toBe(true)
    expect(isUltracodeEffortAlias('xhigh')).toBe(false)
    expect(isUltracodeEffortAlias(undefined)).toBe(false)
  })

  test('resolveBootstrapEffortValue: cli level wins over settings ultracode', () => {
    expect(
      resolveBootstrapEffortValue({
        cliEffort: 'low',
        settingsUltracode: true,
        settingsEffortLevel: 'high',
        model: 'claude-opus-4-7',
      }),
    ).toBe('low')
  })

  test('resolveBootstrapEffortValue: cli ultracode → catalog wire (opus xhigh)', () => {
    expect(
      resolveBootstrapEffortValue({
        cliEffort: 'ultracode',
        model: 'claude-opus-4-7',
      }),
    ).toBe('xhigh')
  })

  test('resolveBootstrapEffortValue: cli ultracode → catalog wire (grok high)', () => {
    expect(
      resolveBootstrapEffortValue({
        cliEffort: 'ultracode',
        model: 'grok-4.5',
      }),
    ).toBe('high')
  })

  test('resolveBootstrapEffortValue: settings.ultracode → catalog wire', () => {
    expect(
      resolveBootstrapEffortValue({
        settingsUltracode: true,
        settingsEffortLevel: 'low',
        model: 'claude-opus-4-7',
      }),
    ).toBe('xhigh')
  })

  test('resolveBootstrapEffortValue: falls through to settings effortLevel', () => {
    expect(
      resolveBootstrapEffortValue({
        settingsEffortLevel: 'medium',
        model: 'claude-opus-4-7',
      }),
    ).toBe('medium')
  })

  test('resolveBootstrapUltracodeFlag: cli ultracode or settings.ultracode unpins', () => {
    resetEffortLaunchPinsForTests()
    expect(isEffortLaunchPinned('claude-opus-4-7')).toBe(true)
    expect(
      resolveBootstrapUltracodeFlag({
        cliEffort: 'ultracode',
      }),
    ).toBe(true)
    expect(isEffortLaunchPinned('claude-opus-4-7')).toBe(false)

    resetEffortLaunchPinsForTests()
    expect(
      resolveBootstrapUltracodeFlag({
        settingsUltracode: true,
      }),
    ).toBe(true)
    expect(isEffortLaunchPinned('claude-opus-4-7')).toBe(false)

    resetEffortLaunchPinsForTests()
    expect(resolveBootstrapUltracodeFlag({ cliEffort: 'high' })).toBe(false)
    expect(isEffortLaunchPinned('claude-opus-4-7')).toBe(true)
  })

  test('resolveBootstrapEffortValue densable QBn: parseable CLI level unpins', () => {
    resetEffortLaunchPinsForTests()
    expect(isEffortLaunchPinned('claude-opus-4-7')).toBe(true)
    expect(
      resolveBootstrapEffortValue({
        cliEffort: 'low',
        model: 'claude-opus-4-7',
      }),
    ).toBe('low')
    expect(isEffortLaunchPinned('claude-opus-4-7')).toBe(false)
    // After unpin, resolveAppliedEffort honors session low
    expect(resolveAppliedEffort('claude-opus-4-7', 'low')).toBe('low')
  })

  test('resolveBootstrapUltracodeFlag: no wire for model → false (no empty flag)', () => {
    resetEffortLaunchPinsForTests()
    expect(
      resolveBootstrapUltracodeFlag({
        cliEffort: 'ultracode',
        model: 'claude-haiku-4-5',
      }),
    ).toBe(false)
    // pin left alone when flag refused
    expect(isEffortLaunchPinned('claude-opus-4-7')).toBe(true)
  })

  test('resolveBootstrapEffortValue: cli ultracode with no wire stays undefined', () => {
    expect(
      resolveBootstrapEffortValue({
        cliEffort: 'ultracode',
        settingsEffortLevel: 'medium',
        model: 'claude-haiku-4-5',
      }),
    ).toBeUndefined()
  })

  test('resolveBootstrapEffortValue: cli ultracode with wire unpins (Qwi alone)', () => {
    resetEffortLaunchPinsForTests()
    expect(isEffortLaunchPinned('claude-opus-4-7')).toBe(true)
    expect(
      resolveBootstrapEffortValue({
        cliEffort: 'ultracode',
        model: 'claude-opus-4-7',
      }),
    ).toBe('xhigh')
    expect(isEffortLaunchPinned('claude-opus-4-7')).toBe(false)
  })

  test('resolveBootstrapEffortValue: cli med alias → medium (qlc via M9)', () => {
    expect(
      resolveBootstrapEffortValue({
        cliEffort: 'med',
        model: 'claude-opus-4-7',
      }),
    ).toBe('medium')
  })
})

// ─── org maxEffortLevel clamp (densable S8t / wve) ────────────────────

describe('clampEffortToOrgLimit (densable S8t/wve)', () => {
  beforeEach(() => {
    modelAccessCacheOverride = undefined
  })
  afterEach(() => {
    modelAccessCacheOverride = undefined
  })

  // Without modelAccessCache, clamp is a no-op (common path for this fork).
  test('no cache → level unchanged', () => {
    expect(clampEffortToOrgLimit('max', 'claude-opus-4-7')).toBe('max')
    expect(clampEffortToOrgLimit('high', 'claude-sonnet-4-6')).toBe('high')
  })

  test('firstParty cache: max → high when org maxEffortLevel=high', () => {
    modelAccessCacheOverride = [
      {
        apiName: 'claude-opus-4-7',
        entitled: true,
        maxEffortLevel: 'high',
      },
    ]
    // Default provider in tests is firstParty (no USE_* env).
    expect(getOrgMaxEffortLevel('claude-opus-4-7')).toBe('high')
    expect(clampEffortToOrgLimit('max', 'claude-opus-4-7')).toBe('high')
    expect(clampEffortToOrgLimit('xhigh', 'claude-opus-4-7')).toBe('high')
    expect(clampEffortToOrgLimit('high', 'claude-opus-4-7')).toBe('high')
    expect(clampEffortToOrgLimit('medium', 'claude-opus-4-7')).toBe('medium')
  })

  test('MDe filter: levels above org cap dropped', () => {
    modelAccessCacheOverride = [
      {
        apiName: 'claude-opus-4-7',
        entitled: true,
        maxEffortLevel: 'high',
      },
    ]
    expect(
      filterEffortLevelsByOrgLimit(
        ['low', 'medium', 'high', 'xhigh', 'max'],
        'claude-opus-4-7',
      ),
    ).toEqual(['low', 'medium', 'high'])
    // getSupportedEffortLevels includes MDe filter
    const supported = getSupportedEffortLevels('claude-opus-4-7')
    expect(supported).not.toContain('max')
    expect(supported).not.toContain('xhigh')
    expect(supported).toContain('high')
  })

  test('Ulc formatOrgEffortExceedMessage', async () => {
    modelAccessCacheOverride = [
      {
        apiName: 'claude-opus-4-7',
        entitled: true,
        maxEffortLevel: 'high',
      },
    ]
    const { formatOrgEffortExceedMessage } = await import('src/utils/effort.js')
    expect(formatOrgEffortExceedMessage('max', 'claude-opus-4-7')).toBe(
      "Effort 'max' exceeds your organization's limit for claude-opus-4-7; using 'high'.",
    )
    expect(formatOrgEffortExceedMessage('high', 'claude-opus-4-7')).toBeNull()
    expect(
      formatOrgEffortExceedMessage(undefined, 'claude-opus-4-7'),
    ).toBeNull()
  })
})
