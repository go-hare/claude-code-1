import { setClipboard } from '@anthropic/ink'
import type { AgentDefinition } from '@claude-code/builtin-tools/tools/AgentTool/loadAgentsDir.js'
import { feature } from 'bun:bundle'
import { randomUUID } from 'crypto'
import type * as React from 'react'
import { useCallback, useMemo } from 'react'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import { clearInvokedSkills, getSessionId } from '../../bootstrap/state.js'
import {
  messagesAfterAreOnlySynthetic,
  selectableUserMessagesFilter,
} from '../../components/MessageSelector.js'
import {
  type MessageActionCaps,
  type MessageActionsNav,
  type MessageActionsState,
  useMessageActions,
} from '../../components/messageActions.js'
import { getSystemPrompt } from '../../constants/prompts.js'
import { getSystemContext, getUserContext } from '../../context.js'
import type { Notification } from '../../context/notifications.js'
import { getShortcutDisplay } from '../../keybindings/shortcutFormat.js'
import {
  buildPartialPostCompactMessages,
  partialCompactConversation,
} from '../../services/compact/compact.js'
import { resetMicrocompactState } from '../../services/compact/microCompact.js'
import { runPostCompactCleanup } from '../../services/compact/postCompactCleanup.js'
import type { AppState } from '../../state/AppStateStore.js'
import type { Store } from '../../state/store.js'
import type {
  Message as MessageType,
  PartialCompactDirection,
  UserMessage,
} from '../../types/message.js'
import type { PromptInputMode } from '../../types/textInputTypes.js'
import { createAbortController } from '../../utils/abortController.js'
import { resetSentSkillNames } from '../../utils/attachments.js'
import type { PastedContent } from '../../utils/config.js'
import { logForDebugging } from '../../utils/debug.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import {
  type FileHistoryState,
  fileHistoryHasAnyChanges,
  fileHistoryRewind,
} from '../../utils/fileHistory.js'
import type { FileStateCache } from '../../utils/fileStateCache.js'
import { isFullscreenEnvEnabled } from '../../utils/fullscreen.js'
import { logError } from '../../utils/log.js'
import { pruneDisplayedMessageContent } from '../../utils/messageDisplayTransform.js'
import type { SetAppState } from '../../utils/messageQueueManager.js'
import {
  createSystemMessage,
  getMessagesAfterCompactBoundary,
  textForResubmit,
} from '../../utils/messages.js'
import { setPermissionModeWithGuards } from '../../utils/permissions/permissionSetup.js'
import {
  messageUuidPrefix,
  UUID_PREFIX_LENGTH,
} from '../../utils/plugins/uiSelectionRowHolding.js'
import type { ProcessUserInputContext } from '../../utils/processUserInput/processUserInput.js'
import type { ScrollPin } from '../../utils/scrollPin.js'
import { getBootstrapSession } from '../../utils/sessionHost.js'
import { buildEffectiveSystemPrompt } from '../../utils/systemPrompt.js'
import type { InternalPermissionMode } from '../../types/permissions.js'
import {
  buildRestoredDraftFromMessages,
  collectTrackedFilePathsFromMessages,
  planRewindRefusalFallbackUnwind,
} from './runReplTurn.js'
import type { ViewController } from './ViewController.js'
import { REWIND_COPY_WAIT_MS, RewindBackupsStillCopyingError } from './types.js'

/* eslint-disable @typescript-eslint/no-require-imports */
const proactiveModule =
  feature('PROACTIVE') || feature('KAIROS')
    ? require('../../proactive/index.js')
    : null
/* eslint-enable @typescript-eslint/no-require-imports */

/**
 * Manages conversation rewind, message restore, message actions (`copy`/`edit`),
 * code rewind (`onRestoreCode`), and message-selector partial summarization
 * (`onSummarize`).
 */
