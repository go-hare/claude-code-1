/**
 * Tests for src/utils/permissions/getNextPermissionMode.ts
 *
 * Covers the official 2.1.289 permission mode cycling logic:
 *   default → acceptEdits → plan
 *     ├─ if isBypassPermissionsModeAvailable → bypassPermissions → (auto if gated else default)
 *     ├─ else if isAutoModeAvailable && isAutoModeGateEnabled() → auto → default
 *     └─ else → default
 */
import { afterEach, describe, expect, test } from 'bun:test'
import type { ToolPermissionContext } from '../../../Tool.js'
import type { PermissionMode } from '../PermissionMode.js'
import { getNextPermissionMode } from '../getNextPermissionMode.js'
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

describe('getNextPermissionMode', () => {
  afterEach(() => {
    _setAutoModeGateEnabledForTesting(undefined)
  })

  describe('official 2.1.289 cycle order', () => {
    test('default → acceptEdits', () => {
      expect(getNextPermissionMode(makeContext('default'))).toBe('acceptEdits')
    })

    test('acceptEdits → plan', () => {
      expect(getNextPermissionMode(makeContext('acceptEdits'))).toBe('plan')
    })

    test('plan → bypassPermissions when bypass is available', () => {
      _setAutoModeGateEnabledForTesting(true)
      expect(getNextPermissionMode(makeContext('plan'))).toBe(
        'bypassPermissions',
      )
    })

    test('bypassPermissions → auto when auto mode is available and gated', () => {
      _setAutoModeGateEnabledForTesting(true)
      expect(getNextPermissionMode(makeContext('bypassPermissions'))).toBe(
        'auto',
      )
    })

    test('bypassPermissions → default when auto mode is unavailable or gate disabled', () => {
      _setAutoModeGateEnabledForTesting(false)
      expect(getNextPermissionMode(makeContext('bypassPermissions'))).toBe(
        'default',
      )

      _setAutoModeGateEnabledForTesting(true)
      expect(
        getNextPermissionMode(
          makeContext('bypassPermissions', { isAutoModeAvailable: false }),
        ),
      ).toBe('default')
    })

    test('auto → default', () => {
      expect(getNextPermissionMode(makeContext('auto'))).toBe('default')
    })

    test('full cycle completes back to default', () => {
      _setAutoModeGateEnabledForTesting(true)
      const cycle: PermissionMode[] = []
      let ctx = makeContext('default')
      for (let i = 0; i < 5; i++) {
        const next = getNextPermissionMode(ctx)
        cycle.push(next)
        ctx = makeContext(next)
      }
      expect(cycle).toEqual([
        'acceptEdits',
        'plan',
        'bypassPermissions',
        'auto',
        'default',
      ])
    })
  })

  describe('plan transition with bypass unavailable', () => {
    test('plan → auto when bypass unavailable and auto gated', () => {
      _setAutoModeGateEnabledForTesting(true)
      const ctx = makeContext('plan', {
        isBypassPermissionsModeAvailable: false,
        isAutoModeAvailable: true,
      })
      expect(getNextPermissionMode(ctx)).toBe('auto')
    })

    test('plan → default when both bypass and auto are unavailable', () => {
      _setAutoModeGateEnabledForTesting(false)
      const ctx = makeContext('plan', {
        isBypassPermissionsModeAvailable: false,
      })
      expect(getNextPermissionMode(ctx)).toBe('default')
    })
  })

  describe('dontAsk mode', () => {
    test('dontAsk → default', () => {
      expect(getNextPermissionMode(makeContext('dontAsk'))).toBe('default')
    })
  })

  describe('no USER_TYPE distinction', () => {
    test('cycle order is the same regardless of USER_TYPE', () => {
      _setAutoModeGateEnabledForTesting(true)
      const originalUserType = process.env.USER_TYPE

      delete process.env.USER_TYPE
      const cycleNoType: PermissionMode[] = []
      let ctx = makeContext('default')
      for (let i = 0; i < 5; i++) {
        const next = getNextPermissionMode(ctx)
        cycleNoType.push(next)
        ctx = makeContext(next)
      }

      process.env.USER_TYPE = 'ant'
      const cycleAnt: PermissionMode[] = []
      ctx = makeContext('default')
      for (let i = 0; i < 5; i++) {
        const next = getNextPermissionMode(ctx)
        cycleAnt.push(next)
        ctx = makeContext(next)
      }

      if (originalUserType !== undefined) {
        process.env.USER_TYPE = originalUserType
      } else {
        delete process.env.USER_TYPE
      }

      expect(cycleNoType).toEqual(cycleAnt)
      expect(cycleNoType).toEqual([
        'acceptEdits',
        'plan',
        'bypassPermissions',
        'auto',
        'default',
      ])
    })
  })

  describe('teamContext parameter', () => {
    test('does not affect cycle when provided', () => {
      const ctx = makeContext('default')
      const teamCtx = { leadAgentId: 'agent-123' }
      expect(getNextPermissionMode(ctx, teamCtx)).toBe('acceptEdits')
    })

    test('does not affect cycle for plan mode', () => {
      const ctx = makeContext('plan')
      const teamCtx = { leadAgentId: 'agent-456' }
      expect(getNextPermissionMode(ctx, teamCtx)).toBe('bypassPermissions')
    })
  })

  describe('cycle stability', () => {
    test('all modes return to default within 6 steps', () => {
      _setAutoModeGateEnabledForTesting(true)
      const modes: PermissionMode[] = [
        'default',
        'acceptEdits',
        'plan',
        'auto',
        'bypassPermissions',
        'dontAsk',
      ]
      for (const startMode of modes) {
        let current = startMode
        let returnedToDefault = false
        for (let i = 0; i < 6; i++) {
          current = getNextPermissionMode(makeContext(current))
          if (current === 'default') {
            returnedToDefault = true
            break
          }
        }
        expect(returnedToDefault).toBe(true)
      }
    })

    test('cycling 100 times never produces an invalid mode', () => {
      const validModes = new Set<string>([
        'default',
        'acceptEdits',
        'plan',
        'auto',
        'bypassPermissions',
        'dontAsk',
      ])
      let ctx = makeContext('default')
      for (let i = 0; i < 100; i++) {
        const next = getNextPermissionMode(ctx)
        expect(validModes.has(next)).toBe(true)
        ctx = makeContext(next)
      }
    })
  })
})
