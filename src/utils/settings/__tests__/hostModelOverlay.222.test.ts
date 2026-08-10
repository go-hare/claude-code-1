/**
 * densable 2.1.222 #16 — CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST:
 * host model-selection keys beat stale on-disk managed-settings.json.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import {
  getParentManagedSettings,
  setParentManagedSettings,
} from '../../../bootstrap/state.js'
import {
  applyHostManagedPolicyModelPrecedence,
  buildHostModelOverlay,
  HOST_MODEL_POLICY_STRIP_ENV_KEYS,
  stripHostManagedPolicyModelKeys,
} from '../hostModelOverlay.js'
import type { SettingsJson } from '../types.js'

afterEach(() => {
  setParentManagedSettings(null)
  delete process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST
})

describe('densable Gfg buildHostModelOverlay', () => {
  test('null when host flag off or parent missing', () => {
    expect(
      buildHostModelOverlay({ model: 'opus' } as SettingsJson, false),
    ).toBeNull()
    expect(buildHostModelOverlay(null, true)).toBeNull()
    expect(buildHostModelOverlay(undefined, true)).toBeNull()
  })

  test('copies model / availableModels / enforce / fallbackModel only', () => {
    const parent = {
      model: 'host-opus',
      availableModels: ['opus', 'sonnet'],
      enforceAvailableModels: true,
      fallbackModel: ['sonnet'],
      permissions: { allow: ['Bash'] },
    } as SettingsJson
    expect(buildHostModelOverlay(parent, true)).toEqual({
      model: 'host-opus',
      availableModels: ['opus', 'sonnet'],
      enforceAvailableModels: true,
      fallbackModel: ['sonnet'],
    })
  })

  test('returns null when parent has no model-selection keys', () => {
    expect(
      buildHostModelOverlay(
        { permissions: { allow: [] } } as SettingsJson,
        true,
      ),
    ).toBeNull()
  })
})

describe('densable b6i stripHostManagedPolicyModelKeys', () => {
  test('deletes model, fallbackModel, modelOverrides', () => {
    const s = {
      model: 'stale-disk',
      fallbackModel: ['haiku'],
      modelOverrides: { 'claude-opus-4-6': 'arn:aws:...' },
      availableModels: ['opus'],
      env: {
        ANTHROPIC_MODEL: 'stale',
        ANTHROPIC_SMALL_FAST_MODEL_AWS_REGION: 'us-east-1',
        FOO: 'bar',
        CLAUDE_CODE_AUTO_MODE_MODEL: 'auto',
      },
    } as SettingsJson
    stripHostManagedPolicyModelKeys(s)
    expect(s.model).toBeUndefined()
    expect(s.fallbackModel).toBeUndefined()
    expect(s.modelOverrides).toBeUndefined()
    // availableModels intentionally NOT stripped by b6i (only overlay replaces)
    expect(s.availableModels).toEqual(['opus'])
    expect(s.env).toEqual({
      ANTHROPIC_SMALL_FAST_MODEL_AWS_REGION: 'us-east-1',
      FOO: 'bar',
    })
  })

  test('Wfg includes p9r-minus-aws-region + f9r + classifier/collapse models', () => {
    expect(HOST_MODEL_POLICY_STRIP_ENV_KEYS.has('ANTHROPIC_MODEL')).toBe(true)
    expect(
      HOST_MODEL_POLICY_STRIP_ENV_KEYS.has(
        'ANTHROPIC_SMALL_FAST_MODEL_AWS_REGION',
      ),
    ).toBe(false)
    expect(
      HOST_MODEL_POLICY_STRIP_ENV_KEYS.has('ANTHROPIC_CUSTOM_MODEL_OPTION'),
    ).toBe(true)
    expect(
      HOST_MODEL_POLICY_STRIP_ENV_KEYS.has('CLAUDE_CODE_AUTO_MODE_MODEL'),
    ).toBe(true)
    expect(
      HOST_MODEL_POLICY_STRIP_ENV_KEYS.has('CLAUDE_CODE_BG_CLASSIFIER_MODEL'),
    ).toBe(true)
    expect(
      HOST_MODEL_POLICY_STRIP_ENV_KEYS.has('CLAUDE_CONTEXT_COLLAPSE_MODEL'),
    ).toBe(true)
  })
})

describe('densable nfc applyHostManagedPolicyModelPrecedence', () => {
  test('without host flag: policy pass-through', () => {
    const policy = { model: 'disk-model' } as SettingsJson
    expect(applyHostManagedPolicyModelPrecedence(policy, null, false)).toBe(
      policy,
    )
  })

  test('host flag: strip disk model then assign host overlay', () => {
    const disk = {
      model: 'stale-managed-settings',
      fallbackModel: ['old'],
      modelOverrides: { a: 'b' },
      availableModels: ['stale-only'],
      env: { ANTHROPIC_MODEL: 'stale', KEEP: '1' },
    } as SettingsJson
    const overlay = buildHostModelOverlay(
      {
        model: 'host-model',
        availableModels: ['host-a', 'host-b'],
        fallbackModel: ['host-fb'],
      } as SettingsJson,
      true,
    )
    const out = applyHostManagedPolicyModelPrecedence(disk, overlay, true)
    expect(out).not.toBe(disk) // clone
    expect(out?.model).toBe('host-model')
    expect(out?.availableModels).toEqual(['host-a', 'host-b'])
    expect(out?.fallbackModel).toEqual(['host-fb'])
    expect(out?.modelOverrides).toBeUndefined()
    expect(out?.env).toEqual({ KEEP: '1' })
  })

  test('host flag + overlay only (no admin disk) still returns host keys', () => {
    const overlay = { model: 'host-only' } as ReturnType<
      typeof buildHostModelOverlay
    >
    const out = applyHostManagedPolicyModelPrecedence(null, overlay, true)
    expect(out?.model).toBe('host-only')
  })

  test('host flag without overlay still strips disk model keys', () => {
    const disk = {
      model: 'stale',
      modelOverrides: { x: 'y' },
    } as SettingsJson
    const out = applyHostManagedPolicyModelPrecedence(disk, null, true)
    expect(out?.model).toBeUndefined()
    expect(out?.modelOverrides).toBeUndefined()
  })
})

describe('parentManagedSettings bootstrap (densable tNi/rNi)', () => {
  test('set/get parent managed settings', () => {
    expect(getParentManagedSettings()).toBeNull()
    setParentManagedSettings({ model: 'from-parent' })
    expect(getParentManagedSettings()).toEqual({ model: 'from-parent' })
    setParentManagedSettings(null)
    expect(getParentManagedSettings()).toBeNull()
  })
})
