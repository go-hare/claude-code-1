/**
 * Re-Audit Area 1 Fix Verification Suite (6 P1 + 3 P2):
 * - P1-A1: claude.ts wrapStreamWithResumption keeps outer abort listener alive for resumed SSE stream & detaches cleanly
 * - P1-A2: streamAndFallback.ts resets streamingFallbackOccured after first fallback message so cutShortError doesn't tombstone it
 * - P1-A3: messageQueueManager.ts deduplicates every writer against its own localAttachedReadyPromise (no custom+host deadlock)
 * - P1-A4: bridgeMessaging.ts side_question substitutes SIDE_QUESTION_FALLBACK only when res.response === null
 * - P1-A5: compact.ts compactConversation annotates boundaryMarker with preservedSegment (and preservedMessages when non-contiguous)
 * - P1-A6: gatewayServer.ts destroys socket instead of emitting clean chunked EOF on mid-stream upstream error/timeout
 * - P2-1: SessionsV2Client.ts wraps trusted-device token methods in runInBoundSession
 * - P2-2: controlSchemas.ts SDKControlTurnHandoffRequestSchema accepts & preserves stopped/continues/relay_marker/file_names/memory_context
 * - P2-3: withRetry.ts shouldRetry honors x-should-retry: false on first-party 503 and streaming overloaded_error (is529Error)
 */
import type Anthropic from '@anthropic-ai/sdk'
import { APIError } from '@anthropic-ai/sdk'
import type { BetaRawMessageStreamEvent } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { randomUUID, type UUID } from 'node:crypto'
import { createConnection } from 'node:net'
import { handleServerControlRequest } from 'src/bridge/bridgeMessaging.js'
import * as trustedDeviceModule from 'src/bridge/trustedDevice.js'
import {
  parseGatewayConfig,
  startGatewayServer,
} from 'src/cli/handlers/gatewayServer.js'
import {
  SDKControlRequestInnerSchema,
  SDKControlRequestSchema,
  SDKControlTurnHandoffRequestSchema,
  SDKExtendedControlRequestSchema,
} from 'src/entrypoints/sdk/controlSchemas.js'
import { query } from 'src/query.js'
import { SessionsV2Client } from 'src/remote/SessionsV2Client.js'
import { queryModelWithStreaming } from 'src/services/api/claude.js'
import * as clientModule from 'src/services/api/client.js'
import { shouldRetry } from 'src/services/api/withRetry.js'
import {
  annotateBoundaryWithPreservedSegment,
  compactConversation,
  extractUnansweredTrailingMessages,
} from 'src/services/compact/compact.js'
import * as vcrModule from 'src/services/vcr.js'
import { type AppState, getDefaultAppState } from 'src/state/AppStateStore.js'
import type { Tool, ToolUseContext } from 'src/Tool.js'
import type { TranscriptMessage } from 'src/types/logs.js'
import type { AssistantMessage, Message } from 'src/types/message.js'
import {
  createBodyChunkTimes,
  rewrapResponseWithBody,
} from 'src/utils/bodyIdleWatchdog.js'
import { createFileStateCacheWithSizeLimit } from 'src/utils/fileStateCache.js'
import {
  createQueueRecordWriter,
  getHostQueueState,
  setQueueRecordHookRunner,
  setQueueSessionReadyPromise,
} from 'src/utils/messageQueueManager.js'
import {
  createAssistantAPIErrorMessage,
  createAssistantMessage,
  createCompactBoundaryMessage,
  createUserMessage,
} from 'src/utils/messages.js'
import { createSessionHost } from 'src/utils/sessionHost.js'
import {
  createRootSession,
  getActiveSessionFromAls,
  runWithSession,
} from 'src/utils/sessionRoot.js'
import * as sessionStorageModule from 'src/utils/sessionStorage.js'
import { applyPreservedSegmentRelinks } from 'src/utils/sessionStorage/transcriptChain.js'
import { buildTranscriptGcKeepLineSet } from 'src/utils/sessionStorage/transcriptGc.js'
import { asSystemPrompt } from 'src/utils/systemPromptType.js'

const tick = (ms = 20): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms))

function makeMockSession(id: string) {
  return createRootSession({
    host: createSessionHost(),
    id,
    project: {
      originalCwd: '/tmp/reaudit-area1',
      projectRoot: '/tmp/reaudit-area1',
      cwd: '/tmp/reaudit-area1',
    },
  })
}

function makeMockToolUseContext(
  overrides: Partial<ToolUseContext> = {},
): ToolUseContext {
  let appState = getDefaultAppState()
  return {
    abortController: new AbortController(),
    readFileState: createFileStateCacheWithSizeLimit(100),
    getAppState: () => appState,
    setAppState: (updater: (prev: AppState) => AppState) => {
      appState = updater(appState)
    },
    setToolPermissionContext: () => {},
    setInProgressToolUseIDs: () => {},
    setResponseLength: () => {},
    updateFileHistoryState: () => {},
    updateAttributionState: () => {},
    ...overrides,
    options: {
      tools: [],
      commands: [],
      mcpClients: [],
      mcpResources: {},
      mainLoopModel: 'claude-sonnet-4-6',
      thinkingConfig: { type: 'disabled' },
      isNonInteractiveSession: true,
      debug: false,
      verbose: false,
      agentDefinitions: {
        activeAgents: [],
        allAgents: [],
        allowedAgentTypes: [],
      },
      ...overrides.options,
    },
  } as unknown as ToolUseContext
}

function makeSignalTrackingAbortController(): {
  controller: AbortController
  getActiveAbortListenerCount: () => number
  getTotalAdded: () => number
} {
  const controller = new AbortController()
  const signal = controller.signal
  const active = new Set<EventListenerOrEventListenerObject>()
  let totalAdded = 0
  const origAdd = signal.addEventListener.bind(signal)
  const origRemove = signal.removeEventListener.bind(signal)
  signal.addEventListener = ((
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ) => {
    if (type === 'abort' && listener) {
      totalAdded += 1
      active.add(listener)
      if (typeof options === 'object' && options?.once) {
        origAdd(
          type,
          () => {
            active.delete(listener)
          },
          { once: true },
        )
      }
    }
    return origAdd(type, listener as EventListener, options)
  }) as typeof signal.addEventListener
  signal.removeEventListener = ((
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ) => {
    if (type === 'abort' && listener) {
      active.delete(listener)
    }
    return origRemove(type, listener as EventListener, options)
  }) as typeof signal.removeEventListener
  return {
    controller,
    getActiveAbortListenerCount: () => active.size,
    getTotalAdded: () => totalAdded,
  }
}

