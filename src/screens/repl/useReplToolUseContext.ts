import { resumeAgentBackground } from '@claude-code/builtin-tools/tools/AgentTool/resumeAgent.js'
import { feature } from 'bun:bundle'
import type { UUID } from 'crypto'
import type * as React from 'react'
import { useCallback } from 'react'
import { getFeatureValue_CACHED_MAY_BE_STALE } from 'src/services/analytics/growthbook.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import type { Command, ResumeEntrypoint } from '../../commands.js'
import type { SpinnerMode } from '../../components/Spinner.js'
import type { Notification } from '../../context/notifications.js'
import type { RequestDialog } from '../../dialog/index.js'
import type { CanUseToolFn } from '../../hooks/useCanUseTool.js'
import { useStrandedAgentResume } from '../../hooks/useStrandedAgentResume.js'
import type {
  MCPServerConnection,
  ScopedMcpServerConfig,
} from '../../services/mcp/types.js'
import { sendNotification } from '../../services/notifier.js'
import type { AppState } from '../../state/AppStateStore.js'
import type { Store } from '../../state/store.js'
import type { Tool, ToolUseContext } from '../../Tool.js'
import type { PromptRequest, PromptResponse } from '../../types/hooks.js'
import type { LogOption } from '../../types/logs.js'
import type { Message as MessageType } from '../../types/message.js'
import type { RetryStatus } from '../../utils/advisorNetworkStall.js'
import type { FileStateCache } from '../../utils/fileStateCache.js'
import type {
  IDEExtensionInstallationStatus,
  IdeType,
} from '../../utils/ide.js'
import { LEFT_ARROW_IHT_DRAFT_TOAST } from '../../utils/leftArrowConfirm.js'
import type { SetAppState } from '../../utils/messageQueueManager.js'
import type { createAppStatePermissionContextSetters } from '../../utils/permissions/permissionContextSetters.js'
import type { ProcessUserInputContext } from '../../utils/processUserInput/processUserInput.js'
import type { TaskRegistry } from '../../utils/taskRegistry.js'
import type { ThinkingConfig } from '../../utils/thinking.js'
import type { ContentReplacementState } from '../../utils/toolResultStorage.js'
import type { ToolStateSlots } from '../../utils/toolState.js'
import type { SessionEngine } from './SessionEngine.js'
import type {
  ApiMetricsEntry,
  DeferredAdoptResumeRefs,
  LeftArrowDeferArm,
  SetToolJSXArgs,
} from './types.js'

/**
 * Builds `getToolUseContext`, keeps `deferredResumeRefs` + Artifact autoReact
 * `nztHost` synchronized, and runs `useStrandedAgentResume`.
 */
