/**
 * Stage-1 Engine 1 hardening regression suite (Official 2.1.331):
 * - E1-P0-1: query.ts observerTap pump always unwinds queryLoop() finally blocks
 * - E1-P0-2: streamKeepAlive.ts races pendingNext directly against HEARTBEAT sentinel (0 unhandledRejections)
 * - E1-P0-3: claude.ts wrapStreamWithResumption send reassigns stream, swaps chunkTimesRef, links abort & arms watchdog
 * - E1-P0-4 & E1-P2-14 & E1-P2-15: SessionsV2Client redirect:error, validateBridgeId, 3MiB maxFrameBytes, boundSession ALS;
 *            bridgeApi.ts maxRedirects:0 on all non-watch axios calls & archiveSession 501 v1 fallback
 * - E1-P1-5: print.ts synchronous buildHeadlessInterruptReceipt/requeueTaken before abortController.abort() (no await import race)
 * - E1-P1-6: withRetry.ts RedirectRefused fail-fast + claude.ts runWithModelRedirectTracking & no non-streaming fallback
 * - E1-P1-7 & E1-P1-11 & E1-P2-13: messageQueueManager.ts attachedReadyPromise deadlock fix, per-record ALS session,
 *            !resurrected peer cap + requeueTaken res.admitted check, markCancelPending cap enforcement
 * - E1-P1-8: QueryEngine.ts captures & isolates cwdAls alongside boundSession across concurrent sessions
 * - E1-P1-9: turnHandoffStateMachine.ts canonical evaluateTurnHandoffAdmission + printControlExtras worker_shutting_down gate
 * - E1-P1-10: promptAsFile.ts rewrites oversized queued_command attachments
 * - E1-P2-12: query.ts spreads ...state at recovery transitions + yields tombstones on thinking_only_retry retraction
 */
import type Anthropic from '@anthropic-ai/sdk'
import { APIConnectionError } from '@anthropic-ai/sdk'
import type { BetaRawMessageStreamEvent } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages/messages.mjs'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { randomUUID, type UUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  createBridgeApiClient,
  markEnvironmentOffline,
} from 'src/bridge/bridgeApi.js'
import { buildHeadlessInterruptReceipt } from 'src/cli/print.js'
import {
  dispatchPrintControlExtra,
  evaluateTurnHandoffAdmission,
  getTurnHandoffManager,
  resetTurnHandoffManager,
  resolveTurnHandoffAdmission,
} from 'src/cli/printControlExtras.js'
import { query, THINKING_ONLY_RETRY_PROMPT } from 'src/query.js'
import { QueryEngine } from 'src/QueryEngine.js'
import {
  SESSIONS_V2_MAX_FRAME_BYTES,
  SessionsV2Client,
} from 'src/remote/SessionsV2Client.js'
import { queryModelWithStreaming } from 'src/services/api/claude.js'
import * as clientModule from 'src/services/api/client.js'
import * as vcrModule from 'src/services/vcr.js'
import {
  createRedirectRefusedError,
  getModelRedirectTrackingState,
  noteModelCallRefused,
  runWithModelRedirectTracking,
} from 'src/services/api/modelRedirectGuard.js'
import { shouldRetry, withRetry } from 'src/services/api/withRetry.js'
import {
  extractPromptText,
  getOriginalPromptMessage,
  rewriteOversizedPromptsForApi,
  trySaveOversizedPromptAsFile,
} from 'src/services/compact/promptAsFile.js'
import { getDefaultAppState } from 'src/state/AppStateStore.js'
import type { ToolUseContext } from 'src/Tool.js'
import type {
  AssistantMessage,
  AttachmentMessage,
  Message,
} from 'src/types/message.js'
import {
  type Attachment,
  createAttachmentMessage,
} from 'src/utils/attachments.js'
import {
  type BodyChunkTimes,
  createBodyChunkTimes,
  getResponseChunkTimes,
  rewrapResponseWithBody,
} from 'src/utils/bodyIdleWatchdog.js'
import { getCwd, hasScopedCwd, runWithCwd, setCwd } from 'src/utils/cwd.js'
import { createFileStateCacheWithSizeLimit } from 'src/utils/fileStateCache.js'
import {
  consume,
  createQueueRecordWriter,
  enqueue,
  getCommandQueue,
  getHostQueueState,
  MessageQueueInstance,
  registerFoldInFlight,
  resetCommandQueue,
  setQueueRecordHookRunner,
  setQueueSessionReadyPromise,
  settleTaken,
  wasPutBack,
} from 'src/utils/messageQueueManager.js'
import {
  createAssistantAPIErrorMessage,
  createAssistantMessage,
  createUserMessage,
  normalizeAttachmentForAPI,
} from 'src/utils/messages.js'
import {
  armObserverPairing,
  clearAllObserverPairings,
} from 'src/utils/observerAgents.js'
import { getPeerAdmissionLimits } from 'src/utils/peerAdmission.js'
import { createSessionHost } from 'src/utils/sessionHost.js'
import {
  createRootSession,
  getActiveSessionFromAls,
  runWithSession,
  setSharedBackendMode,
} from 'src/utils/sessionRoot.js'
import {
  type BodyChunkTimesRef,
  isStreamPingEvent,
  withStreamKeepAlivePings,
} from 'src/utils/streamKeepAlive.js'
import { asSystemPrompt } from 'src/utils/systemPromptType.js'
import { setupAxiosMock } from '../../../tests/mocks/axios.js'

;(globalThis as unknown as { MACRO?: { VERSION: string } }).MACRO ??= {
  VERSION: '0.0.0-test',
}

const tick = (ms = 10): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms))

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 2000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await tick(10)
  }
  throw new Error('Timed out waiting for condition')
}

function makeMockSession(id: string, cwd = `/virtual/${id}`) {
  return createRootSession({
    host: createSessionHost(),
    id,
    project: {
      originalCwd: cwd,
      projectRoot: cwd,
      cwd,
    },
  })
}

