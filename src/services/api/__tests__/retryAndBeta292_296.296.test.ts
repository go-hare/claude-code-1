import { afterEach, describe, expect, test } from 'bun:test'
import { APIError } from '@anthropic-ai/sdk'
import { CONTEXT_1M_BETA_HEADER } from '../../../constants/betas.js'
import { PROJECT_SCOPE_BLOCKED_ENV_VARS } from '../../../utils/managedEnvConstants.js'
import {
  decideContext1mBetaRetry,
  isContext1mBetaRejectedError,
  isInvalidBetaFlagError,
} from '../errors.js'
import {
  getOverloadedRetryBaseDelayMs,
  getOverloadedRetryMaxDelayMs,
  getRetryDelay,
  getRetryWatchdogMaxWaitMs,
} from '../withRetry.js'

const SAVED_ENV = {
  base: process.env.CLAUDE_CODE_OVERLOADED_RETRY_BASE_DELAY_MS,
  max: process.env.CLAUDE_CODE_OVERLOADED_RETRY_MAX_DELAY_MS,
  overloadedWait: process.env.CLAUDE_CODE_OVERLOADED_RETRY_MAX_WAIT_MS,
  watchdogWait: process.env.CLAUDE_CODE_RETRY_WATCHDOG_MAX_WAIT_MS,
}

afterEach(() => {
  for (const [key, envKey] of [
    ['base', 'CLAUDE_CODE_OVERLOADED_RETRY_BASE_DELAY_MS'],
    ['max', 'CLAUDE_CODE_OVERLOADED_RETRY_MAX_DELAY_MS'],
    ['overloadedWait', 'CLAUDE_CODE_OVERLOADED_RETRY_MAX_WAIT_MS'],
    ['watchdogWait', 'CLAUDE_CODE_RETRY_WATCHDOG_MAX_WAIT_MS'],
  ] as const) {
    if (SAVED_ENV[key] === undefined) {
      delete process.env[envKey]
    } else {
      process.env[envKey] = SAVED_ENV[key]
    }
  }
})

describe('v2.1.292-296 retry env constants & backoff (#195, #489, #356)', () => {
  test('managedEnvConstants includes the three retry env vars', () => {
    expect(
      PROJECT_SCOPE_BLOCKED_ENV_VARS.has(
        'CLAUDE_CODE_OVERLOADED_RETRY_BASE_DELAY_MS',
      ),
    ).toBe(true)
    expect(
      PROJECT_SCOPE_BLOCKED_ENV_VARS.has(
        'CLAUDE_CODE_OVERLOADED_RETRY_MAX_DELAY_MS',
      ),
    ).toBe(true)
    expect(
      PROJECT_SCOPE_BLOCKED_ENV_VARS.has(
        'CLAUDE_CODE_RETRY_WATCHDOG_MAX_WAIT_MS',
      ),
    ).toBe(true)
  })

  test('getOverloadedRetryBaseDelayMs & getOverloadedRetryMaxDelayMs parse non-negative ints', () => {
    delete process.env.CLAUDE_CODE_OVERLOADED_RETRY_BASE_DELAY_MS
    delete process.env.CLAUDE_CODE_OVERLOADED_RETRY_MAX_DELAY_MS
    expect(getOverloadedRetryBaseDelayMs()).toBeUndefined()
    expect(getOverloadedRetryMaxDelayMs()).toBeUndefined()

    process.env.CLAUDE_CODE_OVERLOADED_RETRY_BASE_DELAY_MS = '2500'
    process.env.CLAUDE_CODE_OVERLOADED_RETRY_MAX_DELAY_MS = '60000'
    expect(getOverloadedRetryBaseDelayMs()).toBe(2500)
    expect(getOverloadedRetryMaxDelayMs()).toBe(60000)

    process.env.CLAUDE_CODE_OVERLOADED_RETRY_BASE_DELAY_MS = '-1'
    expect(getOverloadedRetryBaseDelayMs()).toBeUndefined()
  })

  test('getRetryDelay honors baseDelayMs and maxDelayMs', () => {
    const d1 = getRetryDelay(1, null, 60000, 2000)
    expect(d1).toBeGreaterThanOrEqual(2000)
    expect(d1).toBeLessThanOrEqual(2500)

    const d5 = getRetryDelay(5, null, 10000, 2000)
    expect(d5).toBeGreaterThanOrEqual(10000)
    expect(d5).toBeLessThanOrEqual(12500)

    // Retry-After is respected as a floor against backoff
    const dAfter = getRetryDelay(1, '5', 60000, 500)
    expect(dAfter).toBe(5000)
  })

  test('getRetryWatchdogMaxWaitMs prefers OVERLOADED_RETRY_MAX_WAIT_MS on 529 and falls back to RETRY_WATCHDOG_MAX_WAIT_MS', () => {
    process.env.CLAUDE_CODE_RETRY_WATCHDOG_MAX_WAIT_MS = '45000'
    expect(getRetryWatchdogMaxWaitMs(false)).toBe(45000)
    expect(getRetryWatchdogMaxWaitMs(true)).toBe(45000)

    process.env.CLAUDE_CODE_OVERLOADED_RETRY_MAX_WAIT_MS = '120000'
    expect(getRetryWatchdogMaxWaitMs(true)).toBe(120000)
    expect(getRetryWatchdogMaxWaitMs(false)).toBe(45000)
  })
})

