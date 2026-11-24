import type Anthropic from '@anthropic-ai/sdk'
import { APIError } from '@anthropic-ai/sdk'
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  clearBetaHeaderLatches,
  recordServedModels,
  resetStateForTests,
} from '../../../bootstrap/state.js'
import { NO_CONTENT_MESSAGE } from '../../../constants/messages.js'
import { SYSTEM_PROMPT_DYNAMIC_BOUNDARY } from '../../../constants/prompts.js'
import type {
  AssistantMessage,
  Message,
  UserMessage,
} from '../../../types/message.js'
import {
  splitSysPromptPrefix,
  SYSTEM_PROMPT_STATIC_BREAKPOINT,
} from '../../../utils/api.js'
import * as authModule from '../../../utils/auth.js'
import * as fastModeModule from '../../../utils/fastMode.js'
import { asSystemPrompt } from '../../../utils/systemPromptType.js'
import {
  classifyThinkingDisplayRetry,
  classifyThinkingSignatureStripRetry,
  isForeignThinkingModel,
  isModelUpgradeCompatible,
  isSignedOrRedactedThinkingBlock,
  isThinkingSignatureRejected,
  stripForeignThinkingBlocks,
  type ThinkingStrippedAttachment,
} from '../../../utils/thinking.js'
import {
  clearRefusedClearToolUsesModelsForTesting,
  getAPIContextManagement,
  handleClearToolUsesRefusalError,
  hasModelRefusedClearToolUses,
  isClearToolUsesRefusedError,
  planClearToolUsesAfterIdle,
} from '../../compact/apiMicrocompact.js'
import * as vcrModule from '../../vcr.js'
import {
  buildResumptionRequestParams,
  buildSystemPromptBlocks,
  parseResumptionPauseDelta,
  queryModelWithStreaming,
  StreamMalformedEventError,
  StreamNoEventsError,
  StreamTruncatedError,
  stripEmptyUserTextBlocks,
  userMessageToMessageParam,
  wrapStreamWithResumption,
} from '../claude.js'
import * as clientModule from '../client.js'
import {
  CannotRetryError,
  FallbackTriggeredError,
  getRetryAfterMs,
  isLastResortFallbackExcluded,
  isNon529ServerError,
  isTransientNonUnified429,
  parseRetryAfterHeaderMs,
  shouldRetry,
  withRetry,
} from '../withRetry.js'

;(
  globalThis as unknown as {
    MACRO?: { VERSION: string; BUILD_TIME?: string }
  }
).MACRO ??= { VERSION: '2.1.328', BUILD_TIME: '2026-01-01T00:00:00Z' }

const ENV_KEYS = [
  'USE_API_CLEAR_TOOL_RESULTS',
  'USE_API_CLEAR_TOOL_USES',
  'CLAUDE_CODE_RETRY_WATCHDOG',
  'CLAUDE_CODE_RETRY_WATCHDOG_SCOPE',
  'CLAUDE_CODE_OVERLOADED_RETRY_MAX_WAIT_MS',
  'CLAUDE_CODE_OVERLOADED_RETRY_MAX_DELAY_MS',
  'CLAUDE_CODE_MAX_RETRIES',
  'CLAUDE_CODE_DISABLE_NONSTREAMING_FALLBACK',
  'CLAUDE_CODE_DISABLE_THINKING',
  'CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_OPENAI',
  'CLAUDE_CODE_USE_GEMINI',
  'CLAUDE_CODE_USE_GROK',
  'CLAUDE_CODE_USE_GATEWAY',
  'FALLBACK_FOR_ALL_PRIMARY_MODELS',
  'ANTHROPIC_BASE_URL',
  'MAX_THINKING_TOKENS',
  'DISABLE_PROMPT_CACHING',
  'CLAUDE_CODE_TEST_FIXTURES_ROOT',
] as const

const savedEnv: Record<string, string | undefined> = {}

function makeApiError(
  status: number,
  message: string,
  headers?: HeadersInit,
  body?: Record<string, unknown>,
): APIError {
  return new APIError(
    status,
    body ?? {
      type: 'error',
      error: { type: 'invalid_request_error', message },
    },
    message,
    new Headers(headers),
  )
}

function makeAssistant(
  model: string | undefined,
  content: unknown[],
  id = 'msg_1',
  timestamp = '2026-01-01T00:00:00.000Z',
): AssistantMessage {
  return {
    type: 'assistant',
    uuid: `asst-${id}`,
    timestamp,
    message: {
      id,
      type: 'message',
      role: 'assistant',
      model: model as string,
      content,
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: {
        input_tokens: 100,
        output_tokens: 20,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    },
  } as unknown as AssistantMessage
}

function makeUser(
  content: string | unknown[],
  id = 'u1',
  timestamp = '2026-01-01T00:00:00.000Z',
): UserMessage {
  return {
    type: 'user',
    uuid: `user-${id}`,
    timestamp,
    message: {
      role: 'user',
      content,
    },
  } as unknown as UserMessage
}

function makeMockStream(events: unknown[], onReturn?: () => void) {
  return {
    controller: new AbortController(),
    async *[Symbol.asyncIterator]() {
      try {
        for (const ev of events) {
          yield ev
        }
      } finally {
        onReturn?.()
      }
    },
  }
}

async function drainGenerator<Y, R>(
  gen: AsyncGenerator<Y, R>,
): Promise<{ yielded: Y[]; value: R }> {
  const yielded: Y[] = []
  while (true) {
    const next = await gen.next()
    if (next.done) return { yielded, value: next.value }
    yielded.push(next.value)
  }
}

let vcrSpy: ReturnType<typeof spyOn> | undefined
let vcrNonStreamSpy: ReturnType<typeof spyOn> | undefined
let tmpFixturesRoot: string | undefined

beforeEach(() => {
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k]
    delete process.env[k]
  }
  tmpFixturesRoot = mkdtempSync(join(tmpdir(), 'cf2-vcr-'))
  process.env.CLAUDE_CODE_TEST_FIXTURES_ROOT = tmpFixturesRoot
  resetStateForTests()
  clearBetaHeaderLatches()
  clearRefusedClearToolUsesModelsForTesting()
  vcrSpy = spyOn(vcrModule, 'withStreamingVCR').mockImplementation(
    async function* (_msgs, fn) {
      yield* fn()
    },
  )
  vcrNonStreamSpy = spyOn(vcrModule, 'withVCR').mockImplementation(
    async (_msgs, fn) => fn(),
  )
})

afterEach(() => {
  vcrSpy?.mockRestore()
  vcrSpy = undefined
  vcrNonStreamSpy?.mockRestore()
  vcrNonStreamSpy = undefined
  if (tmpFixturesRoot) {
    rmSync(tmpFixturesRoot, { recursive: true, force: true })
    tmpFixturesRoot = undefined
  }
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
  resetStateForTests()
  clearBetaHeaderLatches()
  clearRefusedClearToolUsesModelsForTesting()
})

