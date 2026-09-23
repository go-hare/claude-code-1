import { describe, expect, test } from 'bun:test'
import { spendLimitBarProps } from '../spendLimitBar.js'

describe('spendLimitBarProps Dl', () => {
  test('rounds utilization to a percent and converts unix seconds to ISO', () => {
    expect(
      spendLimitBarProps({
        utilization: 0.335,
        resets_at: 1_700_000_000,
      }),
    ).toEqual({
      title: 'Spend limit',
      utilization: 34,
      resetsAtIso: '2023-11-14T22:13:20.000Z',
      alwaysShowDateInReset: true,
    })
  })

  test('missing overage does not invent the HPe placeholder', () => {
    expect(spendLimitBarProps(undefined)).toBeNull()
  })
})
