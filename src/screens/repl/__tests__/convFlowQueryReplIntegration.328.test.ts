import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ToolUseBlock } from '@anthropic-ai/sdk/resources/index.mjs'
import {
  getMainLoopBusy,
  getSessionId,
  setMainLoopBusy,
} from '../../../bootstrap/state.js'
import { buildQueryConfig } from '../../../query/config.js'
import { handleStopHooks } from '../../../query/stopHooks.js'
import {
  isGoalToolsOnly,
  query,
  REOPEN_BLOCK_RECOVERY_PROMPT,
  selectMaxOutputTokensRecoveryPrompt,
  selectPollEventChunk,
  TOOL_CALL_CUT_RECOVERY_PROMPT,
} from '../../../query.js'
import {
  currentLimits,
  resetCurrentLimits,
} from '../../../services/claudeAiLimits.js'
import {
  type AppState,
  getDefaultAppState,
} from '../../../state/AppStateStore.js'
import { createStore } from '../../../state/store.js'
import {
  getEmptyToolPermissionContext,
  type Tool,
  type ToolUseContext,
} from '../../../Tool.js'
import type {
  AssistantMessage,
  Message,
  UserMessage,
} from '../../../types/message.js'
import type { QueuedCommand } from '../../../types/textInputTypes.js'
import { createAbortErrorReason } from '../../../utils/abortController.js'
import {
  getLastCacheSafeParams,
  saveCacheSafeParams,
} from '../../../utils/forkedAgent.js'
import { addFunctionHook } from '../../../utils/hooks/sessionHooks.js'
import {
  consume as consumeFromQueue,
  enqueue,
  getCommandQueue,
  resetCommandQueue,
  settleTaken,
  startRequeueWindow,
  suspendMidTurnFold,
} from '../../../utils/messageQueueManager.js'
import {
  createAssistantAPIErrorMessage,
  createAssistantMessage,
  createUserMessage,
} from '../../../utils/messages.js'
import {
  checkIdleCompactionEligibility,
  getIdleCompactionRunner,
  IDLE_COMPACT_SUMMARIZED_MESSAGE,
} from '../idleCompaction.js'
import {
  buildRestoredDraftFromMessages,
  collectBatchedTurnUserMessagesForRestore,
  collectTrackedFilePathsFromMessages,
  planRewindRefusalFallbackUnwind,
  type RunReplTurnDeps,
  runReplTurn,
} from '../runReplTurn.js'
import { TranscriptProjection } from '../TranscriptProjection.js'
import { TurnController } from '../TurnController.js'

const ROOT = join(import.meta.dir, '../../../..')

