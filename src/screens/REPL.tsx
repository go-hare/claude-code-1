// biome-ignore-all assist/source/organizeImports: ANT-ONLY import markers must not be reordered
import { feature } from 'bun:bundle';
import {
  AlternateScreen,
  Box,
  MenuWaitContext,
  useTerminalFocus,
  useTerminalNotification,
  useTheme,
} from '@anthropic/ink';
import { resolveAgentTools } from '@claude-code/builtin-tools/tools/AgentTool/agentToolUtils.js';
import { TungstenLiveMonitor } from '@claude-code/builtin-tools/tools/TungstenTool/TungstenLiveMonitor.js';
import { randomUUID } from 'crypto';
import * as React from 'react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { shouldShowDesktopUpsellStartup } from 'src/components/DesktopUpsell/DesktopUpsellStartup.js';
import { useFeedbackSurvey } from 'src/components/FeedbackSurvey/useFeedbackSurvey.js';
import { useMemorySurvey } from 'src/components/FeedbackSurvey/useMemorySurvey.js';
import { usePostCompactSurvey } from 'src/components/FeedbackSurvey/usePostCompactSurvey.js';
import { useClaudeCodeHintRecommendation } from 'src/hooks/useClaudeCodeHintRecommendation.js';
import { useFileHistorySnapshotInit } from 'src/hooks/useFileHistorySnapshotInit.js';
import { useLspPluginRecommendation } from 'src/hooks/useLspPluginRecommendation.js';
import { usePromptsFromClaudeInChrome } from 'src/hooks/usePromptsFromClaudeInChrome.js';
import { useSearchExtraToolsHint } from 'src/hooks/useSearchExtraToolsHint.js';
import { useKickOffCheckAndDisableAutoModeIfNeeded } from 'src/utils/permissions/bypassPermissionsKillswitch.js';
import { getIsRemoteMode, getMainThreadAgentId, getProjectRoot, getSessionId } from '../bootstrap/state.js';
import { CompanionSprite, MIN_COLS_FOR_FULL_SPRITE } from '../buddy/CompanionSprite.js';
import { isBuddyEnabled } from '../buddy/enabled.js';
import { REMOTE_SAFE_COMMANDS, type Command } from '../commands.js';
import { AwsAuthStatusBox } from '../components/AwsAuthStatusBox.js';
import { ReplDiffSidebarController } from '../components/diff/ReplDiffSidebarController.js';
import { shouldShowEffortCallout } from '../components/EffortCallout.js';
import { FullscreenLayout } from '../components/FullscreenLayout.js';
import { MessageActionsKeybindings } from '../components/messageActions.js';
import { Messages, type MessagesSource } from '../components/Messages.js';
import type { ToolUseConfirm } from '../components/permissions/PermissionRequest.js';
import {
  BORDER_MARK_INSET,
  CLOSE_MARK_CELLS,
  DOCK_GRIP_COLUMNS,
  DOCK_KEY_COLUMNS,
  INLINE_KEY_ROWS,
  PluginPaneDockHost,
  PluginPaneKeyResize,
  chooseDockRoom,
  chooseInlineRoom,
  getDockRoomColumns,
  getInlineRoomRows,
  keepPluginPaneRoom,
  paneTitleChromeRows,
  pluginPaneDockColumns,
  pluginPaneInlineRows,
  subscribeDockRoom,
  usePaneToastHold,
} from '../components/PluginRasterPanes.js';
import { ToastStackView } from '../components/PromptInput/Notifications.js';
import PromptInput from '../components/PromptInput/PromptInput.js';
import { PromptInputQueuedCommands } from '../components/PromptInput/PromptInputQueuedCommands.js';
import {
  classifyFailedTurnAction,
  getFailedRequestPlaceholder,
} from '../components/PromptInput/usePromptInputPlaceholder.js';
import { hideSessionTitleFromTasks } from '../components/PromptInput/useSwarmBanner.js';
import { isVimModeEnabled } from '../components/PromptInput/utils.js';
import { ScrollKeybindingHandler } from '../components/ScrollKeybindingHandler.js';
import { SessionBackgroundHint } from '../components/SessionBackgroundHint.js';
import { BriefIdleStatus, SpinnerWithVerb, type SpinnerMode } from '../components/Spinner.js';
import { TaskListV2 } from '../components/TaskListV2.js';
import { TeammateViewHeader } from '../components/TeammateViewHeader.js';
import { useNotifications } from '../context/notifications.js';
import { RenderPacingContext, type RenderPacing } from '../context/renderPacingContext.js';
import { useSessionServices } from '../context/sessionServices.js';
import {
  DialogHost,
  PermissionDialogHostProvider,
  RequestDialogContext,
  SANDBOX_NETWORK_ACCESS_KIND,
  createDialogMailbox,
  createRequestDialog,
  isFullscreenModalChromeActive,
  isPermissionPromptDialog,
  isTopDialogModalLayout,
  useDialogMailboxBridge,
  useDialogStore,
  useHasBlockingOpenDialogs,
  useHasOpenDialogs,
  useNhtHidesPromptInput,
  usePermissionMirrorSink,
  useTopDialog,
  useTopDialogKind,
} from '../dialog/index.js';
import type { HostEngine } from '../engine/hostEngine.js';
import { useApiKeyVerification } from '../hooks/useApiKeyVerification.js';
import { CancelRequestHandler } from '../hooks/useCancelRequest.js';
import { CommandKeybindingHandlers } from '../hooks/useCommandKeybindings.js';
import { useCommandQueue } from '../hooks/useCommandQueue.js';
import { GlobalKeybindingHandlers } from '../hooks/useGlobalKeybindings.js';
import { useIDEIntegration } from '../hooks/useIDEIntegration.js';
import { useIdeLogging } from '../hooks/useIdeLogging.js';
import { useIdeSelection } from '../hooks/useIdeSelection.js';
import { useIssueFlagBanner } from '../hooks/useIssueFlagBanner.js';
import { useMainLoopModel } from '../hooks/useMainLoopModel.js';
import { useManagePlugins } from '../hooks/useManagePlugins.js';
import { preferLiveMcpClients, useMergedClients } from '../hooks/useMergedClients.js';
import { useMergedCommands } from '../hooks/useMergedCommands.js';
import { useMergedTools } from '../hooks/useMergedTools.js';
import { useRemoteSession } from '../hooks/useRemoteSession.js';
import type { RemoteRequestDialog } from '../hooks/useRemoteUserDialog.js';
import { useSkillImprovementSurvey } from '../hooks/useSkillImprovementSurvey.js';
import { useSkillsChange } from '../hooks/useSkillsChange.js';
import { useSSHSession } from '../hooks/useSSHSession.js';
import { useSwarmInitialization } from '../hooks/useSwarmInitialization.js';
import { useTasksV2WithCollapseEffect } from '../hooks/useTasksV2.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import { KeybindingSetup } from '../keybindings/KeybindingProviderSetup.js';
import { useMoreRight } from '../moreright/useMoreRight.js';
import { getCodeModeStateVersion, subscribeCodeModeState } from '../services/codeMode/optIn.js';
import { registerCompactCleanup } from '../services/compact/postCompactCleanup.js';
import { MCPConnectionManager } from '../services/mcp/MCPConnectionManager.js';
import type { ScopedMcpServerConfig } from '../services/mcp/types.js';
import { markPersonActivityForPromptSuggestion } from '../services/PromptSuggestion/promptSuggestion.js';
import {
  useAppState,
  useAppStateSession,
  useAppStateStore,
  useMcpConnections,
  useMessageQueue,
  useSessionHooksRegistry,
  useSetAppState,
} from '../state/AppState.js';
import { LeftoverMhrRetryRow } from '../state/leftoverIhrStore.js';
import { createStore } from '../state/store.js';
import { isInProcessTeammateTask } from '../tasks/InProcessTeammateTask/types.js';
import { isLocalAgentTask } from '../tasks/LocalAgentTask/LocalAgentTask.js';
import { getTools } from '../tools.js';
import type { Message as MessageType, UserMessage } from '../types/message.js';
import type { VimMode } from '../types/textInputTypes.js';
import { createAbortController } from '../utils/abortController.js';
import { countUserPromptsInMessages } from '../utils/attribution.js';
import {
  AutoRunIssueNotification,
  getAutoRunIssueReasonText,
  shouldAutoRunIssue,
  type AutoRunIssueReason,
} from '../utils/autoRunIssue.js';
import type { AutoUpdaterResult } from '../utils/autoUpdater.js';
import { wireClipboardAttacherCaps } from '../utils/clipboardAttacher.js';
import type { PastedContent } from '../utils/config.js';
import { logForDebugging } from '../utils/debug.js';
import { isEnvTruthy } from '../utils/envUtils.js';
import {
  READ_FILE_STATE_CACHE_SIZE,
  createFileStateCacheWithSizeLimit,
  mergeFileStateCaches,
} from '../utils/fileStateCache.js';
import { abortOnNowPriorityCommand } from '../utils/foregroundToolCalls.js';
import { isFullscreenEnvEnabled, mouseTrackingProp } from '../utils/fullscreen.js';
import { shouldShowFullscreenUpsell } from '../utils/fullscreenUpsellGate.js';
import type { IDEExtensionInstallationStatus, IdeType } from '../utils/ide.js';
import type { LeftArrowConfirmState } from '../utils/leftArrowConfirm.js';
import { isPoppableEditableCommand, type MessageQueueInstance } from '../utils/messageQueueManager.js';
import { createSystemMessage } from '../utils/messages.js';
import {
  getPanesState,
  getRasterFrameVersion,
  getShownPluginPane,
  offerPlacement,
  subscribeRasterFrames,
} from '../utils/plugins/functionHooksModules.js';
import { getPromptInputCursorState, subscribePromptInputCursorStore } from '../utils/promptInputCursorStore.js';
import {
  extractBashHostsFromMessages,
  extractBashToolsFromMessages,
  extractReadFilesFromMessages,
} from '../utils/queryHelpers.js';
import { computeDiffSidebarWidth, diffSidebarHasGitRepo, useReplDiffAutoOpenBaseline } from '../utils/replDiffTab.js';
import { removeLeaderToolUseConfirm } from '../utils/swarm/leaderPermissionBridge.js';
import { createTaskRegistry } from '../utils/taskRegistry.js';
import { createContentReplacementState, provisionContentReplacementState } from '../utils/toolResultStorage.js';
import { ToolStateSlots } from '../utils/toolState.js';
import { isDiffPanelEnabled } from '../utils/willowCrate.js';
import {
  ReplAbovePromptSurveys,
  ReplBottomPostPromptOverlays,
  ReplBottomPrePromptOverlays,
  ReplInlinePluginPane,
} from './repl/ReplBottomOverlays.js';
import {
  EMPTY_MCP_CLIENTS,
  EMPTY_MESSAGES,
  EMPTY_STREAMING_TOOL_USES,
  EMPTY_STRING_SET,
  PROACTIVE_FALSE,
  PROACTIVE_NO_OP_SUBSCRIBE,
  PROACTIVE_NULL,
  computeDialogPanelVisibility,
  computeDisplayedAgentMessages,
  computeLocalAgentInProgressToolUseIDs,
  createInitialRenderPacing,
  normalizeInitialMessages,
} from './repl/replHelpers.js';
import { createReplHostEngine } from './repl/replHostEngine.js';
import { SessionEngine } from './repl/SessionEngine.js';
import { SubmitController } from './repl/SubmitController.js';
import { AnimatedTerminalTitle, PromptBannerFooter, TranscriptView } from './repl/TranscriptComponents.js';
import { TranscriptProjection } from './repl/TranscriptProjection.js';
import { TurnController } from './repl/TurnController.js';
import type {
  DeferredAdoptResumeRefs,
  FocusedInputDialog,
  LeftArrowDeferArm,
  LocalJSXCommandState,
  PkeState,
  PromptQueueItem,
  Props,
  Screen,
  SetToolJSXArgs,
  ToolJSXState,
} from './repl/types.js';
import { useReplBgAdopt } from './repl/useReplBgAdopt.js';
import { useReplCancelAndQueue } from './repl/useReplCancelAndQueue.js';
import { useReplDialogAndElicitation } from './repl/useReplDialogAndElicitation.js';
import { useReplDraftAndScroll } from './repl/useReplDraftAndScroll.js';
import { useReplIntegrations } from './repl/useReplIntegrations.js';
import { useReplLeftArrowAgents } from './repl/useReplLeftArrowAgents.js';
import { useReplPluginAndCompactHost } from './repl/useReplPluginAndCompactHost.js';
import { useReplRewindAndActions } from './repl/useReplRewindAndActions.js';
import { useReplSandboxAndPermissions } from './repl/useReplSandboxAndPermissions.js';
import { useReplSessionLifecycle } from './repl/useReplSessionLifecycle.js';
import { useReplStartupAndNotices } from './repl/useReplStartupAndNotices.js';
import { useReplStreamingAndSpinner } from './repl/useReplStreamingAndSpinner.js';
import { useReplTerminalStatus } from './repl/useReplTerminalStatus.js';
import { useReplToolUseContext } from './repl/useReplToolUseContext.js';
import { useReplTranscriptMode } from './repl/useReplTranscriptMode.js';
import { useReplTurnOrchestration } from './repl/useReplTurnOrchestration.js';
import { ViewController } from './repl/ViewController.js';

