import { afterAll, afterEach, describe, expect, mock, test } from 'bun:test'
import * as realSettings from 'src/utils/settings/settings.js'
import {
  createSettingsMock,
  restoreSettingsMockWith,
  snapshotModuleExports,
} from '../../../../tests/mocks/settings.js'

const settingsSnap = snapshotModuleExports(realSettings)

let policy: Record<string, unknown> = {}
let merged: Record<string, unknown> = {}

mock.module(
  'src/utils/settings/settings.js',
  createSettingsMock(settingsSnap, {
    getSettingsForSource: () => policy,
    getSettings_DEPRECATED: () => merged,
    getInitialSettings: () => merged,
  }),
)

afterEach(() => {
  policy = {}
  merged = {}
})

afterAll(() => {
  restoreSettingsMockWith(mock.module, settingsSnap)
})

const {
  firstAllowedPolicyListedModel,
  formatDeniedModelsBlockMessage,
  isBlockedByExactAllowlist,
  isModelAllowed,
  isModelDeniedByPolicy,
  parsePolicyModelEntry,
  stepDownBlockedDefaultModel,
} = await import('../modelAllowlist.js')
const { isEffortLaunchPinned, launchPinModels, resetEffortLaunchPinsForTests } =
  await import('../effortCatalog.js')
const { saveGlobalConfig } = await import('../../config.js')

describe('deniedModels densable 2.1.283', () => {
  test('parsePolicyModelEntry classifies family / model / ignored', () => {
    expect(parsePolicyModelEntry('opus')).toEqual({
      kind: 'family',
      family: 'opus',
    })
    expect(parsePolicyModelEntry('claude-opus-5-5')).toEqual({
      kind: 'model',
      id: {
        family: 'opus',
        major: 5,
        minor: 5,
        legacyVersionFirst: false,
        base: 'claude-opus-5-5',
      },
      latest: false,
      spelling: 'claude-opus-5-5',
    })
    expect(parsePolicyModelEntry('best')).toEqual({ kind: 'ignored' })
    expect(parsePolicyModelEntry('opusplan')).toEqual({ kind: 'ignored' })
    expect(parsePolicyModelEntry('')).toEqual({ kind: 'ignored' })
    expect(parsePolicyModelEntry('default')).toEqual({ kind: 'ignored' })
  })

  test('parsePolicyModelEntry sets latest on -latest spelling trailer', () => {
    const parsed = parsePolicyModelEntry('claude-opus-5-5-latest')
    expect(parsed).toMatchObject({
      kind: 'model',
      latest: true,
      spelling: 'claude-opus-5-5-latest',
      id: {
        family: 'opus',
        major: 5,
        minor: 5,
        base: 'claude-opus-5-5',
      },
    })
    if (parsed.kind === 'model') {
      expect(parsed.id.trailer).toBeUndefined()
    }
  })

  test('family alias denies the whole family', () => {
    policy = { deniedModels: ['opus'] }
    expect(isModelDeniedByPolicy('claude-opus-5-5')).toBe(true)
    expect(isModelDeniedByPolicy('claude-opus-5')).toBe(true)
    expect(isModelDeniedByPolicy('claude-sonnet-5')).toBe(false)
  })

  test('claude-opus-5-5 denies every 5.5 spelling but not unsuffixed opus-5', () => {
    policy = { deniedModels: ['claude-opus-5-5'] }
    expect(isModelDeniedByPolicy('claude-opus-5-5')).toBe(true)
    expect(isModelDeniedByPolicy('claude-opus-5-5[1m]')).toBe(true)
    expect(isModelDeniedByPolicy('us.anthropic.claude-opus-5-5')).toBe(true)
    expect(isModelDeniedByPolicy('claude-opus-5')).toBe(false)
  })

  test('unsuffixed claude-opus-5 also blocks later minor 5-5', () => {
    policy = { deniedModels: ['claude-opus-5'] }
    expect(isModelDeniedByPolicy('claude-opus-5')).toBe(true)
    expect(isModelDeniedByPolicy('claude-opus-5-5')).toBe(true)
  })

  test('isModelAllowed is false when denied even if availableModels lists it', () => {
    policy = {
      deniedModels: ['claude-opus-5-5'],
      availableModels: ['claude-opus-5-5', 'claude-sonnet-5'],
    }
    merged = { availableModels: ['claude-opus-5-5', 'claude-sonnet-5'] }
    expect(isModelAllowed('claude-opus-5-5')).toBe(false)
    expect(isModelAllowed('claude-sonnet-5')).toBe(true)
  })

  test('RH copy names deniedModels', () => {
    policy = { deniedModels: ['claude-opus-5-5'] }
    expect(
      formatDeniedModelsBlockMessage('claude-opus-5-5', 'start'),
    ).toContain('deniedModels')
  })

  test('RH start vs switch copy; null when a substitute exists', () => {
    policy = { deniedModels: ['claude-opus-5-5'] }
    const start = formatDeniedModelsBlockMessage('claude-opus-5-5', 'start')
    const swap = formatDeniedModelsBlockMessage('claude-opus-5-5', 'switch')
    expect(start).toContain("Claude Code can't start")
    expect(start).toContain('deniedModels')
    expect(swap).toContain("Can't switch to the default model")
    expect(swap).not.toContain("Claude Code can't start")
    expect(
      formatDeniedModelsBlockMessage('claude-sonnet-5', 'start'),
    ).toBeNull()
  })

  test('Gu steps a denied opus default down to sonnet', () => {
    policy = { deniedModels: ['opus'] }
    merged = {}
    const stepped = stepDownBlockedDefaultModel('claude-opus-5-5', model => {
      const n = model.toLowerCase()
      return n.includes('sonnet') && !n.includes('opus')
    })
    expect(stepped).toBeTruthy()
    expect(stepped?.toLowerCase()).toContain('sonnet')
    expect(formatDeniedModelsBlockMessage(stepped!, 'start')).toBeNull()
  })

  test('Gu + ZO: no substitute when every family is denied', () => {
    policy = { deniedModels: ['opus', 'sonnet', 'haiku', 'fable'] }
    merged = {}
    expect(stepDownBlockedDefaultModel('claude-opus-5-5', () => false)).toBeNull()
    expect(
      formatDeniedModelsBlockMessage('claude-opus-5-5', 'start'),
    ).toContain("Claude Code can't start")
  })

  test('ZO picks first allowed availableModels family member', () => {
    policy = {
      deniedModels: ['opus'],
      availableModels: ['sonnet'],
    }
    merged = { availableModels: ['sonnet'] }
    expect(firstAllowedPolicyListedModel()?.toLowerCase()).toContain('sonnet')
  })
})

