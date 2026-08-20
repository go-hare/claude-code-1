/**
 * densable 2.1.221 EL_ / eGu — object-shaped tengu_non_deferrable_builtins
 * surface pick by model substring, else "*".
 *
 * Spread real bootstrap/state when overriding qC/FY getters — incomplete
 * bootstrap mocks are process-global and poison co-running suites.
 */
import { afterAll, afterEach, describe, expect, mock, test } from 'bun:test'
import * as realBootstrap from 'src/bootstrap/state.js'
import * as realGrowthbook from 'src/services/analytics/growthbook.js'
import * as realForkSubagentGate from 'src/utils/forkSubagentGate.js'
import * as realSettings from 'src/utils/settings/settings.js'
import {
  restoreSettingsMockWith,
  snapshotModuleExports,
} from '../../../../../../tests/mocks/settings.js'

let gbValue: unknown = null
let overrideModel: string | undefined
let initialModel: string | null = null

const growthbookSnap = snapshotModuleExports(realGrowthbook)
mock.module('src/services/analytics/growthbook.js', () => ({
  ...growthbookSnap,
  getFeatureValue_CACHED_MAY_BE_STALE: (_k: string, d: unknown) =>
    gbValue === undefined ? d : gbValue,
}))

const bootstrapSnap = snapshotModuleExports(realBootstrap)
mock.module('src/bootstrap/state.js', () => ({
  ...bootstrapSnap,
  getMainLoopModelOverride: () => overrideModel,
  getInitialMainLoopModel: () => initialModel,
}))

const settingsSnap = snapshotModuleExports(realSettings)
mock.module('src/utils/settings/settings.js', () => ({
  ...settingsSnap,
  getInitialSettings: () => ({}),
}))
mock.module('src/utils/settings/settings.ts', () => ({
  ...settingsSnap,
  getInitialSettings: () => ({}),
}))

const forkGateSnap = snapshotModuleExports(realForkSubagentGate)
mock.module('src/utils/forkSubagentGate.js', () => ({
  ...forkGateSnap,
  isForkSubagentEnabled: () => false,
}))

afterAll(() => {
  mock.module('src/bootstrap/state.js', () => ({ ...bootstrapSnap }))
  mock.module('src/utils/forkSubagentGate.js', () => ({ ...forkGateSnap }))
  mock.module('src/services/analytics/growthbook.js', () => ({
    ...growthbookSnap,
  }))
  restoreSettingsMockWith(mock.module, settingsSnap, [
    'src/utils/settings/settings.js',
    'src/utils/settings/settings.ts',
  ])
})

const { surfacePickByModel, getNonDeferrableBuiltins } = await import(
  '../prompt.js'
)

afterEach(() => {
  gbValue = null
  overrideModel = undefined
  initialModel = null
})

describe('surfacePickByModel densable EL_', () => {
  test('passthrough null / array / non-object', () => {
    expect(surfacePickByModel(null, 'claude-opus-5')).toBe(null)
    expect(surfacePickByModel(['Read'], 'claude-opus-5')).toEqual(['Read'])
    expect(surfacePickByModel('x', 'claude-opus-5')).toBe('x')
  })

  test('picks first matching key substring (case-insensitive)', () => {
    const obj = {
      opus: ['Agent'],
      sonnet: ['Bash'],
      '*': ['Glob'],
    }
    expect(surfacePickByModel(obj, 'claude-opus-4-8')).toEqual(['Agent'])
    expect(surfacePickByModel(obj, 'Claude-Sonnet-4-6')).toEqual(['Bash'])
  })

  test('falls back to * when no key matches', () => {
    const obj = {
      haiku: ['Read'],
      '*': ['Edit'],
    }
    expect(surfacePickByModel(obj, 'claude-opus-5')).toEqual(['Edit'])
  })

  test('undefined model uses * only', () => {
    const obj = { opus: ['Agent'], '*': ['Write'] }
    expect(surfacePickByModel(obj, undefined)).toEqual(['Write'])
    expect(surfacePickByModel(obj, null)).toEqual(['Write'])
  })
})

describe('getNonDeferrableBuiltins densable eGu + EL_', () => {
  test('array GB still works', () => {
    gbValue = ['Read', 'Edit']
    expect(getNonDeferrableBuiltins()).toEqual(['Read', 'Edit'])
  })

  test('object GB surface-picks by override model (qC)', () => {
    overrideModel = 'claude-opus-5'
    gbValue = {
      opus: ['Agent', 'Task'],
      '*': ['Bash'],
    }
    expect(getNonDeferrableBuiltins()).toEqual(['Agent', 'Task'])
  })

  test('object GB uses initial model when override undefined (FY)', () => {
    overrideModel = undefined
    initialModel = 'claude-sonnet-4-6'
    gbValue = {
      sonnet: ['Grep'],
      '*': ['Bash'],
    }
    expect(getNonDeferrableBuiltins()).toEqual(['Grep'])
  })

  test('object with no matching surface → empty vL_', () => {
    overrideModel = 'claude-opus-5'
    gbValue = {
      haiku: ['Read'],
      // no *
    }
    expect(getNonDeferrableBuiltins()).toEqual([])
  })
})
