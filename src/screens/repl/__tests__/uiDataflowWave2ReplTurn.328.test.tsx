import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getMainThreadAgentId } from '../../../bootstrap/state.js';
import { hostParkToSuppressReason } from '../../../dialog/hostPark.js';
import { nhtHidesPromptInput } from '../../../dialog/nhtPrompt.js';
import { StreamingToolExecutor } from '../../../services/tools/StreamingToolExecutor.js';
import { getDefaultAppState } from '../../../state/AppStateStore.js';
import { createStore } from '../../../state/store.js';
import { getEmptyToolPermissionContext, type Tool, type ToolUseContext } from '../../../Tool.js';
import type { Message } from '../../../types/message.js';
import { createMessageQueue, getCommandQueue, resetCommandQueue } from '../../../utils/messageQueueManager.js';
import { runWithAgentContext } from '../../../utils/agentContext.js';
import { createAssistantMessage, createUserMessage } from '../../../utils/messages.js';
import { stripCommandAllowedToolsForBackgroundAgent } from '../../../utils/permissions/permissions.js';
import { clearCommandScopedAllowRules } from '../../../utils/permissions/permissionSetup.js';
import { ScrollPin } from '../../../utils/scrollPin.js';
import { IDLE_RETURN_MIN_MS, IdleCompactionRunner, getIdleCompactionRunner } from '../idleCompaction.js';
import { type RunReplTurnDeps, runReplTurn } from '../runReplTurn.js';
import { SubmitController, type SubmitPromptDeps } from '../SubmitController.js';
import { TranscriptProjection } from '../TranscriptProjection.js';
import { TurnController } from '../TurnController.js';

const ROOT = join(import.meta.dir, '../../../..');

function readModuleTree(entryPath: string, subDir: string): string {
  return [
    readFileSync(entryPath, 'utf8'),
    ...readdirSync(subDir)
      .filter(f => /\.(ts|tsx)$/.test(f) && !f.includes('.test.'))
      .sort()
      .map(f => readFileSync(join(subDir, f), 'utf8')),
  ].join('\n');
}

function makeSubmitDeps(
  store: ReturnType<typeof createStore<ReturnType<typeof getDefaultAppState>>>,
  turn: TurnController,
  overrides: Partial<SubmitPromptDeps> = {},
): SubmitPromptDeps {
  return {
    isLoading: false,
    isExternalLoading: false,
    inputMode: 'prompt',
    commands: [],
    mainLoopModel: 'claude-opus-5',
    pastedContents: {},
    ideSelection: undefined,
    stashedPrompt: undefined,
    getAbortController: () => turn.abortController,
    getCurrentInput: () => '',
    getMessages: () => [],
    getStreamMode: () => 'responding',
    getHasInterruptibleToolInProgress: () => false,
    onResetTipPickedThisTurn: () => {},
    queuedNowLowLatencyHost: {
      sendQueuedNow: () => false,
      dispose: () => {},
    } as unknown as SubmitPromptDeps['queuedNowLowLatencyHost'],
    activeRemote: {
      isRemoteMode: false,
      sendMessage: async () => {},
    },
    querySource: 'repl_main_thread',
    readFileState: { current: new Map() as any },
    setAppState: updater => {
      store.setState(prev => (typeof updater === 'function' ? updater(prev) : updater));
    },
    setMessages: () => {},
    setInputValue: () => {},
    setInputMode: () => {},
    setPastedContents: () => {},
    setIDESelection: () => {},
    setSubmitCount: () => {},
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
    onQuery: async () => true,
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
    ...overrides,
  };
}

const NOOP_HELPERS = {
  setCursorOffset: () => {},
  clearBuffer: () => {},
  resetHistory: () => {},
};

