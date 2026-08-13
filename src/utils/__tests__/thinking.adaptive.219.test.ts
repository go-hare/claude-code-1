/**
 * densable 2.1.219 IQt / HQt / T5i — adaptive_thinking + rejects_disabled_thinking.
 */
import { afterAll, afterEach, describe, expect, mock, test } from 'bun:test'
import { growthbookMock } from '../../../tests/mocks/growthbook'
import * as realSettings from 'src/utils/settings/settings.js'
import {
  restoreSettingsMockWith,
  snapshotModuleExports,
} from '../../../tests/mocks/settings.js'

const settingsSnap = snapshotModuleExports(realSettings)

// Spread shared mock — incomplete growthbook mocks poison co-running suites.
// Always-true without afterAll restore bypasses sessionSpawnCaps amber_kestrel throw.
const realGrowthbook = await import('src/services/analytics/growthbook.js')
const growthbookSnap = snapshotModuleExports(realGrowthbook)
mock.module('src/services/analytics/growthbook.js', () => ({
  ...growthbookSnap,
  ...growthbookMock(),
  getFeatureValue_CACHED_MAY_BE_STALE: () => true,
}))

mock.module('src/utils/settings/settings.js', () => ({
  ...settingsSnap,
  getSettingsWithErrors: () => ({ settings: {}, errors: [] }),
}))
afterAll(() => {
  restoreSettingsMockWith(mock.module, settingsSnap)
  mock.module('src/services/analytics/growthbook.js', () => ({
    ...growthbookSnap,
  }))
})

// Do NOT mock providers globally in a way that poisons siblings — set via
// process env if needed. Default firstParty.

import {
  densableThinkingForceParams,
  isThinkingActiveForToolChoice,
  maySendDisabledThinking,
  modelRejectsDisabledThinking,
  modelSupportsAdaptiveThinking,
  modelSupportsThinking,
} from '../thinking.js'

afterEach(() => {
  delete process.env.CLAUDE_CODE_USE_BEDROCK
  delete process.env.CLAUDE_CODE_USE_VERTEX
  delete process.env.CLAUDE_CODE_USE_FOUNDRY
})

describe('densable 2.1.219 IQt modelSupportsAdaptiveThinking', () => {
  test('ON(adaptive_thinking) true for catalog positives', () => {
    for (const id of [
      'claude-opus-4-6',
      'claude-opus-4-7',
      'claude-opus-4-8',
      'claude-opus-5',
      'claude-sonnet-4-6',
      'claude-sonnet-5',
      'claude-fable-5',
    ]) {
      expect(modelSupportsAdaptiveThinking(id)).toBe(true)
    }
  })

  test('deny list: 3.x / early 4.x / haiku-4-5', () => {
    for (const id of [
      'claude-3-5-sonnet',
      'claude-opus-4-0',
      'claude-opus-4-1',
      'claude-opus-4-5',
      'claude-sonnet-4-0',
      'claude-sonnet-4-5',
      'claude-haiku-4-5',
    ]) {
      expect(modelSupportsAdaptiveThinking(id)).toBe(false)
    }
  })

  test('mythos-5 hard true even with empty capabilities', () => {
    expect(modelSupportsAdaptiveThinking('claude-mythos-5')).toBe(true)
  })

  test('dated / provider ids resolve via QO', () => {
    expect(modelSupportsAdaptiveThinking('claude-opus-4-7-20250514')).toBe(true)
    expect(modelSupportsAdaptiveThinking('us.anthropic.claude-opus-5')).toBe(
      true,
    )
    expect(modelSupportsAdaptiveThinking('claude-opus-4-20250514')).toBe(false) // → 4-0 deny
  })
})

describe('densable 2.1.219 HQt modelRejectsDisabledThinking', () => {
  test('only fable has rejects_disabled_thinking in EHl', () => {
    expect(modelRejectsDisabledThinking('claude-fable-5')).toBe(true)
    expect(modelRejectsDisabledThinking('claude-opus-5')).toBe(false)
    expect(modelRejectsDisabledThinking('claude-sonnet-5')).toBe(false)
  })

  test('kQt: fable → [undefined, 2048]; others → [false, 0]', () => {
    expect(densableThinkingForceParams('claude-fable-5')).toEqual([
      undefined,
      2048,
    ])
    expect(densableThinkingForceParams('claude-opus-5')).toEqual([false, 0])
  })

  test('maySendDisabledThinking is inverse of HQt', () => {
    expect(maySendDisabledThinking('claude-fable-5')).toBe(false)
    expect(maySendDisabledThinking('claude-opus-5')).toBe(true)
  })

  test('isThinkingActiveForToolChoice: densable ur', () => {
    // adaptive/enabled wire thinking → active for any model
    expect(
      isThinkingActiveForToolChoice({ type: 'adaptive' }, 'claude-opus-5'),
    ).toBe(true)
    expect(
      isThinkingActiveForToolChoice({ type: 'enabled' }, 'claude-opus-5'),
    ).toBe(true)
    // omitted thinking + HQt (fable) → treat as active (server default on)
    expect(isThinkingActiveForToolChoice(undefined, 'claude-fable-5')).toBe(
      true,
    )
    // omitted thinking + non-HQt → not active (local omit = off)
    expect(isThinkingActiveForToolChoice(undefined, 'claude-opus-5')).toBe(
      false,
    )
    // explicit disabled object should not be treated as adaptive/enabled
    expect(
      isThinkingActiveForToolChoice({ type: 'disabled' }, 'claude-opus-5'),
    ).toBe(false)
  })
})

describe('densable 2.1.219 T5i modelSupportsThinking', () => {
  test('non-claude-3 supports thinking', () => {
    expect(modelSupportsThinking('claude-opus-5')).toBe(true)
    expect(modelSupportsThinking('claude-haiku-4-5')).toBe(true)
    expect(modelSupportsThinking('claude-3-5-sonnet')).toBe(false)
  })
})
