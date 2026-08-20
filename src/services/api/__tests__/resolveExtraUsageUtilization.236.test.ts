import { describe, expect, test } from 'bun:test'
import { resolveExtraUsageUtilization } from '../usage.js'

describe('resolveExtraUsageUtilization', () => {
  test('prefers API utilization when present', () => {
    expect(
      resolveExtraUsageUtilization({
        utilization: 42,
        monthly_limit: 1000,
        used_credits: 0,
      }),
    ).toBe(42)
  })

  test('returns 0% before spend when used_credits=0 and monthly_limit>0', () => {
    expect(
      resolveExtraUsageUtilization({
        utilization: null,
        monthly_limit: 5000,
        used_credits: 0,
      }),
    ).toBe(0)
  })

  test('clamps used/limit*100 between 0 and 100', () => {
    expect(
      resolveExtraUsageUtilization({
        utilization: undefined,
        monthly_limit: 1000,
        used_credits: 250,
      }),
    ).toBe(25)
    expect(
      resolveExtraUsageUtilization({
        utilization: null,
        monthly_limit: 100,
        used_credits: 200,
      }),
    ).toBe(100)
  })

  test('returns 100 when monthly_limit is 0', () => {
    expect(
      resolveExtraUsageUtilization({
        utilization: null,
        monthly_limit: 0,
        used_credits: 0,
      }),
    ).toBe(100)
  })
})
