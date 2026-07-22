import { describe, expect, test } from 'bun:test'
import type { ToolPermissionContext } from '../../../Tool.js'
import {
  applyInheritedPermissionMode,
  sanitizeInheritedPermissionMode,
  setPermissionModeWithGuards,
} from '../permissionSetup.js'

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
