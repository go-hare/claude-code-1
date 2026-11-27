import { Text } from '@anthropic/ink';
import { APIError } from '@anthropic-ai/sdk';
import type { AgentDefinition } from '@claude-code/builtin-tools/tools/AgentTool/loadAgentsDir.js';
import { resumeAgentBackground } from '@claude-code/builtin-tools/tools/AgentTool/resumeAgent.js';
import { feature } from 'bun:bundle';
import * as React from 'react';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { getSessionId } from '../../bootstrap/state.js';
import { getReplBridgeHandle } from '../../bridge/replBridgeHandle.js';
import type { Command } from '../../commands.js';
import { buildPermissionUpdates } from '../../components/permissions/ExitPlanModePermissionRequest/ExitPlanModePermissionRequest.js';
import type { SpinnerMode } from '../../components/Spinner.js';
import { getSystemPrompt } from '../../constants/prompts.js';
import { getSystemContext, getUserContext } from '../../context.js';
import type { Notification } from '../../context/notifications.js';
import { isPermissionPromptDialog, SANDBOX_NETWORK_ACCESS_KIND } from '../../dialog/index.js';
import type { HostEngine } from '../../engine/hostEngine.js';
import { expandPastedTextRefs } from '../../history.js';
import type { CanUseToolFn } from '../../hooks/useCanUseTool.js';
import type { IDESelection } from '../../hooks/useIdeSelection.js';
import { useReplBridge } from '../../hooks/useReplBridge.js';
import { useSessionBackgrounding } from '../../hooks/useSessionBackgrounding.js';
import { shouldOpenUsageLimitMenuAfterWaitRefusal } from '../../services/api/withRetry.js';
import { currentLimits, quotaRejectedListeners } from '../../services/claudeAiLimits.js';
import {
  didSessionEndDuringCodeModeScript,
  shouldAutoStartCodeModeTurnAfterCommand,
} from '../../services/codeMode/executor.js';
import { codeModeBackgroundRefusal, isCodeModeEnabled } from '../../services/codeMode/optIn.js';
import type { MCPServerConnection } from '../../services/mcp/types.js';
import type { ActiveSpeculationState } from '../../services/PromptSuggestion/speculation.js';
import {
  AUTO_CONTINUE_LOGIN_CHANGED_NOTICE,
  cancelQuotaAutoResume,
  getQuotaAutoResumeState,
  subscribeQuotaAutoResumeChanged,
  subscribeQuotaAutoResumeEvents,
} from '../../services/quotaAutoResume.js';
import type { AppState } from '../../state/AppStateStore.js';
import type { Store } from '../../state/store.js';
import { injectUserMessageToTeammate } from '../../tasks/InProcessTeammateTask/InProcessTeammateTask.js';
import type { InProcessTeammateTaskState } from '../../tasks/InProcessTeammateTask/types.js';
import {
  appendMessageToLocalAgent,
  isLocalAgentTask,
  type LocalAgentTaskState,
  queuePendingMessage,
} from '../../tasks/LocalAgentTask/LocalAgentTask.js';
import { startBackgroundSession } from '../../tasks/LocalMainSessionTask.js';
import {
  evaluateWorkflowRateLimitLoginHold,
  isLocalWorkflowTask,
  reconcileWorkflowRateLimitWaitOnEvent,
  setWorkflowRateLimitWait,
  WORKFLOW_HELD_FOR_LOGIN_NOTICE,
} from '../../tasks/LocalWorkflowTask/LocalWorkflowTask.js';
import type { ToolPermissionContext, Tools } from '../../Tool.js';
import type { Message as MessageType, UserMessage } from '../../types/message.js';
import type { PromptInputMode } from '../../types/textInputTypes.js';
import { createAbortController } from '../../utils/abortController.js';
import { createAttachmentMessage, getQueuedCommandAttachments } from '../../utils/attachments.js';
import { type AutoRunIssueReason, getAutoRunCommand } from '../../utils/autoRunIssue.js';
import { clearHeldClearedDraft } from '../../utils/clearedDraftHold.js';
import type { PastedContent } from '../../utils/config.js';
import { logForDebugging } from '../../utils/debug.js';
import type { EffortValue } from '../../utils/effort.js';
import { errorMessage } from '../../utils/errors.js';
import { fileHistoryEnabled, fileHistoryMakeSnapshot, type FileHistoryState } from '../../utils/fileHistory.js';
import type { FileStateCache } from '../../utils/fileStateCache.js';
import type { QueuedNowLowLatency } from '../../utils/foregroundToolCalls.js';
import type { PromptInputHelpers } from '../../utils/handlePromptSubmit.js';
import type { IdleReturnController } from '../../utils/idleReturnController.js';
import type { createMessageDisplayTransform } from '../../utils/messageDisplayTransform.js';
import {
  collapseBacklogTaskNotifications,
  type MessageQueueInstance,
  type SetAppState,
} from '../../utils/messageQueueManager.js';
import {
  createSystemMessage,
  createUserMessage,
  type handleMessageFromStream,
  type StreamingThinking,
  type StreamingToolUse,
} from '../../utils/messages.js';
import { applyPermissionUpdates } from '../../utils/permissions/PermissionUpdate.js';
import { stripDangerousPermissionsForAutoMode } from '../../utils/permissions/permissionSetup.js';
import { getPlanSlug, setPlanSlug } from '../../utils/plans.js';
import type { ProcessUserInputContext } from '../../utils/processUserInput/processUserInput.js';
import { getQuerySourceForREPL } from '../../utils/promptCategory.js';
import type { PromptDraftController } from '../../utils/promptDraftController.js';
import type { QueryGuard } from '../../utils/QueryGuard.js';
import type { ScrollPin } from '../../utils/scrollPin.js';
import type { StreamingDisplayStore } from '../../utils/streamingTextStore.js';
import { buildEffectiveSystemPrompt } from '../../utils/systemPrompt.js';
import type { TaskRegistry } from '../../utils/taskRegistry.js';
import { resetTeamLeadVerificationOnSessionBoundary } from '../../utils/teammateMailbox.js';
import { buildAgentMessageContentWithImages } from './replHelpers.js';
import type { InFlightTitleRequest, TitleFallback } from './runReplTurn.js';
import type { SubmitController } from './SubmitController.js';
import type { TurnController } from './TurnController.js';
import type { ViewController } from './ViewController.js';
import type {
  ApiMetricsEntry,
  FocusedInputDialog,
  LeftArrowDeferArm,
  PkeState,
  SalvageState,
  SetToolJSXArgs,
  StashedPrompt,
} from './types.js';

/* eslint-disable @typescript-eslint/no-require-imports */
const proactiveModule = feature('PROACTIVE') || feature('KAIROS') ? require('../../proactive/index.js') : null;
const usePipeRouter = feature('UDS_INBOX')
  ? require('../../hooks/usePipeRouter.js').usePipeRouter
  : () => ({ routeToSelectedPipes: () => false });
/* eslint-enable @typescript-eslint/no-require-imports */

export type TerminalBlockingDialogBridge = {
  setTerminalOnlyBlockingDialog?: (kind: string, active: boolean) => void;
};

