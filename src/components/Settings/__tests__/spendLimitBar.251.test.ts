import { afterEach, describe, expect, test } from 'bun:test'
import {
  areLimitsObserved,
  emitStatusChange,
  resetCurrentLimits,
} from '../../../services/claudeAiLimits.js'
import {
  SPEND_LIMIT_EMPTY_PLACEHOLDER,
  spendLimitBarProps,
} from '../spendLimitBar.js'

afterEach(() => {
  resetCurrentLimits()
})

describe('spendLimitBarProps Dl', () => {
  test('rounds utilization to a percent and converts unix seconds to ISO', () => {
    expect(
      spendLimitBarProps({
        utilization: 0.335,
        resets_at: 1_700_000_000,
      }),
    ).toEqual({
      type: 'bar',
      title: 'Spend limit',
      utilization: 34,
      resetsAtIso: '2023-11-14T22:13:20.000Z',
      alwaysShowDateInReset: true,
    })
  })

  test('missing overage + !HPe shows gold empty-window placeholder (U+00B7)', () => {
    expect(areLimitsObserved()).toBe(false)
    expect(spendLimitBarProps(undefined)).toEqual({
      type: 'placeholder',
      text: SPEND_LIMIT_EMPTY_PLACEHOLDER,
    })
    expect(SPEND_LIMIT_EMPTY_PLACEHOLDER).toBe(
      'Spend limit · shown once your gateway reports one',
    )
    expect(SPEND_LIMIT_EMPTY_PLACEHOLDER).toContain('·')
  })

  test('missing overage + HPe (limitsObserved) hides the section', () => {
    emitStatusChange({
      status: 'allowed',
      unifiedRateLimitFallbackAvailable: false,
      isUsingOverage: false,
    })
    expect(areLimitsObserved()).toBe(true)
    expect(spendLimitBarProps(undefined)).toBeNull()
  })

  test('overage bar wins over HPe placeholder', () => {
    emitStatusChange({
      status: 'allowed',
      unifiedRateLimitFallbackAvailable: false,
      isUsingOverage: false,
    })
    expect(
      spendLimitBarProps({
        utilization: 0.5,
        resets_at: 1_700_000_000,
      })?.type,
    ).toBe('bar')
  })
})
