import { useStdin } from '@anthropic/ink'
import { feature } from 'bun:bundle'
import type { UUID } from 'crypto'
import type * as React from 'react'
import { useEffect, useRef, useState } from 'react'
import { getAntAuthFallbackNotice } from 'src/commands/login/getAuthStatus.js'
import { getAutoModeDescription } from 'src/components/AutoModeOptInDialog.js'
import { useCanSwitchToExistingSubscription } from 'src/hooks/notifs/useCanSwitchToExistingSubscription.js'
import { useDeprecationWarningNotification } from 'src/hooks/notifs/useDeprecationWarningNotification.js'
import { useFastModeNotification } from 'src/hooks/notifs/useFastModeNotification.js'
import { useIDEStatusIndicator } from 'src/hooks/notifs/useIDEStatusIndicator.js'
import { useInstallMessages } from 'src/hooks/notifs/useInstallMessages.js'
import { useLspInitializationNotification } from 'src/hooks/notifs/useLspInitializationNotification.js'
import { useMcpConnectivityStatus } from 'src/hooks/notifs/useMcpConnectivityStatus.js'
import { useModelMigrationNotifications } from 'src/hooks/notifs/useModelMigrationNotifications.js'
import { useNpmDeprecationNotification } from 'src/hooks/notifs/useNpmDeprecationNotification.js'
import { useOauthExpiryNotification } from 'src/hooks/notifs/useOauthExpiryNotification.js'
import { usePersistenceSuppressedNotification } from 'src/hooks/notifs/usePersistenceSuppressedNotification.js'
import { usePluginAutoupdateNotification } from 'src/hooks/notifs/usePluginAutoupdateNotification.js'
import { usePluginInstallationStatus } from 'src/hooks/notifs/usePluginInstallationStatus.js'
import { useRateLimitWarningNotification } from 'src/hooks/notifs/useRateLimitWarningNotification.js'
import { useRemoteSettingsNotification } from 'src/hooks/notifs/useRemoteSettingsNotification.js'
import { useSettingsErrors } from 'src/hooks/notifs/useSettingsErrors.js'
import { useTeammateLifecycleNotification } from 'src/hooks/notifs/useTeammateShutdownNotification.js'
import { useTranscriptWriterDegradedNotification } from 'src/hooks/notifs/useTranscriptWriterDegradedNotification.js'
import { useChromeExtensionNotification } from 'src/hooks/useChromeExtensionNotification.js'
import { useOfficialMarketplaceNotification } from 'src/hooks/useOfficialMarketplaceNotification.js'
import { logEvent } from 'src/services/analytics/index.js'
import { performStartupChecks } from 'src/utils/plugins/performStartupChecks.js'
import {
  getIsNonInteractiveSession,
  getIsRemoteMode,
  getSessionId,
} from '../../bootstrap/state.js'
import type { Notification } from '../../context/notifications.js'
import { getTotalCost } from '../../cost-tracker.js'
import type { DialogStore, useTopDialog } from '../../dialog/index.js'
import {
  COST_THRESHOLD_KIND,
  maybeRequestAutoDefaultNudge,
  openCostThresholdIfNeeded,
  type RequestDialog,
  SANDBOX_NETWORK_ACCESS_KIND,
} from '../../dialog/index.js'
import type { SandboxNetworkAccessAsker } from '../../dialog/sandboxNetworkAccess.js'
import type { IDESelection } from '../../hooks/useIdeSelection.js'
import {
  codeModeActiveBanner,
  codeModeRefusalReasonText,
  codeModeWarningNotice,
  getCodeModeOptInState,
  isCodeModeEnabled,
} from '../../services/codeMode/optIn.js'
import type { MCPServerConnection } from '../../services/mcp/types.js'
import {
  startPreventSleep,
  stopPreventSleep,
} from '../../services/preventSleep.js'
import type { AppState } from '../../state/AppStateStore.js'
import type { Store } from '../../state/store.js'
import { isLocalAgentTask } from '../../tasks/LocalAgentTask/LocalAgentTask.js'
import { asAgentId } from '../../types/ids.js'
import type { Message as MessageType } from '../../types/message.js'
import type { AutoUpdaterResult } from '../../utils/autoUpdater.js'
import { hasConsoleBillingAccess } from '../../utils/billing.js'
import { updateSessionActivity } from '../../utils/concurrentSessions.js'
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js'
import { getCwd } from '../../utils/cwd.js'
import { logForDebugging } from '../../utils/debug.js'
import {
  consumeTuiAsked,
  explainTuiKeptRenderer,
  formatRendererLabel,
  fullscreenModeForGateReason,
  getFullscreenGateReason,
  isFullscreenEnvEnabled,
  resolveTuiJustSwitchedBanner,
} from '../../utils/fullscreen.js'
import { setEnvHookNotifier } from '../../utils/hooks/fileChangedWatcher.js'
import type { IDEExtensionInstallationStatus } from '../../utils/ide.js'
import { logError } from '../../utils/log.js'
import type { SetAppState } from '../../utils/messageQueueManager.js'
import { createSystemMessage } from '../../utils/messages.js'
import { resolveAutoDefaultOnPolicySettingsLoad } from '../../utils/permissions/permissionSetup.js'
import type { SandboxNetworkVerdictCache } from '../../utils/sandbox/sandboxNetworkDecision.js'
import { getAgentTranscript } from '../../utils/sessionStorage.js'
import {
  getActiveSettingsFileErrorNotices,
  settingsChangeDetector,
  subscribeSettingsFileErrorNotices,
} from '../../utils/settings/changeDetector.js'
import {
  EMPTY_TASK_TRANSCRIPT,
  mergeDiskAndLiveTranscriptMessages,
} from '../../utils/taskRegistry.js'
import { getAgentId } from '../../utils/teammate.js'
import { getCurrentWorktreeSession } from '../../utils/worktree.js'
import type { Props } from './types.js'