function makeStreamBoundToSignal(
  events: BetaRawMessageStreamEvent[],
  signal: AbortSignal | undefined,
  opts?: { hangAfterIndex?: number },
): {
  stream: AsyncIterable<BetaRawMessageStreamEvent> & {
    controller: AbortController
  }
  controller: AbortController
} {
  const controller = new AbortController()
  const onSignalAbort = () => controller.abort(signal?.reason)
  if (signal?.aborted) {
    controller.abort(signal.reason)
  } else {
    signal?.addEventListener('abort', onSignalAbort, { once: true })
  }
  const stream = {
    controller,
    async *[Symbol.asyncIterator]() {
      try {
        for (let i = 0; i < events.length; i++) {
          if (controller.signal.aborted || signal?.aborted) {
            throw new Error('resumed_stream_aborted')
          }
          yield events[i]!
          if (opts?.hangAfterIndex === i) {
            await new Promise<void>((_resolve, reject) => {
              if (controller.signal.aborted || signal?.aborted) {
                reject(new Error('resumed_stream_aborted'))
                return
              }
              const onAbort = () => reject(new Error('resumed_stream_aborted'))
              controller.signal.addEventListener('abort', onAbort, {
                once: true,
              })
              signal?.addEventListener('abort', onAbort, { once: true })
            })
          }
        }
      } finally {
        signal?.removeEventListener('abort', onSignalAbort)
      }
    },
  }
  return { stream, controller }
}

function makeMockResponse(): Response {
  const body = new ReadableStream<Uint8Array>({
    start() {},
  })
  return rewrapResponseWithBody(
    new Response(null, { status: 200 }),
    body,
    createBodyChunkTimes(),
  )
}

const gatewayCloseHandles: Array<() => Promise<void>> = []

afterEach(async () => {
  setQueueRecordHookRunner(null)
  setQueueSessionReadyPromise(null)
  while (gatewayCloseHandles.length > 0) {
    const close = gatewayCloseHandles.pop()!
    await close().catch(() => {})
  }
})

