/**
 * densable 2.1.283 thinking.display 400 retry (`Kue` @184975200).
 * Gold: vwe highlights pydantic string → x3r() + omitted retry;
 * Twe + $ce in last betas → jh sticky-reject + drop header.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { APIError } from '@anthropic-ai/sdk'
import { readFileSync } from 'fs'
import { join } from 'path'

import {
  getThinkingHighlightsRefused,
  isStickyBetaRejected,
  markThinkingHighlightsRefused,
  resetStateForTests,
  stickyRejectBeta,
} from '../../bootstrap/state.js'
import { THINKING_DISPLAY_UPDATES_BETA_HEADER } from '../../constants/betas.js'
import {
  classifyThinkingDisplayRetry,
  isThinkingDisplayHighlightsRejected,
  isThinkingDisplayUpdatesRejected,
  resolveOutgoingThinkingDisplay,
  THINKING_DISPLAY_HIGHLIGHTS_REJECTED_RE,
} from '../thinking.js'

const root = join(import.meta.dir, '../../..')
const src = (rel: string) => readFileSync(join(root, rel), 'utf8')

function api400(message: string): APIError {
  return new APIError(
    400,
    { type: 'error', error: { type: 'invalid_request_error', message } },
    message,
    new Headers(),
  )
}

afterEach(() => {
  resetStateForTests()
})

describe('densable 2.1.283 Kue thinking.display 400 retry', () => {
  test('source-lock vwe classifier string', () => {
    expect(THINKING_DISPLAY_HIGHLIGHTS_REJECTED_RE.source).toBe(
      'thinking\\.(adaptive|enabled)\\.display: Input should be ',
    )
    const thinking = src('src/utils/thinking.ts')
    expect(thinking).toContain(
      'thinking.(adaptive|enabled).display: Input should be ',
    )
    expect(thinking).toContain('densable `Kue` @184975200')
    expect(thinking).toContain('retry:thinking-display-highlights')
    expect(thinking).toContain('retry:thinking-display-updates')

    const claude = src('src/services/api/claude.ts')
    expect(claude).toContain('classifyThinkingDisplayRetry')
    expect(claude).toContain('onThinkingDisplayApiError')
    expect(claude).toContain('lastSentThinkingDisplay')

    const withRetry = src('src/services/api/withRetry.ts')
    expect(withRetry).toContain('densable `r.onError` @184899103')
    expect(withRetry).toContain('consumedOnErrorRetryTokens')
    expect(withRetry).toContain('await options.onError?.(error)')
  })

  test('vwe: 400 highlights pydantic → latch + omitted retry token', () => {
    const err = api400(
      'thinking.adaptive.display: Input should be summarized, omitted or updates',
    )
    expect(isThinkingDisplayHighlightsRejected(err)).toBe(true)
    expect(getThinkingHighlightsRefused()).toBe(false)

    const token = classifyThinkingDisplayRetry(
      err,
      'highlights',
      [],
      'claude-opus-4-6',
    )
    expect(token).toBe('retry:thinking-display-highlights')
    expect(getThinkingHighlightsRefused()).toBe(true)
    expect(
      resolveOutgoingThinkingDisplay('highlights', 'claude-opus-4-6', true),
    ).toBe('omitted')
  })

  test('vwe does not fire unless lastSentDisplay is highlights', () => {
    const err = api400(
      'thinking.enabled.display: Input should be summarized, omitted or updates',
    )
    expect(
      classifyThinkingDisplayRetry(err, 'summarized', [], 'claude-opus-4-6'),
    ).toBeNull()
    expect(getThinkingHighlightsRefused()).toBe(false)
  })

  test('Twe + $ce in last betas → sticky-reject updates header', () => {
    const header = THINKING_DISPLAY_UPDATES_BETA_HEADER
    const err = api400(
      `invalid anthropic-beta: ${header} is not supported on this endpoint`,
    )
    expect(isThinkingDisplayUpdatesRejected(err)).toBe(true)
    expect(isStickyBetaRejected(header)).toBe(false)

    const token = classifyThinkingDisplayRetry(
      err,
      'updates',
      [header],
      'claude-opus-4-6',
    )
    expect(token).toBe('retry:thinking-display-updates')
    expect(isStickyBetaRejected(header)).toBe(true)
  })

  test('Twe via capability_rejected: beta_header:$ce', () => {
    const header = THINKING_DISPLAY_UPDATES_BETA_HEADER
    const err = api400(`capability_rejected: beta_header:${header}`)
    expect(
      classifyThinkingDisplayRetry(err, undefined, [header], 'claude-opus-4-6'),
    ).toBe('retry:thinking-display-updates')
    expect(isStickyBetaRejected(header)).toBe(true)
  })

  test('Twe without $ce in last betas does not retry', () => {
    const header = THINKING_DISPLAY_UPDATES_BETA_HEADER
    const err = api400(
      `invalid anthropic-beta: ${header} is not supported on this endpoint`,
    )
    expect(
      classifyThinkingDisplayRetry(err, 'updates', [], 'claude-opus-4-6'),
    ).toBeNull()
    expect(isStickyBetaRejected(header)).toBe(false)
  })

  test('non-400 and non-matching 400 do not retry', () => {
    const err500 = new APIError(
      500,
      {
        type: 'error',
        error: {
          type: 'api_error',
          message: 'thinking.adaptive.display: Input should be ',
        },
      },
      'thinking.adaptive.display: Input should be ',
      new Headers(),
    )
    expect(isThinkingDisplayHighlightsRejected(err500)).toBe(false)
    expect(
      classifyThinkingDisplayRetry(
        err500,
        'highlights',
        [THINKING_DISPLAY_UPDATES_BETA_HEADER],
        'claude-opus-4-6',
      ),
    ).toBeNull()

    const err400 = api400('unknown field foo is not permitted')
    expect(
      classifyThinkingDisplayRetry(err400, 'highlights', [], 'claude-opus-4-6'),
    ).toBeNull()
  })

  test('latch exists independently of classifier (j2t/x3r)', () => {
    expect(getThinkingHighlightsRefused()).toBe(false)
    markThinkingHighlightsRefused()
    expect(getThinkingHighlightsRefused()).toBe(true)
    stickyRejectBeta(THINKING_DISPLAY_UPDATES_BETA_HEADER)
    expect(isStickyBetaRejected(THINKING_DISPLAY_UPDATES_BETA_HEADER)).toBe(
      true,
    )
  })
})
