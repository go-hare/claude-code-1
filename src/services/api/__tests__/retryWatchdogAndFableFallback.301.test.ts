import { afterEach, describe, expect, test } from 'bun:test'
import { APIError } from '@anthropic-ai/sdk'
import {
  CannotRetryError,
  FallbackTriggeredError,
  getRetryWatchdogMaxUsageLimitWaitMs,
  isModelPermissionAPIError,
  resolveFableAvailabilityFallbackModel,
  withRetry,
} from '../withRetry.js'
import { getDensableCatalogModel } from '../../../utils/model/modelCatalogCapabilities.js'

const savedWatchdog = process.env.CLAUDE_CODE_RETRY_WATCHDOG
const savedMaxUsageLimit =
  process.env.CLAUDE_CODE_RETRY_WATCHDOG_MAX_USAGE_LIMIT_WAIT_MS

afterEach(() => {
  if (savedWatchdog === undefined) delete process.env.CLAUDE_CODE_RETRY_WATCHDOG
  else process.env.CLAUDE_CODE_RETRY_WATCHDOG = savedWatchdog
  if (savedMaxUsageLimit === undefined) {
    delete process.env.CLAUDE_CODE_RETRY_WATCHDOG_MAX_USAGE_LIMIT_WAIT_MS
  } else {
    process.env.CLAUDE_CODE_RETRY_WATCHDOG_MAX_USAGE_LIMIT_WAIT_MS =
      savedMaxUsageLimit
  }
})

describe('CLAUDE_CODE_RETRY_WATCHDOG_MAX_USAGE_LIMIT_WAIT_MS (#843)', () => {
  test('parses env var when set', () => {
    process.env.CLAUDE_CODE_RETRY_WATCHDOG_MAX_USAGE_LIMIT_WAIT_MS = '5000'
    expect(getRetryWatchdogMaxUsageLimitWaitMs()).toBe(5000)
  })

  test('ends request with CannotRetryError when usage limit reset exceeds max usage limit wait', async () => {
    process.env.CLAUDE_CODE_RETRY_WATCHDOG = '1'
    process.env.CLAUDE_CODE_RETRY_WATCHDOG_MAX_USAGE_LIMIT_WAIT_MS = '5000'
    const resetUnixSec = Math.floor(Date.now() / 1000) + 3600
    const headers = new Headers({
      'anthropic-ratelimit-unified-status': 'rejected',
      'anthropic-ratelimit-unified-reset': String(resetUnixSec),
    })
    const err429 = new APIError(
      429,
      { message: 'rate limited' },
      'rate limited',
      headers,
    )

    const gen = withRetry(
      async () => ({}) as never,
      async () => {
        throw err429
      },
      {
        model: 'claude-sonnet-4-5',
        maxRetries: 5,
        thinkingConfig: { type: 'disabled' },
        signal: new AbortController().signal,
      },
    )

    let caught: unknown
    try {
      while (!(await gen.next()).done) {
        // drain
      }
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(CannotRetryError)
  })
})

describe('Fable 5.2 catalog and availability fallback (#850)', () => {
  test('claude-fable-5-2 exists in catalog with fallback_3p claude-fable-5-1', () => {
    const fable52 = getDensableCatalogModel('claude-fable-5-2')
    expect(fable52).toBeDefined()
    expect(fable52?.fallback_3p).toBe('claude-fable-5-1')
    expect(resolveFableAvailabilityFallbackModel('claude-fable-5-2')).toBe(
      'claude-fable-5-1',
    )
  })

  test('isModelPermissionAPIError detects 403 permission_error mentioning model:', () => {
    const err = new APIError(
      403,
      {
        type: 'permission_error',
        message: 'model: claude-fable-5-2 not enabled',
      },
      'model: claude-fable-5-2 not enabled',
      new Headers(),
    )
    expect(isModelPermissionAPIError(err)).toBe(true)
  })

  test('withRetry triggers FallbackTriggeredError to claude-fable-5-1 on 404 model_not_found', async () => {
    const err404 = new APIError(
      404,
      { type: 'not_found_error', message: 'model: claude-fable-5-2' },
      'model: claude-fable-5-2',
      new Headers(),
    )

    const gen = withRetry(
      async () => ({}) as never,
      async () => {
        throw err404
      },
      {
        model: 'claude-fable-5-2',
        maxRetries: 2,
        thinkingConfig: { type: 'disabled' },
        signal: new AbortController().signal,
      },
    )

    let caught: unknown
    try {
      while (!(await gen.next()).done) {
        // drain
      }
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(FallbackTriggeredError)
    expect((caught as FallbackTriggeredError).fallbackModel).toBe(
      'claude-fable-5-1',
    )
    expect((caught as FallbackTriggeredError).reason).toBe('model_not_found')
  })
})