// ============================================================================
// P1-A1: claude.ts wrapStreamWithResumption outer abort stays wired post-headers
// ============================================================================
describe('P1-A1: claude.ts wrapStreamWithResumption resumed stream remains cancellable', () => {
  const makePauseStreamEvents = (
    id: string,
    text: string,
    token: string,
  ): BetaRawMessageStreamEvent[] => [
    {
      type: 'message_start',
      message: {
        id,
        type: 'message',
        role: 'assistant',
        model: 'claude-opus-4-6',
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 20, output_tokens: 0 },
      },
    } as unknown as BetaRawMessageStreamEvent,
    {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '' },
    } as unknown as BetaRawMessageStreamEvent,
    {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text },
    } as unknown as BetaRawMessageStreamEvent,
    {
      type: 'content_block_stop',
      index: 0,
    } as unknown as BetaRawMessageStreamEvent,
    {
      type: 'message_delta',
      delta: {
        stop_reason: 'pause_turn',
        stop_sequence: null,
        stop_details: { resumption: { token } },
      },
      usage: { output_tokens: 5 },
    } as unknown as BetaRawMessageStreamEvent,
    { type: 'message_stop' } as unknown as BetaRawMessageStreamEvent,
  ]

  const baseQueryOptions = () => ({
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
    querySource: 'sdk' as const,
    mcpTools: [],
    enableStreamResumption: true,
  })

  test('aborting outer signal AFTER withResponse() resolves cancels the active resumed SSE stream', async () => {
    const vcrSpy = spyOn(vcrModule, 'withStreamingVCR').mockImplementation(
      async function* (_msgs, fn) {
        yield* fn()
      },
    )
    let call = 0
    let resumedSignal: AbortSignal | undefined
    const clientSpy = spyOn(
      clientModule,
      'getAnthropicClient',
    ).mockResolvedValue({
      beta: {
        messages: {
          create: (_params: unknown, reqOpts?: { signal?: AbortSignal }) => {
            call += 1
            if (call === 1) {
              const s1 = makeStreamBoundToSignal(
                makePauseStreamEvents('msg_p1', 'Part 1 ', 'tok_a1_1'),
                reqOpts?.signal,
              )
              return {
                withResponse: async () => ({
                  data: s1.stream,
                  request_id: 'req_1',
                  response: makeMockResponse(),
                }),
              }
            }
            resumedSignal = reqOpts?.signal
            const s2 = makeStreamBoundToSignal(
              [
                {
                  type: 'message_start',
                  message: {
                    id: 'msg_p2',
                    type: 'message',
                    role: 'assistant',
                    model: 'claude-opus-4-6',
                    content: [],
                    stop_reason: null,
                    stop_sequence: null,
                    usage: { input_tokens: 25, output_tokens: 0 },
                  },
                } as unknown as BetaRawMessageStreamEvent,
                {
                  type: 'content_block_start',
                  index: 0,
                  content_block: { type: 'text', text: '' },
                } as unknown as BetaRawMessageStreamEvent,
                {
                  type: 'content_block_delta',
                  index: 0,
                  delta: { type: 'text_delta', text: 'Resumed SSE chunk' },
                } as unknown as BetaRawMessageStreamEvent,
              ],
              reqOpts?.signal,
              { hangAfterIndex: 2 },
            )
            return {
              withResponse: async () => ({
                data: s2.stream,
                request_id: 'req_2',
                response: makeMockResponse(),
              }),
            }
          },
        },
      },
    } as unknown as Anthropic)

    try {
      const tracked = makeSignalTrackingAbortController()
      let sawResumedChunk = false
      const cancelReason = new Error('user_cancelled_resumed_sse')

      const runPromise = (async () => {
        for await (const ev of queryModelWithStreaming({
          messages: [createUserMessage({ content: 'hello' })],
          systemPrompt: asSystemPrompt(['You are Claude.']),
          thinkingConfig: { type: 'disabled' },
          tools: [],
          signal: tracked.controller.signal,
          options: baseQueryOptions(),
        })) {
          if (
            ev.type === 'stream_event' &&
            (ev.event as { type?: string; delta?: { text?: string } }).type ===
              'content_block_delta' &&
            (ev.event as { delta?: { text?: string } }).delta?.text ===
              'Resumed SSE chunk'
          ) {
            sawResumedChunk = true
            // withResponse() has ALREADY resolved and SSE consumption is in progress.
            // Outer abort MUST still propagate to resumedSignal!
            expect(resumedSignal).toBeDefined()
            expect(resumedSignal!.aborted).toBe(false)
            tracked.controller.abort(cancelReason)
          }
        }
      })()

      // Must settle promptly (not hang because resumed stream was uncancellable)
      await Promise.race([
        runPromise,
        new Promise<never>((_r, reject) =>
          setTimeout(
            () => reject(new Error('Resumed stream hung after outer abort')),
            2000,
          ),
        ),
      ])

      expect(call).toBe(2)
      expect(sawResumedChunk).toBe(true)
      expect(resumedSignal!.aborted).toBe(true)
      expect(resumedSignal!.reason).toBe(cancelReason)
      expect(tracked.getActiveAbortListenerCount()).toBe(0)
    } finally {
      clientSpy.mockRestore()
      vcrSpy.mockRestore()
    }
  })

  test('detaches prior resumption listener across multiple resumptions and on send throw / normal completion', async () => {
    const vcrSpy = spyOn(vcrModule, 'withStreamingVCR').mockImplementation(
      async function* (_msgs, fn) {
        yield* fn()
      },
    )
    let call = 0
    const tracked = makeSignalTrackingAbortController()
    const listenerCountsDuringSend: number[] = []
    const clientSpy = spyOn(
      clientModule,
      'getAnthropicClient',
    ).mockResolvedValue({
      beta: {
        messages: {
          create: (_params: unknown, reqOpts?: { signal?: AbortSignal }) => {
            call += 1
            if (call > 1) {
              // Exactly 1 resumption abort listener should be active on outer signal
              listenerCountsDuringSend.push(
                tracked.getActiveAbortListenerCount(),
              )
            }
            if (call === 1) {
              const s1 = makeStreamBoundToSignal(
                makePauseStreamEvents('msg_m1', 'Hop 1 ', 'tok_hop_1'),
                reqOpts?.signal,
              )
              return {
                withResponse: async () => ({
                  data: s1.stream,
                  request_id: 'req_m1',
                  response: makeMockResponse(),
                }),
              }
            }
            if (call === 2) {
              const s2 = makeStreamBoundToSignal(
                makePauseStreamEvents('msg_m2', 'Hop 2 ', 'tok_hop_2'),
                reqOpts?.signal,
              )
              return {
                withResponse: async () => ({
                  data: s2.stream,
                  request_id: 'req_m2',
                  response: makeMockResponse(),
                }),
              }
            }
            const s3 = makeStreamBoundToSignal(
              [
                {
                  type: 'message_start',
                  message: {
                    id: 'msg_m3',
                    type: 'message',
                    role: 'assistant',
                    model: 'claude-opus-4-6',
                    content: [],
                    stop_reason: null,
                    stop_sequence: null,
                    usage: { input_tokens: 30, output_tokens: 0 },
                  },
                } as unknown as BetaRawMessageStreamEvent,
                {
                  type: 'content_block_start',
                  index: 0,
                  content_block: { type: 'text', text: '' },
                } as unknown as BetaRawMessageStreamEvent,
                {
                  type: 'content_block_delta',
                  index: 0,
                  delta: { type: 'text_delta', text: 'Hop 3 done' },
                } as unknown as BetaRawMessageStreamEvent,
                {
                  type: 'content_block_stop',
                  index: 0,
                } as unknown as BetaRawMessageStreamEvent,
                {
                  type: 'message_delta',
                  delta: { stop_reason: 'end_turn', stop_sequence: null },
                  usage: { output_tokens: 5 },
                } as unknown as BetaRawMessageStreamEvent,
                {
                  type: 'message_stop',
                } as unknown as BetaRawMessageStreamEvent,
              ],
              reqOpts?.signal,
            )
            return {
              withResponse: async () => ({
                data: s3.stream,
                request_id: 'req_m3',
                response: makeMockResponse(),
              }),
            }
          },
        },
      },
    } as unknown as Anthropic)

    try {
      for await (const _ev of queryModelWithStreaming({
        messages: [createUserMessage({ content: 'multi-hop' })],
        systemPrompt: asSystemPrompt(['You are Claude.']),
        thinkingConfig: { type: 'disabled' },
        tools: [],
        signal: tracked.controller.signal,
        options: baseQueryOptions(),
      })) {
        // drain to normal completion
      }
      expect(call).toBe(3)
      // At each resumption hop, the previous listener was detached before adding the next
      expect(listenerCountsDuringSend).toEqual([1, 1])
      // After normal completion, releaseStreamResources detached the last listener
      expect(tracked.getActiveAbortListenerCount()).toBe(0)
    } finally {
      clientSpy.mockRestore()
      vcrSpy.mockRestore()
    }
  })

  test('detaches outer abort listener immediately when resumption send() throws', async () => {
    const vcrSpy = spyOn(vcrModule, 'withStreamingVCR').mockImplementation(
      async function* (_msgs, fn) {
        yield* fn()
      },
    )
    let call = 0
    const tracked = makeSignalTrackingAbortController()
    const clientSpy = spyOn(
      clientModule,
      'getAnthropicClient',
    ).mockResolvedValue({
      beta: {
        messages: {
          create: (_params: unknown, reqOpts?: { signal?: AbortSignal }) => {
            call += 1
            if (call === 1) {
              const s1 = makeStreamBoundToSignal(
                makePauseStreamEvents('msg_err_1', 'Part 1', 'tok_err_1'),
                reqOpts?.signal,
              )
              return {
                withResponse: async () => ({
                  data: s1.stream,
                  request_id: 'req_err_1',
                  response: makeMockResponse(),
                }),
              }
            }
            return {
              withResponse: async () => {
                throw new Error('resumption_handshake_boom')
              },
            }
          },
        },
      },
    } as unknown as Anthropic)

    try {
      for await (const _ev of queryModelWithStreaming({
        messages: [createUserMessage({ content: 'throw on resume' })],
        systemPrompt: asSystemPrompt(['You are Claude.']),
        thinkingConfig: { type: 'disabled' },
        tools: [],
        signal: tracked.controller.signal,
        options: baseQueryOptions(),
      })) {
        // drain
      }
      expect(call).toBe(2)
      expect(tracked.getActiveAbortListenerCount()).toBe(0)
    } finally {
      clientSpy.mockRestore()
      vcrSpy.mockRestore()
    }
  })
})