// 100% backwards-compatible re-export barrel
export { RewindBackupsStillCopyingError, type Props, type Screen } from './repl/types.js';
export {
  buildAgentMessageContentWithImages,
  computeDialogPanelVisibility,
  formatBackgroundAgentImageNote,
} from './repl/replHelpers.js';
export {
  buildProgramStatusState,
  collectProgramStatusAwaited,
  collectProgramStatusChildren,
  encodeOsc7501Status,
  type ProgramStatusChild,
  type ProgramStatusPayload,
} from './repl/programStatus.js';
export { buildTranscriptShortcutHints, packTranscriptShortcutColumns } from './repl/TranscriptComponents.js';

/* eslint-disable custom-rules/no-process-env-top-level, @typescript-eslint/no-require-imports */
const VoiceKeybindingHandler: typeof import('../hooks/useVoiceIntegration.js').VoiceKeybindingHandler = feature(
  'VOICE_MODE',
)
  ? require('../hooks/useVoiceIntegration.js').VoiceKeybindingHandler
  : () => null;
const useFrustrationDetection: typeof import('../components/FeedbackSurvey/useFrustrationDetection.js').useFrustrationDetection =
  process.env.USER_TYPE === 'ant'
    ? require('../components/FeedbackSurvey/useFrustrationDetection.js').useFrustrationDetection
    : () => ({ state: 'closed', handleTranscriptSelect: () => {} });
const proactiveModule = feature('PROACTIVE') || feature('KAIROS') ? require('../proactive/index.js') : null;
const usePipeRelay = feature('UDS_INBOX')
  ? require('../hooks/usePipeRelay.js').usePipeRelay
  : () => ({ relayPipeMessage: () => false, pipeReturnHadErrorRef: { current: false } });
const shouldShowAntModelSwitch =
  process.env.USER_TYPE === 'ant'
    ? require('../components/AntModelSwitchCallout.js').shouldShowModelSwitchCallout
    : (): boolean => false;
/* eslint-enable custom-rules/no-process-env-top-level, @typescript-eslint/no-require-imports */

/**
 * Official 2.1.328 `yko` wrapper around `kje` (REPLInner): provides
 * `RenderPacingContext` (`SY`) for `useVirtualScroll` sticky-range gating.
 */
export function REPL(props: Props): React.ReactNode {
  const [renderPacing] = useState<RenderPacing | null>(createInitialRenderPacing);
  return (
    <RenderPacingContext.Provider value={renderPacing}>
      <REPLInner {...props} />
    </RenderPacingContext.Provider>
  );
}

