import type { TabStatusKind } from '@anthropic/ink'
import type { AgentDefinition } from '@claude-code/builtin-tools/tools/AgentTool/loadAgentsDir.js'
import { feature } from 'bun:bundle'
import type * as React from 'react'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { getSessionId } from '../../bootstrap/state.js'
import type { RequestDialog, useTopDialog } from '../../dialog/index.js'
import {
  resolveHostWaitingFor,
  resolveSessionPromptStatus,
} from '../../dialog/permissionWaiting.js'
import { getElicitationCueBehindDraft } from '../../services/mcp/elicitationHandler.js'
import type { AppState } from '../../state/AppStateStore.js'
import type { MessageQueueInstance } from '../../utils/messageQueueManager.js'
import type { QueryGuard } from '../../utils/QueryGuard.js'
import {
  getBootstrapSession,
  getUserPromptWaitingFor,
  isSessionWorking,
  setSessionWorking,
  setUserPromptWaitingFor,
  subscribeSessionWorking,
  subscribeUserPromptWaiting,
} from '../../utils/sessionHost.js'
import {
  getCurrentSessionAiTitle,
  getCurrentSessionTitle,
  subscribeSessionTitleChanged,
} from '../../utils/sessionStorage.js'
import { useReplProgramStatus } from './programStatus.js'
import type { InFlightTitleRequest, TitleFallback } from './runReplTurn.js'
import type { TranscriptProjection } from './TranscriptProjection.js'
import type { PromptQueueItem, ToolJSXState } from './types.js'

/* eslint-disable @typescript-eslint/no-require-imports */
const usePeerInboundUdsDrain = feature('UDS_INBOX')
  ? require('../../hooks/usePeerInboundUdsDrain.js').usePeerInboundUdsDrain
  : (): void => {}
/* eslint-enable @typescript-eslint/no-require-imports */

/**
 * Computes terminal title, session working/waiting status, bootstrap session
 * working/waiting bag sync, UDS peer inbound drain, and OSC 7501 program status.
 */
