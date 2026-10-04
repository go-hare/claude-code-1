/**
 * densable 2.1.251 #18 leftover — `hM` / `o5` policy-error gate.
 * Anthropic MDM/file policy sources are product-cut: no admin errors, no survivor.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { resetSettingsCache } from '../settingsCache.js'
import {
  canTrustAdminPolicyCascade,
  getNonWarningAdminPolicyLoadErrors,
  hasAdminPolicySurvivor,
} from '../settings.js'

afterEach(() => {
  resetSettingsCache()
})

describe('densable 2.1.251 #18 hM / o5 product-cut', () => {
  test('hM is empty without MDM/file policy sources', () => {
    expect(getNonWarningAdminPolicyLoadErrors()).toEqual([])
  })

  test('o5 is false when no admin settings survived', () => {
    expect(hasAdminPolicySurvivor()).toBe(false)
  })

  test('cascade-trust is allowed when there are no load errors', () => {
    expect(canTrustAdminPolicyCascade()).toBe(true)
  })
})
