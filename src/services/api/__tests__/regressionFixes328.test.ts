import { APIError } from '@anthropic-ai/sdk'
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import axios from 'axios'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  clearBetaHeaderLatches,
  resetStateForTests,
} from '../../../bootstrap/state.js'
import {
  CONTEXT_1M_BETA_HEADER,
  EFFORT_BETA_HEADER,
  INTERLEAVED_THINKING_BETA_HEADER,
} from '../../../constants/betas.js'
import type { Message } from '../../../types/message.js'
import {
  clearBetasCaches,
  getBedrockExtraBodyParamsBetas,
  getModelBetas,
} from '../../../utils/betas.js'
import {
  getContextWindowForModel,
  getMaxThinkingTokensForModel,
  getModelMaxOutputTokens,
  isUnrecognizedModelMaxOutputTokensAssumed,
} from '../../../utils/context.js'
import { firstPartyNameToCanonical } from '../../../utils/model/canonicalName.js'
import {
  getDensableCatalogModel,
  getDensableModelCatalog,
  modelHasCatalogCapability,
  resolveCatalogAlias,
} from '../../../utils/model/modelCatalogCapabilities.js'
import {
  _resetKeepAliveForTesting,
  configureGlobalAgents,
  enableClosesAfterServerError,
  KeepAliveErrorClosingAgent,
  repairBareProxySchemeAtStartup,
  resetBareProxyRepairStateForTests,
} from '../../../utils/proxy.js'
import { hasUltrathinkKeyword } from '../../../utils/thinking.js'
import {
  buildCompactSummaryRequestContent,
  leaveOutToolResultsForPTLRetry,
  TOOL_RESULT_LEFT_OUT_PREFIX,
} from '../../compact/compact.js'
import { LEFT_OUT_TOOL_RESULTS_NOTE } from '../../compact/prompt.js'
import * as vcrModule from '../../vcr.js'
import {
  clearContext1mBetaRefusedModels,
  isContext1mBetaRefusedForModel,
  markContext1mBetaRefusedForModel,
  queryModelWithStreaming,
} from '../claude.js'
import * as clientModule from '../client.js'
import { getClientTargetUrl } from '../client.js'
import { decideContext1mBetaRetry } from '../errors.js'
import {
  isRetryWatchdogActive,
  resolveAccessFallbackModel,
  resolveFableAvailabilityFallbackModel,
} from '../withRetry.js'

const ROOT = join(import.meta.dir, '../../../..')

// MACRO.VERSION is only injected in dev/build.
;(
  globalThis as unknown as {
    MACRO?: { VERSION: string; BUILD_TIME?: string }
  }
).MACRO ??= { VERSION: '2.1.328', BUILD_TIME: '2026-01-01T00:00:00Z' }

const ENV_KEYS = [
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_OPENAI',
  'CLAUDE_CODE_USE_GEMINI',
  'CLAUDE_CODE_USE_GROK',
  'CLAUDE_CODE_USE_GATEWAY',
  'CLAUDE_CODE_NO_MODEL_FALLBACK',
  'CLAUDE_CODE_DISABLE_MODEL_ACCESS_FALLBACK',
  'CLAUDE_CODE_MAX_OUTPUT_TOKENS',
  'CLAUDE_CODE_RETRY_WATCHDOG',
  'CLAUDE_CODE_RETRY_WATCHDOG_SCOPE',
  'HTTPS_PROXY',
  'https_proxy',
  'HTTP_PROXY',
  'http_proxy',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_BEDROCK_BASE_URL',
  'ANTHROPIC_VERTEX_BASE_URL',
  'AWS_REGION',
  'CLOUD_ML_REGION',
] as const

const savedEnv: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k]
    delete process.env[k]
  }
  resetStateForTests()
  _resetKeepAliveForTesting()
  resetBareProxyRepairStateForTests()
  axios.defaults.httpsAgent = undefined
  axios.defaults.httpAgent = undefined
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
  resetStateForTests()
  _resetKeepAliveForTesting()
  resetBareProxyRepairStateForTests()
  axios.defaults.httpsAgent = undefined
  axios.defaults.httpAgent = undefined
})