// ============================================================================
// P1-A2: streamAndFallback.ts resets streamingFallbackOccured on first message
// ============================================================================
describe('P1-A2: streamAndFallback.ts does not tombstone valid fallback response on trailing cutShortError', () => {
  test('non-streaming fallback yielding assistant message + cutShortError tombstones only orphan, preserves fallback & tools', async () => {
    const toolExecutions: string[] = []
    const echoTool: Tool = {
      name: 'EchoTool',
      maxResultSizeChars: 10_000,
      async description() {
        return 'Echo tool'
      },
      async prompt() {
        return 'Echo tool'
      },
      inputSchema: {
        parse: (v: unknown) => v,
        safeParse: (v: unknown) => ({ success: true, data: v }),
      } as unknown as Tool['inputSchema'],
      isEnabled: () => true,
      isConcurrencySafe: () => true,
      isReadOnly: () => true,
      userFacingName: () => 'EchoTool',
      async call(input: { text?: string }) {
        toolExecutions.push(String(input?.text ?? ''))
        return {
          data: { echoed: input?.text ?? '' },
        }
      },
      mapToolResultToToolResultBlockParam(output: unknown, toolUseID: string) {
        return {
          type: 'tool_result',
          tool_use_id: toolUseID,
          content: JSON.stringify(output),
        }
      },
    } as unknown as Tool

    const orphanMsg: AssistantMessage = createAssistantMessage({
      content: [
        { type: 'text', text: 'partial broken stream', citations: null },
      ],
    })
    const fallbackToolUseId = 'toolu_fallback_p1a2'
    const fallbackMsg: AssistantMessage = {
      ...createAssistantMessage({
        content: [
          { type: 'text', text: 'valid fallback answer', citations: null },
          {
            type: 'tool_use',
            id: fallbackToolUseId,
            name: 'EchoTool',
            input: { text: 'kept-after-fallback' },
          },
        ],
      }),
      message: {
        ...createAssistantMessage({
          content: [
            { type: 'text', text: 'valid fallback answer', citations: null },
            {
              type: 'tool_use',
              id: fallbackToolUseId,
              name: 'EchoTool',
              input: { text: 'kept-after-fallback' },
            },
          ],
        }).message,
        stop_reason: 'tool_use',
      },
    }
    const cutShortError = createAssistantAPIErrorMessage({
      content:
        'API Error: Claude response exceeded the output token maximum (max_tokens).',
    })

    let modelCalls = 0
    const yieldedTombstones: AssistantMessage[] = []
    const yieldedAssistantUuids: string[] = []

    const toolUseContext = makeMockToolUseContext({
      options: {
        tools: [echoTool],
        commands: [],
        mcpClients: [],
        mcpResources: {},
        mainLoopModel: 'claude-sonnet-4-6',
        thinkingConfig: { type: 'disabled' },
        isNonInteractiveSession: true,
        debug: false,
        verbose: false,
        agentDefinitions: {
          activeAgents: [],
          allAgents: [],
          allowedAgentTypes: [],
        },
      },
    })

    for await (const ev of query({
      messages: [createUserMessage({ content: 'run fallback test' })],
      systemPrompt: asSystemPrompt(['You are Claude.']),
      userContext: {},
      systemContext: {},
      canUseTool: async (_tool, input) => ({
        behavior: 'allow',
        updatedInput: input,
      }),
      toolUseContext,
      querySource: 'sdk',
      maxTurns: 2,
      deps: {
        callModel: async function* (params) {
          modelCalls += 1
          if (modelCalls === 1) {
            // 1. Streaming yields an orphaned partial message
            yield orphanMsg
            // 2. Streaming fails and falls back to non-streaming
            params.options.onStreamingFallback?.()
            // 3. Non-streaming fallback yields valid response + trailing cutShortError
            yield fallbackMsg
            yield cutShortError
            return
          }
          // Turn 2 after tool result: finish cleanly
          yield createAssistantMessage({
            content: [
              { type: 'text', text: 'final turn complete', citations: null },
            ],
          })
        },
        microcompact: async msgs => ({ messages: msgs }),
        autocompact: async () => ({ wasCompacted: false }),
        uuid: () => randomUUID(),
      },
    })) {
      if (ev.type === 'tombstone') {
        yieldedTombstones.push(ev.message as AssistantMessage)
      }
      if (ev.type === 'assistant') {
        yieldedAssistantUuids.push(String(ev.uuid))
      }
    }

    // ONLY the orphaned pre-fallback message should be tombstoned — NEVER fallbackMsg!
    expect(yieldedTombstones.map(m => m.uuid)).toEqual([orphanMsg.uuid])
    expect(yieldedAssistantUuids).toContain(fallbackMsg.uuid)
    // Tool use from fallbackMsg must NOT be discarded when cutShortError arrives next!
    expect(toolExecutions).toEqual(['kept-after-fallback'])
    expect(modelCalls).toBe(2)
  })
})

// ============================================================================
// P1-A3: messageQueueManager.ts custom writer does not deadlock host default writer
// ============================================================================
describe('P1-A3: messageQueueManager.ts per-writer attachedReadyPromise dedup', () => {
  test('custom writer attaching readyPromise does not deadlock host default queueRecordWriter', async () => {
    const session = makeMockSession('mq-p1-a3-host')
    let resolveReady!: () => void
    const ready = new Promise<void>(r => {
      resolveReady = r
    })
    const customWritten: string[] = []
    const hostWritten: string[] = []
    const recordSpy = spyOn(
      sessionStorageModule,
      'recordQueueOperation',
    ).mockImplementation(async op => {
      hostWritten.push(op.content ?? op.operation)
    })

    try {
      runWithSession(session, () => {
        setQueueRecordHookRunner(content => `hooked:${content}`)
        setQueueSessionReadyPromise(ready)

        // 1. Custom writer enqueues first and mirrors hostState.attachedReadyPromise = ready
        const customWriter = createQueueRecordWriter(op => {
          customWritten.push(op.content ?? op.operation)
        })
        customWriter({
          type: 'queue-operation',
          operation: 'enqueue',
          timestamp: new Date().toISOString(),
          sessionId: session.id,
          content: 'from-custom',
        })
        expect(getHostQueueState(session.host).attachedReadyPromise).toBe(ready)

        // 2. Host default queueRecordWriter enqueues while ready is still pending
        getHostQueueState(session.host).queueRecordWriter({
          type: 'queue-operation',
          operation: 'enqueue',
          timestamp: new Date().toISOString(),
          sessionId: session.id,
          content: 'from-host-default',
        })
      })

      // Neither should have flushed before ready settles
      await tick(15)
      expect(customWritten).toEqual([])
      expect(hostWritten).toEqual([])

      // 3. Resolve ready -> BOTH custom writer AND host default writer must drain!
      resolveReady()
      await tick(25)
      expect(customWritten).toEqual(['hooked:from-custom'])
      expect(hostWritten).toEqual(['hooked:from-host-default'])
      expect(getHostQueueState(session.host).attachedReadyPromise).toBeNull()
    } finally {
      recordSpy.mockRestore()
    }
  })

  test('host default writer attaching first does not deadlock custom writer either', async () => {
    const session = makeMockSession('mq-p1-a3-reverse')
    let resolveReady!: () => void
    const ready = new Promise<void>(r => {
      resolveReady = r
    })
    const customWritten: string[] = []
    const hostWritten: string[] = []
    const recordSpy = spyOn(
      sessionStorageModule,
      'recordQueueOperation',
    ).mockImplementation(async op => {
      hostWritten.push(op.content ?? op.operation)
    })

    try {
      runWithSession(session, () => {
        setQueueRecordHookRunner(content => `rev:${content}`)
        setQueueSessionReadyPromise(ready)

        getHostQueueState(session.host).queueRecordWriter({
          type: 'queue-operation',
          operation: 'enqueue',
          timestamp: new Date().toISOString(),
          sessionId: session.id,
          content: 'host-first',
        })
        const customWriter = createQueueRecordWriter(op => {
          customWritten.push(op.content ?? op.operation)
        })
        customWriter({
          type: 'queue-operation',
          operation: 'enqueue',
          timestamp: new Date().toISOString(),
          sessionId: session.id,
          content: 'custom-second',
        })
      })

      resolveReady()
      await tick(25)
      expect(hostWritten).toEqual(['rev:host-first'])
      expect(customWritten).toEqual(['rev:custom-second'])
    } finally {
      recordSpy.mockRestore()
    }
  })
})