describe('Group 1 [P0-1]: Model-aware foreign thinking stripping (fio/Bqi/Lze/DAt + Yso)', () => {
  test('preserves signed thinking & redacted_thinking on same-model turns, strips BOTH on foreign-model turns', () => {
    const sameTurn = makeAssistant(
      'claude-opus-4-6',
      [
        { type: 'thinking', thinking: 'same thoughts', signature: 'sig-same' },
        { type: 'redacted_thinking', data: 'redacted-same' },
        { type: 'text', text: 'same reply' },
      ],
      'm-same',
    )
    const same1mTurn = makeAssistant(
      'claude-opus-4-6[1m]',
      [
        { type: 'thinking', thinking: 'same 1m', signature: 'sig-1m' },
        { type: 'text', text: 'same 1m reply' },
      ],
      'm-1m',
    )
    const foreignTurn = makeAssistant(
      'claude-sonnet-4-6',
      [
        {
          type: 'thinking',
          thinking: 'foreign signed',
          signature: 'sig-foreign',
        },
        { type: 'redacted_thinking', data: 'redacted-foreign' },
        { type: 'thinking', thinking: 'unsigned draft' },
        { type: 'text', text: 'foreign reply' },
      ],
      'm-foreign',
    )
    const syntheticTurn = makeAssistant(
      '<synthetic>',
      [
        { type: 'redacted_thinking', data: 'synth' },
        { type: 'text', text: 'synthetic' },
      ],
      'm-synth',
    )
    const userTurn = makeUser('hello')

    const input: Message[] = [
      userTurn,
      sameTurn,
      same1mTurn,
      foreignTurn,
      syntheticTurn,
    ]
    const out = stripForeignThinkingBlocks(input, 'claude-opus-4-6')

    // Same-model turns keep referential identity and all thinking blocks
    expect(out[1]).toBe(sameTurn)
    expect(out[2]).toBe(same1mTurn)
    expect(out[4]).toBe(syntheticTurn)

    // Foreign-model turn strips signed thinking + redacted_thinking, keeps unsigned & text
    const foreignOut = (out[3] as AssistantMessage).message.content as Array<{
      type: string
      text?: string
    }>
    expect(foreignOut.map(b => b.type)).toEqual(['thinking', 'text'])
    expect(foreignOut[1]?.text).toBe('foreign reply')

    // When all messages are same-model, returns exact input array reference
    const sameOnly = [userTurn, sameTurn]
    expect(stripForeignThinkingBlocks(sameOnly, 'claude-opus-4-6')).toBe(
      sameOnly,
    )
  })

  test('honors served-model alias latch (evr) and keepForeignThinking upgrade/all policies (bbr/DAt)', () => {
    recordServedModels(
      'claude-opus-4-6',
      new Set(['claude-opus-4-6-custom-alias']),
    )
    expect(
      isForeignThinkingModel('claude-opus-4-6-custom-alias', 'claude-opus-4-6'),
    ).toBe(false)
    expect(isForeignThinkingModel(undefined, 'claude-opus-4-6')).toBe(true)

    expect(
      isSignedOrRedactedThinkingBlock({ type: 'redacted_thinking', data: 'x' }),
    ).toBe(true)
    expect(
      isSignedOrRedactedThinkingBlock({
        type: 'thinking',
        thinking: 'a',
        signature: 's',
      }),
    ).toBe(true)
    expect(
      isSignedOrRedactedThinkingBlock({ type: 'thinking', thinking: 'a' }),
    ).toBe(false)

    // Upgrade compatibility: sonnet-4-5 -> opus-4-6 ok; opus-4-6 -> sonnet-4-5 not ok
    expect(
      isModelUpgradeCompatible('claude-sonnet-4-5', 'claude-opus-4-6'),
    ).toBe(true)
    expect(
      isModelUpgradeCompatible('claude-opus-4-6', 'claude-sonnet-4-5'),
    ).toBe(false)

    const sonnetMsg = makeAssistant('claude-sonnet-4-5', [
      { type: 'thinking', thinking: 's', signature: 'sig-s' },
      { type: 'text', text: 'hi' },
    ])
    const keptUpgrade = stripForeignThinkingBlocks(
      [sonnetMsg],
      'claude-opus-4-6',
      {
        keepForeignThinking: 'upgrade',
      },
    )
    expect(keptUpgrade[0]).toBe(sonnetMsg)

    const strippedDowngrade = stripForeignThinkingBlocks(
      [
        makeAssistant('claude-opus-4-6', [
          { type: 'redacted_thinking', data: 'r' },
          { type: 'text', text: 'x' },
        ]),
      ],
      'claude-sonnet-4-5',
      { keepForeignThinking: 'upgrade' },
    )
    expect((strippedDowngrade[0] as AssistantMessage).message.content).toEqual([
      { type: 'text', text: 'x' },
    ])
  })

  test('claude.ts calls stripForeignThinkingBlocks before normalizeMessagesForAPI (live wire check)', async () => {
    process.env.CLAUDE_CODE_DISABLE_NONSTREAMING_FALLBACK = '1'
    let capturedBody: Record<string, unknown> | undefined
    const clientSpy = spyOn(
      clientModule,
      'getAnthropicClient',
    ).mockResolvedValue({
      beta: {
        messages: {
          create: (params: Record<string, unknown>) => {
            capturedBody = params
            return {
              withResponse: async () => ({
                data: makeMockStream([
                  {
                    type: 'message_start',
                    message: {
                      id: 'msg_live_1',
                      type: 'message',
                      role: 'assistant',
                      model: 'claude-opus-4-6',
                      content: [],
                      stop_reason: null,
                      stop_sequence: null,
                      usage: { input_tokens: 10, output_tokens: 0 },
                    },
                  },
                  {
                    type: 'content_block_start',
                    index: 0,
                    content_block: { type: 'text', text: '' },
                  },
                  {
                    type: 'content_block_delta',
                    index: 0,
                    delta: { type: 'text_delta', text: 'ok' },
                  },
                  { type: 'content_block_stop', index: 0 },
                  {
                    type: 'message_delta',
                    delta: { stop_reason: 'end_turn', stop_sequence: null },
                    usage: { output_tokens: 5 },
                  },
                  { type: 'message_stop' },
                ]),
                request_id: 'req_1',
                response: new Response(null, { status: 200 }),
              }),
            }
          },
        },
      },
    } as unknown as Anthropic)

    try {
      const msgs: Message[] = [
        makeUser('u1', '1'),
        makeAssistant(
          'claude-opus-4-6',
          [
            { type: 'thinking', thinking: 'keep me', signature: 'sig-keep' },
            { type: 'text', text: 'same model' },
          ],
          'a1',
        ),
        makeUser('u2', '2'),
        makeAssistant(
          'claude-sonnet-4-5',
          [
            { type: 'redacted_thinking', data: 'strip me' },
            { type: 'text', text: 'foreign model' },
          ],
          'a2',
        ),
        makeUser('u3', '3'),
      ]

      for await (const _ev of queryModelWithStreaming({
        messages: msgs,
        systemPrompt: asSystemPrompt(['You are Claude.']),
        thinkingConfig: { type: 'adaptive' },
        tools: [],
        signal: new AbortController().signal,
        options: {
          getToolPermissionContext: async () =>
            ({
              mode: 'default',
              additionalWorkingDirectories: new Map(),
              alwaysAllowRules: {},
              alwaysDenyRules: {},
              alwaysAskRules: {},
              isBypassPermissionsModeAvailable: false,
            }) as never,
          model: 'claude-opus-4-6',
          toolChoice: undefined,
          isNonInteractiveSession: true,
          hasAppendSystemPrompt: false,
          temperatureOverride: undefined,
          agents: [],
          querySource: 'sdk',
          mcpTools: [],
        },
      })) {
        // drain
      }

      const wireMessages = capturedBody?.messages as Array<{
        role: string
        content: Array<{ type: string; signature?: string }>
      }>
      const sameWire = wireMessages.find(
        m =>
          m.role === 'assistant' &&
          Array.isArray(m.content) &&
          m.content.some(
            b =>
              b.type === 'text' &&
              (b as { text?: string }).text === 'same model',
          ),
      )
      const foreignWire = wireMessages.find(
        m =>
          m.role === 'assistant' &&
          Array.isArray(m.content) &&
          m.content.some(
            b =>
              b.type === 'text' &&
              (b as { text?: string }).text === 'foreign model',
          ),
      )
      expect(
        sameWire?.content.some(
          b => b.type === 'thinking' && b.signature === 'sig-keep',
        ),
      ).toBe(true)
      expect(
        foreignWire?.content.some(b => b.type === 'redacted_thinking'),
      ).toBe(false)
    } finally {
      clientSpy.mockRestore()
    }
  })
})

