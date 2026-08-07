/**
 * densable 2.1.216 #34 — spend limit reject shows server user_facing reason.
 * Gold: Per(e) + Failed to update spend limit[: reason] / Could not update…
 */
import { AxiosError, AxiosHeaders } from 'axios'
import { describe, expect, test } from 'bun:test'
import {
  extractUserFacingApiErrorReason,
  formatSpendLimitNudgeFailedMessage,
  formatSpendLimitUpdateFailedMessage,
} from '../usageCredits.js'

function axiosErr(data: unknown, status = 400): AxiosError {
  return new AxiosError(
    'Request failed',
    'ERR_BAD_REQUEST',
    { headers: new AxiosHeaders() },
    {},
    {
      status,
      statusText: 'Bad Request',
      headers: {},
      config: { headers: new AxiosHeaders() },
      data,
    },
  )
}

describe('extractUserFacingApiErrorReason (densable Per)', () => {
  test('non-axios → null', () => {
    expect(extractUserFacingApiErrorReason(new Error('x'))).toBeNull()
    expect(extractUserFacingApiErrorReason(null)).toBeNull()
  })

  test('axios without user_facing visibility → null', () => {
    expect(
      extractUserFacingApiErrorReason(
        axiosErr({ error: { message: 'hidden', details: {} } }),
      ),
    ).toBeNull()
    expect(
      extractUserFacingApiErrorReason(
        axiosErr({
          error: {
            message: 'hidden',
            details: { error_visibility: 'internal' },
          },
        }),
      ),
    ).toBeNull()
  })

  test('user_facing message returned', () => {
    expect(
      extractUserFacingApiErrorReason(
        axiosErr({
          error: {
            message: 'Limit cannot exceed org max',
            details: { error_visibility: 'user_facing' },
          },
        }),
      ),
    ).toBe('Limit cannot exceed org max')
  })

  test('user_facing with null message → null', () => {
    expect(
      extractUserFacingApiErrorReason(
        axiosErr({
          error: {
            message: null,
            details: { error_visibility: 'user_facing' },
          },
        }),
      ),
    ).toBeNull()
  })
})

describe('spend limit failure copy (densable dialog + nudge)', () => {
  test('dialog: reason present', () => {
    expect(formatSpendLimitUpdateFailedMessage('too high')).toBe(
      'Failed to update spend limit: too high',
    )
  })

  test('dialog: no reason', () => {
    expect(formatSpendLimitUpdateFailedMessage(null)).toBe(
      'Failed to update spend limit',
    )
  })

  test('nudge: reason present', () => {
    expect(formatSpendLimitNudgeFailedMessage('org policy')).toBe(
      'Could not update your spend limit: org policy',
    )
  })

  test('nudge: no reason', () => {
    expect(formatSpendLimitNudgeFailedMessage(null)).toBe(
      'Could not update your spend limit. Press Enter to retry.',
    )
  })
})
