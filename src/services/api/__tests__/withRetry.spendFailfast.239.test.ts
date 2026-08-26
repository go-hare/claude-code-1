/**
 * densable 2.1.239 #53 Rew / Cew — spend-limit and out-of-credits 429s
 * must not retry (including CLAUDE_CODE_RETRY_WATCHDOG).
 */
import { describe, expect, test } from 'bun:test'
import { APIError } from '@anthropic-ai/sdk'
import { isSpendLimitOrOutOfCreditsError } from '../withRetry.js'

function rateLimit(
  message: string,
  headers?: Record<string, string>,
): APIError {
  return new APIError(
    429,
    { type: 'error', error: { type: 'rate_limit_error', message } },
    message,
    new Headers(headers),
  )
}

describe('isSpendLimitOrOutOfCreditsError densable 2.1.239 Rew', () => {
  test('service_spend_limit_reached in message', () => {
    expect(
      isSpendLimitOrOutOfCreditsError(rateLimit('service_spend_limit_reached')),
    ).toBe(true)
  })

  test('n9f header org_spend_cap_reached always fails', () => {
    expect(
      isSpendLimitOrOutOfCreditsError(
        rateLimit('rate limited', {
          'anthropic-ratelimit-unified-overage-disabled-reason':
            'org_spend_cap_reached',
        }),
      ),
    ).toBe(true)
  })

  test('Y8f out_of_credits fails when no unified claim/overage-status', () => {
    expect(
      isSpendLimitOrOutOfCreditsError(
        rateLimit('rate limited', {
          'anthropic-ratelimit-unified-overage-disabled-reason':
            'out_of_credits',
        }),
      ),
    ).toBe(true)
  })

  test('Y8f out_of_credits with unified claim does not trip Rew', () => {
    expect(
      isSpendLimitOrOutOfCreditsError(
        rateLimit('rate limited', {
          'anthropic-ratelimit-unified-overage-disabled-reason':
            'out_of_credits',
          'anthropic-ratelimit-unified-representative-claim': '5h',
        }),
      ),
    ).toBe(false)
  })

  test('exceeded_limit body + Y8f reason fails', () => {
    expect(
      isSpendLimitOrOutOfCreditsError(
        rateLimit('exceeded_limit {"overageDisabledReason":"out_of_credits"}'),
      ),
    ).toBe(true)
  })

  test('non-429 is not Rew', () => {
    const err = new APIError(
      500,
      { type: 'error', error: { type: 'api_error', message: 'boom' } },
      'service_spend_limit_reached',
      new Headers(),
    )
    expect(isSpendLimitOrOutOfCreditsError(err)).toBe(false)
  })
})
