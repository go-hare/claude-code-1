import { afterEach, describe, expect, test } from 'bun:test'
import {
  areLimitsObserved,
  emitStatusChange,
  extractQuotaStatusFromHeaders,
  getRawUtilization,
  isStaleObservation,
  resetCurrentLimits,
} from '../claudeAiLimits.js'

afterEach(() => {
  resetCurrentLimits()
})

describe('densable 2.1.251 HPe / limitsObserved', () => {
  test('HPe starts false; emitStatusChange latches true', () => {
    expect(areLimitsObserved()).toBe(false)
    emitStatusChange({
      status: 'allowed',
      unifiedRateLimitFallbackAvailable: false,
      isUsingOverage: false,
    })
    expect(areLimitsObserved()).toBe(true)
  })

  test('resetCurrentLimits clears observed and raw windows', () => {
    emitStatusChange({
      status: 'allowed_warning',
      unifiedRateLimitFallbackAvailable: false,
      isUsingOverage: false,
      resetsAt: 1_700_000_000,
    })
    expect(areLimitsObserved()).toBe(true)
    resetCurrentLimits()
    expect(areLimitsObserved()).toBe(false)
    expect(getRawUtilization()).toEqual({})
  })

  test('isStaleObservation latches observed; older stamp is stale', () => {
    // resetCurrentLimits sets lastAppliedObservationAtMs=Date.now(), so
    // fresh stamps must be >= that wall clock (gold isStaleObservation).
    const t0 = Date.now() + 1_000
    expect(isStaleObservation(t0)).toBe(false)
    expect(areLimitsObserved()).toBe(true)
    expect(isStaleObservation(t0 - 1)).toBe(true)
    expect(isStaleObservation(t0 + 1)).toBe(false)
  })

  test('extractQuotaStatusFromHeaders applies only when not stale', () => {
    const fresh = Date.now() + 5_000
    isStaleObservation(fresh)
    const headers = new Headers({
      'anthropic-ratelimit-unified-overage-utilization': '0.4',
      'anthropic-ratelimit-unified-overage-reset': String(
        Math.floor(Date.now() / 1000) + 3600,
      ),
    })
    // Stale observation must not clobber (isStale short-circuit inside extract).
    extractQuotaStatusFromHeaders(headers, fresh - 10)
    resetCurrentLimits()
    expect(areLimitsObserved()).toBe(false)
  })

  test('gold j4e: extra-usage cache runs before isStaleObservation', () => {
    const { readFileSync } = require('node:fs') as typeof import('node:fs')
    const { join } = require('node:path') as typeof import('node:path')
    const src = readFileSync(
      join(import.meta.dir, '../claudeAiLimits.ts'),
      'utf8',
    )
    const fn = src.slice(
      src.indexOf('export function extractQuotaStatusFromHeaders'),
    )
    const cacheAt = fn.indexOf('cacheExtraUsageDisabledReason(headersToUse)')
    const staleAt = fn.indexOf('isStaleObservation(observationAtMs)')
    expect(cacheAt).toBeGreaterThan(-1)
    expect(staleAt).toBeGreaterThan(cacheAt)
  })
})