describe('v2.1.295 #358 context-1m-beta 400 retry', () => {
  test('isInvalidBetaFlagError & isContext1mBetaRejectedError match HTTP 400 messages', () => {
    const vague = new APIError(
      400,
      { message: 'Invalid beta flag' },
      'Invalid beta flag',
      new Headers(),
    )
    const explicit = new APIError(
      400,
      { message: `Unexpected value for beta: ${CONTEXT_1M_BETA_HEADER}` },
      `Unexpected value for beta: ${CONTEXT_1M_BETA_HEADER}`,
      new Headers(),
    )
    const longCtx = new APIError(
      400,
      { message: 'long context beta is not enabled' },
      'long context beta is not enabled',
      new Headers(),
    )
    const err500 = new APIError(
      500,
      { message: 'Invalid beta flag' },
      'Invalid beta flag',
      new Headers(),
    )

    expect(isInvalidBetaFlagError(vague)).toBe(true)
    expect(isInvalidBetaFlagError(err500)).toBe(false)
    expect(isContext1mBetaRejectedError(explicit)).toBe(true)
    expect(isContext1mBetaRejectedError(longCtx)).toBe(true)
  })

  test('decideContext1mBetaRetry retries once on 3P/gateway vague 400 and transitions guessing -> spent on second 400', () => {
    const vague = new APIError(
      400,
      { message: 'Invalid beta flag' },
      'Invalid beta flag',
      new Headers(),
    )

    // FirstParty does not guess on vague "invalid beta flag"
    expect(
      decideContext1mBetaRetry({
        error: vague,
        phase: 'idle',
        context1mBetaSent: true,
        isFirstParty: true,
      }),
    ).toEqual({ action: null, nextPhase: 'idle' })

    // 3P / gateway guesses once
    const first = decideContext1mBetaRetry({
      error: vague,
      phase: 'idle',
      context1mBetaSent: true,
      isFirstParty: false,
    })
    expect(first).toEqual({
      action: 'retry:context-1m-beta',
      nextPhase: 'guessing',
    })

    // Second vague 400 without the beta -> spent, no retry
    const second = decideContext1mBetaRetry({
      error: vague,
      phase: first.nextPhase,
      context1mBetaSent: true,
      isFirstParty: false,
    })
    expect(second).toEqual({ action: null, nextPhase: 'spent' })
  })
})