describe('RH switch gate densable 2.1.283', () => {
  test('print set_model default is denied when no substitute remains', async () => {
    const { getDefaultMainLoopModel } = await import('../model.js')
    const currentDefault = getDefaultMainLoopModel()
    policy = {
      deniedModels: ['opus', 'sonnet', 'haiku', 'fable', currentDefault],
    }
    merged = {}
    const { decidePrintSetModel, decideReplBridgeSetModel } = await import(
      '../printSetModel.js'
    )
    const print = decidePrintSetModel('default', undefined)
    expect(print.ok).toBe(false)
    if (print.ok) return
    expect(print.analytics).toBe('denied_by_managed_settings')
    expect(print.error).toContain("Can't switch to the default model")
    const bridge = decideReplBridgeSetModel('default', undefined)
    expect(bridge.ok).toBe(false)
    if (bridge.ok) return
    expect(bridge.analytics).toBe('denied_by_managed_settings')
  })
})

describe('re() launch pins densable 2.1.283', () => {
  const previousFable = process.env.ANTHROPIC_DEFAULT_FABLE_MODEL

  afterEach(() => {
    if (previousFable === undefined) {
      delete process.env.ANTHROPIC_DEFAULT_FABLE_MODEL
    } else {
      process.env.ANTHROPIC_DEFAULT_FABLE_MODEL = previousFable
    }
    resetEffortLaunchPinsForTests()
  })

  test('firstStartVersion set → empty pin list', () => {
    resetEffortLaunchPinsForTests()
    expect(isEffortLaunchPinned('claude-opus-4-7')).toBe(true)
    saveGlobalConfig(e => ({ ...e, firstStartVersion: '2.1.283' }))
    expect(launchPinModels()).toEqual([])
    expect(isEffortLaunchPinned('claude-opus-4-7')).toBe(false)
    expect(isEffortLaunchPinned('claude-fable-5')).toBe(false)
  })

  test('ANTHROPIC_DEFAULT_FABLE_MODEL extra pin when not claude-fable-', () => {
    resetEffortLaunchPinsForTests()
    delete process.env.ANTHROPIC_DEFAULT_FABLE_MODEL
    expect(launchPinModels()).toEqual([
      'claude-opus-4-7',
      'claude-opus-4-8',
      'claude-fable-5',
    ])
    process.env.ANTHROPIC_DEFAULT_FABLE_MODEL = 'claude-sonnet-4-6'
    expect(launchPinModels()).toContain('claude-sonnet-4-6')
    expect(isEffortLaunchPinned('claude-sonnet-4-6')).toBe(true)
    expect(isEffortLaunchPinned('claude-fable-5')).toBe(true)
    process.env.ANTHROPIC_DEFAULT_FABLE_MODEL = 'claude-fable-5-1'
    expect(launchPinModels()).toEqual([
      'claude-opus-4-7',
      'claude-opus-4-8',
      'claude-fable-5',
    ])
    expect(isEffortLaunchPinned('claude-fable-5-1')).toBe(false)
  })
})

describe('availableModelsMatch exact densable 2.1.283', () => {
  test('prefix (default) lets claude-opus-5 allow claude-opus-5-5', () => {
    merged = { availableModels: ['claude-opus-5'] }
    policy = {}
    expect(isModelAllowed('claude-opus-5-5')).toBe(true)
    expect(isBlockedByExactAllowlist('claude-opus-5-5')).toBe(false)
  })

  test('exact stops claude-opus-5 from allowing 5-5', () => {
    policy = {
      availableModelsMatch: 'exact',
      availableModels: ['claude-opus-5'],
    }
    merged = {
      availableModelsMatch: 'exact',
      availableModels: ['claude-opus-5'],
    }
    expect(isBlockedByExactAllowlist('claude-opus-5-5')).toBe(true)
    expect(isModelAllowed('claude-opus-5-5')).toBe(false)
    expect(isModelAllowed('claude-opus-5')).toBe(true)
  })

  test('exact family alias still allows the whole family', () => {
    policy = {
      availableModelsMatch: 'exact',
      availableModels: ['opus'],
    }
    merged = {
      availableModelsMatch: 'exact',
      availableModels: ['opus'],
    }
    expect(isModelAllowed('claude-opus-5-5')).toBe(true)
    expect(isModelAllowed('claude-opus-5')).toBe(true)
  })

  test('ignored-only exact list does not gate', () => {
    policy = {
      availableModelsMatch: 'exact',
      availableModels: ['best', 'opusplan'],
    }
    merged = {
      availableModelsMatch: 'exact',
      availableModels: ['best', 'opusplan'],
    }
    expect(isBlockedByExactAllowlist('claude-opus-5-5')).toBe(false)
  })
})
