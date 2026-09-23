import { describe, expect, test } from 'bun:test'
import {
  extractRawUtilization,
  selectOpenRawUtilization,
} from '../claudeAiLimits.js'

describe('raw utilization overage', () => {
  test('reads overage utilization and reset headers', () => {
    const headers = new Headers({
      'anthropic-ratelimit-unified-overage-utilization': '0.4',
      'anthropic-ratelimit-unified-overage-reset': '1700000100',
    })
    expect(extractRawUtilization(headers)).toEqual({
      overage: { utilization: 0.4, resets_at: 1_700_000_100 },
    })
  })

  test('omits overage when either header is missing', () => {
    const headers = new Headers({
      'anthropic-ratelimit-unified-overage-utilization': '0.4',
    })
    expect(extractRawUtilization(headers)).toEqual({})
  })

  test('selectOpen keeps a future overage window and drops an expired one', () => {
    const now = 1_700_000_000
    expect(
      selectOpenRawUtilization(
        { overage: { utilization: 0.4, resets_at: now + 10 } },
        now,
      ),
    ).toEqual({ overage: { utilization: 0.4, resets_at: now + 10 } })
    expect(
      selectOpenRawUtilization(
        { overage: { utilization: 0.4, resets_at: now } },
        now,
      ),
    ).toEqual({})
  })
})
