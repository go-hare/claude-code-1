/**
 * densable Veu SDs / lHr — xge("auto", …, "auto_default_nudge") + gate_off latch skip.
 */
import { describe, expect, test } from 'bun:test'
import {
  _resetForTesting,
  attachAnalyticsSink,
} from '../../services/analytics/index.js'
import type { AppState } from '../../state/AppStateStore.js'
import type { ToolPermissionContext } from '../../Tool.js'
import { _setAutoModeGateEnabledForTesting } from '../../utils/permissions/permissionSetup.js'
import {
  applyAutoDefaultNudgeAccept,
  AUTO_DEFAULT_NUDGE_TRIGGER,
  AUTO_DEFAULT_NUDGE_UNAVAILABLE_KEY,
  autoDefaultNudgeChoice,
  shouldLatchAutoDefaultNudge,
} from '../openAutoDefaultNudge.js'

function stubState(overrides: Partial<ToolPermissionContext> = {}): AppState {
  return {
    toolPermissionContext: {
      mode: 'default',
      additionalWorkingDirectories: new Map(),
      alwaysAllowRules: {},
      alwaysDenyRules: {},
      alwaysAskRules: {},
      isBypassPermissionsModeAvailable: false,
      isAutoModeAvailable: false,
      ...overrides,
    },
    notifications: { current: null, queue: [], pinned: [] },
  } as unknown as AppState
}

function withAnalyticsSink(
  run: (events: Array<{ name: string; meta: Record<string, unknown> }>) => void,
): void {
  const events: Array<{ name: string; meta: Record<string, unknown> }> = []
  _resetForTesting()
  attachAnalyticsSink({
    logEvent(name, metadata) {
      events.push({ name, meta: metadata as Record<string, unknown> })
    },
    async logEventAsync() {},
  })
  try {
    run(events)
  } finally {
    _resetForTesting()
  }
}

describe('Veu SDs / lHr', () => {
  test('xge trigger is auto_default_nudge', () => {
    expect(AUTO_DEFAULT_NUDGE_TRIGGER).toBe('auto_default_nudge')
  })

  test('lHr latches unless gate_off', () => {
    expect(shouldLatchAutoDefaultNudge('switched')).toBe(true)
    expect(shouldLatchAutoDefaultNudge('declined')).toBe(true)
    expect(shouldLatchAutoDefaultNudge('gate_off')).toBe(false)
  })

  test('lHr maps Qg cancelled to decline', () => {
    expect(autoDefaultNudgeChoice('accepted')).toBe('accept')
    expect(autoDefaultNudgeChoice('declined')).toBe('decline')
    expect(autoDefaultNudgeChoice('cancelled')).toBe('decline')
  })

  test('SDs FKe false → Idy + gate_off, no mode write', () => {
    let state = stubState({ isAutoModeAvailable: false })
    const toasts: Array<{ key: string }> = []
    const outcome = applyAutoDefaultNudgeAccept(
      state.toolPermissionContext,
      updater => {
        state = updater(state)
      },
      notif => {
        toasts.push(notif)
      },
    )
    expect(outcome).toBe('gate_off')
    expect(state.toolPermissionContext.mode).toBe('default')
    expect(toasts.some(n => n.key === AUTO_DEFAULT_NUDGE_UNAVAILABLE_KEY)).toBe(
      true,
    )
  })

  test('SDs FKe true → real xge("auto") + qLe auto_default_nudge', () => {
    withAnalyticsSink(events => {
      _setAutoModeGateEnabledForTesting(true)
      try {
        let state = stubState({ isAutoModeAvailable: true })
        const toasts: Array<{ key: string }> = []
        const outcome = applyAutoDefaultNudgeAccept(
          state.toolPermissionContext,
          updater => {
            state = updater(state)
          },
          notif => {
            toasts.push(notif)
          },
        )
        expect(outcome).toBe('switched')
        expect(state.toolPermissionContext.mode).toBe('auto')
        expect(toasts).toEqual([])
        expect(events).toContainEqual({
          name: 'permission_mode_changed',
          meta: {
            from_mode: 'default',
            to_mode: 'auto',
            trigger: 'auto_default_nudge',
          },
        })
      } finally {
        _setAutoModeGateEnabledForTesting(undefined)
      }
    })
  })
})
