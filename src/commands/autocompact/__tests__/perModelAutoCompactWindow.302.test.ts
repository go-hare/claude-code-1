import { describe, expect, test } from 'bun:test'
import {
  buildAutoCompactModelSettingsPatch,
  resolvePerModelAutoCompactWindow,
} from '../autocompact.js'
import {
  resolveAutoCompactWindow,
  resolvePerModelSettingsAutoCompactWindow,
} from '../../../utils/autoCompactWindow.js'
import { SettingsSchema } from '../../../utils/settings/types.js'

describe('2.1.302 #900 per-model modelSettings.<model>.autoCompactWindow', () => {
  test('SettingsSchema accepts modelSettings.<model>.autoCompactWindow as "auto" or integer in [100k, 1M]', () => {
    const okAuto = SettingsSchema().safeParse({
      modelSettings: {
        'claude-opus-4-1': { autoCompactWindow: 'auto' },
      },
    })
    expect(okAuto.success).toBe(true)

    const okNum = SettingsSchema().safeParse({
      modelSettings: {
        'claude-opus-4-1': { autoCompactWindow: 200_000 },
      },
    })
    expect(okNum.success).toBe(true)

    const badSmall = SettingsSchema().safeParse({
      modelSettings: {
        'claude-opus-4-1': { autoCompactWindow: 50_000 },
      },
    })
    // .catch(undefined) preserves valid object with undefined field
    expect(badSmall.success).toBe(true)
    if (badSmall.success) {
      expect(
        badSmall.data.modelSettings?.['claude-opus-4-1']?.autoCompactWindow,
      ).toBeUndefined()
    }
  })

  test('buildAutoCompactModelSettingsPatch keys by canonical model name even with gateway prefix', () => {
    const patch = buildAutoCompactModelSettingsPatch(
      'anthropic/claude-opus-4-1',
      { autoCompactWindow: 250_000 },
      { autoCompactWindow: 250_000 },
    )
    expect(patch).toEqual({
      modelSettings: {
        'claude-opus-4-1': { autoCompactWindow: 250_000 },
      },
    })
  })

  test('resolvePerModelAutoCompactWindow matches prefixed/dated spellings and overrides top-level', () => {
    const settings = {
      autoCompactWindow: 400_000,
      modelSettings: {
        'claude-opus-4-1': { autoCompactWindow: 200_000 },
      },
    }
    expect(
      resolvePerModelAutoCompactWindow('anthropic/claude-opus-4-1', settings),
    ).toBe(200_000)
    expect(
      resolvePerModelAutoCompactWindow('claude-sonnet-4-6', settings),
    ).toBe(400_000)
  })

  test('resolvePerModelAutoCompactWindow treats per-model "auto" as undefined (overrides top-level)', () => {
    const settings = {
      autoCompactWindow: 400_000,
      modelSettings: {
        'claude-opus-4-1': { autoCompactWindow: 'auto' as const },
      },
    }
    expect(
      resolvePerModelAutoCompactWindow('anthropic/claude-opus-4-1', settings),
    ).toBeUndefined()
  })

  test('#900 resolvePerModelSettingsAutoCompactWindow & resolveAutoCompactWindow honor per-model settings', () => {
    const settings = {
      autoCompactWindow: 400_000,
      modelSettings: {
        'claude-opus-4-6': { autoCompactWindow: 250_000 },
        'claude-sonnet-4-6': { autoCompactWindow: 'auto' as const },
      },
    }
    const opusWin = resolvePerModelSettingsAutoCompactWindow(
      'anthropic/claude-opus-4-6[1m]',
      settings,
    )
    expect(opusWin).toBe(250_000)
    expect(resolveAutoCompactWindow('claude-opus-4-6', opusWin)).toMatchObject({
      window: 200_000,
      configured: 250_000,
      source: 'settings',
    })

    const sonnetWin = resolvePerModelSettingsAutoCompactWindow(
      'claude-sonnet-4-6',
      settings,
    )
    expect(sonnetWin).toBeUndefined()
  })
})