/* eslint-disable custom-rules/no-process-env-top-level, @typescript-eslint/no-require-imports */
const useAntOrgWarningNotification: typeof import('../../hooks/notifs/useAntOrgWarningNotification.js').useAntOrgWarningNotification =
  process.env.USER_TYPE === 'ant'
    ? require('../../hooks/notifs/useAntOrgWarningNotification.js')
        .useAntOrgWarningNotification
    : () => {}
/* eslint-enable custom-rules/no-process-env-top-level, @typescript-eslint/no-require-imports */

export function useReplStartupAndNotices(params: {
  store: Store<AppState>
  setAppState: SetAppState
  isRemoteSession: boolean
  mainLoopModel: string
  mcpClients: MCPServerConnection[]
  mcpRawClients: MCPServerConnection[]
  ideSelection: IDESelection | undefined
  ideInstallationStatus: IDEExtensionInstallationStatus | null
  resumeSep2663Tasks: Props['resumeSep2663Tasks']
  viewingAgentTaskId: string | undefined
  tasks: AppState['tasks']
  toolPermissionContext: AppState['toolPermissionContext']
  workerSandboxPermissions: AppState['workerSandboxPermissions']
  elicitation: AppState['elicitation']
  authChangeGenerationForAntProfile: number
  autoUpdaterResult: AutoUpdaterResult | null
  setShowUndercoverCallout: React.Dispatch<React.SetStateAction<boolean>>
  addNotification: (notif: Notification) => void
  removeNotification: (key: string) => void
  setMessages: (action: React.SetStateAction<MessageType[]>) => void
  requestDialog: RequestDialog
  dialogStore: DialogStore
  topDialog: ReturnType<typeof useTopDialog>
  isLoading: boolean
  isWaitingForApproval: boolean
  isShowingLocalJSXCommand: boolean
  sessionStatus: import('@anthropic/ink').TabStatusKind
  waitingFor: string | undefined
  sessionWorking: boolean
  sessionWaitingFor: string | null
  messages: MessageType[]
  sandboxNetworkVerdictCacheRef: React.RefObject<SandboxNetworkVerdictCache>
  sandboxAsker: SandboxNetworkAccessAsker
}): { remountKey: number } {
  const {
    store,
    setAppState,
    isRemoteSession,
    mainLoopModel,
    mcpClients,
    mcpRawClients,
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
  } = params

  // #1717: Restore persisted SEP-2663 MCP tasks on --resume after REPL mounts
  const mcpClientsForResumeRef = useRef(mcpRawClients)
  mcpClientsForResumeRef.current = mcpRawClients
  const sep2663RestoredSessionRef = useRef<string | null>(null)
  useEffect(() => {
    if (!resumeSep2663Tasks) return
    if (sep2663RestoredSessionRef.current === resumeSep2663Tasks.sessionId)
      return
    sep2663RestoredSessionRef.current = resumeSep2663Tasks.sessionId
    void resumeSep2663Tasks
      .restore({
        setAppState,
        getMcpClients: () => mcpClientsForResumeRef.current,
      })
      .catch(err => {
        logForDebugging(
          `restorePersistedSep2663TasksOnResume failed: ${err instanceof Error ? err.message : String(err)}`,
        )
      })
  }, [resumeSep2663Tasks, setAppState])

  // Official 2.1.331 `VXe` (@343110287): retained local_agent that hasn't
  // loaded disk yet → read sidechain JSONL and UUID-merge into `AppState.transcripts[taskId]`.
  const viewedLocalAgent = viewingAgentTaskId
    ? tasks[viewingAgentTaskId]
    : undefined
  const needsBootstrap =
    isLocalAgentTask(viewedLocalAgent) &&
    viewedLocalAgent.retain &&
    !viewedLocalAgent.diskLoaded
  useEffect(() => {
    if (!viewingAgentTaskId || !needsBootstrap) return
    const taskId = viewingAgentTaskId
    const controller = new AbortController()
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    const MAX_EMPTY_RETRIES = 2

    const loadOnce = (attempt: number) => {
      void getAgentTranscript(asAgentId(taskId), { signal: controller.signal })
        .then(result => {
          if (controller.signal.aborted) return
          let shouldRetry = false
          setAppState(prev => {
            const t = prev.tasks[taskId]
            if (!isLocalAgentTask(t) || t.diskLoaded || !t.retain) return prev
            const existingTr = prev.transcripts?.[taskId]
            const live =
              existingTr && existingTr.messages.length > 0
                ? existingTr.messages
                : (t.messages ?? [])
            const disk = result?.messages ?? []
            if (
              result === null &&
              live.length === 0 &&
              t.status === 'running' &&
              attempt < MAX_EMPTY_RETRIES
            ) {
              shouldRetry = true
              return prev
            }
            const merged = mergeDiskAndLiveTranscriptMessages(disk, live)
            return {
              ...prev,
              tasks: {
                ...prev.tasks,
                [taskId]: {
                  ...t,
                  diskLoaded: true,
                },
              },
              transcripts: {
                ...prev.transcripts,
                [taskId]: {
                  ...EMPTY_TASK_TRANSCRIPT,
                  ...existingTr,
                  messages: merged,
                },
              },
            }
          })
          if (shouldRetry && !controller.signal.aborted) {
            retryTimer = setTimeout(() => {
              if (!controller.signal.aborted) {
                loadOnce(attempt + 1)
              }
            }, 150)
          }
        })
        .catch(err => {
          if (controller.signal.aborted) return
          logError(err)
          setAppState(prev => {
            const t = prev.tasks[taskId]
            if (!isLocalAgentTask(t) || t.diskLoaded || !t.retain) return prev
            return {
              ...prev,
              tasks: {
                ...prev.tasks,
                [taskId]: {
                  ...t,
                  diskLoaded: true,
                },
              },
            }
          })
        })
    }

    loadOnce(0)
    return () => {
      controller.abort()
      if (retryTimer !== undefined) {
        clearTimeout(retryTimer)
      }
    }
  }, [viewingAgentTaskId, needsBootstrap, setAppState])

  // Standard notification hooks
  useModelMigrationNotifications()
  useCanSwitchToExistingSubscription()
  useIDEStatusIndicator({ ideSelection, mcpClients, ideInstallationStatus })
  useMcpConnectivityStatus({ mcpClients })
  usePluginInstallationStatus()
  usePluginAutoupdateNotification()
  useSettingsErrors()
  useRemoteSettingsNotification()
  useRateLimitWarningNotification(mainLoopModel)
  useFastModeNotification(mainLoopModel)
  useDeprecationWarningNotification(mainLoopModel)
  useNpmDeprecationNotification()
  useOauthExpiryNotification()

  // Official 2.1.319 (#1712 & #1713): surface pinned Console billing warning
  useEffect(() => {
    if (
      isRemoteSession ||
      getIsNonInteractiveSession() ||
      getAgentId() !== undefined
    ) {
      return
    }
    const notice = getAntAuthFallbackNotice()
    if (notice?.reason === 'login_ended') {
      addNotification({
        key: 'auth-profile-billing-notice',
        kind: 'warning',
        priority: 'high',
        pinned: true,
        wrap: true,
        color: 'warning',
        text: notice.text,
      })
    } else {
      removeNotification('auth-profile-billing-notice')
    }
  }, [
    authChangeGenerationForAntProfile,
    isRemoteSession,
    addNotification,
    removeNotification,
  ])

  // Official 2.1.323 (#1964): surface Code Mode opt-in refusal or active status banner.
  useEffect(() => {
    if (
      isRemoteSession ||
      getIsNonInteractiveSession() ||
      getAgentId() !== undefined
    ) {
      return
    }
    const optIn = getCodeModeOptInState()
    if (optIn.state === 'refused') {
      addNotification({
        key: 'code-mode-status',
        kind: 'warning',
        priority: 'high',
        wrap: true,
        color: 'warning',
        text:
          codeModeWarningNotice(optIn.why) ||
          codeModeRefusalReasonText(optIn.why),
      })
      return
    }
    if (isCodeModeEnabled()) {
      addNotification({
        key: 'code-mode-status',
        priority: 'low',
        wrap: true,
        text: codeModeActiveBanner(),
      })
    }
  }, [isRemoteSession, addNotification])

  usePersistenceSuppressedNotification()
  useTranscriptWriterDegradedNotification()
  useAntOrgWarningNotification()
  useInstallMessages()
  useChromeExtensionNotification()
  useOfficialMarketplaceNotification()
  useLspInitializationNotification()
  useTeammateLifecycleNotification()

  // SECURITY: Runs only after the trust dialog has been confirmed.
  useEffect(() => {
    if (isRemoteSession) return
    void performStartupChecks(setAppState)
  }, [setAppState, isRemoteSession])

  // densable artifact autoReact product: Qem+Cji+yWt + watch_url MCP dialer
  useEffect(() => {
    let cancelled = false
    void import('../../services/artifactAutoReact/index.js').then(ar => {
      if (cancelled) return
      ar.installArtifactAutoReactProduct({
        getMcpClients: () => store.getState().mcp.clients,
        scan: {
          getPermissionMode: () =>
            store.getState().toolPermissionContext.mode ?? 'default',
        },
      })
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { getProject } =
          require('../../utils/sessionStorage.js') as typeof import('../../utils/sessionStorage.js')
        ar.claimLedgerOwnership({
          appendEntry: async (
            entry: unknown,
            sessionId?: string,
            _unused?: unknown,
            _urgent?: boolean,
          ) => {
            void _unused
            void _urgent
            const e =
              entry as import('../../types/logs.js').ArtifactAutoreactLedgerEntry
            await getProject().appendEntry(
              e,
              (sessionId ?? getSessionId()) as UUID,
            )
          },
        })
      } catch {
        ar.claimLedgerOwnership()
      }
      if (process.env.CLAUDE_CODE_REMOTE) {
        void ar.refreshRestoredDurableWatches()
      }
      const { takePendingWatchArtifact } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../../cli/watchArtifactCli.js') as typeof import('../../cli/watchArtifactCli.js')
      const pending = takePendingWatchArtifact()
      if (pending && !cancelled) {
        void ar.callArtifactWatch({
          url: pending.url,
          context: {
            abortController: new AbortController(),
          },
          setAppState,
        })
      }
    })
    return () => {
      cancelled = true
    }
  }, [store, setAppState])

  useEffect(() => {
    if (autoUpdaterResult?.notifications) {
      autoUpdaterResult.notifications.forEach(notification => {
        addNotification({
          key: 'auto-updater-notification',
          text: notification,
          priority: 'low',
        })
      })
    }
  }, [autoUpdaterResult, addNotification])

  // Official 2.1.326 #182: verify /tui requested renderer took effect
  useEffect(() => {
    if (
      process.env.CLAUDE_CODE_TUI_JUST_SWITCHED !== undefined &&
      resolveTuiJustSwitchedBanner() === undefined
    ) {
      delete process.env.CLAUDE_CODE_TUI_JUST_SWITCHED
    }
    const asked = consumeTuiAsked()
    if (asked === undefined) return
    const reason = getFullscreenGateReason()
    if (reason === 'bg_forced_on') return
    const active = fullscreenModeForGateReason(reason)
    if (active === asked) return
    addNotification({
      key: 'tui-switch-not-taken',
      kind: 'warning',
      priority: 'medium',
      pinned: true,
      wrap: true,
      color: 'warning',
      text: `Still the ${formatRendererLabel(active)} renderer · ${explainTuiKeptRenderer(reason, asked)}`,
    })
    return () => removeNotification('tui-switch-not-taken')
  }, [addNotification, removeNotification])

  useEffect(() => {
    if (process.env.USER_TYPE === 'ant') {
      void (async () => {
        const { shouldShowUndercoverAutoNotice } = await import(
          '../../utils/undercover.js'
        )
        if (shouldShowUndercoverAutoNotice()) {
          setShowUndercoverCallout(true)
        }
      })()
    }
  }, [setShowUndercoverCallout])

  // densable #13: CCR bridge initialize stashes restored.internal
  useEffect(() => {
    const {
      takeRestoredWorkerForPlanResume,
      subscribeRestoredWorkerForPlanResume,
      hydratePlanModeFromRestoredWorker,
    } =
      require('../../utils/permissions/planModeResume.js') as typeof import('../../utils/permissions/planModeResume.js')
    const { externalMetadataToAppState } =
      require('../../state/onChangeAppState.js') as typeof import('../../state/onChangeAppState.js')
    const apply = (
      restored: NonNullable<ReturnType<typeof takeRestoredWorkerForPlanResume>>,
    ) => {
      if (restored.external) {
        setAppState(
          externalMetadataToAppState(
            restored.external as import('../../utils/sessionState.js').SessionExternalMetadata,
          ),
        )
      }
      hydratePlanModeFromRestoredWorker(setAppState, restored, {
        lane: 'interactive',
      })
    }
    const pending = takeRestoredWorkerForPlanResume()
    if (pending) apply(pending)
    return subscribeRestoredWorkerForPlanResume(restored => {
      takeRestoredWorkerForPlanResume()
      apply(restored)
    })
  }, [setAppState])

  // Prevent macOS from sleeping while Claude is working
  useEffect(() => {
    if (isLoading && !isWaitingForApproval && !isShowingLocalJSXCommand) {
      startPreventSleep()
      return () => stopPreventSleep()
    }
  }, [isLoading, isWaitingForApproval, isShowingLocalJSXCommand])

  // Push status to the PID file for `claude ps`
  useEffect(() => {
    if (feature('BG_SESSIONS')) {
      void updateSessionActivity({
        status: sessionStatus,
        waitingFor: waitingFor,
      })
    }
  }, [sessionStatus, waitingFor, sessionWorking, sessionWaitingFor])

  // densable Gm(qSn,{currentMode},{queueBehind:!0})
  useEffect(() => {
    if (getIsRemoteMode()) return
    void maybeRequestAutoDefaultNudge(
      requestDialog,
      () => store.getState().toolPermissionContext,
      store.setState,
      addNotification,
    )
  }, [requestDialog, store, addNotification])

  // densable msf / Vce — bg job needs-input producers
  useEffect(() => {
    if (!feature('BG_SESSIONS')) {
      if (!process.env.CLAUDE_JOB_DIR) return
    }
    void import('../../utils/bgNeedsInputBridge.js').then(m => {
      if (!m.isBgJobSession()) return
      m.ensureBgNeedsPermissionBridge()
    })
  }, [])

  // densable z8n: REPL mount means boot finished — drop the starting… sentinel
  useEffect(() => {
    if (
      !process.env.CLAUDE_JOB_DIR &&
      process.env.CLAUDE_CODE_SESSION_KIND !== 'bg'
    ) {
      return
    }
    void import('../../daemon/rendezvousServer.js').then(async m => {
      m.disarmStartupWedgeWatchdog()
      const jobDir = process.env.CLAUDE_JOB_DIR
      if (!jobDir) return
      const { readBgJobState, writeBgJobState } = await import(
        '../../daemon/jobState.js'
      )
      const short = jobDir.split(/[/\\]/).pop()
      if (!short) return
      const state = readBgJobState(short)
      if (state?.detail === m.STARTUP_DETAIL_RPT) {
        writeBgJobState(short, {
          ...state,
          detail: '',
          updatedAt: new Date().toISOString(),
        })
      }
    })
  }, [])

  // densable msf sandbox slot: DialogStore top FRr
  const topSandboxHost =
    topDialog?.kind === SANDBOX_NETWORK_ACCESS_KIND
      ? (topDialog.payload as { host?: string } | undefined)?.host
      : undefined
  useEffect(() => {
    if (
      !process.env.CLAUDE_JOB_DIR &&
      process.env.CLAUDE_CODE_SESSION_KIND !== 'bg'
    ) {
      return
    }
    void import('../../utils/bgNeedsInputBridge.js').then(m => {
      if (!m.isBgJobSession()) return
      if (topDialog?.kind !== SANDBOX_NETWORK_ACCESS_KIND) {
        m.emitBgNeedsInput(null, 'sandbox')
        return
      }
      m.emitBgNeedsInput(
        topSandboxHost ? m.formatSandboxNeeds(topSandboxHost) : null,
        'sandbox',
      )
    })
  }, [topDialog?.kind, topDialog?.id, topSandboxHost])

  useEffect(() => {
    if (
      !process.env.CLAUDE_JOB_DIR &&
      process.env.CLAUDE_CODE_SESSION_KIND !== 'bg'
    ) {
      return
    }
    void import('../../utils/bgNeedsInputBridge.js').then(m => {
      if (!m.isBgJobSession()) return
      const host = workerSandboxPermissions.queue[0]?.host
      m.emitBgNeedsInput(
        host ? m.formatSandboxNeeds(host) : null,
        'worker-sandbox',
      )
    })
  }, [workerSandboxPermissions.queue])

  useEffect(() => {
    if (
      !process.env.CLAUDE_JOB_DIR &&
      process.env.CLAUDE_CODE_SESSION_KIND !== 'bg'
    ) {
      return
    }
    void import('../../utils/bgNeedsInputBridge.js').then(m => {
      if (!m.isBgJobSession()) return
      const server = elicitation.queue[0]?.serverName
      m.emitBgNeedsInput(
        server ? m.formatMcpElicitationNeeds(server) : null,
        'elicitation',
      )
    })
  }, [elicitation.queue])

  // #20 (Sub-Wave 326-I wire): mid-session settings file error notices
  useEffect(() => {
    const handleNotice = (notice: {
      key: string
      message: string
      cleared?: boolean
    }) => {
      if (notice.cleared) {
        removeNotification(notice.key)
        return
      }
      addNotification({
        key: notice.key,
        kind: 'warning',
        text: notice.message,
        priority: 'high',
        timeoutMs: 12_000,
      })
    }
    for (const existing of getActiveSettingsFileErrorNotices()) {
      handleNotice(existing)
    }
    return subscribeSettingsFileErrorNotices(handleNotice)
  }, [addNotification, removeNotification])

  // #297 (Sub-Wave 326-I wire): re-resolve auto mode default when policySettings finishes loading
  useEffect(() => {
    return settingsChangeDetector.subscribe(source => {
      if (source !== 'policySettings') return
      const currentCtx = store.getState().toolPermissionContext
      const { context: nextCtx, exitedAutoMode } =
        resolveAutoDefaultOnPolicySettingsLoad(currentCtx, {
          source,
        })
      if (exitedAutoMode) {
        store.setState(prev => ({ ...prev, toolPermissionContext: nextCtx }))
      }
    })
  }, [store])

  // Show auto permissions warning when entering auto mode (up to 3 times across sessions)
  const safeYoloMessageShownRef = useRef(false)
  useEffect(() => {
    if (feature('TRANSCRIPT_CLASSIFIER')) {
      if (toolPermissionContext.mode !== 'auto') {
        safeYoloMessageShownRef.current = false
        return
      }
      if (safeYoloMessageShownRef.current) return
      const config = getGlobalConfig()
      const count = config.autoPermissionsNotificationCount ?? 0
      if (count >= 3) return
      const timer = setTimeout(
        (ref, setMsgs) => {
          ref.current = true
          saveGlobalConfig(prev => {
            const prevCount = prev.autoPermissionsNotificationCount ?? 0
            if (prevCount >= 3) return prev
            return {
              ...prev,
              autoPermissionsNotificationCount: prevCount + 1,
            }
          })
          setMsgs(prev => [
            ...prev,
            createSystemMessage(getAutoModeDescription(), 'warning'),
          ])
        },
        800,
        safeYoloMessageShownRef,
        setMessages,
      )
      return () => clearTimeout(timer)
    }
  }, [toolPermissionContext.mode, setMessages])

  // Official 2.1.299 (#575): one-time notice when plan mode won't ask before most edits
  const planModeBypassNoticeShownRef = useRef(false)
  useEffect(() => {
    if (planModeBypassNoticeShownRef.current || isRemoteSession) return
    if (
      toolPermissionContext.mode !== 'plan' ||
      toolPermissionContext.isBypassPermissionsModeAvailable !== true
    ) {
      return
    }
    const timer = setTimeout(() => {
      planModeBypassNoticeShownRef.current = true
      logEvent('tengu_mode_plan_bypass_notice', {})
      setMessages(prev => [
        ...prev,
        createSystemMessage(
          "Session was started with bypass permissions, so plan mode won't ask before most edits or commands. Start a new session without bypass permissions for prompts in plan mode.",
          'notice',
        ),
      ])
    }, 800)
    return () => clearTimeout(timer)
  }, [
    toolPermissionContext.mode,
    toolPermissionContext.isBypassPermissionsModeAvailable,
    isRemoteSession,
    setMessages,
  ])

  // Slow worktree creation sparse-checkout tip
  const worktreeTipShownRef = useRef(false)
  useEffect(() => {
    if (worktreeTipShownRef.current) return
    const wt = getCurrentWorktreeSession()
    if (!wt?.creationDurationMs || wt.usedSparsePaths) return
    if (wt.creationDurationMs < 15_000) return
    worktreeTipShownRef.current = true
    const secs = Math.round(wt.creationDurationMs / 1000)
    setMessages(prev => [
      ...prev,
      createSystemMessage(
        `Worktree creation took ${secs}s. For large repos, set \`worktree.sparsePaths\` in .claude/settings.json to check out only the directories you need — e.g. \`{"worktree": {"sparsePaths": [".claude", "src", "packages/foo"]}}\`.`,
        'info',
      ),
    ])
  }, [setMessages])

  // Official 2.1.323 Xxt (#1975): one-time Perforce mode notice
  const perforceNoticeShownRef = useRef(false)
  useEffect(() => {
    if (perforceNoticeShownRef.current) return
    perforceNoticeShownRef.current = true
    void import('../../utils/perforceMode.js')
      .then(({ buildPerforceModeOffNotice }) => {
        const notice = buildPerforceModeOffNotice(getCwd())
        if (notice) {
          addNotification(notice)
        }
      })
      .catch(() => {})
  }, [addNotification])

  // Official 2.1.323 jPt/gXo (#2084 & #2070): org policy Chrome opt-in refused notice
  const chromePolicyNoticeShownRef = useRef(false)
  useEffect(() => {
    if (chromePolicyNoticeShownRef.current || isRemoteSession) return
    chromePolicyNoticeShownRef.current = true
    void import('../../utils/claudeInChrome/setup.js')
      .then(({ getChromeOptInRefusedStartupMessage }) => {
        const msg = getChromeOptInRefusedStartupMessage()
        if (!msg) return
        setMessages(prev => [
          ...prev,
          { ...createSystemMessage(msg.text, msg.level), isMeta: false },
        ])
      })
      .catch(() => {})
  }, [isRemoteSession, setMessages])

  // Official 2.1.327 #432: CwdChanged / FileChanged hook failure notices in fullscreen
  useEffect(() => {
    if (!isFullscreenEnvEnabled()) return
    setEnvHookNotifier((text, isError) => {
      addNotification({
        key: 'env-hook-status',
        text,
        color: isError ? 'error' : undefined,
        priority: isError ? 'high' : 'low',
      })
    })
    return () => setEnvHookNotifier(null)
  }, [addNotification])

  // Official 2.1.295 (#382): show "Pending wakeup cancelled" when Esc cancels a pending /loop wakeup.
  useEffect(() => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const {
        subscribeLoopWakeupsCancelled,
        LOOP_WAKEUP_CANCELLED_NOTIFICATION_KEY,
        LOOP_WAKEUP_CANCELLED_NOTIFICATION_TEXT,
      } =
        require('../../utils/loopDynamic.js') as typeof import('../../utils/loopDynamic.js')
      return subscribeLoopWakeupsCancelled(event => {
        if (event.reason === 'user_abort' && event.loopsCancelled > 0) {
          addNotification({
            key: LOOP_WAKEUP_CANCELLED_NOTIFICATION_KEY,
            text: LOOP_WAKEUP_CANCELLED_NOTIFICATION_TEXT,
            priority: 'immediate',
            timeoutMs: 8000,
          })
        }
      })
    } catch {
      return undefined
    }
  }, [addNotification])

  // Cost threshold check ($5)
  const costThresholdReachedLoggedRef = useRef(false)
  useEffect(() => {
    if (isLoading) return
    if (getTotalCost() < 5 /* $5 */) return
    if (!costThresholdReachedLoggedRef.current) {
      logEvent('tengu_cost_threshold_reached', {})
      costThresholdReachedLoggedRef.current = true
    }
    if (!hasConsoleBillingAccess()) return
    if (getGlobalConfig().hasAcknowledgedCostThreshold) return
    if (dialogStore.getState().open.some(d => d.kind === COST_THRESHOLD_KIND)) {
      return
    }
    void openCostThresholdIfNeeded({ requestDialog, dialogStore })
  }, [messages, isLoading, requestDialog, dialogStore])

  // Listen for suspend/resume (SIGCONT) events
  const { internal_eventEmitter } = useStdin()
  const [remountKey, setRemountKey] = useState(0)
  useEffect(() => {
    const handleSuspend = () => {
      process.stdout.write(
        `\nClaude Code has been suspended. Run \`fg\` to bring Claude Code back.\nNote: ctrl + z now suspends Claude Code, ctrl + _ undoes input.\n`,
      )
    }

    const handleResume = () => {
      sandboxNetworkVerdictCacheRef.current.clear()
      sandboxAsker.clear()
      setRemountKey(prev => prev + 1)
    }

    internal_eventEmitter?.on('suspend', handleSuspend)
    internal_eventEmitter?.on('resume', handleResume)
    return () => {
      internal_eventEmitter?.off('suspend', handleSuspend)
      internal_eventEmitter?.off('resume', handleResume)
    }
  }, [internal_eventEmitter, sandboxAsker, sandboxNetworkVerdictCacheRef])

  return { remountKey }
}