export function useReplToolUseContext(params: {
  store: Store<AppState>
  setAppState: SetAppState
  sessionEngine: SessionEngine
  commands: Command[]
  combinedInitialTools: Tool[]
  debug: boolean
  fallbackModel: string | undefined
  thinkingConfig: ThinkingConfig
  initialMcpClients: MCPServerConnection[] | undefined
  ideInstallationStatus: IDEExtensionInstallationStatus | null
  dynamicMcpConfig: Record<string, ScopedMcpServerConfig> | undefined
  theme: ReturnType<typeof import('@anthropic/ink').useTheme>[0]
  allowedAgentTypes: string[] | undefined
  customSystemPrompt: string | undefined
  appendSystemPrompt: string | undefined
  appendSubagentSystemPrompt: string | undefined
  mcpConnections: ReturnType<
    typeof import('../../state/AppState.js').useMcpConnections
  >
  leftArrowDeferRef: React.RefObject<LeftArrowDeferArm | null>
  inputValueRef: React.RefObject<string>
  taskRegistry: TaskRegistry
  setSessionToolPermissionContext: ReturnType<
    typeof createAppStatePermissionContextSetters
  >['setSessionToolPermissionContext']
  setMessages: (action: React.SetStateAction<MessageType[]>) => void
  messagesRef: React.RefObject<MessageType[]>
  disabled: boolean
  setIsMessageSelectorVisible: React.Dispatch<React.SetStateAction<boolean>>
  reverify: () => Promise<void>
  readFileState: React.RefObject<FileStateCache>
  toolStateRef: React.RefObject<ToolStateSlots>
  setToolJSX: (args: SetToolJSXArgs) => void
  addNotification: (notif: Notification) => void
  terminal: ReturnType<typeof import('@anthropic/ink').useTerminalNotification>
  onChangeDynamicMcpConfig: (
    next:
      | Record<string, ScopedMcpServerConfig>
      | ((
          prev: Record<string, ScopedMcpServerConfig> | undefined,
        ) => Record<string, ScopedMcpServerConfig>),
  ) => void
  setIDEToInstallExtension: React.Dispatch<React.SetStateAction<IdeType | null>>
  loadedNestedMemoryPathsRef: React.RefObject<Set<string>>
  pendingNestedMemoryTriggersRef: React.RefObject<Set<string>>
  discoveredSkillNamesRef: React.RefObject<Set<string>>
  setResponseLength: (f: (prev: number) => number) => void
  responseLengthRef: React.RefObject<number>
  apiMetricsRef: React.RefObject<ApiMetricsEntry[]>
  setStreamMode: (mode: SpinnerMode) => void
  setRetryStatus: (status: RetryStatus | null) => void
  setOutputLimitRecovery: React.Dispatch<
    React.SetStateAction<
      | import('../../components/Spinner/statusKind.js').OutputLimitRecovery
      | null
    >
  >
  setSpinnerColor: (
    color: keyof import('src/utils/theme.js').Theme | null,
  ) => void
  setSpinnerShimmerColor: (
    shimmer: keyof import('src/utils/theme.js').Theme | null,
  ) => void
  setSpinnerMessage: React.Dispatch<React.SetStateAction<string | null>>
  setCompactingHint: React.Dispatch<React.SetStateAction<string | null>>
  setCompactingStartTime: React.Dispatch<React.SetStateAction<number | null>>
  compactProgressActiveRef: React.RefObject<boolean>
  setInProgressToolUseIDs: (updater: React.SetStateAction<Set<string>>) => void
  hasInterruptibleToolInProgressRef: React.RefObject<boolean>
  resume: (
    sessionId: UUID,
    log: LogOption,
    entrypoint: ResumeEntrypoint,
  ) => Promise<void>
  strictMcpConfig: boolean
  setConversationId: React.Dispatch<React.SetStateAction<string>>
  requestPrompt: (
    title: string,
    toolInputSummary?: string | null,
  ) => (request: PromptRequest) => Promise<PromptResponse>
  contentReplacementStateRef: { current: ContentReplacementState | undefined }
  requestDialog: RequestDialog
  storageV5: ReturnType<
    typeof import('../../context/sessionServices.js').useSessionServices
  >['storageV5']
  credentials: ReturnType<
    typeof import('../../context/sessionServices.js').useSessionServices
  >['credentials']
  replDiffColumns: number
  activeScheduledTurnRef: React.RefObject<{
    isScheduledTask: true
    isLoop: boolean
  } | null>
  deferredResumeRefs: React.RefObject<DeferredAdoptResumeRefs>
  canUseTool: CanUseToolFn
  mainLoopModel: string
}): {
  getToolUseContext: (
    ctxMessages: MessageType[],
    _newMessages: MessageType[],
    ctxAbortController: AbortController,
    ctxMainLoopModel: string,
  ) => ProcessUserInputContext
} {
  const {
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
  } = params

  const getToolUseContext = useCallback(
    (
      ctxMessages: MessageType[],
      _newMessages: MessageType[],
      ctxAbortController: AbortController,
      ctxMainLoopModel: string,
    ): ProcessUserInputContext => {
      const ctx = sessionEngine.buildToolUseContext({
        messages: ctxMessages,
        _newMessages,
        abortController: ctxAbortController,
        mainLoopModel: ctxMainLoopModel,
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
        shouldStopBeforeNextApiCall: () => {
          const arm = leftArrowDeferRef.current
          if (
            arm !== null &&
            inputValueRef.current.trim() !== '' &&
            getFeatureValue_CACHED_MAY_BE_STALE('tengu_keen_sloth', true)
          ) {
            arm.clearCapTimer()
            leftArrowDeferRef.current = null
            addNotification({
              key: 'left-arrow-defer',
              text: LEFT_ARROW_IHT_DRAFT_TOAST,
              color: 'warning',
              priority: 'immediate',
            })
            logEvent('tengu_defer_boundary_cancelled_draft', {
              site: 'loop_top' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              wait_ms: Date.now() - arm.armedAtMs,
            })
          }
          return leftArrowDeferRef.current !== null
        },
        taskRegistry,
        setAppState,
        setSessionToolPermissionContext,
        setMessages,
        openMessageSelector: () => {
          if (!disabled) {
            setIsMessageSelectorVisible(true)
          }
        },
        onChangeAPIKey: reverify,
        readFileState: readFileState.current,
        toolState: toolStateRef.current,
        setToolJSX,
        addNotification,
        sendOSNotification: opts => {
          void sendNotification(opts, terminal)
        },
        onChangeDynamicMcpConfig,
        onInstallIDEExtension: setIDEToInstallExtension,
        loadedNestedMemoryPaths: loadedNestedMemoryPathsRef.current,
        pendingNestedMemoryTriggers: pendingNestedMemoryTriggersRef.current,
        discoveredSkillNames: discoveredSkillNamesRef.current,
        setResponseLength,
        pushApiMetricsEntry:
          process.env.USER_TYPE === 'ant'
            ? (ttftMs: number) => {
                const now = Date.now()
                const baseline = responseLengthRef.current
                apiMetricsRef.current.push({
                  ttftMs,
                  firstTokenTime: now,
                  lastTokenTime: now,
                  responseLengthBaseline: baseline,
                  endResponseLength: baseline,
                })
              }
            : undefined,
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
        setHasInterruptibleToolInProgress: (v: boolean) => {
          hasInterruptibleToolInProgressRef.current = v
        },
        resume,
        strictMcpConfig,
        setConversationId,
        requestPrompt: feature('HOOK_PROMPTS') ? requestPrompt : undefined,
        contentReplacementState: contentReplacementStateRef.current,
        requestDialog: requestDialog as NonNullable<
          ProcessUserInputContext['requestDialog']
        >,
        storageV5,
        credentials,
        replDiffColumns,
      })
      const scheduledTurn = activeScheduledTurnRef.current
      if (scheduledTurn) {
        const opts = ctx.options as typeof ctx.options & {
          isCron?: boolean
          isScheduledTask?: boolean
          isLoop?: boolean
        }
        opts.isCron = true
        opts.isScheduledTask = scheduledTurn.isScheduledTask
        if (scheduledTurn.isLoop) {
          opts.isLoop = true
        }
      }
      return ctx
    },
    [
      sessionEngine,
      commands,
      combinedInitialTools,
      debug,
      initialMcpClients,
      ideInstallationStatus,
      dynamicMcpConfig,
      theme,
      allowedAgentTypes,
      taskRegistry,
      storageV5,
      credentials,
      setAppState,
      setSessionToolPermissionContext,
      reverify,
      addNotification,
      setMessages,
      onChangeDynamicMcpConfig,
      resume,
      requestPrompt,
      disabled,
      customSystemPrompt,
      requestDialog,
      appendSystemPrompt,
      appendSubagentSystemPrompt,
      fallbackModel,
      setConversationId,
      strictMcpConfig,
      replDiffColumns,
      mcpConnections,
      setStreamMode,
      setSpinnerColor,
      setSpinnerShimmerColor,
      setSpinnerMessage,
      setRetryStatus,
      setCompactingHint,
      setCompactingStartTime,
      compactProgressActiveRef,
      responseLengthRef,
      apiMetricsRef,
      setResponseLength,
      setToolJSX,
      setInProgressToolUseIDs,
      terminal,
      thinkingConfig,
      contentReplacementStateRef,
      leftArrowDeferRef,
      inputValueRef,
      setIsMessageSelectorVisible,
      readFileState,
      toolStateRef,
      setIDEToInstallExtension,
      loadedNestedMemoryPathsRef,
      pendingNestedMemoryTriggersRef,
      discoveredSkillNamesRef,
      setOutputLimitRecovery,
      hasInterruptibleToolInProgressRef,
      activeScheduledTurnRef,
    ],
  )

  deferredResumeRefs.current.getToolUseContext =
    getToolUseContext as DeferredAdoptResumeRefs['getToolUseContext']
  deferredResumeRefs.current.canUseTool =
    canUseTool as DeferredAdoptResumeRefs['canUseTool']
  deferredResumeRefs.current.mainLoopModel = mainLoopModel
  deferredResumeRefs.current.resumeAgentBackground =
    resumeAgentBackground as DeferredAdoptResumeRefs['resumeAgentBackground']

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ar =
      require('../../services/artifactAutoReact/index.js') as typeof import('../../services/artifactAutoReact/index.js')
    ar.setNztHost({
      getToolUseContext: () =>
        getToolUseContext(
          messagesRef.current,
          [],
          new AbortController(),
          mainLoopModel,
        ) as never,
      canUseTool: canUseTool as never,
    })
  } catch {
    /* product optional */
  }

  useStrandedAgentResume({
    getAppState: () => store.getState(),
    setAppState,
    getToolUseContext: () =>
      getToolUseContext(
        messagesRef.current,
        [],
        new AbortController(),
        mainLoopModel,
      ) as unknown as ToolUseContext,
    canUseTool,
    addNotification,
  })

  return { getToolUseContext }
}
