import { AgentTool } from '@claude-code/builtin-tools/tools/AgentTool/AgentTool.js';
import { AskUserQuestionTool } from '@claude-code/builtin-tools/tools/AskUserQuestionTool/AskUserQuestionTool.js';
import { feature } from 'bun:bundle';
import { randomUUID } from 'crypto';
import type * as React from 'react';
import { useEffect, useRef } from 'react';
import type { ToolUseConfirm } from '../../components/permissions/PermissionRequest.js';
import { formatPluginToastKey, getToasts, pushToast } from '../../components/toastStore.js';
import type { Notification } from '../../context/notifications.js';
import type { HostEngine } from '../../engine/hostEngine.js';
import type { CanUseToolFn } from '../../hooks/useCanUseTool.js';
import { resetMicrocompactState } from '../../services/compact/microCompact.js';
import { runPostCompactCleanup } from '../../services/compact/postCompactCleanup.js';
import { clearServerCache } from '../../services/mcp/client.js';
import type { ScopedMcpServerConfig } from '../../services/mcp/types.js';
import type { AppState } from '../../state/AppStateStore.js';
import type { Store } from '../../state/store.js';
import type { Tool } from '../../Tool.js';
import { assembleToolPool } from '../../tools.js';
import type { Message as MessageType } from '../../types/message.js';
import { logForDebugging } from '../../utils/debug.js';
import { isFullscreenEnvEnabled } from '../../utils/fullscreen.js';
import { getMainThreadTurn } from '../../utils/mainThreadTurn.js';
import { pruneDisplayedMessageContent } from '../../utils/messageDisplayTransform.js';
import type { SetAppState } from '../../utils/messageQueueManager.js';
import { createAssistantMessage, createSystemMessage } from '../../utils/messages.js';
import { getDenyRuleForTool } from '../../utils/permissions/permissions.js';
import {
  setAgentSpawnHandler,
  setFunctionHooksAppStateReader,
  setFunctionHooksAppStateWriter,
  setFunctionHooksToolUseContext,
  setFunctionHooksTurnReader,
  setSessionCompactHandler,
  setToolCallHandler,
  setTurnAbortHandler,
  setUiAskHostHandler,
  setUiToastShowHandler,
} from '../../utils/plugins/functionHooksModules.js';
import {
  awaitPluginMcpServer,
  connectPluginMcpServer,
  resolvePluginMcpServer,
} from '../../utils/plugins/pluginMcpConnect.js';
import { ensurePluginToolRegistrarInstalled } from '../../utils/plugins/pluginToolLoopbackRegistrar.js';
import { setPluginToolSessionHost } from '../../utils/plugins/pluginToolSessionHost.js';
import type { ProcessUserInputContext } from '../../utils/processUserInput/processUserInput.js';
import type { QueryGuard } from '../../utils/QueryGuard.js';
import type { ScrollPin } from '../../utils/scrollPin.js';
import { pushLeaderToolUseConfirm, removeLeaderToolUseConfirm } from '../../utils/swarm/leaderPermissionBridge.js';
import { mergeAndFilterTools } from '../../utils/toolPool.js';
import { getIdleCompactionRunner, IDLE_COMPACT_COMPLETED_MESSAGE } from './idleCompaction.js';
import type { TurnController } from './TurnController.js';

/* eslint-disable @typescript-eslint/no-require-imports */
const proactiveModule = feature('PROACTIVE') || feature('KAIROS') ? require('../../proactive/index.js') : null;
/* eslint-enable @typescript-eslint/no-require-imports */

/**
 * Registers function-hooks host callbacks (`$.ui.ask`, `$.ui.toast`, `$.ui.log`,
 * `$.tool.register`, `$.agent.spawn`, `$.turn.abort`, `$.session.compact`,
 * `$.tool.call`) and binds the idle-compaction runner host.
 */