export function syncTerminalOnlyBlockingDialogs(
  bridge: TerminalBlockingDialogBridge | null | undefined,
  nextKinds: ReadonlySet<string>,
  activeKindsRef: { current: Set<string> },
  lastSyncedBridgeRef: { current: TerminalBlockingDialogBridge | null },
): void {
  if (!bridge?.setTerminalOnlyBlockingDialog) {
    activeKindsRef.current = new Set();
    lastSyncedBridgeRef.current = null;
    return;
  }
  const prevKinds = lastSyncedBridgeRef.current === bridge ? activeKindsRef.current : new Set<string>();
  lastSyncedBridgeRef.current = bridge;
  for (const kind of prevKinds) {
    if (!nextKinds.has(kind)) {
      bridge.setTerminalOnlyBlockingDialog(kind, false);
    }
  }
  for (const kind of nextKinds) {
    if (!prevKinds.has(kind)) {
      bridge.setTerminalOnlyBlockingDialog(kind, true);
    }
  }
  activeKindsRef.current = new Set(nextKinds);
}

/**
 * Orchestrates foreground/background query turns, submission (`onSubmit`,
 * `onAgentSubmit`), initial-message dispatch, quota auto-resume + workflow
 * rate-limit wait coordination, feedback/rate-limit shortcuts, and REPL Bridge
 * synchronization.
 */