export function useReplTerminalStatus(params: {
  terminalTitleFromRename: boolean
  initialMessagesLength: number
  mainThreadAgentDefinition: AgentDefinition | undefined
  isPromptInputActive: boolean
  hasBlockingOpenDialogs: boolean
  promptQueue: PromptQueueItem[]
  pendingWorkerRequest: AppState['pendingWorkerRequest']
  pendingSandboxRequest: AppState['pendingSandboxRequest']
  elicitation: AppState['elicitation']
  workerSandboxPermissions: AppState['workerSandboxPermissions']
  toolJSX: ToolJSXState | null
  tasks: AppState['tasks']
  topDialogKind: string | undefined
  topDialog: ReturnType<typeof useTopDialog>
  queryGuard: QueryGuard
  isLoading: boolean
  isQueryActive: boolean
  requestDialog: RequestDialog
  titleDisabled: boolean
  transcriptProjection: TranscriptProjection
  messageQueue: MessageQueueInstance
}): {
  sessionTitle: string | undefined
  sessionAiTitle: string | undefined
  agentTitle: string | undefined
  terminalTitle: string
  haikuTitleAttemptedRef: React.RefObject<boolean>
  titleFallbackRef: React.RefObject<TitleFallback | undefined>
  titleRequestRef: React.RefObject<InFlightTitleRequest | null>
  setHaikuTitle: React.Dispatch<React.SetStateAction<string | undefined>>
  isWaitingForApproval: boolean
  isShowingLocalJSXCommand: boolean
  titleIsAnimating: boolean
  sessionStatus: TabStatusKind
  waitingFor: string | undefined
  sessionWorking: boolean
  sessionWaitingFor: string | null
  showStatusInTerminalTab: boolean
} {
  const {
    terminalTitleFromRename,
    initialMessagesLength,
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
  } = params

  const sessionTitleRaw = useSyncExternalStore(
    subscribeSessionTitleChanged,
    () => getCurrentSessionTitle(getSessionId()),
    () => getCurrentSessionTitle(getSessionId()),
  )
  const sessionTitle =
    terminalTitleFromRename && sessionTitleRaw && sessionTitleRaw.trim() !== ''
      ? sessionTitleRaw
      : undefined
  const sessionAiTitleRaw = useSyncExternalStore(
    subscribeSessionTitleChanged,
    () => getCurrentSessionAiTitle(getSessionId()),
    () => getCurrentSessionAiTitle(getSessionId()),
  )
  const sessionAiTitle =
    sessionAiTitleRaw && sessionAiTitleRaw.trim() !== ''
      ? sessionAiTitleRaw
      : undefined
  const [haikuTitle, setHaikuTitle] = useState<string>()
  const haikuTitleAttemptedRef = useRef(initialMessagesLength > 0)
  const titleFallbackRef = useRef<TitleFallback | undefined>(undefined)
  const titleRequestRef = useRef<InFlightTitleRequest | null>(null)
  useEffect(() => {
    return () => {
      const active = titleRequestRef.current
      if (active) {
        if (!active.abortController.signal.aborted) {
          active.abortController.abort('unmount')
        }
        titleRequestRef.current = null
      }
    }
  }, [])

  const agentTitle = mainThreadAgentDefinition?.agentType
  const terminalTitle =
    sessionTitle ?? sessionAiTitle ?? agentTitle ?? haikuTitle ?? 'Claude Code'

  const isElicitationHeldBehindDraftEarly =
    isPromptInputActive &&
    Boolean(
      elicitation.queue[0] &&
        getElicitationCueBehindDraft({
          serverName: elicitation.queue[0].serverName,
          params: elicitation.queue[0].params,
        })?.keepSpinnerRunning,
    )
  const isWaitingForApproval = Boolean(
    hasBlockingOpenDialogs ||
      promptQueue.length > 0 ||
      pendingWorkerRequest ||
      pendingSandboxRequest ||
      (elicitation.queue.length > 0 && !isElicitationHeldBehindDraftEarly) ||
      workerSandboxPermissions.queue.length > 0,
  )
  const isShowingLocalJSXCommand =
    toolJSX?.isLocalJSXCommand === true && toolJSX?.jsx != null

  const delegatedActive = Object.values(tasks).some(task => {
    if (
      task.status === 'completed' ||
      task.status === 'failed' ||
      task.status === 'killed'
    ) {
      return false
    }
    if (task.type === 'in_process_teammate') {
      return !(task as { isIdle?: boolean }).isIdle
    }
    return (
      task.type === 'local_agent' &&
      (task as { agentType?: string }).agentType !== 'main-session' &&
      !(task as { isIdle?: boolean }).isIdle
    )
  })
  const hostWaiting = resolveHostWaitingFor(topDialogKind, topDialog?.payload)
  const sessionPrompt = resolveSessionPromptStatus({
    queuedElicitation: elicitation.queue.length > 0,
    topDialogWaitingFor: hostWaiting,
    pendingWorkerRequest: Boolean(pendingWorkerRequest),
    pendingSandboxRequest: Boolean(pendingSandboxRequest),
    isShowingLocalJSXCommand,
    isResponseStreaming: queryGuard.isRunning,
    isLoading,
    isQueryActive,
    delegatedActive,
  })
  useEffect(() => {
    const session = getBootstrapSession()
    setUserPromptWaitingFor(session, sessionPrompt.waitingFor)
    setSessionWorking(session, sessionPrompt.working)
  }, [sessionPrompt.waitingFor, sessionPrompt.working])
  useEffect(() => {
    const session = getBootstrapSession()
    return () => {
      setUserPromptWaitingFor(session, undefined)
      setSessionWorking(session, false)
    }
  }, [])

  const subscribeSessionWorkingBag = useCallback(
    (onStoreChange: () => void) =>
      subscribeSessionWorking(getBootstrapSession(), onStoreChange),
    [],
  )
  const subscribeSessionWaitingBag = useCallback(
    (onStoreChange: () => void) =>
      subscribeUserPromptWaiting(getBootstrapSession(), onStoreChange),
    [],
  )
  const getSessionWorkingSnapshot = useCallback(
    () => isSessionWorking(getBootstrapSession()),
    [],
  )
  const getSessionWaitingSnapshot = useCallback(
    () => getUserPromptWaitingFor(getBootstrapSession()) ?? null,
    [],
  )
  const sessionWorking = useSyncExternalStore(
    subscribeSessionWorkingBag,
    getSessionWorkingSnapshot,
  )
  const sessionWaitingFor = useSyncExternalStore(
    subscribeSessionWaitingBag,
    getSessionWaitingSnapshot,
  )
  usePeerInboundUdsDrain({ requestDialog })
  const titleIsAnimating =
    isLoading && !isWaitingForApproval && !isShowingLocalJSXCommand
  const sessionStatus: TabStatusKind = sessionPrompt.status
  const waitingFor = sessionPrompt.waitingFor

  const { showStatusInTerminalTab } = useReplProgramStatus({
    titleDisabled,
    sessionStatus,
    waitingFor,
    tasks,
    transcriptProjection,
    messageQueue,
  })

  return {
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
  }
}