export function useReplRewindAndActions(params: {
  store: Store<AppState>
  setAppState: SetAppState
  messages: MessageType[]
  messagesRef: React.RefObject<MessageType[]>
  setMessages: (action: React.SetStateAction<MessageType[]>) => void
  setConversationId: React.Dispatch<React.SetStateAction<string>>
  readFileState: React.RefObject<FileStateCache>
  loadedNestedMemoryPathsRef: React.RefObject<Set<string>>
  repinScrollRef: React.RefObject<(force?: boolean, reason?: string) => void>
  restoreIdeSelectionConsumedBy: ViewController['restoreIdeSelectionConsumedBy']
  setInputValue: (value: string) => void
  setInputMode: (next: React.SetStateAction<PromptInputMode>) => void
  setPastedContents: React.Dispatch<
    React.SetStateAction<Record<number, PastedContent>>
  >
  restoreMessageSyncRef: React.RefObject<
    (m: UserMessage, earlierBatch?: UserMessage[]) => void
  >
  fileHistory: FileHistoryState
  fileHistoryCopyPromiseRef: React.RefObject<Promise<void> | null>
  onCancel: () => void
  setMessageSelectorPreselect: React.Dispatch<
    React.SetStateAction<UserMessage | undefined>
  >
  setIsMessageSelectorVisible: React.Dispatch<React.SetStateAction<boolean>>
  cursor: MessageActionsState | null
  setCursor: React.Dispatch<React.SetStateAction<MessageActionsState | null>>
  cursorNavRef: React.RefObject<MessageActionsNav | null>
  addNotification: (notif: Notification) => void
  getToolUseContext: (
    messages: MessageType[],
    newMessages: MessageType[],
    abortController: AbortController,
    mainLoopModel: string,
  ) => ProcessUserInputContext
  mainLoopModel: string
  mainThreadAgentDefinition: AgentDefinition | undefined
  scrollPin: ScrollPin
}): {
  rewindConversationTo: (message: UserMessage) => void
  restoreMessageSync: (
    message: UserMessage,
    earlierBatch?: UserMessage[],
  ) => void
  handleRestoreMessage: (message: UserMessage) => Promise<void>
  enterMessageActions: ReturnType<typeof useMessageActions>['enter']
  messageActionHandlers: ReturnType<typeof useMessageActions>['handlers']
  handleRestoreCode: (
    message: UserMessage,
  ) => Promise<{ skippedLinks?: number }>
  handleSummarize:
    | ((
        message: UserMessage,
        feedback?: string,
        direction?: PartialCompactDirection,
        signal?: AbortSignal,
      ) => Promise<void>)
    | undefined
} {
  const {
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
  } = params

  const rewindConversationTo = useCallback(
    (message: UserMessage) => {
      const prev = messagesRef.current
      const messageIndex = prev.lastIndexOf(message)
      if (messageIndex === -1) return

      const keptMessages = prev.slice(0, messageIndex)
      const slicedMessages = prev.slice(messageIndex)

      logEvent('tengu_conversation_rewind', {
        preRewindMessageCount: prev.length,
        postRewindMessageCount: messageIndex,
        messagesRemoved: slicedMessages.length,
        rewindToMessageIndex: messageIndex,
      })

      try {
        const keptTracked = collectTrackedFilePathsFromMessages(keptMessages)
        const slicedTracked =
          collectTrackedFilePathsFromMessages(slicedMessages)
        readFileState.current.forgetReadsBeforeCompaction()
        for (const path of slicedTracked.readFilePaths) {
          if (!keptTracked.readFilePaths.has(path)) {
            readFileState.current.delete(path)
          }
        }
        for (const path of slicedTracked.nestedMemoryPaths) {
          if (!keptTracked.nestedMemoryPaths.has(path)) {
            readFileState.current.delete(path)
            loadedNestedMemoryPathsRef.current.delete(path)
          }
        }
      } catch (err) {
        logError(err)
      }

      try {
        const sessionWithMemory = getBootstrapSession() as unknown as {
          memorySelector?: {
            stateByDir?: Record<string, unknown>
            lastUsage?: unknown
          }
        }
        if (sessionWithMemory.memorySelector) {
          sessionWithMemory.memorySelector.stateByDir = {}
          sessionWithMemory.memorySelector.lastUsage = null
        }
      } catch {
        /* optional */
      }

      let restoredModelFromFallback: string | null | undefined
      try {
        /* eslint-disable @typescript-eslint/no-require-imports */
        const {
          clearRefusalFallbackModelLatch,
          clearRefusalFallbackOccurred,
          getInitialMainLoopModel,
          getMainLoopModelOverride,
          getRefusalFallbackModelLatch,
          hasRefusalFallbackOccurred,
          setMainLoopModelOverride,
        } =
          require('../../bootstrap/state.js') as typeof import('../../bootstrap/state.js')
        const { getAPIProvider } =
          require('../../utils/model/providers.js') as typeof import('../../utils/model/providers.js')
        /* eslint-enable @typescript-eslint/no-require-imports */
        const latch = getRefusalFallbackModelLatch()
        const unwindPlan = planRewindRefusalFallbackUnwind({
          keptMessages,
          slicedMessages,
          currentOverride: getMainLoopModelOverride(),
          latchActive: hasRefusalFallbackOccurred() || latch !== undefined,
          firstParty: getAPIProvider() === 'firstParty',
          modelBeforeSwap: latch?.previousOverride,
          initialModel: getInitialMainLoopModel(),
        })
        if (unwindPlan) {
          if (unwindPlan.clearLatch) {
            clearRefusalFallbackModelLatch('rewind')
            clearRefusalFallbackOccurred()
          }
          if (unwindPlan.model.action === 'restore') {
            setMainLoopModelOverride(unwindPlan.model.value ?? undefined)
            restoredModelFromFallback = unwindPlan.model.value
          }
          logEvent('tengu_refusal_fallback_rewind_unwind', {
            action: (unwindPlan.model.action === 'restore'
              ? 'model_restored'
              : unwindPlan.model.reason === 'not_first_party'
                ? 'model_kept_3p'
                : 'model_kept_writer_mismatch') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            ...(unwindPlan.model.action === 'restore' && {
              restored_from: unwindPlan.model
                .restoredFrom as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            }),
            latch_cleared: unwindPlan.clearLatch,
            banners_sliced: unwindPlan.bannersSliced,
          })
        }
      } catch (err) {
        logError(err)
      }

      setMessages(keptMessages)
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { noteArtifactConversationReset } =
          require('../../services/artifactAutoReact/conversationBoundary.js') as typeof import('../../services/artifactAutoReact/conversationBoundary.js')
        noteArtifactConversationReset()
      } catch {
        /* product optional */
      }
      setConversationId(randomUUID())
      resetMicrocompactState()
      resetSentSkillNames()
      const preservedAgentIds = new Set(
        Object.values(store.getState().tasks ?? {})
          .filter(t => t?.type === 'local_agent' && t.status === 'running')
          .map(t => t!.id),
      )
      clearInvokedSkills(preservedAgentIds)
      if (feature('CONTEXT_COLLAPSE')) {
        /* eslint-disable @typescript-eslint/no-require-imports */
        ;(
          require('../../services/contextCollapse/index.js') as typeof import('../../services/contextCollapse/index.js')
        ).resetContextCollapse()
        /* eslint-enable @typescript-eslint/no-require-imports */
      }

      try {
        /* eslint-disable @typescript-eslint/no-require-imports */
        const { findGoalToRestore } =
          require('../../services/goal/restoreGoalFromTranscript.js') as typeof import('../../services/goal/restoreGoalFromTranscript.js')
        const { cancelPendingGoalIdleCheckin } =
          require('../../services/goal/goalIdleCheckin.js') as typeof import('../../services/goal/goalIdleCheckin.js')
        const { bumpGoalMutationEpoch, isGoalOwnedStopHook, markGoalStopHook } =
          require('../../commands/goal.js') as typeof import('../../commands/goal.js')
        const { addSessionHook, getSessionHooks, removeSessionHook } =
          require('../../utils/hooks/sessionHooks.js') as typeof import('../../utils/hooks/sessionHooks.js')
        const { getTotalOutputTokens } =
          require('../../cost-tracker.js') as typeof import('../../cost-tracker.js')
        /* eslint-enable @typescript-eslint/no-require-imports */
        const currentGoal = store.getState().activeGoal
        const restoredCondition = findGoalToRestore(keptMessages)
        if ((currentGoal?.condition ?? null) !== restoredCondition) {
          const sid = getSessionId()
          bumpGoalMutationEpoch()
          cancelPendingGoalIdleCheckin()
          const stopMatchers =
            getSessionHooks(store.getState(), sid, 'Stop').get('Stop') ?? []
          for (const matcher of stopMatchers) {
            if (matcher.skillRoot !== undefined) continue
            for (const hook of matcher.hooks) {
              if (isGoalOwnedStopHook(hook)) {
                removeSessionHook(setAppState, sid, 'Stop', hook, {
                  skillRoot: undefined,
                  matchByIdentity: true,
                })
              }
            }
          }
          if (restoredCondition === null) {
            setAppState(prev =>
              prev.activeGoal === undefined
                ? prev
                : { ...prev, activeGoal: undefined },
            )
          } else {
            addSessionHook(
              setAppState,
              sid,
              'Stop',
              '',
              markGoalStopHook({ type: 'prompt', prompt: restoredCondition }),
            )
            setAppState(prev => ({
              ...prev,
              activeGoal: {
                condition: restoredCondition,
                iterations: 0,
                setAt: Date.now(),
                origin: 'restored',
                tokensAtStart: getTotalOutputTokens(),
              },
            }))
          }
        }
      } catch (err) {
        logError(err)
      }

      const permMode = message.permissionMode as
        | InternalPermissionMode
        | undefined
      const isRemoteSourced =
        (message as { remoteSourced?: boolean }).remoteSourced === true
      setAppState(prev => ({
        ...prev,
        ...(restoredModelFromFallback !== undefined && {
          mainLoopModel: restoredModelFromFallback,
          mainLoopModelForSession: null,
        }),
        promptSuggestion: {
          text: null,
          promptId: null,
          shownAt: 0,
          acceptedAt: 0,
          generationRequestId: null,
        },
      }))
      if (permMode && !isRemoteSourced) {
        const currentCtx = store.getState().toolPermissionContext
        if (currentCtx.mode !== permMode) {
          const result = setPermissionModeWithGuards(
            permMode,
            currentCtx,
            updater => {
              setAppState(prev => ({
                ...prev,
                toolPermissionContext: updater(prev.toolPermissionContext),
              }))
            },
          )
          if (!result.ok) {
            logForDebugging(
              `[rewind] did not restore permission mode ${permMode}: ${result.error}`,
            )
          }
        }
      }
    },
    [
      setMessages,
      setAppState,
      store,
      messagesRef,
      readFileState,
      loadedNestedMemoryPathsRef,
      setConversationId,
    ],
  )

  const restoreMessageSync = useCallback(
    (message: UserMessage, earlierBatch: UserMessage[] = []) => {
      const batch =
        earlierBatch.length > 0 ? [...earlierBatch, message] : [message]
      const rewindTarget = batch[0]!
      rewindConversationTo(rewindTarget)
      repinScrollRef.current(true, 'rewind')

      for (const msg of batch) {
        restoreIdeSelectionConsumedBy(msg.uuid, undefined)
      }

      const restored = buildRestoredDraftFromMessages(batch)
      if (restored.text.length > 0) {
        setInputValue(restored.text)
        setInputMode(restored.mode)
      }
      if (Object.keys(restored.pastedContents).length > 0) {
        setPastedContents(restored.pastedContents)
      }
    },
    [
      rewindConversationTo,
      setInputValue,
      setInputMode,
      setPastedContents,
      restoreIdeSelectionConsumedBy,
      repinScrollRef,
    ],
  )
  restoreMessageSyncRef.current = restoreMessageSync

  const handleRestoreMessage = useCallback(
    async (message: UserMessage) => {
      setImmediate((restore, msg) => restore(msg), restoreMessageSync, message)
    },
    [restoreMessageSync],
  )

  const findRawIndex = (uuid: string) => {
    const prefix = uuid.slice(0, UUID_PREFIX_LENGTH)
    return messages.findIndex(m => messageUuidPrefix(m) === prefix)
  }
  const messageActionCaps: MessageActionCaps = {
    copy: text =>
      void setClipboard(text).then(raw => {
        if (raw) process.stdout.write(raw)
        addNotification({
          key: 'selection-copied',
          text: 'copied',
          color: 'success',
          priority: 'immediate',
          timeoutMs: 2000,
        })
      }),
    edit: async msg => {
      const rawIdx = findRawIndex(msg.uuid)
      const raw = rawIdx >= 0 ? messages[rawIdx] : undefined
      if (!raw || !selectableUserMessagesFilter(raw)) return
      const noFileChanges = !(await fileHistoryHasAnyChanges(
        fileHistory,
        raw.uuid,
      ))
      const onlySynthetic = messagesAfterAreOnlySynthetic(messages, rawIdx)
      if (noFileChanges && onlySynthetic) {
        onCancel()
        void handleRestoreMessage(raw)
      } else {
        setMessageSelectorPreselect(raw)
        setIsMessageSelectorVisible(true)
      }
    },
  }
  const { enter: enterMessageActions, handlers: messageActionHandlers } =
    useMessageActions(cursor, setCursor, cursorNavRef, messageActionCaps)

  const handleRestoreCode = useCallback(
    async (message: UserMessage) => {
      const pendingCopy = fileHistoryCopyPromiseRef.current
      if (pendingCopy !== null) {
        let settled = false
        await Promise.race([
          pendingCopy.then(
            () => {
              settled = true
            },
            () => {
              settled = true
            },
          ),
          new Promise<void>(resolve =>
            setTimeout(resolve, REWIND_COPY_WAIT_MS),
          ),
        ])
        if (!settled && fileHistoryCopyPromiseRef.current === pendingCopy) {
          throw new RewindBackupsStillCopyingError()
        }
      }
      const { skippedLinks } = await fileHistoryRewind(
        (updater: (prev: FileHistoryState) => FileHistoryState) => {
          setAppState(prev => ({
            ...prev,
            fileHistory: updater(prev.fileHistory),
          }))
        },
        message.uuid,
      )
      return { skippedLinks }
    },
    [fileHistoryCopyPromiseRef, setAppState],
  )

  const disableCompact = isEnvTruthy(process.env.DISABLE_COMPACT)
  const handleSummarize = useMemo(() => {
    if (disableCompact) return undefined
    return async (
      message: UserMessage,
      feedback?: string,
      direction: PartialCompactDirection = 'from',
      signal?: AbortSignal,
    ) => {
      if (signal?.aborted) {
        return
      }
      const compactMessages = getMessagesAfterCompactBoundary(messages)
      const messageIndex = compactMessages.indexOf(message)
      if (messageIndex === -1) {
        setMessages(prev => [
          ...prev,
          createSystemMessage(
            'That message is no longer in the active context (snipped or pre-compact). Choose a more recent message.',
            'warning',
          ),
        ])
        return
      }

      const newAbortController = createAbortController()
      const onSignalAbort = () => {
        newAbortController.abort()
      }
      if (signal) {
        if (signal.aborted) {
          return
        }
        signal.addEventListener('abort', onSignalAbort, { once: true })
      }
      try {
        const context = getToolUseContext(
          compactMessages,
          [],
          newAbortController,
          mainLoopModel,
        )

        const appState = context.getAppState()
        const defaultSysPrompt = await getSystemPrompt(
          context.options.tools,
          context.options.mainLoopModel,
          Array.from(
            appState.toolPermissionContext.additionalWorkingDirectories.keys(),
          ),
          context.options.mcpClients,
        )
        const systemPrompt = buildEffectiveSystemPrompt({
          mainThreadAgentDefinition,
          toolUseContext: context,
          customSystemPrompt: context.options.customSystemPrompt,
          defaultSystemPrompt: defaultSysPrompt,
          appendSystemPrompt: context.options.appendSystemPrompt,
        })
        const [userContext, systemContext] = await Promise.all([
          getUserContext(),
          getSystemContext(),
        ])

        if (signal?.aborted) {
          return
        }

        const result = await partialCompactConversation(
          compactMessages,
          messageIndex,
          context,
          {
            systemPrompt,
            userContext,
            systemContext,
            toolUseContext: context,
            forkContextMessages: compactMessages,
          },
          feedback,
          direction,
        )

        if (signal?.aborted) {
          return
        }

        const postCompact = buildPartialPostCompactMessages(result, direction)
        if (isFullscreenEnvEnabled() && direction === 'from') {
          setMessages(old => {
            const rawIdx = old.findIndex(m => m.uuid === message.uuid)
            return [...old.slice(0, rawIdx === -1 ? 0 : rawIdx), ...postCompact]
          })
        } else {
          setMessages(postCompact)
        }
        scrollPin.resetForCompaction(messagesRef.current)
        if (feature('PROACTIVE') || feature('KAIROS')) {
          proactiveModule?.setContextBlocked(false)
        }
        setConversationId(randomUUID())
        setAppState(prev =>
          pruneDisplayedMessageContent(prev, messagesRef.current),
        )
        runPostCompactCleanup(context.options.querySource)

        if (direction === 'from') {
          const r = textForResubmit(message)
          if (r) {
            setInputValue(r.text)
            setInputMode(r.mode)
          }
        }

        const historyShortcut = getShortcutDisplay(
          'app:toggleTranscript',
          'Global',
          'ctrl+o',
        )
        addNotification({
          key: 'summarize-ctrl-o-hint',
          text: `Conversation summarized (${historyShortcut} for history)`,
          priority: 'medium',
          timeoutMs: 8000,
        })
      } finally {
        signal?.removeEventListener('abort', onSignalAbort)
      }
    }
  }, [
    disableCompact,
    messages,
    setMessages,
    getToolUseContext,
    mainLoopModel,
    mainThreadAgentDefinition,
    scrollPin,
    messagesRef,
    setConversationId,
    setAppState,
    setInputValue,
    setInputMode,
    addNotification,
  ])

  return {
    rewindConversationTo,
    restoreMessageSync,
    handleRestoreMessage,
    enterMessageActions,
    messageActionHandlers,
    handleRestoreCode,
    handleSummarize,
  }
}
