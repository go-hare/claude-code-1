import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  canonicalEffortModelKey,
  effortModelClearPatch,
  effortModelSettingsPatch,
  parsePersistedEffortLevel,
  resolveEffortByModel,
  type EffortSettingsSlice,
} from '../effort.js'
import { SettingsSchema } from '../settings/types.js'

const opus = 'claude-opus-5'
const sonnet = 'claude-sonnet-5'

describe('per-model effort settings (2.1.251 #61)', () => {
  test('canonical model key strips a dated suffix', () => {
    expect(canonicalEffortModelKey('claude-opus-4-6-20250514')).toBe(
      'claude-opus-4-6',
    )
    expect(canonicalEffortModelKey('Claude-Opus-5')).toBe(opus)
  })

  test('K writes modelSettings unless the key is on Object.prototype', () => {
    expect(effortModelSettingsPatch(opus, 'high')).toEqual({
      modelSettings: { [opus]: { effortLevel: 'high' } },
    })
    expect(effortModelSettingsPatch('constructor', 'low')).toEqual({
      effortLevel: 'low',
    })
    expect(Object.hasOwn(Object.prototype, 'constructor')).toBe(true)
  })

  test('clear removes the per-model entry and the legacy effortLevel', () => {
    expect(effortModelClearPatch(opus)).toEqual({
      effortLevel: undefined,
      modelSettings: { [opus]: undefined },
    })
    expect(effortModelClearPatch('constructor')).toEqual({
      effortLevel: undefined,
    })
  })

  test('per-model effort wins over the same source effortLevel', () => {
    const user: EffortSettingsSlice = {
      effortLevel: 'high',
      modelSettings: { [opus]: { effortLevel: 'low' } },
    }
    const resolved = resolveEffortByModel({
      merged: user,
      sourcesLowToHigh: [user],
    })
    expect(resolved.byModel[opus]).toBe('low')
    expect(resolved.default).toBe('high')
  })

  test('a higher source with only effortLevel copies onto keys already seen', () => {
    const user: EffortSettingsSlice = {
      modelSettings: {
        [opus]: { effortLevel: 'low' },
        [sonnet]: { effortLevel: 'medium' },
      },
    }
    const policy: EffortSettingsSlice = { effortLevel: 'xhigh' }
    const resolved = resolveEffortByModel({
      merged: { effortLevel: 'xhigh' },
      sourcesLowToHigh: [user, policy],
    })
    expect(resolved.byModel[opus]).toBe('xhigh')
    expect(resolved.byModel[sonnet]).toBe('xhigh')
  })

  test('a higher source per-model entry beats a lower source', () => {
    const user: EffortSettingsSlice = {
      modelSettings: { [opus]: { effortLevel: 'low' } },
    }
    const policy: EffortSettingsSlice = {
      effortLevel: 'high',
      modelSettings: { [sonnet]: { effortLevel: 'medium' } },
    }
    const resolved = resolveEffortByModel({
      merged: policy,
      sourcesLowToHigh: [user, policy],
    })
    expect(resolved.byModel[sonnet]).toBe('medium')
    expect(resolved.byModel[opus]).toBe('high')
  })

  test('a canonical key overwrites an alias that maps to the same id', () => {
    const user: EffortSettingsSlice = {
      modelSettings: {
        'Claude-Opus-5': { effortLevel: 'low' },
        [opus]: { effortLevel: 'high' },
      },
    }
    const resolved = resolveEffortByModel({
      merged: {},
      sourcesLowToHigh: [user],
    })
    expect(resolved.byModel[opus]).toBe('high')
    expect(resolved.byModel['Claude-Opus-5']).toBeUndefined()
  })

  test('an invalid per-model value does not fall through to effortLevel', () => {
    const user: EffortSettingsSlice = {
      effortLevel: 'high',
      modelSettings: { [opus]: { effortLevel: 'nope' } },
    }
    const resolved = resolveEffortByModel({
      merged: user,
      sourcesLowToHigh: [user],
    })
    expect(resolved.byModel[opus]).toBeUndefined()
  })

  test('ultracode drops byModel', () => {
    const user: EffortSettingsSlice = {
      ultracode: true,
      effortLevel: 'low',
      modelSettings: { [opus]: { effortLevel: 'high' } },
    }
    const resolved = resolveEffortByModel({
      merged: user,
      sourcesLowToHigh: [user],
    })
    expect(resolved.byModel).toEqual({})
    expect(resolved.default).toBe('low')
  })

  test('settings schema keeps modelSettings effortLevel', () => {
    const parsed = SettingsSchema().safeParse({
      modelSettings: {
        [opus]: { effortLevel: 'high' },
        [sonnet]: { effortLevel: 'nope' },
      },
    })
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    expect(parsed.data.modelSettings?.[opus]?.effortLevel).toBe('high')
    expect(parsed.data.modelSettings?.[sonnet]?.effortLevel).toBeUndefined()
  })

  test('G3 persists low|medium|high|xhigh and drops max', () => {
    expect(parsePersistedEffortLevel('low')).toBe('low')
    expect(parsePersistedEffortLevel('medium')).toBe('medium')
    expect(parsePersistedEffortLevel('high')).toBe('high')
    expect(parsePersistedEffortLevel('xhigh')).toBe('xhigh')
    expect(parsePersistedEffortLevel('max')).toBeUndefined()
    const resolved = resolveEffortByModel({
      merged: { effortLevel: 'high' },
      sourcesLowToHigh: [{ modelSettings: { [opus]: { effortLevel: 'max' } } }],
    })
    expect(resolved.byModel[opus]).toBeUndefined()
  })

  test('K patch shape is modelSettings[canonical]; clear drops entry', () => {
    expect(effortModelSettingsPatch('Claude-Opus-5', 'xhigh')).toEqual({
      modelSettings: { [opus]: { effortLevel: 'xhigh' } },
    })
    expect(canonicalEffortModelKey('claude-opus-5-20260101')).toBe(opus)
    expect(effortModelClearPatch(opus).modelSettings?.[opus]).toBeUndefined()
  })

  test('ModelPicker confirm writes per-model effort; cycle does not unpin', () => {
    const pickerSrc = readFileSync(
      join(import.meta.dir, '../../components/ModelPicker.tsx'),
      'utf8',
    )
    const cycle = pickerSrc.slice(
      pickerSrc.indexOf('const handleCycleEffort'),
      pickerSrc.indexOf('useKeybindings'),
    )
    expect(cycle).not.toContain('unpinAllEffortLaunchPins')
    const confirm = pickerSrc.slice(
      pickerSrc.indexOf('const commitEffort'),
      pickerSrc.indexOf('if (!deferEffortApply)'),
    )
    expect(confirm).toContain('effortModelSettingsPatch')
    expect(confirm).toContain('unpinAllEffortLaunchPins')
    expect(confirm).toContain('readUserSettingsEffortForModel')
    expect(confirm).not.toContain(
      "getSettingsForSource('userSettings')?.effortLevel",
    )
    expect(confirm).not.toContain('getEffort')
  })

  test('there is no effortByModel string on the save path', () => {
    const effortSrc = readFileSync(
      join(import.meta.dir, '../effort.ts'),
      'utf8',
    )
    const commandSrc = readFileSync(
      join(import.meta.dir, '../../commands/effort/effort.tsx'),
      'utf8',
    )
    expect(effortSrc).not.toContain('effortByModel')
    expect(commandSrc).not.toContain('effortByModel')
    expect(commandSrc).toContain('effortModelSettingsPatch')
    expect(commandSrc).toContain('effortModelClearPatch')
    expect(effortSrc).toContain('getEnabledSettingSources')
    expect(effortSrc).toContain('parsePersistedEffortLevel')
    expect(effortSrc).toContain('readUserSettingsEffortForModel')
    // densable p5e = fn(Xe(Mt(e),{deterministic:!0})) — comment locks the gold chain
    expect(effortSrc).toContain('fn(Xe(Mt')
    expect(effortSrc).toContain('deterministic')
    expect(effortSrc).toContain('[1m]')
    const constantsSrc = readFileSync(
      join(import.meta.dir, '../settings/constants.ts'),
      'utf8',
    )
    expect(constantsSrc).toContain("result.add('flagSettings')")
    expect(constantsSrc).toContain("result.add('policySettings')")
  })
})
