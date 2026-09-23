import { describe, expect, test } from 'bun:test'
import type { ToolPermissionContext } from '../../../Tool.js'
import { exitAutoModeWhenManagedDisable } from '../permissionSetup.js'

function ctx(
  mode: ToolPermissionContext['mode'],
  prePlanMode?: ToolPermissionContext['prePlanMode'],
): ToolPermissionContext {
  return { mode, prePlanMode } as ToolPermissionContext
}

describe('exitAutoModeWhenManagedDisable (2.1.251 #18)', () => {
  test('policy disable moves auto back to default', () => {
    expect(exitAutoModeWhenManagedDisable(ctx('auto'), true).mode).toBe(
      'default',
    )
  })

  test('auto stays when policy does not disable it', () => {
    expect(exitAutoModeWhenManagedDisable(ctx('auto'), false).mode).toBe('auto')
  })

  test('clears a remembered auto prePlanMode', () => {
    const next = exitAutoModeWhenManagedDisable(ctx('plan', 'auto'), true)
    expect(next.mode).toBe('plan')
    expect(next.prePlanMode).toBe('default')
  })

  test('leaves an unrelated mode alone', () => {
    const next = exitAutoModeWhenManagedDisable(ctx('default'), true)
    expect(next.mode).toBe('default')
  })

  test('Bdt: plan + auto stash defuses auto availability (gold BFt)', () => {
    const next = exitAutoModeWhenManagedDisable(
      {
        mode: 'plan',
        prePlanMode: 'default',
        strippedDangerousRules: {},
        alwaysAllowRules: {},
      } as ToolPermissionContext,
      true,
    )
    expect(next.mode).toBe('plan')
    expect(next.isAutoModeAvailable).toBe(false)
    expect(next.canAutoClassifierRun).toBe(false)
  })
})