describe('Group 2 [P0-2]: clear_tool_uses_20250919 idle gating & 400 refusal latch (Gjn/zjn/SUn)', () => {
  function buildToolConversation(
    toolUseCount: number,
    idleGapSeconds: number,
  ): Message[] {
    const msgs: Message[] = []
    const baseMs = Date.parse('2026-01-01T00:00:00.000Z')
    for (let i = 0; i < toolUseCount; i++) {
      const tsA = new Date(baseMs + i * 2000).toISOString()
      const tsU = new Date(baseMs + i * 2000 + 1000).toISOString()
      msgs.push(
        makeAssistant(
          'claude-opus-4-6',
          [
            {
              type: 'tool_use',
              id: `tu_${i}`,
              name: i % 2 === 0 ? 'Bash' : 'Read',
              input: { command: 'ls' },
            },
          ],
          `a_${i}`,
          tsA,
        ),
      )
      msgs.push(
        makeUser(
          [{ type: 'tool_result', tool_use_id: `tu_${i}`, content: 'output' }],
          `ur_${i}`,
          tsU,
        ),
      )
    }
    // Include one non-clearable tool so exclude_tools is populated
    const nonClearTs = new Date(baseMs + toolUseCount * 2000).toISOString()
    msgs.push(
      makeAssistant(
        'claude-opus-4-6',
        [{ type: 'tool_use', id: 'tu_edit', name: 'Edit', input: {} }],
        'a_edit',
        nonClearTs,
      ),
    )
    msgs.push(
      makeUser(
        [{ type: 'tool_result', tool_use_id: 'tu_edit', content: 'edited' }],
        'u_edit',
        new Date(baseMs + toolUseCount * 2000 + 1000).toISOString(),
      ),
    )
    // User returns after idleGapSeconds
    const returnTs = new Date(
      baseMs + toolUseCount * 2000 + 1000 + idleGapSeconds * 1000,
    ).toISOString()
    msgs.push(makeUser('I am back after a break', 'u_return', returnTs))
    return msgs
  }

  test('does NOT default clear_tool_uses_20250919 on warm sessions', () => {
    const cfg = getAPIContextManagement({ hasThinking: true })
    expect(cfg).toEqual({
      edits: [{ type: 'clear_thinking_20251015', keep: 'all' }],
    })
    expect(getAPIContextManagement({ hasThinking: false })).toBeUndefined()

    // Warm session (60s gap < 3900s) even with modeOverride:'on' emits NO clear_tool_uses_20250919
    const warmMsgs = buildToolConversation(35, 60)
    expect(
      planClearToolUsesAfterIdle(warmMsgs, { modeOverride: 'on' }),
    ).toBeUndefined()
  })

  test('emits tool_uses trigger + keep + exclude_tools strictly on cold-cache idle return', () => {
    const coldMsgs = buildToolConversation(35, 4000)
    // mode 'off' (default) -> undefined
    expect(
      planClearToolUsesAfterIdle(coldMsgs, { modeOverride: 'off' }),
    ).toBeUndefined()
    // mode 'shadow' -> undefined
    expect(
      planClearToolUsesAfterIdle(coldMsgs, { modeOverride: 'shadow' }),
    ).toBeUndefined()
    // mode 'on' -> emits tool_uses trigger + keep + clear_at_least + exclude_tools
    const strategy = planClearToolUsesAfterIdle(coldMsgs, {
      modeOverride: 'on',
    })
    expect(strategy).toBeDefined()
    expect(strategy?.type).toBe('clear_tool_uses_20250919')
    expect(strategy?.trigger).toEqual({ type: 'tool_uses', value: 32 })
    expect(strategy?.keep).toEqual({ type: 'tool_uses', value: 12 })
    expect(strategy?.clear_at_least).toEqual({
      type: 'input_tokens',
      value: 20_000,
    })
    expect(strategy?.exclude_tools).toEqual(['Edit'])
  })

  test('Gjn 400 refusal latches modelsThatRefusedTheEdit and strips clear_tool_uses_20250919 on retry', async () => {
    const err400 = makeApiError(
      400,
      '400 claude-haiku-3-5 does not support the `clear_tool_uses_20250919` context management strategy',
    )
    expect(isClearToolUsesRefusedError(err400)).toBe(true)
    expect(hasModelRefusedClearToolUses('claude-haiku-3-5')).toBe(false)
    expect(handleClearToolUsesRefusalError(err400, 'claude-haiku-3-5')).toBe(
      true,
    )
    expect(hasModelRefusedClearToolUses('claude-haiku-3-5')).toBe(true)
    expect(hasModelRefusedClearToolUses('claude-haiku-3-5[1m]')).toBe(true)

    // Even with explicit env opt-in, refused model stops receiving clear_tool_uses_20250919
    process.env.USE_API_CLEAR_TOOL_RESULTS = '1'
    const cfgAfterRefusal = getAPIContextManagement({
      hasThinking: true,
      model: 'claude-haiku-3-5',
    })
    expect(cfgAfterRefusal?.edits.map(e => e.type)).toEqual([
      'clear_thinking_20251015',
    ])

    // Live stream retry: first call sends clear_tool_uses_20250919, gets 400 refusal,
    // latches model, strips edit, retries cleanly and succeeds.
    clearRefusedClearToolUsesModelsForTesting()
    process.env.CLAUDE_CODE_DISABLE_NONSTREAMING_FALLBACK = '1'
    const sentContexts: unknown[] = []
    let callCount = 0
    const clientSpy = spyOn(
      clientModule,
      'getAnthropicClient',
    ).mockResolvedValue({
      beta: {
        messages: {
          create: (params: Record<string, unknown>) => {
            callCount++
            sentContexts.push(params.context_management)
            return {
              withResponse: async () => {
                if (callCount === 1) {
                  throw makeApiError(
                    400,
                    'claude-sonnet-4-6 does not support the clear_tool_uses_20250919 context management strategy',
                  )
                }
                return {
                  data: makeMockStream([
                    {
                      type: 'message_start',
                      message: {
                        id: 'msg_retry_ok',
                        type: 'message',
                        role: 'assistant',
                        model: 'claude-sonnet-4-6',
                        content: [],
                        stop_reason: null,
                        stop_sequence: null,
                        usage: { input_tokens: 10, output_tokens: 0 },
                      },
                    },
                    {
                      type: 'content_block_start',
                      index: 0,
                      content_block: { type: 'text', text: '' },
                    },
                    {
                      type: 'content_block_delta',
                      index: 0,
                      delta: { type: 'text_delta', text: 'healed' },
                    },
                    { type: 'content_block_stop', index: 0 },
                    {
                      type: 'message_delta',
                      delta: { stop_reason: 'end_turn', stop_sequence: null },
                      usage: { output_tokens: 3 },
                    },
                    { type: 'message_stop' },
                  ]),
                  request_id: 'req_2',
                  response: new Response(null, { status: 200 }),
                }
              },
            }
          },
        },
      },
    } as unknown as Anthropic)

    try {
      const yielded: unknown[] = []
      for await (const ev of queryModelWithStreaming({
        messages: [makeUser('hi')],
        systemPrompt: asSystemPrompt(['You are Claude.']),
        thinkingConfig: { type: 'disabled' },
        tools: [],
        signal: new AbortController().signal,
        options: {
          getToolPermissionContext: async () =>
            ({
              mode: 'default',
              additionalWorkingDirectories: new Map(),
              alwaysAllowRules: {},
              alwaysDenyRules: {},
              alwaysAskRules: {},
              isBypassPermissionsModeAvailable: false,
            }) as never,
          model: 'claude-sonnet-4-6',
          toolChoice: undefined,
          isNonInteractiveSession: true,
          hasAppendSystemPrompt: false,
          temperatureOverride: undefined,
          agents: [],
          querySource: 'sdk',
          mcpTools: [],
        },
      })) {
        yielded.push(ev)
      }
      expect(callCount).toBe(2)
      expect(hasModelRefusedClearToolUses('claude-sonnet-4-6')).toBe(true)
      expect(sentContexts[0]).toBeDefined()
      expect(sentContexts[1]).toBeUndefined()
      expect(
        yielded.some(
          e =>
            (e as AssistantMessage).type === 'assistant' &&
            ((e as AssistantMessage).message.content?.[0] as { text?: string })
              ?.text === 'healed',
        ),
      ).toBe(true)
    } finally {
      clientSpy.mockRestore()
    }
  })
})

describe('Group 3 [P0-6]: SSE clean EOF truncation checks & clean abort handling (Lpr/Dpr)', () => {
  function mockStreamingEvents(events: unknown[], onFirstEvent?: () => void) {
    return spyOn(clientModule, 'getAnthropicClient').mockResolvedValue({
      beta: {
        messages: {
          create: () => ({
            withResponse: async () => ({
              data: {
                controller: new AbortController(),
                async *[Symbol.asyncIterator]() {
                  let first = true
                  for (const ev of events) {
                    if (first) {
                      first = false
                      onFirstEvent?.()
                    }
                    yield ev
                  }
                },
              },
              request_id: 'req_eof',
              response: new Response(null, { status: 200 }),
            }),
          }),
        },
      },
    } as unknown as Anthropic)
  }

  test('aborted clean EOF returns cleanly without throwing StreamNoEventsError', async () => {
    process.env.CLAUDE_CODE_DISABLE_NONSTREAMING_FALLBACK = '1'
    const ac = new AbortController()
    const clientSpy = mockStreamingEvents(
      [
        {
          type: 'message_start',
          message: {
            id: 'msg_abort',
            type: 'message',
            role: 'assistant',
            model: 'claude-sonnet-4-6',
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 10, output_tokens: 0 },
          },
        },
      ],
      () => ac.abort(),
    )

    try {
      const yielded: unknown[] = []
      for await (const ev of queryModelWithStreaming({
        messages: [makeUser('hi')],
        systemPrompt: asSystemPrompt(['You are Claude.']),
        thinkingConfig: { type: 'disabled' },
        tools: [],
        signal: ac.signal,
        options: {
          getToolPermissionContext: async () =>
            ({
              mode: 'default',
              additionalWorkingDirectories: new Map(),
              alwaysAllowRules: {},
              alwaysDenyRules: {},
              alwaysAskRules: {},
              isBypassPermissionsModeAvailable: false,
            }) as never,
          model: 'claude-sonnet-4-6',
          toolChoice: undefined,
          isNonInteractiveSession: true,
          hasAppendSystemPrompt: false,
          temperatureOverride: undefined,
          agents: [],
          querySource: 'sdk',
          mcpTools: [],
        },
      })) {
        yielded.push(ev)
      }
      // Must NOT yield an API error message for StreamNoEventsError
      expect(
        yielded.some(e => (e as AssistantMessage).isApiErrorMessage === true),
      ).toBe(false)
    } finally {
      clientSpy.mockRestore()
    }
  })

  test('clean EOF inside an open content block throws StreamTruncatedError (Lpr) -> partial/error handling instead of silent success', async () => {
    process.env.CLAUDE_CODE_DISABLE_NONSTREAMING_FALLBACK = '1'
    const clientSpy = mockStreamingEvents([
      {
        type: 'message_start',
        message: {
          id: 'msg_open',
          type: 'message',
          role: 'assistant',
          model: 'claude-sonnet-4-6',
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 0 },
        },
      },
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'partial' },
      },
      { type: 'content_block_stop', index: 0 },
      // Second block opened and stream drops cleanly mid-block!
      {
        type: 'content_block_start',
        index: 1,
        content_block: { type: 'text', text: '' },
      },
      {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'text_delta', text: 'cut off' },
      },
    ])

    try {
      const yielded: unknown[] = []
      for await (const ev of queryModelWithStreaming({
        messages: [makeUser('hi')],
        systemPrompt: asSystemPrompt(['You are Claude.']),
        thinkingConfig: { type: 'disabled' },
        tools: [],
        signal: new AbortController().signal,
        options: {
          getToolPermissionContext: async () =>
            ({
              mode: 'default',
              additionalWorkingDirectories: new Map(),
              alwaysAllowRules: {},
              alwaysDenyRules: {},
              alwaysAskRules: {},
              isBypassPermissionsModeAvailable: false,
            }) as never,
          model: 'claude-sonnet-4-6',
          toolChoice: undefined,
          isNonInteractiveSession: true,
          hasAppendSystemPrompt: false,
          temperatureOverride: undefined,
          agents: [],
          querySource: 'sdk',
          mcpTools: [],
        },
      })) {
        yielded.push(ev)
      }
      // StreamTruncatedError caught by mid-stream partial finalize -> emits incomplete banner!
      const errorBanner = yielded.find(
        e => (e as AssistantMessage).isApiErrorMessage === true,
      ) as AssistantMessage | undefined
      expect(errorBanner).toBeDefined()
      expect(
        (errorBanner?.message.content?.[0] as { text?: string })?.text,
      ).toContain('Connection closed mid-response')
    } finally {
      clientSpy.mockRestore()
    }
  })

  test('clean EOF after content_block_stop without message_delta triggers StreamTruncatedError (Lpr)', async () => {
    process.env.CLAUDE_CODE_DISABLE_NONSTREAMING_FALLBACK = '1'
    const clientSpy = mockStreamingEvents([
      {
        type: 'message_start',
        message: {
          id: 'msg_no_delta',
          type: 'message',
          role: 'assistant',
          model: 'claude-sonnet-4-6',
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 0 },
        },
      },
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'block done but no message_delta' },
      },
      { type: 'content_block_stop', index: 0 },
      // Clean EOF with NO message_delta and NO message_stop!
    ])

    try {
      const yielded: unknown[] = []
      for await (const ev of queryModelWithStreaming({
        messages: [makeUser('hi')],
        systemPrompt: asSystemPrompt(['You are Claude.']),
        thinkingConfig: { type: 'disabled' },
        tools: [],
        signal: new AbortController().signal,
        options: {
          getToolPermissionContext: async () =>
            ({
              mode: 'default',
              additionalWorkingDirectories: new Map(),
              alwaysAllowRules: {},
              alwaysDenyRules: {},
              alwaysAskRules: {},
              isBypassPermissionsModeAvailable: false,
            }) as never,
          model: 'claude-sonnet-4-6',
          toolChoice: undefined,
          isNonInteractiveSession: true,
          hasAppendSystemPrompt: false,
          temperatureOverride: undefined,
          agents: [],
          querySource: 'sdk',
          mcpTools: [],
        },
      })) {
        yielded.push(ev)
      }
      const errorBanner = yielded.find(
        e => (e as AssistantMessage).isApiErrorMessage === true,
      ) as AssistantMessage | undefined
      expect(errorBanner).toBeDefined()
      expect(
        (errorBanner?.message.content?.[0] as { text?: string })?.text,
      ).toContain('Connection closed mid-response')
      expect(new StreamTruncatedError().code).toBe('StreamTruncated')
      expect(new StreamNoEventsError().message).toBe(
        'Stream ended without receiving any events',
      )
    } finally {
      clientSpy.mockRestore()
    }
  })
})

