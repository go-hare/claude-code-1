import { feature } from 'bun:bundle'
import type * as React from 'react'
import { useCallback, useEffect, useRef } from 'react'
import type { ToolUseConfirm } from '../../components/permissions/PermissionRequest.js'
import { useFpsMetrics } from '../../context/fpsMetrics.js'
import { useCostSummary } from '../../costHook.js'
import type { DialogStore } from '../../dialog/index.js'
import { useAfterFirstRender } from '../../hooks/useAfterFirstRender.js'
import { useBackgroundTaskNavigation } from '../../hooks/useBackgroundTaskNavigation.js'
import { useInboxPoller } from '../../hooks/useInboxPoller.js'
import { useLogMessages } from '../../hooks/useLogMessages.js'
import { useMailboxBridge } from '../../hooks/useMailboxBridge.js'
import { useTaskListWatcher } from '../../hooks/useTaskListWatcher.js'
import { useTeammateViewAutoExit } from '../../hooks/useTeammateViewAutoExit.js'
import { diagnosticTracker } from '../../services/diagnosticTracking.js'
import { markPersonActivityForPromptSuggestion } from '../../services/PromptSuggestion/promptSuggestion.js'
import type { AppState } from '../../state/AppStateStore.js'
import type { Store } from '../../state/store.js'
import type { Tools } from '../../Tool.js'
import type { Message as MessageType } from '../../types/message.js'
import type { QueuedCommand } from '../../types/textInputTypes.js'
import { updateLastInteractionTime } from '../../bootstrap/state.js'
import { activityManager } from '../../utils/activityManager.js'
import { isAgentSwarmsEnabled } from '../../utils/agentSwarmsEnabled.js'
import { startBackgroundHousekeeping } from '../../utils/backgroundHousekeeping.js'
import { getMemoryFiles } from '../../utils/claudemd.js'
import { saveGlobalConfig } from '../../utils/config.js'
import { logForDebugging } from '../../utils/debug.js'
import type { FileStateCache } from '../../utils/fileStateCache.js'
import type {
  MessageQueueInstance,
  SetAppState,
} from '../../utils/messageQueueManager.js'
import type { PipeIpcState } from '../../utils/pipeTransport.js'
import type { ProcessUserInputContext } from '../../utils/processUserInput/processUserInput.js'
import { subscribePromptInputCursorStore } from '../../utils/promptInputCursorStore.js'
import { notifyAutomationStateChanged } from '../../utils/sessionState.js'
import type { TurnController } from './TurnController.js'
import type { FocusedInputDialog, InsertTextHandle } from './types.js'

/* eslint-disable custom-rules/no-process-env-top-level, @typescript-eslint/no-require-imports */
const useVoiceIntegration: typeof import('../../hooks/useVoiceIntegration.js').useVoiceIntegration =
  feature('VOICE_MODE')
    ? require('../../hooks/useVoiceIntegration.js').useVoiceIntegration
    : () => ({
        stripTrailing: () => 0,
        handleKeyEvent: () => {},
        resetAnchor: () => {},
        interimRange: null,
      })
const useProactive =
  feature('PROACTIVE') || feature('KAIROS')
    ? require('../../proactive/useProactive.js').useProactive
    : null
const useScheduledTasks = feature('AGENT_TRIGGERS')
  ? require('../../hooks/useScheduledTasks.js').useScheduledTasks
  : null
const useMasterMonitor = feature('UDS_INBOX')
  ? require('../../hooks/useMasterMonitor.js').useMasterMonitor
  : () => undefined
const useSlaveNotifications = feature('UDS_INBOX')
  ? require('../../hooks/useSlaveNotifications.js').useSlaveNotifications
  : () => undefined
const usePipeIpc = feature('UDS_INBOX')
  ? require('../../hooks/usePipeIpc.js').usePipeIpc
  : () => undefined
const usePipePermissionForward = feature('UDS_INBOX')
  ? require('../../hooks/usePipePermissionForward.js').usePipePermissionForward
  : () => undefined
const usePipeMuteSync = feature('UDS_INBOX')
  ? require('../../hooks/usePipeMuteSync.js').usePipeMuteSync
  : () => undefined
/* eslint-enable custom-rules/no-process-env-top-level, @typescript-eslint/no-require-imports */