export function useReplTurnOrchestration(params: {
  store: Store<AppState>;
  setAppState: SetAppState;
  turnController: TurnController;
  submitController: SubmitController;
  queryGuard: QueryGuard;
  messageQueue: MessageQueueInstance;
  hostEngine: HostEngine;
  taskRegistry: TaskRegistry;
  scrollPin: ScrollPin;
  draftController: PromptDraftController;
  queuedNowLowLatencyHost: QueuedNowLowLatency;
  idleReturnController: IdleReturnController;
  messages: MessageType[];
  messagesRef: React.RefObject<MessageType[]>;
  setMessages: (action: React.SetStateAction<MessageType[]>) => void;
  setConversationId: React.Dispatch<React.SetStateAction<string>>;
  initialMessage: AppState['initialMessage'];
  initialMcpClients: MCPServerConnection[] | undefined;
  commands: Command[];
  tools: Tools;
  mainLoopModel: string;
  toolPermissionContext: ToolPermissionContext;
  mainThreadAgentDefinition: AgentDefinition | undefined;
  customSystemPrompt: string | undefined;
  appendSystemPrompt: string | undefined;
  tasks: AppState['tasks'];
  topDialogKind: string | undefined;
  focusedInputDialog: FocusedInputDialog;
  pke: PkeState;
  workerSandboxPermissions: AppState['workerSandboxPermissions'];
  elicitation: AppState['elicitation'];
  replBridgePermissionCallbacks: AppState['replBridgePermissionCallbacks'];
  replBridgeSessionActive: AppState['replBridgeSessionActive'];
  titleDisabled: boolean;
  sessionTitle: string | undefined;
  sessionAiTitle: string | undefined;
  agentTitle: string | undefined;
  terminalTitle: string;
  haikuTitleAttemptedRef: React.RefObject<boolean>;
  titleFallbackRef: React.RefObject<TitleFallback | undefined>;
  titleRequestRef: React.RefObject<InFlightTitleRequest | null>;
  setHaikuTitle: React.Dispatch<React.SetStateAction<string | undefined>>;
  isLoading: boolean;
  isExternalLoading: boolean;
  setIsExternalLoading: (value: boolean) => void;
  resetLoadingState: () => void;
  setAbortController: (ac: AbortController | null) => void;
  setAbortControllerForQuery: (ac: AbortController | null) => void;
  getToolUseContext: (
    messages: MessageType[],
    newMessages: MessageType[],
    abortController: AbortController,
    mainLoopModel: string,
  ) => ProcessUserInputContext;
  canUseTool: CanUseToolFn;
  onBeforeQuery: ((input: string, newMessages: MessageType[]) => Promise<boolean>) | undefined;
  onTurnComplete: ((messages: MessageType[], terminalReason?: string) => void | Promise<void>) | undefined;
  addNotification: (notif: Notification) => void;
  streamingDisplayStore: StreamingDisplayStore;
  salvageRef: React.RefObject<SalvageState | null>;
  refusalReplacesUuidsRef: React.RefObject<string[] | null>;
  clearStreamingText: () => void;
  setResponseLength: (f: (prev: number) => number) => void;
  setStreamMode: (mode: SpinnerMode) => void;
  setStreamingToolUses: TurnController['setStreamingToolUses'];
  setStreamingThinking: TurnController['setStreamingThinking'];
  responseLengthRef: React.RefObject<number>;
  apiMetricsRef: React.RefObject<ApiMetricsEntry[]>;
  onStreamingText: (f: (current: string | null) => string | null) => void;
  displayTransform: ReturnType<typeof createMessageDisplayTransform>;
  setInProgressToolUseIDs: (updater: React.SetStateAction<Set<string>>) => void;
  pipeReturnHadErrorRef: React.RefObject<boolean>;
  relayPipeMessage: ReturnType<typeof import('../../hooks/usePipeRelay.js').usePipeRelay>['relayPipeMessage'];
  terminalFocusRef: React.RefObject<boolean>;
  leftArrowDeferRef: React.RefObject<LeftArrowDeferArm | null>;
  inputValueRef: React.RefObject<string>;
  inputMode: PromptInputMode;
  inputModeRef: React.RefObject<PromptInputMode>;
  setInputValue: (value: string) => void;
  setInputMode: (next: React.SetStateAction<PromptInputMode>) => void;
  pastedContents: Record<number, PastedContent>;
  setPastedContents: React.Dispatch<React.SetStateAction<Record<number, PastedContent>>>;
  ideSelection: IDESelection | undefined;
  setIDESelection: ViewController['setIdeSelection'];
  stashedPrompt: StashedPrompt | undefined;
  stashedPromptRef: React.RefObject<StashedPrompt | undefined>;
  setStashedPrompt: React.Dispatch<React.SetStateAction<StashedPrompt | undefined>>;
  setSubmitCount: React.Dispatch<React.SetStateAction<number>>;
  setUserInputOnProcessing: (input: string | undefined) => void;
  setToolJSX: (args: SetToolJSXArgs) => void;
  streamModeRef: React.RefObject<SpinnerMode>;
  hasInterruptibleToolInProgressRef: React.RefObject<boolean>;
  tipPickedThisTurnRef: React.RefObject<boolean>;
  activeRemote: Parameters<SubmitController['submit']>[2]['activeRemote'];
  readFileState: React.RefObject<FileStateCache>;
  bashTools: React.RefObject<Set<string>>;
  bashHosts: React.RefObject<Set<string>>;
  bashToolsProcessedIdx: React.RefObject<number>;
  discoveredSkillNamesRef: React.RefObject<Set<string>>;
  loadedNestedMemoryPathsRef: React.RefObject<Set<string>>;
  pendingNestedMemoryTriggersRef: React.RefObject<Set<string>>;
  repinScroll: (force?: boolean, reason?: string) => void;
  resetTimingRefs: () => void;
  consumeIdeSelection: ViewController['consumeIdeSelection'];
  recordIdeSelectionConsumedBy: ViewController['recordIdeSelectionConsumedBy'];
  restoreIdeSelectionConsumedBy: ViewController['restoreIdeSelectionConsumedBy'];
  restoreHandedBackPrompt: (text: string) => void;
  markIdleForkMidTurn: () => void;
  leftArrowToAgentsFired: React.RefObject<boolean>;
  buddyEnabled: boolean;
  loadingStartTimeRef: React.RefObject<number>;
  totalPausedMsRef: React.RefObject<number>;
  swarmStartTimeRef: React.RefObject<number | null>;
  swarmBudgetInfoRef: React.RefObject<{ tokens: number; limit: number; nudges: number } | undefined>;
  backgroundWaitStartTimeRef: React.RefObject<number | null>;
  mrOnBeforeQuery: ReturnType<typeof import('../../moreright/useMoreRight.js').useMoreRight>['onBeforeQuery'];
  mrOnTurnComplete: ReturnType<typeof import('../../moreright/useMoreRight.js').useMoreRight>['onTurnComplete'];
  setLastQueryCompletionTime: React.Dispatch<React.SetStateAction<number>>;
  sendBridgeResultRef: React.RefObject<() => void>;
  proactiveActive: boolean;
  restoreMessageSyncRef: React.RefObject<(m: UserMessage, earlierBatch?: UserMessage[]) => void>;
  codeModeInterruptedByEscRef: React.RefObject<boolean>;
  autoRunIssueReason: AutoRunIssueReason | null;
  setAutoRunIssueReason: React.Dispatch<React.SetStateAction<AutoRunIssueReason | null>>;
  resumeReturnCompactRef: React.RefObject<() => void>;
  resumeReturnClearRef: React.RefObject<() => void>;
}): {
  handleBackgroundSession: () => void;
  onQuery: (
    newMessages: MessageType[],
    abortController: AbortController,
    shouldQuery: boolean,
    additionalAllowedTools: string[],
    mainLoopModelParam: string,
    onBeforeQueryCallback?: (input: string, newMessages: MessageType[]) => Promise<boolean>,
    input?: string,
    effort?: EffortValue,
    stopHookActive?: boolean,
    clientPlatform?: string,
    additionalDisallowedTools?: string[],
  ) => Promise<boolean>;
  onSubmit: (
    input: string,
    helpers: PromptInputHelpers,
    speculationAccept?: {
      state: ActiveSpeculationState;
      speculationSessionTimeSavedMs: number;
      setAppState: SetAppState;
    },
    options?: {
      fromKeybinding?: boolean;
      inputModeOverride?: PromptInputMode;
      pastedContentsOverride?: Record<number, PastedContent>;
      resumesStaleQuotaWait?: boolean;
      sendNow?: boolean;
      sendQueuedOnly?: boolean;
      queueSubmit?: boolean;
      composerEnter?: unknown;
    },
  ) => Promise<void>;
  onAgentSubmit: (
    input: string,
    task: InProcessTeammateTaskState | LocalAgentTaskState,
    helpers: PromptInputHelpers,
    submittedPastedContents?: Record<number, PastedContent>,
  ) => Promise<void>;
  handleAutoRunIssue: () => void;
  handleCancelAutoRunIssue: () => void;
  handleSurveyRequestFeedback: () => void;
  handleOpenRateLimitOptions: () => void;
} {
  const {
    store,
    setAppState,
    turnController,
    submitController,
    queryGuard,
    messageQueue,
    hostEngine,
    taskRegistry,
    scrollPin,
    draftController,
    queuedNowLowLatencyHost,
    idleReturnController,
    messages,
    messagesRef,
    setMessages,
    setConversationId,
    initialMessage,
    initialMcpClients,
    commands,
    tools,
    mainLoopModel,
    toolPermissionContext,
    mainThreadAgentDefinition,
    customSystemPrompt,
    appendSystemPrompt,
    tasks,
    topDialogKind,
    focusedInputDialog,
    pke,
    workerSandboxPermissions,
    elicitation,
    replBridgePermissionCallbacks,
    replBridgeSessionActive,
    titleDisabled,
    sessionTitle,
    sessionAiTitle,
    agentTitle,
    terminalTitle,
    haikuTitleAttemptedRef,
    titleFallbackRef,
    titleRequestRef,
    setHaikuTitle,
    isLoading,
    isExternalLoading,
    setIsExternalLoading,
    resetLoadingState,
    setAbortController,
    setAbortControllerForQuery,
    getToolUseContext,
    canUseTool,
    onBeforeQuery,
    onTurnComplete,
    addNotification,
    streamingDisplayStore,
    salvageRef,
    refusalReplacesUuidsRef,
    clearStreamingText,
    setResponseLength,
    setStreamMode,
    setStreamingToolUses,
    setStreamingThinking,
    responseLengthRef,
    apiMetricsRef,
    onStreamingText,
    displayTransform,
    setInProgressToolUseIDs,
    pipeReturnHadErrorRef,
    relayPipeMessage,
    terminalFocusRef,
    leftArrowDeferRef,
    inputValueRef,
    inputMode,
    inputModeRef,
    setInputValue,
    setInputMode,
    pastedContents,
    setPastedContents,
    ideSelection,
    setIDESelection,
    stashedPrompt,
    stashedPromptRef,
    setStashedPrompt,
    setSubmitCount,
    setUserInputOnProcessing,
    setToolJSX,
    streamModeRef,
    hasInterruptibleToolInProgressRef,
    tipPickedThisTurnRef,
    activeRemote,
    readFileState,
    bashTools,
    bashHosts,
    bashToolsProcessedIdx,
    discoveredSkillNamesRef,
    loadedNestedMemoryPathsRef,
    pendingNestedMemoryTriggersRef,
    repinScroll,
    resetTimingRefs,
    consumeIdeSelection,
    recordIdeSelectionConsumedBy,
    restoreIdeSelectionConsumedBy,
    restoreHandedBackPrompt,
    markIdleForkMidTurn,
    leftArrowToAgentsFired,
    buddyEnabled,
    loadingStartTimeRef,
    totalPausedMsRef,
    swarmStartTimeRef,
    swarmBudgetInfoRef,
    backgroundWaitStartTimeRef,
    mrOnBeforeQuery,
    mrOnTurnComplete,
    setLastQueryCompletionTime,
    sendBridgeResultRef,
    proactiveActive,
    restoreMessageSyncRef,
    codeModeInterruptedByEscRef,
    autoRunIssueReason,
    setAutoRunIssueReason,
    resumeReturnCompactRef,
    resumeReturnClearRef,
  } = params;

  const handleBackgroundQuery = useCallback(() => {
    const abortController = turnController.abortController;
    if (isCodeModeEnabled()) {
      addNotification({
        key: 'code-mode-bg-refusal',
        kind: 'warning',
        priority: 'immediate',
        wrap: true,
        color: 'warning',
        text: codeModeBackgroundRefusal(),
      });
      return;
    }
    abortController?.abort('background');
    const removedNotifications = collapseBacklogTaskNotifications(
      messageQueue.removeByFilter(cmd => cmd.mode === 'task-notification'),
    );

    void (async () => {
      const toolUseContext = getToolUseContext(messagesRef.current, [], new AbortController(), mainLoopModel);

      const [defaultSystemPrompt, userContext, systemContext] = await Promise.all([
        getSystemPrompt(
          toolUseContext.options.tools,
          mainLoopModel,
          Array.from(toolPermissionContext.additionalWorkingDirectories.keys()),
          toolUseContext.options.mcpClients,
        ),
        getUserContext(),
        getSystemContext(),
      ]);

      const systemPrompt = buildEffectiveSystemPrompt({
        mainThreadAgentDefinition,
        toolUseContext,
        customSystemPrompt,
        defaultSystemPrompt,
        appendSystemPrompt,
      });
      toolUseContext.renderedSystemPrompt = systemPrompt;

      const notificationAttachments = await getQueuedCommandAttachments(removedNotifications).catch(() => []);
      const notificationMessages = notificationAttachments.map(createAttachmentMessage);

      const existingPrompts = new Set<string>();
      for (const m of messagesRef.current) {
        if (
          m.type === 'attachment' &&
          m.attachment!.type === 'queued_command' &&
          m.attachment!.commandMode === 'task-notification' &&
          typeof m.attachment!.prompt === 'string'
        ) {
          existingPrompts.add(m.attachment!.prompt);
        }
      }
      const uniqueNotifications = notificationMessages.filter(
        m =>
          m.attachment.type === 'queued_command' &&
          (typeof m.attachment.prompt !== 'string' || !existingPrompts.has(m.attachment.prompt)),
      );

      startBackgroundSession({
        messages: [
          ...messagesRef.current,
          ...uniqueNotifications,
          ...(abortController?.signal.reason === 'background'
            ? [
                createUserMessage({
                  content: 'Continue where you left off — you were backgrounded mid-response.',
                  isMeta: true,
                }),
              ]
            : []),
        ],
        queryParams: {
          systemPrompt,
          userContext,
          systemContext,
          canUseTool,
          toolUseContext,
          querySource: getQuerySourceForREPL(),
        },
        description: terminalTitle,
        setAppState,
        agentDefinition: mainThreadAgentDefinition,
      });
    })();
  }, [
    turnController,
    mainLoopModel,
    toolPermissionContext,
    mainThreadAgentDefinition,
    getToolUseContext,
    customSystemPrompt,
    appendSystemPrompt,
    canUseTool,
    setAppState,
    addNotification,
    messageQueue,
    messagesRef,
    terminalTitle,
  ]);

  const { handleBackgroundSession } = useSessionBackgrounding({
    setMessages,
    setIsLoading: setIsExternalLoading,
    resetLoadingState,
    setAbortController,
    onBackgroundQuery: handleBackgroundQuery,
  });

  const onQueryEvent = useCallback(
    (event: Parameters<typeof handleMessageFromStream>[0]) => {
      turnController.dispatchStreamEvent({
        event,
        setMessages,
        messagesRef,
        setConversationId,
        setAppState,
        streamingDisplayStore,
        salvageRef,
        refusalReplacesUuidsRef,
        clearStreamingText,
        pipeReturnHadErrorRef,
        relayPipeMessage,
        setResponseLength,
        setStreamMode,
        setStreamingToolUses,
        setStreamingThinking,
        responseLengthRef,
        apiMetricsRef,
        onStreamingText,
        displayTransform,
        setInProgressToolUseIDs,
        addNotification,
        onCompacted: scrollPin.resetForCompaction,
      });
    },
    [
      turnController,
      setMessages,
      messagesRef,
      setResponseLength,
      setStreamMode,
      setStreamingToolUses,
      setStreamingThinking,
      onStreamingText,
      displayTransform,
      clearStreamingText,
      streamingDisplayStore,
      salvageRef,
      refusalReplacesUuidsRef,
      pipeReturnHadErrorRef,
      relayPipeMessage,
      responseLengthRef,
      apiMetricsRef,
      setAppState,
      setConversationId,
      setInProgressToolUseIDs,
      addNotification,
      scrollPin,
    ],
  );

  const turnStartMessageIndexRef = useRef(0);
  const handleTurnComplete = useCallback(
    async (turnMessages: MessageType[], terminalReason?: string) => {
      if (process.env.CLAUDE_JOB_DIR || process.env.CLAUDE_CODE_SESSION_KIND === 'bg') {
        try {
          const { isBgJobSession, shouldSuppressTurnEndNeedsInput, clearBgNeedsInputOnReply } = await import(
            '../../utils/bgNeedsInputBridge.js'
          );
          if (isBgJobSession()) {
            const turnSlice = turnMessages.slice(turnStartMessageIndexRef.current);
            const textParts: string[] = [];
            const toolNames: string[] = [];
            for (const msg of turnSlice) {
              if (msg.type !== 'assistant' || !Array.isArray(msg.message?.content)) continue;
              for (const block of msg.message.content) {
                if (block.type === 'text' && typeof block.text === 'string') {
                  textParts.push(block.text);
                } else if (block.type === 'tool_use' && typeof block.name === 'string') {
                  toolNames.push(block.name);
                }
              }
            }
            const stateSnap = store.getState();
            const hasActiveOverlayPrompt =
              stateSnap.workerSandboxPermissions.queue.length > 0 || stateSnap.elicitation.queue.length > 0;
            if (
              !hasActiveOverlayPrompt &&
              shouldSuppressTurnEndNeedsInput({
                assistantText: textParts.join('\n'),
                toolNames,
              })
            ) {
              await clearBgNeedsInputOnReply();
            }
          }
        } catch {
          // Never throw into turn completion
        }
      }
      await onTurnComplete?.(turnMessages, terminalReason);
    },
    [onTurnComplete, store],
  );

  const workflowHumanPromptCountRef = useRef(0);
  const usageLimitMenuWaitRef = useRef<{
    choseWaitInMenu: boolean;
    previousResetsAt?: number;
    fired: boolean;
  }>({ choseWaitInMenu: false, fired: false });
  const handleOpenRateLimitOptionsRef = useRef<() => void>(() => {});

  useEffect(() => {
    const unsubEvents = subscribeQuotaAutoResumeEvents(event => {
      if (event === 'armed' || event === 'taken-over') {
        const st = getQuotaAutoResumeState();
        usageLimitMenuWaitRef.current = {
          choseWaitInMenu: true,
          previousResetsAt: st.phase === 'armed' ? st.resetsAtSeconds : undefined,
          fired: false,
        };
        if (st.phase === 'armed') {
          const resetsAt = st.resetsAtSeconds ?? Math.floor(st.fireAtMs / 1000);
          for (const t of Object.values(store.getState().tasks ?? {})) {
            if (isLocalWorkflowTask(t) && (t.status === 'running' || t.status === 'paused')) {
              setWorkflowRateLimitWait(
                t.id,
                {
                  resetsAt,
                  resumeAtMs: st.fireAtMs,
                  waitingAgents: Math.max(1, t.agentCount),
                },
                setAppState,
              );
            }
          }
        }
      } else if (event === 'fired-now') {
        if (usageLimitMenuWaitRef.current.choseWaitInMenu) {
          usageLimitMenuWaitRef.current.fired = true;
        }
        reconcileWorkflowRateLimitWaitOnEvent({
          tasks: store.getState().tasks ?? {},
          loginRelation: 'same',
          humanPrompts: workflowHumanPromptCountRef.current,
          nowMs: Date.now(),
          setAppState,
        });
      } else if (event === 'login-changed') {
        usageLimitMenuWaitRef.current = { choseWaitInMenu: false, fired: false };
        const holdResult = reconcileWorkflowRateLimitWaitOnEvent({
          tasks: store.getState().tasks ?? {},
          loginRelation: 'other',
          humanPrompts: workflowHumanPromptCountRef.current,
          nowMs: Date.now(),
          setAppState,
        });
        const hasPausedWorkflow = holdResult.anyHeld;
        addNotification({
          key: hasPausedWorkflow ? 'workflow-rate-limit-held-login' : 'quota-auto-resume-login-changed',
          kind: 'warning',
          text: hasPausedWorkflow ? WORKFLOW_HELD_FOR_LOGIN_NOTICE : AUTO_CONTINUE_LOGIN_CHANGED_NOTICE,
          priority: 'immediate',
          timeoutMs: 8_000,
        });
      } else if (
        event === 'cancelled' ||
        event === 'disabled' ||
        event === 'horizon-exceeded' ||
        event === 'cap-exhausted' ||
        event === 'auto-armed'
      ) {
        usageLimitMenuWaitRef.current = { choseWaitInMenu: false, fired: false };
        if (event === 'cancelled' || event === 'disabled') {
          for (const t of Object.values(store.getState().tasks ?? {})) {
            if (isLocalWorkflowTask(t) && t.rateLimitWait !== undefined) {
              setWorkflowRateLimitWait(t.id, undefined, setAppState);
            }
          }
        }
      }
    });
    let prevPhase = getQuotaAutoResumeState().phase;
    const unsubChanged = subscribeQuotaAutoResumeChanged(() => {
      const nextPhase = getQuotaAutoResumeState().phase;
      if (prevPhase === 'armed' && nextPhase === 'idle' && usageLimitMenuWaitRef.current.choseWaitInMenu) {
        usageLimitMenuWaitRef.current.fired = true;
      }
      prevPhase = nextPhase;
    });
    const onQuotaRejected = (limits: { status?: string; resetsAt?: number }, bucket: 'main_thread' | 'other') => {
      if (bucket !== 'main_thread') return;
      const waitState = usageLimitMenuWaitRef.current;
      if (!waitState.choseWaitInMenu || !waitState.fired) return;
      const headers = new Headers();
      if (limits.status) {
        headers.set('anthropic-ratelimit-unified-status', limits.status);
      }
      const err = new APIError(429, undefined, 'Rate limit exceeded', headers);
      if (
        shouldOpenUsageLimitMenuAfterWaitRefusal(err, {
          choseWaitInMenu: true,
          previousResetsAt: waitState.previousResetsAt,
          nextResetsAt: limits.resetsAt,
        })
      ) {
        usageLimitMenuWaitRef.current = { choseWaitInMenu: false, fired: false };
        cancelQuotaAutoResume('dialog');
        handleOpenRateLimitOptionsRef.current();
      }
    };
    quotaRejectedListeners.add(onQuotaRejected);
    return () => {
      unsubEvents();
      unsubChanged();
      quotaRejectedListeners.delete(onQuotaRejected);
    };
  }, [addNotification, store, setAppState]);

  const onQuery = useCallback(
    (
      newMessages: MessageType[],
      abortController: AbortController,
      shouldQuery: boolean,
      additionalAllowedTools: string[],
      mainLoopModelParam: string,
      onBeforeQueryCallback?: (input: string, newMessages: MessageType[]) => Promise<boolean>,
      input?: string,
      effort?: EffortValue,
      stopHookActive?: boolean,
      clientPlatform?: string,
      additionalDisallowedTools: string[] = [],
    ): Promise<boolean> => {
      turnStartMessageIndexRef.current = messagesRef.current.length;
      const trimmedInput = input?.trimStart() ?? '';
      const isSlashInput = trimmedInput.startsWith('/');
      const commandName = isSlashInput ? trimmedInput.slice(1).split(/\s+/)[0] : undefined;
      let effectiveShouldQuery = shouldQuery;
      if (isCodeModeEnabled()) {
        if (isSlashInput && codeModeInterruptedByEscRef.current) {
          if (
            !shouldAutoStartCodeModeTurnAfterCommand({
              interruptedByEsc: codeModeInterruptedByEscRef.current,
              commandName,
              isLocalCommand: !shouldQuery,
            })
          ) {
            effectiveShouldQuery = false;
          }
        } else if (!isSlashInput && shouldQuery) {
          codeModeInterruptedByEscRef.current = false;
        }
      }
      return turnController
        .runTurn(
          {
            newMessages,
            abortController,
            shouldQuery: effectiveShouldQuery,
            additionalAllowedTools,
            mainLoopModelParam,
            onBeforeQueryCallback,
            input,
            effort,
            stopHookActive,
            clientPlatform,
            additionalDisallowedTools,
          },
          {
            store,
            queryGuard,
            initialMcpClients,
            titleDisabled,
            sessionTitle,
            sessionAiTitle,
            agentTitle,
            haikuTitleAttemptedRef,
            titleFallbackRef,
            titleRequestRef,
            setHaikuTitle,
            commands,
            setConversationId,
            setAppState,
            messagesRef,
            setMessages,
            resetLoadingState,
            setAbortController,
            getToolUseContext,
            toolPermissionContext,
            terminalFocusRef,
            mainThreadAgentDefinition,
            customSystemPrompt,
            appendSystemPrompt,
            canUseTool,
            hostEngine,
            engineFeed: turnController.engineFeed,
            awaitSessionStartHooks: turnController.awaitSessionStartHooks,
            onEngineRead: turnController.beginEngineRead,
            onMainRequestStart: turnController.noteMainRequestAnnounced,
            onQueryEvent,
            addNotification,
            leftArrowDeferRef,
            inputValueRef,
            markIdleForkMidTurn,
            leftArrowToAgentsFired,
            buddyEnabled,
            pipeReturnHadErrorRef,
            relayPipeMessage,
            apiMetricsRef,
            loadingStartTimeRef,
            totalPausedMsRef,
            swarmStartTimeRef,
            swarmBudgetInfoRef,
            backgroundWaitStartTimeRef,
            onTurnComplete: handleTurnComplete,
            resetTimingRefs,
            responseLengthRef,
            setStreamingToolUses,
            clearStreamingText,
            displayTransform,
            mrOnBeforeQuery,
            mrOnTurnComplete,
            setLastQueryCompletionTime,
            sendBridgeResultRef,
            proactiveActive,
            restoreMessageSyncRef,
            onCompacted: scrollPin.resetForCompaction,
          },
        )
        .then(
          ok => {
            if (usageLimitMenuWaitRef.current.fired) {
              usageLimitMenuWaitRef.current = { choseWaitInMenu: false, fired: false };
            }
            return ok;
          },
          err => {
            const waitState = usageLimitMenuWaitRef.current;
            if (
              waitState.choseWaitInMenu &&
              waitState.fired &&
              shouldOpenUsageLimitMenuAfterWaitRefusal(err, {
                choseWaitInMenu: true,
                previousResetsAt: waitState.previousResetsAt,
                nextResetsAt: currentLimits.resetsAt,
              })
            ) {
              usageLimitMenuWaitRef.current = { choseWaitInMenu: false, fired: false };
              cancelQuotaAutoResume('dialog');
              handleOpenRateLimitOptionsRef.current();
            }
            throw err;
          },
        );
    },
    [
      turnController,
      store,
      queryGuard,
      initialMcpClients,
      titleDisabled,
      sessionTitle,
      sessionAiTitle,
      agentTitle,
      commands,
      setConversationId,
      setAppState,
      setMessages,
      resetLoadingState,
      setAbortController,
      getToolUseContext,
      toolPermissionContext,
      mainThreadAgentDefinition,
      customSystemPrompt,
      appendSystemPrompt,
      canUseTool,
      hostEngine,
      onQueryEvent,
      addNotification,
      markIdleForkMidTurn,
      buddyEnabled,
      handleTurnComplete,
      resetTimingRefs,
      setStreamingToolUses,
      clearStreamingText,
      displayTransform,
      mrOnBeforeQuery,
      mrOnTurnComplete,
      proactiveActive,
      setHaikuTitle,
      setLastQueryCompletionTime,
      messagesRef,
      haikuTitleAttemptedRef,
      titleFallbackRef,
      titleRequestRef,
      terminalFocusRef,
      leftArrowDeferRef,
      inputValueRef,
      leftArrowToAgentsFired,
      pipeReturnHadErrorRef,
      relayPipeMessage,
      apiMetricsRef,
      loadingStartTimeRef,
      totalPausedMsRef,
      swarmStartTimeRef,
      swarmBudgetInfoRef,
      backgroundWaitStartTimeRef,
      responseLengthRef,
      sendBridgeResultRef,
      restoreMessageSyncRef,
      codeModeInterruptedByEscRef,
      scrollPin,
    ],
  );

  const { routeToSelectedPipes } = usePipeRouter({ store, setAppState, addNotification });

  const onSubmit = useCallback(
    async (
      input: string,
      helpers: PromptInputHelpers,
      speculationAccept?: {
        state: ActiveSpeculationState;
        speculationSessionTimeSavedMs: number;
        setAppState: SetAppState;
      },
      options?: {
        fromKeybinding?: boolean;
        inputModeOverride?: PromptInputMode;
        pastedContentsOverride?: Record<number, PastedContent>;
        resumesStaleQuotaWait?: boolean;
        sendNow?: boolean;
        sendQueuedOnly?: boolean;
        queueSubmit?: boolean;
        composerEnter?: unknown;
      },
    ) => {
      const trimmedSubmit = input.trimStart();
      if (trimmedSubmit.length > 0 && !trimmedSubmit.startsWith('/')) {
        codeModeInterruptedByEscRef.current = false;
        workflowHumanPromptCountRef.current += 1;
        for (const t of Object.values(store.getState().tasks ?? {})) {
          if (isLocalWorkflowTask(t) && t.rateLimitWait?.isHeldForLogin) {
            const evaluated = evaluateWorkflowRateLimitLoginHold({
              status: t.rateLimitWait,
              loginRelation: 'other',
              humanPrompts: workflowHumanPromptCountRef.current,
              nowMs: Date.now(),
            });
            if (evaluated.shouldResumeNow) {
              setWorkflowRateLimitWait(t.id, undefined, setAppState);
            }
          }
        }
      }
      await submitController.submit(
        input,
        helpers,
        {
          isLoading,
          isExternalLoading,
          inputMode,
          commands,
          mainLoopModel,
          pastedContents,
          ideSelection,
          stashedPrompt,
          getStashedPrompt: () => stashedPromptRef.current,
          getAbortController: () => turnController.abortController,
          getCurrentInput: () => inputValueRef.current,
          getMessages: () => messagesRef.current,
          getStreamMode: () => streamModeRef.current,
          getHasInterruptibleToolInProgress: () => hasInterruptibleToolInProgressRef.current,
          onResetTipPickedThisTurn: () => {
            tipPickedThisTurnRef.current = false;
          },
          queuedNowLowLatencyHost,
          activeRemote,
          querySource: getQuerySourceForREPL(),
          readFileState,
          setAppState,
          setMessages,
          setInputValue,
          setInputMode,
          setPastedContents,
          setIDESelection,
          setSubmitCount,
          setUserInputOnProcessing,
          setStashedPrompt,
          setToolJSX,
          setAbortControllerForQuery,
          addNotification,
          getToolUseContext,
          onQuery,
          onBeforeQuery,
          canUseTool,
          repinScroll,
          routeToSelectedPipes,
          onClearSubmitted: () => {
            resetTeamLeadVerificationOnSessionBoundary();
            idleReturnController.onClearSubmitted();
          },
          resetTimingRefs,
          consumeIdeSelection,
          recordIdeSelectionConsumedBy,
          restoreIdeSelectionConsumedBy,
          restoreHandedBackPrompt,
          onResumeProactive: () => proactiveModule?.resumeProactive(),
        },
        speculationAccept,
        options,
      );
    },
    [
      submitController,
      store,
      isLoading,
      isExternalLoading,
      inputMode,
      commands,
      setInputValue,
      setInputMode,
      setPastedContents,
      setSubmitCount,
      setIDESelection,
      setToolJSX,
      getToolUseContext,
      mainLoopModel,
      pastedContents,
      ideSelection,
      setUserInputOnProcessing,
      setAbortControllerForQuery,
      addNotification,
      onQuery,
      stashedPrompt,
      stashedPromptRef,
      setStashedPrompt,
      setAppState,
      onBeforeQuery,
      canUseTool,
      activeRemote,
      queuedNowLowLatencyHost,
      turnController,
      idleReturnController,
      resetTimingRefs,
      routeToSelectedPipes,
      setMessages,
      repinScroll,
      consumeIdeSelection,
      recordIdeSelectionConsumedBy,
      restoreIdeSelectionConsumedBy,
      restoreHandedBackPrompt,
      codeModeInterruptedByEscRef,
      inputValueRef,
      messagesRef,
      streamModeRef,
      hasInterruptibleToolInProgressRef,
      tipPickedThisTurnRef,
      readFileState,
    ],
  );

  // Handle initial message (from CLI args or plan mode exit with context clear)
  const initialMessageRef = useRef(false);
  useEffect(() => {
    const pending = initialMessage;
    if (!pending || isLoading || initialMessageRef.current) return;

    initialMessageRef.current = true;

    async function processInitialMessage(initialMsg: NonNullable<typeof pending>) {
      if ('replay' in initialMsg) {
        setAppState(prev => (prev.initialMessage === null ? prev : { ...prev, initialMessage: null }));
        if (queryGuard.isActive) {
          logForDebugging('[reply-on-resume] query already active — skip');
        } else {
          const {
            stripTrailingIncompleteTurnMessages,
            canReplayContinueFromMessages,
            findForkBoundaryUuidAfterStrip,
            checkInterruptedOutputBoundary,
            buildInterruptedOutputHintContent,
            buildInterruptedOutputNotice,
            formatPrefillBoundaryMismatchLog,
            formatPartialHintLog,
          } = await import('../../utils/replyOnResume.js');

          setMessages(prev => {
            const next = stripTrailingIncompleteTurnMessages(prev);
            return next === prev ? prev : next;
          });

          const stripped = stripTrailingIncompleteTurnMessages(messagesRef.current);
          if (stripped !== messagesRef.current) {
            messagesRef.current = stripped as typeof messagesRef.current;
          }

          if (
            isCodeModeEnabled() &&
            didSessionEndDuringCodeModeScript(
              messagesRef.current as unknown as Parameters<typeof didSessionEndDuringCodeModeScript>[0],
            )
          ) {
            logForDebugging('[reply-on-resume] Code Mode session ended mid-script — waiting for next prompt');
          } else if (canReplayContinueFromMessages(messagesRef.current)) {
            let prefillText: string | undefined;
            let prefillBoundary: string | undefined;
            try {
              const jobDir = process.env.CLAUDE_JOB_DIR;
              if (jobDir) {
                const { readAdoptPrefill } = await import('../../utils/bgCheckpoint.js');
                const prefill = await readAdoptPrefill(jobDir);
                if (prefill?.text) {
                  prefillText = prefill.text;
                  prefillBoundary = prefill.boundaryUuid ?? undefined;
                }
              }
            } catch {
              /* best-effort */
            }

            const forkBoundary = findForkBoundaryUuidAfterStrip(messagesRef.current);
            const boundaryCheck = checkInterruptedOutputBoundary(
              prefillText ? { text: prefillText, boundaryUuid: prefillBoundary } : null,
              forkBoundary,
            );
            if (prefillText && !boundaryCheck.accept) {
              logForDebugging(formatPrefillBoundaryMismatchLog(prefillBoundary ?? '', forkBoundary ?? ''));
            } else if (prefillText && boundaryCheck.accept) {
              const hint = buildInterruptedOutputHintContent(prefillText);
              setMessages(prev => [
                ...prev,
                createSystemMessage(buildInterruptedOutputNotice(prefillText), 'warning'),
                createUserMessage({ content: hint, isMeta: true }),
              ]);
              logForDebugging(formatPartialHintLog(prefillText.length));
            }

            logForDebugging('[reply-on-resume] → onQuery');
            const newAbortController = createAbortController();
            setAbortControllerForQuery(newAbortController);
            void onQuery([], newAbortController, true, [], mainLoopModel);
          } else {
            logForDebugging('[reply-on-resume] → markReplayNoOp ($co false)');
          }
        }
        setTimeout(
          ref => {
            ref.current = false;
          },
          100,
          initialMessageRef,
        );
        return;
      }

      if (initialMsg.clearContext) {
        const oldPlanSlug = initialMsg.message.planContent ? getPlanSlug() : undefined;

        const { clearConversation } = await import('../../commands/clear/conversation.js');
        await clearConversation({
          setMessages,
          readFileState: readFileState.current,
          discoveredSkillNames: discoveredSkillNamesRef.current,
          loadedNestedMemoryPaths: loadedNestedMemoryPathsRef.current,
          pendingNestedMemoryTriggers: pendingNestedMemoryTriggersRef.current,
          getAppState: () => store.getState(),
          setAppState,
          setConversationId,
          taskRegistry,
        });
        resetTeamLeadVerificationOnSessionBoundary();
        haikuTitleAttemptedRef.current = false;
        titleFallbackRef.current = undefined;
        if (titleRequestRef.current) {
          if (!titleRequestRef.current.abortController.signal.aborted) {
            titleRequestRef.current.abortController.abort('session_clear');
          }
          titleRequestRef.current = null;
        }
        setHaikuTitle(undefined);
        bashTools.current.clear();
        bashHosts.current.clear();
        bashToolsProcessedIdx.current = 0;

        if (oldPlanSlug) {
          setPlanSlug(getSessionId(), oldPlanSlug);
        }
      }

      setAppState(prev => {
        let updatedToolPermissionContext = initialMsg.mode
          ? applyPermissionUpdates(
              prev.toolPermissionContext,
              buildPermissionUpdates(initialMsg.mode, initialMsg.allowedPrompts),
            )
          : prev.toolPermissionContext;
        if (feature('TRANSCRIPT_CLASSIFIER')) {
          if (initialMsg.mode === 'auto') {
            updatedToolPermissionContext = stripDangerousPermissionsForAutoMode({
              ...updatedToolPermissionContext,
              mode: 'auto',
              prePlanMode: undefined,
            });
          }
        }

        return {
          ...prev,
          initialMessage: null,
          toolPermissionContext: updatedToolPermissionContext,
        };
      });

      if (fileHistoryEnabled()) {
        void fileHistoryMakeSnapshot((updater: (prev: FileHistoryState) => FileHistoryState) => {
          setAppState(prev => ({
            ...prev,
            fileHistory: updater(prev.fileHistory),
          }));
        }, initialMsg.message.uuid);
      }

      const content = initialMsg.message.message.content;
      if (typeof content === 'string' && !initialMsg.message.planContent) {
        void onSubmit(content, {
          setCursorOffset: () => {},
          clearBuffer: () => {},
          resetHistory: () => {},
        });
      } else {
        const newAbortController = createAbortController();
        setAbortControllerForQuery(newAbortController);

        void onQuery([initialMsg.message], newAbortController, true, [], mainLoopModel);
      }

      setTimeout(
        ref => {
          ref.current = false;
        },
        100,
        initialMessageRef,
      );
    }

    void processInitialMessage(pending);
  }, [
    initialMessage,
    isLoading,
    setMessages,
    setAppState,
    onQuery,
    mainLoopModel,
    tools,
    queryGuard,
    messagesRef,
    setAbortControllerForQuery,
    readFileState,
    discoveredSkillNamesRef,
    loadedNestedMemoryPathsRef,
    pendingNestedMemoryTriggersRef,
    store,
    setConversationId,
    taskRegistry,
    haikuTitleAttemptedRef,
    titleFallbackRef,
    titleRequestRef,
    setHaikuTitle,
    bashTools,
    bashHosts,
    bashToolsProcessedIdx,
    onSubmit,
  ]);

  const onAgentSubmit = useCallback(
    async (
      input: string,
      task: InProcessTeammateTaskState | LocalAgentTaskState,
      helpers: PromptInputHelpers,
      submittedPastedContents?: Record<number, PastedContent>,
    ) => {
      const effectivePasted = submittedPastedContents ?? pastedContents;
      const pastedImageValues = Object.values(effectivePasted).filter(p => p.type === 'image');
      let cachedImagePaths: ReadonlyMap<number, string> = store.getState().storedImagePaths;
      if (
        pastedImageValues.length > 0 &&
        (!isLocalAgentTask(task) || pastedImageValues.some(p => p.unavailable || !p.content))
      ) {
        const { storeImages } = await import('../../utils/imageStore.js');
        const stored = await storeImages(effectivePasted, setAppState).catch(() => new Map<number, string>());
        if (stored.size > 0) {
          cachedImagePaths = new Map([...cachedImagePaths, ...stored]);
        }
      }
      const agentMessageContent = buildAgentMessageContentWithImages(input, effectivePasted, {
        inlineImages: isLocalAgentTask(task),
        cachedImagePaths,
      });
      const expandedPromptText =
        typeof agentMessageContent === 'string' ? agentMessageContent : expandPastedTextRefs(input, effectivePasted);
      if (isLocalAgentTask(task)) {
        const humanMsg = createUserMessage({
          content: agentMessageContent,
          origin: { kind: 'human' },
        });
        appendMessageToLocalAgent(task.id, humanMsg, setAppState);
        if (task.status === 'running') {
          queuePendingMessage(task.id, agentMessageContent, setAppState, {
            isMeta: true,
            origin: { kind: 'human' },
            shownAs: humanMsg.uuid,
          });
        } else {
          void resumeAgentBackground({
            agentId: task.id,
            prompt: agentMessageContent,
            toolUseContext: getToolUseContext(messagesRef.current, [], new AbortController(), mainLoopModel),
            canUseTool,
            userInitiated: true,
            promptIsMeta: true,
            promptOrigin: { kind: 'human' },
          }).catch(err => {
            logForDebugging(`resumeAgentBackground failed: ${errorMessage(err)}`);
            addNotification({
              key: `resume-agent-failed-${task.id}`,
              jsx: <Text color="error">Failed to resume agent: {errorMessage(err)}</Text>,
              priority: 'low',
            });
          });
        }
      } else {
        injectUserMessageToTeammate(task.id, expandedPromptText, undefined, setAppState);
      }
      setInputValue('');
      setPastedContents({});
      helpers.setCursorOffset(0);
      helpers.clearBuffer();
      clearHeldClearedDraft();
    },
    [
      setAppState,
      setInputValue,
      setPastedContents,
      pastedContents,
      getToolUseContext,
      canUseTool,
      mainLoopModel,
      addNotification,
      store,
      messagesRef,
    ],
  );

  const handleAutoRunIssue = useCallback(() => {
    const command = autoRunIssueReason ? getAutoRunCommand(autoRunIssueReason) : '/issue';
    setAutoRunIssueReason(null);
    onSubmit(command, {
      setCursorOffset: () => {},
      clearBuffer: () => {},
      resetHistory: () => {},
    }).catch(err => {
      logForDebugging(`Auto-run ${command} failed: ${errorMessage(err)}`);
    });
  }, [onSubmit, autoRunIssueReason, setAutoRunIssueReason]);

  const handleCancelAutoRunIssue = useCallback(() => {
    setAutoRunIssueReason(null);
  }, [setAutoRunIssueReason]);

  const handleSurveyRequestFeedback = useCallback(() => {
    const command = '/feedback';
    onSubmit(command, {
      setCursorOffset: () => {},
      clearBuffer: () => {},
      resetHistory: () => {},
    }).catch(err => {
      logForDebugging(`Survey feedback request failed: ${err instanceof Error ? err.message : String(err)}`);
    });
  }, [onSubmit]);

  const onSubmitRef = useRef(onSubmit);
  onSubmitRef.current = onSubmit;
  resumeReturnCompactRef.current = () => {
    void onSubmitRef
      .current('/compact', {
        setCursorOffset: () => {},
        clearBuffer: () => {},
        resetHistory: () => {},
      })
      .catch(err => {
        logForDebugging(`Resume-return compact failed: ${errorMessage(err)}`);
      });
  };
  resumeReturnClearRef.current = () => {
    void onSubmitRef
      .current('/clear', {
        setCursorOffset: () => {},
        clearBuffer: () => {},
        resetHistory: () => {},
      })
      .catch(err => {
        logForDebugging(`Cold-resume new conversation (/clear) failed: ${errorMessage(err)}`);
      });
  };

  const handleOpenRateLimitOptions = useCallback(() => {
    if (inputModeRef.current === 'bash' && draftController.mode !== 'bash') {
      draftController.setMode('bash');
    }
    if (draftController.mode === 'bash') {
      draftController.clear();
      draftController.setMode('prompt');
      inputValueRef.current = '';
      setPastedContents({});
      setInputMode('prompt');
    } else if (draftController.value.length > 0) {
      return;
    }
    void onSubmitRef.current(
      '/rate-limit-options',
      {
        setCursorOffset: () => {},
        clearBuffer: () => {},
        resetHistory: () => {},
      },
      undefined,
      { inputModeOverride: 'prompt' },
    );
  }, [draftController, setInputMode, setPastedContents, inputModeRef, inputValueRef]);
  handleOpenRateLimitOptionsRef.current = handleOpenRateLimitOptions;

  // Official 2.1.323 (#2119): hold bridge idle while background subagents are active
  const backgroundHold = useMemo(
    () => ({
      holdsRunning: () =>
        Object.values(store.getState().tasks ?? {}).some(
          t => (t.type === 'local_agent' || t.type === 'in_process_teammate') && t.status === 'running',
        ),
    }),
    [store],
  );
  const pendingBridgeResultForBackgroundHoldRef = useRef(false);

  const bridgeAbortController = useMemo(
    () => ({
      get current() {
        return turnController.abortController;
      },
    }),
    [turnController],
  );
  const { sendBridgeResult } = useReplBridge(messages, setMessages, bridgeAbortController, commands, mainLoopModel);
  sendBridgeResultRef.current = () => {
    if (backgroundHold.holdsRunning()) {
      pendingBridgeResultForBackgroundHoldRef.current = true;
      return;
    }
    pendingBridgeResultForBackgroundHoldRef.current = false;
    sendBridgeResult();
  };
  useEffect(() => {
    if (!pendingBridgeResultForBackgroundHoldRef.current) return;
    if (!backgroundHold.holdsRunning() && !isLoading) {
      pendingBridgeResultForBackgroundHoldRef.current = false;
      sendBridgeResult();
    }
  }, [tasks, isLoading, backgroundHold, sendBridgeResult]);

  // Official 2.1.323 (#2113): sync terminal-only blocking dialogs with active Remote Control bridge
  const activeTerminalBlockingDialogKindsRef = useRef<Set<string>>(new Set());
  const lastSyncedBridgeRef = useRef<TerminalBlockingDialogBridge | null>(null);
  useEffect(() => {
    const bridge = getReplBridgeHandle();
    if (!bridge?.setTerminalOnlyBlockingDialog) {
      activeTerminalBlockingDialogKindsRef.current = new Set();
      lastSyncedBridgeRef.current = null;
      return;
    }

    const nextKinds = new Set<string>();

    if (topDialogKind) {
      const isTerminalOnlyPermission = isPermissionPromptDialog(topDialogKind) && !replBridgePermissionCallbacks;
      const isTerminalOnlyDialog =
        topDialogKind === SANDBOX_NETWORK_ACCESS_KIND || !isPermissionPromptDialog(topDialogKind);
      if (isTerminalOnlyPermission || isTerminalOnlyDialog) {
        nextKinds.add(topDialogKind);
      }
    }
    if (workerSandboxPermissions.queue.length > 0) {
      nextKinds.add('worker_sandbox_permission');
    }
    if (elicitation.queue.length > 0) {
      nextKinds.add('mcp_elicitation');
    }
    if (
      focusedInputDialog === 'left-arrow-confirm' ||
      focusedInputDialog === 'ultraplan-choice' ||
      focusedInputDialog === 'ultraplan-launch'
    ) {
      nextKinds.add(focusedInputDialog);
    }
    if (pke.kind === 'dialog') {
      nextKinds.add('exit_flow');
    }

    syncTerminalOnlyBlockingDialogs(bridge, nextKinds, activeTerminalBlockingDialogKindsRef, lastSyncedBridgeRef);
  }, [
    topDialogKind,
    replBridgePermissionCallbacks,
    replBridgeSessionActive,
    workerSandboxPermissions.queue.length,
    elicitation.queue.length,
    focusedInputDialog,
    pke.kind,
  ]);
  useEffect(() => {
    return () => {
      const bridge = getReplBridgeHandle();
      if (bridge?.setTerminalOnlyBlockingDialog) {
        for (const kind of activeTerminalBlockingDialogKindsRef.current) {
          bridge.setTerminalOnlyBlockingDialog(kind, false);
        }
      }
      activeTerminalBlockingDialogKindsRef.current.clear();
      lastSyncedBridgeRef.current = null;
    };
  }, []);

  return {
    handleBackgroundSession,
    onQuery,
    onSubmit,
    onAgentSubmit,
    handleAutoRunIssue,
    handleCancelAutoRunIssue,
    handleSurveyRequestFeedback,
    handleOpenRateLimitOptions,
  };
}
