import { afterEach, describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { APIError } from '@anthropic-ai/sdk'
import { shouldTriggerToolSearchRefusal } from '../claude.js'
import {
  CannotRetryError,
  FallbackTriggeredError,
  getOverloadedRetryMaxWaitMs,
  isFullRetryWatchdogActive,
  isRetryWatchdogActive,
  isRetryWatchdogEnabled,
  shouldRetry,
  withRetry,
} from '../withRetry.js'

const SAVED_ENV_KEYS = [
  'CLAUDE_CODE_RETRY_WATCHDOG',
  'CLAUDE_CODE_RETRY_WATCHDOG_SCOPE',
  'CLAUDE_CODE_RETRY_WATCHDOG_MAX_WAIT_MS',
  'CLAUDE_CODE_RETRY_WATCHDOG_MAX_USAGE_LIMIT_WAIT_MS',
  'CLAUDE_CODE_OVERLOADED_RETRY_MAX_WAIT_MS',
  'CLAUDE_CODE_MAX_RETRIES',
  'CLAUDE_CODE_USE_FOUNDRY',
] as const

const savedEnv: Record<string, string | undefined> = {}
for (const key of SAVED_ENV_KEYS) {
  savedEnv[key] = process.env[key]
}

afterEach(() => {
  for (const key of SAVED_ENV_KEYS) {
    if (savedEnv[key] === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = savedEnv[key]
    }
  }
})

const claudeMainSrc = readFileSync(
  join(import.meta.dir, '../claude.ts'),
  'utf8',
)
const claudeFallbackSrc = readFileSync(
  join(import.meta.dir, '../claude/nonStreamingFallback.ts'),
  'utf8',
)
const claudeDir = join(import.meta.dir, '../claude')
const claudeSrc = [
  claudeMainSrc,
  ...readdirSync(claudeDir)
    .filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .sort()
    .map(f => readFileSync(join(claudeDir, f), 'utf8')),
].join('\n')
const queryDir = join(import.meta.dir, '../../../query')
const querySrc = [
  readFileSync(join(import.meta.dir, '../../../query.ts'), 'utf8'),
  ...readdirSync(queryDir)
    .filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .sort()
    .map(f => readFileSync(join(queryDir, f), 'utf8')),
].join('\n')

describe('Wave 2A [P0-3]: FallbackTriggeredError propagation & query.ts handling', () => {
  test('FallbackTriggeredError supports refusal and availability reasons', () => {
    const refusal = new FallbackTriggeredError(
      'claude-opus-4-7',
      'claude-sonnet-4-6',
      'refusal',
    )
    expect(refusal.reason).toBe('refusal')
    expect(refusal.originalModel).toBe('claude-opus-4-7')
    expect(refusal.fallbackModel).toBe('claude-sonnet-4-6')

    const perm = new FallbackTriggeredError(
      'claude-fable-5-2',
      'claude-fable-5-1',
      'permission_denied',
    )
    expect(perm.reason).toBe('permission_denied')
  })

  test('claude.ts immediately re-throws FallbackTriggeredError in streaming and retry catches without recursive retry', () => {
    const streamCatchIdx = claudeMainSrc.indexOf(
      '} catch (rawStreamingError) {',
    )
    expect(streamCatchIdx).toBeGreaterThan(0)
    expect(claudeMainSrc.slice(streamCatchIdx, streamCatchIdx + 200)).toContain(
      'handleStreamingError',
    )

    const handleStreamIdx = claudeFallbackSrc.indexOf(
      'export async function* handleStreamingError(',
    )
    expect(handleStreamIdx).toBeGreaterThan(0)
    const streamCatchHead = claudeFallbackSrc.slice(
      handleStreamIdx,
      handleStreamIdx + 2000,
    )
    expect(streamCatchHead).toContain(
      'if (rawStreamingError instanceof FallbackTriggeredError)',
    )
    expect(streamCatchHead).toContain('throw rawStreamingError')

    const retryCatchIdx = claudeMainSrc.indexOf(
      '} catch (errorFromRetry) {',
      streamCatchIdx,
    )
    expect(retryCatchIdx).toBeGreaterThan(streamCatchIdx)
    expect(claudeMainSrc.slice(retryCatchIdx, retryCatchIdx + 200)).toContain(
      'handleRetryError',
    )

    const handleRetryIdx = claudeFallbackSrc.indexOf(
      'export async function* handleRetryError(',
    )
    expect(handleRetryIdx).toBeGreaterThan(handleStreamIdx)
    const retryCatchHead = claudeFallbackSrc.slice(
      handleRetryIdx,
      handleRetryIdx + 1800,
    )
    expect(retryCatchHead).toContain(
      'if (errorFromRetry instanceof FallbackTriggeredError)',
    )
    expect(retryCatchHead).toContain('throw errorFromRetry')
    // Must not recursively invoke queryModelWithStreaming for FallbackTriggeredError
    const fbBlock = retryCatchHead.slice(
      retryCatchHead.indexOf(
        'if (errorFromRetry instanceof FallbackTriggeredError)',
      ),
      retryCatchHead.indexOf('ThinkingOnlyStreamRetryError'),
    )
    expect(fbBlock).not.toContain('queryModelWithStreaming')
  })

  test('query.ts catches FallbackTriggeredError even when --fallback-model is unset and strips signatures unconditionally', () => {
    const catchIdx = querySrc.indexOf(
      'innerError instanceof FallbackTriggeredError',
    )
    expect(catchIdx).toBeGreaterThan(0)
    const catchSection = querySrc.slice(catchIdx - 60, catchIdx + 12000)
    expect(catchSection).toContain('innerError.fallbackModel || fallbackModel')
    expect(catchSection).toContain("type: 'query_model_change'")
    expect(catchSection).toContain("subtype: 'model_fallback'")
    expect(catchSection).toContain(
      'messagesForQuery = stripSignatureBlocks(messagesForQuery)',
    )
    // Must not gate thinking signature stripping behind USER_TYPE === 'ant'
    const stripIdx = catchSection.indexOf(
      'messagesForQuery = stripSignatureBlocks(messagesForQuery)',
    )
    const beforeStrip = catchSection.slice(
      Math.max(0, stripIdx - 220),
      stripIdx,
    )
    expect(beforeStrip).not.toContain("USER_TYPE === 'ant'")
  })
})

describe('Wave 2A [P0-5]: ToolSearchRefusalError 1P gate, exclusions, and ordering', () => {
  test('on direct 1P Anthropic, only triggers when error message mentions defer_loading', () => {
    const generic400 = new APIError(
      400,
      { type: 'invalid_request_error', message: 'invalid parameter foo' },
      'invalid parameter foo',
      new Headers(),
    )
    expect(
      shouldTriggerToolSearchRefusal({
        error: generic400,
        useSearchExtraTools: true,
        alreadyRetried: false,
        isDirectAnthropicProvider: true,
        provider: 'firstParty',
        model: 'claude-sonnet-4-6',
      }),
    ).toBe(false)

    const deferLoading400 = new APIError(
      400,
      {
        type: 'invalid_request_error',
        message: 'tools.0.defer_loading: Extra inputs are not permitted',
      },
      'tools.0.defer_loading: Extra inputs are not permitted',
      new Headers(),
    )
    expect(
      shouldTriggerToolSearchRefusal({
        error: deferLoading400,
        useSearchExtraTools: true,
        alreadyRetried: false,
        isDirectAnthropicProvider: true,
        provider: 'firstParty',
        model: 'claude-sonnet-4-6',
      }),
    ).toBe(true)
  })

  test('on non-direct providers (proxy/3P), triggers on generic 400/422 but excludes withRetry and Foundry errors', () => {
    const generic422 = new APIError(
      422,
      { type: 'invalid_request_error', message: 'unprocessable entity' },
      '422 unprocessable entity',
      new Headers(),
    )
    expect(
      shouldTriggerToolSearchRefusal({
        error: generic422,
        useSearchExtraTools: true,
        alreadyRetried: false,
        isDirectAnthropicProvider: false,
        provider: 'gateway',
        model: 'claude-sonnet-4-6',
      }),
    ).toBe(true)

    // Excluded: parseApiMaxTokensCeilingError
    const ceiling400 = new APIError(
      400,
      {
        type: 'invalid_request_error',
        message:
          'max_tokens: 32000 > 16384, which is the maximum allowed number of output tokens for claude-sonnet-4-6',
      },
      'max_tokens: 32000 > 16384, which is the maximum allowed number of output tokens for claude-sonnet-4-6',
      new Headers(),
    )
    expect(
      shouldTriggerToolSearchRefusal({
        error: ceiling400,
        useSearchExtraTools: true,
        alreadyRetried: false,
        isDirectAnthropicProvider: false,
        provider: 'gateway',
        model: 'claude-sonnet-4-6',
      }),
    ).toBe(false)

    // Excluded: parseMaxTokensContextOverflowError
    const overflow400 = new APIError(
      400,
      {
        type: 'invalid_request_error',
        message:
          'input length and `max_tokens` exceed context limit: 190000 + 20000 > 200000',
      },
      'input length and `max_tokens` exceed context limit: 190000 + 20000 > 200000',
      new Headers(),
    )
    expect(
      shouldTriggerToolSearchRefusal({
        error: overflow400,
        useSearchExtraTools: true,
        alreadyRetried: false,
        isDirectAnthropicProvider: false,
        provider: 'gateway',
        model: 'claude-sonnet-4-6',
      }),
    ).toBe(false)

    // Excluded: fast mode not enabled / speed unsupported
    const fastMode400 = new APIError(
      400,
      { type: 'invalid_request_error', message: 'Fast mode is not enabled' },
      'Fast mode is not enabled',
      new Headers(),
    )
    expect(
      shouldTriggerToolSearchRefusal({
        error: fastMode400,
        useSearchExtraTools: true,
        alreadyRetried: false,
        isDirectAnthropicProvider: false,
        provider: 'vertex',
        model: 'claude-opus-4-7',
      }),
    ).toBe(false)

    const speed400 = new APIError(
      400,
      {
        type: 'invalid_request_error',
        message: "'claude-sonnet-4-6' does not support the `speed` parameter",
      },
      "'claude-sonnet-4-6' does not support the `speed` parameter",
      new Headers(),
    )
    expect(
      shouldTriggerToolSearchRefusal({
        error: speed400,
        useSearchExtraTools: true,
        alreadyRetried: false,
        isDirectAnthropicProvider: false,
        provider: 'gateway',
        model: 'claude-sonnet-4-6',
      }),
    ).toBe(false)

    // Excluded: Foundry capability error
    process.env.CLAUDE_CODE_USE_FOUNDRY = '1'
    const foundryCap400 = new APIError(
      400,
      {
        error: {
          message: 'tool_search_server not supported in your workspace',
        },
      },
      'tool_search_server not supported in your workspace',
      new Headers(),
    )
    expect(
      shouldTriggerToolSearchRefusal({
        error: foundryCap400,
        useSearchExtraTools: true,
        alreadyRetried: false,
        isDirectAnthropicProvider: false,
        provider: 'foundry',
        model: 'claude-sonnet-4-6',
      }),
    ).toBe(false)
  })

  test('ToolSearchRefusalError check runs AFTER mid-conv-system / api-system-cache-demote in claude.ts', () => {
    const midConvIdx = claudeSrc.indexOf("return 'retry:mid-conv-system'")
    const cacheDemoteIdx = claudeSrc.indexOf(
      "return 'retry:api-system-cache-demote'",
    )
    const toolSearchIdx = claudeSrc.indexOf('throw new ToolSearchRefusalError(')
    expect(midConvIdx).toBeGreaterThan(0)
    expect(cacheDemoteIdx).toBeGreaterThan(midConvIdx)
    expect(toolSearchIdx).toBeGreaterThan(cacheDemoteIdx)
  })
})

describe('Wave 2A [P1-#5]: Retry watchdog env semantics (zHe / ME / Y1e / Hs)', () => {
  test('isRetryWatchdogEnabled (zHe) ignores SCOPE while isFullRetryWatchdogActive (ME) excludes capacity', () => {
    process.env.CLAUDE_CODE_RETRY_WATCHDOG = '1'
    process.env.CLAUDE_CODE_RETRY_WATCHDOG_SCOPE = 'capacity'
    expect(isRetryWatchdogEnabled()).toBe(true)
    expect(isFullRetryWatchdogActive()).toBe(false)
    expect(isRetryWatchdogActive()).toBe(false)

    process.env.CLAUDE_CODE_RETRY_WATCHDOG_SCOPE = 'session'
    expect(isRetryWatchdogEnabled()).toBe(true)
    expect(isFullRetryWatchdogActive()).toBe(true)
    expect(isRetryWatchdogActive()).toBe(true)

    delete process.env.CLAUDE_CODE_RETRY_WATCHDOG
    expect(isRetryWatchdogEnabled()).toBe(false)
    expect(isFullRetryWatchdogActive()).toBe(false)
  })

  test('getOverloadedRetryMaxWaitMs (Y1e) only activates when RETRY_WATCHDOG & MAX_RETRIES unset on main turn', () => {
    delete process.env.CLAUDE_CODE_RETRY_WATCHDOG
    delete process.env.CLAUDE_CODE_MAX_RETRIES
    process.env.CLAUDE_CODE_OVERLOADED_RETRY_MAX_WAIT_MS = '15000'

    expect(getOverloadedRetryMaxWaitMs('repl_main_thread')).toBe(15000)
    expect(getOverloadedRetryMaxWaitMs('sdk')).toBe(15000)
    // Non-main sources do not activate Y1e
    expect(getOverloadedRetryMaxWaitMs('compact')).toBeUndefined()
    expect(getOverloadedRetryMaxWaitMs('agent:default')).toBeUndefined()

    // Watchdog set disables Y1e
    process.env.CLAUDE_CODE_RETRY_WATCHDOG = '1'
    expect(getOverloadedRetryMaxWaitMs('repl_main_thread')).toBeUndefined()
    delete process.env.CLAUDE_CODE_RETRY_WATCHDOG

    // MAX_RETRIES set disables Y1e
    process.env.CLAUDE_CODE_MAX_RETRIES = '5'
    expect(getOverloadedRetryMaxWaitMs('repl_main_thread')).toBeUndefined()
  })

  test('CLAUDE_CODE_RETRY_WATCHDOG=1 with SCOPE=capacity drives persistent 529 retries past maxRetries=0', async () => {
    process.env.CLAUDE_CODE_RETRY_WATCHDOG = '1'
    process.env.CLAUDE_CODE_RETRY_WATCHDOG_SCOPE = 'capacity'
    process.env.CLAUDE_CODE_RETRY_WATCHDOG_MAX_WAIT_MS = '5000'

    let calls = 0
    const err529 = new APIError(
      529,
      { type: 'overloaded_error', message: 'Overloaded' },
      'Overloaded',
      new Headers({ 'retry-after': '0' }),
    )

    const gen = withRetry(
      async () => ({}) as never,
      async () => {
        calls++
        if (calls === 1) throw err529
        return 'ok'
      },
      {
        model: 'claude-sonnet-4-6',
        maxRetries: 0,
        thinkingConfig: { type: 'disabled' },
        signal: new AbortController().signal,
        querySource: 'repl_main_thread',
      },
    )

    let next = await gen.next()
    while (!next.done) {
      next = await gen.next()
    }
    expect(next.value).toBe('ok')
    expect(calls).toBe(2)
  })

  test('CLAUDE_CODE_OVERLOADED_RETRY_MAX_WAIT_MS activates without RETRY_WATCHDOG on main turn and stops when cap=0', async () => {
    delete process.env.CLAUDE_CODE_RETRY_WATCHDOG
    delete process.env.CLAUDE_CODE_MAX_RETRIES
    process.env.CLAUDE_CODE_OVERLOADED_RETRY_MAX_WAIT_MS = '0'

    const err529 = new APIError(
      529,
      { type: 'overloaded_error', message: 'Overloaded' },
      'Overloaded',
      new Headers(),
    )

    const gen = withRetry(
      async () => ({}) as never,
      async () => {
        throw err529
      },
      {
        model: 'claude-sonnet-4-6',
        maxRetries: 3,
        thinkingConfig: { type: 'disabled' },
        signal: new AbortController().signal,
        querySource: 'repl_main_thread',
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

  test('shouldRetry allows 429 when CLAUDE_CODE_RETRY_WATCHDOG=1 SCOPE=capacity unless x-should-retry: false', () => {
    process.env.CLAUDE_CODE_RETRY_WATCHDOG = '1'
    process.env.CLAUDE_CODE_RETRY_WATCHDOG_SCOPE = 'capacity'

    const retryable429 = new APIError(
      429,
      { message: 'rate limited' },
      'rate limited',
      new Headers(),
    )
    expect(shouldRetry(retryable429)).toBe(true)

    const blocked429 = new APIError(
      429,
      { message: 'rate limited' },
      'rate limited',
      new Headers({ 'x-should-retry': 'false' }),
    )
    expect(shouldRetry(blocked429)).toBe(false)
  })
})

describe('Wave 2A [P2-#3]: claude.ts uses break instead of return for partial/complete stream exits', () => {
  test('alreadyComplete and partial-finalized exits break out of stream loop so post-stream bookkeeping runs', () => {
    // handleStreamingError returns void back to claude.ts's catch block (never
    // returning early from queryModelWithStreaming), which falls through to
    // `break` out of the streamAttempt loop so post-stream bookkeeping runs.
    const completeIdx = claudeFallbackSrc.indexOf(
      'if (closePlan.alreadyComplete) {',
    )
    expect(completeIdx).toBeGreaterThan(0)
    const completeSlice = claudeFallbackSrc.slice(
      completeIdx,
      completeIdx + 1200,
    )
    expect(completeSlice).toContain('return')
    expect(completeSlice).not.toContain('throw')

    const partialIdx = claudeFallbackSrc.indexOf(
      'truncatedAfterOutput: hasOutput && !hasToolUse ? true : undefined,',
    )
    expect(partialIdx).toBeGreaterThan(completeIdx)
    const partialSlice = claudeFallbackSrc.slice(partialIdx, partialIdx + 120)
    expect(partialSlice).toContain('return')

    const streamCatchIdx = claudeMainSrc.indexOf(
      '} catch (rawStreamingError) {',
    )
    const streamLoopEndIdx = claudeMainSrc.indexOf('} // streamAttempt')
    expect(streamLoopEndIdx).toBeGreaterThan(streamCatchIdx)
    const afterCatch = claudeMainSrc.slice(streamCatchIdx, streamLoopEndIdx)
    expect(afterCatch).toContain('\n      break\n')
    expect(
      claudeMainSrc.slice(streamCatchIdx, streamCatchIdx + 600),
    ).not.toContain('return')
  })
})