const FALLBACK_PIPE_IPC: PipeIpcState = {
  role: 'main',
  subIndex: null,
  displayRole: 'main',
  serverName: null,
  attachedBy: null,
  localIp: null,
  hostname: null,
  machineId: null,
  mac: null,
  statusVisible: false,
  selectorOpen: false,
  selectedPipes: [],
  routeMode: 'selected',
  slaves: {},
  discoveredPipes: [],
}

/**
 * Runs REPL background integrations: startup `onInit` + telemetry, cost/log
 * hooks, activity tracking, voice input, swarm inbox & mailbox bridge, UDS
 * pipes, scheduled tasks, proactive ticks, and teammate/task navigation.
 */
export function useReplIntegrations(params: {
  store: Store<AppState>
  setAppState: SetAppState
  messageQueue: MessageQueueInstance
  turnController: TurnController
  dialogStore: DialogStore
  messages: MessageType[]
  normalizedInitialMessagesLength: number
  queuedCommands: readonly QueuedCommand[]
  submitCount: number
  reverify: () => Promise<void>
  readFileState: React.RefObject<FileStateCache>
  setInputValueRaw: (value: string) => void
  inputValueRef: React.RefObject<string>
  insertTextRef: React.RefObject<InsertTextHandle | null>
  isLoading: boolean
  focusedInputDialog: FocusedInputDialog
  handleIncomingPrompt: (
    input: string | QueuedCommand,
    options?: { isMeta?: boolean },
  ) => boolean
  tools: Tools
  setMessages: (action: React.SetStateAction<MessageType[]>) => void
  setToolUseConfirmQueue: React.Dispatch<React.SetStateAction<ToolUseConfirm[]>>
  getToolUseContext: (
    messages: MessageType[],
    newMessages: MessageType[],
    abortController: AbortController,
    mainLoopModel: string,
  ) => ProcessUserInputContext
  mainLoopModel: string
  taskListId: string | undefined
  initialMessage: AppState['initialMessage']
  isShowingLocalJSXCommand: boolean
  toolPermissionMode: AppState['toolPermissionContext']['mode']
  proactiveActive: boolean
  proactiveNextTickAt: number | null
  setShowBashesDialog: (open: boolean) => void
}): {
  voice: ReturnType<
    typeof import('../../hooks/useVoiceIntegration.js').useVoiceIntegration
  >
  takePendingPastes: () => string[]
} {
  const {
    store,
    setAppState,
    messageQueue,
    turnController,
    dialogStore,
    messages,
    normalizedInitialMessagesLength,
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
    toolPermissionMode,
    proactiveActive,
    proactiveNextTickAt,
    setShowBashesDialog,
  } = params

  const onInit = async () => {
    void reverify()
    const memoryFiles = await getMemoryFiles()
    if (memoryFiles.length > 0) {
      const fileList = memoryFiles
        .map(
          f =>
            `  [${f.type}] ${f.path} (${f.content.length} chars)${f.parent ? ` (included by ${f.parent})` : ''}`,
        )
        .join('\n')
      logForDebugging(
        `Loaded ${memoryFiles.length} CLAUDE.md/rules files:\n${fileList}`,
      )
    } else {
      logForDebugging('No CLAUDE.md/rules files found')
    }
    for (const file of memoryFiles) {
      readFileState.current.set(file.path, {
        content: file.contentDiffersFromDisk
          ? (file.rawContent ?? file.content)
          : file.content,
        timestamp: Date.now(),
        offset: undefined,
        limit: undefined,
        isPartialView: file.contentDiffersFromDisk,
      })
    }
  }
  const onInitRef = useRef(onInit)
  onInitRef.current = onInit
  const diagnosticTrackerRef = useRef(diagnosticTracker)
  diagnosticTrackerRef.current = diagnosticTracker
  useEffect(() => {
    void onInitRef.current()
    return () => {
      void diagnosticTrackerRef.current.shutdown()
    }
  }, [])

  useCostSummary(useFpsMetrics())
  useLogMessages(messages, messages.length === normalizedInitialMessagesLength)
  useAfterFirstRender()

  const hasCountedQueueUseRef = useRef(false)
  useEffect(() => {
    if (queuedCommands.length < 1) {
      hasCountedQueueUseRef.current = false
      return
    }
    if (hasCountedQueueUseRef.current) return
    hasCountedQueueUseRef.current = true
    saveGlobalConfig(current => ({
      ...current,
      promptQueueUseCount: (current.promptQueueUseCount ?? 0) + 1,
    }))
  }, [queuedCommands.length])

  const pendingPastesRef = useRef<string[]>([])
  const takePendingPastes = useCallback(
    () => pendingPastesRef.current.splice(0),
    [],
  )

  useEffect(() => {
    return subscribePromptInputCursorStore(() => {
      activityManager.recordUserActivity()
      updateLastInteractionTime(true)
      markPersonActivityForPromptSuggestion()
    })
  }, [])
  useEffect(() => {
    activityManager.recordUserActivity()
    updateLastInteractionTime(true)
    markPersonActivityForPromptSuggestion()
  }, [submitCount])
  useEffect(() => {
    if (submitCount === 1) {
      startBackgroundHousekeeping()
    }
  }, [submitCount])

  const voiceIntegrationResult = useVoiceIntegration({
    setInputValueRaw,
    inputValueRef,
    insertTextRef,
  })
  const voice: ReturnType<
    typeof import('../../hooks/useVoiceIntegration.js').useVoiceIntegration
  > = feature('VOICE_MODE')
    ? voiceIntegrationResult
    : {
        stripTrailing: () => 0,
        handleKeyEvent: () => {},
        resetAnchor: () => {},
        interimRange: null,
      }

  useInboxPoller({
    enabled: isAgentSwarmsEnabled(),
    isLoading,
    focusedInputDialog,
    onSubmitMessage: handleIncomingPrompt,
  })
  useMailboxBridge({ isLoading, onSubmitMessage: handleIncomingPrompt })
  useMasterMonitor()
  useSlaveNotifications()
  usePipePermissionForward({
    store,
    tools,
    setMessages,
    setToolUseConfirmQueue,
    dialogStore,
    getToolUseContext,
    mainLoopModel,
  })
  usePipeMuteSync({ setToolUseConfirmQueue })
  usePipeIpc({ store, handleIncomingPrompt })

  if (feature('AGENT_TRIGGERS')) {
    const assistantMode = store.getState().kairosEnabled
    useScheduledTasks!({ isLoading, assistantMode, setMessages })
  }
  if (process.env.USER_TYPE === 'ant') {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useTaskListWatcher({
      taskListId,
      isLoading,
      onSubmitTask: handleIncomingPrompt,
    })
  }
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useProactive?.({
    isLoading: isLoading || initialMessage !== null,
    queuedCommandsLength: queuedCommands.length,
    hasActiveLocalJsxUI: isShowingLocalJSXCommand,
    isInPlanMode: toolPermissionMode === 'plan',
    onQueueTick: (command: QueuedCommand) => messageQueue.enqueue(command),
  })
  useEffect(() => {
    if (!proactiveActive) {
      notifyAutomationStateChanged(null)
      return
    }
    if (isLoading) return
    if (
      proactiveNextTickAt !== null &&
      queuedCommands.length === 0 &&
      !isShowingLocalJSXCommand &&
      toolPermissionMode !== 'plan' &&
      initialMessage === null
    ) {
      notifyAutomationStateChanged({
        enabled: true,
        phase: 'standby',
        next_tick_at: proactiveNextTickAt,
        sleep_until: null,
      })
      return
    }
    notifyAutomationStateChanged({
      enabled: true,
      phase: null,
      next_tick_at: null,
      sleep_until: null,
    })
  }, [
    initialMessage,
    isLoading,
    isShowingLocalJSXCommand,
    proactiveActive,
    proactiveNextTickAt,
    queuedCommands.length,
    toolPermissionMode,
  ])
  useEffect(() => {
    if (queuedCommands.some(cmd => cmd.priority === 'now')) {
      turnController.abortController?.abort('interrupt')
    }
  }, [queuedCommands, turnController])

  useBackgroundTaskNavigation({
    onOpenBackgroundTasks: isShowingLocalJSXCommand
      ? undefined
      : () => setShowBashesDialog(true),
    onTogglePipeSelector: () => {
      setAppState(prev => {
        const pIpc = prev.pipeIpc ?? FALLBACK_PIPE_IPC
        return {
          ...prev,
          pipeIpc: { ...pIpc, selectorOpen: !pIpc.selectorOpen },
        }
      })
    },
  })
  useTeammateViewAutoExit()

  return { voice, takePendingPastes }
}