describe('Group 4 [P0-7]: Invalid thinking signature 400 strip-and-retry (BN/I9o)', () => {
  test('isThinkingSignatureRejected matches single quotes, backticks, redacted_thinking, cannot be modified, and capability_rejected', () => {
    expect(
      isThinkingSignatureRejected(
        makeApiError(400, "Invalid 'signature' in 'thinking' block"),
      ),
    ).toBe(true)
    expect(
      isThinkingSignatureRejected(
        makeApiError(400, 'Invalid `signature` in `thinking` block'),
      ),
    ).toBe(true)
    expect(
      isThinkingSignatureRejected(
        makeApiError(400, 'Invalid data in redacted_thinking block'),
      ),
    ).toBe(true)
    expect(
      isThinkingSignatureRejected(
        makeApiError(400, 'thinking block cannot be modified'),
      ),
    ).toBe(true)
    expect(
      isThinkingSignatureRejected(
        makeApiError(400, 'capability_rejected: thinking_signature'),
      ),
    ).toBe(true)
    expect(
      isThinkingSignatureRejected(makeApiError(400, 'unrelated 400 error')),
    ).toBe(false)
  })

  test('classifyThinkingDisplayRetry strips thinking and returns retry:thinking-signature-strip unless resumeIncompleteThinking is set', () => {
    const msgs: Message[] = [
      makeUser('hello'),
      makeAssistant('claude-opus-4-6', [
        { type: 'thinking', thinking: 'bad sig', signature: 'corrupt' },
        { type: 'redacted_thinking', data: 'bad data' },
        { type: 'text', text: 'kept text' },
      ]),
    ]
    let healed: Message[] | undefined
    let strippedAtt: ThinkingStrippedAttachment | undefined

    const err = makeApiError(400, "Invalid 'signature' in 'thinking' block")
    // Suppressed when resumeIncompleteThinking === true
    expect(
      classifyThinkingSignatureStripRetry(err, {
        model: 'claude-opus-4-6',
        resumeIncompleteThinking: true,
        messages: msgs,
      }),
    ).toBeNull()

    // Triggers via classifyThinkingDisplayRetry after prefix-lock miss
    const token = classifyThinkingDisplayRetry(
      err,
      undefined,
      [],
      'claude-opus-4-6',
      {
        messages: msgs,
        onMessagesHealed: next => {
          healed = next
        },
        onThinkingStripped: att => {
          strippedAtt = att
        },
        querySource: 'sdk',
      },
    )
    expect(token).toBe('retry:thinking-signature-strip')
    expect(strippedAtt).toEqual({ type: 'thinking_stripped', scope: 'all' })
    expect((healed?.[1] as AssistantMessage).message.content).toEqual([
      { type: 'text', text: 'kept text' },
    ])
  })

  test('live queryModelWithStreaming recovers from 400 invalid thinking signature by stripping thinking and retrying once', async () => {
    process.env.CLAUDE_CODE_DISABLE_NONSTREAMING_FALLBACK = '1'
    const sentMessagesPerCall: unknown[] = []
    let calls = 0
    const clientSpy = spyOn(
      clientModule,
      'getAnthropicClient',
    ).mockResolvedValue({
      beta: {
        messages: {
          create: (params: Record<string, unknown>) => {
            calls++
            sentMessagesPerCall.push(params.messages)
            return {
              withResponse: async () => {
                if (calls === 1) {
                  throw makeApiError(
                    400,
                    "Invalid 'signature' in 'thinking' block",
                  )
                }
                return {
                  data: makeMockStream([
                    {
                      type: 'message_start',
                      message: {
                        id: 'msg_sig_healed',
                        type: 'message',
                        role: 'assistant',
                        model: 'claude-opus-4-6',
                        content: [],
                        stop_reason: null,
                        stop_sequence: null,
                        usage: { input_tokens: 15, output_tokens: 0 },
                      },
                    },
                    {
                      type: 'content_block_start',
                      index: 0,
                      content_block: { type: 'text', text: '' },
                    },
                    {
                      type: 'content_block_delta',
                      index: 0,
                      delta: { type: 'text_delta', text: 'recovered' },
                    },
                    { type: 'content_block_stop', index: 0 },
                    {
                      type: 'message_delta',
                      delta: { stop_reason: 'end_turn', stop_sequence: null },
                      usage: { output_tokens: 4 },
                    },
                    { type: 'message_stop' },
                  ]),
                  request_id: 'req_sig_2',
                  response: new Response(null, { status: 200 }),
                }
              },
            }
          },
        },
      },
    } as unknown as Anthropic)

    try {
      const msgs: Message[] = [
        makeUser('q1', '1'),
        makeAssistant(
          'claude-opus-4-6',
          [
            { type: 'thinking', thinking: 'old thought', signature: 'bad-sig' },
            { type: 'text', text: 'prior answer' },
          ],
          'a1',
        ),
        makeUser('q2', '2'),
      ]
      const yielded: unknown[] = []
      for await (const ev of queryModelWithStreaming({
        messages: msgs,
        systemPrompt: asSystemPrompt(['You are Claude.']),
        thinkingConfig: { type: 'adaptive' },
        tools: [],
        signal: new AbortController().signal,
        options: {
          getToolPermissionContext: async () =>
            ({
              mode: 'default',
              additionalWorkingDirectories: new Map(),
              alwaysAllowRules: {},
              alwaysDenyRules: {},
              alwaysAskRules: {},
              isBypassPermissionsModeAvailable: false,
            }) as never,
          model: 'claude-opus-4-6',
          toolChoice: undefined,
          isNonInteractiveSession: true,
          hasAppendSystemPrompt: false,
          temperatureOverride: undefined,
          agents: [],
          querySource: 'sdk',
          mcpTools: [],
        },
      })) {
        yielded.push(ev)
      }
      expect(calls).toBe(2)
      const firstAsst = (
        sentMessagesPerCall[0] as Array<{
          role: string
          content: Array<{ type: string }>
        }>
      ).find(m => m.role === 'assistant')
      const secondAsst = (
        sentMessagesPerCall[1] as Array<{
          role: string
          content: Array<{ type: string }>
        }>
      ).find(m => m.role === 'assistant')
      expect(firstAsst?.content.some(b => b.type === 'thinking')).toBe(true)
      expect(secondAsst?.content.some(b => b.type === 'thinking')).toBe(false)
      expect(
        yielded.some(
          e =>
            (e as AssistantMessage).type === 'assistant' &&
            ((e as AssistantMessage).message.content?.[0] as { text?: string })
              ?.text === 'recovered',
        ),
      ).toBe(true)
    } finally {
      clientSpy.mockRestore()
    }
  })
})