// ============================================================================
// P1-A4: bridgeMessaging.ts side_question null fallback check
// ============================================================================
describe('P1-A4: bridgeMessaging.ts side_question substitutes fallback only when response === null', () => {
  async function invokeSideQuestion(
    result: {
      response: string | null
      synthetic?: boolean
      [key: string]: unknown
    },
    requestId: string,
  ): Promise<Record<string, unknown>> {
    const written: Array<Record<string, unknown>> = []
    handleServerControlRequest(
      {
        type: 'control_request',
        request_id: requestId,
        request: {
          subtype: 'side_question',
          question: 'What does foo do?',
        } as never,
      },
      {
        transport: {
          write: async (frame: unknown) => {
            written.push(frame as Record<string, unknown>)
          },
        } as never,
        sessionId: 'sess-p1-a4',
        onSideQuestion: async () => result,
      },
    )
    await tick(25)
    expect(written).toHaveLength(1)
    return written[0]!
  }

  test('preserves valid non-null answer (synthetic omitted or false) and synthetic diagnostic errors', async () => {
    const validReply = await invokeSideQuestion(
      { response: 'foo computes the checksum.' },
      'sq-valid-1',
    )
    expect(validReply).toMatchObject({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: 'sq-valid-1',
        response: { response: 'foo computes the checksum.' },
      },
    })

    const explicitNonSynthetic = await invokeSideQuestion(
      { response: 'Exact result', synthetic: false },
      'sq-valid-2',
    )
    expect(explicitNonSynthetic).toMatchObject({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: 'sq-valid-2',
        response: { response: 'Exact result', synthetic: false },
      },
    })

    const diagnosticSynthetic = await invokeSideQuestion(
      { response: 'Diagnostic: model rate-limited', synthetic: true },
      'sq-diag-3',
    )
    expect(diagnosticSynthetic).toMatchObject({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: 'sq-diag-3',
        response: {
          response: 'Diagnostic: model rate-limited',
          synthetic: true,
        },
      },
    })
  })

  test('substitutes SIDE_QUESTION_FALLBACK with synthetic: true ONLY when response === null', async () => {
    const nullReply = await invokeSideQuestion(
      { response: null, fallback_notice: 'empty' },
      'sq-null-4',
    )
    expect(nullReply).toMatchObject({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: 'sq-null-4',
        response: {
          response:
            '(No answer available for this side question. Try again, or ask in the main conversation.)',
          synthetic: true,
          fallback_notice: 'empty',
        },
      },
    })
  })
})

