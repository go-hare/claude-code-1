import { describe, expect, test } from 'bun:test'
import {
  _resetForTesting,
  attachAnalyticsSink,
} from '../../../services/analytics/index.js'
import type { ToolPermissionContext } from '../../../Tool.js'
import {
  _setAutoModeGateEnabledForTesting,
  applyInheritedPermissionMode,
  AUTO_GATE_DENIED_TRIGGER,
  EXIT_PLAN_MODE_TRIGGER,
  logPermissionModeChanged,
  sanitizeInheritedPermissionMode,
  setPermissionModeWithGuards,
} from '../permissionSetup.js'
import { onPermissionRecheck } from '../permissionRecheck.js'

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

function baseCtx(
  overrides: Partial<ToolPermissionContext> = {},
): ToolPermissionContext {
  return {
    mode: 'plan',
    additionalWorkingDirectories: new Map(),
    alwaysAllowRules: {},
    alwaysDenyRules: {},
    alwaysAskRules: {},
    isBypassPermissionsModeAvailable: false,
    ...overrides,
  }
}

describe('sanitizeInheritedPermissionMode (densable Urs)', () => {
  test('defaults undefined to default', () => {
    expect(sanitizeInheritedPermissionMode(undefined)).toBe('default')
  })
  test('passes acceptEdits', () => {
    expect(sanitizeInheritedPermissionMode('acceptEdits')).toBe('acceptEdits')
  })
})

describe('setPermissionModeWithGuards (densable Sce)', () => {
  test('rejects bypass when session did not launch with flag', () => {
    const ctx = baseCtx({ isBypassPermissionsModeAvailable: false })
    let written: ToolPermissionContext | null = null
    const result = setPermissionModeWithGuards('bypassPermissions', ctx, u => {
      written = u(ctx)
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('dangerously-skip-permissions')
    }
    expect(written).toBeNull()
  })

  test('accepts acceptEdits and transitions out of plan', () => {
    const ctx = baseCtx({ mode: 'plan', prePlanMode: 'default' })
    let written: ToolPermissionContext | undefined
    const result = setPermissionModeWithGuards('acceptEdits', ctx, u => {
      written = u(ctx)
    })
    expect(result.ok).toBe(true)
    expect(written).toBeDefined()
    expect(written!.mode).toBe('acceptEdits')
    // leaving plan clears prePlanMode via transitionPermissionMode
    expect(written!.prePlanMode).toBeUndefined()
  })

  test('qLe logs permission_mode_changed with xge trigger', () => {
    withAnalyticsSink(events => {
      const ctx = baseCtx({ mode: 'plan', prePlanMode: 'default' })
      const result = setPermissionModeWithGuards(
        'acceptEdits',
        ctx,
        u => {
          u(ctx)
        },
        'workflow_permission_prompt',
      )
      expect(result.ok).toBe(true)
      expect(events).toContainEqual({
        name: 'permission_mode_changed',
        meta: {
          from_mode: 'plan',
          to_mode: 'acceptEdits',
          trigger: 'workflow_permission_prompt',
        },
      })
    })
  })

  test('qLe omits trigger when xge 4th arg is absent', () => {
    withAnalyticsSink(events => {
      const ctx = baseCtx({ mode: 'plan', prePlanMode: 'default' })
      setPermissionModeWithGuards('acceptEdits', ctx, u => {
        u(ctx)
      })
      const changed = events.find(e => e.name === 'permission_mode_changed')
      expect(changed?.meta).toEqual({
        from_mode: 'plan',
        to_mode: 'acceptEdits',
      })
      expect(changed?.meta).not.toHaveProperty('trigger')
    })
  })

  test('qLe logs auto_default_nudge on real xge("auto")', () => {
    withAnalyticsSink(events => {
      _setAutoModeGateEnabledForTesting(true)
      try {
        const ctx = baseCtx({
          mode: 'default',
          isAutoModeAvailable: true,
        })
        let written: ToolPermissionContext | undefined
        const result = setPermissionModeWithGuards(
          'auto',
          ctx,
          u => {
            written = u(ctx)
          },
          'auto_default_nudge',
        )
        expect(result.ok).toBe(true)
        expect(written?.mode).toBe('auto')
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

  test('qLe auto_gate_denied and exit_plan_mode triggers', () => {
    withAnalyticsSink(events => {
      logPermissionModeChanged('auto', 'default', AUTO_GATE_DENIED_TRIGGER)
      logPermissionModeChanged('plan', 'acceptEdits', EXIT_PLAN_MODE_TRIGGER)
      expect(events).toContainEqual({
        name: 'permission_mode_changed',
        meta: {
          from_mode: 'auto',
          to_mode: 'default',
          trigger: 'auto_gate_denied',
        },
      })
      expect(events).toContainEqual({
        name: 'permission_mode_changed',
        meta: {
          from_mode: 'plan',
          to_mode: 'acceptEdits',
          trigger: 'exit_plan_mode',
        },
      })
    })
  })

  test('same mode skips qLe', () => {
    withAnalyticsSink(events => {
      const ctx = baseCtx({ mode: 'acceptEdits' })
      setPermissionModeWithGuards(
        'acceptEdits',
        ctx,
        u => {
          u(ctx)
        },
        'workflow_permission_prompt',
      )
      expect(events.some(e => e.name === 'permission_mode_changed')).toBe(false)
    })
  })

  test('Gqe.emit permissionRecheck after successful xge', async () => {
    const hits: number[] = []
    const off = onPermissionRecheck(() => {
      hits.push(1)
    })
    await new Promise<void>(resolve => {
      setImmediate(resolve)
    })
    hits.length = 0
    const ctx = baseCtx({ mode: 'plan', prePlanMode: 'default' })
    setPermissionModeWithGuards('acceptEdits', ctx, u => {
      u(ctx)
    })
    await new Promise<void>(resolve => {
      setImmediate(resolve)
    })
    off()
    expect(hits).toEqual([1])
  })
})

describe('applyInheritedPermissionMode (densable B$a)', () => {
  test('applies default and updates app state', () => {
    let state = { toolPermissionContext: baseCtx({ mode: 'plan' }) }
    const result = applyInheritedPermissionMode(
      'default',
      state.toolPermissionContext,
      f => {
        state = f(state) as typeof state
      },
    )
    expect(result.ok).toBe(true)
    expect(state.toolPermissionContext.mode).toBe('default')
  })

  test('force-enables bypass availability for lead-pushed bypass when not settings-disabled', () => {
    let state = {
      toolPermissionContext: baseCtx({
        mode: 'plan',
        isBypassPermissionsModeAvailable: false,
      }),
    }
    // May still fail if settings disable bypass; when settings allow, mode applies.
    const result = applyInheritedPermissionMode(
      'bypassPermissions',
      state.toolPermissionContext,
      f => {
        state = f(state) as typeof state
      },
    )
    // Either applied (settings allow) or refused with settings error — never silent
    if (result.ok) {
      expect(state.toolPermissionContext.mode).toBe('bypassPermissions')
      expect(state.toolPermissionContext.isBypassPermissionsModeAvailable).toBe(
        true,
      )
    } else {
      expect(result.error).toContain('bypassPermissions')
    }
  })
})
