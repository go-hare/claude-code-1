/**
 * densable 2.1.251 #18 leftover — `Qan` origin + iJt policy-error gate.
 * Anthropic MDM/remote policy sources are product-cut: Qan is always false.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import type { ToolPermissionContext } from '../../../Tool.js'
import { resetSettingsCache } from '../../settings/settingsCache.js'
import {
  applyManagedAutoModeExit,
  isManagedAutoModeSession,
  managedPolicyDisablesAutoModeFromTrustedOrigin,
} from '../permissionSetup.js'

function ctx(mode: ToolPermissionContext['mode']): ToolPermissionContext {
  return { mode } as ToolPermissionContext
}

afterEach(() => {
  resetSettingsCache()
})

describe('densable 2.1.251 #18 Qan + iJt gate product-cut', () => {
  test('Qan is false without MDM/remote policy', () => {
    expect(managedPolicyDisablesAutoModeFromTrustedOrigin()).toBe(false)
  })

  test('trusted policy disable does not fire without a policy source', () => {
    expect(applyManagedAutoModeExit(ctx('auto')).mode).toBe('auto')
  })

  test('Bdt is true for plan with auto stash', () => {
    expect(
      isManagedAutoModeSession({
        mode: 'plan',
        strippedDangerousRules: {},
      } as ToolPermissionContext),
    ).toBe(true)
    expect(isManagedAutoModeSession(ctx('default'))).toBe(false)
  })
})