function REPLInner({
  commands: initialCommands,
  debug,
  initialTools,
  initialMessages,
  pendingHookMessages,
  initialFileHistorySnapshots,
  initialContentReplacements,
  initialAgentName: _initialAgentName,
  initialAgentColor: _initialAgentColor,
  mcpClients: initialMcpClients,
  dynamicMcpConfig: initialDynamicMcpConfig,
  autoConnectIdeFlag,
  strictMcpConfig = false,
  systemPrompt: customSystemPrompt,
  appendSystemPrompt,
  appendSubagentSystemPrompt,
  fallbackModel,
  onBeforeQuery,
  onTurnComplete,
  disabled = false,
  mainThreadAgentDefinition: initialMainThreadAgentDefinition,
  disableSlashCommands = false,
  taskListId,
  remoteSessionConfig,
  sshSession,
  thinkingConfig,
  onOpenAgents,
  initialAutoContinuePrompt,
  engine: externalHostEngine,
  onCommandsChange,
  onQueryParamsChange,
  resumeSep2663Tasks,
}: Props): React.ReactNode {
  wireClipboardAttacherCaps();
  const { storageV5, credentials } = useSessionServices();
  const isRemoteSession = !!remoteSessionConfig;

  const hostEngineOwned = externalHostEngine === undefined;
  const turnControllerRef = useRef<TurnController | null>(null);
  const messageQueueRef = useRef<MessageQueueInstance | null>(null);
  const [hostEngine] = useState<HostEngine>(() => {
    if (externalHostEngine) return externalHostEngine;
    return createReplHostEngine({ turnControllerRef, messageQueueRef });
  });
  useEffect(() => {
    return () => {
      if (!hostEngineOwned) return;
      turnControllerRef.current?.dispose();
      try {
        hostEngine.close();
      } catch {
        // closed-gate is idempotent; swallow unmount races
      }
    };
  }, [hostEngine, hostEngineOwned]);

  // Mount-time env gates
  const titleDisabled = useMemo(() => {
    try {
      const { isTerminalTitleDisabled } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../utils/residualFinalEnvGates.js') as typeof import('../utils/residualFinalEnvGates.js');
      return isTerminalTitleDisabled();
    } catch {
      return isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_TERMINAL_TITLE);
    }
  }, []);
  const moreRightEnabled = useMemo(
    () => process.env.USER_TYPE === 'ant' && isEnvTruthy(process.env.CLAUDE_MORERIGHT),
    [],
  );
  const disableVirtualScroll = useMemo(() => {
    try {
      const { isVirtualScrollDisabled } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../utils/residualFinalEnvGates.js') as typeof import('../utils/residualFinalEnvGates.js');
      return isVirtualScrollDisabled();
    } catch {
      return isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_VIRTUAL_SCROLL);
    }
  }, []);
  const disableMessageActionsRaw = useMemo(() => {
    try {
      const { isMessageActionsDisabled } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../utils/residualFinalEnvGates.js') as typeof import('../utils/residualFinalEnvGates.js');
      return isMessageActionsDisabled();
    } catch {
      return isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_MESSAGE_ACTIONS);
    }
  }, []);
  const disableMessageActions = feature('MESSAGE_ACTIONS') ? disableMessageActionsRaw : false;
  const buddyEnabled = isBuddyEnabled();
  const messageQueue = useMessageQueue();
  messageQueueRef.current = messageQueue;

  useEffect(() => {
    logForDebugging(`[REPL:mount] REPL mounted, disabled=${disabled}`);
    return () => logForDebugging(`[REPL:unmount] REPL unmounting`);
  }, [disabled]);

  useEffect(() => {
    if (!initialAutoContinuePrompt) return;
    messageQueue.enqueue({
      mode: 'prompt',
      value: initialAutoContinuePrompt,
      priority: 'next',
      isMeta: true,
    });
  }, [initialAutoContinuePrompt, messageQueue]);

  // Core AppState subscriptions
  const [mainThreadAgentDefinition, setMainThreadAgentDefinition] = useState(initialMainThreadAgentDefinition);
  const toolPermissionContext = useAppState(s => s.toolPermissionContext);
  const verbose = useAppState(s => s.verbose);
  const mcp = useAppState(s => s.mcp);
  const plugins = useAppState(s => s.plugins);
  const agentDefinitions = useAppState(s => s.agentDefinitions);
  const fileHistory = useAppState(s => s.fileHistory);
  const initialMessage = useAppState(s => s.initialMessage);
  const queuedCommands = useCommandQueue();
  const spinnerTip = useAppState(s => s.spinnerTip);
  const spinnerTipLabel = useAppState(s => s.spinnerTipLabel);
  const showExpandedTodos = useAppState(s => s.expandedView === 'tasks');
  const pendingWorkerRequest = useAppState(s => s.pendingWorkerRequest);
  const pendingSandboxRequest = useAppState(s => s.pendingSandboxRequest);
  const teamContext = useAppState(s => s.teamContext);
  const tasks = useAppState(s => s.tasks);
  const workerSandboxPermissions = useAppState(s => s.workerSandboxPermissions);
  const elicitation = useAppState(s => s.elicitation);
  const viewingAgentTaskId = useAppState(s => s.viewingAgentTaskId);
  const viewedAgentTranscript = useAppState(s =>
    s.viewingAgentTaskId ? s.transcripts?.[s.viewingAgentTaskId] : undefined,
  );
  const queueEditIndex = useAppState(s => s.queueEditIndex);
  const setAppState = useSetAppState();
  const willowCrateEnabled = isDiffPanelEnabled();
  const replTab = useAppState(s => s.replTab);
  const trackedFilesForDiff = useAppState(s => (willowCrateEnabled ? s.fileHistory.trackedFiles.size : 0));
  const replDiffAutoOpenBaseline = useReplDiffAutoOpenBaseline(willowCrateEnabled, trackedFilesForDiff, setAppState);
  const { columns: replDiffColumns } = useTerminalSize();
  const isBriefOnly = useAppState(s => s.isBriefOnly);
  const briefTranscript = useAppState(s => s.briefTranscript);
  const showRemoteCallout = useAppState(s => s.showRemoteCallout);
  const ultraplanPendingChoice = useAppState(s => s.ultraplanPendingChoice);
  const ultraplanLaunchPending = useAppState(s => s.ultraplanLaunchPending);
  const authChangeGenerationForAntProfile = useAppState(s => s.authChangeGeneration);
  const reducedMotion = useAppState(s => s.settings.prefersReducedMotion) ?? false;
  const replBridgePermissionCallbacks = useAppState(s => s.replBridgePermissionCallbacks);
  const replBridgeSessionActive = useAppState(s => s.replBridgeSessionActive);
  const terminalTitleFromRename = useAppState(s => s.settings.terminalTitleFromRename) !== false;

  // Core controller instances
  const store = useAppStateStore();
  const mcpConnections = useMcpConnections();
  const sessionHooksRegistry = useSessionHooksRegistry();
  const appStateSession = useAppStateSession();
  const [sessionEngine] = useState(
    () =>
      new SessionEngine({
        store,
        session: appStateSession,
        initialCommands,
        initialTools,
        initialDynamicMcpConfig,
        mainThreadAgentDefinition,
      }),
  );
  const [turnController] = useState(
    () =>
      new TurnController({
        store,
        initialLoading: remoteSessionConfig?.hasInitialPrompt ?? false,
        ownsEngine: hostEngineOwned,
      }),
  );
  turnControllerRef.current = turnController;
  useEffect(() => {
    onQueryParamsChange?.(turnController.readPendingQueryParams);
  }, [onQueryParamsChange, turnController]);
  const queryGuard = turnController.guard;
  const [submitController] = useState(() => new SubmitController({ store, turnController, messageQueue, queryGuard }));
  const [viewController] = useState(() => new ViewController());
  const [normalizedInitialMessages] = useState<MessageType[]>(() =>
    normalizeInitialMessages(initialMessages, store.getState().initialMessage),
  );
  const [transcriptProjection] = useState(
    () => new TranscriptProjection({ store, initialMessages: normalizedInitialMessages }),
  );
  useEffect(
    () => () => {
      sessionEngine.dispose();
      turnController.dispose();
      submitController.dispose();
      const currentSessionId: string = getSessionId();
      const mainAgentId: string = getMainThreadAgentId();
      sessionHooksRegistry.clear(currentSessionId);
      if (mainAgentId !== currentSessionId) {
        sessionHooksRegistry.clear(mainAgentId);
      }
    },
    [sessionEngine, turnController, submitController, sessionHooksRegistry],
  );

  const taskRegistry = useMemo(() => createTaskRegistry(() => store.getState(), setAppState), [store, setAppState]);
  useEffect(() => {
    const { getBootstrapSession: getBs } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../utils/sessionRoot.js') as typeof import('../utils/sessionRoot.js');
    return getBs().mcpSessionWiring.acquireClientsAccessor(() =>
      preferLiveMcpClients(store.getState().mcp.clients, initialMcpClients),
    );
  }, [initialMcpClients, store]);

  const deferredResumeRefs = useRef<DeferredAdoptResumeRefs>({});
  const terminal = useTerminalNotification();
  const mainLoopModel = useMainLoopModel();
  const [localCommands, setLocalCommands] = useState(initialCommands);
  const handleAgentsChange = useCallback(
    (agents: typeof agentDefinitions) => {
      setAppState(prev => ({ ...prev, agentDefinitions: agents }));
    },
    [setAppState],
  );
  useSkillsChange(isRemoteSession ? undefined : getProjectRoot(), setLocalCommands, handleAgentsChange);

  const proactiveActive = useSyncExternalStore<boolean>(
    proactiveModule?.subscribeToProactiveChanges ?? PROACTIVE_NO_OP_SUBSCRIBE,
    proactiveModule?.isProactiveActive ?? PROACTIVE_FALSE,
  );
  const proactiveNextTickAt = useSyncExternalStore<number | null>(
    proactiveModule?.subscribeToProactiveChanges ?? PROACTIVE_NO_OP_SUBSCRIBE,
    proactiveModule?.getNextTickAt ?? PROACTIVE_NULL,
  );
  const codeModeVersion = useSyncExternalStore(
    subscribeCodeModeState,
    getCodeModeStateVersion,
    getCodeModeStateVersion,
  );
  const localTools = useMemo(() => {
    void codeModeVersion;
    return getTools(toolPermissionContext);
  }, [toolPermissionContext, proactiveActive, isBriefOnly, codeModeVersion]);
  useKickOffCheckAndDisableAutoModeIfNeeded();

  const [dynamicMcpConfig, setDynamicMcpConfig] = useState<Record<string, ScopedMcpServerConfig> | undefined>(
    initialDynamicMcpConfig,
  );
  const dynamicMcpConfigRef = useRef(dynamicMcpConfig);
  dynamicMcpConfigRef.current = dynamicMcpConfig;
  const onChangeDynamicMcpConfig = useCallback(
    (
      next:
        | Record<string, ScopedMcpServerConfig>
        | ((prev: Record<string, ScopedMcpServerConfig> | undefined) => Record<string, ScopedMcpServerConfig>),
    ) => {
      setDynamicMcpConfig(prev => (typeof next === 'function' ? next(prev) : next));
    },
    [],
  );

  const [screen, setScreen] = useState<Screen>('prompt');
  const [showAllInTranscript, setShowAllInTranscript] = useState(false);
  const [dumpMode, setDumpMode] = useState(false);
  const { addNotification, removeNotification } = useNotifications();
  const mcpClients = useMergedClients(initialMcpClients, mcp.clients);

  const { ideSelection, bashesDialog: showBashesDialog } = useSyncExternalStore(
    viewController.subscribe,
    viewController.getSnapshot,
  );
  const setIDESelection = viewController.setIdeSelection;
  const consumeIdeSelection = viewController.consumeIdeSelection;
  const recordIdeSelectionConsumedBy = viewController.recordIdeSelectionConsumedBy;
  const returnIdeSelection = viewController.returnIdeSelection;
  const restoreIdeSelectionConsumedBy = viewController.restoreIdeSelectionConsumedBy;
  const setShowBashesDialog = viewController.setBashesDialog;
  const [ideToInstallExtension, setIDEToInstallExtension] = useState<IdeType | null>(null);
  const [ideInstallationStatus, setIDEInstallationStatus] = useState<IDEExtensionInstallationStatus | null>(null);

  const [showModelSwitchCallout, setShowModelSwitchCallout] = useState(() =>
    process.env.USER_TYPE === 'ant' ? shouldShowAntModelSwitch() : false,
  );
  const [showEffortCallout, setShowEffortCallout] = useState(() => shouldShowEffortCallout(mainLoopModel));
  const [showDesktopUpsellStartup, setShowDesktopUpsellStartup] = useState(() => shouldShowDesktopUpsellStartup());
  const [showFullscreenUpsell, setShowFullscreenUpsell] = useState(() => shouldShowFullscreenUpsell());
  const [showUndercoverCallout, setShowUndercoverCallout] = useState(false);
  const [autoUpdaterResult, setAutoUpdaterResult] = useState<AutoUpdaterResult | null>(null);

  const { recommendation: lspRecommendation, handleResponse: handleLspResponse } = useLspPluginRecommendation();
  const { recommendation: hintRecommendation, handleResponse: handleHintResponse } = useClaudeCodeHintRecommendation();
  const searchExtraToolsHint = useSearchExtraToolsHint();

  const combinedInitialTools = useMemo(() => [...localTools, ...initialTools], [localTools, initialTools]);
  useManagePlugins({ enabled: !isRemoteSession });
  const tasksV2 = useTasksV2WithCollapseEffect();
  usePromptsFromClaudeInChrome(isRemoteSession ? EMPTY_MCP_CLIENTS : mcpClients, toolPermissionContext.mode);
  useSwarmInitialization(setAppState, initialMessages, { enabled: !isRemoteSession });

  const mergedTools = useMergedTools(combinedInitialTools, mcp.tools, toolPermissionContext);
  const { tools, allowedAgentTypes } = useMemo(() => {
    if (!mainThreadAgentDefinition) {
      return { tools: mergedTools, allowedAgentTypes: undefined as string[] | undefined };
    }
    const resolved = resolveAgentTools(mainThreadAgentDefinition, mergedTools, false, true);
    return { tools: resolved.resolvedTools, allowedAgentTypes: resolved.allowedAgentTypes };
  }, [mainThreadAgentDefinition, mergedTools]);

  const commandsWithPlugins = useMergedCommands(localCommands, plugins.commands as Command[]);
  const mergedCommands = useMergedCommands(commandsWithPlugins, mcp.commands as Command[]);
  const commands = useMemo(() => (disableSlashCommands ? [] : mergedCommands), [disableSlashCommands, mergedCommands]);
  useEffect(() => {
    onCommandsChange?.(commands);
  }, [commands, onCommandsChange]);

  useIdeLogging(isRemoteSession ? EMPTY_MCP_CLIENTS : mcp.clients);
  useIdeSelection(isRemoteSession ? EMPTY_MCP_CLIENTS : mcp.clients, setIDESelection);

  // TurnController snapshot & stream mode
  const { abortController, isQueryActive, isExternalLoading, isLoading, streamMode, streamingToolUses } =
    useSyncExternalStore(turnController.subscribe, turnController.getSnapshot);
  const setAbortController = turnController.setAbortController;
  const setStreamingToolUses = turnController.setStreamingToolUses;
  const setStreamingThinking = turnController.setStreamingThinking;
  const [outputLimitRecovery, setOutputLimitRecovery] = useState<
    import('../components/Spinner/statusKind.js').OutputLimitRecovery | null
  >(null);
  const setStreamMode = useCallback(
    (mode: SpinnerMode) => {
      turnController.setStreamMode(mode);
      if (mode !== 'requesting') setOutputLimitRecovery(null);
      try {
        const { leftoverIhrUxe, leftoverIhr } =
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          require('../utils/collapseReadSearch.js') as typeof import('../utils/collapseReadSearch.js');
        leftoverIhr.main.setMode(mode);
        if (mode !== 'thinking') leftoverIhrUxe.setSpinnerMessage(null);
      } catch {
        // isolation — optional
      }
    },
    [turnController],
  );
  const streamModeRef = useRef(streamMode);
  streamModeRef.current = streamMode;
  const [liveStateRowMounted] = useState(false);

  // SIGTERM shutdown abort & promoteToNow abort
  useEffect(() => {
    const { registerInteractiveShutdownAbort } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../utils/gracefulShutdown.js') as typeof import('../utils/gracefulShutdown.js');
    const { createAbortErrorReason } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../utils/abortController.js') as typeof import('../utils/abortController.js');
    registerInteractiveShutdownAbort(() => {
      const ac = turnController.abortController;
      if (ac && !ac.signal.aborted) {
        ac.abort(createAbortErrorReason('remote-cancel'));
      }
      void hostEngine.interrupt('remote-cancel');
      try {
        const { cancelLoopWakeupsOnUserAbort } =
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          require('../utils/loopDynamic.js') as typeof import('../utils/loopDynamic.js');
        cancelLoopWakeupsOnUserAbort('remote_cancel');
      } catch {
        // optional
      }
    });
    return () => registerInteractiveShutdownAbort(null);
  }, [hostEngine, turnController]);

  useEffect(() => {
    return messageQueue.subscribe(() => {
      abortOnNowPriorityCommand(turnController.abortController);
    });
  }, [messageQueue, turnController]);

  const localJSXClosedAtRef = useRef(0);
  const sendBridgeResultRef = useRef<() => void>(() => {});
  const restoreMessageSyncRef = useRef<(m: UserMessage, earlierBatch?: UserMessage[]) => void>(() => {});

  // Timing refs & placeholder state
  const [userInputOnProcessing, setUserInputOnProcessingRaw] = useState<string | undefined>(undefined);
  const [placeholderBaseline, setPlaceholderBaseline] = useState<number | undefined>(undefined);
  // densable 2.1.218 #18: monotonic clock for turn duration (performance.now),
  // not Date.now wall clock — NTP / clock adjustments must not yield negative
  // or wildly incorrect "Done in Ns" lines.
  const loadingStartTimeRef = useRef<number>(0);
  const totalPausedMsRef = useRef(0);
  const pauseStartTimeRef = useRef<number | null>(null);
  const resetTimingRefs = useCallback(() => {
    loadingStartTimeRef.current = performance.now();
    totalPausedMsRef.current = 0;
    pauseStartTimeRef.current = null;
  }, []);
  const wasQueryActiveRef = useRef(false);
  if (isQueryActive && !wasQueryActiveRef.current) {
    resetTimingRefs();
  }
  wasQueryActiveRef.current = isQueryActive;
  const setIsExternalLoading = useCallback(
    (value: boolean) => {
      const wasLoading = turnController.getSnapshot().isLoading;
      turnController.setExternalLoading(value);
      if (value && !wasLoading) resetTimingRefs();
    },
    [turnController, resetTimingRefs],
  );
  const swarmStartTimeRef = useRef<number | null>(null);
  const backgroundWaitStartTimeRef = useRef<number | null>(null);
  const swarmBudgetInfoRef = useRef<{ tokens: number; limit: number; nudges: number } | undefined>(undefined);
  const focusedInputDialogRef = useRef<FocusedInputDialog>(undefined);
  const isPromptInputActive = useSyncExternalStore(
    subscribePromptInputCursorStore,
    () => getPromptInputCursorState().active,
    () => getPromptInputCursorState().active,
  );

  // Tool JSX overlay state
  const [toolJSX, setToolJSXInternal] = useState<ToolJSXState | null>(null);
  const localJSXCommandRef = useRef<LocalJSXCommandState | null>(null);
  const setToolJSX = useCallback((args: SetToolJSXArgs) => {
    if (args?.isLocalJSXCommand) {
      const { clearLocalJSX: _, ...rest } = args;
      localJSXCommandRef.current = { ...rest, isLocalJSXCommand: true };
      setToolJSXInternal(rest);
      return;
    }
    if (localJSXCommandRef.current) {
      if (args?.clearLocalJSX) {
        localJSXCommandRef.current = null;
        setToolJSXInternal(null);
        localJSXClosedAtRef.current = Date.now();
        return;
      }
      return;
    }
    if (args?.clearLocalJSX) {
      setToolJSXInternal(null);
      return;
    }
    setToolJSXInternal(args);
  }, []);

  // DialogStore host & queues
  const [toolUseConfirmQueue, setToolUseConfirmQueue] = useState<ToolUseConfirm[]>([]);
  const dialogMailboxRef = useRef(createDialogMailbox());
  useDialogMailboxBridge(dialogMailboxRef.current);
  usePermissionMirrorSink();
  const requestDialog = useMemo(() => createRequestDialog(dialogMailboxRef.current), []);
  const topDialogKind = useTopDialogKind();
  const topDialog = useTopDialog();
  const hasOpenDialogs = useHasOpenDialogs();
  const hasBlockingOpenDialogs = useHasBlockingOpenDialogs();
  const rawHidePromptForHardNms = useNhtHidesPromptInput();
  const dialogStore = useDialogStore();
  const resumeReturnCompactRef = useRef<() => void>(() => {});
  const resumeReturnClearRef = useRef<() => void>(() => {});
  const [permissionStickyFooter, setPermissionStickyFooter] = useState<React.ReactNode | null>(null);
  const [promptQueue, setPromptQueue] = useState<PromptQueueItem[]>([]);
  const [pke, setPke] = useState<PkeState>({ kind: 'none' });
  const [isMessageSelectorVisible, setIsMessageSelectorVisible] = useState(false);
  const [messageSelectorPreselect, setMessageSelectorPreselect] = useState<UserMessage | undefined>(undefined);
  const [leftArrowConfirm, setLeftArrowConfirm] = useState<LeftArrowConfirmState | null>(null);
  const leftArrowDeferRef = useRef<LeftArrowDeferArm | null>(null);
  const leftArrowToAgentsFired = useRef(false);
  const [handOverInFlight] = useState(() => createStore(false));
  const [conversationId, setConversationId] = useState<string>(() => randomUUID());
  const [dialogHostUnmounted, setDialogHostUnmounted] = useState(false);
  const fileHistoryCopyPromiseRef = useRef<Promise<void> | null>(null);

  // 1. Terminal title, session status & OSC 7501 program status
  const {
    sessionTitle,
    sessionAiTitle,
    agentTitle,
    terminalTitle,
    haikuTitleAttemptedRef,
    titleFallbackRef,
    titleRequestRef,
    setHaikuTitle,
    isWaitingForApproval,
    isShowingLocalJSXCommand,
    titleIsAnimating,
    sessionStatus,
    waitingFor,
    sessionWorking,
    sessionWaitingFor,
    showStatusInTerminalTab,
  } = useReplTerminalStatus({
    terminalTitleFromRename,
    initialMessagesLength: initialMessages?.length ?? 0,
    mainThreadAgentDefinition,
    isPromptInputActive,
    hasBlockingOpenDialogs,
    promptQueue,
    pendingWorkerRequest,
    pendingSandboxRequest,
    elicitation,
    workerSandboxPermissions,
    toolJSX,
    tasks,
    topDialogKind,
    topDialog,
    queryGuard,
    isLoading,
    isQueryActive,
    requestDialog,
    titleDisabled,
    transcriptProjection,
    messageQueue,
  });

  // 2. ScrollPin, transcript projection, QueuedNowLowLatency & PromptDraftController
  const draftAndScroll = useReplDraftAndScroll({
    store,
    setAppState,
    transcriptProjection,
    turnController,
    queryGuard,
    messageQueue,
    dialogStore,
    taskRegistry,
    isBriefOnly,
    briefTranscript,
    screen,
    disableVirtualScroll,
    dumpMode,
    isLoading,
    userInputOnProcessing,
    remoteSessionConfig,
    buddyEnabled,
    pendingHookMessages,
    topDialogKind,
  });
  const {
    scrollPin,
    scrollViewport,
    modalScrollViewport,
    messages,
    messagesRef,
    setMessages,
    queuedNowLowLatencyHost,
    turnStartRef,
    markIdleForkMidTurn,
    setAbortControllerForQuery,
    onMessagesRowsDrawn,
    unseenDivider,
    cursor,
    setCursor,
    cursorNavRef,
    repinScroll,
    repinScrollRef,
    composedOnScroll,
    draftController,
    inputValueRef,
    promptEmpty,
    hasDraft,
    inputValue,
    insertTextRef,
    setInputValue,
    setInputValueRaw,
    inputMode,
    inputModeRef,
    setInputMode,
    restoreHandedBackPrompt,
    stashedPrompt,
    stashedPromptRef,
    setStashedPrompt,
  } = draftAndScroll;

  const setUserInputOnProcessing = useCallback(
    (input: string | undefined) => {
      if (input !== undefined) {
        setPlaceholderBaseline(messagesRef.current.length);
      } else {
        setPlaceholderBaseline(undefined);
      }
      setUserInputOnProcessingRaw(input);
    },
    [messagesRef],
  );

  const handleRemoteInit = useCallback((remoteSlashCommands: string[]) => {
    const remoteCommandSet = new Set(remoteSlashCommands);
    setLocalCommands(prev => prev.filter(cmd => remoteCommandSet.has(cmd.name) || REMOTE_SAFE_COMMANDS.has(cmd)));
  }, []);

  const [inProgressToolUseIDs, rawSetInProgressToolUseIDs] = useState<Set<string>>(new Set());
  const setInProgressToolUseIDs = useCallback(
    (updater: React.SetStateAction<Set<string>>) => {
      rawSetInProgressToolUseIDs(prev => {
        const next = typeof updater === 'function' ? updater(prev) : updater;
        if (next === prev || (next.size === prev.size && [...next].every(id => prev.has(id)))) {
          return prev;
        }
        return next;
      });
      taskRegistry.updateTranscript(getMainThreadAgentId(), prev => {
        const next = typeof updater === 'function' ? updater(prev.inProgressToolUseIDs) : updater;
        if (
          next === prev.inProgressToolUseIDs ||
          (next.size === prev.inProgressToolUseIDs.size && [...next].every(id => prev.inProgressToolUseIDs.has(id)))
        ) {
          return prev;
        }
        return { ...prev, inProgressToolUseIDs: next };
      });
    },
    [taskRegistry],
  );
  const hasInterruptibleToolInProgressRef = useRef(false);

  const remoteSession = useRemoteSession({
    config: remoteSessionConfig,
    setMessages,
    setIsLoading: setIsExternalLoading,
    onInit: handleRemoteInit,
    setToolUseConfirmQueue,
    dialogStore,
    tools: combinedInitialTools,
    setStreamingToolUses,
    setStreamMode,
    setInProgressToolUseIDs,
    requestDialog: requestDialog as unknown as RemoteRequestDialog,
  });
  const sshRemote = useSSHSession({
    session: sshSession,
    setMessages,
    setIsLoading: setIsExternalLoading,
    setToolUseConfirmQueue,
    dialogStore,
    tools: combinedInitialTools,
  });
  const activeRemote = sshRemote.isRemoteMode ? sshRemote : remoteSession;

  const [pastedContents, setPastedContents] = useState<Record<number, PastedContent>>({});
  const [submitCount, setSubmitCount] = useState(() => countUserPromptsInMessages(initialMessages ?? []));
  const [vimMode, setVimMode] = useState<VimMode>('INSERT');
  useEffect(() => {
    if (ultraplanPendingChoice && showBashesDialog) {
      setShowBashesDialog(false);
    }
  }, [ultraplanPendingChoice, showBashesDialog, setShowBashesDialog]);
  const [isSearchingHistory, setIsSearchingHistory] = useState(false);
  const [isHelpOpen, setIsHelpOpen] = useState(false);

  const isTerminalFocused = useTerminalFocus();
  const terminalFocusRef = useRef(isTerminalFocused);
  const prevTerminalFocusedRef = useRef(isTerminalFocused);
  terminalFocusRef.current = isTerminalFocused;
  useEffect(() => {
    const wasFocused = prevTerminalFocusedRef.current;
    prevTerminalFocusedRef.current = isTerminalFocused;
    if (!wasFocused && isTerminalFocused) {
      markPersonActivityForPromptSuggestion();
    }
  }, [isTerminalFocused]);

  const [theme] = useTheme();
  const tipPickedThisTurnRef = useRef(false);
  const [initialReadFileState] = useState(() => createFileStateCacheWithSizeLimit(READ_FILE_STATE_CACHE_SIZE));
  const readFileState = useRef(initialReadFileState);
  const [initialToolState] = useState(() => new ToolStateSlots());
  const toolStateRef = useRef(initialToolState);
  const bashTools = useRef(new Set<string>());
  const bashHosts = useRef(new Set<string>());
  const bashToolsProcessedIdx = useRef(0);
  const discoveredSkillNamesRef = useRef(new Set<string>());
  const loadedNestedMemoryPathsRef = useRef(new Set<string>());
  const pendingNestedMemoryTriggersRef = useRef(new Set<string>());
  const [contentReplacementStateRef] = useState(() => ({
    current: provisionContentReplacementState(initialMessages, initialContentReplacements),
  }));
  useEffect(
    () =>
      registerCompactCleanup(() => {
        contentReplacementStateRef.current = createContentReplacementState();
      }),
    [contentReplacementStateRef],
  );
  const restoreReadFileState = useCallback((msgs: MessageType[], cwd: string) => {
    const extracted = extractReadFilesFromMessages(msgs, cwd, READ_FILE_STATE_CACHE_SIZE);
    readFileState.current = mergeFileStateCaches(readFileState.current, extracted);
    for (const tool of extractBashToolsFromMessages(msgs)) {
      bashTools.current.add(tool);
    }
    for (const host of extractBashHostsFromMessages(msgs)) {
      bashHosts.current.add(host);
    }
  }, []);

  const { status: apiKeyStatus, reverify } = useApiKeyVerification();
  const [autoRunIssueReason, setAutoRunIssueReason] = useState<AutoRunIssueReason | null>(null);
  const didAutoRunIssueRef = useRef(false);
  const codeModeAutoBackgroundEligibleRef = useRef(false);
  const codeModeInterruptedByEscRef = useRef(false);
  const activeCompactionAbortRef = useRef<AbortController | null>(null);
  const abortInFlightCompaction = useCallback(() => {
    const ac = activeCompactionAbortRef.current;
    if (ac && !ac.signal.aborted) {
      ac.abort('compaction_cancelled');
    }
    activeCompactionAbortRef.current = null;
  }, []);

  // 3. Dialog & MCP elicitation state machine
  const dialogState = useReplDialogAndElicitation({
    store,
    setAppState,
    messageQueue,
    addNotification,
    elicitation,
    workerSandboxPermissions,
    ultraplanPendingChoice,
    ultraplanLaunchPending,
    showRemoteCallout,
    viewingAgentTaskId,
    hasDraft,
    isPromptInputActive,
    isLoading,
    toolJSX,
    isShowingLocalJSXCommand,
    pke,
    isMessageSelectorVisible,
    leftArrowConfirm,
    hasOpenDialogs,
    hasBlockingOpenDialogs,
    rawHidePromptForHardNms,
    promptQueue,
    showModelSwitchCallout,
    showUndercoverCallout,
    showEffortCallout,
    showDesktopUpsellStartup,
    showFullscreenUpsell,
    lspRecommendation,
    hintRecommendation,
    searchExtraToolsHint,
    focusedInputDialogRef,
  });
  const {
    setReopenedElicitationKey,
    elicitationCueBehindDraft,
    resolveMcpElicitationTaskId,
    mcpTaskQuestionHarnessesRef,
    deferredMcpElicitationsRef,
    deferredMcpAbortCleanupsRef,
    clearDeferredMcpElicitation,
    getOrCreateMcpTaskQuestionHarness,
    focusedInputDialog,
    hostParkMode,
    hidePromptForHardNms,
    tipOverlay,
    anyInputOverlay,
    hasSuppressedDialogs,
    modalChrome,
    isDialogChromeVisible,
    dialogSuppressReason,
  } = dialogState;

  // 4. Streaming preview, idle-return controller, spinner tips & visibility
  const streaming = useReplStreamingAndSpinner({
    store,
    setAppState,
    turnController,
    messageQueue,
    dialogStore,
    messages,
    messagesRef,
    setMessages,
    reducedMotion,
    isLoading,
    briefTranscript,
    isBriefOnly,
    screen,
    streamingToolUses,
    setStreamingToolUses,
    submitCount,
    toolJSX,
    focusedInputDialogRef,
    terminal,
    addNotification,
    removeNotification,
    remoteSessionConfig,
    theme,
    storageV5,
    readFileState,
    bashTools,
    bashHosts,
    bashToolsProcessedIdx,
    tipPickedThisTurnRef,
    setIsExternalLoading,
    setUserInputOnProcessing,
    userInputOnProcessing,
    setOutputLimitRecovery,
    tasks,
    inProgressToolUseIDs,
    viewingAgentTaskId,
    hasBlockingOpenDialogs,
    promptQueue,
    elicitation,
    elicitationCueBehindDraft,
    workerSandboxPermissions,
    pendingWorkerRequest,
    swarmStartTimeRef,
    swarmBudgetInfoRef,
  });
  const {
    responseLengthRef,
    compactProgressActiveRef,
    compactingHint,
    setCompactingHint,
    compactingStartTime,
    setCompactingStartTime,
    apiMetricsRef,
    setResponseLength,
    showStreamingText,
    streamingDisplayStore,
    onStreamingText,
    hasStreamingText,
    focusFoldHoldsPreview,
    clearStreamingText,
    salvageRef,
    refusalReplacesUuidsRef,
    displayTransform,
    getStreamingTextRaw,
    setLastQueryCompletionTime,
    setLastTurnStopTime,
    idleReturnController,
    spinnerMessage,
    setSpinnerMessage,
    spinnerColor,
    setSpinnerColor,
    spinnerShimmerColor,
    setSpinnerShimmerColor,
    retryStatus,
    setRetryStatus,
    resetLoadingState,
    showSpinner,
    focusedSpinnerRefs,
    afterReplyText,
    stopHookSpinnerSuffix,
  } = streaming;

  const failedRequestNextStepHint = useMemo(() => {
    if (isLoading || viewingAgentTaskId) return undefined;
    return getFailedRequestPlaceholder(classifyFailedTurnAction(messages), getIsRemoteMode());
  }, [isLoading, viewingAgentTaskId, messages]);

  const hasActivePrompt =
    hasBlockingOpenDialogs ||
    promptQueue.length > 0 ||
    topDialogKind === SANDBOX_NETWORK_ACCESS_KIND ||
    elicitation.queue.length > 0 ||
    workerSandboxPermissions.queue.length > 0;

  const feedbackSurveyOriginal = useFeedbackSurvey(messages, isLoading, submitCount, 'session', hasActivePrompt);
  const skillImprovementSurvey = useSkillImprovementSurvey(setMessages);
  useIssueFlagBanner(messages, submitCount);
  const feedbackSurvey = useMemo(
    () => ({
      ...feedbackSurveyOriginal,
      handleSelect: (selected: 'dismissed' | 'bad' | 'fine' | 'good') => {
        didAutoRunIssueRef.current = false;
        const showedTranscriptPrompt = feedbackSurveyOriginal.handleSelect(selected);
        if (selected === 'bad' && !showedTranscriptPrompt && shouldAutoRunIssue('feedback_survey_bad')) {
          setAutoRunIssueReason('feedback_survey_bad');
          didAutoRunIssueRef.current = true;
        }
      },
    }),
    [feedbackSurveyOriginal],
  );
  const postCompactSurvey = usePostCompactSurvey(messages, isLoading, hasActivePrompt, { enabled: !isRemoteSession });
  const memorySurvey = useMemorySurvey(messages, isLoading, hasActivePrompt, { enabled: !isRemoteSession });
  const frustrationDetection = useFrustrationDetection(
    messages,
    isLoading,
    hasActivePrompt,
    feedbackSurvey.state !== 'closed' || postCompactSurvey.state !== 'closed' || memorySurvey.state !== 'closed',
  );

  const {
    onBeforeQuery: mrOnBeforeQuery,
    onTurnComplete: mrOnTurnComplete,
    render: mrRender,
  } = useMoreRight({
    enabled: moreRightEnabled,
    setMessages,
    inputValue,
    setInputValue,
    setToolJSX,
  });

  useIDEIntegration({
    autoConnectIdeFlag,
    ideToInstallExtension,
    setDynamicMcpConfig,
    requestDialog,
    setIDEInstallationState: setIDEInstallationStatus,
  });
  useFileHistorySnapshotInit(initialFileHistorySnapshots, fileHistory, fileHistoryState =>
    setAppState(prev => ({ ...prev, fileHistory: fileHistoryState })),
  );

  useEffect(() => {
    if (!isLoading) return;
    const isPaused = viewingAgentTaskId != null;
    const now = performance.now();
    if (isPaused && pauseStartTimeRef.current === null) {
      pauseStartTimeRef.current = now;
    } else if (!isPaused && pauseStartTimeRef.current !== null) {
      totalPausedMsRef.current += now - pauseStartTimeRef.current;
      pauseStartTimeRef.current = null;
    }
  }, [viewingAgentTaskId, isLoading]);

  const hostPermissionOpen = isPermissionPromptDialog(topDialogKind);
  const belowTranscriptSlotOpen =
    hostPermissionOpen ||
    Boolean(toolJSX && !(isFullscreenEnvEnabled() && toolJSX.isLocalJSXCommand && toolJSX.isImmediate));
  useLayoutEffect(() => {
    scrollPin.onBelowTranscriptSlotChange(belowTranscriptSlotOpen);
  }, [belowTranscriptSlotOpen, scrollPin]);

  // Transcript swap (enter/exit agent view): repin ScrollBox so leftover scrollTop/HWM cannot leave a blank spacer.
  const prevViewingAgentRef = useRef(viewingAgentTaskId);
  useLayoutEffect(() => {
    if (prevViewingAgentRef.current === viewingAgentTaskId) return;
    prevViewingAgentRef.current = viewingAgentTaskId;
    repinScroll(true, 'agent-view-change');
  }, [viewingAgentTaskId, repinScroll]);

  // 5. Sandbox & permissions
  const {
    sandboxAsker,
    sandboxNetworkVerdictCacheRef,
    setSessionToolPermissionContext,
    setToolPermissionContext,
    canUseTool,
    requestPrompt,
  } = useReplSandboxAndPermissions({
    store,
    setAppState,
    requestDialog,
    dialogStore,
    toolPermissionContext,
    mergedTools,
    messagesRef,
    setToolUseConfirmQueue,
    setPromptQueue,
    addNotification,
  });

  // 6. Session lifecycle (/resume, /branch, resume-return, exit)
  const { resume, handleExit } = useReplSessionLifecycle({
    store,
    setAppState,
    requestDialog,
    dialogStore,
    messageQueue,
    queryGuard,
    messagesRef,
    initialMessages,
    initialMessage,
    initialMainThreadAgentDefinition,
    mainThreadAgentDefinition,
    setMainThreadAgentDefinition,
    mainLoopModel,
    addNotification,
    setMessages,
    setSubmitCount,
    setToolJSX,
    setInputValue,
    setPastedContents,
    setConversationId,
    setAbortController,
    resetLoadingState,
    repinScroll,
    restoreReadFileState,
    readFileState,
    bashTools,
    bashHosts,
    bashToolsProcessedIdx,
    fileHistoryCopyPromiseRef,
    haikuTitleAttemptedRef,
    titleFallbackRef,
    titleRequestRef,
    setHaikuTitle,
    contentReplacementStateRef,
    deferredResumeRefs,
    codeModeAutoBackgroundEligibleRef,
    codeModeInterruptedByEscRef,
    resumeReturnCompactRef,
    resumeReturnClearRef,
    setPke,
  });

  // 7. ToolUseContext builder & stranded agent resume
  const activeScheduledTurnRef = useRef<{ isScheduledTask: true; isLoop: boolean } | null>(null);
  const { getToolUseContext } = useReplToolUseContext({
    store,
    setAppState,
    sessionEngine,
    commands,
    combinedInitialTools,
    debug,
    fallbackModel,
    thinkingConfig,
    initialMcpClients,
    ideInstallationStatus,
    dynamicMcpConfig,
    theme,
    allowedAgentTypes,
    customSystemPrompt,
    appendSystemPrompt,
    appendSubagentSystemPrompt,
    mcpConnections,
    leftArrowDeferRef,
    inputValueRef,
    taskRegistry,
    setSessionToolPermissionContext,
    setMessages,
    messagesRef,
    disabled,
    setIsMessageSelectorVisible,
    reverify,
    readFileState,
    toolStateRef,
    setToolJSX,
    addNotification,
    terminal,
    onChangeDynamicMcpConfig,
    setIDEToInstallExtension,
    loadedNestedMemoryPathsRef,
    pendingNestedMemoryTriggersRef,
    discoveredSkillNamesRef,
    setResponseLength,
    responseLengthRef,
    apiMetricsRef,
    setStreamMode,
    setRetryStatus,
    setOutputLimitRecovery,
    setSpinnerColor,
    setSpinnerShimmerColor,
    setSpinnerMessage,
    setCompactingHint,
    setCompactingStartTime,
    compactProgressActiveRef,
    setInProgressToolUseIDs,
    hasInterruptibleToolInProgressRef,
    resume,
    strictMcpConfig,
    setConversationId,
    requestPrompt,
    contentReplacementStateRef,
    requestDialog,
    storageV5,
    credentials,
    replDiffColumns,
    activeScheduledTurnRef,
    deferredResumeRefs,
    canUseTool,
    mainLoopModel,
  });

  // 8. Plugin function-hooks & idle compaction host bindings
  useReplPluginAndCompactHost({
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
  });

  // 9. Pipe relay & turn orchestration (onQuery, onSubmit, onAgentSubmit, bridge)
  const { relayPipeMessage, pipeReturnHadErrorRef } = usePipeRelay();
  const {
    handleBackgroundSession,
    onQuery,
    onSubmit,
    onAgentSubmit,
    handleAutoRunIssue,
    handleCancelAutoRunIssue,
    handleSurveyRequestFeedback,
    handleOpenRateLimitOptions,
  } = useReplTurnOrchestration({
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
  });

  // 10. Cancellation & queued input execution
  const { onCancel, handleQueuedCommandOnCancel, cancelRequestProps, handleIncomingPrompt } = useReplCancelAndQueue({
    setAppState,
    messageQueue,
    turnController,
    submitController,
    queryGuard,
    hostEngine,
    dialogStore,
    handOverInFlight,
    messagesRef,
    setMessages,
    inputValueRef,
    promptEmpty,
    setInputValue,
    setInputMode,
    setPastedContents,
    setUserInputOnProcessing,
    userInputOnProcessing,
    setToolJSX,
    setAbortController,
    setAbortControllerForQuery,
    abortController,
    isLoading,
    streamMode,
    focusedInputDialog,
    tipOverlay,
    topDialogKind,
    isDialogChromeVisible,
    toolJSX,
    isShowingLocalJSXCommand,
    isMessageSelectorVisible,
    showBashesDialog,
    screen,
    vimMode,
    isSearchingHistory,
    isHelpOpen,
    inputMode,
    toolUseConfirmQueue,
    setToolUseConfirmQueue,
    promptQueue,
    setPromptQueue,
    activeRemote,
    localJSXClosedAtRef,
    leftArrowDeferRef,
    codeModeInterruptedByEscRef,
    setLastTurnStopTime,
    resetLoadingState,
    streamingDisplayStore,
    salvageRef,
    refusalReplacesUuidsRef,
    sendBridgeResultRef,
    mrOnTurnComplete,
    addNotification,
    commands,
    mainLoopModel,
    ideSelection,
    getToolUseContext,
    onQuery,
    onBeforeQuery,
    canUseTool,
    consumeIdeSelection,
    recordIdeSelectionConsumedBy,
    restoreIdeSelectionConsumedBy,
    restoreHandedBackPrompt,
    activeScheduledTurnRef,
    abortInFlightCompaction,
  });

  // 11. Rewind, message restore, message actions & summarize
  const handleShowMessageSelector = useCallback(() => {
    setIsMessageSelectorVisible(prev => !prev);
  }, []);
  const { handleRestoreMessage, enterMessageActions, messageActionHandlers, handleRestoreCode, handleSummarize } =
    useReplRewindAndActions({
      store,
      setAppState,
      messages,
      messagesRef,
      setMessages,
      setConversationId,
      readFileState,
      loadedNestedMemoryPathsRef,
      repinScrollRef,
      restoreIdeSelectionConsumedBy,
      setInputValue,
      setInputMode,
      setPastedContents,
      restoreMessageSyncRef,
      fileHistory,
      fileHistoryCopyPromiseRef,
      onCancel,
      setMessageSelectorPreselect,
      setIsMessageSelectorVisible,
      cursor,
      setCursor,
      cursorNavRef,
      addNotification,
      getToolUseContext,
      mainLoopModel,
      mainThreadAgentDefinition,
      scrollPin,
    });

  // 12. Left-arrow background agents handoff
  const { onLeftArrowOnEmpty } = useReplLeftArrowAgents({
    onOpenAgents,
    store,
    tasks,
    toolPermissionContext,
    messageQueue,
    turnController,
    queryGuard,
    isLoading,
    isExternalLoading,
    messagesRef,
    inputValueRef,
    turnStartRef,
    getStreamingTextRaw,
    setMessages,
    addNotification,
    hasPendingQuestion: Boolean(
      toolUseConfirmQueue.length > 0 ||
        elicitation.queue.length > 0 ||
        pendingWorkerRequest ||
        workerSandboxPermissions.queue.length > 0,
    ),
    leftArrowConfirm,
    setLeftArrowConfirm,
    leftArrowDeferRef,
    leftArrowToAgentsFired,
    handOverInFlight,
  });

  // 13. Background session checkpoint adoption & cold --resume recovery
  useReplBgAdopt({
    store,
    setAppState,
    messageQueue,
    messagesRef,
    deferredResumeRefs,
    initialMessages,
    restoreReadFileState,
  });

  // 14. Startup checks, notices, bg bridges & SIGCONT remount
  const { remountKey } = useReplStartupAndNotices({
    store,
    setAppState,
    isRemoteSession,
    mainLoopModel,
    mcpClients,
    mcpRawClients: mcp.clients,
    ideSelection,
    ideInstallationStatus,
    resumeSep2663Tasks,
    viewingAgentTaskId,
    tasks,
    toolPermissionContext,
    workerSandboxPermissions,
    elicitation,
    authChangeGenerationForAntProfile,
    autoUpdaterResult,
    setShowUndercoverCallout,
    addNotification,
    removeNotification,
    setMessages,
    requestDialog,
    dialogStore,
    topDialog,
    isLoading,
    isWaitingForApproval,
    isShowingLocalJSXCommand,
    sessionStatus,
    waitingFor,
    sessionWorking,
    sessionWaitingFor,
    messages,
    sandboxNetworkVerdictCacheRef,
    sandboxAsker,
  });

  // 15. Background integrations (voice, inbox, pipes, scheduled tasks, proactive, navigation)
  const { voice, takePendingPastes } = useReplIntegrations({
    store,
    setAppState,
    messageQueue,
    turnController,
    dialogStore,
    messages,
    normalizedInitialMessagesLength: normalizedInitialMessages.length,
    queuedCommands,
    submitCount,
    reverify,
    readFileState,
    setInputValueRaw,
    inputValueRef,
    insertTextRef,
    isLoading,
    focusedInputDialog,
    handleIncomingPrompt,
    tools,
    setMessages,
    setToolUseConfirmQueue,
    getToolUseContext,
    mainLoopModel,
    taskListId,
    initialMessage,
    isShowingLocalJSXCommand,
    toolPermissionMode: toolPermissionContext.mode,
    proactiveActive,
    proactiveNextTickAt,
    setShowBashesDialog,
  });

  // 16. Transcript mode state & keybindings
  const { columns: transcriptCols, rows: transcriptRows } = useTerminalSize();
  const transcriptMode = useReplTranscriptMode({
    screen,
    setScreen,
    showAllInTranscript,
    setShowAllInTranscript,
    dumpMode,
    setDumpMode,
    disableVirtualScroll,
    messages,
    messagesRef,
    streamingToolUses,
    tools,
    scrollPin,
    transcriptCols,
  });

  // Viewed agent/teammate vs main-thread message source derivation
  const viewedTask = viewingAgentTaskId ? tasks[viewingAgentTaskId] : undefined;
  const viewedTeammateTask = viewedTask && isInProcessTeammateTask(viewedTask) ? viewedTask : undefined;
  const viewedAgentTask = viewedTeammateTask ?? (viewedTask && isLocalAgentTask(viewedTask) ? viewedTask : undefined);
  const rawAgentMessages = viewedAgentTask
    ? viewedAgentTranscript && viewedAgentTranscript.messages.length > 0
      ? viewedAgentTranscript.messages
      : viewedAgentTask.messages
    : undefined;
  const displayedAgentMessages = useMemo(
    () => computeDisplayedAgentMessages(viewedAgentTask, rawAgentMessages),
    [viewedAgentTask, rawAgentMessages],
  );
  const staticAgentMessages = viewedAgentTask ? (displayedAgentMessages ?? EMPTY_MESSAGES) : null;
  const focusedConversationId = viewedAgentTask ? viewedAgentTask.id : conversationId;
  const messagesSource: MessagesSource = useMemo(
    () =>
      staticAgentMessages !== null
        ? { kind: 'static', messages: staticAgentMessages, conversationId: focusedConversationId }
        : { kind: 'live', transcript: transcriptProjection, conversationId: focusedConversationId, isMain: true },
    [staticAgentMessages, transcriptProjection, focusedConversationId],
  );
  const localAgentInProgressToolUseIDs = useMemo(
    () => computeLocalAgentInProgressToolUseIDs(viewedAgentTask, viewedTeammateTask, displayedAgentMessages),
    [viewedAgentTask, viewedTeammateTask, displayedAgentMessages],
  );
  const focusedInProgressToolUseIDs = viewedTeammateTask
    ? viewedTeammateTask.status !== 'running'
      ? EMPTY_STRING_SET
      : viewedAgentTranscript && viewedAgentTranscript.inProgressToolUseIDs.size > 0
        ? viewedAgentTranscript.inProgressToolUseIDs
        : (viewedTeammateTask.inProgressToolUseIDs ?? EMPTY_STRING_SET)
    : viewedAgentTask
      ? viewedAgentTask.status !== 'running'
        ? EMPTY_STRING_SET
        : viewedAgentTranscript && viewedAgentTranscript.inProgressToolUseIDs.size > 0
          ? viewedAgentTranscript.inProgressToolUseIDs
          : localAgentInProgressToolUseIDs
      : inProgressToolUseIDs;
  const focusedStreamingToolUses = viewedAgentTask ? EMPTY_STREAMING_TOOL_USES : streamingToolUses;
  const focusedIsLoading = viewedAgentTask
    ? viewedAgentTask.status === 'running' && !(viewedAgentTask as { isIdle?: boolean }).isIdle
    : isLoading;

  // Hooks hoisted above the transcript early return (React Rules of Hooks)
  const permissionDialogHostValue = useMemo(
    () => ({
      verbose,
      getToolUseContext: () =>
        getToolUseContext(messages, messages, turnController.abortController ?? createAbortController(), mainLoopModel),
      onReject: handleQueuedCommandOnCancel,
      dequeue: (toolUseID: string) => {
        removeLeaderToolUseConfirm(toolUseID);
      },
      setStickyFooter: isFullscreenEnvEnabled() ? setPermissionStickyFooter : undefined,
    }),
    [verbose, getToolUseContext, messages, turnController, mainLoopModel, handleQueuedCommandOnCancel],
  );

  // Diff sidebar & PluginRasterPanes dock/inline layout
  const replDiffSidebarWidth = computeDiffSidebarWidth({
    willowCrateEnabled,
    isFullscreen: isFullscreenEnvEnabled(),
    isThinClient: false,
    isMain: viewedAgentTask === undefined,
    replTab,
    columns: transcriptCols,
    hasGitRepo: diffSidebarHasGitRepo(),
  });
  useSyncExternalStore(subscribeRasterFrames, getRasterFrameVersion, getRasterFrameVersion);
  const chosenDock = useSyncExternalStore(subscribeDockRoom, getDockRoomColumns, getDockRoomColumns);
  const chosenInline = useSyncExternalStore(subscribeDockRoom, getInlineRoomRows, getInlineRoomRows);
  const shownPluginPane = getShownPluginPane();
  const requestedDock =
    typeof shownPluginPane?.columns === 'number' ? shownPluginPane.columns + DOCK_GRIP_COLUMNS : undefined;
  const pluginDockColumns = pluginPaneDockColumns(transcriptCols, chosenDock, requestedDock);
  const pluginDockOffered = isFullscreenEnvEnabled() && replDiffSidebarWidth === 0 ? pluginDockColumns : 0;
  const pluginDockWidth = shownPluginPane !== undefined ? pluginDockOffered : 0;
  const panesDocked = isFullscreenEnvEnabled() && pluginDockColumns > 0;
  const inlineHostOffered = !panesDocked;
  const dockHostOffered = pluginDockOffered > 0;
  useEffect(() => (inlineHostOffered ? offerPlacement() : undefined), [inlineHostOffered]);
  useEffect(() => (dockHostOffered ? offerPlacement() : undefined), [dockHostOffered]);
  usePaneToastHold();
  const pluginInlineRequested =
    shownPluginPane !== undefined
      ? shownPluginPane.bodyRows + paneTitleChromeRows(getPanesState().open.length > 1, false)
      : undefined;
  const [inlineGripLit, setInlineGripLit] = useState(false);

  const toolJsxCentered = isFullscreenEnvEnabled() && toolJSX?.isLocalJSXCommand === true;
  const topDialogIsModal = isTopDialogModalLayout(topDialogKind);
  const dialogOverPanel = topDialogIsModal && toolJsxCentered;
  const prevDialogOverPanelRef = useRef(false);
  useEffect(() => {
    if (prevDialogOverPanelRef.current && !dialogOverPanel) {
      setDialogHostUnmounted(true);
      queueMicrotask(() => setDialogHostUnmounted(false));
    }
    prevDialogOverPanelRef.current = dialogOverPanel;
  }, [dialogOverPanel]);

  if (screen === 'transcript') {
    return (
      <TranscriptView
        disableVirtualScroll={disableVirtualScroll}
        dumpMode={dumpMode}
        scrollPin={scrollPin}
        messagesSource={messagesSource}
        staticAgentMessages={staticAgentMessages}
        transcriptMessages={transcriptMode.transcriptMessages}
        messages={messages}
        tools={tools}
        commands={commands}
        toolJSX={toolJSX}
        focusedInProgressToolUseIDs={focusedInProgressToolUseIDs}
        focusedConversationId={focusedConversationId}
        screen={screen}
        agentDefinitions={agentDefinitions}
        viewedAgentTask={viewedAgentTask}
        focusedStreamingToolUses={focusedStreamingToolUses}
        transcriptStreamingToolUses={transcriptMode.transcriptStreamingToolUses}
        showStreamingText={showStreamingText}
        isLoading={isLoading}
        hasStreamingText={hasStreamingText}
        focusFoldHoldsPreview={focusFoldHoldsPreview}
        streamingDisplayStore={streamingDisplayStore}
        showAllInTranscript={showAllInTranscript}
        handleOpenRateLimitOptions={handleOpenRateLimitOptions}
        focusedIsLoading={focusedIsLoading}
        jumpRef={transcriptMode.jumpRef}
        onSearchMatchesChange={transcriptMode.onSearchMatchesChange}
        scanElement={transcriptMode.scanElement}
        setPositions={transcriptMode.setPositions}
        titleIsAnimating={titleIsAnimating}
        terminalTitle={terminalTitle}
        titleDisabled={titleDisabled}
        showStatusInTerminalTab={showStatusInTerminalTab}
        globalKeybindingProps={transcriptMode.globalKeybindingProps}
        voice={voice}
        onSubmit={onSubmit}
        cancelRequestProps={cancelRequestProps}
        searchOpen={transcriptMode.searchOpen}
        setSearchOpen={transcriptMode.setSearchOpen}
        searchQuery={transcriptMode.searchQuery}
        setSearchQuery={transcriptMode.setSearchQuery}
        searchCount={transcriptMode.searchCount}
        setSearchCount={transcriptMode.setSearchCount}
        searchCurrent={transcriptMode.searchCurrent}
        setSearchCurrent={transcriptMode.setSearchCurrent}
        setHighlight={transcriptMode.setHighlight}
        transcriptHelpOpen={transcriptMode.transcriptHelpOpen}
        editorStatus={transcriptMode.editorStatus}
        hasActivePrompt={hasActivePrompt}
      />
    );
  }

  const companionNarrow = transcriptCols < MIN_COLS_FOR_FULL_SPRITE;
  const companionVisible =
    !toolJSX?.shouldHidePromptInput && !anyInputOverlay && !showBashesDialog && !hidePromptForHardNms;
  const hideSessionTitle = hideSessionTitleFromTasks(tasksV2);
  const kZt = isFullscreenModalChromeActive({
    toolJsxCentered,
    topDialogKind,
    modalChrome,
  });
  const dialogPanelVis = computeDialogPanelVisibility({
    onScreenBlockingKind: topDialogKind ?? null,
    modalSlotActive: kZt,
    panelHidesPrompt: Boolean(toolJSX?.shouldHidePromptInput),
    pinnedConsentShowing: false,
    dialogOverPanel,
    fullscreen: isFullscreenEnvEnabled(),
  });
  const ozs = topDialogIsModal
    ? {
        key: topDialog ? `dialog:${topDialog.id}` : 'dialog',
        content: <DialogHost variant="modal" suppressReason={dialogSuppressReason} />,
        footer: dialogPanelVis.inPane ? <PromptBannerFooter hideSessionTitle={hideSessionTitle} /> : undefined,
        visible: modalChrome === 'visible',
      }
    : toolJsxCentered && (!dialogHostUnmounted || dialogPanelVis.drawn)
      ? {
          key: 'tooljsx',
          content: <MenuWaitContext.Provider value={true}>{toolJSX!.jsx}</MenuWaitContext.Provider>,
          visible: true,
          footer: dialogPanelVis.inPane ? <PromptBannerFooter hideSessionTitle={hideSessionTitle} /> : undefined,
        }
      : undefined;
  const promptOwnsEscape =
    (isVimModeEnabled() && vimMode !== 'NORMAL') ||
    isSearchingHistory ||
    isHelpOpen ||
    inputMode !== 'prompt' ||
    queueEditIndex !== null ||
    queuedCommands.some(cmd => isPoppableEditableCommand(cmd, promptEmpty));
  const pluginInlineRows = pluginPaneInlineRows(
    transcriptRows,
    isFullscreenEnvEnabled() ? 'fullscreen' : 'inline',
    chosenInline,
    pluginInlineRequested,
  );
  const inlineGripRightReserve = BORDER_MARK_INSET + CLOSE_MARK_CELLS;
  const inlineGripLeftCols = Math.max(0, transcriptCols - inlineGripRightReserve);
  const pluginPaneFocused = shownPluginPane !== undefined && getPanesState().focusedId === shownPluginPane.id;
  const ultraplanChoiceShowing = focusedInputDialog === 'ultraplan-choice' && Boolean(ultraplanPendingChoice);
  const promptInputMounted = !toolJSX?.shouldHidePromptInput && !hidePromptForHardNms && !disabled;

  const mainReturn = (
    <KeybindingSetup>
      <AnimatedTerminalTitle
        isAnimating={titleIsAnimating}
        title={terminalTitle}
        disabled={titleDisabled}
        noPrefix={showStatusInTerminalTab}
      />
      <GlobalKeybindingHandlers {...transcriptMode.globalKeybindingProps} />
      {feature('VOICE_MODE') ? (
        <VoiceKeybindingHandler
          voiceHandleKeyEvent={voice.handleKeyEvent}
          stripTrailing={voice.stripTrailing}
          resetAnchor={voice.resetAnchor}
          isActive={!toolJSX?.isLocalJSXCommand}
        />
      ) : null}
      <CommandKeybindingHandlers onSubmit={onSubmit} isActive={!toolJSX?.isLocalJSXCommand} />
      {shownPluginPane !== undefined ? (
        panesDocked ? (
          <PluginPaneKeyResize
            isActive={pluginPaneFocused}
            docked
            cells={pluginDockWidth}
            step={DOCK_KEY_COLUMNS}
            pixelScroll={false}
            resizeTo={next => {
              const resized = pluginPaneDockColumns(transcriptCols, next);
              chooseDockRoom(resized);
              return resized;
            }}
          />
        ) : (
          <PluginPaneKeyResize
            isActive={pluginPaneFocused}
            docked={false}
            cells={pluginInlineRows}
            step={INLINE_KEY_ROWS}
            pixelScroll={false}
            resizeTo={next => {
              const resized = pluginPaneInlineRows(
                transcriptRows,
                isFullscreenEnvEnabled() ? 'fullscreen' : 'inline',
                next,
                pluginInlineRequested,
              );
              chooseInlineRoom(resized);
              return resized;
            }}
          />
        )
      ) : null}
      <ScrollKeybindingHandler
        scrollViewport={kZt ? modalScrollViewport : scrollViewport}
        isActive={
          isFullscreenEnvEnabled() && !ultraplanChoiceShowing && (kZt || !anyInputOverlay || hostPermissionOpen)
        }
        onScroll={kZt ? undefined : viewedAgentTask ? scrollPin.onUserScrollWithoutDivider : composedOnScroll}
        yieldsPageKeysWhenContentFits={kZt}
      />
      {feature('MESSAGE_ACTIONS') ? (
        isFullscreenEnvEnabled() && !disableMessageActions ? (
          <MessageActionsKeybindings handlers={messageActionHandlers} isActive={cursor !== null} />
        ) : null
      ) : null}
      <CancelRequestHandler {...cancelRequestProps} />
      <RequestDialogContext.Provider value={requestDialog}>
        <MCPConnectionManager key={remountKey} dynamicMcpConfig={dynamicMcpConfig} isStrictMcpConfig={strictMcpConfig}>
          <PermissionDialogHostProvider value={permissionDialogHostValue}>
            <FullscreenLayout
              scrollViewport={scrollViewport}
              transcriptOverlay={<ToastStackView />}
              modal={ozs}
              modalScrollViewport={modalScrollViewport}
              unseen={scrollPin}
              hidePill={!!viewedAgentTask}
              askBelow={Boolean(isWaitingForApproval || hostPermissionOpen || toolUseConfirmQueue.length > 0)}
              hideSticky={!!viewedTeammateTask}
              sidebarWidth={replDiffSidebarWidth}
              sidebar={
                <ReplDiffSidebarController
                  width={replDiffSidebarWidth}
                  autoOpenBaseline={replDiffAutoOpenBaseline}
                  onAskAboutSelection={kZt ? undefined : setIDESelection}
                />
              }
              dockWidth={pluginDockWidth}
              dock={
                pluginDockWidth > 0 ? (
                  <PluginPaneDockHost
                    width={pluginDockWidth}
                    isWorking={isLoading}
                    promptEmpty={promptEmpty}
                    queueEditing={queueEditIndex !== null}
                    promptOwnsEscape={promptOwnsEscape}
                    onResize={next => {
                      const resized = pluginPaneDockColumns(transcriptCols, next);
                      chooseDockRoom(resized);
                      return resized;
                    }}
                    onSettle={keepPluginPaneRoom}
                  />
                ) : undefined
              }
              onPillClick={() => {
                setCursor(null);
              }}
              onLinkNotOpened={url => {
                const noticeText = `Couldn't open your browser. Open ${url} yourself.`;
                setMessages(prev => {
                  const last = prev.at(-1);
                  if (last?.type === 'system' && last.subtype === 'informational' && last.content === noticeText) {
                    return prev;
                  }
                  return [...prev, createSystemMessage(noticeText, 'notice')];
                });
                addNotification({
                  key: 'link-not-opened',
                  text: "that link's address is in the main conversation",
                  priority: 'medium',
                });
              }}
              scrollable={
                <>
                  <TeammateViewHeader />
                  <Messages
                    source={messagesSource}
                    tools={tools}
                    commands={commands}
                    verbose={verbose}
                    toolJSX={toolJSX}
                    suppressMessageAnimation={
                      hasBlockingOpenDialogs ||
                      tipOverlay != null ||
                      leftArrowConfirm != null ||
                      pke.kind === 'dialog' ||
                      (elicitation.queue.length > 0 && !elicitationCueBehindDraft?.keepSpinnerRunning) ||
                      workerSandboxPermissions.queue.length > 0
                    }
                    inProgressToolUseIDs={focusedInProgressToolUseIDs}
                    isMessageSelectorVisible={isMessageSelectorVisible}
                    conversationId={focusedConversationId}
                    screen={screen}
                    streamingToolUses={focusedStreamingToolUses}
                    showAllInTranscript={showAllInTranscript}
                    agentDefinitions={agentDefinitions}
                    onOpenRateLimitOptions={handleOpenRateLimitOptions}
                    hideLogo={!!viewedAgentTask}
                    isLoading={focusedIsLoading}
                    isStopHookRunning={Boolean(stopHookSpinnerSuffix)}
                    showStreamingText={showStreamingText}
                    hasStreamingText={isLoading && !viewedAgentTask && hasStreamingText && !focusFoldHoldsPreview}
                    streamingDisplayStore={streamingDisplayStore}
                    placeholderText={viewedAgentTask ? undefined : userInputOnProcessing}
                    placeholderBaseline={viewedAgentTask ? undefined : placeholderBaseline}
                    hidePlaceholder={disabled || kZt}
                    onRowsDrawn={onMessagesRowsDrawn}
                    isBriefOnly={viewedAgentTask ? false : isBriefOnly}
                    unseenDivider={viewedAgentTask ? undefined : unseenDivider}
                    scrollViewport={isFullscreenEnvEnabled() ? scrollViewport : undefined}
                    revealRef={scrollPin.revealRef}
                    trackStickyPrompt={isFullscreenEnvEnabled() ? true : undefined}
                    cursor={cursor}
                    setCursor={setCursor}
                    cursorNavRef={cursorNavRef}
                  />
                  <AwsAuthStatusBox />
                  {toolJSX && !(toolJSX.isLocalJSXCommand && toolJSX.isImmediate) && !toolJsxCentered && (
                    <Box flexDirection="column" width="100%">
                      {toolJSX.isLocalJSXCommand ? (
                        <MenuWaitContext.Provider value={true}>{toolJSX.jsx}</MenuWaitContext.Provider>
                      ) : (
                        toolJSX.jsx
                      )}
                    </Box>
                  )}
                  {process.env.USER_TYPE === 'ant' && <TungstenLiveMonitor />}
                  {isFullscreenEnvEnabled() && (
                    <PromptInputQueuedCommands abortController={abortController} mcpClients={mcpClients} />
                  )}
                  <DialogHost
                    variant="inline"
                    suppressReason={dialogSuppressReason}
                    scrollRegion={isFullscreenEnvEnabled() ? scrollPin : undefined}
                  />
                  <Box flexGrow={1} />
                  {focusedIsLoading && !showSpinner ? (
                    <LeftoverMhrRetryRow agentId={viewingAgentTaskId ?? undefined} />
                  ) : null}
                  {showSpinner && !liveStateRowMounted && (
                    <SpinnerWithVerb
                      mode={
                        viewedAgentTask
                          ? focusedInProgressToolUseIDs.size > 0
                            ? 'tool-use'
                            : 'responding'
                          : streamMode
                      }
                      spinnerTip={viewedAgentTask ? undefined : spinnerTip}
                      spinnerTipLabel={viewedAgentTask ? undefined : spinnerTipLabel}
                      responseLengthRef={focusedSpinnerRefs ? focusedSpinnerRefs.responseLengthRef : responseLengthRef}
                      apiMetricsRef={viewedAgentTask ? undefined : apiMetricsRef}
                      compactProgressActiveRef={viewedAgentTask ? undefined : compactProgressActiveRef}
                      compactingHint={viewedAgentTask ? undefined : compactingHint}
                      compactingStartTime={viewedAgentTask ? undefined : compactingStartTime}
                      overrideMessage={viewedAgentTask ? null : spinnerMessage}
                      spinnerSuffix={viewedAgentTask ? null : stopHookSpinnerSuffix}
                      verbose={verbose}
                      loadingStartTimeRef={
                        focusedSpinnerRefs ? focusedSpinnerRefs.loadingStartTimeRef : loadingStartTimeRef
                      }
                      totalPausedMsRef={focusedSpinnerRefs ? focusedSpinnerRefs.totalPausedMsRef : totalPausedMsRef}
                      pauseStartTimeRef={focusedSpinnerRefs ? focusedSpinnerRefs.pauseStartTimeRef : pauseStartTimeRef}
                      overrideColor={viewedAgentTask ? undefined : spinnerColor}
                      overrideShimmerColor={viewedAgentTask ? undefined : spinnerShimmerColor}
                      hasActiveTools={focusedInProgressToolUseIDs.size > 0}
                      leaderIsIdle={viewedAgentTask ? !focusedIsLoading : !isLoading}
                      retryStatus={viewingAgentTaskId ? null : retryStatus}
                      afterReplyText={afterReplyText}
                      outputLimitRecovery={viewedAgentTask ? null : outputLimitRecovery}
                      agentId={viewingAgentTaskId ?? undefined}
                    />
                  )}
                  {!showSpinner && !isLoading && !userInputOnProcessing && isBriefOnly && !viewedAgentTask && (
                    <BriefIdleStatus />
                  )}
                </>
              }
              abovePrompt={
                <>
                  {dialogPanelVis.abovePrompt && <PromptBannerFooter hideSessionTitle={hideSessionTitle} />}
                  <DialogHost variant="bottom" suppressReason={dialogSuppressReason} />
                  {!showSpinner &&
                    !toolJSX?.isLocalJSXCommand &&
                    showExpandedTodos &&
                    tasksV2 &&
                    tasksV2.length > 0 && (
                      <Box width="100%" flexDirection="column">
                        <TaskListV2 tasks={tasksV2} isStandalone={true} />
                      </Box>
                    )}
                  <ReplInlinePluginPane
                    panesDocked={panesDocked}
                    hasShownPluginPane={shownPluginPane !== undefined}
                    transcriptCols={transcriptCols}
                    transcriptRows={transcriptRows}
                    pluginInlineRows={pluginInlineRows}
                    isLoading={isLoading}
                    promptEmpty={promptEmpty}
                    queueEditIndex={queueEditIndex}
                    promptOwnsEscape={promptOwnsEscape}
                    inlineGripLit={inlineGripLit}
                    setInlineGripLit={setInlineGripLit}
                    inlineGripLeftCols={inlineGripLeftCols}
                    inlineGripRightReserve={inlineGripRightReserve}
                  />
                  <ReplAbovePromptSurveys
                    promptInputMounted={promptInputMounted}
                    setInputValue={setInputValue}
                    postCompactSurvey={postCompactSurvey}
                    memorySurvey={memorySurvey}
                    feedbackSurvey={feedbackSurvey}
                    frustrationDetection={frustrationDetection}
                    skillImprovementSurvey={skillImprovementSurvey}
                    didAutoRunIssueRef={didAutoRunIssueRef}
                    handleSurveyRequestFeedback={handleSurveyRequestFeedback}
                    isLoading={isLoading}
                    promptEmpty={promptEmpty}
                  />
                </>
              }
              bottom={
                <Box flexDirection="column" width="100%">
                  <Box
                    flexDirection={buddyEnabled && companionNarrow ? 'column' : 'row'}
                    width="100%"
                    alignItems={buddyEnabled && companionNarrow ? undefined : 'flex-end'}
                  >
                    {buddyEnabled && companionNarrow && isFullscreenEnvEnabled() && companionVisible ? (
                      <CompanionSprite />
                    ) : null}
                    <Box flexDirection="column" flexGrow={1}>
                      {permissionStickyFooter}
                      {toolJSX?.isLocalJSXCommand && toolJSX.isImmediate && !toolJsxCentered && (
                        <Box flexDirection="column" width="100%">
                          <MenuWaitContext.Provider value={true}>{toolJSX.jsx}</MenuWaitContext.Provider>
                        </Box>
                      )}
                      <ReplBottomPrePromptOverlays
                        tipOverlay={tipOverlay}
                        focusedInputDialog={focusedInputDialog}
                        promptQueue={promptQueue}
                        setPromptQueue={setPromptQueue}
                        pendingWorkerRequest={pendingWorkerRequest}
                        pendingSandboxRequest={pendingSandboxRequest}
                        workerSandboxPermissions={workerSandboxPermissions}
                        teamContext={teamContext}
                        elicitation={elicitation}
                        resolveMcpElicitationTaskId={resolveMcpElicitationTaskId}
                        setReopenedElicitationKey={setReopenedElicitationKey}
                        getOrCreateMcpTaskQuestionHarness={getOrCreateMcpTaskQuestionHarness}
                        clearDeferredMcpElicitation={clearDeferredMcpElicitation}
                        deferredMcpElicitationsRef={deferredMcpElicitationsRef}
                        deferredMcpAbortCleanupsRef={deferredMcpAbortCleanupsRef}
                        mcpTaskQuestionHarnessesRef={mcpTaskQuestionHarnessesRef}
                        setShowModelSwitchCallout={setShowModelSwitchCallout}
                        setShowUndercoverCallout={setShowUndercoverCallout}
                        setShowEffortCallout={setShowEffortCallout}
                        mainLoopModel={mainLoopModel}
                        addNotification={addNotification}
                        setAppState={setAppState}
                        pke={pke}
                        leftArrowConfirm={leftArrowConfirm}
                        setLeftArrowConfirm={setLeftArrowConfirm}
                        hintRecommendation={hintRecommendation}
                        handleHintResponse={handleHintResponse}
                        searchExtraToolsHint={searchExtraToolsHint}
                        lspRecommendation={lspRecommendation}
                        handleLspResponse={handleLspResponse}
                        setShowDesktopUpsellStartup={setShowDesktopUpsellStartup}
                        setShowFullscreenUpsell={setShowFullscreenUpsell}
                        ultraplanPendingChoice={ultraplanPendingChoice}
                        ultraplanLaunchPending={ultraplanLaunchPending}
                        setMessages={setMessages}
                        readFileState={readFileState}
                        store={store}
                        setConversationId={setConversationId}
                        taskRegistry={taskRegistry}
                        queryGuard={queryGuard}
                      />
                      {mrRender()}
                      {promptInputMounted && (
                        <>
                          {autoRunIssueReason && (
                            <AutoRunIssueNotification
                              onRun={handleAutoRunIssue}
                              onCancel={handleCancelAutoRunIssue}
                              reason={getAutoRunIssueReasonText(autoRunIssueReason)}
                            />
                          )}
                          <PromptInput
                            debug={debug}
                            ideSelection={ideSelection}
                            abortController={abortController}
                            onRestoreIdeSelection={returnIdeSelection}
                            hasSuppressedDialogs={!!hasSuppressedDialogs}
                            isDialogParked={hostParkMode !== null}
                            isLocalJSXCommandActive={isShowingLocalJSXCommand}
                            getToolUseContext={getToolUseContext}
                            toolPermissionContext={toolPermissionContext}
                            setToolPermissionContext={setToolPermissionContext}
                            apiKeyStatus={apiKeyStatus}
                            commands={commands}
                            agents={agentDefinitions.activeAgents}
                            isLoading={isLoading}
                            onExit={handleExit}
                            verbose={verbose}
                            messages={messages}
                            onAutoUpdaterResult={setAutoUpdaterResult}
                            autoUpdaterResult={autoUpdaterResult}
                            draftController={draftController}
                            input={inputValue}
                            onInputChange={setInputValue}
                            mode={inputMode}
                            onModeChange={setInputMode}
                            stashedPrompt={stashedPrompt}
                            setStashedPrompt={setStashedPrompt}
                            submitCount={submitCount}
                            onShowMessageSelector={handleShowMessageSelector}
                            onMessageActionsEnter={
                              feature('MESSAGE_ACTIONS')
                                ? isFullscreenEnvEnabled() && !disableMessageActions
                                  ? enterMessageActions
                                  : undefined
                                : undefined
                            }
                            mcpClients={mcpClients}
                            pastedContents={pastedContents}
                            setPastedContents={setPastedContents}
                            vimMode={vimMode}
                            setVimMode={setVimMode}
                            showBashesDialog={showBashesDialog}
                            setShowBashesDialog={setShowBashesDialog}
                            onSubmit={onSubmit}
                            onAgentSubmit={onAgentSubmit}
                            nextStepHint={failedRequestNextStepHint}
                            isSearchingHistory={isSearchingHistory}
                            setIsSearchingHistory={setIsSearchingHistory}
                            helpOpen={isHelpOpen}
                            setHelpOpen={setIsHelpOpen}
                            onLeftArrowOnEmpty={onLeftArrowOnEmpty}
                            takePendingPastes={takePendingPastes}
                            insertTextRef={feature('VOICE_MODE') ? insertTextRef : undefined}
                            voiceInterimRange={voice.interimRange}
                          />
                          <SessionBackgroundHint
                            onBackgroundSession={handleBackgroundSession}
                            isLoading={isLoading}
                            isTranscriptMode={transcriptMode.inTranscript}
                          />
                        </>
                      )}
                      <ReplBottomPostPromptOverlays
                        cursor={cursor}
                        focusedInputDialog={focusedInputDialog}
                        messages={messages}
                        messageSelectorPreselect={messageSelectorPreselect}
                        onCancel={onCancel}
                        onRestoreCode={handleRestoreCode}
                        onSummarize={handleSummarize}
                        handleRestoreMessage={handleRestoreMessage}
                        setIsMessageSelectorVisible={setIsMessageSelectorVisible}
                        setMessageSelectorPreselect={setMessageSelectorPreselect}
                      />
                    </Box>
                    {buddyEnabled && companionVisible && !(companionNarrow && isFullscreenEnvEnabled()) ? (
                      <CompanionSprite />
                    ) : null}
                  </Box>
                </Box>
              }
            />
          </PermissionDialogHostProvider>
        </MCPConnectionManager>
      </RequestDialogContext.Provider>
    </KeybindingSetup>
  );
  if (isFullscreenEnvEnabled()) {
    return <AlternateScreen mouseTracking={mouseTrackingProp()}>{mainReturn}</AlternateScreen>;
  }
  return mainReturn;
}
