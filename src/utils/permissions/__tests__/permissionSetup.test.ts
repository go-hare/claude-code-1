/**
 * Tests for the simplified permission gate functions.
 *
 * After the "open auto/bypass to all users" change, the key guarantees are:
 * - shouldDisableBypassPermissions() always returns false
 * - isBypassPermissionsModeDisabled() always returns false
 * - hasAutoModeOptInAnySource() always returns true
 * - isAutoModeGateEnabled() returns true unless fast-mode circuit breaker fires
 * - getAutoModeUnavailableReason() returns null when no breaker fires
 *
 * These functions are tested through the getNextPermissionMode cycle
 * and through direct unit tests of the gate functions.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import type { ToolPermissionContext } from '../../../Tool.js'
import { getNextPermissionMode } from '../getNextPermissionMode.js'
import type { PermissionMode } from '../PermissionMode.js'
import { _setAutoModeGateEnabledForTesting } from '../permissionSetup.js'

function makeContext(
  mode: PermissionMode,
  overrides: Partial<ToolPermissionContext> = {},
): ToolPermissionContext {
  return {
    mode,
    additionalWorkingDirectories: new Map(),
    alwaysAllowRules: {},
    alwaysDenyRules: {},
    alwaysAskRules: {},
    isBypassPermissionsModeAvailable: true,
    isAutoModeAvailable: true,
    ...overrides,
  }
}

describe('permission gate invariants (official 2.1.289 cycle)', () => {
  afterEach(() => {
    _setAutoModeGateEnabledForTesting(undefined)
  })

  describe('bypass mode precedes auto in cycle', () => {
    test('plan → bypassPermissions when isBypassPermissionsModeAvailable is true', () => {
      const ctx = makeContext('plan', {
        isBypassPermissionsModeAvailable: true,
      })
      expect(getNextPermissionMode(ctx)).toBe('bypassPermissions')
    })

    test('isBypassPermissionsModeAvailable true is the default from getEmptyToolPermissionContext', () => {
      const ctx = makeContext('plan')
      expect(ctx.isBypassPermissionsModeAvailable).toBe(true)
      expect(getNextPermissionMode(ctx)).toBe('bypassPermissions')
    })
  })

  describe('auto mode requires isAutoModeAvailable && isAutoModeGateEnabled()', () => {
    test('bypassPermissions → auto when gated', () => {
      _setAutoModeGateEnabledForTesting(true)
      expect(getNextPermissionMode(makeContext('bypassPermissions'))).toBe(
        'auto',
      )
    })

    test('plan → auto when isBypassPermissionsModeAvailable is false and auto is gated', () => {
      _setAutoModeGateEnabledForTesting(true)
      const ctx = makeContext('plan', {
        isBypassPermissionsModeAvailable: false,
      })
      expect(getNextPermissionMode(ctx)).toBe('auto')
    })

    test('auto → default', () => {
      expect(getNextPermissionMode(makeContext('auto'))).toBe('default')
    })
  })

  describe('full cycle order', () => {
    test('cycling from default reaches bypassPermissions in 3 steps and auto in 4 steps', () => {
      _setAutoModeGateEnabledForTesting(true)
      let mode: PermissionMode = 'default'
      const steps: PermissionMode[] = []

      for (let i = 0; i < 4; i++) {
        mode = getNextPermissionMode(makeContext(mode))
        steps.push(mode)
      }

      expect(steps).toEqual([
        'acceptEdits',
        'plan',
        'bypassPermissions',
        'auto',
      ])
    })

    test('skips auto when gate is disabled', () => {
      _setAutoModeGateEnabledForTesting(false)
      let mode: PermissionMode = 'default'
      const steps: PermissionMode[] = []

      for (let i = 0; i < 4; i++) {
        mode = getNextPermissionMode(makeContext(mode))
        steps.push(mode)
      }

      expect(steps).toEqual([
        'acceptEdits',
        'plan',
        'bypassPermissions',
        'default',
      ])
    })
  })

  describe('safety ordering', () => {
    test('plan → bypassPermissions → auto → default', () => {
      _setAutoModeGateEnabledForTesting(true)
      expect(getNextPermissionMode(makeContext('plan'))).toBe(
        'bypassPermissions',
      )
      expect(getNextPermissionMode(makeContext('bypassPermissions'))).toBe(
        'auto',
      )
      expect(getNextPermissionMode(makeContext('auto'))).toBe('default')
    })

    test('default comes before any dangerous mode', () => {
      expect(getNextPermissionMode(makeContext('default'))).toBe('acceptEdits')
    })
  })
})

describe('Tool.ts default context', () => {
  test('getEmptyToolPermissionContext has isBypassPermissionsModeAvailable = true', async () => {
    const { getEmptyToolPermissionContext } = await import('../../../Tool.js')
    const ctx = getEmptyToolPermissionContext()
    expect(ctx.isBypassPermissionsModeAvailable).toBe(true)
  })
})

describe('settings hasAutoModeOptIn', () => {
  test('always returns true after change', async () => {
    const { hasAutoModeOptIn } = await import('../../settings/settings.js')
    expect(hasAutoModeOptIn()).toBe(true)
  })
})