// ============================================================================
// P1-A5: compact.ts annotates boundaryMarker for preserved trailing messages
// ============================================================================
describe('P1-A5: compact.ts compactConversation preserves trailing unanswered messages across resume & GC', () => {
  test('annotateBoundaryWithPreservedSegment emits preservedMessages for non-contiguous subsequence and survives relink + GC', () => {
    const u0 = createUserMessage({ content: 'older question' })
    const a0 = createAssistantMessage({
      content: [{ type: 'text', text: 'older answer', citations: null }],
    })
    const u1 = createUserMessage({ content: 'unanswered trailing prompt' })
    const localCmd = createUserMessage({
      content:
        '<command-name>/context</command-name><local-command-stdout>ok</local-command-stdout>',
    })
    const tn = createUserMessage({
      content:
        '<task-notification><task-id>t1</task-id><status>completed</status><summary>done</summary></task-notification>',
      isMeta: true,
    })
    const allMessages: Message[] = [u0, a0, u1, localCmd, tn]

    const preserved = extractUnansweredTrailingMessages(allMessages)
    expect(preserved.map(m => m.uuid)).toEqual([u1.uuid, tn.uuid])

    const boundary = createCompactBoundaryMessage('manual', 5000, tn.uuid)
    const summary = createUserMessage({
      content: 'Compacted summary',
      isCompactSummary: true,
    })

    const annotated = annotateBoundaryWithPreservedSegment(
      boundary,
      summary.uuid,
      preserved,
      allMessages,
    )

    expect(annotated.compactMetadata.preservedSegment).toEqual({
      headUuid: u1.uuid,
      anchorUuid: summary.uuid,
      tailUuid: tn.uuid,
    })
    expect(annotated.compactMetadata.preservedMessages).toEqual({
      anchorUuid: summary.uuid,
      uuids: [u1.uuid, tn.uuid],
    })

    // Verify resume relink (applyPreservedSegmentRelinks) keeps u1 & tn linked to summary and prunes localCmd/u0/a0
    const transcriptMap = new Map<UUID, TranscriptMessage>([
      [u0.uuid, { ...u0, parentUuid: null } as unknown as TranscriptMessage],
      [a0.uuid, { ...a0, parentUuid: u0.uuid } as unknown as TranscriptMessage],
      [u1.uuid, { ...u1, parentUuid: a0.uuid } as unknown as TranscriptMessage],
      [
        localCmd.uuid,
        { ...localCmd, parentUuid: u1.uuid } as unknown as TranscriptMessage,
      ],
      [
        tn.uuid,
        { ...tn, parentUuid: localCmd.uuid } as unknown as TranscriptMessage,
      ],
      [
        annotated.uuid,
        { ...annotated, parentUuid: null } as unknown as TranscriptMessage,
      ],
      [
        summary.uuid,
        {
          ...summary,
          parentUuid: annotated.uuid,
        } as unknown as TranscriptMessage,
      ],
    ])

    applyPreservedSegmentRelinks(transcriptMap)
    expect(transcriptMap.has(u0.uuid)).toBe(false)
    expect(transcriptMap.has(a0.uuid)).toBe(false)
    expect(transcriptMap.has(localCmd.uuid)).toBe(false)
    expect(transcriptMap.get(u1.uuid)?.parentUuid).toBe(summary.uuid)
    expect(transcriptMap.get(tn.uuid)?.parentUuid).toBe(u1.uuid)

    // Verify transcript GC keeps u1, tn, boundary, summary and drops u0, a0, localCmd
    const jsonlLines = [
      JSON.stringify({ type: 'user', uuid: u0.uuid, parentUuid: null }),
      JSON.stringify({ type: 'assistant', uuid: a0.uuid, parentUuid: u0.uuid }),
      JSON.stringify({ type: 'user', uuid: u1.uuid, parentUuid: a0.uuid }),
      JSON.stringify({
        type: 'user',
        uuid: localCmd.uuid,
        parentUuid: u1.uuid,
      }),
      JSON.stringify({
        type: 'user',
        uuid: tn.uuid,
        parentUuid: localCmd.uuid,
      }),
      JSON.stringify({
        type: 'system',
        subtype: 'compact_boundary',
        uuid: annotated.uuid,
        parentUuid: null,
        compactMetadata: annotated.compactMetadata,
      }),
      JSON.stringify({
        type: 'user',
        uuid: summary.uuid,
        parentUuid: annotated.uuid,
      }),
    ]
    const keepSet = buildTranscriptGcKeepLineSet(jsonlLines)
    expect(keepSet.has(0)).toBe(false) // u0 dropped
    expect(keepSet.has(1)).toBe(false) // a0 dropped
    expect(keepSet.has(2)).toBe(true) // u1 preserved!
    expect(keepSet.has(3)).toBe(false) // localCmd dropped!
    expect(keepSet.has(4)).toBe(true) // tn preserved!
    expect(keepSet.has(5)).toBe(true) // boundary preserved
    expect(keepSet.has(6)).toBe(true) // summary preserved
  })

  test('compactConversation end-to-end annotates boundaryMarker with preservedSegment and non-contiguous preservedMessages', async () => {
    const vcrSpy = spyOn(vcrModule, 'withStreamingVCR').mockImplementation(
      async function* (_msgs, fn) {
        yield* fn()
      },
    )
    const clientSpy = spyOn(
      clientModule,
      'getAnthropicClient',
    ).mockResolvedValue({
      beta: {
        messages: {
          create: (_params: unknown, reqOpts?: { signal?: AbortSignal }) => {
            const summaryStream = makeStreamBoundToSignal(
              [
                {
                  type: 'message_start',
                  message: {
                    id: 'msg_compact_sum',
                    type: 'message',
                    role: 'assistant',
                    model: 'claude-sonnet-4-6',
                    content: [],
                    stop_reason: null,
                    stop_sequence: null,
                    usage: { input_tokens: 100, output_tokens: 0 },
                  },
                } as unknown as BetaRawMessageStreamEvent,
                {
                  type: 'content_block_start',
                  index: 0,
                  content_block: { type: 'text', text: '' },
                } as unknown as BetaRawMessageStreamEvent,
                {
                  type: 'content_block_delta',
                  index: 0,
                  delta: {
                    type: 'text_delta',
                    text: '<summary>Compact summary body</summary>',
                  },
                } as unknown as BetaRawMessageStreamEvent,
                {
                  type: 'content_block_stop',
                  index: 0,
                } as unknown as BetaRawMessageStreamEvent,
                {
                  type: 'message_delta',
                  delta: { stop_reason: 'end_turn', stop_sequence: null },
                  usage: { output_tokens: 20 },
                } as unknown as BetaRawMessageStreamEvent,
                {
                  type: 'message_stop',
                } as unknown as BetaRawMessageStreamEvent,
              ],
              reqOpts?.signal,
            )
            return {
              withResponse: async () => ({
                data: summaryStream.stream,
                request_id: 'req_compact_1',
                response: makeMockResponse(),
              }),
            }
          },
        },
      },
    } as unknown as Anthropic)

    try {
      const u0 = createUserMessage({ content: 'initial request' })
      const a0 = createAssistantMessage({
        content: [{ type: 'text', text: 'initial response', citations: null }],
      })
      const u1 = createUserMessage({ content: 'unanswered user ask' })
      const localCmd = createUserMessage({
        content: '<command-name>/context</command-name>',
      })
      const tn = createUserMessage({
        content:
          '<task-notification><task-id>bg-1</task-id><status>completed</status><summary>bg done</summary></task-notification>',
        isMeta: true,
      })
      const messages: Message[] = [u0, a0, u1, localCmd, tn]

      const ctx = makeMockToolUseContext()
      const cacheSafeParams = {
        systemPrompt: asSystemPrompt(['You are Claude.']),
        userContext: {},
        systemContext: {},
        toolUseContext: ctx,
        forkContextMessages: messages,
      }

      const result = await compactConversation(
        messages,
        ctx,
        cacheSafeParams,
        true,
        undefined,
        false,
        undefined,
        false,
        {
          userDisplayMessage: undefined,
          newCustomInstructions: undefined,
        },
      )

      const anchorUuid = result.summaryMessages.at(-1)!.uuid
      expect(result.messagesToKeep?.map(m => m.uuid)).toEqual([
        u1.uuid,
        tn.uuid,
      ])
      const meta = result.boundaryMarker.compactMetadata as {
        preservedSegment?: unknown
        preservedMessages?: unknown
      }
      expect(meta.preservedSegment).toEqual({
        headUuid: u1.uuid,
        anchorUuid,
        tailUuid: tn.uuid,
      })
      expect(meta.preservedMessages).toEqual({
        anchorUuid,
        uuids: [u1.uuid, tn.uuid],
      })
    } finally {
      clientSpy.mockRestore()
      vcrSpy.mockRestore()
    }
  })
})