function makeToolUseContext(
  overrides: Partial<ToolUseContext> = {},
): ToolUseContext {
  let state: AppState = getDefaultAppState()
  const ac = overrides.abortController ?? new AbortController()
  return {
    abortController: ac,
    messages: [],
    readFileState: new Map() as unknown as ToolUseContext['readFileState'],
    getAppState: () => state,
    setAppState: (updater: (prev: AppState) => AppState) => {
      state = updater(state)
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

function makeSimpleTool(
  name: string,
  exec: (input: Record<string, unknown>) => Promise<{
    data: string
    mcpMeta?: { _meta?: Record<string, unknown> }
  }>,
  extra: Partial<Tool> = {},
): Tool {
  return {
    name,
    isConcurrencySafe: () => true,
    isReadOnly: () => true,
    isEnabled: () => true,
    inputSchema: {
      safeParse: (v: unknown) => ({ success: true, data: v }),
    },
    async call(input: Record<string, unknown>) {
      return exec(input)
    },
    mapToolResultToToolResultBlockParam(out: unknown, id: string) {
      return {
        type: 'tool_result',
        tool_use_id: id,
        content: typeof out === 'string' ? out : JSON.stringify(out),
      }
    },
    ...extra,
  } as unknown as Tool
}

async function drainQuery<T>(
  gen: AsyncGenerator<unknown, T>,
): Promise<{ events: unknown[]; terminal: T }> {
  const events: unknown[] = []
  while (true) {
    const next = await gen.next()
    if (next.done) {
      return { events, terminal: next.value }
    }
    events.push(next.value)
  }
}

describe('Conversation Flow Wave 2 (CF-6) — official 2.1.328 query & REPL alignment', () => {
  beforeEach(() => {
    resetCommandQueue()
    resetCurrentLimits()
    saveCacheSafeParams(null)
    setMainLoopBusy(false)
    getIdleCompactionRunner().clear()
    getIdleCompactionRunner().consumeHeldSummary()
  })

  afterEach(() => {
    resetCommandQueue()
    resetCurrentLimits()
    saveCacheSafeParams(null)
    setMainLoopBusy(false)
    getIdleCompactionRunner().clear()
    getIdleCompactionRunner().consumeHeldSummary()
  })

  test('[P0-1] query() does NOT unconditionally strip thinking signature blocks on same-model turns', async () => {
    const priorSignedThinking = createAssistantMessage({
      content: [
        {
          type: 'thinking',
          thinking: 'Careful reasoning step',
          signature: 'sig-same-model-valid-123',
        },
        { type: 'text', text: 'Initial reply', citations: null },
      ] as any,
    })
    const followUp = createUserMessage({ content: 'Continue please' })

    let capturedMessages: Message[] = []
    const ctx = makeToolUseContext()
    const gen = query({
      messages: [priorSignedThinking, followUp],
      systemPrompt: ['sys'] as never,
      userContext: {},
      systemContext: {},
      canUseTool: async () => ({ behavior: 'allow', updatedInput: {} }),
      toolUseContext: ctx,
      querySource: 'repl_main_thread',
      deps: {
        callModel: async function* (args) {
          capturedMessages = args.messages
          yield createAssistantMessage({ content: 'Done!' })
        },
        autocompact: async () => ({ wasCompacted: false }),
        microcompact: async msgs => ({ messages: msgs }),
        uuid: () => crypto.randomUUID(),
      },
    })

    const { terminal } = await drainQuery(gen)
    expect(terminal.reason).toBe('completed')

    const priorInCall = capturedMessages.find(
      m => m.type === 'assistant' && m.uuid === priorSignedThinking.uuid,
    ) as AssistantMessage | undefined
    expect(priorInCall).toBeDefined()
    const blocks = priorInCall!.message.content as unknown as Array<{
      type: string
      signature?: string
    }>
    expect(
      blocks.some(
        b =>
          b.type === 'thinking' && b.signature === 'sig-same-model-valid-123',
      ),
    ).toBe(true)
  })

  test('[P0-6] stop_hook_blocking retry increments turnCount so repeated Stop hook blocks hit maxTurns', async () => {
    const ctx = makeToolUseContext()
    const sid = getSessionId()
    addFunctionHook(
      ctx.setAppState,
      sid,
      'Stop',
      '',
      () => false,
      'keep working',
    )

    let modelCalls = 0
    const gen = query({
      messages: [createUserMessage({ content: 'do work' })],
      systemPrompt: ['sys'] as never,
      userContext: {},
      systemContext: {},
      canUseTool: async () => ({ behavior: 'allow', updatedInput: {} }),
      toolUseContext: ctx,
      querySource: 'repl_main_thread',
      maxTurns: 2,
      deps: {
        callModel: async function* () {
          modelCalls++
          yield createAssistantMessage({ content: `attempt ${modelCalls}` })
        },
        autocompact: async () => ({ wasCompacted: false }),
        microcompact: async msgs => ({ messages: msgs }),
        uuid: () => crypto.randomUUID(),
      },
    })

    const { terminal } = await drainQuery(gen)
    expect(modelCalls).toBe(2)
    expect(terminal).toEqual({ reason: 'max_turns', turnCount: 3 })
  })

  test('[P0-12] maxTurns is checked BEFORE consuming mid-turn queued user commands', async () => {
    const tool = makeSimpleTool('Echo', async () => ({ data: 'echoed' }))
    const ctx = makeToolUseContext({ options: { tools: [tool] } as never })
    enqueue({
      uuid: '00000000-0000-4000-8000-000000000012' as const,
      value: 'do not drop me on maxTurns',
      mode: 'prompt',
      priority: 'next',
    })

    const gen = query({
      messages: [createUserMessage({ content: 'run tool' })],
      systemPrompt: ['sys'] as never,
      userContext: {},
      systemContext: {},
      canUseTool: async () => ({ behavior: 'allow', updatedInput: {} }),
      toolUseContext: ctx,
      querySource: 'repl_main_thread',
      maxTurns: 1,
      deps: {
        callModel: async function* () {
          yield createAssistantMessage({
            content: [
              {
                type: 'tool_use',
                id: 'tu-max-1',
                name: 'Echo',
                input: {},
              },
            ],
          })
        },
        autocompact: async () => ({ wasCompacted: false }),
        microcompact: async msgs => ({ messages: msgs }),
        uuid: () => crypto.randomUUID(),
      },
    })

    const { terminal } = await drainQuery(gen)
    expect(terminal).toEqual({ reason: 'max_turns', turnCount: 2 })
    // The mid-turn queued user prompt MUST still remain queued!
    expect(getCommandQueue()).toHaveLength(1)
    expect(getCommandQueue()[0]?.value).toBe('do not drop me on maxTurns')
  })

  test('[P0-13] Normal Esc cancel does NOT call queryGuard.forceEnd() synchronously so runReplTurn finally sends bridge result and arms idleRunner', async () => {
    const store = createStore(getDefaultAppState())
    const turn = new TurnController({ store })
    const ac = new AbortController()
    const entered = Promise.withResolvers<void>()
    let bridgeResultCalls = 0
    let lastCompletionTime = 0
    let mrTurnCompleteAborted: boolean | undefined
    const messagesRef = { current: [] as Message[] }

    const deps = {
      store,
      queryGuard: turn.guard,
      initialMcpClients: [],
      titleDisabled: true,
      sessionTitle: 'test',
      haikuTitleAttemptedRef: { current: true },
      setHaikuTitle: () => {},
      commands: [],
      setConversationId: () => {},
      setAppState: (u: any) =>
        store.setState(p => (typeof u === 'function' ? u(p) : u)),
      messagesRef,
      setMessages: (action: any) => {
        messagesRef.current =
          typeof action === 'function' ? action(messagesRef.current) : action
      },
      resetLoadingState: () => {},
      setAbortController: () => {},
      getToolUseContext: (_m: any, _n: any, ctrl: AbortController) =>
        makeToolUseContext({
          abortController: ctrl,
          options: { mainLoopModel: 'claude-opus-5' } as never,
        }) as any,
      toolPermissionContext: getEmptyToolPermissionContext(),
      terminalFocusRef: { current: true },
      canUseTool: async () => ({ behavior: 'allow', updatedInput: {} }),
      hostEngine: {
        streamInput: async () => {},
        next: async () => {
          entered.resolve()
          await new Promise<void>(resolve => {
            if (ac.signal.aborted) resolve()
            else
              ac.signal.addEventListener('abort', () => resolve(), {
                once: true,
              })
          })
          return { done: true, value: undefined }
        },
        interrupt: async () => {},
      } as any,
      engineFeed: turn.engineFeed,
      onQueryEvent: () => {},
      addNotification: () => {},
      leftArrowDeferRef: { current: null },
      inputValueRef: { current: '' },
      markIdleForkMidTurn: () => {},
      leftArrowToAgentsFired: { current: false },
      buddyEnabled: false,
      pipeReturnHadErrorRef: { current: false },
      relayPipeMessage: () => {},
      apiMetricsRef: { current: [] },
      loadingStartTimeRef: { current: 0 },
      totalPausedMsRef: { current: 0 },
      swarmStartTimeRef: { current: null },
      swarmBudgetInfoRef: { current: undefined },
      backgroundWaitStartTimeRef: { current: null },
      resetTimingRefs: () => {},
      responseLengthRef: { current: 0 },
      setStreamingToolUses: () => {},
      clearStreamingText: () => {},
      displayTransform: { newTurn: () => {} },
      mrOnBeforeQuery: async () => {},
      mrOnTurnComplete: async (_msgs: Message[], aborted: boolean) => {
        mrTurnCompleteAborted = aborted
      },
      setLastQueryCompletionTime: (ts: number) => {
        lastCompletionTime = ts
      },
      sendBridgeResultRef: {
        current: () => {
          bridgeResultCalls++
        },
      },
      proactiveActive: false,
      restoreMessageSyncRef: { current: () => {} },
    } as unknown as RunReplTurnDeps

    try {
      const turnPromise = runReplTurn(
        {
          newMessages: [createUserMessage({ content: 'hello' })],
          abortController: ac,
          shouldQuery: true,
          additionalAllowedTools: [],
          mainLoopModelParam: 'claude-opus-5',
        },
        deps,
      )
      await entered.promise
      // Normal Esc cancel: abort ONLY (no synchronous queryGuard.forceEnd())
      ac.abort(createAbortErrorReason('user-cancel'))
      await turnPromise

      expect(bridgeResultCalls).toBe(1)
      expect(lastCompletionTime).toBeGreaterThan(0)
      expect(mrTurnCompleteAborted).toBe(true)
      expect(getIdleCompactionRunner().lastTurnEndInfo?.reason).toBe('aborted')
      expect(turn.guard.isActive).toBe(false)
    } finally {
      turn.dispose()
    }

    // Verify REPL.tsx gates forceEnd behind stop-wait timeout / non-local-running-turn
    const replSrc = readFileSync(join(ROOT, 'src/screens/REPL.tsx'), 'utf8')
    expect(replSrc).toContain('const hasLocalRunningTurn = Boolean(')
    expect(replSrc).toContain(
      '[onCancel] stop-wait timeout reached; forcing queryGuard end',
    )
  })

  test('[P1-4] selectPollEventChunk enforces 20-event / 32KB cap without mutating queue, and query respects mid-turn fold filters & suspension', async () => {
    const manyPolls: QueuedCommand[] = Array.from({ length: 25 }, (_, i) => ({
      value: `poll-${i}`,
      mode: 'poll-event',
      priority: 'next',
      pollEvent: {
        kind: 'status',
        envelope: `<poll>${i}</poll>`,
        wake: true,
      },
    }))
    const sliced = selectPollEventChunk(manyPolls)
    expect(sliced).toHaveLength(20)

    // 32KB byte cap while keeping same group intact
    const bigPolls: QueuedCommand[] = [
      {
        value: 'g1',
        mode: 'poll-event',
        priority: 'next',
        pollEvent: {
          kind: 'status',
          envelope: 'A'.repeat(20_000),
          wake: true,
        },
      },
      {
        value: 'g2',
        mode: 'poll-event',
        priority: 'next',
        pollEvent: {
          kind: 'status',
          envelope: 'B'.repeat(20_000),
          wake: true,
        },
      },
    ]
    expect(selectPollEventChunk(bigPolls)).toHaveLength(1)

    // Turn-start poll-event fold respects isMidTurnFoldSuspended()
    enqueue(manyPolls[0]!)
    suspendMidTurnFold()
    const ctx = makeToolUseContext()
    await drainQuery(
      query({
        messages: [createUserMessage({ content: 'hi' })],
        systemPrompt: ['sys'] as never,
        userContext: {},
        systemContext: {},
        canUseTool: async () => ({ behavior: 'allow', updatedInput: {} }),
        toolUseContext: ctx,
        querySource: 'repl_main_thread',
        deps: {
          callModel: async function* () {
            yield createAssistantMessage({ content: 'ok' })
          },
          autocompact: async () => ({ wasCompacted: false }),
          microcompact: async msgs => ({ messages: msgs }),
          uuid: () => crypto.randomUUID(),
        },
      }),
    )
    expect(getCommandQueue()).toHaveLength(1)

    // Mid-turn fold skips waitsOutStop: true and passive: true
    resetCommandQueue()
    enqueue({
      uuid: '00000000-0000-4000-8000-000000000041' as const,
      value: 'wait out stop',
      mode: 'prompt',
      priority: 'next',
      waitsOutStop: true,
    })
    enqueue({
      uuid: '00000000-0000-4000-8000-000000000042' as const,
      value: 'passive notice',
      mode: 'prompt',
      priority: 'next',
      passive: true,
    })
    const tool = makeSimpleTool('Ping', async () => ({ data: 'pong' }))
    const ctx2 = makeToolUseContext({ options: { tools: [tool] } as never })
    let turnIdx = 0
    await drainQuery(
      query({
        messages: [createUserMessage({ content: 'ping' })],
        systemPrompt: ['sys'] as never,
        userContext: {},
        systemContext: {},
        canUseTool: async () => ({ behavior: 'allow', updatedInput: {} }),
        toolUseContext: ctx2,
        querySource: 'repl_main_thread',
        deps: {
          callModel: async function* () {
            turnIdx++
            if (turnIdx === 1) {
              yield createAssistantMessage({
                content: [
                  { type: 'tool_use', id: 'tu-ping', name: 'Ping', input: {} },
                ],
              })
            } else {
              yield createAssistantMessage({ content: 'done' })
            }
          },
          autocompact: async () => ({ wasCompacted: false }),
          microcompact: async msgs => ({ messages: msgs }),
          uuid: () => crypto.randomUUID(),
        },
      }),
    )
    expect(getCommandQueue()).toHaveLength(2)

    // startRequeueWindow + settleTaken lifecycle
    resetCommandQueue()
    const cmd = {
      uuid: '00000000-0000-4000-8000-000000000043' as const,
      value: 'resurrect me',
      mode: 'prompt' as const,
      priority: 'next' as const,
      requeueIfInterruptedWithinMs: 5000,
    } as QueuedCommand
    enqueue(cmd)
    consumeFromQueue([cmd], { reason: 'absorbed_mid_turn' })
    startRequeueWindow()
    settleTaken({ turnEnded: true })
  })

  test('[P1-5 + P1-15] heldSummary replaces pre-compaction messages, setMainLoopBusy stays true with queued items, Esc auto-restore ignores non-editable items & restores batched turn', async () => {
    const store = createStore(getDefaultAppState())
    const turn = new TurnController({ store })
    const oldPreCompact1 = createUserMessage({ content: 'ancient prompt' })
    const oldPreCompact2 = createAssistantMessage({ content: 'ancient reply' })
    const freshPrompt = createUserMessage({
      content: 'new question after idle',
    })
    const summaryRow = createUserMessage({
      content: 'Summary of ancient conversation',
      isCompactSummary: true,
    })
    const messagesRef = {
      current: [oldPreCompact1, oldPreCompact2] as Message[],
    }

    getIdleCompactionRunner().setHeldSummary([summaryRow])
    // Enqueue a main-thread task-notification so setMainLoopBusy stays true at turn end
    enqueue({
      value: '<task-notification>bg done</task-notification>',
      mode: 'task-notification',
      priority: 'later',
    })

    const baseDeps = {
      store,
      queryGuard: turn.guard,
      initialMcpClients: [],
      titleDisabled: true,
      sessionTitle: 'test',
      haikuTitleAttemptedRef: { current: true },
      setHaikuTitle: () => {},
      commands: [],
      setConversationId: () => {},
      setAppState: () => {},
      messagesRef,
      setMessages: (action: any) => {
        messagesRef.current =
          typeof action === 'function' ? action(messagesRef.current) : action
      },
      resetLoadingState: () => {},
      setAbortController: () => {},
      pipeReturnHadErrorRef: { current: false },
      relayPipeMessage: () => {},
      resetTimingRefs: () => {},
      responseLengthRef: { current: 0 },
      apiMetricsRef: { current: [] },
      setStreamingToolUses: () => {},
      clearStreamingText: () => {},
      displayTransform: { newTurn: () => {} },
      mrOnBeforeQuery: async () => {},
      mrOnTurnComplete: async () => {},
      setLastQueryCompletionTime: () => {},
      sendBridgeResultRef: { current: () => {} },
      loadingStartTimeRef: { current: 0 },
      totalPausedMsRef: { current: 0 },
      swarmStartTimeRef: { current: null },
      swarmBudgetInfoRef: { current: undefined },
      backgroundWaitStartTimeRef: { current: null },
      proactiveActive: false,
      inputValueRef: { current: '' },
      restoreMessageSyncRef: { current: () => {} },
    } as unknown as RunReplTurnDeps

    try {
      await runReplTurn(
        {
          newMessages: [freshPrompt],
          abortController: new AbortController(),
          shouldQuery: false,
          additionalAllowedTools: [],
          mainLoopModelParam: 'claude-sonnet-4-6',
        },
        baseDeps,
      )

      // Pre-compaction messages MUST be replaced (not left after summary)
      expect(
        messagesRef.current.some(m => m.uuid === oldPreCompact1.uuid),
      ).toBe(false)
      expect(
        messagesRef.current.some(m => m.uuid === oldPreCompact2.uuid),
      ).toBe(false)
      expect(messagesRef.current[0]?.uuid).toBe(summaryRow.uuid)
      expect(
        messagesRef.current.some(
          m =>
            m.type === 'system' &&
            'content' in m &&
            m.content === IDLE_COMPACT_SUMMARIZED_MESSAGE,
        ),
      ).toBe(true)
      expect(messagesRef.current[2]?.uuid).toBe(freshPrompt.uuid)
      // Main-thread queue still has an item -> mainLoopBusy MUST stay true (no flicker)
      expect(getMainLoopBusy()).toBe(true)

      // Esc auto-restore: non-editable task-notification in queue does NOT block restore,
      // and batched turn restores BOTH user messages!
      const batch1 = createUserMessage({ content: 'first batched prompt' })
      const batch2 = createUserMessage({ content: 'second batched prompt' })
      messagesRef.current = []
      const restoredCalls: Array<{
        msg: UserMessage
        earlier?: UserMessage[]
      }> = []
      const ac = new AbortController()
      ac.abort(createAbortErrorReason('user-cancel'))
      await runReplTurn(
        {
          newMessages: [batch1, batch2],
          abortController: ac,
          shouldQuery: false,
          additionalAllowedTools: [],
          mainLoopModelParam: 'claude-sonnet-4-6',
        },
        {
          ...baseDeps,
          restoreMessageSyncRef: {
            current: (msg: UserMessage, earlier?: UserMessage[]) => {
              restoredCalls.push({ msg, earlier })
            },
          },
        },
      )
      expect(restoredCalls).toHaveLength(1)
      expect(restoredCalls[0]?.msg.uuid).toBe(batch2.uuid)
      expect(restoredCalls[0]?.earlier?.map(m => m.uuid)).toEqual([batch1.uuid])
    } finally {
      turn.dispose()
    }

    // Also verify direct helper for batched collection
    const u1 = createUserMessage({ content: 'part A' })
    const u2 = createUserMessage({ content: 'part B' })
    expect(
      collectBatchedTurnUserMessagesForRestore([u1, u2], 1, [u1, u2]).map(
        m => m.uuid,
      ),
    ).toEqual([u1.uuid])

    // Verify runReplTurn wires stripOldToolUseResultsForStorage (f4r) at turn end
    const runReplSrc = readFileSync(
      join(ROOT, 'src/screens/repl/runReplTurn.ts'),
      'utf8',
    )
    expect(runReplSrc).toContain(
      'stripOldToolUseResultsForStorage(prev, freshTools)',
    )
  })

  test('[P1-5] idleCompaction reads live currentLimits.status and subtracts autoCompactWindow.loadTokens', () => {
    // 1. Live currentLimits.status !== 'allowed' returns 'near_limit' even when ctx.rateLimitStatus is omitted
    currentLimits.status = 'rejected'
    expect(
      checkIdleCompactionEligibility(false, 0, 300_000, 1000, true, {
        autoCompactEnabled: true,
        idleCompactionEnabled: true,
        cacheTtl: '1h',
        cacheWarm: true,
        lastRequestAt: 500,
      }),
    ).toBe('near_limit')

    resetCurrentLimits()
    // 2. Subtracting autoCompactWindow.loadTokens: 250k - 180k = 70k < 100k floor -> 'small'
    expect(
      checkIdleCompactionEligibility(false, 0, 250_000, 1000, true, {
        autoCompactEnabled: true,
        idleCompactionEnabled: true,
        cacheTtl: '1h',
        cacheWarm: true,
        lastRequestAt: 500,
        autoCompactWindow: { loadTokens: 180_000 },
      }),
    ).toBe('small')

    // 300k - 150k = 150k >= 100k floor -> eligible (null)
    expect(
      checkIdleCompactionEligibility(false, 0, 300_000, 1000, true, {
        autoCompactEnabled: true,
        idleCompactionEnabled: true,
        cacheTtl: '1h',
        cacheWarm: true,
        lastRequestAt: 500,
        autoCompactWindow: { loadTokens: 150_000 },
      }),
    ).toBeNull()
  })

  test('[P1-5 + P1-16] /rewind file eviction (yNr), refusal-fallback unwind (wYe), and restoreDraft (text + non-image pastes + images)', () => {
    const keptMsg = createAssistantMessage({
      content: [
        {
          type: 'tool_use',
          id: 'r1',
          name: 'Read',
          input: { file_path: '/repo/kept.ts' },
        },
      ],
    })
    const slicedMsg = createAssistantMessage({
      content: [
        {
          type: 'tool_use',
          id: 'r2',
          name: 'Read',
          input: { file_path: '/repo/rewound-only.ts' },
        },
        {
          type: 'tool_use',
          id: 'r3',
          name: 'Read',
          input: { file_path: '/repo/kept.ts' },
        },
      ],
    })
    const slicedNestedMem = {
      type: 'attachment',
      uuid: 'att-nm',
      attachment: { type: 'nested_memory', path: '/repo/sub/CLAUDE.md' },
    } as unknown as Message

    const keptTracked = collectTrackedFilePathsFromMessages([keptMsg])
    const slicedTracked = collectTrackedFilePathsFromMessages([
      slicedMsg,
      slicedNestedMem,
    ])
    expect(keptTracked.readFilePaths.has('/repo/kept.ts')).toBe(true)
    expect(slicedTracked.readFilePaths.has('/repo/rewound-only.ts')).toBe(true)
    expect(slicedTracked.nestedMemoryPaths.has('/repo/sub/CLAUDE.md')).toBe(
      true,
    )

    // Refusal-fallback rewind unwind (wYe)
    const fallbackBanner = {
      type: 'system',
      subtype: 'model_refusal_fallback',
      fallbackModel: 'claude-sonnet-4-6',
      uuid: 'sys-fb-1',
    } as unknown as Message
    const baseOpus = createAssistantMessage({ content: 'hi' })
    const keptOpusAsst = {
      ...baseOpus,
      message: {
        ...baseOpus.message,
        model: 'claude-opus-4-6',
      },
    } as unknown as Message
    const unwind = planRewindRefusalFallbackUnwind({
      keptMessages: [keptOpusAsst],
      slicedMessages: [fallbackBanner],
      currentOverride: 'claude-sonnet-4-6',
      latchActive: true,
      firstParty: true,
      modelBeforeSwap: 'claude-opus-4-6',
      initialModel: 'claude-opus-4-6',
    })
    expect(unwind).toBeDefined()
    expect(unwind?.clearLatch).toBe(true)
    expect(unwind?.model).toEqual({
      action: 'restore',
      value: 'claude-opus-4-6',
      restoredFrom: 'transcript',
    })

    // buildRestoredDraftFromMessages restores batched text + non-image pastes + images
    const msg1 = {
      ...createUserMessage({ content: 'check [Pasted text #1]' }),
      pastedContents: {
        1: { id: 1, type: 'text' as const, content: 'pasted snippet body' },
      },
    } as UserMessage
    const msg2 = createUserMessage({
      content: [
        { type: 'text', text: 'and screenshot' },
        {
          type: 'image',
          source: { type: 'base64', media_type: 'image/png', data: 'QUJD' },
        },
      ],
      imagePasteIds: [2],
    })
    const draft = buildRestoredDraftFromMessages([msg1, msg2])
    expect(draft.text).toBe('check [Pasted text #1]\nand screenshot')
    expect(draft.mode).toBe('prompt')
    expect(draft.pastedContents[1]).toEqual({
      id: 1,
      type: 'text',
      content: 'pasted snippet body',
    })
    expect(draft.pastedContents[2]).toEqual({
      id: 2,
      type: 'image',
      content: 'QUJD',
      mediaType: 'image/png',
    })
  })

  test('[P1-10] backfillObservableInput cloned assistant message syncs usage & stop_reason via onMessageDelta', async () => {
    const backfillTool = makeSimpleTool(
      'BackfillTool',
      async () => ({ data: 'ok' }),
      {
        backfillObservableInput(input: Record<string, unknown>) {
          input.derivedFlag = true
        },
      },
    )
    const ctx = makeToolUseContext({
      options: { tools: [backfillTool] } as never,
    })

    let turnNum = 0
    const gen = query({
      messages: [createUserMessage({ content: 'run backfill tool' })],
      systemPrompt: ['sys'] as never,
      userContext: {},
      systemContext: {},
      canUseTool: async () => ({ behavior: 'allow', updatedInput: {} }),
      toolUseContext: ctx,
      querySource: 'repl_main_thread',
      deps: {
        callModel: async function* (args) {
          turnNum++
          if (turnNum === 1) {
            const srcMsg = createAssistantMessage({
              content: [
                {
                  type: 'tool_use',
                  id: 'tu-bf-1',
                  name: 'BackfillTool',
                  input: { raw: 1 },
                },
              ],
            })
            srcMsg.message.stop_reason = null
            srcMsg.message.usage = {
              input_tokens: 100,
              output_tokens: 0,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 0,
            } as AssistantMessage['message']['usage']
            yield srcMsg
            // Simulate claude.ts message_delta mutating srcMsg and calling onMessageDelta
            srcMsg.message.stop_reason = 'tool_use'
            srcMsg.message.usage = {
              input_tokens: 100,
              output_tokens: 77,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 0,
            } as AssistantMessage['message']['usage']
            args.options.onMessageDelta?.([srcMsg])
          } else {
            yield createAssistantMessage({ content: 'finished' })
          }
        },
        autocompact: async () => ({ wasCompacted: false }),
        microcompact: async msgs => ({ messages: msgs }),
        uuid: () => crypto.randomUUID(),
      },
    })

    const { events, terminal } = await drainQuery(gen)
    expect(terminal.reason).toBe('completed')
    const yieldedToolAssistant = events.find(
      (e): e is AssistantMessage =>
        typeof e === 'object' &&
        e !== null &&
        (e as { type?: string }).type === 'assistant' &&
        Array.isArray((e as AssistantMessage).message.content) &&
        (
          (e as AssistantMessage).message.content as Array<{
            type?: string
            name?: string
          }>
        ).some(b => b.type === 'tool_use' && b.name === 'BackfillTool'),
    )
    expect(yieldedToolAssistant).toBeDefined()
    const contentBlocks = yieldedToolAssistant!.message.content as Array<{
      type?: string
      input?: unknown
    }>
    const toolBlock = contentBlocks.find(
      b => b.type === 'tool_use',
    ) as ToolUseBlock
    expect((toolBlock.input as Record<string, unknown>).derivedFlag).toBe(true)
    // Synced from srcMsg via onMessageDelta (NOT stale output_tokens: 0, stop_reason: null)!
    expect(yieldedToolAssistant!.message.stop_reason).toBe('tool_use')
    expect(yieldedToolAssistant!.message.usage?.output_tokens).toBe(77)
  })

  test('[P1-12] query recovery: thinkingOnlyNudged reset on next_turn, mid-turn safety_monitor_blocked, same-model refusal_retry, and max_tokens prompts/resumeIncompleteThinking', async () => {
    // 1. selectMaxOutputTokensRecoveryPrompt picks tool_call_cut and reopen_block
    const toolCutAsst = {
      ...createAssistantMessage({ content: 'partial' }),
      toolCallCutAtOutputLimit: true,
    } as AssistantMessage
    expect(selectMaxOutputTokensRecoveryPrompt([toolCutAsst], false, 1)).toBe(
      TOOL_CALL_CUT_RECOVERY_PROMPT,
    )

    const textCutAsst = createAssistantMessage({
      content: 'Here is the code:\n```ts\nconst x = 1',
    })
    textCutAsst.message.stop_reason = 'max_tokens'
    expect(selectMaxOutputTokensRecoveryPrompt([textCutAsst], false, 1)).toBe(
      REOPEN_BLOCK_RECOVERY_PROMPT,
    )

    // 2. resumeIncompleteThinking set on max_tokens cut in resumable thinking block (no text nudge)
    const resumeFlags: Array<boolean | undefined> = []
    let resumeTurn = 0
    await drainQuery(
      query({
        messages: [createUserMessage({ content: 'think deeply' })],
        systemPrompt: ['sys'] as never,
        userContext: {},
        systemContext: {},
        canUseTool: async () => ({ behavior: 'allow', updatedInput: {} }),
        toolUseContext: makeToolUseContext(),
        querySource: 'repl_main_thread',
        deps: {
          callModel: async function* (args) {
            resumeFlags.push(args.options.resumeIncompleteThinking)
            resumeTurn++
            if (resumeTurn === 1) {
              const thinkingCut = createAssistantMessage({
                content: [
                  { type: 'thinking', thinking: 'half thought', signature: '' },
                ] as any,
              })
              thinkingCut.message.stop_reason = 'max_tokens'
              ;(
                thinkingCut.message as unknown as { resumable?: boolean }
              ).resumable = true
              yield thinkingCut
              yield createAssistantAPIErrorMessage({
                content: 'max output tokens',
                apiError: 'max_output_tokens',
              })
            } else {
              yield createAssistantMessage({ content: 'resumed answer' })
            }
          },
          autocompact: async () => ({ wasCompacted: false }),
          microcompact: async msgs => ({ messages: msgs }),
          uuid: () => crypto.randomUUID(),
        },
      }),
    )
    expect(resumeFlags).toEqual([undefined, true])

    // 3. Same-model refusal_retry retries once on the same model and succeeds
    let refusalCalls = 0
    const refusalRun = await drainQuery(
      query({
        messages: [createUserMessage({ content: 'help with security audit' })],
        systemPrompt: ['sys'] as never,
        userContext: {},
        systemContext: {},
        canUseTool: async () => ({ behavior: 'allow', updatedInput: {} }),
        toolUseContext: makeToolUseContext(),
        querySource: 'repl_main_thread',
        deps: {
          callModel: async function* () {
            refusalCalls++
            if (refusalCalls === 1) {
              const refused = createAssistantAPIErrorMessage({
                content: 'refused',
                apiError: 'refusal',
              })
              refused.message.stop_reason = 'refusal'
              yield refused
            } else {
              yield createAssistantMessage({ content: 'safe guidance' })
            }
          },
          autocompact: async () => ({ wasCompacted: false }),
          microcompact: async msgs => ({ messages: msgs }),
          uuid: () => crypto.randomUUID(),
        },
      }),
    )
    expect(refusalCalls).toBe(2)
    expect(refusalRun.terminal.reason).toBe('completed')

    // 4. Mid-turn safety_monitor_blocked with needsFollowUp emits synthetic tool_result & exits api_error
    const slowTool = makeSimpleTool(
      'SlowOp',
      async () => {
        await new Promise(r => setTimeout(r, 50))
        return { data: 'done' }
      },
      { isConcurrencySafe: () => false },
    )
    const safetyRun = await drainQuery(
      query({
        messages: [createUserMessage({ content: 'do op' })],
        systemPrompt: ['sys'] as never,
        userContext: {},
        systemContext: {},
        canUseTool: async () => ({ behavior: 'allow', updatedInput: {} }),
        toolUseContext: makeToolUseContext({
          options: { tools: [slowTool] } as never,
        }),
        querySource: 'repl_main_thread',
        deps: {
          callModel: async function* () {
            yield createAssistantMessage({
              content: [
                {
                  type: 'tool_use',
                  id: 'tu-safe-1',
                  name: 'SlowOp',
                  input: {},
                },
              ],
            })
            yield createAssistantAPIErrorMessage({
              content: 'Blocked by safety monitor',
              apiError: 'safety_monitor_blocked',
            })
          },
          autocompact: async () => ({ wasCompacted: false }),
          microcompact: async msgs => ({ messages: msgs }),
          uuid: () => crypto.randomUUID(),
        },
      }),
    )
    expect(safetyRun.terminal.reason).toBe('api_error')
    expect(
      safetyRun.events.some(
        e =>
          typeof e === 'object' &&
          e !== null &&
          (e as { type?: string }).type === 'user' &&
          Array.isArray((e as UserMessage).message.content) &&
          (
            (e as UserMessage).message.content as Array<{
              type?: string
              tool_use_id?: string
              is_error?: boolean
            }>
          ).some(
            b =>
              b.type === 'tool_result' &&
              b.tool_use_id === 'tu-safe-1' &&
              b.is_error === true,
          ),
      ),
    ).toBe(true)

    // 5. thinkingOnlyNudged resets to false on next_turn & two-pass reactiveCompactDeeperPass exists
    const querySrc = readFileSync(join(ROOT, 'src/query.ts'), 'utf8')
    const nextTurnIdx = querySrc.lastIndexOf(
      "transition: { reason: 'next_turn' }",
    )
    expect(nextTurnIdx).toBeGreaterThan(0)
    const nextTurnSlice = querySrc.slice(nextTurnIdx - 500, nextTurnIdx + 60)
    expect(nextTurnSlice).toContain('thinkingOnlyNudged: false')
    expect(querySrc).toContain('reactiveCompactDeeperPass')
  })

  test('[P1-17] saveCacheSafeParams works under custom output styles (repl_main_thread:*) and skips subagents', async () => {
    const mainCtx = makeToolUseContext()
    const gen1 = handleStopHooks(
      [createUserMessage({ content: 'hello' })],
      [createAssistantMessage({ content: 'world' })],
      ['sys'] as never,
      {},
      {},
      mainCtx,
      'repl_main_thread:outputStyle:concise' as never,
    )
    for await (const _ of gen1) {
      // drain
    }
    expect(getLastCacheSafeParams()).not.toBeNull()

    saveCacheSafeParams(null)
    const subCtx = makeToolUseContext({ agentId: 'subagent-123' as never })
    const gen2 = handleStopHooks(
      [createUserMessage({ content: 'hello' })],
      [createAssistantMessage({ content: 'world' })],
      ['sys'] as never,
      {},
      {},
      subCtx,
      'repl_main_thread:outputStyle:concise' as never,
    )
    for await (const _ of gen2) {
      // drain
    }
    expect(getLastCacheSafeParams()).toBeNull()
  })

  test('[P2-10, P2-11, P2-12, P2-13] goal-only tools, StreamingToolExecutor always on, remote-cancel synthetic results, stopHooks impossible/paused/toast, mcpEndTurnOverrideSpent, and PostToolBatch reactions', async () => {
    // P2-10: isGoalToolsOnly
    const makeBlock = (id: string, name: string): ToolUseBlock =>
      ({ type: 'tool_use', id, name, input: {} }) as ToolUseBlock
    expect(
      isGoalToolsOnly([makeBlock('1', 'SetGoal'), makeBlock('2', 'PauseGoal')]),
    ).toBe(true)
    expect(
      isGoalToolsOnly([makeBlock('1', 'SetGoal'), makeBlock('2', 'Bash')]),
    ).toBe(false)
    expect(isGoalToolsOnly([])).toBe(false)

    // P2-11: buildQueryConfig always enables streamingToolExecution
    expect(buildQueryConfig().gates.streamingToolExecution).toBe(true)

    // P2-11: remote-cancel still yields synthetic tool_result for aborted tool_use
    const slowTool = makeSimpleTool('RemoteSlow', async () => {
      await new Promise(r => setTimeout(r, 200))
      return { data: 'late' }
    })
    const remoteAc = new AbortController()
    const remoteRun = await drainQuery(
      query({
        messages: [createUserMessage({ content: 'run slow' })],
        systemPrompt: ['sys'] as never,
        userContext: {},
        systemContext: {},
        canUseTool: async () => ({ behavior: 'allow', updatedInput: {} }),
        toolUseContext: makeToolUseContext({
          abortController: remoteAc,
          options: { tools: [slowTool] } as never,
        }),
        querySource: 'sdk',
        deps: {
          callModel: async function* () {
            yield createAssistantMessage({
              content: [
                {
                  type: 'tool_use',
                  id: 'tu-rc-1',
                  name: 'RemoteSlow',
                  input: {},
                },
              ],
            })
            remoteAc.abort(createAbortErrorReason('remote-cancel'))
          },
          autocompact: async () => ({ wasCompacted: false }),
          microcompact: async msgs => ({ messages: msgs }),
          uuid: () => crypto.randomUUID(),
        },
      }),
    )
    expect(remoteRun.terminal.reason).toBe('aborted_streaming')
    expect(
      remoteRun.events.some(
        e =>
          typeof e === 'object' &&
          e !== null &&
          (e as { type?: string }).type === 'user' &&
          Array.isArray((e as UserMessage).message.content) &&
          (
            (e as UserMessage).message.content as Array<{
              type?: string
              tool_use_id?: string
            }>
          ).some(b => b.type === 'tool_result' && b.tool_use_id === 'tu-rc-1'),
      ),
    ).toBe(true)

    // P2-12: handleStopHooks suppresses error toast on stopHookActive, respects impossible & paused, passes toolUseContext to executeTeammateIdleHooks
    const notifications: Array<{ key: string }> = []
    const stopCtx = makeToolUseContext({
      addNotification: n => notifications.push({ key: n.key }),
    })
    const sid = getSessionId()
    addFunctionHook(
      stopCtx.setAppState,
      sid,
      'Stop',
      '',
      () => false,
      'error from hook',
    )

    // With stopHookActive: true -> toast suppressed
    for await (const _ of handleStopHooks(
      [createUserMessage({ content: 'hi' })],
      [createAssistantMessage({ content: 'yo' })],
      ['sys'] as never,
      {},
      {},
      stopCtx,
      'repl_main_thread',
      true,
    )) {
      // drain
    }
    expect(notifications.filter(n => n.key === 'stop-hook-error')).toHaveLength(
      0,
    )

    const stopHooksSrc = readFileSync(
      join(ROOT, 'src/query/stopHooks.ts'),
      'utf8',
    )
    expect(stopHooksSrc).toContain(
      "goalPass = result.impossible ? 'impossible' : 'met'",
    )
    expect(stopHooksSrc).toContain('failed: true,')
    expect(stopHooksSrc).toContain(
      '(liveGoalForPause as { paused?: boolean }).paused === true',
    )
    expect(stopHooksSrc).toContain(
      'executeTeammateIdleHooks(\n        teammateName,\n        teamName,\n        permissionMode,\n        toolUseContext.abortController.signal,\n        undefined,\n        toolUseContext,',
    )

    // P2-13: mcpEndTurnOverrideSpent allows Stop hook block to override MCP endTurn at most once
    const mcpTool = makeSimpleTool('mcp__demo__finish', async () => ({
      data: 'done',
      mcpMeta: { _meta: { 'claude/endTurn': true } },
    }))
    const mcpCtx = makeToolUseContext({
      options: { tools: [mcpTool] } as never,
    })
    addFunctionHook(
      mcpCtx.setAppState,
      sid,
      'Stop',
      '',
      () => false,
      'verify once more',
    )
    let mcpModelCalls = 0
    const mcpRun = await drainQuery(
      query({
        messages: [createUserMessage({ content: 'finish task' })],
        systemPrompt: ['sys'] as never,
        userContext: {},
        systemContext: {},
        canUseTool: async () => ({ behavior: 'allow', updatedInput: {} }),
        toolUseContext: mcpCtx,
        querySource: 'repl_main_thread',
        deps: {
          callModel: async function* () {
            mcpModelCalls++
            yield createAssistantMessage({
              content: [
                {
                  type: 'tool_use',
                  id: `tu-mcp-${mcpModelCalls}`,
                  name: 'mcp__demo__finish',
                  input: {},
                },
              ],
            })
          },
          autocompact: async () => ({ wasCompacted: false }),
          microcompact: async msgs => ({ messages: msgs }),
          uuid: () => crypto.randomUUID(),
        },
      }),
    )
    // First MCP endTurn overridden once by Stop hook -> second MCP endTurn ends turn!
    expect(mcpModelCalls).toBe(2)
    expect(mcpRun.terminal.reason).toBe('completed')

    // PostToolBatch stop uses runTurnEndReactions instead of handleStopHooks
    const querySrc = readFileSync(join(ROOT, 'src/query.ts'), 'utf8')
    const ptbIdx = querySrc.indexOf('if (postBatchStopped) {')
    expect(ptbIdx).toBeGreaterThan(0)
    const ptbBlock = querySrc.slice(ptbIdx, ptbIdx + 700)
    expect(ptbBlock).toContain('yield* runTurnEndReactions(')
    expect(ptbBlock).not.toContain('yield* handleStopHooks(')
  })

  test('[P2-14] TranscriptProjection.applyMessageOp supports insert-after-uuid and held/flush semantics, and runReplTurn wires stale title cancellation', () => {
    const store = createStore(getDefaultAppState())
    const m1 = createUserMessage({ content: 'first' })
    const m2 = createAssistantMessage({ content: 'second' })
    const inserted = createAssistantMessage({ content: 'inserted-after-first' })
    const heldMsg = createUserMessage({ content: 'held-row' })

    const proj = new TranscriptProjection({ store, initialMessages: [m1, m2] })
    let notifications = 0
    proj.subscribe(() => {
      notifications++
    })

    // insert-after-uuid immediate
    proj.applyMessageOp({
      type: 'insert-after-uuid',
      uuid: m1.uuid,
      messages: [inserted],
    })
    expect(proj.getSnapshot().map(m => m.uuid)).toEqual([
      m1.uuid,
      inserted.uuid,
      m2.uuid,
    ])
    expect(notifications).toBe(1)

    // held mode updates live snapshot without publishing to subscribers or getPublished()
    proj.applyMessageOp({ type: 'append', messages: [heldMsg] }, 'held')
    expect(proj.getSnapshot().map(m => m.uuid)).toEqual([
      m1.uuid,
      inserted.uuid,
      m2.uuid,
      heldMsg.uuid,
    ])
    expect(proj.getPublished().map(m => m.uuid)).toEqual([
      m1.uuid,
      inserted.uuid,
      m2.uuid,
    ])
    expect(notifications).toBe(1)

    // Non-force flush leaves pure 'held' unpublished; force flush publishes it
    proj.flush()
    expect(notifications).toBe(1)
    proj.flush(true)
    expect(notifications).toBe(2)
    expect(proj.getPublished().map(m => m.uuid)).toEqual([
      m1.uuid,
      inserted.uuid,
      m2.uuid,
      heldMsg.uuid,
    ])

    // Verify stale title cancellation ref in runReplTurn + REPL
    const runReplSrc = readFileSync(
      join(ROOT, 'src/screens/repl/runReplTurn.ts'),
      'utf8',
    )
    const replSrc = readFileSync(join(ROOT, 'src/screens/REPL.tsx'), 'utf8')
    expect(runReplSrc).toContain('if (getActiveTitleReq() !== reqEntry) return')
    expect(replSrc).toContain('titleRequestRef')
  })
})
