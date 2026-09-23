/**
 * densable 2.1.251 #18 leftover — `Qan` origin + iJt policy-error gate.
 * Does not mock settings.ts (process-global pollution).
 * `disableAutoModeExit.251.test.ts` keeps covering `BFt` with an explicit bool.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import {
  resetSyncCache,
  setEligibility,
  setSessionCache,
} from '../../../services/remoteManagedSettings/syncCacheState.js'
import type { ToolPermissionContext } from '../../../Tool.js'
import {
  clearMdmSettingsCache,
  setMdmSettingsCache,
} from '../../settings/mdm/settings.js'
import { resetSettingsCache } from '../../settings/settingsCache.js'
import type { SettingsJson } from '../../settings/types.js'
import type { ValidationError } from '../../settings/validation.js'
import {
  applyManagedAutoModeExit,
  isManagedAutoModeSession,
  managedPolicyDisablesAutoModeFromTrustedOrigin,
} from '../permissionSetup.js'

const EMPTY = { settings: {}, errors: [] as ValidationError[] }

function ctx(mode: ToolPermissionContext['mode']): ToolPermissionContext {
  return { mode } as ToolPermissionContext
}

afterEach(() => {
  resetSyncCache()
  clearMdmSettingsCache()
  resetSettingsCache()
})

describe('densable 2.1.251 #18 Qan + iJt gate', () => {
  test('Qan is true for MDM disableAutoMode (plist/hklm)', () => {
    setMdmSettingsCache(
      { settings: { disableAutoMode: 'disable' }, errors: [] },
      EMPTY,
    )
    resetSettingsCache()
    expect(managedPolicyDisablesAutoModeFromTrustedOrigin()).toBe(true)
  })

  test('Qan is false for HKCU-only disableAutoMode', () => {
    setMdmSettingsCache(EMPTY, {
      settings: { disableAutoMode: 'disable' },
      errors: [],
    })
    resetSettingsCache()
    expect(managedPolicyDisablesAutoModeFromTrustedOrigin()).toBe(false)
  })

  test('Qan is true for verified remote disableAutoMode', () => {
    const policy: SettingsJson = { disableAutoMode: 'disable' }
    setEligibility(true)
    setSessionCache(policy, { verified: true })
    resetSettingsCache()
    expect(managedPolicyDisablesAutoModeFromTrustedOrigin()).toBe(true)
  })

  test('Qan is false for unverified remote disableAutoMode', () => {
    const policy: SettingsJson = { disableAutoMode: 'disable' }
    setEligibility(true)
    setSessionCache(policy)
    resetSettingsCache()
    expect(managedPolicyDisablesAutoModeFromTrustedOrigin()).toBe(false)
  })

  test('trusted policy disable moves auto back to default', () => {
    setMdmSettingsCache(
      { settings: { disableAutoMode: 'disable' }, errors: [] },
      EMPTY,
    )
    resetSettingsCache()
    expect(applyManagedAutoModeExit(ctx('auto')).mode).toBe('default')
  })

  test('refuses cascade-trust when a policy source failed', () => {
    const policy: SettingsJson = { disableAutoMode: 'disable' }
    setEligibility(true)
    setSessionCache(policy, { verified: true })
    setMdmSettingsCache(
      {
        settings: {},
        errors: [{ path: 'mdm', message: 'could not be read' }],
      },
      EMPTY,
    )
    resetSettingsCache()
    expect(managedPolicyDisablesAutoModeFromTrustedOrigin()).toBe(true)
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

  test('warning-only load errors still exit auto', () => {
    const policy: SettingsJson = { disableAutoMode: 'disable' }
    setEligibility(true)
    setSessionCache(policy, { verified: true })
    setMdmSettingsCache(
      {
        settings: {},
        errors: [{ path: 'mdm', message: 'alias', severity: 'warning' }],
      },
      EMPTY,
    )
    resetSettingsCache()
    expect(applyManagedAutoModeExit(ctx('auto')).mode).toBe('default')
  })
})