describe('UI Data-Flow Wave 2 — REPL / Turn Engine / SubmitController regressions', () => {
  beforeEach(() => {
    resetCommandQueue();
  });

  afterEach(() => {
    resetCommandQueue();
  });

  test('P0-D2-1: mid-turn plain Enter & queueSubmit queue with next priority and NEVER call sendQueuedNow or abort', async () => {
    const store = createStore(getDefaultAppState());
    const turn = new TurnController({ store });
    const queue = createMessageQueue();
    const submit = new SubmitController({
      store,
      turnController: turn,
      messageQueue: queue,
      queryGuard: turn.guard,
    });

    const liveAc = new AbortController();
    turn.setAbortController(liveAc);
    expect(turn.guard.tryStart()).not.toBeNull();

    const sendQueuedNowCalls: Array<string | undefined> = [];
    const deps = makeSubmitDeps(store, turn, {
      queuedNowLowLatencyHost: {
        sendQueuedNow: (id: string | undefined) => {
          sendQueuedNowCalls.push(id);
          return true;
        },
        dispose: () => {},
      } as unknown as SubmitPromptDeps['queuedNowLowLatencyHost'],
    });

    try {
      // Plain mid-turn Enter
      await submit.submit('follow-up 1', NOOP_HELPERS, deps);
      expect(sendQueuedNowCalls).toEqual([]);
      expect(liveAc.signal.aborted).toBe(false);
      expect(getCommandQueue()).toHaveLength(1);
      expect(getCommandQueue()[0]?.priority).not.toBe('now');

      // Explicit chat:queueSubmit (Ctrl+X Enter)
      await submit.submit('follow-up 2', NOOP_HELPERS, deps, undefined, {
        queueSubmit: true,
      });
      expect(sendQueuedNowCalls).toEqual([]);
      expect(liveAc.signal.aborted).toBe(false);
      expect(getCommandQueue()).toHaveLength(2);
      expect(getCommandQueue()[1]?.priority).toBe('next');

      // Non-empty chat:sendNow enqueues with 'next' (not synchronous 'now' hard-abort)
      // and then triggers low-latency sendQueuedNow
      await submit.submit('urgent follow-up', NOOP_HELPERS, deps, undefined, {
        sendNow: true,
      });
      expect(getCommandQueue()).toHaveLength(3);
      expect(getCommandQueue()[2]?.priority).toBe('next');
      expect(sendQueuedNowCalls).toEqual([undefined]);
      expect(liveAc.signal.aborted).toBe(false);

      // Empty chat:sendNow triggers sendQueuedNow directly without adding a queue entry
      await submit.submit('', NOOP_HELPERS, deps, undefined, {
        sendNow: true,
      });
      expect(getCommandQueue()).toHaveLength(3);
      expect(sendQueuedNowCalls).toEqual([undefined, undefined]);

      // P1-7: chat:sendNow with sendQueuedOnly: true MUST take the queued-only
      // fast path even when deps.pastedContents still holds a pasted image
      // (e.g., queueEditIndex !== null or named_agent post-onAgentSubmit).
      let queryCalledWithStaleImage = false;
      const depsWithPastedImage = makeSubmitDeps(store, turn, {
        pastedContents: {
          1: {
            id: 1,
            type: 'image',
            content: 'ZmFrZQ==',
            mediaType: 'image/png',
          },
        },
        onQuery: async () => {
          queryCalledWithStaleImage = true;
          return true;
        },
        queuedNowLowLatencyHost: {
          sendQueuedNow: (id: string | undefined) => {
            sendQueuedNowCalls.push(id);
            return true;
          },
          dispose: () => {},
        } as unknown as SubmitPromptDeps['queuedNowLowLatencyHost'],
      });
      await submit.submit('', NOOP_HELPERS, depsWithPastedImage, undefined, {
        sendNow: true,
        sendQueuedOnly: true,
      });
      expect(queryCalledWithStaleImage).toBe(false);
      expect(getCommandQueue()).toHaveLength(3);
      expect(sendQueuedNowCalls).toEqual([undefined, undefined, undefined]);
    } finally {
      submit.dispose();
      turn.dispose();
    }
  });

  test('P0-D2-2: Esc cancellation + Turn 2 start prevents late Turn 1 events and completion from corrupting Turn 2', async () => {
    const store = createStore(getDefaultAppState());
    const turn = new TurnController({ store });
    const engineEntered = Promise.withResolvers<void>();
    const engineRelease = Promise.withResolvers<void>();
    const ac1 = new AbortController();
    const ac2 = new AbortController();
    let liveAc: AbortController | null = ac1;
    let resetLoadingCalls = 0;
    let turnCompleteCalls = 0;
    const receivedEvents: unknown[] = [];
    const messagesRef = { current: [] as Message[] };

    const deps = {
      store,
      queryGuard: turn.guard,
      initialMcpClients: [],
      titleDisabled: true,
      sessionTitle: 'test',
      sessionAiTitle: undefined,
      agentTitle: undefined,
      haikuTitleAttemptedRef: { current: true },
      setHaikuTitle: () => {},
      commands: [],
      setConversationId: () => {},
      setAppState: (u: any) => store.setState(p => (typeof u === 'function' ? u(p) : u)),
      messagesRef,
      resetLoadingState: () => {
        resetLoadingCalls++;
      },
      setAbortController: (ac: AbortController | null) => {
        liveAc = ac;
      },
      getToolUseContext: (_m: any, _n: any, ac: AbortController) =>
        ({
          abortController: ac,
          getAppState: () => store.getState(),
          setAppState: () => {},
          setToolPermissionContext: () => {},
          readFileState: new Map(),
          messages: [],
          options: {
            commands: [],
            tools: [],
            mcpClients: [],
            mainLoopModel: 'claude-opus-5',
            isNonInteractiveSession: false,
            debug: false,
            verbose: false,
            agentDefinitions: { activeAgents: [], allAgents: [] },
          },
        }) as any,
      toolPermissionContext: getEmptyToolPermissionContext(),
      terminalFocusRef: { current: true },
      canUseTool: async () => ({ behavior: 'allow', updatedInput: {} }),
      hostEngine: (() => {
        let step = 0;
        return {
          streamInput: async () => {},
          next: async () => {
            if (step === 0) {
              step++;
              engineEntered.resolve();
              await engineRelease.promise;
              return {
                done: false,
                value: {
                  type: 'stream_event',
                  event: { type: 'late_turn1_frame' },
                },
              };
            }
            if (step === 1) {
              step++;
              return {
                done: false,
                value: {
                  type: 'result',
                  subtype: 'error_during_execution',
                  is_error: false,
                },
              };
            }
            return { done: true, value: undefined };
          },
          interrupt: async () => {},
        };
      })() as any,
      engineFeed: turn.engineFeed,
      onQueryEvent: (ev: unknown) => {
        receivedEvents.push(ev);
      },
      addNotification: () => {},
      leftArrowDeferRef: { current: null },
      inputValueRef: { current: '' },
      setMessages: (action: any) => {
        messagesRef.current = typeof action === 'function' ? action(messagesRef.current) : action;
      },
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
      onTurnComplete: () => {
        turnCompleteCalls++;
      },
      resetTimingRefs: () => {},
      responseLengthRef: { current: 0 },
      setStreamingToolUses: () => {},
      clearStreamingText: () => {},
      displayTransform: { newTurn: () => {} },
      mrOnBeforeQuery: async () => {},
      mrOnTurnComplete: async () => {},
      setLastQueryCompletionTime: () => {},
      sendBridgeResultRef: { current: () => {} },
      proactiveActive: false,
      restoreMessageSyncRef: { current: () => {} },
    } as unknown as RunReplTurnDeps;

    try {
      const turn1 = runReplTurn(
        {
          newMessages: [createUserMessage({ content: 'turn 1' })],
          abortController: ac1,
          shouldQuery: true,
          additionalAllowedTools: [],
          mainLoopModelParam: 'claude-opus-5',
        },
        deps,
      );

      await engineEntered.promise;

      // Esc cancels Turn 1 and Turn 2 immediately reserves + installs ac2
      turn.guard.forceEnd();
      ac1.abort('user-cancel');
      expect(turn.guard.reserve()).toBe(true);
      const turn2Gen = turn.guard.generation;
      liveAc = ac2;

      // Now Turn 1's engine yields a late event and finishes
      engineRelease.resolve();
      await turn1;

      // Late Turn 1 frame must be dropped and Turn 2's state must remain untouched
      expect(receivedEvents).toEqual([]);
      expect(resetLoadingCalls).toBe(0);
      expect(turnCompleteCalls).toBe(0);
      expect(turn.guard.generation).toBe(turn2Gen);
      expect(turn.guard.isActive).toBe(true);
      expect(liveAc).toBe(ac2);
    } finally {
      turn.guard.cancelReservation();
      turn.dispose();
    }
  });

  test('P0-D2-3 & P2-D2-13: IdleCompactionRunner.clear() aborts in-flight compaction and runReplTurn captures pre-append timestamp', async () => {
    const runner = new IdleCompactionRunner();
    let receivedSignal: AbortSignal | undefined;
    let hostAbortCalled = false;
    const compactStarted = Promise.withResolvers<void>();
    const compactHold = Promise.withResolvers<null>();

    runner.host = {
      compact: signal => {
        receivedSignal = signal;
        compactStarted.resolve();
        return compactHold.promise;
      },
      abort: () => {
        hostAbortCalled = true;
      },
    };

    // Invoke private fire directly via schedule-free test seam: trigger clear() on in-flight abort
    const ac = new AbortController();
    (runner as unknown as { inFlightAbort: AbortController | null }).inFlightAbort = ac;
    runner.clear();
    expect(ac.signal.aborted).toBe(true);
    expect(hostAbortCalled).toBe(true);
    void receivedSignal;
    compactHold.resolve(null);
    void compactStarted;

    // Verify runReplTurn passes pre-append timestamp (not newly appended user message's timestamp)
    const store = createStore(getDefaultAppState());
    const turn = new TurnController({ store });
    const oldTs = new Date(Date.now() - IDLE_RETURN_MIN_MS - 60_000).toISOString();
    const oldMsg = {
      ...createAssistantMessage({ content: 'x'.repeat(500_000) }),
      timestamp: oldTs,
    } as Message;
    const freshUserMsg = {
      ...createUserMessage({ content: 'hello again' }),
      timestamp: new Date().toISOString(),
    } as Message;
    const messagesRef = { current: [oldMsg] as Message[] };

    const sharedIdle = getIdleCompactionRunner();
    let seenLastMessageAtMs: number | undefined;
    const origConsume = sharedIdle.consumeReturnAfterIdle.bind(sharedIdle);
    sharedIdle.consumeReturnAfterIdle = (ts, tokens) => {
      seenLastMessageAtMs = ts;
      return origConsume(ts, tokens);
    };

    try {
      await runReplTurn(
        {
          newMessages: [freshUserMsg],
          abortController: new AbortController(),
          shouldQuery: false,
          additionalAllowedTools: [],
          mainLoopModelParam: 'claude-opus-5',
        },
        {
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
          resetLoadingState: () => {},
          setAbortController: () => {},
          pipeReturnHadErrorRef: { current: false },
          relayPipeMessage: () => {},
          resetTimingRefs: () => {},
          setMessages: (action: any) => {
            messagesRef.current = typeof action === 'function' ? action(messagesRef.current) : action;
          },
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
        } as unknown as RunReplTurnDeps,
      );
      expect(seenLastMessageAtMs).toBe(Date.parse(oldTs));
    } finally {
      sharedIdle.consumeReturnAfterIdle = origConsume;
      turn.dispose();
    }
  });

  test('P0-1 & P1-D2-3: clearCommandScopedAllowRules preserves alwaysDenyRules.command for background/forked agents while runReplTurn clears it between turns', async () => {
    const base = {
      ...getEmptyToolPermissionContext(),
      alwaysAllowRules: { userSettings: ['Read'], command: ['Write'] },
      alwaysDenyRules: { userSettings: ['WebFetch'], command: ['Edit', 'Bash'] },
      strippedDangerousRules: { userSettings: ['Bash(rm:*)'], command: ['Bash(python:*)'] },
    };
    const cleared = clearCommandScopedAllowRules(base);
    expect(cleared.alwaysAllowRules.command).toBeUndefined();
    expect(cleared.strippedDangerousRules?.command).toBeUndefined();
    expect(cleared.strippedDangerousRules?.userSettings).toEqual(['Bash(rm:*)']);
    // Official 2.1.328 FOe: NEVER clears alwaysDenyRules.command!
    expect(cleared.alwaysDenyRules.command).toEqual(['Edit', 'Bash']);
    expect(cleared.alwaysDenyRules.userSettings).toEqual(['WebFetch']);
    expect(clearCommandScopedAllowRules(cleared)).toBe(cleared);

    // Background / async subagents and pollEventDeliveryGuard MUST keep
    // alwaysDenyRules.command (disallowedTools / frozenCommandDenies) intact
    // while stripping alwaysAllowRules.command!
    const bgStripped = runWithAgentContext(
      {
        agentId: 'agent-bg-1',
        agentType: 'subagent',
        isBackgroundAgent: true,
        isAsync: true,
      } as any,
      () => stripCommandAllowedToolsForBackgroundAgent(base),
    );
    expect(bgStripped.alwaysAllowRules.command).toBeUndefined();
    expect(bgStripped.alwaysDenyRules.command).toEqual(['Edit', 'Bash']);

    const pollStripped = stripCommandAllowedToolsForBackgroundAgent({
      ...base,
      pollEventDeliveryGuard: true,
    } as typeof base);
    expect(pollStripped.alwaysAllowRules.command).toBeUndefined();
    expect(pollStripped.alwaysDenyRules.command).toEqual(['Edit', 'Bash']);

    const store = createStore(getDefaultAppState());
    const turn = new TurnController({ store });
    const messagesRef = { current: [] as Message[] };
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
      resetLoadingState: () => {},
      setAbortController: () => {},
      pipeReturnHadErrorRef: { current: false },
      relayPipeMessage: () => {},
      resetTimingRefs: () => {},
      setMessages: () => {},
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
    } as unknown as RunReplTurnDeps;

    try {
      // Turn 1 with skill disallowedTools: ['Bash']
      await runReplTurn(
        {
          newMessages: [],
          abortController: new AbortController(),
          shouldQuery: false,
          additionalAllowedTools: [],
          additionalDisallowedTools: ['Bash'],
          mainLoopModelParam: 'claude-opus-5',
        },
        baseDeps,
      );
      expect(store.getState().toolPermissionContext.alwaysDenyRules.command).toEqual(['Bash']);

      // Turn 2 normal prompt with no disallowedTools must clear command-scoped deny rules
      await runReplTurn(
        {
          newMessages: [],
          abortController: new AbortController(),
          shouldQuery: false,
          additionalAllowedTools: [],
          additionalDisallowedTools: [],
          mainLoopModelParam: 'claude-opus-5',
        },
        baseDeps,
      );
      expect(store.getState().toolPermissionContext.alwaysDenyRules.command).toBeUndefined();
    } finally {
      turn.dispose();
    }

    const slashSrc = readFileSync(join(ROOT, 'src/utils/processUserInput/processSlashCommand.tsx'), 'utf8');
    expect(slashSrc).toContain('disallowedTools,\n    model,');
    expect(slashSrc).toContain('...(disallowedTools?.length ? { disallowedTools } : {})');
  });

  test('P1-D2-4: SubmitController.handleIncomingPrompt reserves queryGuard synchronously and releases on bailout', async () => {
    const store = createStore(getDefaultAppState());
    const turn = new TurnController({ store });
    const queue = createMessageQueue();
    const submit = new SubmitController({
      store,
      turnController: turn,
      messageQueue: queue,
      queryGuard: turn.guard,
    });

    const onQueryEntered = Promise.withResolvers<void>();
    const onQueryResolve = Promise.withResolvers<boolean>();
    const assignedControllers: Array<AbortController | null> = [];

    try {
      const accepted1 = submit.handleIncomingPrompt('incoming 1', {
        mainLoopModel: 'claude-opus-5',
        setAbortControllerForQuery: ac => {
          assignedControllers.push(ac);
          turn.setAbortController(ac);
        },
        onQuery: async () => {
          onQueryEntered.resolve();
          return onQueryResolve.promise;
        },
      });
      expect(accepted1).toBe(true);
      // Synchronously reserved before async claim resolves!
      expect(turn.guard.isActive).toBe(true);

      // Concurrent incoming prompt must be rejected immediately
      const accepted2 = submit.handleIncomingPrompt('incoming 2', {
        mainLoopModel: 'claude-opus-5',
        setAbortControllerForQuery: () => {},
        onQuery: async () => true,
      });
      expect(accepted2).toBe(false);

      await onQueryEntered.promise;
      // onQuery returns false -> reservation must be released and AC cleared
      onQueryResolve.resolve(false);
      await new Promise(r => setTimeout(r, 20));
      expect(turn.guard.isActive).toBe(false);
      expect(assignedControllers.at(-1)).toBeNull();
    } finally {
      submit.dispose();
      turn.dispose();
    }
  });

  test('P1-D2-7: StreamingToolExecutor.discard() clears inProgressToolUseIDs + interruptible flag, and TurnController.resetRequestState() clears streamingThinking', () => {
    let inProgress = new Set<string>(['unrelated_tool']);
    let interruptible = true;
    const dummyTool = {
      name: 'SlowTool',
      isConcurrencySafe: () => true,
      isReadOnly: () => true,
      interruptBehavior: () => 'cancel',
      call: async () => ({ data: 'ok' }),
      inputSchema: { safeParse: (v: unknown) => ({ success: true, data: v }) },
    } as unknown as Tool;

    const ctx = {
      abortController: new AbortController(),
      setInProgressToolUseIDs: (updater: React.SetStateAction<Set<string>>) => {
        inProgress = typeof updater === 'function' ? updater(inProgress) : updater;
      },
      setHasInterruptibleToolInProgress: (v: boolean) => {
        interruptible = v;
      },
      options: { tools: [dummyTool] },
      getAppState: () => getDefaultAppState(),
      setAppState: () => {},
    } as unknown as ToolUseContext;

    const executor = new StreamingToolExecutor([dummyTool], async () => ({ behavior: 'allow', updatedInput: {} }), ctx);
    const assistantMsg = createAssistantMessage({ content: '' });
    // Seed tracked tool & inProgress state to simulate mid-execution fallback
    inProgress.add('tool_discard_1');
    (executor as unknown as { tools: Array<{ id: string }> }).tools.push({
      id: 'tool_discard_1',
    });
    executor.discard();
    expect(inProgress.has('tool_discard_1')).toBe(false);
    expect(inProgress.has('unrelated_tool')).toBe(true);
    expect(interruptible).toBe(false);

    // TurnController.resetRequestState clears streamingThinking and auto-hide timer
    const store = createStore(getDefaultAppState());
    const turn = new TurnController({ store });
    try {
      turn.setStreamingThinking({
        thinking: 'deep thought',
        isStreaming: false,
        streamingEndedAt: Date.now(),
      });
      expect(turn.getSnapshot().streamingThinking?.thinking).toBe('deep thought');
      turn.resetRequestState();
      expect(turn.getSnapshot().streamingThinking).toBeNull();
    } finally {
      turn.dispose();
    }
  });

  test('P1-D2-8: SubmitController never double-restores stashedPrompt or clobbers newly typed input', async () => {
    const store = createStore(getDefaultAppState());
    const turn = new TurnController({ store });
    const queue = createMessageQueue();
    const submit = new SubmitController({
      store,
      turnController: turn,
      messageQueue: queue,
      queryGuard: turn.guard,
    });

    let currentInput = 'submit me';
    let liveStash: { text: string; cursorOffset: number; pastedContents: Record<number, never> } | undefined = {
      text: 'my stashed draft',
      cursorOffset: 16,
      pastedContents: {},
    };
    let restoreNotifCount = 0;

    try {
      // Case 1: Normal idle submit restores stash once pre-await, never double-restores post-await
      await submit.submit(
        'submit me',
        NOOP_HELPERS,
        makeSubmitDeps(store, turn, {
          stashedPrompt: liveStash,
          getStashedPrompt: () => liveStash,
          getCurrentInput: () => currentInput,
          setInputValue: v => {
            currentInput = v;
          },
          setStashedPrompt: next => {
            liveStash = typeof next === 'function' ? next(liveStash) : (next as any);
          },
          addNotification: n => {
            if (n.key === 'stash-restored') restoreNotifCount++;
          },
          onQuery: async () => {
            // Simulate turn still running when handlePromptSubmit resolves
            turn.setExternalLoading(true);
            return true;
          },
        }),
      );
      expect(currentInput).toBe('my stashed draft');
      expect(liveStash).toBeUndefined();
      expect(restoreNotifCount).toBe(1);

      // Case 2: Mid-turn queued submit must NOT clobber newly typed text during await
      currentInput = 'new draft typed during await';
      liveStash = {
        text: 'older stash',
        cursorOffset: 11,
        pastedContents: {},
      };
      restoreNotifCount = 0;
      await submit.submit(
        'queued msg',
        NOOP_HELPERS,
        makeSubmitDeps(store, turn, {
          stashedPrompt: liveStash,
          getStashedPrompt: () => liveStash,
          getCurrentInput: () => currentInput,
          setInputValue: v => {
            // handlePromptSubmit clears to '', then user types new text before post-await restore
            currentInput = v === '' ? 'user typed during await' : v;
          },
          setStashedPrompt: next => {
            liveStash = typeof next === 'function' ? next(liveStash) : (next as any);
          },
          addNotification: n => {
            if (n.key === 'stash-restored') restoreNotifCount++;
          },
        }),
      );
      expect(currentInput).toBe('user typed during await');
      expect(liveStash?.text).toBe('older stash');
      expect(restoreNotifCount).toBe(0);
    } finally {
      submit.dispose();
      turn.dispose();
    }
  });

  test('P1-D3-2: TranscriptProjection.subscribeNonProgress suppresses 1s tool progress churn while keeping live subscribers updated', () => {
    const store = createStore(getDefaultAppState());
    const initial = [createUserMessage({ content: 'run bash' })];
    const proj = new TranscriptProjection({ store, initialMessages: initial });

    let liveNotifs = 0;
    let nonProgressNotifs = 0;
    proj.subscribe(() => liveNotifs++);
    proj.subscribeNonProgress(() => nonProgressNotifs++);

    const snapBefore = proj.getNonProgressSnapshot();

    // 1s ephemeral bash_progress append -> live updates, nonProgress does NOT
    const progress1 = {
      type: 'progress',
      uuid: 'p1',
      toolUseID: 'tu1',
      parentToolUseID: 'tu1',
      data: { type: 'bash_progress', output: 'tick 1', elapsedTimeSeconds: 1 },
    } as unknown as Message;
    proj.setMessages(prev => [...prev, progress1]);
    expect(liveNotifs).toBe(1);
    expect(nonProgressNotifs).toBe(0);
    expect(proj.getNonProgressSnapshot()).toBe(snapBefore);
    expect(proj.getSnapshot()).toHaveLength(2);

    // In-place replacement with tick 2 -> still zero nonProgress re-renders
    const progress2 = {
      type: 'progress',
      uuid: 'p2',
      toolUseID: 'tu1',
      parentToolUseID: 'tu1',
      data: { type: 'bash_progress', output: 'tick 2', elapsedTimeSeconds: 2 },
    } as unknown as Message;
    proj.setMessages(prev => [...prev.slice(0, -1), progress2]);
    expect(liveNotifs).toBe(2);
    expect(nonProgressNotifs).toBe(0);
    expect(proj.getNonProgressSnapshot()).toBe(snapBefore);

    // Stop hook_progress DOES notify REPL so stopHookSpinnerSuffix stays live
    const stopHookProgress = {
      type: 'progress',
      uuid: 'p3',
      toolUseID: 'sh1',
      parentToolUseID: 'sh1',
      data: { type: 'hook_progress', hookEvent: 'Stop', command: 'check' },
    } as unknown as Message;
    proj.setMessages(prev => [...prev, stopHookProgress]);
    expect(liveNotifs).toBe(3);
    expect(nonProgressNotifs).toBe(1);
    expect(proj.getNonProgressSnapshot()).toHaveLength(3);

    // Assistant message DOES notify nonProgress
    proj.setMessages(prev => [...prev, createAssistantMessage({ content: 'done' })]);
    expect(liveNotifs).toBe(4);
    expect(nonProgressNotifs).toBe(2);
    expect(proj.getNonProgressSnapshot()).toHaveLength(4);
    expect(store.getState().transcripts[getMainThreadAgentId()]?.messages).toHaveLength(4);
  });

  test('P0-D3-2, P0-D4-1, P1-D1-4, P1-D1-8, P1-D2-2, P1-D3-3, P1-D3-7, P1-D4-7, P2-D1-17: REPL wiring invariants', () => {
    const replSrc = readModuleTree(join(ROOT, 'src/screens/REPL.tsx'), join(ROOT, 'src/screens/repl'));

    // P0-D3-2: legacy repinScroll(true, 'overlay') removed, dead condition fixed
    expect(replSrc).not.toContain("repinScroll(true, 'overlay')");
    expect(replSrc).toContain(
      'Boolean(toolJSX && !(isFullscreenEnvEnabled() && toolJSX.isLocalJSXCommand && toolJSX.isImmediate))',
    );

    // P0-D4-1: draft park does not deadlock hard dialog & PromptInput
    expect(hostParkToSuppressReason('draft')).toBe('draft');
    expect(nhtHidesPromptInput('permission_prompt', 'draft')).toBe(false);
    expect(nhtHidesPromptInput('permission_prompt', null)).toBe(true);
    expect(replSrc).toContain('const hidePromptForHardNms = rawHidePromptForHardNms && hostParkMode === null;');
    expect(replSrc).toContain('isDialogParked={hostParkMode !== null}');

    // P1-D1-4 & P2-D2-12: mid-session /resume cache cleanup + clearLocalJSX
    expect(replSrc).toContain('readFileState.current.clear();');
    expect(replSrc).toContain('setToolJSX({ jsx: null, shouldHidePromptInput: false, clearLocalJSX: true });');

    // P1-D1-8: unmount clears current sessionId and mainAgentId
    expect(replSrc).toContain('const currentSessionId: string = getSessionId();');
    expect(replSrc).toContain('sessionHooksRegistry.clear(currentSessionId);');

    // P1-D2-2: setInputMode syncs draftController.setMode & rate-limit passes inputModeOverride
    expect(replSrc).toContain('draftController.setMode(resolved);');
    expect(replSrc).toContain("{ inputModeOverride: 'prompt' }");

    // P1-D3-3: ctrl+o wires onPillClick, resetForTranscriptExit, and live streaming
    expect(replSrc).toContain('scrollPin.resetForTranscriptExit();');
    expect(replSrc).toContain('scrollViewport.handle?.scrollToBottom();');
    expect(replSrc).toContain('source={transcriptScrollViewport ? messagesSource : undefined}');

    // P1-D3-7: compaction paths reset ScrollPin
    expect(replSrc).toContain('scrollPin.resetForCompaction(nextMessages);');
    expect(replSrc).toContain('scrollPin.resetForCompaction(messagesRef.current);');
    const pin = new ScrollPin({ computeDivider: () => undefined });
    pin.resetForCompaction([]);
    expect(pin.isScrolledAway).toBe(false);
    pin.dispose();

    // P1-D4-7: $.ui.ask() dequeues from toolUseConfirmQueue in all 3 callbacks
    const uiAskSlice = replSrc.slice(
      replSrc.indexOf('setUiAskHostHandler('),
      replSrc.indexOf('setUiAskHostHandler(') + 1200,
    );
    expect(uiAskSlice.match(/removeLeaderToolUseConfirm\(toolUseID\)/g)?.length).toBe(3);

    // P2-D1-17: dead _pipeIpcState removed and expandedView selector narrowed
    expect(replSrc).not.toContain('_pipeIpcState');
    expect(replSrc).toContain("const showExpandedTodos = useAppState(s => s.expandedView === 'tasks');");

    // P1-9: idle/session compaction registration effect reads getToolUseContext &
    // mainLoopModel via refs (mount-stable deps) and re-checks signal.aborted across await import(...)
    expect(replSrc).toContain('const compactToolUseContextRef = useRef(getToolUseContext);');
    expect(replSrc).toContain('const compactMainLoopModelRef = useRef(mainLoopModel);');
    const idleEffectStart = replSrc.indexOf('setSessionCompactHandler(async ({ instructions }) => {');
    const idleEffectEnd = replSrc.indexOf('setFunctionHooksToolUseContext({', idleEffectStart);
    const idleEffectSlice = replSrc.slice(idleEffectStart, idleEffectEnd);
    expect(idleEffectSlice).toContain(
      '[abortInFlightCompaction, queryGuard, scrollPin, setAppState, setConversationId, setMessages]);',
    );
    expect(idleEffectSlice).not.toContain('getToolUseContext(msgs');
    expect(idleEffectSlice).toContain(
      "signal?.addEventListener('abort', onOuterAbort, { once: true });\n        if (signal?.aborted || queryGuard.isActive || isIdleBusyRef.current) {",
    );

    // P2-6: classic (non-fullscreen) ctrl+o & dumpMode subscribe to full transcript snapshot
    // and capture messagesRef.current.length so recent/live progress rows are never omitted
    expect(replSrc).toContain(
      "const subscribeFullTranscript =\n    screen === 'transcript' && (!isFullscreenEnvEnabled() || disableVirtualScroll || dumpMode);",
    );
    expect(replSrc).toContain(
      'subscribeFullTranscript ? transcriptProjection.subscribe : transcriptProjection.subscribeNonProgress',
    );
    expect(replSrc).toContain('messagesLength: messagesRef.current.length,');
    expect(replSrc).toContain(
      'frozenTranscriptState && !dumpMode ? messages.slice(0, frozenTranscriptState.messagesLength) : messages;',
    );
  });
});