describe('Official 2.1.328 regression fixes (Agent 2)', () => {
  test('P0 #1: catalog max_output_tokens resolves claude-opus-5-5 and 328 models without isAssumed', () => {
    expect(getModelMaxOutputTokens('claude-opus-5-5').default).toBe(128_000)
    expect(getModelMaxOutputTokens('claude-opus-5-5').upperLimit).toBe(128_000)
    expect(isUnrecognizedModelMaxOutputTokensAssumed('claude-opus-5-5')).toBe(
      false,
    )
    expect(getMaxThinkingTokensForModel('claude-opus-5-5')).toBe(127_999)

    expect(
      getModelMaxOutputTokens('us.anthropic.claude-opus-5-5').default,
    ).toBe(128_000)
    expect(
      isUnrecognizedModelMaxOutputTokensAssumed('claude-haiku-5-5[1m]'),
    ).toBe(false)
    expect(getMaxThinkingTokensForModel('claude-haiku-5-5')).toBe(127_999)

    expect(
      isUnrecognizedModelMaxOutputTokensAssumed('unrecognized-custom-v9'),
    ).toBe(true)
    expect(getMaxThinkingTokensForModel('unrecognized-custom-v9')).toBe(31_999)
  })

  test('P0 #2 & P1 #3: 328 Ips catalog synced (tiers, models, aliases) and leaf canonicalName breaks TDZ', () => {
    const catalog = getDensableModelCatalog()
    expect(catalog.pricing_tiers.tier_2_10).toBeDefined()
    expect(catalog.pricing_tiers.tier_2_10_cache_read_0_10).toBeDefined()
    expect(catalog.pricing_tiers.haiku_55?.long_prompt?.input).toBe(0.5)

    expect(getDensableCatalogModel('claude-haiku-5-5')?.pricing).toBe(
      'haiku_55',
    )
    expect(getDensableCatalogModel('claude-mythos-5-1')?.family).toBe('mythos')
    expect(
      getDensableCatalogModel('claude-mythos-5-2')?.max_output_tokens,
    ).toEqual({ default: 128_000, upper: 128_000 })
    expect(getDensableCatalogModel('claude-sonnet-5-5')?.pricing).toBe(
      'tier_2_10_cache_read_0_10',
    )
    expect(getDensableCatalogModel('claude-sonnet-5-5')?.default_effort).toBe(
      'medium',
    )
    expect(resolveCatalogAlias('haiku')).toBe('claude-haiku-5-5')
    expect(catalog.latest_per_family.haiku).toBe('claude-haiku-5-5')

    expect(firstPartyNameToCanonical('us.anthropic.claude-haiku-5-5')).toBe(
      'claude-haiku-5-5',
    )
    expect(modelHasCatalogCapability('claude-opus-5-5', 'fast_mode')).toBe(true)
  })

  test('P1 #4: access/fable fallback maps provider_ids, honors DISABLE_MODEL_ACCESS_FALLBACK, and aligns ME()', () => {
    process.env.CLAUDE_CODE_USE_BEDROCK = '1'
    expect(
      resolveAccessFallbackModel({ model: 'us.anthropic.claude-sonnet-4-6' }),
    ).toBe('us.anthropic.claude-sonnet-4-5-20250929-v1:0')
    process.env.CLAUDE_CODE_DISABLE_MODEL_ACCESS_FALLBACK = '1'
    expect(
      resolveAccessFallbackModel({ model: 'us.anthropic.claude-sonnet-4-6' }),
    ).toBeUndefined()
    delete process.env.CLAUDE_CODE_DISABLE_MODEL_ACCESS_FALLBACK
    delete process.env.CLAUDE_CODE_USE_BEDROCK

    process.env.CLAUDE_CODE_USE_VERTEX = '1'
    expect(resolveAccessFallbackModel({ model: 'claude-sonnet-4-6[1m]' })).toBe(
      'claude-sonnet-4-5@20250929',
    )
    delete process.env.CLAUDE_CODE_USE_VERTEX

    expect(resolveFableAvailabilityFallbackModel('claude-fable-5-2[1m]')).toBe(
      'claude-fable-5-1',
    )
    process.env.CLAUDE_CODE_DISABLE_MODEL_ACCESS_FALLBACK = '1'
    expect(
      resolveFableAvailabilityFallbackModel('claude-fable-5-2'),
    ).toBeUndefined()
    delete process.env.CLAUDE_CODE_DISABLE_MODEL_ACCESS_FALLBACK

    // Official 328 ME(): active unless scope === 'capacity'
    expect(isRetryWatchdogActive('1', undefined)).toBe(true)
    expect(isRetryWatchdogActive('1', 'session')).toBe(true)
    expect(isRetryWatchdogActive('1', 'capacity')).toBe(false)
    expect(isRetryWatchdogActive('0', undefined)).toBe(false)
  })

  test('P1 #5: single PTL tool-result omission pass uses bracketed placeholder and appends LEFT_OUT_TOOL_RESULTS_NOTE', () => {
    const msgs = [
      {
        type: 'user',
        uuid: 'u1',
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'big',
              content: 'x'.repeat(9000),
            },
            { type: 'tool_result', tool_use_id: 'small', content: 'ok' },
          ],
        },
      },
    ] as unknown as Message[]

    const out = leaveOutToolResultsForPTLRetry(msgs, 1500, false)
    expect(out).not.toBeNull()
    const blocks = (
      out![0] as {
        message: { content: Array<{ tool_use_id: string; content: string }> }
      }
    ).message.content
    expect(blocks[0]!.content).toStartWith(TOOL_RESULT_LEFT_OUT_PREFIX)
    expect(blocks[1]!.content).toBe('ok')

    const withNote = buildCompactSummaryRequestContent({
      basePrompt: 'BASE',
      hasLeftOutToolResults: true,
    })
    const withoutNote = buildCompactSummaryRequestContent({
      basePrompt: 'BASE',
      hasLeftOutToolResults: false,
    })
    expect(withNote).toContain(LEFT_OUT_TOOL_RESULTS_NOTE)
    expect(withoutNote).not.toContain(LEFT_OUT_TOOL_RESULTS_NOTE)

    // Verify duplicate omission wrapper removed from reactiveCompact.ts
    const reactiveSrc = readFileSync(
      join(ROOT, 'src/services/compact/reactiveCompact.ts'),
      'utf8',
    )
    expect(reactiveSrc).not.toContain('Reactive compact: omitting')
  })

  test('P1 #6: hasUltrathinkKeyword ignores quoted, code, and path mentions', () => {
    expect(hasUltrathinkKeyword('please ultrathink on this design')).toBe(true)
    expect(hasUltrathinkKeyword('mentioning "ultrathink" in quotes')).toBe(
      false,
    )
    expect(
      hasUltrathinkKeyword("mentioning 'ultrathink' in single quotes"),
    ).toBe(false)
    expect(hasUltrathinkKeyword('inspect `ultrathink` identifier')).toBe(false)
    expect(hasUltrathinkKeyword('open src/ultrathink/helper.ts')).toBe(false)
    expect(hasUltrathinkKeyword('check ultrathink.ts')).toBe(false)
    expect(hasUltrathinkKeyword('pass --ultrathink flag')).toBe(false)
  })

  test('P1 #7: KeepAliveErrorClosingAgent wired into configureGlobalAgents and bare proxy repair gates on non-interactive session', () => {
    enableClosesAfterServerError()
    configureGlobalAgents()
    expect(axios.defaults.httpsAgent).toBeInstanceOf(KeepAliveErrorClosingAgent)

    const envInteractive: Record<string, string | undefined> = {
      HTTPS_PROXY: 'proxy.corp.local:8080',
    }
    expect(
      repairBareProxySchemeAtStartup({
        env: envInteractive,
        stdinIsTTY: false,
        stdoutIsTTY: false,
        isNonInteractiveSession: false,
        argv: [],
      }).repaired,
    ).toBe(false)
    expect(envInteractive.HTTPS_PROXY).toBe('proxy.corp.local:8080')

    const envNonInteractive: Record<string, string | undefined> = {
      HTTPS_PROXY: 'proxy.corp.local:8080',
    }
    const res = repairBareProxySchemeAtStartup({
      env: envNonInteractive,
      stdinIsTTY: false,
      stdoutIsTTY: false,
      isNonInteractiveSession: true,
      argv: [],
    })
    expect(res.repaired).toBe(true)
    expect(envNonInteractive.HTTPS_PROXY).toBe('http://proxy.corp.local:8080')
  })

  test('P1 #8: context-1m beta retry uses direct-Anthropic-provider Rve guard, allows 3P healing, and downsizes refused [1m] context window to 200k', () => {
    const claudeSrc = readFileSync(
      join(ROOT, 'src/services/api/claude.ts'),
      'utf8',
    )
    expect(claudeSrc).toContain(
      "(provider === 'firstParty' && isFirstPartyAnthropicBaseUrl())",
    )
    expect(claudeSrc).toContain(
      "(provider === 'anthropicAws' && !process.env.ANTHROPIC_AWS_BASE_URL)",
    )
    expect(claudeSrc).not.toContain('catalogDeclaresNative1mWindow')

    const explicit400 = new APIError(
      400,
      { message: `Unexpected value for beta: ${CONTEXT_1M_BETA_HEADER}` },
      `Unexpected value for beta: ${CONTEXT_1M_BETA_HEADER}`,
      new Headers(),
    )

    // Direct Anthropic provider (1P / default anthropicAws) never silently strips context-1m
    expect(
      decideContext1mBetaRetry({
        error: explicit400,
        phase: 'idle',
        context1mBetaSent: true,
        isDirectAnthropicProvider: true,
        isFirstParty: true,
      }),
    ).toEqual({ action: null, nextPhase: 'idle' })

    // 3P / gateway backends can heal 400 rejections on any [1m] model (including 4.7/4.8/5.x)
    expect(
      decideContext1mBetaRetry({
        error: explicit400,
        phase: 'idle',
        context1mBetaSent: true,
        isDirectAnthropicProvider: false,
        isFirstParty: false,
      }),
    ).toEqual({ action: 'retry:context-1m-beta', nextPhase: 'retrying' })

    expect(isContext1mBetaRefusedForModel('claude-sonnet-4-6')).toBe(false)
    expect(getContextWindowForModel('claude-sonnet-4-6[1m]')).toBe(1_000_000)

    markContext1mBetaRefusedForModel('claude-sonnet-4-6[1m]')
    expect(isContext1mBetaRefusedForModel('claude-sonnet-4-6')).toBe(true)
    expect(isContext1mBetaRefusedForModel('claude-opus-4-6')).toBe(false)
    // Refused [1m] model sizes as untagged (200k instead of 1M) on subsequent turns
    expect(getContextWindowForModel('claude-sonnet-4-6[1m]')).toBe(200_000)
    expect(
      getContextWindowForModel('claude-sonnet-4-6[1m]', [
        CONTEXT_1M_BETA_HEADER,
      ]),
    ).toBe(200_000)
    // Unrefused model still gets 1M
    expect(getContextWindowForModel('claude-opus-4-6[1m]')).toBe(1_000_000)

    // /clear clears sticky betas, unlatching per-model refusal and restoring 1M sizing
    clearBetaHeaderLatches()
    expect(isContext1mBetaRefusedForModel('claude-sonnet-4-6')).toBe(false)
    expect(getContextWindowForModel('claude-sonnet-4-6[1m]')).toBe(1_000_000)

    markContext1mBetaRefusedForModel('claude-sonnet-4-6')
    clearContext1mBetaRefusedModels()
    expect(isContext1mBetaRefusedForModel('claude-sonnet-4-6')).toBe(false)
  })

  test('P2 #9: getClientTargetUrl exported and reused by withRetry TLS cert repair', () => {
    process.env.AWS_REGION = 'us-west-2'
    expect(
      getClientTargetUrl('bedrock', 'us.anthropic.claude-sonnet-4-6'),
    ).toBe('https://bedrock-runtime.us-west-2.amazonaws.com')
    process.env.ANTHROPIC_VERTEX_BASE_URL = 'https://vertex-proxy.corp.internal'
    expect(getClientTargetUrl('vertex', 'claude-sonnet-4-6')).toBe(
      'https://vertex-proxy.corp.internal',
    )
    const withRetrySrc = readFileSync(
      join(ROOT, 'src/services/api/withRetry.ts'),
      'utf8',
    )
    expect(withRetrySrc).toContain(
      'getClientTargetUrl(getAPIProvider(), options.model)',
    )
  })

  test('D-P0-1 + D-P1-3: s9o findRejectedBetaHeaders runs before d9o decideContext1mBetaRetry, excludes context-1m from generic stripping, and Bedrock extra body betas respect both refusal latch and strippedBedrockBetas', () => {
    const claudeSrc = readFileSync(
      join(ROOT, 'src/services/api/claude.ts'),
      'utf8',
    )
    const decideIdx = claudeSrc.indexOf('decideContext1mBetaRetry({')
    const rejectedIdx = claudeSrc.indexOf('findRejectedBetaHeaders(')
    expect(decideIdx).toBeGreaterThan(-1)
    expect(rejectedIdx).toBeGreaterThan(-1)
    // Official 2.1.328 N9o = [..., s9o, OTe, d9o, ...]: findRejectedBetaHeaders BEFORE decideContext1mBetaRetry
    expect(rejectedIdx).toBeLessThan(decideIdx)
    expect(claudeSrc).toContain(
      'lastRequestBedrockBetas.includes(CONTEXT_1M_BETA_HEADER)',
    )
    expect(claudeSrc).toContain('.filter(b => b !== CONTEXT_1M_BETA_HEADER)')
    expect(claudeSrc).toContain('!strippedBedrockBetas.has(b)')

    process.env.CLAUDE_CODE_USE_BEDROCK = '1'
    clearBetasCaches()
    clearContext1mBetaRefusedModels()

    const model = 'us.anthropic.claude-sonnet-4-6[1m]'
    expect(getBedrockExtraBodyParamsBetas(model)).toContain(
      CONTEXT_1M_BETA_HEADER,
    )

    // Latching refusal must strip context-1m even after prior memoized call
    markContext1mBetaRefusedForModel(model)
    expect(getBedrockExtraBodyParamsBetas(model)).not.toContain(
      CONTEXT_1M_BETA_HEADER,
    )
    expect(getModelBetas(model)).not.toContain(CONTEXT_1M_BETA_HEADER)

    // Clearing latches restores context-1m
    clearContext1mBetaRefusedModels()
    expect(getBedrockExtraBodyParamsBetas(model)).toContain(
      CONTEXT_1M_BETA_HEADER,
    )
  })

  test('D-P1-3: dual-beta 400 rejecting both context-1m and effort strips effort on attempt 1, retries without context-1m on attempt 2, and latches markContext1mBetaRefusedForModel on attempt 3 success', async () => {
    process.env.ANTHROPIC_BASE_URL = 'https://gateway.corp.example.com'
    clearBetasCaches()
    clearContext1mBetaRefusedModels()

    const model = 'claude-opus-4-5-20251101[1m]'
    const sentBetasPerAttempt: string[][] = []
    let attemptCount = 0

    const okStream = async function* () {
      yield {
        type: 'message_start',
        message: {
          id: 'msg_dual_ok',
          type: 'message',
          role: 'assistant',
          content: [],
          model,
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 1 },
        },
      }
      yield {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' },
      }
      yield {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'ok' },
      }
      yield { type: 'content_block_stop', index: 0 }
      yield {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        usage: { output_tokens: 2 },
      }
      yield { type: 'message_stop' }
    }

    const vcrSpy = spyOn(vcrModule, 'withStreamingVCR').mockImplementation(
      async function* (_msgs, f) {
        yield* f()
      },
    )
    const clientSpy = spyOn(
      clientModule,
      'getAnthropicClient',
    ).mockResolvedValue({
      beta: {
        messages: {
          create: (params: Record<string, unknown>) => ({
            withResponse: async () => {
              attemptCount++
              const reqBetas = Array.isArray(params.betas)
                ? [...(params.betas as string[])]
                : []
              sentBetasPerAttempt.push(reqBetas)
              const has1m = reqBetas.includes(CONTEXT_1M_BETA_HEADER)
              const hasEffort = reqBetas.includes(EFFORT_BETA_HEADER)
              if (has1m && hasEffort) {
                const msg = `Unexpected value(s) \`${CONTEXT_1M_BETA_HEADER}\`, \`${EFFORT_BETA_HEADER}\` for the \`anthropic-beta\` header`
                throw new APIError(400, { message: msg }, msg, new Headers())
              }
              if (has1m) {
                const msg = `Unexpected value(s) \`${CONTEXT_1M_BETA_HEADER}\` for the \`anthropic-beta\` header`
                throw new APIError(400, { message: msg }, msg, new Headers())
              }
              if (hasEffort) {
                const msg = `Unexpected value(s) \`${EFFORT_BETA_HEADER}\` for the \`anthropic-beta\` header`
                throw new APIError(400, { message: msg }, msg, new Headers())
              }
              return {
                request_id: `req_dual_${attemptCount}`,
                response: new Response(null, { status: 200 }),
                data: okStream(),
              }
            },
          }),
        },
      },
    } as never)

    try {
      const events: unknown[] = []
      for await (const ev of queryModelWithStreaming({
        messages: [
          {
            type: 'user',
            uuid: 'u-dual-1',
            message: { role: 'user', content: 'hello' },
          } as unknown as Message,
        ],
        systemPrompt: [] as never,
        thinkingConfig: { type: 'disabled' } as never,
        tools: [] as never,
        signal: new AbortController().signal,
        options: {
          model,
          querySource: 'repl_main_thread',
          betas: [CONTEXT_1M_BETA_HEADER, EFFORT_BETA_HEADER],
          effortValue: 'high',
          maxThinkingTokens: 0,
          thinkingDisabled: true,
          getToolPermissionContext: async () => ({
            mode: 'default',
            additionalWorkingDirectories: new Map(),
            alwaysAllowRules: {},
            alwaysDenyRules: {},
            alwaysAskRules: {},
            isBypassPermissionsModeAvailable: false,
          }),
        } as never,
      })) {
        events.push(ev)
      }

      expect(attemptCount).toBe(3)
      // Attempt 1 sent both context-1m and effort
      expect(sentBetasPerAttempt[0]).toContain(CONTEXT_1M_BETA_HEADER)
      expect(sentBetasPerAttempt[0]).toContain(EFFORT_BETA_HEADER)
      // Attempt 2 stripped effort first (s9o) while keeping context-1m
      expect(sentBetasPerAttempt[1]).toContain(CONTEXT_1M_BETA_HEADER)
      expect(sentBetasPerAttempt[1]).not.toContain(EFFORT_BETA_HEADER)
      // Attempt 3 stripped context-1m (d9o) and succeeded
      expect(sentBetasPerAttempt[2]).not.toContain(CONTEXT_1M_BETA_HEADER)
      expect(sentBetasPerAttempt[2]).not.toContain(EFFORT_BETA_HEADER)
      // Attempt 3 success latched markContext1mBetaRefusedForModel
      expect(isContext1mBetaRefusedForModel(model)).toBe(true)
      expect(events.length).toBeGreaterThan(0)
    } finally {
      clientSpy.mockRestore()
      vcrSpy.mockRestore()
      clearContext1mBetaRefusedModels()
    }
  })

  test('D-P0-1: Bedrock rejecting interleaved-thinking-2025-05-14 strips it from bedrockBetas on retry instead of looping infinitely', async () => {
    process.env.CLAUDE_CODE_USE_BEDROCK = '1'
    process.env.AWS_REGION = 'us-west-2'
    clearBetasCaches()
    clearContext1mBetaRefusedModels()

    const model = 'us.anthropic.claude-sonnet-4-5-20250929-v1:0'
    expect(getBedrockExtraBodyParamsBetas(model)).toContain(
      INTERLEAVED_THINKING_BETA_HEADER,
    )

    const sentAnthropicBetasPerAttempt: string[][] = []
    let attemptCount = 0

    const okStream = async function* () {
      yield {
        type: 'message_start',
        message: {
          id: 'msg_bedrock_ok',
          type: 'message',
          role: 'assistant',
          content: [],
          model,
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 1 },
        },
      }
      yield {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' },
      }
      yield {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'ok' },
      }
      yield { type: 'content_block_stop', index: 0 }
      yield {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        usage: { output_tokens: 2 },
      }
      yield { type: 'message_stop' }
    }

    const vcrSpy = spyOn(vcrModule, 'withStreamingVCR').mockImplementation(
      async function* (_msgs, f) {
        yield* f()
      },
    )
    const clientSpy = spyOn(
      clientModule,
      'getAnthropicClient',
    ).mockResolvedValue({
      beta: {
        messages: {
          create: (params: Record<string, unknown>) => ({
            withResponse: async () => {
              attemptCount++
              const bodyBetas = Array.isArray(params.anthropic_beta)
                ? [...(params.anthropic_beta as string[])]
                : []
              sentAnthropicBetasPerAttempt.push(bodyBetas)
              if (attemptCount > 4) {
                throw new Error('Infinite retry loop detected on Bedrock!')
              }
              if (bodyBetas.includes(INTERLEAVED_THINKING_BETA_HEADER)) {
                const msg = `Unexpected value(s) \`${INTERLEAVED_THINKING_BETA_HEADER}\` for the \`anthropic-beta\` header`
                throw new APIError(400, { message: msg }, msg, new Headers())
              }
              return {
                request_id: `req_bedrock_${attemptCount}`,
                response: new Response(null, { status: 200 }),
                data: okStream(),
              }
            },
          }),
        },
      },
    } as never)

    try {
      for await (const _ev of queryModelWithStreaming({
        messages: [
          {
            type: 'user',
            uuid: 'u-bedrock-1',
            message: { role: 'user', content: 'hello' },
          } as unknown as Message,
        ],
        systemPrompt: [] as never,
        thinkingConfig: { type: 'disabled' } as never,
        tools: [] as never,
        signal: new AbortController().signal,
        options: {
          model,
          querySource: 'repl_main_thread',
          maxThinkingTokens: 0,
          thinkingDisabled: true,
          getToolPermissionContext: async () => ({
            mode: 'default',
            additionalWorkingDirectories: new Map(),
            alwaysAllowRules: {},
            alwaysDenyRules: {},
            alwaysAskRules: {},
            isBypassPermissionsModeAvailable: false,
          }),
        } as never,
      })) {
        // drain
      }

      expect(attemptCount).toBe(2)
      expect(sentAnthropicBetasPerAttempt[0]).toContain(
        INTERLEAVED_THINKING_BETA_HEADER,
      )
      expect(sentAnthropicBetasPerAttempt[1]).not.toContain(
        INTERLEAVED_THINKING_BETA_HEADER,
      )
    } finally {
      clientSpy.mockRestore()
      vcrSpy.mockRestore()
      clearBetasCaches()
    }
  })
})