// ============================================================================
// P1-A6: gatewayServer.ts aborts/destroys truncated mid-stream upstream errors
// ============================================================================
describe('P1-A6: gatewayServer.ts destroys response instead of emitting clean chunked EOF on upstream errors', () => {
  test('Anthropic /v1/messages mid-stream upstream error destroys socket without emitting HTTP/1.1 chunked EOF 0\\r\\n\\r\\n', async () => {
    let shouldFail = true
    const gw = await startGatewayServer(
      parseGatewayConfig(`
listen:
  host: 127.0.0.1
  port: 0
upstreams:
  anthropic:
    url: http://127.0.0.1:9999
`),
      {
        fetchImpl: async () => {
          let pulls = 0
          const stream = new ReadableStream<Uint8Array>({
            async pull(controller) {
              pulls += 1
              if (pulls === 1) {
                controller.enqueue(new TextEncoder().encode('data: chunk1\n\n'))
              } else if (shouldFail) {
                await tick(25)
                controller.error(new Error('upstream connection reset'))
              } else {
                controller.close()
              }
            },
          })
          return new Response(stream, {
            status: 200,
            headers: { 'content-type': 'text/event-stream' },
          })
        },
      },
    )
    gatewayCloseHandles.push(gw.close)

    const readRawHttpResponse = (): Promise<string> =>
      new Promise((resolve, reject) => {
        let raw = ''
        const sock = createConnection(
          { host: '127.0.0.1', port: gw.port },
          () => {
            sock.write(
              `POST /v1/messages HTTP/1.1\r\nHost: 127.0.0.1:${gw.port}\r\nConnection: close\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n{}`,
            )
          },
        )
        sock.setEncoding('utf8')
        sock.on('data', chunk => {
          raw += chunk
        })
        sock.on('error', () => {
          // TCP RST on res.destroy() is expected when aborting a mid-stream failure
          resolve(raw)
        })
        sock.on('close', () => {
          resolve(raw)
        })
        setTimeout(() => {
          sock.destroy()
          reject(new Error('Timed out waiting for raw gateway response'))
        }, 2000)
      })

    // 1. Mid-stream upstream error: headers + first chunk arrive, NO chunked EOF terminator `0\r\n\r\n`
    const truncatedWire = await readRawHttpResponse()
    expect(truncatedWire).toContain('HTTP/1.1 200')
    expect(truncatedWire).toContain('data: chunk1\n\n')
    expect(truncatedWire).not.toContain('\r\n0\r\n\r\n')

    // 2. Normal completed stream: DOES emit clean HTTP/1.1 chunked EOF `0\r\n\r\n`
    shouldFail = false
    const cleanWire = await readRawHttpResponse()
    expect(cleanWire).toContain('HTTP/1.1 200')
    expect(cleanWire).toContain('data: chunk1\n\n')
    expect(cleanWire).toContain('\r\n0\r\n\r\n')
  })

  test('OTLP /v1/traces mid-stream upstream error also aborts without fake EOF while normal streams complete cleanly', async () => {
    let mode: 'fail' | 'ok' = 'fail'
    const gw = await startGatewayServer(
      parseGatewayConfig(`
listen:
  host: 127.0.0.1
  port: 0
telemetry:
  forward_to: http://127.0.0.1:9998
`),
      {
        fetchImpl: async () => {
          if (mode === 'ok') {
            return new Response('otlp-ok', { status: 200 })
          }
          let pulls = 0
          const stream = new ReadableStream<Uint8Array>({
            async pull(controller) {
              pulls += 1
              if (pulls === 1) {
                controller.enqueue(new TextEncoder().encode('otlp-partial'))
              } else {
                await tick(15)
                controller.error(new Error('otlp upstream timeout'))
              }
            },
          })
          return new Response(stream, {
            status: 200,
            headers: { 'content-type': 'text/plain' },
          })
        },
      },
    )
    gatewayCloseHandles.push(gw.close)

    let otlpRejected = false
    try {
      const res = await fetch(`${gw.url}/v1/traces`, {
        method: 'POST',
        body: '{}',
      })
      expect(res.status).toBe(200)
      await res.text()
    } catch {
      otlpRejected = true
    }
    expect(otlpRejected).toBe(true)

    mode = 'ok'
    const okRes = await fetch(`${gw.url}/v1/traces`, {
      method: 'POST',
      body: '{}',
    })
    expect(okRes.status).toBe(200)
    expect(await okRes.text()).toBe('otlp-ok')
  })
})

// ============================================================================
// P2-1: SessionsV2Client.ts trusted-device token methods run in boundSession
// ============================================================================
describe('P2-1: SessionsV2Client trusted-device token methods stay pinned to boundSession', () => {
  test('loadTrustedDeviceToken, recoverTrustedDeviceToken, and rereadTrustedDeviceToken execute in boundSession even when called from another tenant ALS', async () => {
    const sessionA = makeMockSession('v2-tenant-a')
    const sessionB = makeMockSession('v2-tenant-b')

    const seenInLoad: Array<string | undefined> = []
    const seenInRecover: Array<string | undefined> = []
    const seenInGateCheck: Array<string | undefined> = []
    const seenInCacheClear: Array<string | undefined> = []

    const gateSpy = spyOn(
      trustedDeviceModule,
      'isTrustedDeviceGateEnabled',
    ).mockImplementation(() => {
      seenInGateCheck.push(getActiveSessionFromAls()?.id)
      return true
    })
    const clearSpy = spyOn(
      trustedDeviceModule,
      'clearTrustedDeviceTokenCache',
    ).mockImplementation(() => {
      seenInCacheClear.push(getActiveSessionFromAls()?.id)
    })

    try {
      const client = runWithSession(
        sessionA,
        () =>
          new SessionsV2Client(
            'session_01tenantA',
            'org-a',
            () => 'bearer-a',
            { onMessage: () => {} },
            undefined,
            0,
            {
              baseApiUrl: 'https://api.example.test',
              getTrustedDeviceToken: async () => {
                seenInLoad.push(getActiveSessionFromAls()?.id)
                await tick(5)
                seenInLoad.push(getActiveSessionFromAls()?.id)
                return 'td-token-a-1'
              },
              recoverTrustedDeviceToken: async () => {
                seenInRecover.push(getActiveSessionFromAls()?.id)
                await tick(5)
                seenInRecover.push(getActiveSessionFromAls()?.id)
                return 'td-token-a-2'
              },
              fetchFn: (async (_url: unknown, init?: RequestInit) => {
                const headers = init?.headers as Record<string, string>
                expect(headers['X-Trusted-Device-Token']).toBe('td-token-a-1')
                return new Response(JSON.stringify({ sequence_num: 1 }), {
                  status: 200,
                  headers: { 'content-type': 'application/json' },
                })
              }) as unknown as typeof fetch,
            },
          ),
      )

      // Invoke all 3 paths from INSIDE sessionB's ALS — every single one must bind back to sessionA!
      await runWithSession(sessionB, async () => {
        await client.sendEvent({
          type: 'user',
          message: { role: 'user', content: 'hi' },
        } as never)

        const recovered = await client.recoverTrustedDeviceToken(
          { kind: 'token_refused' },
          'td-token-a-1',
        )
        expect(recovered).toBe(true)

        // Non-recoverable refusal triggers rereadTrustedDeviceToken()
        const nonRecoverable = await client.recoverTrustedDeviceToken(
          { kind: 'signature_wanted', subReason: 'served_call_unsigned' },
          'td-token-a-2',
        )
        expect(nonRecoverable).toBe(false)
      })

      expect(seenInLoad).toEqual([sessionA.id, sessionA.id])
      expect(seenInRecover).toEqual([sessionA.id, sessionA.id])
      expect(seenInGateCheck).toEqual([sessionA.id])
      expect(seenInCacheClear).toEqual([sessionA.id])
    } finally {
      gateSpy.mockRestore()
      clearSpy.mockRestore()
    }
  })
})

