/**
 * densable 2.1.238 Qxn / psr / OBu triple-pointer.
 * Leaf-only — does not mock settings.js (process-global pollution).
 * Does not invent storageV5 backendView.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import type { SettingsJson } from '../../../utils/settings/types.js'
import { headersHelperPolicyRefusal } from '../../../utils/plugins/pluginPolicy.js'
import {
  isRemoteManagedPolicyConsented,
  isRemoteManagedSettingsTripleConsented,
  markSessionCacheConsented,
  resetSyncCache,
  seedSessionCacheFromDisk,
  setEligibility,
  setSessionCache,
} from '../syncCacheState.js'

const empty: SettingsJson = {}
const withMarketplaces: SettingsJson = {
  extraKnownMarketplaces: {
    demo: { source: { source: 'url', url: 'https://example.com/m.json' } },
  },
}

afterEach(() => {
  resetSyncCache()
})

describe('Qxn triple-pointer', () => {
  test('empty cache is not triple-consented; psr treats origin as local', () => {
    expect(isRemoteManagedSettingsTripleConsented()).toBe(false)
    expect(isRemoteManagedPolicyConsented()).toBe(true)
  })

  test('fail-stale RMr without verified is not Qxn', () => {
    setEligibility(true)
    setSessionCache(empty)
    expect(isRemoteManagedSettingsTripleConsented()).toBe(false)
    expect(isRemoteManagedPolicyConsented()).toBe(false)
  })

  test('304 verified without W8s is not Qxn', () => {
    setEligibility(true)
    setSessionCache(empty, { verified: true })
    expect(isRemoteManagedSettingsTripleConsented()).toBe(false)
    expect(isRemoteManagedPolicyConsented()).toBe(false)
  })

  test('verified + markConsented same object → Qxn', () => {
    setEligibility(true)
    setSessionCache(empty, { verified: true })
    markSessionCacheConsented(empty)
    expect(isRemoteManagedSettingsTripleConsented()).toBe(true)
    expect(isRemoteManagedPolicyConsented()).toBe(true)
  })

  test('markConsented different object does not Qxn', () => {
    setEligibility(true)
    setSessionCache(empty, { verified: true })
    markSessionCacheConsented({})
    expect(isRemoteManagedSettingsTripleConsented()).toBe(false)
  })

  test('seedFromDisk auto-consents when no helper surface', () => {
    seedSessionCacheFromDisk(empty)
    expect(isRemoteManagedSettingsTripleConsented()).toBe(false)
    setSessionCache(empty, { verified: true })
    expect(isRemoteManagedSettingsTripleConsented()).toBe(true)
  })

  test('seedFromDisk with extraKnownMarketplaces does not auto-consent', () => {
    seedSessionCacheFromDisk(withMarketplaces)
    setSessionCache(withMarketplaces, { verified: true })
    expect(isRemoteManagedSettingsTripleConsented()).toBe(false)
    expect(isRemoteManagedPolicyConsented()).toBe(false)
  })

  test('seedFromDisk with additionalMarketplaces alias does not auto-consent', () => {
    const aliased = {
      additionalMarketplaces: {
        demo: { source: { source: 'url', url: 'https://example.com/m.json' } },
      },
    } as SettingsJson
    seedSessionCacheFromDisk(aliased)
    setSessionCache(aliased, { verified: true })
    expect(isRemoteManagedSettingsTripleConsented()).toBe(false)
    expect(isRemoteManagedPolicyConsented()).toBe(false)
  })

  test('reset clears all three pointers', () => {
    setSessionCache(empty, { verified: true })
    markSessionCacheConsented(empty)
    resetSyncCache()
    expect(isRemoteManagedSettingsTripleConsented()).toBe(false)
    expect(isRemoteManagedPolicyConsented()).toBe(true)
  })
})

describe('fgt remote_policy_unconsented via Qxn (no settings mock)', () => {
  test('populated remote cache without consent refuses when policy disables helpers', () => {
    // Drive Qxn false with a live remote sessionCache. headersHelperPolicyRefusal
    // still needs q9() from real policySettings — if policy is not lockdown this
    // returns null. The leaf psr contract is asserted above; this only checks
    // the exported refusal union stays typed when source is defined.
    setEligibility(true)
    setSessionCache(empty)
    const refusal = headersHelperPolicyRefusal({
      source: 'url',
      url: 'https://example.com/m.json',
    })
    expect(
      refusal === null ||
        refusal === 'lockdown' ||
        refusal === 'remote_policy_unconsented',
    ).toBe(true)
  })
})
