import { describe, expect, test } from 'bun:test'
import {
  COMPACT_REPLY_INSTRUCTIONS_TRAILER,
  hasCompactSummaryTag,
  hasUnclosedCompactSummaryTag,
} from '../prompt.js'
import {
  isEligibleForLongContextRefusalCompact,
  isLongContextCreditsRequiredMessage,
  STANDARD_CONTEXT_MAX_TOKENS,
} from '../reactiveCompact.js'
import type { AssistantMessage } from '../../../types/message.js'

function makeApiError(overrides: Partial<AssistantMessage>): AssistantMessage {
  return {
    type: 'assistant',
    uuid: '00000000-0000-0000-0000-000000000001',
    isApiErrorMessage: true,
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: 'API Error' }],
    },
    ...overrides,
  } as AssistantMessage
}

describe('compact #1279 & #1227', () => {
  test('hasUnclosedCompactSummaryTag detects unclosed <summary> outside <analysis>', () => {
    expect(hasCompactSummaryTag('no tags here')).toBe(false)
    expect(hasUnclosedCompactSummaryTag('no tags here')).toBe(false)
    expect(
      hasUnclosedCompactSummaryTag(
        '<analysis>thinking about <summary> tag</analysis>\n  <summary>\npartial summary',
      ),
    ).toBe(true)
    expect(
      hasUnclosedCompactSummaryTag(
        '<analysis><summary>only inside analysis</summary></analysis>\nplain text',
      ),
    ).toBe(false)
  })

  test('COMPACT_REPLY_INSTRUCTIONS_TRAILER requests <summary></summary> tags', () => {
    expect(COMPACT_REPLY_INSTRUCTIONS_TRAILER).toContain('<summary></summary>')
  })

  test('isLongContextCreditsRequiredMessage matches apiError and errorDetails', () => {
    expect(
      isLongContextCreditsRequiredMessage(
        makeApiError({ apiError: 'long_context_credits_required' as never }),
      ),
    ).toBe(true)
    expect(
      isLongContextCreditsRequiredMessage(
        makeApiError({
          errorDetails: 'Extra usage is required for long context',
        }),
      ),
    ).toBe(true)
    expect(
      isLongContextCreditsRequiredMessage(
        makeApiError({
          errorDetails: 'Usage credits are required for long context',
        }),
      ),
    ).toBe(true)
    expect(
      isLongContextCreditsRequiredMessage(
        makeApiError({ errorDetails: 'Some other rate limit' }),
      ),
    ).toBe(false)
  })

  test('isEligibleForLongContextRefusalCompact gates on <= 200K window and querySource', () => {
    const msg = makeApiError({
      errorDetails: 'Usage credits are required for long context',
    })
    expect(
      isEligibleForLongContextRefusalCompact(
        msg,
        STANDARD_CONTEXT_MAX_TOKENS,
        'repl_main_thread',
      ),
    ).toBe(true)
    expect(
      isEligibleForLongContextRefusalCompact(
        msg,
        1_000_000,
        'repl_main_thread',
      ),
    ).toBe(false)
    expect(
      isEligibleForLongContextRefusalCompact(
        msg,
        STANDARD_CONTEXT_MAX_TOKENS,
        'compact',
      ),
    ).toBe(false)
  })
})