// ============================================================================
// P2-2: controlSchemas.ts SDKControlTurnHandoffRequestSchema 5 runtime fields
// ============================================================================
describe('P2-2: controlSchemas.ts turn_handoff preserves runtime-consumed fields', () => {
  test('preserves stopped, continues, relay_marker, file_names, memory_context without stripping', () => {
    const payload = {
      subtype: 'turn_handoff' as const,
      tool_use_ids: ['toolu_1'],
      messages: [{ type: 'assistant', uuid: 'u-1' }],
      stopped: true,
      continues: false,
      relay_marker: { uuid: 'rm-uuid', content: 'marker-body' },
      file_names: [{ fileUuid: 'f-uuid', name: 'README.md' }],
      memory_context: { uuid: 'mem-uuid', version: '2', content: 'ctx' },
    }

    const parsedDirect = SDKControlTurnHandoffRequestSchema().parse(payload)
    expect(parsedDirect.stopped).toBe(true)
    expect(parsedDirect.continues).toBe(false)
    expect(parsedDirect.relay_marker).toEqual(payload.relay_marker)
    expect(parsedDirect.file_names).toEqual(payload.file_names)
    expect(parsedDirect.memory_context).toEqual(payload.memory_context)

    const parsedExt = SDKExtendedControlRequestSchema().parse(payload)
    expect(parsedExt).toMatchObject(payload)

    const parsedInner = SDKControlRequestInnerSchema().parse(payload)
    expect(parsedInner).toMatchObject(payload)

    const parsedEnvelope = SDKControlRequestSchema().parse({
      type: 'control_request',
      request_id: 'req-handoff-p2-2',
      request: payload,
    })
    expect(parsedEnvelope.request).toMatchObject(payload)
  })

  test('rejects invalid non-boolean stopped and continues values', () => {
    expect(
      SDKControlTurnHandoffRequestSchema().safeParse({
        subtype: 'turn_handoff',
        stopped: 'true',
      }).success,
    ).toBe(false)
    expect(
      SDKControlTurnHandoffRequestSchema().safeParse({
        subtype: 'turn_handoff',
        continues: 0,
      }).success,
    ).toBe(false)
  })
})

// ============================================================================
// P2-3: withRetry.ts shouldRetry honors x-should-retry: false on 1P 503 & is529Error
// ============================================================================
describe('P2-3: withRetry.ts shouldRetry first-party 503 and is529Error x-should-retry: false', () => {
  function makeApiError(
    status: number | undefined,
    headers: Record<string, string>,
    message = 'API error',
  ): APIError {
    return new APIError(
      status,
      { error: { message } },
      message,
      new Headers(headers),
    )
  }

  test('honors x-should-retry: false on first-party HTTP 503 even when USER_TYPE=ant and retry watchdog is enabled', () => {
    const saved = {
      USER_TYPE: process.env.USER_TYPE,
      CLAUDE_CODE_RETRY_WATCHDOG: process.env.CLAUDE_CODE_RETRY_WATCHDOG,
      ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL,
      CLAUDE_CODE_USE_BEDROCK: process.env.CLAUDE_CODE_USE_BEDROCK,
      CLAUDE_CODE_USE_VERTEX: process.env.CLAUDE_CODE_USE_VERTEX,
      CLAUDE_CODE_USE_FOUNDRY: process.env.CLAUDE_CODE_USE_FOUNDRY,
    }
    try {
      process.env.USER_TYPE = 'ant'
      process.env.CLAUDE_CODE_RETRY_WATCHDOG = '1'
      delete process.env.ANTHROPIC_BASE_URL
      delete process.env.CLAUDE_CODE_USE_BEDROCK
      delete process.env.CLAUDE_CODE_USE_VERTEX
      delete process.env.CLAUDE_CODE_USE_FOUNDRY

      // First-party 503 with x-should-retry: false MUST return false (previously dead code!)
      const fp503 = makeApiError(
        503,
        { 'x-should-retry': 'false' },
        'overloaded',
      )
      expect(shouldRetry(fp503)).toBe(false)

      // First-party 503 with fetch_error overage reason bypasses the early bailout (ant retries 5xx)
      const fp503FetchErr = makeApiError(
        503,
        {
          'x-should-retry': 'false',
          'anthropic-ratelimit-unified-overage-disabled-reason': 'fetch_error',
        },
        'overloaded',
      )
      expect(shouldRetry(fp503FetchErr)).toBe(true)

      // Streaming overloaded_error without status === 529 (matched by is529Error) + x-should-retry: false MUST return false
      const streamingOverloaded = makeApiError(
        200,
        { 'x-should-retry': 'false' },
        '{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}',
      )
      expect(shouldRetry(streamingOverloaded)).toBe(false)

      // Explicit HTTP 529 + x-should-retry: false MUST return false even under watchdog
      const explicit529 = makeApiError(
        529,
        { 'x-should-retry': 'false' },
        'overloaded',
      )
      expect(shouldRetry(explicit529)).toBe(false)

      // Non-first-party base URL 503 + x-should-retry: false with USER_TYPE=ant is NOT matched by 1P 503 rule
      process.env.ANTHROPIC_BASE_URL = 'https://proxy.custom.example'
      const customProxy503 = makeApiError(
        503,
        { 'x-should-retry': 'false' },
        'proxy unavailable',
      )
      expect(shouldRetry(customProxy503)).toBe(true)
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k]
        else process.env[k] = v
      }
    }
  })
})