export function useReplPluginAndCompactHost(params: {
  store: Store<AppState>;
  setAppState: SetAppState;
  messagesRef: React.RefObject<MessageType[]>;
  setMessages: (action: React.SetStateAction<MessageType[]>) => void;
  setConversationId: React.Dispatch<React.SetStateAction<string>>;
  dynamicMcpConfigRef: React.RefObject<Record<string, ScopedMcpServerConfig> | undefined>;
  onChangeDynamicMcpConfig: (
    next:
      | Record<string, ScopedMcpServerConfig>
      | ((prev: Record<string, ScopedMcpServerConfig> | undefined) => Record<string, ScopedMcpServerConfig>),
  ) => void;
  addNotification: (notif: Notification) => void;
  getToolUseContext: (
    messages: MessageType[],
    newMessages: MessageType[],
    abortController: AbortController,
    mainLoopModel: string,
  ) => ProcessUserInputContext;
  canUseTool: CanUseToolFn;
  mainLoopModel: string;
  combinedInitialTools: Tool[];
  isLoading: boolean;
  turnController: TurnController;
  hostEngine: HostEngine;
  queryGuard: QueryGuard;
  scrollPin: ScrollPin;
  activeCompactionAbortRef: React.RefObject<AbortController | null>;
  abortInFlightCompaction: () => void;
}): void {
  const {
    store,
    setAppState,
    messagesRef,
    setMessages,
    setConversationId,
    dynamicMcpConfigRef,
    onChangeDynamicMcpConfig,
    addNotification,
    getToolUseContext,
    canUseTool,
    mainLoopModel,
    combinedInitialTools,
    isLoading,
    turnController,
    hostEngine,
    queryGuard,
    scrollPin,
    activeCompactionAbortRef,
    abortInFlightCompaction,
  } = params;

  // densable `$.ui.ask` / `$.ui.toast` / `$.tool.register` host bindings
  useEffect(() => {
    setFunctionHooksAppStateReader(
      () => ({ ...store.getState(), messages: messagesRef.current }) as ReturnType<typeof store.getState>,
    );
    setFunctionHooksAppStateWriter(store.setState);
    ensurePluginToolRegistrarInstalled();
    const settledMcpServer = (name: string) =>
      awaitPluginMcpServer({ rows: () => store.getState().mcp.clients, subscribe: store.subscribe }, name);
    setPluginToolSessionHost({
      resolveMcpServer: input => resolvePluginMcpServer({ ...input, dynamicServers: dynamicMcpConfigRef.current }),
      settledMcpServer,
      connectMcpServer: (name, config) =>
        connectPluginMcpServer(
          {
            rows: () => store.getState().mcp.clients,
            subscribe: store.subscribe,
            holds: key => Object.hasOwn(dynamicMcpConfigRef.current ?? {}, key),
            drop: key =>
              onChangeDynamicMcpConfig(prev => {
                const next = { ...(prev ?? {}) };
                delete next[key];
                return next;
              }),
            forget: (key, previous) => (previous ? clearServerCache(key, previous) : undefined),
            add: (key, next) => onChangeDynamicMcpConfig(prev => ({ ...(prev ?? {}), [key]: next })),
          },
          name,
          config,
        ),
      addMcpServer: (name, config) => {
        onChangeDynamicMcpConfig(prev => ({ ...(prev ?? {}), [name]: config }));
      },
      removeMcpServer: name => {
        onChangeDynamicMcpConfig(prev => {
          if (!prev || !(name in prev)) return prev ?? {};
          const next = { ...prev };
          delete next[name];
          return next;
        });
      },
      tools: () => {
        const state = store.getState();
        return assembleToolPool(state.toolPermissionContext, state.mcp.tools);
      },
      mcpServers: () => {
        const state = store.getState();
        const names = new Set(state.mcp.clients.map(client => client.name));
        for (const name of Object.keys(dynamicMcpConfigRef.current ?? {})) {
          names.add(name);
        }
        return [...names];
      },
      builtInToolsDisabled: store.getState().toolPermissionContext.builtInToolsDisabled === true,
      isToolWithheldByDenyRule: tool => Boolean(getDenyRuleForTool(store.getState().toolPermissionContext, tool)),
    });
    setUiToastShowHandler(toast => {
      if (isFullscreenEnvEnabled()) {
        pushToast(randomUUID(), toast.text, toast.plugin, toast.timeoutMs ?? 4000);
        logForDebugging(`$.ui.toast: stacked (${getToasts().length} up)`);
        return;
      }
      addNotification({
        key: formatPluginToastKey(toast.plugin, randomUUID()),
        kind: 'event',
        text: `${toast.plugin}: ${toast.text}`,
        priority: 'immediate',
        timeoutMs: toast.timeoutMs ?? 4000,
      });
      const { current, queue } = store.getState().notifications;
      logForDebugging(`$.ui.toast: shown as ${current?.key ?? 'nothing'} (${queue.length} queued)`);
    });
    setUiAskHostHandler(input => {
      const toolUseID = randomUUID();
      const questions = input.questions;
      return new Promise(resolve => {
        const confirm: ToolUseConfirm = {
          assistantMessage: createAssistantMessage({ content: '' }),
          tool: AskUserQuestionTool as never,
          description: questions[0]?.question ?? 'AskUserQuestion',
          input: { questions },
          toolUseContext: {} as never,
          toolUseID,
          permissionResult: { behavior: 'ask', message: 'ask' },
          permissionPromptStartTimeMs: Date.now(),
          onUserInteraction() {},
          onAbort() {
            removeLeaderToolUseConfirm(toolUseID);
            resolve({ deny: 'the dialog was dismissed' });
          },
          onAllow(updatedInput) {
            removeLeaderToolUseConfirm(toolUseID);
            const answers = (updatedInput as { answers?: Record<string, string> })?.answers;
            resolve({ result: { answers: answers ?? {} } });
          },
          onReject(feedback) {
            removeLeaderToolUseConfirm(toolUseID);
            resolve({ deny: feedback || 'the dialog was dismissed' });
          },
          async recheckPermission() {},
        };
        if (!pushLeaderToolUseConfirm(confirm)) {
          resolve({ deny: 'the dialog was dismissed' });
        }
      });
    });
    return () => {
      setUiAskHostHandler(undefined);
      setUiToastShowHandler(undefined);
      setFunctionHooksAppStateReader(undefined);
      setFunctionHooksAppStateWriter(undefined);
      setPluginToolSessionHost(undefined);
    };
  }, [store, addNotification, onChangeDynamicMcpConfig, messagesRef, dynamicMcpConfigRef]);

  // densable useUiLog — $.ui.log lines become notice-level system messages.
  useEffect(() => {
    let stop = () => {};
    let cancelled = false;
    void import('../../utils/plugins/pluginUiLog.js').then(({ subscribePluginUiLog }) => {
      if (cancelled) return;
      stop = subscribePluginUiLog((entry, delivery) => {
        const content = `${entry.plugin}: ${entry.text}`;
        setMessages(prev => {
          const last = prev.at(-1);
          if (
            delivery === 'once' &&
            last?.type === 'system' &&
            last.subtype === 'informational' &&
            last.level === 'notice' &&
            last.content === content
          ) {
            return prev;
          }
          return [...prev, createSystemMessage(content, 'notice')];
        });
      });
    });
    return () => {
      cancelled = true;
      stop();
    };
  }, [setMessages]);

  // densable `$.agent.spawn` host: Agent tool, launch-only (run_in_background).
  useEffect(() => {
    setAgentSpawnHandler(async input => {
      const ctx = getToolUseContext(messagesRef.current, [], new AbortController(), mainLoopModel);
      const model = input.model;
      const spawnModel =
        model === 'sonnet' || model === 'opus' || model === 'haiku' || model === 'fable' ? model : undefined;
      try {
        const result = await AgentTool.call(
          {
            prompt: String(input.prompt ?? ''),
            description: String(input.description ?? ''),
            run_in_background: true,
            ...(typeof input.subagent_type === 'string'
              ? { subagent_type: input.subagent_type }
              : typeof input.subagentType === 'string'
                ? { subagent_type: input.subagentType }
                : {}),
            ...(typeof input.name === 'string' ? { name: input.name } : {}),
            ...(typeof input.cwd === 'string' ? { cwd: input.cwd } : {}),
            ...(spawnModel !== undefined ? { model: spawnModel } : {}),
          },
          ctx as unknown as import('../../Tool.js').ToolUseContext,
          canUseTool,
          createAssistantMessage({ content: '' }),
        );
        const data = result.data as {
          status?: string;
          agentId?: string;
        };
        if (data.status === 'async_launched' && typeof data.agentId === 'string') {
          return { result: { agentId: data.agentId } };
        }
        return { result: data };
      } catch (error) {
        return {
          isError: true,
          text: error instanceof Error ? error.message : String(error),
        };
      }
    });
    return () => setAgentSpawnHandler(undefined);
  }, [getToolUseContext, canUseTool, mainLoopModel, messagesRef]);

  const isIdleBusyRef = useRef(isLoading);
  isIdleBusyRef.current = isLoading;
  const compactToolUseContextRef = useRef(getToolUseContext);
  compactToolUseContextRef.current = getToolUseContext;
  const compactMainLoopModelRef = useRef(mainLoopModel);
  compactMainLoopModelRef.current = mainLoopModel;

  // `$.turn.abort`, `$.session.compact`, and `getIdleCompactionRunner().host`
  useEffect(() => {
    setFunctionHooksTurnReader(() => getMainThreadTurn());
    setTurnAbortHandler(async ({ turnId }) => {
      const ac = turnController.abortController;
      if (!ac || ac.signal.aborted) {
        throw new Error(`$.turn.abort: no turn is running (asked for ${turnId})`);
      }
      ac.abort('user-cancel');
      void hostEngine.interrupt('user-cancel');
      return { aborted: turnId };
    });
    setSessionCompactHandler(async ({ instructions }) => {
      if (queryGuard.isActive || isIdleBusyRef.current) {
        return { compacted: false };
      }
      const { compactConversation, buildPostCompactMessages } = await import('../../services/compact/compact.js');
      const { getCacheSharingParams } = await import('../../commands/compact/compact.js');
      const { getMessagesAfterCompactBoundary } = await import('../../utils/messages.js');
      if (queryGuard.isActive || isIdleBusyRef.current) {
        return { compacted: false };
      }
      const preCompactSnapshot = messagesRef.current;
      const preCompactLastUuid = preCompactSnapshot.at(-1)?.uuid;
      const msgs = getMessagesAfterCompactBoundary(preCompactSnapshot);
      const compactAc = new AbortController();
      abortInFlightCompaction();
      activeCompactionAbortRef.current = compactAc;
      try {
        const ctx = compactToolUseContextRef.current(msgs, [], compactAc, compactMainLoopModelRef.current);
        const result = await compactConversation(
          msgs,
          ctx as unknown as import('../../Tool.js').ToolUseContext,
          await getCacheSharingParams(ctx as unknown as import('../../Tool.js').ToolUseContext, msgs),
          false,
          instructions === '' ? undefined : instructions,
          false,
        );
        const transcriptChanged =
          messagesRef.current !== preCompactSnapshot || messagesRef.current.at(-1)?.uuid !== preCompactLastUuid;
        if (compactAc.signal.aborted || queryGuard.isActive || transcriptChanged) {
          return { compacted: false };
        }
        const nextMessages = buildPostCompactMessages(result) as typeof msgs;
        setMessages(nextMessages);
        scrollPin.resetForCompaction(nextMessages);
        setConversationId(randomUUID());
        setAppState(prev => pruneDisplayedMessageContent(prev, nextMessages));
        resetMicrocompactState();
        runPostCompactCleanup(ctx.options.querySource);
        if (feature('PROACTIVE') || feature('KAIROS')) {
          proactiveModule?.setContextBlocked(false);
        }
        return { compacted: true };
      } finally {
        if (activeCompactionAbortRef.current === compactAc) {
          activeCompactionAbortRef.current = null;
        }
      }
    });
    const idleRunner = getIdleCompactionRunner();
    const idleHost = {
      refusal: () => (queryGuard.isActive || isIdleBusyRef.current ? 'busy' : undefined),
      abort: abortInFlightCompaction,
      compact: async (signal?: AbortSignal) => {
        if (signal?.aborted || queryGuard.isActive || isIdleBusyRef.current) {
          return null;
        }
        const { compactConversation, buildPostCompactMessages } = await import('../../services/compact/compact.js');
        const { getCacheSharingParams } = await import('../../commands/compact/compact.js');
        const { getMessagesAfterCompactBoundary, createSystemMessage: createSysMsg } = await import(
          '../../utils/messages.js'
        );
        const { tokenCountWithEstimation } = await import('../../utils/tokens.js');
        if (signal?.aborted || queryGuard.isActive || isIdleBusyRef.current) {
          return null;
        }
        const preCompactSnapshot = messagesRef.current;
        const preCompactLastUuid = preCompactSnapshot.at(-1)?.uuid;
        const msgs = getMessagesAfterCompactBoundary(preCompactSnapshot);
        const tokensBefore = tokenCountWithEstimation(msgs);
        const compactAc = new AbortController();
        const onOuterAbort = () => compactAc.abort(signal?.reason ?? 'idle_compaction_cancelled');
        signal?.addEventListener('abort', onOuterAbort, { once: true });
        if (signal?.aborted || queryGuard.isActive || isIdleBusyRef.current) {
          signal?.removeEventListener('abort', onOuterAbort);
          return null;
        }
        abortInFlightCompaction();
        activeCompactionAbortRef.current = compactAc;
        try {
          const ctx = compactToolUseContextRef.current(msgs, [], compactAc, compactMainLoopModelRef.current);
          const result = await compactConversation(
            msgs,
            ctx as unknown as import('../../Tool.js').ToolUseContext,
            await getCacheSharingParams(ctx as unknown as import('../../Tool.js').ToolUseContext, msgs),
            false,
            undefined,
            false,
          );
          if (signal?.aborted || compactAc.signal.aborted) {
            const abortErr = new Error('Idle compaction aborted');
            abortErr.name = 'AbortError';
            throw abortErr;
          }
          const transcriptChanged =
            messagesRef.current !== preCompactSnapshot || messagesRef.current.at(-1)?.uuid !== preCompactLastUuid;
          if (queryGuard.isActive || transcriptChanged) {
            return null;
          }
          const postMessages = buildPostCompactMessages(result) as typeof msgs;
          const tokensAfter = tokenCountWithEstimation(postMessages);
          const nextMessages = [...postMessages, createSysMsg(IDLE_COMPACT_COMPLETED_MESSAGE, 'info')] as typeof msgs;
          setMessages(nextMessages);
          scrollPin.resetForCompaction(nextMessages);
          setConversationId(randomUUID());
          setAppState(prev => pruneDisplayedMessageContent(prev, nextMessages));
          resetMicrocompactState();
          runPostCompactCleanup(ctx.options.querySource);
          if (feature('PROACTIVE') || feature('KAIROS')) {
            proactiveModule?.setContextBlocked(false);
          }
          return { tokensBefore, tokensAfter };
        } finally {
          signal?.removeEventListener('abort', onOuterAbort);
          if (activeCompactionAbortRef.current === compactAc) {
            activeCompactionAbortRef.current = null;
          }
        }
      },
    };
    idleRunner.host = idleHost;
    return () => {
      abortInFlightCompaction();
      if (idleRunner.host === idleHost) {
        idleRunner.host = null;
      }
      idleRunner.clear();
      setTurnAbortHandler(undefined);
      setFunctionHooksTurnReader(undefined);
      setSessionCompactHandler(undefined);
    };
  }, [
    abortInFlightCompaction,
    activeCompactionAbortRef,
    hostEngine,
    messagesRef,
    queryGuard,
    scrollPin,
    setAppState,
    setConversationId,
    setMessages,
    turnController,
  ]);

  // densable XL `$3`: bind session tool-use context so $.tool.call / $.mcp.call stream runToolUse
  useEffect(() => {
    setFunctionHooksToolUseContext({
      getToolUseContext: () => getToolUseContext(messagesRef.current, [], new AbortController(), mainLoopModel),
      canUseTool,
      getParentAssistantMessage: () => createAssistantMessage({ content: '' }),
    });
    setToolCallHandler(async input => {
      const mcpTools = store.getState().mcp?.tools
        ? assembleToolPool(store.getState().toolPermissionContext, store.getState().mcp.tools)
        : [];
      const merged = mergeAndFilterTools(combinedInitialTools, mcpTools, store.getState().toolPermissionContext.mode);
      const name = String(input.tool ?? '');
      const tool = merged.find(item => item.name === name);
      if (!tool || typeof tool.call !== 'function') {
        return {
          isError: true,
          text: `no tool named "${name}" in this session`,
        };
      }
      const { tool: _tool, ...args } = input;
      try {
        const ctx = getToolUseContext(messagesRef.current, [], new AbortController(), mainLoopModel);
        const result = await tool.call(
          args,
          ctx as unknown as import('../../Tool.js').ToolUseContext,
          canUseTool,
          createAssistantMessage({ content: '' }),
        );
        return result;
      } catch (error) {
        return {
          isError: true,
          text: error instanceof Error ? error.message : String(error),
        };
      }
    });
    return () => {
      setToolCallHandler(undefined);
      setFunctionHooksToolUseContext(undefined);
    };
  }, [getToolUseContext, canUseTool, mainLoopModel, combinedInitialTools, messagesRef, store]);
}