function makeToolUseContext(
  overrides: Partial<ToolUseContext> = {},
): ToolUseContext {
  let appState = getDefaultAppState()
  const ac = overrides.abortController ?? new AbortController()
  return {
    abortController: ac,
    messages: [],
    readFileState: new Map() as unknown as ToolUseContext['readFileState'],
    getAppState: () => appState,
    setAppState: (updater: (prev: typeof appState) => typeof appState) => {
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
      thinkingConfig: { type: 'enabled', budgetTokens: 10_000 },
      isNonInteractiveSession: false,
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

function makeMockStreamWithController(
  events: BetaRawMessageStreamEvent[],
  opts?: { hangAfterIndex?: number },
): {
  stream: AsyncIterable<BetaRawMessageStreamEvent> & {
    controller: AbortController
  }
  controller: AbortController
} {
  const controller = new AbortController()
  const stream = {
    controller,
    async *[Symbol.asyncIterator]() {
      for (let i = 0; i < events.length; i++) {
        if (controller.signal.aborted) {
          throw new Error('stream_aborted')
        }
        yield events[i]!
        if (opts?.hangAfterIndex === i) {
          await new Promise<void>((_resolve, reject) => {
            if (controller.signal.aborted) {
              reject(new Error('stream_aborted'))
              return
            }
            controller.signal.addEventListener(
              'abort',
              () => reject(new Error('stream_aborted')),
              { once: true },
            )
          })
        }
      }
    },
  }
  return { stream, controller }
}

function makeResponseWithChunkTimes(): {
  response: Response
  chunkTimes: BodyChunkTimes
  cancelled: () => boolean
} {
  let bodyCancelled = false
  const body = new ReadableStream<Uint8Array>({
    cancel() {
      bodyCancelled = true
    },
  })
  const chunkTimes = createBodyChunkTimes()
  const baseResponse = new Response(null, { status: 200 })
  const wrapped = rewrapResponseWithBody(baseResponse, body, chunkTimes)
  expect(getResponseChunkTimes(wrapped)).toBe(chunkTimes)
  return {
    response: wrapped,
    chunkTimes,
    cancelled: () => bodyCancelled,
  }
}

afterEach(() => {
  clearAllObserverPairings()
  resetCommandQueue()
  setQueueRecordHookRunner(null)
  setQueueSessionReadyPromise(null)
  setSharedBackendMode(false)
})

// ============================================================================
// E1-P0-1: query.ts observerTap pump unwinds queryLoop() finally blocks
// ============================================================================
describe('E1-P0-1: query.ts observerTap pump unwinds queryLoop on early break/error', () => {
  test('early consumer break with armed observerTap unwinds callModel/queryLoop finally blocks', async () => {
    clearAllObserverPairings()
    armObserverPairing({
      observerTaskId: 'obs-e1-p0-1',
      observerAgentType: 'watcher',
      observedEnvelopeName: 'worker',
      observedKey: 'agent-e1-p0-1',
    })

    let callModelUnwound = false
    const gen = query({
      messages: [createUserMessage({ content: 'hello' })],
      systemPrompt: asSystemPrompt(['You are Claude.']),
      userContext: {},
      systemContext: {},
      canUseTool: async () => ({ behavior: 'allow', updatedInput: {} }),
      toolUseContext: makeToolUseContext({
        agentId: 'agent-e1-p0-1' as ToolUseContext['agentId'],
      }),
      querySource: 'agent:worker',
      deps: {
        callModel: async function* () {
          try {
            yield createAssistantMessage({ content: 'first chunk' })
            // Keep open until consumer unwinds
            await new Promise<void>(() => {})
          } finally {
            callModelUnwound = true
          }
        },
        autocompact: async () => ({ wasCompacted: false }),
        microcompact: async msgs => ({ messages: msgs }),
        uuid: () => randomUUID(),
      },
    })

    for await (const ev of gen) {
      if (ev.type === 'assistant') {
        break
      }
    }

    expect(callModelUnwound).toBe(true)
  })

  test('error thrown inside queryLoop with armed observerTap still unwinds and propagates error', async () => {
    clearAllObserverPairings()
    armObserverPairing({
      observerTaskId: 'obs-e1-p0-1-err',
      observerAgentType: 'watcher',
      observedEnvelopeName: 'worker',
      observedKey: 'agent-e1-p0-1-err',
    })

    let callModelUnwound = false
    const gen = query({
      messages: [createUserMessage({ content: 'boom' })],
      systemPrompt: asSystemPrompt(['You are Claude.']),
      userContext: {},
      systemContext: {},
      canUseTool: async () => ({ behavior: 'allow', updatedInput: {} }),
      toolUseContext: makeToolUseContext({
        agentId: 'agent-e1-p0-1-err' as ToolUseContext['agentId'],
      }),
      querySource: 'agent:worker',
      deps: {
        callModel: async function* () {
          try {
            yield createAssistantMessage({ content: 'before error' })
            throw new Error('simulated_loop_failure')
          } finally {
            callModelUnwound = true
          }
        },
        autocompact: async () => ({ wasCompacted: false }),
        microcompact: async msgs => ({ messages: msgs }),
        uuid: () => randomUUID(),
      },
    })

    let caught: unknown
    try {
      while (true) {
        const next = await gen.next()
        if (next.done) break
        if (next.value.type === 'assistant') {
          await gen.throw(new Error('simulated_consumer_throw'))
        }
      }
    } catch (err) {
      caught = err
    }

    expect(callModelUnwound).toBe(true)
    expect(caught).toBeInstanceOf(Error)
    expect((caught as Error).message).toBe('simulated_consumer_throw')
  })
})

// ============================================================================
// E1-P0-2: streamKeepAlive.ts direct HEARTBEAT race + zero unhandledRejection
// ============================================================================
describe('E1-P0-2: withStreamKeepAlivePings races HEARTBEAT sentinel with zero unhandledRejections', () => {
  test('stream error after multiple heartbeats emits zero unhandledRejection events', async () => {
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason)
    }
    process.on('unhandledRejection', onUnhandled)
    try {
      const times: BodyChunkTimes = { lastAt: 0 }
      let clock = 10
      let rejectPending!: (err: Error) => void

      const iterable: AsyncIterable<{ type: string }> = {
        [Symbol.asyncIterator]() {
          return {
            next() {
              return new Promise((_resolve, reject) => {
                rejectPending = reject
              })
            },
            return() {
              return Promise.resolve({ value: undefined, done: true })
            },
          }
        },
      }

      const gen = withStreamKeepAlivePings(iterable, times, {
        heartbeatMs: 8,
        maxConsecutivePings: 10,
        now: () => {
          clock += 10
          return clock
        },
      })

      let pings = 0
      let caught: unknown
      const bump = setInterval(() => {
        times.lastAt += 100
      }, 5)
      try {
        for await (const item of gen) {
          if (isStreamPingEvent(item)) {
            pings++
            if (pings === 3) {
              rejectPending(new Error('socket_reset_after_heartbeats'))
            }
          }
        }
      } catch (err) {
        caught = err
      } finally {
        clearInterval(bump)
      }

      await tick(40)
      expect(pings).toBe(3)
      expect(caught).toBeInstanceOf(Error)
      expect((caught as Error).message).toBe('socket_reset_after_heartbeats')
      expect(unhandled).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })

  test('early consumer break while pendingNext rejects later emits zero unhandledRejection events', async () => {
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason)
    }
    process.on('unhandledRejection', onUnhandled)
    try {
      const times: BodyChunkTimes = { lastAt: 1_000 }
      let rejectPending!: (err: Error) => void
      const iterable: AsyncIterable<{ type: string }> = {
        [Symbol.asyncIterator]() {
          return {
            next() {
              return new Promise((_resolve, reject) => {
                rejectPending = reject
              })
            },
            return() {
              return Promise.resolve({ value: undefined, done: true })
            },
          }
        },
      }

      let clock = 0
      const gen = withStreamKeepAlivePings(iterable, times, {
        heartbeatMs: 5,
        now: () => {
          clock += 1
          return clock
        },
      })

      for await (const item of gen) {
        if (isStreamPingEvent(item)) {
          break
        }
      }

      // Now reject the in-flight next() promise after consumer broke out
      rejectPending(new Error('late_abort_after_break'))
      await tick(40)
      expect(unhandled).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })

  test('supports mutable BodyChunkTimesRef swapped mid-stream', async () => {
    const firstTimes: BodyChunkTimes = { lastAt: 0 }
    const secondTimes: BodyChunkTimes = { lastAt: 0 }
    const ref: { current: BodyChunkTimes | undefined } = {
      current: firstTimes,
    }
    let clock = 0

    async function* src() {
      await tick(35)
      yield { type: 'done_event' as const }
    }

    // Swap ref to secondTimes and advance secondTimes (leaving firstTimes at 0)
    setTimeout(() => {
      ref.current = secondTimes
      secondTimes.lastAt = 5_000
    }, 5)

    const out: unknown[] = []
    for await (const item of withStreamKeepAlivePings(
      src(),
      ref as BodyChunkTimesRef,
      {
        heartbeatMs: 8,
        now: () => {
          clock += 1
          return clock
        },
      },
    )) {
      out.push(item)
    }
    expect(out.some(isStreamPingEvent)).toBe(true)
    expect(out.some(e => (e as { type: string }).type === 'done_event')).toBe(
      true,
    )
  })
})

// ============================================================================
// E1-P0-3: claude.ts wrapStreamWithResumption stream/chunkTimesRef/abort/watchdog
// ============================================================================
describe('E1-P0-3: claude.ts wrapStreamWithResumption resource & watchdog hardening', () => {
  const pauseDelta = {
    type: 'message_delta',
    delta: {
      stop_reason: 'pause_turn',
      stop_sequence: null,
      stop_details: {
        resumption: { token: 'tok_e1_p0_3' },
      },
    },
    usage: { output_tokens: 5 },
  } as unknown as BetaRawMessageStreamEvent

  const baseStream1Events: BetaRawMessageStreamEvent[] = [
    {
      type: 'message_start',
      message: {
        id: 'msg_res_1',
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
      delta: { type: 'text_delta', text: 'Part 1 ' },
    } as unknown as BetaRawMessageStreamEvent,
    { type: 'content_block_stop', index: 0 } as BetaRawMessageStreamEvent,
    pauseDelta,
    { type: 'message_stop' } as BetaRawMessageStreamEvent,
  ]

  test('early break on resumed stream aborts resumed stream controller and cancels resumed response body', async () => {
    const vcrSpy = spyOn(vcrModule, 'withStreamingVCR').mockImplementation(
      async function* (_msgs, fn) {
        yield* fn()
      },
    )
    const stream1 = makeMockStreamWithController(baseStream1Events)
    const stream2 = makeMockStreamWithController(
      [
        {
          type: 'message_start',
          message: {
            id: 'msg_res_2',
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
          delta: { type: 'text_delta', text: 'Part 2' },
        } as unknown as BetaRawMessageStreamEvent,
        { type: 'content_block_stop', index: 0 } as BetaRawMessageStreamEvent,
      ],
      { hangAfterIndex: 3 },
    )
    const resp1 = makeResponseWithChunkTimes()
    const resp2 = makeResponseWithChunkTimes()

    let call = 0
    const clientSpy = spyOn(
      clientModule,
      'getAnthropicClient',
    ).mockResolvedValue({
      beta: {
        messages: {
          create: () => {
            call++
            return {
              withResponse: async () =>
                call === 1
                  ? {
                      data: stream1.stream,
                      request_id: 'req_s1',
                      response: resp1.response,
                    }
                  : {
                      data: stream2.stream,
                      request_id: 'req_s2',
                      response: resp2.response,
                    },
            }
          },
        },
      },
    } as unknown as Anthropic)

    try {
      const outerAbort = new AbortController()
      let sawPart2 = false
      for await (const ev of queryModelWithStreaming({
        messages: [createUserMessage({ content: 'resume test' })],
        systemPrompt: asSystemPrompt(['You are Claude.']),
        thinkingConfig: { type: 'disabled' },
        tools: [],
        signal: outerAbort.signal,
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
        if (
          ev.type === 'assistant' &&
          JSON.stringify(
            (ev as { message?: { content?: unknown } }).message?.content,
          )?.includes('Part 2')
        ) {
          sawPart2 = true
          break
        }
      }

      expect(sawPart2).toBe(true)
      expect(call).toBe(2)
      // E1-P0-3: outer `stream` was reassigned to resumed.data so releaseStreamResources()
      // aborted BOTH stream1 and stream2 controllers and cancelled BOTH response bodies!
      expect(stream1.controller.signal.aborted).toBe(true)
      expect(resp1.cancelled()).toBe(true)
      expect(stream2.controller.signal.aborted).toBe(true)
      expect(resp2.cancelled()).toBe(true)
    } finally {
      clientSpy.mockRestore()
      vcrSpy.mockRestore()
    }
  })

  test('resumption create() uses linked AbortSignal and keeps idle watchdog armed across handshake', async () => {
    const vcrSpy = spyOn(vcrModule, 'withStreamingVCR').mockImplementation(
      async function* (_msgs, fn) {
        yield* fn()
      },
    )
    const stream1 = makeMockStreamWithController(baseStream1Events)
    const resp1 = makeResponseWithChunkTimes()
    let resumptionSignal: AbortSignal | undefined
    let call = 0

    const clientSpy = spyOn(
      clientModule,
      'getAnthropicClient',
    ).mockResolvedValue({
      beta: {
        messages: {
          create: (
            _params: Record<string, unknown>,
            reqOpts?: { signal?: AbortSignal },
          ) => {
            call++
            if (call === 1) {
              return {
                withResponse: async () => ({
                  data: stream1.stream,
                  request_id: 'req_r1',
                  response: resp1.response,
                }),
              }
            }
            resumptionSignal = reqOpts?.signal
            return {
              withResponse: () =>
                new Promise((_resolve, reject) => {
                  reqOpts?.signal?.addEventListener(
                    'abort',
                    () => reject(new Error('resumption_aborted')),
                    { once: true },
                  )
                }),
            }
          },
        },
      },
    } as unknown as Anthropic)

    try {
      const outerAbort = new AbortController()
      const gen = queryModelWithStreaming({
        messages: [createUserMessage({ content: 'hang resumption' })],
        systemPrompt: asSystemPrompt(['You are Claude.']),
        thinkingConfig: { type: 'disabled' },
        tools: [],
        signal: outerAbort.signal,
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
      })

      // Trigger abort once resumption create() is entered
      const consumePromise = (async () => {
        const events: unknown[] = []
        for await (const ev of gen) {
          events.push(ev)
        }
        return events
      })()

      await waitFor(() => resumptionSignal !== undefined)
      // Must be a child signal (linked to outer signal + releaseStreamResources), not raw outer signal
      expect(resumptionSignal).not.toBe(outerAbort.signal)
      expect(resumptionSignal!.aborted).toBe(false)

      outerAbort.abort()
      await consumePromise.catch(() => {})
      expect(resumptionSignal!.aborted).toBe(true)

      // Verify claude.ts keeps resetStreamIdleTimer() armed across resumption create() instead of disarming
      const claudeSrc = readFileSync(
        join(import.meta.dir, '../../services/api/claude.ts'),
        'utf8',
      )
      const sendIdx = claudeSrc.indexOf('send: async resumeParams =>')
      expect(sendIdx).toBeGreaterThan(0)
      const sendBlock = claudeSrc.slice(sendIdx, sendIdx + 1200)
      expect(sendBlock).toContain('resetStreamIdleTimer()')
      expect(sendBlock).not.toContain('clearStreamIdleTimers()')
      expect(sendBlock).toContain('activeResumptionAbortController')
    } finally {
      clientSpy.mockRestore()
      vcrSpy.mockRestore()
    }
  })
})

// ============================================================================
// E1-P0-4 & E1-P2-14 & E1-P2-15: SessionsV2Client & bridgeApi.ts
// ============================================================================
describe('E1-P0-4 & E1-P2-14 & E1-P2-15: SessionsV2Client & bridgeApi hardening', () => {
  test('SessionsV2Client validates sessionId via validateBridgeId in constructor', () => {
    for (const badId of [
      '',
      '../admin',
      'sess/123',
      'a?b=c',
      'id with space',
    ]) {
      expect(
        () =>
          new SessionsV2Client(badId, 'org-1', () => 'tok', {
            onMessage: () => {},
          }),
      ).toThrow(/Invalid sessionId/)
    }
  })

  test('SessionsV2Client passes redirect:error on SSE and POST, caps SSE frames at 3MiB, and preserves boundSession ALS across timers/callbacks', async () => {
    const sessionA = makeMockSession('sess-v2-a')
    const sessionB = makeMockSession('sess-v2-b')
    const observedRedirects: Array<RequestRedirect | undefined> = []
    const observedSessions: Record<string, string | undefined> = {}
    const receivedMessages: unknown[] = []

    const encoder = new TextEncoder()
    const oversizedFrame = `event: client_event\nid: 1\ndata: ${'X'.repeat(SESSIONS_V2_MAX_FRAME_BYTES + 1024)}\n\n`
    const validFrame = `event: client_event\nid: 2\ndata: ${JSON.stringify({
      sequence_num: 2,
      source: 'worker',
      created_at: new Date().toISOString(),
      payload: { type: 'assistant', uuid: 'ok-after-oversized' },
    })}\n\n`

    let streamCalls = 0
    const client = runWithSession(
      sessionA,
      () =>
        new SessionsV2Client(
          'cse_hardened_1',
          'org-1',
          () => {
            observedSessions.getAccessToken = getActiveSessionFromAls()?.id
            return 'tok-a'
          },
          {
            onConnected: () => {
              observedSessions.onConnected = getActiveSessionFromAls()?.id
            },
            onMessage: msg => {
              observedSessions.onMessage = getActiveSessionFromAls()?.id
              receivedMessages.push(msg)
            },
            onStreamSilent: () => {
              observedSessions.onStreamSilent = getActiveSessionFromAls()?.id
            },
            onReconnecting: () => {
              observedSessions.onReconnecting = getActiveSessionFromAls()?.id
            },
          },
          undefined,
          0,
          {
            baseApiUrl: 'https://api.example.test',
            livenessTimeoutMs: 40,
            reconnectBaseMs: 15,
            reconnectCapMs: 15,
            fetchFn: (async (
              input: string | URL | Request,
              init?: RequestInit,
            ) => {
              observedRedirects.push(init?.redirect)
              const url = String(input)
              if (url.endsWith('/events')) {
                return new Response(JSON.stringify({ sequence_num: 7 }), {
                  status: 200,
                })
              }
              streamCalls++
              if (streamCalls === 1) {
                let ctrl!: ReadableStreamDefaultController<Uint8Array>
                const rs = new ReadableStream<Uint8Array>({
                  start(c) {
                    ctrl = c
                    c.enqueue(encoder.encode(oversizedFrame))
                    c.enqueue(encoder.encode(validFrame))
                  },
                })
                void ctrl
                return new Response(rs, {
                  status: 200,
                  headers: {
                    'content-type': 'text/event-stream',
                    date: new Date().toUTCString(),
                  },
                })
              }
              observedSessions.reconnectFetch = getActiveSessionFromAls()?.id
              return new Response(new ReadableStream<Uint8Array>({}), {
                status: 200,
                headers: {
                  'content-type': 'text/event-stream',
                  date: new Date().toUTCString(),
                },
              })
            }) as unknown as typeof globalThis.fetch,
          },
        ),
    )

    // Invoke connect & postEvent while another session (sessionB) is active in ALS
    await runWithSession(sessionB, async () => {
      await client.connect()
      await client.postEvent({ type: 'user', text: 'hi' })
    })

    // Wait for valid frame + liveness timeout + reconnect attempt
    await waitFor(() => receivedMessages.length === 1 && streamCalls >= 2)
    client.close()

    expect(SESSIONS_V2_MAX_FRAME_BYTES).toBe(3_145_728)
    expect(observedRedirects.length).toBeGreaterThanOrEqual(3)
    expect(observedRedirects.every(r => r === 'error')).toBe(true)
    expect(receivedMessages).toHaveLength(1)
    expect((receivedMessages[0] as { uuid?: string }).uuid).toBe(
      'ok-after-oversized',
    )
    expect(observedSessions.getAccessToken).toBe(sessionA.id)
    expect(observedSessions.onConnected).toBe(sessionA.id)
    expect(observedSessions.onMessage).toBe(sessionA.id)
    expect(observedSessions.onStreamSilent).toBe(sessionA.id)
    expect(observedSessions.onReconnecting).toBe(sessionA.id)
    expect(observedSessions.reconnectFetch).toBe(sessionA.id)
  })

  test('bridgeApi.ts sets maxRedirects:0 on all non-watch axios calls and archiveSession falls back to v1 on 501', async () => {
    const axiosHandle = setupAxiosMock()
    const recordedCalls: Array<{
      method: string
      url: string
      config?: Record<string, unknown>
    }> = []

    axiosHandle.stubs.post = (async (
      url: string,
      _data?: unknown,
      config?: Record<string, unknown>,
    ) => {
      recordedCalls.push({ method: 'POST', url, config })
      if (url.includes('/v1/code/sessions/') && url.endsWith('/archive')) {
        const validate = config?.validateStatus as
          | ((s: number) => boolean)
          | undefined
        expect(validate?.(501)).toBe(true)
        return { status: 501, data: { error: 'not_implemented' } }
      }
      if (url.endsWith('/v1/environments/bridge')) {
        return {
          status: 200,
          data: { environment_id: 'env_1', environment_secret: 'sec_1' },
        }
      }
      if (url.endsWith('/heartbeat')) {
        return {
          status: 200,
          data: {
            lease_extended: true,
            state: 'active',
            last_heartbeat: new Date().toISOString(),
            ttl_seconds: 60,
          },
        }
      }
      return { status: 200, data: {} }
    }) as never
    axiosHandle.stubs.get = (async (
      url: string,
      config?: Record<string, unknown>,
    ) => {
      recordedCalls.push({ method: 'GET', url, config })
      return { status: 200, data: null }
    }) as never
    axiosHandle.stubs.delete = (async (
      url: string,
      config?: Record<string, unknown>,
    ) => {
      recordedCalls.push({ method: 'DELETE', url, config })
      return { status: 200, data: {} }
    }) as never

    axiosHandle.useStubs = true
    try {
      const api = createBridgeApiClient({
        baseUrl: 'https://api.example.test',
        runnerVersion: '2.1.331',
        getAccessToken: () => 'oauth-tok',
      })

      await api.registerBridgeEnvironment({
        bridgeId: 'br_1',
        machineName: 'box',
        dir: '/tmp',
        branch: 'main',
        gitRepoUrl: null,
        maxSessions: 1,
        workerType: 'claude_code',
      } as unknown as Parameters<typeof api.registerBridgeEnvironment>[0])
      await api.pollForWork('env_1', 'sec_1')
      await api.acknowledgeWork('env_1', 'work_1', 'sess_tok')
      await api.stopWork('env_1', 'work_1', false)
      await api.deregisterEnvironment('env_1')
      await markEnvironmentOffline({
        baseUrl: 'https://api.example.test',
        environmentId: 'env_1',
        environmentSecret: 'sec_1',
        runnerVersion: '2.1.331',
      })
      await api.archiveSession('session_abc')
      await api.reconnectSession('env_1', 'session_abc')
      await api.heartbeatWork('env_1', 'work_1', 'sess_tok')
      await api.sendPermissionResponseEvent(
        'session_abc',
        { type: 'permission_response' } as never,
        'sess_tok',
      )

      // Every single non-watch call must enforce maxRedirects: 0
      expect(recordedCalls.length).toBeGreaterThanOrEqual(11)
      for (const c of recordedCalls) {
        expect(c.config?.maxRedirects).toBe(0)
      }

      // Verify archiveSession tried v2 (501) then fell back to v1!
      const archiveUrls = recordedCalls
        .filter(c => c.url.endsWith('/archive'))
        .map(c => c.url)
      expect(archiveUrls).toEqual([
        'https://api.example.test/v1/code/sessions/cse_abc/archive',
        'https://api.example.test/v1/sessions/session_abc/archive',
      ])
    } finally {
      axiosHandle.useStubs = false
    }
  })
})

// ============================================================================
// E1-P1-5: print.ts synchronous buildHeadlessInterruptReceipt before abort
// ============================================================================
describe('E1-P1-5: print.ts interrupt handler avoids await import microtask race', () => {
  test('resurrected prompt survives when abort listener triggers settleTaken() immediately', async () => {
    resetCommandQueue()
    const uuid = randomUUID()
    const cmd = {
      uuid,
      value: 'follow-up absorbed mid-turn',
      mode: 'prompt' as const,
      priority: 'next' as const,
      requeueIfInterruptedWithinMs: 10_000,
    }
    enqueue(cmd)
    const queuedCommands = getCommandQueue()
    expect(queuedCommands).toHaveLength(1)
    consume(queuedCommands, { reason: 'absorbed_mid_turn' })

    const abortController = new AbortController()
    let putBackSeenOnAbort = false
    abortController.signal.addEventListener('abort', () => {
      putBackSeenOnAbort = wasPutBack(uuid)
      queueMicrotask(() => {
        settleTaken()
      })
    })

    // Exact print.ts order: synchronous buildHeadlessInterruptReceipt BEFORE abortController.abort()
    const receipt = buildHeadlessInterruptReceipt({
      cancelQueued: false,
      turnOutcome: 'stopped',
    })
    abortController.abort()
    await tick(10)

    expect(putBackSeenOnAbort).toBe(true)
    expect(receipt.put_back).toEqual([uuid])
    expect(getCommandQueue().some(c => c.uuid === uuid && c.runsAlone)).toBe(
      true,
    )

    // Verify print interrupt handler (src/cli/print/controlLoop.ts) has no
    // `await import('src/cli/printControlExtras.js')` and runs
    // buildHeadlessInterruptReceipt before abortController.abort(...)
    const printSrc = readFileSync(
      join(import.meta.dir, '../../cli/print/controlLoop.ts'),
      'utf8',
    )
    const cancelQueuedIdx = printSrc.indexOf(
      'const cancelQueued = interruptReq.cancel_queued === true',
    )
    expect(cancelQueuedIdx).toBeGreaterThan(0)
    const interruptBlock = printSrc.slice(
      cancelQueuedIdx,
      cancelQueuedIdx + 3500,
    )
    expect(interruptBlock).not.toContain('await import(')
    const receiptPos = interruptBlock.indexOf('buildHeadlessInterruptReceipt(')
    const abortMatch = interruptBlock.match(
      /abortController\.abort\(\s*createAbortErrorReason\('user-cancel'\)/,
    )
    expect(receiptPos).toBeGreaterThan(0)
    expect(abortMatch?.index ?? -1).toBeGreaterThan(receiptPos)
  })
})

// ============================================================================
// E1-P1-6: withRetry RedirectRefused fail-fast + claude.ts redirect tracking
// ============================================================================
describe('E1-P1-6: RedirectRefused fails fast in withRetry & claude.ts tracks redirects', () => {
  test('shouldRetry returns false for APIConnectionError caused by RedirectRefused (direct and nested)', () => {
    const direct = new APIConnectionError({
      cause: createRedirectRefusedError(),
    })
    expect(shouldRetry(direct)).toBe(false)

    const nested = new APIConnectionError({
      cause: new TypeError('fetch failed', {
        cause: createRedirectRefusedError(),
      }),
    })
    expect(shouldRetry(nested)).toBe(false)
  })

  test('withRetry issues only 1 attempt on RedirectRefused', async () => {
    let attempts = 0
    const gen = withRetry(
      async () => ({}) as Anthropic,
      async () => {
        attempts++
        throw new APIConnectionError({
          cause: createRedirectRefusedError(),
        })
      },
      {
        model: 'claude-sonnet-4-6',
        maxRetries: 4,
        thinkingConfig: { type: 'disabled' },
      },
    )

    let caught: unknown
    try {
      while (true) {
        const res = await gen.next()
        if (res.done) break
      }
    } catch (err) {
      caught = err
    }

    expect(attempts).toBe(1)
    expect(caught).toBeDefined()
  })

  test('queryModelWithStreaming wraps model requests in runWithModelRedirectTracking and skips non-streaming fallback on RedirectRefused', async () => {
    const vcrSpy = spyOn(vcrModule, 'withStreamingVCR').mockImplementation(
      async function* (_msgs, fn) {
        yield* fn()
      },
    )
    let createCalls = 0
    let trackingDefinedInsideCreate = false
    const outerState: { modelCallRefused?: boolean } = {}

    const clientSpy = spyOn(
      clientModule,
      'getAnthropicClient',
    ).mockResolvedValue({
      beta: {
        messages: {
          create: () => {
            createCalls++
            trackingDefinedInsideCreate =
              getModelRedirectTrackingState() !== undefined
            noteModelCallRefused()
            return {
              withResponse: async () => {
                throw new APIConnectionError({
                  cause: createRedirectRefusedError(),
                })
              },
            }
          },
        },
      },
    } as unknown as Anthropic)

    try {
      await runWithModelRedirectTracking(async () => {
        for await (const _ev of queryModelWithStreaming({
          messages: [createUserMessage({ content: 'redirect test' })],
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
          },
        })) {
          // consume
        }
      }, outerState)
    } catch {
      // expected API error
    } finally {
      clientSpy.mockRestore()
      vcrSpy.mockRestore()
    }

    expect(trackingDefinedInsideCreate).toBe(true)
    expect(outerState.modelCallRefused).toBe(true)
    // Must not retry OR fall back to non-streaming!
    expect(createCalls).toBe(1)
  })
})

// ============================================================================
// E1-P1-7 & E1-P1-11 & E1-P2-13: messageQueueManager.ts
// ============================================================================
describe('E1-P1-7 & E1-P1-11 & E1-P2-13: messageQueueManager hardening', () => {
  test('E1-P1-7a: replacing queueSessionReadyPromise while waitingReady.size > 0 never deadlocks', async () => {
    const session = makeMockSession('mq-ready-swap')
    let resolveP1!: () => void
    let resolveP2!: () => void
    const p1 = new Promise<void>(r => {
      resolveP1 = r
    })
    const p2 = new Promise<void>(r => {
      resolveP2 = r
    })
    const written: string[] = []

    runWithSession(session, () => {
      setQueueRecordHookRunner(content => `hooked:${content}`)
      setQueueSessionReadyPromise(p1)
      const writer = createQueueRecordWriter(op => {
        written.push(op.content ?? op.operation)
      })

      writer({
        type: 'queue-operation',
        operation: 'enqueue',
        timestamp: new Date().toISOString(),
        sessionId: session.id,
        content: 'first',
      })
      expect(getHostQueueState(session.host).attachedReadyPromise).toBe(p1)

      // Replace p1 with p2 while waitingReady already has 1 item!
      setQueueSessionReadyPromise(p2)
      writer({
        type: 'queue-operation',
        operation: 'enqueue',
        timestamp: new Date().toISOString(),
        sessionId: session.id,
        content: 'second',
      })
      expect(getHostQueueState(session.host).attachedReadyPromise).toBe(p2)
    })

    // Resolve p1 first -> must stay held waiting for p2
    resolveP1()
    await tick(15)
    expect(written).toEqual([])

    // Resolve p2 -> both first and second flush in FIFO order (previously deadlocked!)
    resolveP2()
    await tick(20)
    expect(written).toEqual(['hooked:first', 'hooked:second'])
  })

  test('E1-P1-7b: queue record writer executes startHook and writeRecord inside each record captured session ALS', async () => {
    const host = createSessionHost()
    const sessionA = createRootSession({
      host,
      id: 'rec-sess-a',
      project: { originalCwd: '/a', projectRoot: '/a', cwd: '/a' },
    })
    const sessionB = createRootSession({
      host,
      id: 'rec-sess-b',
      project: { originalCwd: '/b', projectRoot: '/b', cwd: '/b' },
    })

    let releaseReady!: () => void
    const ready = new Promise<void>(r => {
      releaseReady = r
    })
    const hookSessions: Array<string | undefined> = []
    const writeSessions: Array<string | undefined> = []

    const writer = createQueueRecordWriter(op => {
      writeSessions.push(
        `${op.content}:${getActiveSessionFromAls()?.id ?? 'none'}`,
      )
    })

    runWithSession(sessionA, () => {
      setQueueRecordHookRunner(content => {
        hookSessions.push(
          `${content}:${getActiveSessionFromAls()?.id ?? 'none'}`,
        )
        return content
      })
      setQueueSessionReadyPromise(ready)
      writer({
        type: 'queue-operation',
        operation: 'enqueue',
        timestamp: new Date().toISOString(),
        sessionId: sessionA.id,
        content: 'msgA',
      })
    })
    runWithSession(sessionB, () => {
      writer({
        type: 'queue-operation',
        operation: 'enqueue',
        timestamp: new Date().toISOString(),
        sessionId: sessionB.id,
        content: 'msgB',
      })
    })

    // Settle completely outside any runWithSession
    releaseReady()
    await tick(25)

    expect(hookSessions).toEqual(['msgA:rec-sess-a', 'msgB:rec-sess-b'])
    expect(writeSessions).toEqual(['msgA:rec-sess-a', 'msgB:rec-sess-b'])
  })

  test('E1-P1-11: resurrected peer commands bypass queue-full capacity check and requeueTaken checks res.admitted first', () => {
    const mq = new MessageQueueInstance()
    const cap = getPeerAdmissionLimits().maxQueuedPeerMessages
    const peerUuid = randomUUID()
    const absorbedPeer = {
      uuid: peerUuid,
      value: 'peer follow-up',
      mode: 'prompt' as const,
      priority: 'next' as const,
      requeueIfInterruptedWithinMs: 10_000,
      origin: {
        kind: 'peer' as const,
        from: 'peer-sender',
        name: 'worker-1',
      },
    }

    mq.enqueue(absorbedPeer)
    mq.registerFoldInFlight([{ uuid: peerUuid }])
    mq.consume(mq.getCommands(), { reason: 'absorbed_mid_turn' })

    // Fill the queue up to maxQueuedPeerMessages
    for (let i = 0; i < cap; i++) {
      mq.enqueue({
        uuid: randomUUID(),
        value: `filler-${i}`,
        mode: 'prompt',
        priority: 'next',
        origin: { kind: 'peer', from: `sender-${i}`, name: `w-${i}` },
      })
    }
    expect(mq.countQueuedPeerMessages()).toBe(cap)

    // Resurrected peer prompt must bypass capacity check and succeed!
    const putBack = mq.requeueTaken()
    expect(putBack?.uuid).toBe(peerUuid)
    expect(mq.wasPutBack(peerUuid)).toBe(true)
    expect(mq.isFoldInFlight(peerUuid)).toBe(false)
    expect(mq.countQueuedPeerMessages()).toBe(cap + 1)

    // If enqueueReportingAdmission rejects, requeueTaken must NOT mark putBackUuids or clear foldInFlight
    const mq2 = new MessageQueueInstance()
    const uuid2 = randomUUID()
    const cmd2 = {
      uuid: uuid2,
      value: 'blocked',
      mode: 'prompt' as const,
      priority: 'next' as const,
      requeueIfInterruptedWithinMs: 10_000,
    }
    mq2.enqueue(cmd2)
    mq2.registerFoldInFlight([{ uuid: uuid2 }])
    mq2.consume(mq2.getCommands(), { reason: 'absorbed_mid_turn' })
    const admitSpy = spyOn(mq2, 'enqueueReportingAdmission').mockReturnValue({
      admitted: false,
      reason: 'queue-full',
    })
    try {
      expect(mq2.requeueTaken()).toBeUndefined()
      expect(mq2.wasPutBack(uuid2)).toBe(false)
      expect(mq2.isFoldInFlight(uuid2)).toBe(true)
    } finally {
      admitSpy.mockRestore()
    }
  })

  test('E1-P2-13: markCancelPending enforces CANCEL_PENDING_CAP (256) on terminalEmitted inserts too', () => {
    const mq = new MessageQueueInstance()
    // Insert 300 acked entries
    for (let i = 0; i < 300; i++) {
      expect(
        mq.markCancelPending(`acked-${i}`, { terminalEmitted: true }),
      ).toBe(true)
    }
    // Oldest 44 must have been evicted from BOTH cancelPending and cancelPendingAcked
    for (let i = 0; i < 44; i++) {
      expect(mq.hasCancelPendingAcked(`acked-${i}`)).toBe(false)
      expect(mq.consumeCancelPending(`acked-${i}`)).toBe(false)
    }
    // Newest 256 remain present
    expect(mq.hasCancelPendingAcked('acked-44')).toBe(true)
    expect(mq.hasCancelPendingAcked('acked-299')).toBe(true)

    // Verify preference for evicting un-acked before acked
    const mq2 = new MessageQueueInstance()
    mq2.markCancelPending('acked-0', { terminalEmitted: true })
    mq2.markCancelPending('unacked-1')
    for (let i = 2; i < 256; i++) {
      mq2.markCancelPending(`acked-${i}`, { terminalEmitted: true })
    }
    // 257th insert should evict unacked-1 first, keeping acked-0
    mq2.markCancelPending('acked-256', { terminalEmitted: true })
    expect(mq2.hasCancelPendingAcked('acked-0')).toBe(true)
    expect(mq2.consumeCancelPending('unacked-1')).toBe(false)
  })
})

// ============================================================================
// E1-P1-8: QueryEngine.ts cwdAls capture & isolation across concurrent sessions
// ============================================================================
describe('E1-P1-8: QueryEngine captures and isolates cwdAls alongside boundSession', () => {
  function makeEngineConfig(
    cwd: string,
    session?: ReturnType<typeof makeMockSession>,
  ) {
    let appState = getDefaultAppState()
    return {
      cwd,
      tools: [],
      commands: [],
      mcpClients: [],
      agents: [],
      canUseTool: async () => ({
        behavior: 'allow' as const,
        updatedInput: {},
      }),
      readFileCache: createFileStateCacheWithSizeLimit(100),
      getAppState: () => appState,
      setAppState: (updater: (prev: typeof appState) => typeof appState) => {
        appState = updater(appState)
      },
      customSystemPrompt: 'test',
      userSpecifiedModel: 'claude-sonnet-4-6',
      ...(session ? { session } : {}),
    }
  }

  test('engine created inside runWithCwd keeps its scoped cwd even when called inside another session cwdAls', () => {
    const sessionA = makeMockSession('qe-cwd-a', '/virtual/proj-a')
    const sessionB = makeMockSession('qe-cwd-b', '/virtual/proj-b')

    const engineA = runWithSession(sessionA, () =>
      runWithCwd(
        '/virtual/worktree-a',
        () => new QueryEngine(makeEngineConfig('/virtual/worktree-a')),
      ),
    )

    // Invoke engineA's bound context while sessionB + /virtual/worktree-b are active in ALS
    const observed = runWithSession(sessionB, () =>
      runWithCwd('/virtual/worktree-b', () => {
        const inner = (
          engineA as unknown as {
            runInBoundSession: <T>(fn: () => T) => T
          }
        ).runInBoundSession(() => {
          const initial = {
            sessionId: getActiveSessionFromAls()?.id,
            cwd: getCwd(),
          }
          setCwd('/virtual/worktree-a/nested')
          return { ...initial, afterSet: getCwd() }
        })
        // Session B's cwdAls must remain untouched!
        return {
          inner,
          outerSessionId: getActiveSessionFromAls()?.id,
          outerCwd: getCwd(),
        }
      }),
    )

    expect(observed.inner).toEqual({
      sessionId: sessionA.id,
      cwd: '/virtual/worktree-a',
      afterSet: '/virtual/worktree-a/nested',
    })
    expect(observed.outerSessionId).toBe(sessionB.id)
    expect(observed.outerCwd).toBe('/virtual/worktree-b')

    // Subsequent call on engineA preserves its updated scoped cwd
    const nextCwd = (
      engineA as unknown as { runInBoundSession: <T>(fn: () => T) => T }
    ).runInBoundSession(() => getCwd())
    expect(nextCwd).toBe('/virtual/worktree-a/nested')
  })

  test('engine bound to explicit session exits leaked foreign cwdAls and reads session.project.cwd', () => {
    const sessionA = makeMockSession('qe-exit-a', '/virtual/session-a-cwd')
    const sessionB = makeMockSession('qe-exit-b', '/virtual/session-b-cwd')

    // Created outside runWithCwd with explicit sessionA
    const engineA = new QueryEngine(
      makeEngineConfig('/virtual/session-a-cwd', sessionA),
    )

    // Called from inside sessionB + leaked foreign runWithCwd('/virtual/leaked-b')
    const observed = runWithSession(sessionB, () =>
      runWithCwd('/virtual/leaked-b', () => {
        const inner = (
          engineA as unknown as {
            runInBoundSession: <T>(fn: () => T) => T
          }
        ).runInBoundSession(() => ({
          sessionId: getActiveSessionFromAls()?.id,
          hasScoped: hasScopedCwd(),
          cwd: getCwd(),
        }))
        return { inner, outerCwd: getCwd() }
      }),
    )

    expect(observed.inner).toEqual({
      sessionId: sessionA.id,
      hasScoped: false,
      cwd: '/virtual/session-a-cwd',
    })
    expect(observed.outerCwd).toBe('/virtual/leaked-b')
  })
})

// ============================================================================
// E1-P1-9: turnHandoffStateMachine & worker_shutting_down admission gate
// ============================================================================
describe('E1-P1-9: canonical turn_handoff admission & worker_shutting_down shared_backend guard', () => {
  test('evaluateTurnHandoffAdmission matches resolveTurnHandoffAdmission canonical predicate', () => {
    const cases = [
      {
        input: {},
        expectedAdmitted: false,
        expectedReason: 'not_managed_cloud_worker',
      },
      {
        input: { remoteSessionId: 's1' },
        expectedAdmitted: false,
        expectedReason: 'not_managed_cloud_worker',
      },
      {
        input: { sdkUrl: 'https://sdk.test' },
        expectedAdmitted: false,
        expectedReason: 'not_managed_cloud_worker',
      },
      {
        input: {
          sdkUrl: 'https://sdk.test',
          remoteSessionId: 's1',
          environmentKind: 'byoc',
        },
        expectedAdmitted: false,
        expectedReason: 'not_managed_cloud_worker',
      },
      {
        input: {
          sdkUrl: 'https://sdk.test',
          remoteSessionId: 's1',
          disabled: true,
        },
        expectedAdmitted: false,
        expectedReason: 'disabled',
      },
      {
        input: {
          sdkUrl: 'https://sdk.test',
          remoteSessionId: 's1',
          sharedBackend: true,
        },
        expectedAdmitted: false,
        expectedReason: 'shared_backend',
      },
      {
        input: {
          sdkUrl: 'https://sdk.test',
          remoteSessionId: 's1',
          sharedBackend: false,
        },
        expectedAdmitted: true,
        expectedReason: undefined,
      },
    ] as const

    for (const tc of cases) {
      const a = evaluateTurnHandoffAdmission(tc.input)
      const b = resolveTurnHandoffAdmission(tc.input)
      expect(a.admitted).toBe(tc.expectedAdmitted)
      expect(b.admitted).toBe(tc.expectedAdmitted)
      if (!a.admitted && tc.expectedReason !== undefined) {
        expect(a.reason).toBe(tc.expectedReason)
        if (!b.admitted) {
          expect(b.reason).toBe(tc.expectedReason)
        }
      }
    }
  })

  test('worker_shutting_down only exempts admission.reason === shared_backend (never bypasses disabled or non-cloud)', () => {
    const session = makeMockSession('e1-p1-9-shutdown')
    runWithSession(session, () => {
      resetTurnHandoffManager(session)
      const manager = getTurnHandoffManager(session)
      setSharedBackendMode(true)
      try {
        const makeDeps = (admission: {
          admitted: boolean
          reason?: string
        }) => {
          const successes: unknown[] = []
          const errors: string[] = []
          return {
            successes,
            errors,
            deps: {
              getMcpClients: () => [],
              getPermissionContext: () => ({}),
              setPromptSuggestionEnabled: () => {},
              sendSuccess: (r?: Record<string, unknown>) => successes.push(r),
              sendError: (e: string) => errors.push(e),
              defer: (fn: () => void | Promise<void>) => {
                void fn()
              },
              errorMessage: (err: unknown) => String(err),
              turnHandoffAdmission: admission,
            },
          }
        }

        // 1. disabled: true must STILL be refused even when isSharedBackend() === true
        const disabledHarness = makeDeps({
          admitted: false,
          reason: 'disabled',
        })
        dispatchPrintControlExtra(
          'worker_shutting_down',
          { worker_epoch: 2 },
          disabledHarness.deps,
        )
        expect(disabledHarness.successes).toEqual([])
        expect(disabledHarness.errors).toEqual([
          'turn_handoff_disabled: disabled',
        ])
        expect(manager.multiTenantShutdownAborted).toBe(false)

        // 2. not_managed_cloud_worker must STILL be refused even when isSharedBackend() === true
        const nonCloudHarness = makeDeps({
          admitted: false,
          reason: 'not_managed_cloud_worker',
        })
        dispatchPrintControlExtra(
          'worker_shutting_down',
          { worker_epoch: 2 },
          nonCloudHarness.deps,
        )
        expect(nonCloudHarness.successes).toEqual([])
        expect(nonCloudHarness.errors).toEqual([
          'turn_handoff_disabled: not_managed_cloud_worker',
        ])
        expect(manager.multiTenantShutdownAborted).toBe(false)

        // 3. admission.reason === 'shared_backend' IS exempted and acknowledged
        const sharedHarness = makeDeps({
          admitted: false,
          reason: 'shared_backend',
        })
        dispatchPrintControlExtra(
          'worker_shutting_down',
          { worker_epoch: 4 },
          sharedHarness.deps,
        )
        expect(sharedHarness.errors).toEqual([])
        expect(sharedHarness.successes).toEqual([
          {
            status: 'acknowledged',
            multi_tenant_worker_shutdown: true,
            worker_epoch: 4,
          },
        ])
        expect(manager.multiTenantShutdownAborted).toBe(true)
      } finally {
        setSharedBackendMode(false)
        resetTurnHandoffManager(session)
      }
    })
  })
})

// ============================================================================
// E1-P1-10: promptAsFile.ts rewrites oversized queued_command attachments
// ============================================================================
describe('E1-P1-10: rewriteOversizedPromptsForApi rewrites queued_command attachments', () => {
  test('rewrites string and block-array queued_command attachments to bounded excerpt + reminder idempotently', async () => {
    const head = `QC_HEAD_${'A'.repeat(2200)}`
    const middle = 'M'.repeat(45_000)
    const tail = `${'Z'.repeat(2200)}_QC_TAIL`
    const hugePrompt = head + middle + tail

    // 1. String-prompt queued_command attachment
    const queuedStrMsg = createAttachmentMessage({
      type: 'queued_command',
      prompt: hugePrompt,
      commandMode: 'prompt',
      origin: { kind: 'human' },
    }) as AttachmentMessage<Extract<Attachment, { type: 'queued_command' }>>

    const saved = await trySaveOversizedPromptAsFile({
      rows: [queuedStrMsg],
      contextWindow: 10_000,
      needsProof: true,
      beforeCompaction: true,
      tools: [{ name: 'Read' }],
      flagEnabled: true,
      maxBytes: 10_000_000,
      savePromptFile: async (_text, id) => ({
        filepath: `/tmp/prompts/${id}.txt`,
      }),
    })
    expect(saved).toBeDefined()
    expect(saved).not.toBe('no_file')

    const rewritten = rewriteOversizedPromptsForApi(
      [queuedStrMsg, saved as Message],
      10_000,
    )
    expect(rewritten).not.toBe([queuedStrMsg, saved])
    const rewrittenQueued = rewritten[0] as AttachmentMessage<
      Extract<Attachment, { type: 'queued_command' }>
    >
    expect(rewrittenQueued).not.toBe(queuedStrMsg)
    expect(getOriginalPromptMessage(rewrittenQueued)).toBe(queuedStrMsg)

    const blocks = rewrittenQueued.attachment.prompt as ContentBlockParam[]
    expect(Array.isArray(blocks)).toBe(true)
    const joined = blocks
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map(b => b.text)
      .join('\n')
    expect(joined).toContain('<system-reminder>')
    expect(joined).toContain(`/tmp/prompts/prompt-${queuedStrMsg.uuid}.txt`)
    expect(joined).toContain('QC_HEAD_')
    expect(joined).toContain('_QC_TAIL')
    expect(joined).toContain('characters left out')
    expect(joined.length).toBeLessThan(8_000)

    // extractPromptText sees the bounded excerpt, and second rewrite is idempotent
    expect(extractPromptText(rewrittenQueued)!.length).toBeLessThan(6_000)
    const secondPass = rewriteOversizedPromptsForApi(rewritten, 10_000)
    expect(secondPass).toBe(rewritten)

    // API normalization emits bounded content (not 49k chars)
    const apiMessages = normalizeAttachmentForAPI(rewrittenQueued.attachment)
    expect(JSON.stringify(apiMessages).length).toBeLessThan(9_000)

    // 2. ContentBlockParam[] queued_command attachment preserves leading system-reminder & image blocks
    const imageBlock = {
      type: 'image' as const,
      source: {
        type: 'base64' as const,
        media_type: 'image/png' as const,
        data: 'iVBORw0KGgo=',
      },
    }
    const queuedBlockMsg = createAttachmentMessage({
      type: 'queued_command',
      prompt: [
        { type: 'text', text: '<system-reminder>keep-me</system-reminder>' },
        { type: 'text', text: hugePrompt },
        imageBlock,
      ],
      commandMode: 'prompt',
      origin: { kind: 'human' },
    }) as AttachmentMessage<Extract<Attachment, { type: 'queued_command' }>>

    const saved2 = await trySaveOversizedPromptAsFile({
      rows: [queuedBlockMsg],
      contextWindow: 10_000,
      needsProof: true,
      beforeCompaction: true,
      tools: [{ name: 'Read' }],
      flagEnabled: true,
      maxBytes: 10_000_000,
      savePromptFile: async (_text, id) => ({
        filepath: `/tmp/prompts/${id}.txt`,
      }),
    })
    expect(saved2).toBeDefined()
    expect(saved2).not.toBe('no_file')

    const rewritten2 = rewriteOversizedPromptsForApi(
      [queuedBlockMsg, saved2 as Message],
      10_000,
    )
    const rw2Blocks = (
      rewritten2[0] as AttachmentMessage<
        Extract<Attachment, { type: 'queued_command' }>
      >
    ).attachment.prompt as ContentBlockParam[]
    expect(
      rw2Blocks.some(b => b.type === 'text' && b.text.includes('keep-me')),
    ).toBe(true)
    expect(rw2Blocks.some(b => b.type === 'image')).toBe(true)
  })
})

// ============================================================================
// E1-P2-12: query.ts recovery transitions preserve latches & thinking_only tombstones
// ============================================================================
describe('E1-P2-12: query.ts recovery transitions preserve state latches and yield thinking_only tombstones', () => {
  test('thinking_only_retry yields tombstones for retracted assistant messages and preserves prior retry latches', async () => {
    let call = 0
    const yielded: unknown[] = []
    let thinkingMsgUuid: UUID | undefined

    const gen = query({
      messages: [createUserMessage({ content: 'give me an answer' })],
      systemPrompt: asSystemPrompt(['You are Claude.']),
      userContext: {},
      systemContext: {},
      canUseTool: async () => ({ behavior: 'allow', updatedInput: {} }),
      toolUseContext: makeToolUseContext(),
      querySource: 'repl_main_thread',
      deps: {
        callModel: async function* () {
          call++
          if (call === 1) {
            // 1. Trigger same-model refusal retry (sets refusalRetrySpent = true)
            const refused = createAssistantAPIErrorMessage({
              content: 'refused',
              apiError: 'refusal',
            })
            refused.message.stop_reason = 'refusal'
            yield refused
          } else if (call === 2) {
            // 2. Trigger thinking_only_retry (retracts thinkingOnlyMsg -> must yield tombstone
            //    AND must NOT reset refusalRetrySpent!)
            const thinkingOnly = createAssistantMessage({
              content: [
                {
                  type: 'thinking',
                  thinking: 'silent internal reasoning',
                  signature: 'sig_1',
                },
              ] as never,
            })
            thinkingOnly.message.stop_reason = 'end_turn'
            thinkingMsgUuid = thinkingOnly.uuid
            yield thinkingOnly
          } else if (call === 3) {
            // 3. Emit another refusal -> because refusalRetrySpent was preserved across
            //    thinking_only_retry via `...state`, query() MUST NOT retry refusal again!
            const refusedAgain = createAssistantAPIErrorMessage({
              content: 'refused second time',
              apiError: 'refusal',
            })
            refusedAgain.message.stop_reason = 'refusal'
            yield refusedAgain
          } else {
            yield createAssistantMessage({ content: 'unexpected fourth call' })
          }
        },
        autocompact: async () => ({ wasCompacted: false }),
        microcompact: async msgs => ({ messages: msgs }),
        uuid: () => randomUUID(),
      },
    })

    while (true) {
      const next = await gen.next()
      if (next.done) break
      yielded.push(next.value)
    }

    // Call 1 (refusal) -> Call 2 (thinking-only) -> Call 3 (refusal NOT retried because latch preserved!)
    expect(call).toBe(3)

    // Tombstone was yielded for the retracted thinking-only assistant message BEFORE nudge
    const tombstoneIdx = yielded.findIndex(
      m =>
        typeof m === 'object' &&
        m !== null &&
        (m as { type?: string }).type === 'tombstone' &&
        (m as { message?: AssistantMessage }).message?.uuid === thinkingMsgUuid,
    )
    const nudgeIdx = yielded.findIndex(
      m =>
        typeof m === 'object' &&
        m !== null &&
        (m as { type?: string }).type === 'user' &&
        (m as { message?: { content?: unknown } }).message?.content ===
          THINKING_ONLY_RETRY_PROMPT,
    )
    expect(tombstoneIdx).toBeGreaterThan(-1)
    expect(nudgeIdx).toBeGreaterThan(tombstoneIdx)

    // Structural check: all 4 required recovery transitions spread `...state`
    const querySrc = readFileSync(
      join(import.meta.dir, '../../query.ts'),
      'utf8',
    )
    for (const reason of [
      "reason: 'collapse_drain_retry'",
      "reason: 'prompt_as_file'",
      "reason: 'malformed_tool_use_retry'",
      "reason: 'thinking_only_retry'",
    ]) {
      let searchFrom = 0
      let matches = 0
      while (true) {
        const idx = querySrc.indexOf(reason, searchFrom)
        if (idx === -1) break
        const blockBefore = querySrc.slice(Math.max(0, idx - 900), idx)
        if (
          blockBefore.includes('state = {') ||
          blockBefore.includes('const next: State = {')
        ) {
          expect(blockBefore).toContain('...state,')
          matches++
        }
        searchFrom = idx + reason.length
      }
      expect(matches).toBeGreaterThanOrEqual(1)
    }
  })
})