describe('Group 5 [P0-9 + P1-11 + P2]: withRetry fallbacks, subscriber non-unified 429, Retry-After ceiling/HTTP-date, fast-mode cap, non-APIError notifications', () => {
  test('[P0-9] consecutive 529 fallback triggers for Claude.ai subscribers and non-Opus models when fallbackModel is set', async () => {
    const subSpy = spyOn(authModule, 'isClaudeAISubscriber').mockReturnValue(
      true,
    )
    let calls = 0
    try {
      const gen = withRetry(
        async () => ({}) as Anthropic,
        async () => {
          calls++
          throw makeApiError(529, 'Overloaded', { 'retry-after': '0' })
        },
        {
          model: 'claude-sonnet-4-6',
          fallbackModel: 'claude-haiku-4-5',
          maxRetries: 5,
          thinkingConfig: { type: 'disabled' },
        },
      )
      await expect(drainGenerator(gen)).rejects.toMatchObject({
        name: 'FallbackTriggeredError',
        originalModel: 'claude-sonnet-4-6',
        fallbackModel: 'claude-haiku-4-5',
        reason: 'overloaded',
      })
      expect(calls).toBe(3)
    } finally {
      subSpy.mockRestore()
    }
  })

  test('[P1-11a] non-529 5xx throws FallbackTriggeredError with reason=server_error when fallbackModel is set', async () => {
    expect(isNon529ServerError(makeApiError(500, 'Internal error'))).toBe(true)
    expect(isNon529ServerError(makeApiError(529, 'Overloaded'))).toBe(false)

    const gen = withRetry(
      async () => ({}) as Anthropic,
      async () => {
        throw makeApiError(500, 'Internal Server Error')
      },
      {
        model: 'claude-opus-4-6',
        fallbackModel: 'claude-sonnet-4-6',
        maxRetries: 2,
        thinkingConfig: { type: 'disabled' },
      },
    )
    let caught: unknown
    try {
      await drainGenerator(gen)
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(FallbackTriggeredError)
    expect((caught as FallbackTriggeredError).reason).toBe('server_error')
    expect((caught as FallbackTriggeredError).fallbackModel).toBe(
      'claude-sonnet-4-6',
    )
  })

  test('[P1-11b] last_resort fallback fires on eligible non-retryable HTTP errors and skips excluded errors', async () => {
    const eligible422 = makeApiError(422, 'Model rejected specific feature')
    expect(isLastResortFallbackExcluded(eligible422)).toBe(false)
    expect(
      isLastResortFallbackExcluded(makeApiError(401, 'Unauthorized')),
    ).toBe(true)
    expect(isLastResortFallbackExcluded(makeApiError(413, 'Too large'))).toBe(
      true,
    )
    expect(
      isLastResortFallbackExcluded(
        makeApiError(400, 'prompt is too long: 300000 tokens'),
      ),
    ).toBe(true)
    expect(
      isLastResortFallbackExcluded(makeApiError(404, 'not found'), {
        isNonStreamingRequest: true,
      }),
    ).toBe(false)

    const gen = withRetry(
      async () => ({}) as Anthropic,
      async () => {
        throw eligible422
      },
      {
        model: 'claude-opus-4-6',
        fallbackModel: 'claude-sonnet-4-6',
        maxRetries: 2,
        thinkingConfig: { type: 'disabled' },
      },
    )
    let caught: unknown
    try {
      await drainGenerator(gen)
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(FallbackTriggeredError)
    expect((caught as FallbackTriggeredError).reason).toBe('last_resort')

    // Excluded 413 must NOT trigger last_resort fallback -> CannotRetryError
    const gen413 = withRetry(
      async () => ({}) as Anthropic,
      async () => {
        throw makeApiError(413, 'Request too large')
      },
      {
        model: 'claude-opus-4-6',
        fallbackModel: 'claude-sonnet-4-6',
        maxRetries: 2,
        thinkingConfig: { type: 'disabled' },
      },
    )
    await expect(drainGenerator(gen413)).rejects.toBeInstanceOf(
      CannotRetryError,
    )
  })

  test('[P1-11c] Pro/Max Claude.ai subscribers retry transient non-unified 429s (Iso) but not unified quota 429s', () => {
    const subSpy = spyOn(authModule, 'isClaudeAISubscriber').mockReturnValue(
      true,
    )
    const entSpy = spyOn(authModule, 'isEnterpriseSubscriber').mockReturnValue(
      false,
    )
    try {
      const transient429 = makeApiError(429, 'Too many requests')
      const unifiedQuota429 = makeApiError(429, 'Rate limit exceeded', {
        'anthropic-ratelimit-unified-representative-claim': 'five_hour',
      })
      const overageDisabled429 = makeApiError(429, 'Rate limit exceeded', {
        'anthropic-ratelimit-unified-overage-disabled-reason': 'not_enabled',
      })

      expect(isTransientNonUnified429(transient429)).toBe(true)
      expect(isTransientNonUnified429(unifiedQuota429)).toBe(false)
      expect(isTransientNonUnified429(overageDisabled429)).toBe(false)

      expect(shouldRetry(transient429)).toBe(true)
      expect(shouldRetry(unifiedQuota429)).toBe(false)
      expect(shouldRetry(overageDisabled429)).toBe(false)
    } finally {
      subSpy.mockRestore()
      entSpy.mockRestore()
    }
  })

  test('[P1-11d] non-persistent mode aborts with CannotRetryError when Retry-After exceeds 60s ceiling (xso)', async () => {
    const subSpy = spyOn(authModule, 'isClaudeAISubscriber').mockReturnValue(
      false,
    )
    const t0 = Date.now()
    try {
      const gen = withRetry(
        async () => ({}) as Anthropic,
        async () => {
          throw makeApiError(429, 'Rate limited', { 'retry-after': '120' })
        },
        {
          model: 'claude-sonnet-4-6',
          maxRetries: 3,
          thinkingConfig: { type: 'disabled' },
        },
      )
      await expect(drainGenerator(gen)).rejects.toBeInstanceOf(CannotRetryError)
      // Must fail fast, NOT sleep 120 seconds!
      expect(Date.now() - t0).toBeLessThan(2000)
    } finally {
      subSpy.mockRestore()
    }
  })

  test('[P1-11e] fast-mode short retry-after enforces cumulative 20s cap (eGe), yields retry notice, and calls onRetryStatus', async () => {
    const enabledSpy = spyOn(
      fastModeModule,
      'isFastModeEnabled',
    ).mockReturnValue(true)
    const cooldownSpy = spyOn(
      fastModeModule,
      'isFastModeCooldown',
    ).mockReturnValue(false)
    const rejectedSpy = spyOn(
      fastModeModule,
      'isModelFastModeRejectedForSession',
    ).mockReturnValue(false)
    const triggerCooldownSpy = spyOn(
      fastModeModule,
      'triggerFastModeCooldown',
    ).mockImplementation(() => {})

    const statuses: unknown[] = []
    const fastModesSeen: Array<boolean | undefined> = []
    let attempt = 0
    try {
      // First 429 has retry-after: 0 (wait ~500ms < 20s) -> stays fastMode, yields notice + onRetryStatus.
      // Second 429 has retry-after: 19 -> cumulative >= 20s -> drops to standard speed WITHOUT sleeping 19s!
      const gen = withRetry(
        async () => ({}) as Anthropic,
        async (_client, _a, ctx) => {
          attempt++
          fastModesSeen.push(ctx.fastMode)
          if (attempt === 1) {
            throw makeApiError(429, 'Brief fast-mode 429', {
              'retry-after': '0',
            })
          }
          if (attempt === 2) {
            throw makeApiError(429, 'Longer fast-mode 429', {
              'retry-after': '19.6',
            })
          }
          return 'ok'
        },
        {
          model: 'claude-opus-4-6',
          fastMode: true,
          maxRetries: 4,
          thinkingConfig: { type: 'disabled' },
          onRetryStatus: s => {
            if (s !== null) statuses.push(s)
          },
        },
      )
      const { yielded, value } = await drainGenerator(gen)
      expect(value).toBe('ok')
      expect(fastModesSeen).toEqual([true, true, false])
      expect(yielded.length).toBe(1)
      expect(yielded[0]?.subtype).toBe('api_error')
      expect(statuses.length).toBeGreaterThanOrEqual(1)
      expect(triggerCooldownSpy).toHaveBeenCalled()
    } finally {
      enabledSpy.mockRestore()
      cooldownSpy.mockRestore()
      rejectedSpy.mockRestore()
      triggerCooldownSpy.mockRestore()
    }
  })

  test('[P2a] yields SystemAPIErrorMessage retry notification for non-APIError retryable errors (cAt)', async () => {
    let calls = 0
    const gen = withRetry(
      async () => ({}) as Anthropic,
      async () => {
        calls++
        if (calls === 1) {
          throw new StreamTruncatedError()
        }
        return 'recovered'
      },
      {
        model: 'claude-sonnet-4-6',
        maxRetries: 2,
        thinkingConfig: { type: 'disabled' },
      },
    )
    const { yielded, value } = await drainGenerator(gen)
    expect(value).toBe('recovered')
    expect(calls).toBe(2)
    expect(yielded.length).toBe(1)
    expect(yielded[0]?.type).toBe('system')
    expect(yielded[0]?.subtype).toBe('api_error')
  })

  test('[P2b] parseRetryAfterHeaderMs & getRetryAfterMs parse integer seconds, decimal seconds, and HTTP-date formats', () => {
    const now = Date.parse('2026-10-21T07:27:30.000Z')
    expect(parseRetryAfterHeaderMs('15', now)).toBe(15_000)
    expect(parseRetryAfterHeaderMs('1.5', now)).toBe(1500)
    expect(parseRetryAfterHeaderMs('Wed, 21 Oct 2026 07:28:00 GMT', now)).toBe(
      30_000,
    )
    expect(parseRetryAfterHeaderMs('2026-10-21T07:28:15Z', now)).toBe(45_000)
    // Past HTTP-date returns null so normal backoff applies
    expect(
      parseRetryAfterHeaderMs('Wed, 21 Oct 2026 07:20:00 GMT', now),
    ).toBeNull()

    const errWithDate = makeApiError(429, 'Rate limited', {
      'retry-after': 'Wed, 21 Oct 2026 07:28:00 GMT',
    })
    expect(getRetryAfterMs(errWithDate, now)).toBe(30_000)
  })
})

describe('Group 6 [P1-9 + P1-14]: SSE event assembly, pause_turn stream resumption & refusal fallback', () => {
  test('citations_delta, redacted_thinking thinking_delta, and message_delta writeback (stop_details/context_management/resumable/onMessageDelta)', async () => {
    process.env.CLAUDE_CODE_DISABLE_NONSTREAMING_FALLBACK = '1'
    const deltaCallbacks: AssistantMessage[][] = []
    const clientSpy = spyOn(
      clientModule,
      'getAnthropicClient',
    ).mockResolvedValue({
      beta: {
        messages: {
          create: () => ({
            withResponse: async () => ({
              data: makeMockStream([
                {
                  type: 'message_start',
                  message: {
                    id: 'msg_sse_1',
                    type: 'message',
                    role: 'assistant',
                    model: 'claude-opus-4-6',
                    content: [],
                    stop_reason: null,
                    stop_sequence: null,
                    usage: { input_tokens: 50, output_tokens: 0 },
                  },
                },
                {
                  type: 'content_block_start',
                  index: 0,
                  content_block: {
                    type: 'redacted_thinking',
                    data: 'enc_blob',
                  },
                },
                // thinking_delta on redacted_thinking must NOT throw
                {
                  type: 'content_block_delta',
                  index: 0,
                  delta: {
                    type: 'thinking_delta',
                    thinking: '',
                    estimated_tokens: 42,
                  },
                },
                { type: 'content_block_stop', index: 0 },
                {
                  type: 'content_block_start',
                  index: 1,
                  content_block: { type: 'text', text: '' },
                },
                {
                  type: 'content_block_delta',
                  index: 1,
                  delta: { type: 'text_delta', text: 'Cited answer.' },
                },
                {
                  type: 'content_block_delta',
                  index: 1,
                  delta: {
                    type: 'citations_delta',
                    citation: {
                      type: 'char_location',
                      cited_text: 'Cited',
                      document_index: 0,
                      start_char_index: 0,
                      end_char_index: 5,
                    },
                  },
                },
                { type: 'content_block_stop', index: 1 },
                {
                  type: 'message_delta',
                  delta: {
                    stop_reason: 'end_turn',
                    stop_sequence: null,
                    stop_details: {
                      category: 'none',
                      fallback_credit_token: 'secret-token',
                      resumption: { token: 'transient-tok' },
                    },
                    resumable: true,
                  },
                  context_management: {
                    applied_edits: [
                      {
                        type: 'clear_thinking_20251015',
                        cleared_thinking_turns: 0,
                      },
                    ],
                  },
                  usage: { output_tokens: 18 },
                },
                { type: 'message_stop' },
              ]),
              request_id: 'req_sse',
              response: new Response(null, { status: 200 }),
            }),
          }),
        },
      },
    } as unknown as Anthropic)

    try {
      const assistantMsgs: AssistantMessage[] = []
      for await (const ev of queryModelWithStreaming({
        messages: [makeUser('cite something')],
        systemPrompt: asSystemPrompt(['You are Claude.']),
        thinkingConfig: { type: 'adaptive' },
        tools: [],
        signal: new AbortController().signal,
        options: {
          getToolPermissionContext: async () =>
            ({
              mode: 'default',
              additionalWorkingDirectories: new Map(),
              alwaysAllowRules: {},
              alwaysDenyRules: {},
              alwaysAskRules: {},
              isBypassPermissionsModeAvailable: false,
            }) as never,
          model: 'claude-opus-4-6',
          toolChoice: undefined,
          isNonInteractiveSession: true,
          hasAppendSystemPrompt: false,
          temperatureOverride: undefined,
          agents: [],
          querySource: 'sdk',
          mcpTools: [],
          onMessageDelta: msgs => {
            deltaCallbacks.push([...msgs])
          },
        },
      })) {
        if ((ev as AssistantMessage).type === 'assistant') {
          assistantMsgs.push(ev as AssistantMessage)
        }
      }

      expect(assistantMsgs.length).toBe(2)
      const textBlock = assistantMsgs[1]!.message.content?.[0] as {
        type: string
        text: string
        citations?: unknown[]
      }
      expect(textBlock.text).toBe('Cited answer.')
      expect(textBlock.citations).toEqual([
        {
          type: 'char_location',
          cited_text: 'Cited',
          document_index: 0,
          start_char_index: 0,
          end_char_index: 5,
        },
      ])

      // Verify message_delta writeback onto all yielded messages
      const msgMeta = assistantMsgs[1]!.message as unknown as Record<
        string,
        unknown
      >
      expect(msgMeta.stop_reason).toBe('end_turn')
      expect(msgMeta.resumable).toBe(true)
      expect(msgMeta.context_management).toEqual({
        applied_edits: [
          { type: 'clear_thinking_20251015', cleared_thinking_turns: 0 },
        ],
      })
      // Sensitive tokens scrubbed from stop_details
      expect(msgMeta.stop_details).toEqual({ category: 'none' })
      expect(deltaCallbacks.length).toBe(1)
    } finally {
      clientSpy.mockRestore()
    }
  })

  test('closedContentBlocks rejects delta/stop/start on already-closed content block index', async () => {
    process.env.CLAUDE_CODE_DISABLE_NONSTREAMING_FALLBACK = '1'
    const clientSpy = spyOn(
      clientModule,
      'getAnthropicClient',
    ).mockResolvedValue({
      beta: {
        messages: {
          create: () => ({
            withResponse: async () => ({
              data: makeMockStream([
                {
                  type: 'message_start',
                  message: {
                    id: 'msg_closed',
                    type: 'message',
                    role: 'assistant',
                    model: 'claude-sonnet-4-6',
                    content: [],
                    stop_reason: null,
                    stop_sequence: null,
                    usage: { input_tokens: 10, output_tokens: 0 },
                  },
                },
                {
                  type: 'content_block_start',
                  index: 0,
                  content_block: { type: 'text', text: '' },
                },
                {
                  type: 'content_block_delta',
                  index: 0,
                  delta: { type: 'text_delta', text: 'first' },
                },
                { type: 'content_block_stop', index: 0 },
                // Illegal duplicate delta on already-closed block 0
                {
                  type: 'content_block_delta',
                  index: 0,
                  delta: { type: 'text_delta', text: 'after close' },
                },
              ]),
              request_id: 'req_closed',
              response: new Response(null, { status: 200 }),
            }),
          }),
        },
      },
    } as unknown as Anthropic)

    try {
      const yielded: unknown[] = []
      for await (const ev of queryModelWithStreaming({
        messages: [makeUser('hi')],
        systemPrompt: asSystemPrompt(['You are Claude.']),
        thinkingConfig: { type: 'disabled' },
        tools: [],
        signal: new AbortController().signal,
        options: {
          getToolPermissionContext: async () =>
            ({
              mode: 'default',
              additionalWorkingDirectories: new Map(),
              alwaysAllowRules: {},
              alwaysDenyRules: {},
              alwaysAskRules: {},
              isBypassPermissionsModeAvailable: false,
            }) as never,
          model: 'claude-sonnet-4-6',
          toolChoice: undefined,
          isNonInteractiveSession: true,
          hasAppendSystemPrompt: false,
          temperatureOverride: undefined,
          agents: [],
          querySource: 'sdk',
          mcpTools: [],
        },
      })) {
        yielded.push(ev)
      }
      // Caught by outer error handler -> yields API error message mentioning Content block already closed
      const errMsg = yielded.find(
        e => (e as AssistantMessage).isApiErrorMessage === true,
      ) as AssistantMessage | undefined
      expect(errMsg).toBeDefined()
      expect(
        (errMsg?.message.content?.[0] as { text?: string })?.text,
      ).toContain('Content block already closed')
      expect(new StreamMalformedEventError('closed').blockState).toBe('closed')
    } finally {
      clientSpy.mockRestore()
    }
  })

  test('pause_turn with stop_details.resumption.token transparently resumes stream and attaches pausedResponses', async () => {
    process.env.CLAUDE_CODE_DISABLE_NONSTREAMING_FALLBACK = '1'
    const pauseDelta = {
      type: 'message_delta' as const,
      delta: {
        stop_reason: 'pause_turn',
        stop_sequence: null,
        stop_details: { resumption: { token: 'tok_resume_123' }, note: 'keep' },
      },
      usage: { output_tokens: 15 },
    }
    const parsed = parseResumptionPauseDelta(pauseDelta as never)
    expect(parsed?.token).toBe('tok_resume_123')
    expect(parsed?.limit).toBe('pause_turn')
    expect(
      (
        parsed?.frame.delta as unknown as {
          stop_details?: Record<string, unknown>
        }
      ).stop_details,
    ).toEqual({ note: 'keep' })

    const built = buildResumptionRequestParams(
      {
        complete: [
          {
            index: 0,
            block: { type: 'text', text: 'part 1' },
            inputJson: '',
            incomplete: false,
          },
        ],
        open: undefined,
        offset: 1,
        nextIndex: 1,
        messages: [{ role: 'user', content: 'go' }],
      },
      'tok_resume_123',
    )
    expect(built.resumption).toEqual({
      type: 'enabled',
      token: 'tok_resume_123',
    })
    expect((built.messages as unknown[]).length).toBe(2)

    // Test wrapStreamWithResumption end-to-end through queryModelWithStreaming
    let createCalls = 0
    let resumeBody: Record<string, unknown> | undefined
    const clientSpy = spyOn(
      clientModule,
      'getAnthropicClient',
    ).mockResolvedValue({
      beta: {
        messages: {
          create: (params: Record<string, unknown>) => {
            createCalls++
            if (createCalls === 2) resumeBody = params
            return {
              withResponse: async () => ({
                data:
                  createCalls === 1
                    ? makeMockStream([
                        {
                          type: 'message_start',
                          message: {
                            id: 'msg_pause_1',
                            type: 'message',
                            role: 'assistant',
                            model: 'claude-opus-4-6',
                            content: [],
                            stop_reason: null,
                            stop_sequence: null,
                            usage: { input_tokens: 40, output_tokens: 0 },
                          },
                        },
                        {
                          type: 'content_block_start',
                          index: 0,
                          content_block: { type: 'text', text: '' },
                        },
                        {
                          type: 'content_block_delta',
                          index: 0,
                          delta: { type: 'text_delta', text: 'Part 1. ' },
                        },
                        { type: 'content_block_stop', index: 0 },
                        pauseDelta,
                        { type: 'message_stop' },
                      ])
                    : makeMockStream([
                        {
                          type: 'message_start',
                          message: {
                            id: 'msg_pause_2',
                            type: 'message',
                            role: 'assistant',
                            model: 'claude-opus-4-6',
                            content: [],
                            stop_reason: null,
                            stop_sequence: null,
                            usage: { input_tokens: 55, output_tokens: 0 },
                          },
                        },
                        {
                          type: 'content_block_start',
                          index: 0,
                          content_block: { type: 'text', text: '' },
                        },
                        {
                          type: 'content_block_delta',
                          index: 0,
                          delta: { type: 'text_delta', text: 'Part 2.' },
                        },
                        { type: 'content_block_stop', index: 0 },
                        {
                          type: 'message_delta',
                          delta: {
                            stop_reason: 'end_turn',
                            stop_sequence: null,
                          },
                          usage: { output_tokens: 10 },
                        },
                        { type: 'message_stop' },
                      ]),
                request_id: `req_p_${createCalls}`,
                response: new Response(null, { status: 200 }),
              }),
            }
          },
        },
      },
    } as unknown as Anthropic)

    try {
      const assistantMsgs: AssistantMessage[] = []
      for await (const ev of queryModelWithStreaming({
        messages: [makeUser('long task')],
        systemPrompt: asSystemPrompt(['You are Claude.']),
        thinkingConfig: { type: 'disabled' },
        tools: [],
        signal: new AbortController().signal,
        options: {
          getToolPermissionContext: async () =>
            ({
              mode: 'default',
              additionalWorkingDirectories: new Map(),
              alwaysAllowRules: {},
              alwaysDenyRules: {},
              alwaysAskRules: {},
              isBypassPermissionsModeAvailable: false,
            }) as never,
          model: 'claude-opus-4-6',
          toolChoice: undefined,
          isNonInteractiveSession: true,
          hasAppendSystemPrompt: false,
          temperatureOverride: undefined,
          agents: [],
          querySource: 'sdk',
          mcpTools: [],
          enableStreamResumption: true,
        },
      })) {
        if ((ev as AssistantMessage).type === 'assistant') {
          assistantMsgs.push(ev as AssistantMessage)
        }
      }

      expect(createCalls).toBe(2)
      expect(resumeBody?.resumption).toEqual({
        type: 'enabled',
        token: 'tok_resume_123',
      })
      expect(assistantMsgs.length).toBe(2)
      expect(
        (assistantMsgs[0]!.message.content?.[0] as { text: string })?.text,
      ).toBe('Part 1. ')
      expect(
        (assistantMsgs[1]!.message.content?.[0] as { text: string })?.text,
      ).toBe('Part 2.')
      const paused = (
        assistantMsgs[1]!.message as unknown as { pausedResponses?: unknown[] }
      ).pausedResponses
      expect(Array.isArray(paused)).toBe(true)
      expect(paused?.length).toBe(1)
      expect(paused?.[0]).toMatchObject({
        limit: 'pause_turn',
        finishedBlocks: 1,
        requestId: 'req_p_1',
        resumedRequestId: 'req_p_2',
      })
    } finally {
      clientSpy.mockRestore()
    }
  })

  test('wrapStreamWithResumption falls back cleanly to pause_turn stop_reason when resumption is disallowed', async () => {
    const events = [
      {
        type: 'message_start',
        message: { id: 'm1', usage: { input_tokens: 1, output_tokens: 0 } },
      },
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' },
      },
      { type: 'content_block_stop', index: 0 },
      {
        type: 'message_delta',
        delta: {
          stop_reason: 'pause_turn',
          stop_details: { resumption: { token: 'tok' } },
        },
        usage: { output_tokens: 5 },
      },
      { type: 'message_stop' },
    ]
    const out: unknown[] = []
    for await (const ev of wrapStreamWithResumption(
      makeMockStream(events) as never,
      {
        messages: [{ role: 'user', content: 'hi' }],
        isCancelled: () => false,
        canResume: () => false,
        send: async () => undefined,
      },
    )) {
      out.push(ev)
    }
    const lastDelta = out.find(
      e => (e as { type?: string }).type === 'message_delta',
    ) as { delta?: { stop_reason?: string } } | undefined
    expect(lastDelta?.delta?.stop_reason).toBe('pause_turn')
  })

  test('claude.ts does not hardcode switchModelsOnFlag: false, uses getSwitchModelsOnFlag(), and yields fallback_request cleanly when caller-handled', async () => {
    const claudeSrc = readFileSync(
      join(import.meta.dir, '../claude.ts'),
      'utf8',
    )
    expect(claudeSrc).not.toContain('switchModelsOnFlag: false')
    expect(claudeSrc).toContain('switchModelsOnFlag: getSwitchModelsOnFlag()')

    process.env.CLAUDE_CODE_DISABLE_NONSTREAMING_FALLBACK = '1'
    const clientSpy = spyOn(
      clientModule,
      'getAnthropicClient',
    ).mockResolvedValue({
      beta: {
        messages: {
          create: () => ({
            withResponse: async () => ({
              data: makeMockStream([
                {
                  type: 'message_start',
                  message: {
                    id: 'msg_refusal',
                    type: 'message',
                    role: 'assistant',
                    model: 'claude-opus-4-7',
                    content: [],
                    stop_reason: null,
                    stop_sequence: null,
                    usage: { input_tokens: 10, output_tokens: 0 },
                  },
                },
                {
                  type: 'message_delta',
                  delta: {
                    stop_reason: 'refusal',
                    stop_sequence: null,
                    stop_details: { category: null, explanation: null },
                  },
                  usage: { output_tokens: 0 },
                },
                { type: 'message_stop' },
              ]),
              request_id: 'req_refusal',
              response: new Response(null, { status: 200 }),
            }),
          }),
        },
      },
    } as unknown as Anthropic)

    try {
      const yielded: unknown[] = []
      for await (const ev of queryModelWithStreaming({
        messages: [makeUser('refuse test')],
        systemPrompt: asSystemPrompt(['You are Claude.']),
        thinkingConfig: { type: 'disabled' },
        tools: [],
        signal: new AbortController().signal,
        options: {
          getToolPermissionContext: async () =>
            ({
              mode: 'default',
              additionalWorkingDirectories: new Map(),
              alwaysAllowRules: {},
              alwaysDenyRules: {},
              alwaysAskRules: {},
              isBypassPermissionsModeAvailable: false,
            }) as never,
          model: 'claude-opus-4-7',
          refusalFallbackModel: 'claude-sonnet-4-6',
          refusalFallbackHandledByCaller: true,
          toolChoice: undefined,
          isNonInteractiveSession: true,
          hasAppendSystemPrompt: false,
          temperatureOverride: undefined,
          agents: [],
          querySource: 'sdk',
          mcpTools: [],
        },
      })) {
        yielded.push(ev)
      }
      const fbReq = yielded.find(
        e => (e as { type?: string }).type === 'fallback_request',
      ) as
        | { originalModel?: string; fallbackModel?: string; trigger?: string }
        | undefined
      expect(fbReq).toBeDefined()
      expect(fbReq?.trigger).toBe('refusal')
      expect(fbReq?.originalModel).toBe('claude-opus-4-7')
      expect(fbReq?.fallbackModel).toBe('claude-sonnet-4-6')
    } finally {
      clientSpy.mockRestore()
    }
  })
})

describe('Group 7 [P1-13 + P2]: Prompt caching breakpoints & API params', () => {
  test('Wso: userMessageToMessageParam strips empty/whitespace text blocks before stamping cache_control', () => {
    const msg = makeUser([
      { type: 'tool_result', tool_use_id: 't1', content: 'result body' },
      { type: 'text', text: '   \n\t  ' },
      { type: 'text', text: '' },
    ])
    const param = userMessageToMessageParam(msg, true, true, 'sdk')
    const blocks = param.content as Array<{
      type: string
      cache_control?: unknown
    }>
    expect(blocks.length).toBe(1)
    expect(blocks[0]?.type).toBe('tool_result')
    expect(blocks[0]?.cache_control).toBeDefined()

    // All-empty array falls back to NO_CONTENT_MESSAGE placeholder
    const allEmpty = stripEmptyUserTextBlocks([
      { type: 'text', text: '   ' },
      { type: 'text', text: '' },
    ])
    expect(allEmpty).toEqual([{ type: 'text', text: NO_CONTENT_MESSAGE }])
  })

  test('kai + _Os: splitSysPromptPrefix gives dynamic block cacheScope=org with <=1 static chunk and null with >1; scopeRefused omits scope', () => {
    const singleStaticPrompt = asSystemPrompt([
      'x-anthropic-billing-header: cc_version=2.1.328',
      'Static instruction block',
      SYSTEM_PROMPT_DYNAMIC_BOUNDARY,
      'Dynamic per-session context',
    ])
    const singleSplit = splitSysPromptPrefix(singleStaticPrompt)
    const dynSingle = singleSplit.find(b =>
      b.text.includes('Dynamic per-session context'),
    )
    expect(dynSingle?.cacheScope).toBe('org')

    // With __SYSTEM_PROMPT_STATIC_BREAKPOINT__, static splits into 2 global chunks -> dynamic cacheScope = null
    const multiStaticPrompt = asSystemPrompt([
      `Static chunk A\n${SYSTEM_PROMPT_STATIC_BREAKPOINT}\nStatic chunk B`,
      SYSTEM_PROMPT_DYNAMIC_BOUNDARY,
      'Dynamic suffix',
    ])
    const multiSplit = splitSysPromptPrefix(multiStaticPrompt)
    const globalBlocks = multiSplit.filter(b => b.cacheScope === 'global')
    const dynMulti = multiSplit.find(b => b.text.includes('Dynamic suffix'))
    if (globalBlocks.length > 1) {
      expect(dynMulti?.cacheScope).toBeNull()
    } else {
      // When global cache scope feature is off in env, non-global fallback strips marker
      expect(
        multiSplit.every(
          b => !b.text.includes(SYSTEM_PROMPT_STATIC_BREAKPOINT),
        ),
      ).toBe(true)
    }

    // scopeRefused omits `scope` on cache_control while retaining `{ type: 'ephemeral' }`
    const blocksNormal = buildSystemPromptBlocks(singleStaticPrompt, true, {
      querySource: 'sdk',
      scopeRefused: false,
    })
    const blocksRefused = buildSystemPromptBlocks(singleStaticPrompt, true, {
      querySource: 'sdk',
      scopeRefused: true,
    })
    expect(blocksNormal.length).toBe(blocksRefused.length)
    for (const block of blocksRefused) {
      const cc = (
        block as { cache_control?: { scope?: string; type?: string } }
      ).cache_control
      if (cc) {
        expect(cc.type).toBe('ephemeral')
        expect(cc.scope).toBeUndefined()
      }
    }
  })

  test('claude.ts enforces 1024 floor on thinking.budget_tokens and gates temperature on acceptsTemperature', async () => {
    process.env.CLAUDE_CODE_DISABLE_NONSTREAMING_FALLBACK = '1'
    const capturedBodies: Array<Record<string, unknown>> = []
    const clientSpy = spyOn(
      clientModule,
      'getAnthropicClient',
    ).mockResolvedValue({
      beta: {
        messages: {
          create: (params: Record<string, unknown>) => {
            capturedBodies.push(params)
            return {
              withResponse: async () => ({
                data: makeMockStream([
                  {
                    type: 'message_start',
                    message: {
                      id: 'msg_param_1',
                      type: 'message',
                      role: 'assistant',
                      model: String(params.model),
                      content: [],
                      stop_reason: null,
                      stop_sequence: null,
                      usage: { input_tokens: 10, output_tokens: 0 },
                    },
                  },
                  {
                    type: 'content_block_start',
                    index: 0,
                    content_block: { type: 'text', text: '' },
                  },
                  {
                    type: 'content_block_delta',
                    index: 0,
                    delta: { type: 'text_delta', text: 'ok' },
                  },
                  { type: 'content_block_stop', index: 0 },
                  {
                    type: 'message_delta',
                    delta: { stop_reason: 'end_turn', stop_sequence: null },
                    usage: { output_tokens: 2 },
                  },
                  { type: 'message_stop' },
                ]),
                request_id: 'req_p',
                response: new Response(null, { status: 200 }),
              }),
            }
          },
        },
      },
    } as unknown as Anthropic)

    try {
      // 1) Non-adaptive model with budgetTokens: 200 -> clamped UP to 1024 floor
      for await (const _ of queryModelWithStreaming({
        messages: [makeUser('think')],
        systemPrompt: asSystemPrompt(['You are Claude.']),
        thinkingConfig: { type: 'enabled', budgetTokens: 200 },
        tools: [],
        signal: new AbortController().signal,
        options: {
          getToolPermissionContext: async () =>
            ({
              mode: 'default',
              additionalWorkingDirectories: new Map(),
              alwaysAllowRules: {},
              alwaysDenyRules: {},
              alwaysAskRules: {},
              isBypassPermissionsModeAvailable: false,
            }) as never,
          model: 'claude-sonnet-4-5',
          toolChoice: undefined,
          isNonInteractiveSession: true,
          hasAppendSystemPrompt: false,
          temperatureOverride: undefined,
          agents: [],
          querySource: 'sdk',
          mcpTools: [],
        },
      })) {
        // drain
      }
      expect(
        (capturedBodies[0]?.thinking as { budget_tokens?: number })
          ?.budget_tokens,
      ).toBe(1024)

      // 2) claude-opus-4-7 (acceptsTemperature: false) with thinking disabled -> NO temperature sent!
      for await (const _ of queryModelWithStreaming({
        messages: [makeUser('no temp')],
        systemPrompt: asSystemPrompt(['You are Claude.']),
        thinkingConfig: { type: 'disabled' },
        tools: [],
        signal: new AbortController().signal,
        options: {
          getToolPermissionContext: async () =>
            ({
              mode: 'default',
              additionalWorkingDirectories: new Map(),
              alwaysAllowRules: {},
              alwaysDenyRules: {},
              alwaysAskRules: {},
              isBypassPermissionsModeAvailable: false,
            }) as never,
          model: 'claude-opus-4-7',
          toolChoice: undefined,
          isNonInteractiveSession: true,
          hasAppendSystemPrompt: false,
          temperatureOverride: 0.7,
          agents: [],
          querySource: 'sdk',
          mcpTools: [],
        },
      })) {
        // drain
      }
      expect(capturedBodies[1]?.temperature).toBeUndefined()

      // 3) claude-sonnet-4-6 (acceptsTemperature: true) with thinking disabled -> temperature sent!
      for await (const _ of queryModelWithStreaming({
        messages: [makeUser('with temp')],
        systemPrompt: asSystemPrompt(['You are Claude.']),
        thinkingConfig: { type: 'disabled' },
        tools: [],
        signal: new AbortController().signal,
        options: {
          getToolPermissionContext: async () =>
            ({
              mode: 'default',
              additionalWorkingDirectories: new Map(),
              alwaysAllowRules: {},
              alwaysDenyRules: {},
              alwaysAskRules: {},
              isBypassPermissionsModeAvailable: false,
            }) as never,
          model: 'claude-sonnet-4-6',
          toolChoice: undefined,
          isNonInteractiveSession: true,
          hasAppendSystemPrompt: false,
          temperatureOverride: 0.7,
          agents: [],
          querySource: 'sdk',
          mcpTools: [],
        },
      })) {
        // drain
      }
      expect(capturedBodies[2]?.temperature).toBe(0.7)
    } finally {
      clientSpy.mockRestore()
    }
  })
})
