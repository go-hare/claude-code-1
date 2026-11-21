/**
 * Wave 2B regression tests — TurnController (xBe streaming + keepReply),
 * SubmitController (single history write + live loading state), runReplTurn
 * (abort reason fidelity, auto-restore, generation-guarded left-arrow toast),
 * and REPL.tsx engine/CodeMode wiring.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHostEngine } from '../../../engine/hostEngine.js'
import {
  getDefaultAppState,
  type AppState,
} from '../../../state/AppStateStore.js'
import { createStore } from '../../../state/store.js'
import type { Message, UserMessage } from '../../../types/message.js'
import { createAbortErrorReason } from '../../../utils/abortController.js'
import { LEFT_ARROW_STOPPED_TURN_TOAST } from '../../../utils/leftArrowConfirm.js'
import {
  createMessageQueue,
  resetCommandQueue,
} from '../../../utils/messageQueueManager.js'
import { createUserMessage } from '../../../utils/messages.js'
import { SubmitController, type SubmitPromptDeps } from '../SubmitController.js'
import { TurnController } from '../TurnController.js'
import {
  runReplTurn,
  type DispatchReplStreamEventDeps,
  type RunReplTurnDeps,
} from '../runReplTurn.js'

afterEach(() => {
  resetCommandQueue()
})

function createTurn(initialLoading = false): TurnController {
  const store = createStore({ tasks: {} } as AppState)
  return new TurnController({ store, initialLoading })
}

describe('Wave 2B TurnController streaming & keepReply (2.1.328 xBe)', () => {
  test('event.type === assistant clears awaiting-response ONLY and keeps isMainResponseStreaming true', () => {
    const turn = createTurn()
    const responseLengthRef = { current: 0 }
    const baseDeps = {
      responseLengthRef,
      apiMetricsRef: { current: [] },
      messagesRef: { current: [] },
      setMessages: () => {},
      setConversationId: () => {},
      setAppState: () => {},
      streamingDisplayStore: {
        getState: () => ({ salvage: null, exact: false }),
        setSalvage: () => {},
      },
      salvageRef: { current: null },
      refusalReplacesUuidsRef: { current: null },
      clearStreamingText: () => {},
      pipeReturnHadErrorRef: { current: false },
      relayPipeMessage: () => {},
      setResponseLength: (f: (prev: number) => number) => {
        responseLengthRef.current = f(responseLengthRef.current)
      },
      setStreamMode: turn.setStreamMode,
      setStreamingToolUses: turn.setStreamingToolUses,
      setStreamingThinking: turn.setStreamingThinking,
      onStreamingText: () => {},
      displayTransform: {
        begin: () => {},
        delta: () => {},
        entryLanded: () => {},
        finalize: () => {},
      },
      setInProgressToolUseIDs: () => {},
      addNotification: () => {},
    } as unknown as Omit<DispatchReplStreamEventDeps, 'event'>

    try {
      turn.noteMainRequestAnnounced()
      expect(turn.isMainRequestAwaitingResponse).toBe(true)
      expect(turn.isMainResponseStreaming).toBe(false)

      // Main stream starts -> awaiting=false, streaming=true
      turn.dispatchStreamEvent({
        ...baseDeps,
        event: {
          type: 'stream_event',
          ttftMs: 12,
          event: { type: 'message_start', message: { id: 'msg-1' } },
        } as DispatchReplStreamEventDeps['event'],
      })
      expect(turn.isMainRequestAwaitingResponse).toBe(false)
      expect(turn.isMainResponseStreaming).toBe(true)

      // Per-block assistant message emitted after thinking block while text is still streaming
      turn.dispatchStreamEvent({
        ...baseDeps,
        event: {
          type: 'assistant',
          uuid: 'a-thinking',
          message: {
            id: 'msg-1',
            role: 'assistant',
            content: [{ type: 'thinking', thinking: 'hmm', signature: 'sig' }],
          },
        } as unknown as DispatchReplStreamEventDeps['event'],
      })
      expect(turn.isMainRequestAwaitingResponse).toBe(false)
      expect(turn.isMainResponseStreaming).toBe(true)

      // message_delta / end clears streaming
      turn.dispatchStreamEvent({
        ...baseDeps,
        event: {
          type: 'stream_event',
          event: { type: 'message_delta', usage: { output_tokens: 42 } },
        } as DispatchReplStreamEventDeps['event'],
      })
      expect(turn.isMainResponseStreaming).toBe(false)
    } finally {
      turn.dispose()
    }
  })

  test('subagent api_metrics (id != null) cannot corrupt main isMainResponseStreaming', () => {
    const turn = createTurn()
    const responseLengthRef = { current: 0 }
    const baseDeps = {
      responseLengthRef,
      apiMetricsRef: { current: [] },
      setResponseLength: (f: (prev: number) => number) => {
        responseLengthRef.current = f(responseLengthRef.current)
      },
      setStreamMode: turn.setStreamMode,
      setStreamingToolUses: turn.setStreamingToolUses,
      setStreamingThinking: turn.setStreamingThinking,
      onStreamingText: () => {},
      displayTransform: {
        begin: () => {},
        delta: () => {},
        entryLanded: () => {},
        finalize: () => {},
      },
    } as unknown as Omit<DispatchReplStreamEventDeps, 'event'>

    try {
      // Subagent start while main is idle MUST NOT flip main streaming to true
      turn.dispatchStreamEvent({
        ...baseDeps,
        event: {
          type: 'api_metrics',
          event: { type: 'start', id: 'subagent-1', ttftMs: 5 },
        } as unknown as DispatchReplStreamEventDeps['event'],
      })
      expect(turn.isMainResponseStreaming).toBe(false)

      // Main start flips streaming to true
      turn.dispatchStreamEvent({
        ...baseDeps,
        event: {
          type: 'stream_event',
          ttftMs: 10,
          event: { type: 'message_start', message: { id: 'msg-main' } },
        } as DispatchReplStreamEventDeps['event'],
      })
      expect(turn.isMainResponseStreaming).toBe(true)

      // Subagent end MUST NOT flip main streaming to false
      turn.dispatchStreamEvent({
        ...baseDeps,
        event: {
          type: 'api_metrics',
          event: { type: 'end', id: 'subagent-1', outputTokens: 99 },
        } as unknown as DispatchReplStreamEventDeps['event'],
      })
      expect(turn.isMainResponseStreaming).toBe(true)

      // Main end flips streaming to false
      turn.dispatchStreamEvent({
        ...baseDeps,
        event: {
          type: 'api_metrics',
          event: { type: 'end', outputTokens: 20 },
        } as unknown as DispatchReplStreamEventDeps['event'],
      })
      expect(turn.isMainResponseStreaming).toBe(false)
    } finally {
      turn.dispose()
    }
  })

  test('noteMainRequestAnnounced calls keepSpinnerReply so subsequent non-streamed replies accumulate tokens', () => {
    const turn = createTurn()
    const responseLengthRef = { current: 0 }
    turn.bindResponseLengthRef(responseLengthRef)
    const baseDeps = {
      responseLengthRef,
      apiMetricsRef: { current: [] },
      messagesRef: { current: [] },
      setMessages: () => {},
      setConversationId: () => {},
      setAppState: () => {},
      streamingDisplayStore: {
        getState: () => ({ salvage: null, exact: false }),
        setSalvage: () => {},
      },
      salvageRef: { current: null },
      refusalReplacesUuidsRef: { current: null },
      clearStreamingText: () => {},
      pipeReturnHadErrorRef: { current: false },
      relayPipeMessage: () => {},
      setResponseLength: (f: (prev: number) => number) => {
        responseLengthRef.current = f(responseLengthRef.current)
      },
      setStreamMode: turn.setStreamMode,
      setStreamingToolUses: turn.setStreamingToolUses,
      setStreamingThinking: turn.setStreamingThinking,
      onStreamingText: () => {},
      displayTransform: {
        begin: () => {},
        delta: () => {},
        entryLanded: () => {},
        finalize: () => {},
      },
      setInProgressToolUseIDs: () => {},
      addNotification: () => {},
    } as unknown as Omit<DispatchReplStreamEventDeps, 'event'>

    try {
      // Reply 1: non-streamed assistant with 100 output tokens -> 400 chars
      turn.dispatchStreamEvent({
        ...baseDeps,
        event: {
          type: 'assistant',
          uuid: 'a-1',
          message: {
            id: 'm-1',
            role: 'assistant',
            stop_reason: 'tool_use',
            usage: { output_tokens: 100 },
            content: [{ type: 'text', text: 'step 1' }],
          },
        } as unknown as DispatchReplStreamEventDeps['event'],
      })
      expect(responseLengthRef.current).toBe(400)

      // External engine announces next request via system/status(requesting)
      turn.noteMainRequestAnnounced()

      // Reply 2: non-streamed assistant with 50 output tokens -> must ADD 200 to kept 400 = 600
      turn.dispatchStreamEvent({
        ...baseDeps,
        event: {
          type: 'assistant',
          uuid: 'a-2',
          message: {
            id: 'm-2',
            role: 'assistant',
            stop_reason: 'end_turn',
            usage: { output_tokens: 50 },
            content: [{ type: 'text', text: 'step 2' }],
          },
        } as unknown as DispatchReplStreamEventDeps['event'],
      })
      expect(responseLengthRef.current).toBe(600)
    } finally {
      turn.dispose()
    }
  })
})

describe('Wave 2B runReplTurn abort fidelity, auto-restore, and left-arrow guard', () => {
  test.each([
    ['user-cancel', true],
    [createAbortErrorReason('user-cancel'), true],
    ['refusal-fallback-edit', true],
    [createAbortErrorReason('refusal-fallback-edit'), true],
    ['background', false],
    ['interrupt', false],
  ])('auto-restore in runReplTurn finally for reason %p -> expected %s', async (reason, shouldRestore) => {
    const store = createStore({ tasks: {} } as AppState)
    const turn = new TurnController({ store })
    const ac = new AbortController()
    const userMsg = createUserMessage({ content: 'restore me' })
    const messagesRef = { current: [] as Message[] }
    const restored: UserMessage[] = []

    const ok = await runReplTurn(
      {
        newMessages: [userMsg],
        abortController: ac,
        shouldQuery: false,
        additionalAllowedTools: [],
        mainLoopModelParam: 'claude-opus-5',
        input: 'restore me',
        onBeforeQueryCallback: async () => {
          ac.abort(reason)
          return false
        },
      },
      {
        store,
        queryGuard: turn.guard,
        pipeReturnHadErrorRef: { current: false },
        relayPipeMessage: () => {},
        resetTimingRefs: () => {},
        setMessages: (
          action: Parameters<RunReplTurnDeps['setMessages']>[0],
        ) => {
          messagesRef.current =
            typeof action === 'function' ? action(messagesRef.current) : action
        },
        messagesRef,
        responseLengthRef: { current: 0 },
        apiMetricsRef: { current: [] },
        setStreamingToolUses: () => {},
        clearStreamingText: () => {},
        displayTransform: { newTurn: () => {} },
        mrOnBeforeQuery: async () => {},
        mrOnTurnComplete: async () => {},
        setLastQueryCompletionTime: () => {},
        resetLoadingState: () => {},
        sendBridgeResultRef: { current: () => {} },
        setAppState: () => {},
        loadingStartTimeRef: { current: 0 },
        totalPausedMsRef: { current: 0 },
        proactiveActive: false,
        swarmStartTimeRef: { current: null },
        swarmBudgetInfoRef: { current: undefined },
        backgroundWaitStartTimeRef: { current: null },
        setAbortController: () => {},
        inputValueRef: { current: '' },
        restoreMessageSyncRef: {
          current: (m: UserMessage) => restored.push(m),
        },
      } as unknown as RunReplTurnDeps,
    )

    expect(ok).toBe(true)
    expect(restored.length === 1).toBe(shouldRestore)
    turn.dispose()
  })

  test('runReplTurn never attaches a blind user-cancel interrupt listener and guards left-arrow toast by generation', () => {
    const src = readFileSync(join(import.meta.dir, '../runReplTurn.ts'), 'utf8')
    const codeOnly = src.replace(/\/\/.*$/gm, '')
    expect(codeOnly).not.toContain("hostEngine.interrupt('user-cancel')")
    expect(codeOnly).toContain('deps.queryGuard.generation === thisGeneration')
    expect(codeOnly).toContain(
      "getAbortReasonMessage(abortController.signal.reason) !== 'background'",
    )
    expect(codeOnly).toContain(
      "abortReason === 'user-cancel' ||\n        abortReason === 'refusal-fallback-edit'",
    )
  })
})

describe('Wave 2B SubmitController synchronous loading & single history write (2.1.328)', () => {
  test('reads live turnController.isLoading instead of stale React closure deps.isLoading', async () => {
    const store = createStore(getDefaultAppState())
    const turn = new TurnController({ store })
    const queue = createMessageQueue()
    const submit = new SubmitController({
      store,
      turnController: turn,
      messageQueue: queue,
      queryGuard: turn.guard,
    })

    // Simulate Esc having already cleared loading synchronously while React
    // closure still holds stale deps.isLoading = true, isExternalLoading = true.
    expect(turn.isLoading).toBe(false)
    let clearedInput = false
    let submitCount = 0
    let onQueryCalled = false

    const deps: SubmitPromptDeps = {
      isLoading: true, // STALE React closure!
      isExternalLoading: true, // STALE React closure!
      inputMode: 'prompt',
      commands: [],
      mainLoopModel: 'claude-opus-5',
      pastedContents: {},
      ideSelection: undefined,
      stashedPrompt: undefined,
      getAbortController: () => turn.abortController,
      getCurrentInput: () => 'fresh prompt',
      getMessages: () => [],
      getStreamMode: () => 'responding',
      getHasInterruptibleToolInProgress: () => false,
      onResetTipPickedThisTurn: () => {},
      queuedNowLowLatencyHost: {
        sendQueuedNow: () => {},
        onCancel: () => {},
      } as unknown as SubmitPromptDeps['queuedNowLowLatencyHost'],
      activeRemote: {
        isRemoteMode: false,
        sendMessage: async () => {},
      },
      querySource: 'repl_main_thread',
      readFileState: { current: new Map() as any },
      setAppState: () => {},
      setMessages: () => {},
      setInputValue: v => {
        if (v === '') clearedInput = true
      },
      setInputMode: () => {},
      setPastedContents: () => {},
      setIDESelection: () => {},
      setSubmitCount: updater => {
        submitCount =
          typeof updater === 'function' ? updater(submitCount) : updater
      },
      setUserInputOnProcessing: () => {},
      setStashedPrompt: () => {},
      setToolJSX: () => {},
      setAbortControllerForQuery: turn.setAbortController,
      addNotification: () => {},
      getToolUseContext: (_m, _n, ac) =>
        ({
          abortController: ac,
          getAppState: () => store.getState(),
          setAppState: () => {},
          setToolPermissionContext: () => {},
          readFileState: new Map(),
          messages: [],
          nestedMemoryAttachmentTriggers: [],
          options: {
            commands: [],
            tools: [],
            mainLoopModel: 'claude-opus-5',
            isNonInteractiveSession: false,
            debug: false,
            verbose: false,
            agentDefinitions: { activeAgents: [], allAgents: [] },
          },
        }) as any,
      onQuery: async () => {
        onQueryCalled = true
        return true
      },
      onBeforeQuery: undefined,
      canUseTool: async () => ({ behavior: 'allow', updatedInput: {} }),
      repinScroll: () => {},
      routeToSelectedPipes: () => false,
      onClearSubmitted: () => {},
      resetTimingRefs: () => {},
      consumeIdeSelection: () => {},
      recordIdeSelectionConsumedBy: () => {},
      restoreIdeSelectionConsumedBy: () => {},
      restoreHandedBackPrompt: () => {},
    }

    try {
      await submit.submit(
        'fresh prompt',
        {
          setCursorOffset: () => {},
          clearBuffer: () => {},
          resetHistory: () => {},
        },
        deps,
      )
      // Must have submitted immediately (not queued due to stale deps.isLoading/isExternalLoading)
      expect(clearedInput).toBe(true)
      expect(submitCount).toBe(1)
      expect(onQueryCalled).toBe(true)
      expect(queue.getCommands()).toHaveLength(0)
    } finally {
      submit.dispose()
      turn.dispose()
    }
  })

  test('SubmitController does not eagerly call addToHistory for local turns or read stale deps.isLoading', () => {
    const src = readFileSync(
      join(import.meta.dir, '../SubmitController.ts'),
      'utf8',
    )
    const codeOnly = src.replace(/\/\/.*$/gm, '')
    expect(codeOnly).not.toContain('deps.isLoading')
    expect(codeOnly).not.toContain('deps.isExternalLoading')
    expect(codeOnly).not.toContain(
      'if (submitsNow && historyEntry) {\n      addToHistory(historyEntry)',
    )
  })
})

describe('Wave 2B REPL.tsx engine & CodeMode wiring (2.1.328)', () => {
  test('REPL.tsx preserves abort reasons, back-propagates refusal-fallback-edit, cleans listeners, delegates result envelope to hostEngine, and wires CodeMode resume + linger', () => {
    const replSrc = readFileSync(
      join(import.meta.dir, '../../REPL.tsx'),
      'utf8',
    )
    // P0-1: abort reason preservation + refusal-fallback-edit back-propagation + cleanup
    expect(replSrc).toContain(
      "getAbortReasonMessage(abortController.signal.reason) === 'refusal-fallback-edit'",
    )
    expect(replSrc).toContain(
      "externalAc?.signal.removeEventListener('abort', onExternalAbort)",
    )
    expect(replSrc).toContain(
      "abortController.signal.removeEventListener('abort', onEngineAbort)",
    )
    expect(replSrc).toContain("hostEngine.interrupt('user-cancel')")
    expect(replSrc).toContain("hostEngine.interrupt('remote-cancel')")

    // P0-2: REPL runTurn no longer synthesizes result before throw
    expect(replSrc).not.toContain(
      "subtype: reason === 'completed' ? 'success' : 'error'",
    )
    expect(replSrc).not.toContain("is_error: reason !== 'completed'")

    // P1-#2: TurnController responseLengthRef binding for keepReply
    expect(replSrc).toContain(
      'turnController.bindResponseLengthRef(responseLengthRef)',
    )

    // Wave 1B follow-ups: endMainThreadConversation on resume + lingerForAsyncReplEvents
    expect(replSrc).not.toContain('clearCodeModeVmSession(')
    expect(replSrc).toContain(
      "endMainThreadConversation('another conversation was resumed', keepToolUseIds",
    )
    expect(replSrc).toContain(
      'bringBackRewound(REPL_MAIN_THREAD_KEY, resumedToolUseIds)',
    )
    expect(replSrc).toContain('await lingerForAsyncReplEvents({')
    void LEFT_ARROW_STOPPED_TURN_TOAST
    void createHostEngine
  })
})
