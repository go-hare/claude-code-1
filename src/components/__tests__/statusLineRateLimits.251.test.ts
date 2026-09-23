import { describe, expect, test } from 'bun:test'
import { statusLineRateLimits } from '../statusLineRateLimits.js'

const overage = { utilization: 0.335, resets_at: 1_700_000_000 }

describe('statusLineRateLimits X1e', () => {
  test('gateway overage becomes spend_limit without rounding', () => {
    expect(statusLineRateLimits({ overage }, 'gateway')).toEqual({
      spend_limit: {
        used_percentage: 33.5,
        resets_at: 1_700_000_000,
      },
    })
  })

  test('non-gateway overage is omitted', () => {
    expect(statusLineRateLimits({ overage }, 'firstParty')).toBeUndefined()
  })

  test('five_hour and seven_day stay utilization times 100', () => {
    expect(
      statusLineRateLimits(
        {
          five_hour: { utilization: 0.5, resets_at: 10 },
          seven_day: { utilization: 0.25, resets_at: 20 },
          overage,
        },
        'gateway',
      ),
    ).toEqual({
      five_hour: { used_percentage: 50, resets_at: 10 },
      seven_day: { used_percentage: 25, resets_at: 20 },
      spend_limit: { used_percentage: 33.5, resets_at: 1_700_000_000 },
    })
  })

  test('empty windows omit rate_limits', () => {
    expect(statusLineRateLimits({}, 'gateway')).toBeUndefined()
  })
})
