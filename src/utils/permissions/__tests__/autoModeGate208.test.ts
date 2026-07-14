import { afterEach, describe, expect, test } from 'bun:test'
import {
  getAutoModeUnavailableNotification,
  getAutoModeUnavailableReason,
  isAutoModeGateEnabled,
} from '../permissionSetup.js'
import { _resetForTesting, setAutoModeCircuitBroken } from '../autoModeState.js'
import {
  planModelSupportsAutoMode,
  providerSupportsAutoMode,
} from '../../betas.js'

afterEach(() => {
  _resetForTesting()
})

describe('providerSupportsAutoMode (official t8t)', () => {
  test('always true for firstParty and 3P (no ENABLE_AUTO_MODE opt-in)', () => {
    expect(providerSupportsAutoMode('firstParty')).toBe(true)
    expect(providerSupportsAutoMode('bedrock')).toBe(true)
    expect(providerSupportsAutoMode('vertex')).toBe(true)
    expect(providerSupportsAutoMode('foundry')).toBe(true)
    expect(providerSupportsAutoMode('openai')).toBe(true)
  })
})

describe('planModelSupportsAutoMode (official u3e densable)', () => {
  test('denies claude-3 and older 4.x denylist', () => {
    expect(
      planModelSupportsAutoMode('claude-3-5-sonnet-20241022', 'firstParty'),
    ).toBe(false)
    expect(planModelSupportsAutoMode('claude-opus-4-0', 'firstParty')).toBe(
      false,
    )
    expect(planModelSupportsAutoMode('claude-opus-4-1', 'firstParty')).toBe(
      false,
    )
    expect(planModelSupportsAutoMode('claude-opus-4-5', 'firstParty')).toBe(
      false,
    )
    expect(planModelSupportsAutoMode('claude-sonnet-4-0', 'firstParty')).toBe(
      false,
    )
    expect(planModelSupportsAutoMode('claude-sonnet-4-5', 'firstParty')).toBe(
      false,
    )
    expect(planModelSupportsAutoMode('claude-haiku-4-5', 'firstParty')).toBe(
      false,
    )
  })

  test('allows modern firstParty models', () => {
    expect(planModelSupportsAutoMode('claude-opus-4-6', 'firstParty')).toBe(
      true,
    )
    expect(planModelSupportsAutoMode('claude-sonnet-4-6', 'firstParty')).toBe(
      true,
    )
    expect(planModelSupportsAutoMode('claude-opus-4-7', 'firstParty')).toBe(
      true,
    )
  })

  test('3P denies opus-4-6 / sonnet-4-6 / haiku; allows others', () => {
    expect(planModelSupportsAutoMode('claude-opus-4-6', 'bedrock')).toBe(false)
    expect(planModelSupportsAutoMode('claude-sonnet-4-6', 'vertex')).toBe(false)
    expect(planModelSupportsAutoMode('claude-haiku-4-5', 'bedrock')).toBe(false)
    // 3P still allows e.g. opus-4-7 if not on denylist
    expect(planModelSupportsAutoMode('claude-opus-4-7', 'bedrock')).toBe(true)
  })
})

describe('isAutoModeGateEnabled (official sR) — feature-off test env', () => {
  test('closed when TRANSCRIPT_CLASSIFIER feature is off in unit tests', () => {
    // permissionSetup loads autoModeStateModule only when feature is on;
    // unit tests run with feature off → gate closed without model resolve.
    setAutoModeCircuitBroken(true)
    expect(isAutoModeGateEnabled()).toBe(false)
    setAutoModeCircuitBroken(false)
    expect(isAutoModeGateEnabled()).toBe(false)
    // Reason path: settings/circuit skipped → provider open → model (feature off)
    expect(getAutoModeUnavailableReason()).toBe('model')
  })
})

describe('getAutoModeUnavailableNotification (official tue)', () => {
  test('provider residual string matches official', () => {
    expect(getAutoModeUnavailableNotification('provider')).toBe(
      'auto mode requires CLAUDE_CODE_ENABLE_AUTO_MODE=1',
    )
  })

  test('settings / circuit-breaker / model strings', () => {
    expect(getAutoModeUnavailableNotification('settings')).toBe(
      'auto mode disabled by settings',
    )
    expect(getAutoModeUnavailableNotification('circuit-breaker')).toBe(
      'auto mode is unavailable for your plan',
    )
    expect(getAutoModeUnavailableNotification('model')).toBe(
      'auto mode unavailable for this model',
    )
  })
})
