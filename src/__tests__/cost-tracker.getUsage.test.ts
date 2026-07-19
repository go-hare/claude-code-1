import { describe, expect, test } from 'bun:test'
import { buildGetUsageControlResponse } from '../cost-tracker.js'

describe('buildGetUsageControlResponse densable xJr session slice', () => {
  test('returns session totals + null rate_limits/behaviors', () => {
    const payload = buildGetUsageControlResponse({
      subscriptionType: 'max',
      rateLimitsAvailable: true,
    })
    expect(payload.subscription_type).toBe('max')
    expect(payload.rate_limits_available).toBe(true)
    expect(payload.rate_limits).toBeNull()
    expect(payload.behaviors).toBeNull()
    expect(typeof payload.session.total_cost_usd).toBe('number')
    expect(typeof payload.session.total_api_duration_ms).toBe('number')
    expect(typeof payload.session.total_duration_ms).toBe('number')
    expect(typeof payload.session.total_lines_added).toBe('number')
    expect(typeof payload.session.total_lines_removed).toBe('number')
    expect(payload.session.model_usage).toBeDefined()
    expect(typeof payload.session.model_usage).toBe('object')
  })

  test('API-key path: null subscription + rateLimitsAvailable false', () => {
    const payload = buildGetUsageControlResponse({
      subscriptionType: null,
      rateLimitsAvailable: false,
    })
    expect(payload.subscription_type).toBeNull()
    expect(payload.rate_limits_available).toBe(false)
    expect(payload.rate_limits).toBeNull()
  })
})
