/**
 * densable 2.1.251 #18 leftover — `hM` / `o5` policy-error gate.
 * Does not mock settings.ts (process-global pollution).
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { clearMdmSettingsCache, setMdmSettingsCache } from '../mdm/settings.js'
import { resetSettingsCache } from '../settingsCache.js'
import {
  canTrustAdminPolicyCascade,
  getNonWarningAdminPolicyLoadErrors,
  hasAdminPolicySurvivor,
} from '../settings.js'
import type { ValidationError } from '../validation.js'

const EMPTY = { settings: {}, errors: [] as ValidationError[] }

afterEach(() => {
  clearMdmSettingsCache()
  resetSettingsCache()
})

describe('densable 2.1.251 #18 hM / o5', () => {
  test('hM drops warning-only admin load errors', () => {
    setMdmSettingsCache(
      {
        settings: {},
        errors: [
          { path: 'mdm', message: 'alias', severity: 'warning' },
          { path: 'mdm', message: 'unreadable', severity: 'fatal' },
        ],
      },
      EMPTY,
    )
    resetSettingsCache()
    expect(
      getNonWarningAdminPolicyLoadErrors().map(error => error.message),
    ).toEqual(['unreadable'])
  })

  test('o5 is false when no admin settings survived', () => {
    setMdmSettingsCache(EMPTY, EMPTY)
    resetSettingsCache()
    expect(hasAdminPolicySurvivor()).toBe(false)
  })

  test('o5 is true when MDM settings survived', () => {
    setMdmSettingsCache(
      { settings: { disableAutoMode: 'disable' }, errors: [] },
      EMPTY,
    )
    resetSettingsCache()
    expect(hasAdminPolicySurvivor()).toBe(true)
  })

  test('refuse cascade-trust when a policy source failed and nothing survived', () => {
    setMdmSettingsCache(
      {
        settings: {},
        errors: [{ path: 'mdm', message: 'could not be read' }],
      },
      EMPTY,
    )
    resetSettingsCache()
    expect(canTrustAdminPolicyCascade()).toBe(false)
  })

  test('warnings do not refuse cascade-trust', () => {
    setMdmSettingsCache(
      {
        settings: {},
        errors: [{ path: 'mdm', message: 'alias', severity: 'warning' }],
      },
      EMPTY,
    )
    resetSettingsCache()
    expect(canTrustAdminPolicyCascade()).toBe(true)
  })

  test('survivor still trusts the remaining admin tier', () => {
    setMdmSettingsCache(
      {
        settings: { disableAutoMode: 'disable' },
        errors: [{ path: 'drop-in', message: 'could not be read' }],
      },
      EMPTY,
    )
    resetSettingsCache()
    expect(canTrustAdminPolicyCascade()).toBe(true)
  })
})
