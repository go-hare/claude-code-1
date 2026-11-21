import { randomUUID, type UUID } from 'crypto'
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs'
import type { AgentDefinition } from '@claude-code/builtin-tools/tools/AgentTool/loadAgentsDir.js'
import { feature } from 'bun:bundle'
import type * as React from 'react'
import { getReplBridgeHandle } from '../../bridge/replBridgeHandle.js'
import {
  getBudgetContinuationCount,
  getCurrentTurnTokenBudget,
  getMainThreadAgentId,
  getPromptRenderEpoch,
  getSessionId,
  getTurnClassifierCount,
  getTurnClassifierDurationMs,
  getTurnHookCount,
  getTurnHookDurationMs,
  getTurnOutputTokens,
  getTurnToolCount,
  getTurnToolDurationMs,
  resetTurnClassifierDuration,
  resetTurnHookDuration,
  resetTurnToolDuration,
  setMainLoopBusy,
  snapshotOutputTokensForTurn,
} from '../../bootstrap/state.js'
import { hasCommand, type Command } from '../../commands.js'
import {
  messagesAfterAreOnlySynthetic,
  selectableUserMessagesFilter,
} from '../../components/MessageSelector.js'
import { shouldSuppressTurnDurationForFailedOrRefusedTurn } from '../../components/Messages.js'
import { resolveTurnDurationWithBackgroundWait } from '../../components/messages/SystemTextMessage.js'
import type { SpinnerMode } from '../../components/Spinner.js'
import { getSystemPrompt } from '../../constants/prompts.js'
import { getSystemContext, getUserContext } from '../../context.js'
import { clearCommandScopedAllowRules } from '../../utils/permissions/permissionSetup.js'
import {
  isErrorClassTerminalReason,
  isUserAbortTerminalReason,
  type HostEngine,
} from '../../engine/hostEngine.js'
import type { SDKResultMessage } from '../../entrypoints/sdk/coreTypes.generated.js'
import {
  runHostEngineTurn,
  type HostEngineFeed,
} from '../../engine/hostEngineTurn.js'
import { removeLastFromHistory } from '../../history.js'
import { preferLiveMcpClients } from '../../hooks/useMergedClients.js'
import type { CanUseToolFn } from '../../hooks/useCanUseTool.js'
import { maybeMarkProjectOnboardingComplete } from '../../projectOnboardingState.js'
import type { QueryParams } from '../../query.js'
import { logEvent } from '../../services/analytics/index.js'
import { diagnosticTracker } from '../../services/diagnosticTracking.js'
import type { MCPServerConnection } from '../../services/mcp/types.js'
import type { AppStateStore } from '../../state/AppStateStore.js'
import { getAllInProcessTeammateTasks } from '../../tasks/InProcessTeammateTask/InProcessTeammateTask.js'
import type { TaskState } from '../../tasks/types.js'
import type { QueuedCommand } from '../../types/textInputTypes.js'
import type {
  Message as MessageType,
  UserMessage,
} from '../../types/message.js'
import { count } from '../../utils/array.js'
import { getGlobalConfigWriteCount } from '../../utils/config.js'
import { levelSessionEffort, type EffortValue } from '../../utils/effort.js'
import { isFullscreenEnvEnabled } from '../../utils/fullscreen.js'
import { closeOpenDiffs, getConnectedIdeClient } from '../../utils/ide.js'
import {
  countAbandonableLeftArrow,
  countLeftArrowBlockingQueuedCommands,
  countNewMonitorsSincePress,
  LEFT_ARROW_STOPPED_TURN_TOAST,
} from '../../utils/leftArrowConfirm.js'
import { applyMessageStoreAction } from '../../utils/messageStore.js'
import { pruneDisplayedMessageContent } from '../../utils/messageDisplayTransform.js'
import {
  enqueue,
  getCommandQueue,
  getCommandQueueLength,
  someInFlightDrainCommand,
  type SetAppState,
} from '../../utils/messageQueueManager.js'
import {
  createApiMetricsMessage,
  createSystemMessage,
  createTurnDurationMessage,
  getContentText,
  getMessagesAfterCompactBoundary,
  handleMessageFromStream,
  isCompactBoundaryMessage,
  isMetaVisibleOrigin,
  type StreamingThinking,
  type StreamingToolUse,
} from '../../utils/messages.js'
import { resolveModelFacts } from '../../utils/model/modelFacts.js'
import { tokenCountWithEstimation } from '../../utils/tokens.js'
import {
  getIdleCompactionRunner,
  IDLE_COMPACT_SUMMARIZED_MESSAGE,
} from './idleCompaction.js'
import { isAgentSwarmsEnabled } from '../../utils/agentSwarmsEnabled.js'
import { checkAndDisableAutoModeIfNeeded } from '../../utils/permissions/bypassPermissionsKillswitch.js'
import { waitForInitialPluginsLoaded } from '../../utils/plugins/pluginLoader.js'
import {
  getScratchpadDir,
  isScratchpadEnabled,
} from '../../utils/permissions/filesystem.js'
import type { ProcessUserInputContext } from '../../utils/processUserInput/processUserInput.js'
import { getQuerySourceForREPL } from '../../utils/promptCategory.js'
import type { QueryGuard } from '../../utils/QueryGuard.js'
import {
  logQueryProfileReport,
  queryCheckpoint,
} from '../../utils/queryProfiler.js'
import {
  isEphemeralToolProgress,
  isLoggableMessage,
  removeTranscriptMessage,
  saveAiGeneratedTitle,
} from '../../utils/sessionStorage.js'
import {
  generateSessionTitle,
  resolveSessionTitleInput,
} from '../../utils/sessionTitle.js'
import { setMemberActive } from '../../utils/swarm/teamHelpers.js'
import { buildEffectiveSystemPrompt } from '../../utils/systemPrompt.js'
import { getAgentName, getTeamName } from '../../utils/teammate.js'
import { parseTokenBudget } from '../../utils/tokenBudget.js'
import type { ToolPermissionContext } from '../../Tool.js'

/* eslint-disable @typescript-eslint/no-require-imports */
const proactiveModule =
  feature('PROACTIVE') || feature('KAIROS')
    ? (require('../../proactive/index.js') as typeof import('../../proactive/index.js'))
    : null
/* eslint-enable @typescript-eslint/no-require-imports */

function getCoordinatorUserContext(
  mcpClients: ReadonlyArray<{ name: string }>,
  scratchpadDir?: string,
  tools?: ReadonlyArray<{ name: string; searchHint?: string }>,
): { [k: string]: string } {
  if (!feature('COORDINATOR_MODE')) return {}
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod =
    require('../../coordinator/coordinatorMode.js') as typeof import('../../coordinator/coordinatorMode.js')
  if (typeof mod?.getCoordinatorUserContext !== 'function') return {}
  return mod.getCoordinatorUserContext(mcpClients, scratchpadDir, tools)
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1]! + sorted[mid]!) / 2)
    : sorted[mid]!
}

export type ApiMetricEntry = {
  ttftMs: number
  firstTokenTime: number
  lastTokenTime: number
  responseLengthBaseline: number
  endResponseLength: number
}

export type LeftArrowDeferState = {
  clearCapTimer: () => void
  carriedAtPress: ReadonlySet<string>
  confirmedInterstitial: boolean
  proceed: () => Promise<string>
}

export type DispatchReplStreamEventDeps = {
  event: Parameters<typeof handleMessageFromStream>[0]
  setMessages: React.Dispatch<React.SetStateAction<MessageType[]>>
  messagesRef: { current: MessageType[] }
  setConversationId: (id: UUID) => void
  setAppState: SetAppState
  streamingDisplayStore: {
    getState: () => { salvage: string | null; exact: boolean }
    setSalvage: (salvage: string | null, exact?: boolean) => void
  }
  salvageRef: {
    current: {
      apiMessageId: string
      salvageText: string
      exact: boolean
    } | null
  }
  refusalReplacesUuidsRef: { current: string[] | null }
  clearStreamingText: () => void
  pipeReturnHadErrorRef: { current: boolean }
  relayPipeMessage: (msg: {
    type: 'stream' | 'error' | 'done'
    data: string
  }) => void
  setResponseLength: (f: (prev: number) => number) => void
  setStreamMode: (mode: SpinnerMode) => void
  setStreamingToolUses: React.Dispatch<React.SetStateAction<StreamingToolUse[]>>
  setStreamingThinking: React.Dispatch<
    React.SetStateAction<StreamingThinking | null>
  >
  responseLengthRef: { current: number }
  apiMetricsRef: { current: ApiMetricEntry[] }
  onApiMetrics?: Parameters<typeof handleMessageFromStream>[7]
  onStreamingText: Parameters<typeof handleMessageFromStream>[8]
  displayTransform: Parameters<typeof handleMessageFromStream>[9]
  setInProgressToolUseIDs: React.Dispatch<React.SetStateAction<Set<string>>>
  addNotification: (n: {
    key: string
    text: string
    priority: 'immediate' | 'high' | 'medium' | 'low'
    timeoutMs?: number
  }) => void
}

/**
 * Official 2.1.328 #563 (`K5i` + `_keepReply` + `countReply`):
 * Accurate two-part spinner token counter (`keptLength + replyLength`) that:
 * - resets `replyLength` on `message_start` so a retried reply is never counted twice,
 * - advances during `thinking_progress` and `thinking_signature` while Claude thinks,
 * - snaps to authoritative `usage.output_tokens * 4` on `message_delta` and on
 *   non-streamed `assistant` replies so non-streamed replies are never missed.
 */
export type SpinnerApiMetricsEntry = {
  id?: string
  thinkingTokenEstimate?: number
  thinkingBlockBaseline?: number
  sawEstimatedTokensThisBlock?: boolean
  outputTokens?: number
}

export type SpinnerApiMetricsEvent =
  | { type: 'start'; ttftMs?: number; id?: string; messageId?: string }
  | { type: 'content_block_start'; id?: string }
  | { type: 'thinking_progress'; estimatedTokensDelta: number; id?: string }
  | { type: 'thinking_signature'; chars: number; id?: string }
  | { type: 'end'; outputTokens: number; id?: string }

export function applySpinnerApiMetricsEvent(params: {
  entries: SpinnerApiMetricsEntry[]
  responseLength: number
  event: SpinnerApiMetricsEvent
}): number {
  const { entries, responseLength, event } = params
  if (event.type === 'start') {
    entries.push({ id: event.id })
    return responseLength
  }
  const entry =
    event.id != null
      ? entries.find(m => m.id === event.id)
      : entries.findLast(m => m.id == null)
  if (!entry) return responseLength
  if (event.type === 'content_block_start') {
    entry.thinkingTokenEstimate = 0
    entry.thinkingBlockBaseline = responseLength
    entry.sawEstimatedTokensThisBlock = false
    return responseLength
  }
  if (event.type === 'thinking_progress') {
    entry.sawEstimatedTokensThisBlock = true
    entry.thinkingTokenEstimate =
      (entry.thinkingTokenEstimate ?? 0) + event.estimatedTokensDelta
    if (entry.outputTokens == null && event.id == null) {
      return Math.max(
        responseLength,
        (entry.thinkingBlockBaseline ?? 0) + entry.thinkingTokenEstimate * 4,
      )
    }
    return responseLength
  }
  if (event.type === 'thinking_signature') {
    if (event.chars > 0 && entry.outputTokens == null) {
      if (entry.sawEstimatedTokensThisBlock) {
        entry.thinkingTokenEstimate = Math.max(
          entry.thinkingTokenEstimate ?? 0,
          Math.ceil(event.chars / 4),
        )
        return Math.max(
          responseLength,
          (entry.thinkingBlockBaseline ?? 0) + entry.thinkingTokenEstimate * 4,
        )
      }
      return responseLength + event.chars
    }
    return responseLength
  }
  entry.outputTokens = event.outputTokens
  return event.id == null
    ? Math.max(responseLength, event.outputTokens * 4)
    : responseLength
}

export class SpinnerTokenCounter {
  private keptLength = 0
  private replyLength = 0
  private entries: SpinnerApiMetricsEntry[] = []

  get responseLength(): number {
    return this.keptLength + this.replyLength
  }

  get tokenCount(): number {
    return Math.round(this.responseLength / 4)
  }

  reset(): void {
    this.keptLength = 0
    this.replyLength = 0
    this.entries = []
  }

  keepReply(): void {
    this.keptLength += this.replyLength
    this.replyLength = 0
  }

  addDeltaChars(deltaChars: number): number {
    if (deltaChars > 0) {
      this.replyLength += deltaChars
    }
    return this.responseLength
  }

  onStreamMessageStart(hasTtftMs: boolean): number {
    if (!hasTtftMs) {
      this.keepReply()
    }
    this.replyLength = 0
    return this.responseLength
  }

  onStreamMessageDelta(outputTokens: number | undefined): number {
    if (typeof outputTokens === 'number' && outputTokens > 0) {
      this.replyLength = outputTokens * 4
    }
    return this.responseLength
  }

  onAssistantMessage(msg: {
    isApiErrorMessage?: boolean
    isUnmetered?: boolean
    message?: {
      stop_reason?: string | null
      usage?: { output_tokens?: number | null }
    }
  }): number {
    if (msg.isApiErrorMessage || msg.isUnmetered) {
      return this.responseLength
    }
    const outputTokens = msg.message?.usage?.output_tokens
    if (
      msg.message?.stop_reason &&
      typeof outputTokens === 'number' &&
      outputTokens > 0
    ) {
      this.replyLength = outputTokens * 4
    }
    return this.responseLength
  }

  onApiMetricsEvent(event: SpinnerApiMetricsEvent): number {
    if (event.type === 'start' && event.id == null) {
      this.keepReply()
    }
    this.replyLength = applySpinnerApiMetricsEvent({
      entries: this.entries,
      responseLength: this.replyLength,
      event,
    })
    return this.responseLength
  }
}

const spinnerCountersByRef = new WeakMap<
  { current: number },
  SpinnerTokenCounter
>()

function getSpinnerTokenCounter(ref: { current: number }): SpinnerTokenCounter {
  let counter = spinnerCountersByRef.get(ref)
  if (!counter) {
    counter = new SpinnerTokenCounter()
    spinnerCountersByRef.set(ref, counter)
  } else if (ref.current === 0 && counter.responseLength > 0) {
    counter.reset()
  }
  return counter
}

/**
 * Dispatches a single stream event from `query()` / `runHostEngineTurn`
 * through `handleMessageFromStream` into REPL transcript and streaming UI state.
 */
export function dispatchReplStreamEvent(
  deps: DispatchReplStreamEventDeps,
): void {
  const {
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
  } = deps

  // Official 2.1.328 #563: two-part spinner token counter keyed by responseLengthRef
  // (resets on retried message_start, advances on thinking_progress, and counts non-streamed replies).
  const tokenCounter = getSpinnerTokenCounter(responseLengthRef)

  handleMessageFromStream(
    event,
    newMessage => {
      if (newMessage.type === 'assistant') {
        const nextLen = tokenCounter.onAssistantMessage(
          newMessage as unknown as Parameters<
            SpinnerTokenCounter['onAssistantMessage']
          >[0],
        )
        if (nextLen !== responseLengthRef.current) {
          setResponseLength(() => nextLen)
        }
      }
      if (isCompactBoundaryMessage(newMessage)) {
        if (isFullscreenEnvEnabled()) {
          setMessages(old => {
            const postBoundary = getMessagesAfterCompactBoundary(old, {
              includeSnipped: true,
            })
            const MAX_FULLSCREEN_SCROLLBACK = 500
            const kept =
              postBoundary.length > MAX_FULLSCREEN_SCROLLBACK
                ? postBoundary.slice(-MAX_FULLSCREEN_SCROLLBACK)
                : postBoundary
            return [...kept, newMessage]
          })
        } else {
          setMessages(() => [newMessage])
        }
        setConversationId(randomUUID())
        setAppState(prev =>
          pruneDisplayedMessageContent(prev, messagesRef.current),
        )
        if (feature('PROACTIVE') || feature('KAIROS')) {
          proactiveModule?.setContextBlocked(false)
        }
      } else if (
        newMessage.type === 'progress' &&
        isEphemeralToolProgress(
          newMessage.data &&
            typeof newMessage.data === 'object' &&
            newMessage.data !== null &&
            'type' in newMessage.data
            ? newMessage.data.type
            : undefined,
        )
      ) {
        setMessages(oldMessages =>
          applyMessageStoreAction(oldMessages, {
            type: 'replace-last-ephemeral-progress',
            message: newMessage,
          }),
        )
      } else {
        if (newMessage.type === 'assistant') {
          const st = streamingDisplayStore.getState()
          if (
            st.salvage !== null &&
            !('isVirtual' in newMessage && newMessage.isVirtual) &&
            !('isApiErrorMessage' in newMessage && newMessage.isApiErrorMessage)
          ) {
            const content = newMessage.message?.content
            const hasText =
              Array.isArray(content) &&
              content.some(
                b =>
                  typeof b !== 'string' &&
                  b.type === 'text' &&
                  typeof b.text === 'string' &&
                  b.text.trim().length > 0,
              )
            if (hasText && newMessage.message?.id) {
              salvageRef.current = {
                apiMessageId: newMessage.message.id,
                salvageText: st.salvage,
                exact: st.exact,
              }
              const replaces = refusalReplacesUuidsRef.current
              if (replaces !== null) {
                refusalReplacesUuidsRef.current = null
                const drop = new Set(replaces)
                setMessages(old => old.filter(m => !drop.has(m.uuid)))
                for (const uuid of replaces) {
                  void removeTranscriptMessage(
                    uuid as `${string}-${string}-${string}-${string}-${string}`,
                  )
                }
              }
              streamingDisplayStore.setSalvage(null)
            }
          }
        }
        if (isFullscreenEnvEnabled()) {
          setMessages(oldMessages =>
            applyMessageStoreAction(oldMessages, {
              type: 'append-or-move-by-uuid',
              message: newMessage,
            }),
          )
        } else {
          setMessages(oldMessages => [...oldMessages, newMessage])
        }
        if (newMessage.type === 'assistant') {
          clearStreamingText()
        }
      }
      if (feature('PROACTIVE') || feature('KAIROS')) {
        if (
          newMessage.type === 'assistant' &&
          'isApiErrorMessage' in newMessage &&
          newMessage.isApiErrorMessage
        ) {
          proactiveModule?.setContextBlocked(true)
        } else if (newMessage.type === 'assistant') {
          proactiveModule?.setContextBlocked(false)
        }
      }
      if (feature('UDS_INBOX') && newMessage.type === 'assistant') {
        const msg = newMessage.message as { content?: unknown } | undefined
        const contentBlocks =
          msg?.content ?? (newMessage as { content?: unknown }).content ?? []
        const textParts: string[] = []
        if (Array.isArray(contentBlocks)) {
          for (const block of contentBlocks) {
            if (typeof block === 'string') {
              textParts.push(block)
            } else if (
              block &&
              typeof block === 'object' &&
              'type' in block &&
              block.type === 'text' &&
              'text' in block &&
              typeof block.text === 'string' &&
              block.text
            ) {
              textParts.push(block.text)
            }
          }
        } else if (typeof contentBlocks === 'string') {
          textParts.push(contentBlocks)
        }
        const text = textParts.join('\n').trim()
        if ('isApiErrorMessage' in newMessage && newMessage.isApiErrorMessage) {
          pipeReturnHadErrorRef.current = true
          relayPipeMessage({
            type: 'error',
            data: text || 'Slave request failed',
          })
        } else if (text) {
          relayPipeMessage({ type: 'stream', data: text })
        }
      }
    },
    deltaChars => {
      const nextLen = tokenCounter.addDeltaChars(deltaChars)
      setResponseLength(() => nextLen)
    },
    setStreamMode,
    setStreamingToolUses,
    tombstonedMessage => {
      setMessages(oldMessages =>
        oldMessages.filter(m => m !== tombstonedMessage),
      )
      void removeTranscriptMessage(tombstonedMessage.uuid)
    },
    setStreamingThinking,
    metrics => {
      deps.onApiMetrics?.(metrics)
      if (metrics && typeof metrics === 'object' && 'type' in metrics) {
        const nextLen = tokenCounter.onApiMetricsEvent(
          metrics as SpinnerApiMetricsEvent,
        )
        if (nextLen !== responseLengthRef.current) {
          setResponseLength(() => nextLen)
        }
      }
      let ttftMs: number | undefined
      if ('type' in metrics && metrics.type === 'start') {
        ttftMs = metrics.ttftMs
      } else if (
        'ttftMs' in metrics &&
        typeof (metrics as { ttftMs?: unknown }).ttftMs === 'number'
      ) {
        ttftMs = (metrics as { ttftMs: number }).ttftMs
      }
      if (ttftMs === undefined) return
      const now = Date.now()
      const baseline = responseLengthRef.current
      apiMetricsRef.current.push({
        ttftMs,
        firstTokenTime: now,
        lastTokenTime: now,
        responseLengthBaseline: baseline,
        endResponseLength: baseline,
      })
    },
    onStreamingText,
    displayTransform,
    event => {
      if (event.phase === 'begin') {
        salvageRef.current = null
        refusalReplacesUuidsRef.current =
          event.replacesUuids !== undefined && event.replacesUuids.length > 0
            ? event.replacesUuids
            : null
        streamingDisplayStore.setSalvage(
          event.salvageText ?? null,
          event.join === 'exact',
        )
      } else {
        refusalReplacesUuidsRef.current = null
        streamingDisplayStore.setSalvage(null)
      }
    },
    undefined,
    {
      onConversationReset: newConversationId => {
        setConversationId(
          newConversationId as `${string}-${string}-${string}-${string}-${string}`,
        )
      },
      onInProgressToolUseIDs: op => {
        const ids = Array.isArray(op.ids) ? op.ids : []
        const action = op.action ?? 'set'
        const apply = (prev: Set<string>): Set<string> => {
          if (action === 'clear') {
            return prev.size === 0 ? prev : new Set()
          }
          if (action === 'remove') {
            if (ids.length === 0 || prev.size === 0) return prev
            const next = new Set(prev)
            for (const id of ids) next.delete(id)
            return next.size === prev.size ? prev : next
          }
          if (action === 'add') {
            if (ids.length === 0) return prev
            const next = new Set(prev)
            for (const id of ids) next.add(id)
            return next.size === prev.size ? prev : next
          }
          return ids.length === 0 && prev.size === 0 ? prev : new Set(ids)
        }
        setInProgressToolUseIDs(apply)
      },
      onNotification: notification => {
        if (
          notification &&
          typeof notification === 'object' &&
          'text' in (notification as object)
        ) {
          const n = notification as {
            key?: string
            text?: string
            priority?: 'immediate' | 'high' | 'medium' | 'low'
          }
          if (typeof n.text === 'string' && n.text.length > 0) {
            addNotification({
              key: n.key ?? `stream-notification-${Date.now()}`,
              text: n.text,
              priority: n.priority ?? 'medium',
            })
          }
        }
      },
      onExpandedView: expandedView => {
        if (expandedView === 'teammates') {
          setAppState(prev =>
            prev.expandedView === 'none'
              ? prev
              : { ...prev, expandedView: 'none' },
          )
          return
        }
        if (typeof expandedView === 'string' || expandedView === null) {
          setAppState(prev =>
            prev.expandedView === expandedView
              ? prev
              : {
                  ...prev,
                  expandedView: expandedView as typeof prev.expandedView,
                },
          )
        }
      },
      onActiveGoal: value => {
        setAppState(prev => {
          if (value === undefined || value === null) {
            if (prev.activeGoal === undefined) return prev
            return { ...prev, activeGoal: undefined }
          }
          if (typeof value === 'object') {
            return {
              ...prev,
              activeGoal: value as NonNullable<typeof prev.activeGoal>,
            }
          }
          return prev
        })
      },
      onPostTurnSummary: value => {
        void value
      },
      onHintClears: () => {},
      onInterruptibleToolInProgress: () => {},
      onOSNotification: () => {},
      onCommandLifecycle: () => {},
    },
    true, // densable authoringProgressSurface:!0
  )

  // Official 2.1.328 #563: update two-part spinner token counter AFTER
  // handleMessageFromStream has processed deltas/apiMetrics, and keep the
  // prior reply count when a new stream request or refusal retry begins.
  if (event && typeof event === 'object' && 'type' in event) {
    if (
      event.type === 'stream_event' &&
      'event' in event &&
      event.event &&
      typeof event.event === 'object' &&
      'type' in event.event
    ) {
      const streamEv = event.event as {
        type: string
        usage?: { output_tokens?: number }
      }
      if (streamEv.type === 'message_start') {
        const hasTtft =
          'ttftMs' in event &&
          (event as { ttftMs?: number | null }).ttftMs != null
        const nextLen = tokenCounter.onStreamMessageStart(hasTtft)
        setResponseLength(() => nextLen)
      } else if (streamEv.type === 'message_delta') {
        const nextLen = tokenCounter.onStreamMessageDelta(
          streamEv.usage?.output_tokens,
        )
        setResponseLength(() => nextLen)
      }
    } else if (
      event.type === 'stream_request_start' ||
      (event.type === 'refusal_continuation' &&
        'phase' in event &&
        (event as { phase?: string }).phase === 'begin')
    ) {
      tokenCounter.keepReply()
    }
  }
}

export type RunReplTurnArgs = {
  newMessages: MessageType[]
  abortController: AbortController
  shouldQuery: boolean
  additionalAllowedTools: string[]
  mainLoopModelParam: string
  onBeforeQueryCallback?: (
    input: string,
    newMessages: MessageType[],
  ) => Promise<boolean>
  input?: string
  effort?: EffortValue
  stopHookActive?: boolean
  clientPlatform?: string
  additionalDisallowedTools?: string[]
}

export const UNUSABLE_TITLE_RETRIES = 2

export type TitleFallback = {
  text: string
  unusableRepliesLeft: number
}

export type TitleOutcome =
  | { kind: 'titled'; title: string }
  | { kind: 'failed' }
  | { kind: 'unusable' }

/**
 * Gold `nyr` — select title candidate for Haiku session naming:
 * substantive prose resets the retry budget to 2; otherwise keep the
 * prior `fallback` across non-substantive follow-ups or auto-continuations.
 */
export function resolveTitleCandidate({
  prose,
  isContinuationTurn,
  fallback,
  isSubstantive = true,
}: {
  prose: string | null
  isContinuationTurn: boolean
  fallback: TitleFallback | undefined
  isSubstantive?: boolean
}): TitleFallback | undefined {
  if (prose !== null && isSubstantive) {
    return { text: prose, unusableRepliesLeft: UNUSABLE_TITLE_RETRIES }
  }
  if (fallback && (prose !== null || isContinuationTurn)) {
    return fallback
  }
  return undefined
}

/**
 * Gold `ryr` — advance `TitleFallback` after a titling attempt:
 * - `titled`: clear fallback
 * - `failed`: preserve fallback unchanged (e.g. usage limit / network error)
 * - `unusable`: decrement `unusableRepliesLeft` until 1, then drop
 */
export function advanceTitleFallback(
  fallback: TitleFallback,
  outcome: TitleOutcome,
): TitleFallback | undefined {
  switch (outcome.kind) {
    case 'titled':
      return undefined
    case 'failed':
      return fallback
    case 'unusable':
      return fallback.unusableRepliesLeft > 1
        ? {
            text: fallback.text,
            unusableRepliesLeft: fallback.unusableRepliesLeft - 1,
          }
        : undefined
  }
}

export type RunReplTurnDeps = {
  store: AppStateStore
  queryGuard: QueryGuard
  initialMcpClients?: MCPServerConnection[]
  titleDisabled: boolean
  sessionTitle: string | undefined
  sessionAiTitle: string | undefined
  agentTitle: string | undefined
  haikuTitleAttemptedRef: { current: boolean }
  titleFallbackRef?: { current: TitleFallback | undefined }
  setHaikuTitle: (title: string) => void
  commands: Command[]
  setConversationId: (id: UUID) => void
  setAppState: SetAppState
  messagesRef: { current: MessageType[] }
  setMessages: React.Dispatch<React.SetStateAction<MessageType[]>>
  resetLoadingState: () => void
  setAbortController: (ac: AbortController | null) => void
  getToolUseContext: (
    messages: MessageType[],
    newMessages: MessageType[],
    abortController: AbortController,
    mainLoopModel: string,
  ) => ProcessUserInputContext
  toolPermissionContext: ToolPermissionContext
  terminalFocusRef: { current: boolean }
  mainThreadAgentDefinition?: AgentDefinition
  customSystemPrompt?: string
  appendSystemPrompt?: string
  canUseTool: CanUseToolFn
  hostEngine: HostEngine
  engineFeed: HostEngineFeed
  awaitSessionStartHooks?: (signal: AbortSignal) => Promise<void> | undefined
  onEngineRead?: () => void
  onMainRequestStart?: () => void
  onEngineStatus?: (compactResult: unknown) => void
  onQueryEvent: (event: Parameters<typeof handleMessageFromStream>[0]) => void
  addNotification: (n: {
    key: string
    text: string
    priority: 'immediate' | 'high' | 'medium' | 'low'
    timeoutMs?: number
  }) => void
  leftArrowDeferRef: { current: LeftArrowDeferState | null }
  inputValueRef: { current: string }
  markIdleForkMidTurn: () => void
  leftArrowToAgentsFired: { current: boolean }
  buddyEnabled: boolean
  pipeReturnHadErrorRef: { current: boolean }
  relayPipeMessage: (msg: {
    type: 'stream' | 'error' | 'done'
    data: string
  }) => void
  apiMetricsRef: { current: ApiMetricEntry[] }
  loadingStartTimeRef: { current: number }
  totalPausedMsRef: { current: number }
  swarmStartTimeRef: { current: number | null }
  swarmBudgetInfoRef: {
    current: { tokens: number; limit: number; nudges: number } | undefined
  }
  backgroundWaitStartTimeRef: { current: number | null }
  onTurnComplete?: (
    messages: MessageType[],
    terminalReason?: string,
  ) => Promise<void> | void
  resetTimingRefs: () => void
  responseLengthRef: { current: number }
  setStreamingToolUses: React.Dispatch<React.SetStateAction<StreamingToolUse[]>>
  clearStreamingText: () => void
  displayTransform: { newTurn: () => void }
  mrOnBeforeQuery: (
    input: string,
    messages: MessageType[],
    newCount: number,
  ) => Promise<unknown>
  mrOnTurnComplete: (messages: MessageType[], aborted: boolean) => Promise<void>
  setLastQueryCompletionTime: (time: number) => void
  sendBridgeResultRef: { current: () => void }
  proactiveActive: unknown
  restoreMessageSyncRef: { current: (m: UserMessage) => void }
}

async function executeReplTurnImpl(
  deps: RunReplTurnDeps,
  messagesIncludingNewMessages: MessageType[],
  newMessages: MessageType[],
  abortController: AbortController,
  shouldQuery: boolean,
  additionalAllowedTools: string[],
  mainLoopModelParam: string,
  effort?: EffortValue,
  stopHookActive?: boolean,
  additionalDisallowedTools: string[] = [],
): Promise<SDKResultMessage | undefined> {
  const {
    store,
    initialMcpClients,
    titleDisabled,
    sessionTitle,
    sessionAiTitle,
    agentTitle,
    haikuTitleAttemptedRef,
    titleFallbackRef,
    setHaikuTitle,
    commands,
    setConversationId,
    setAppState,
    messagesRef,
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
    engineFeed,
    onQueryEvent,
    addNotification,
    leftArrowDeferRef,
    inputValueRef,
    setMessages,
    markIdleForkMidTurn,
    leftArrowToAgentsFired,
    buddyEnabled,
    pipeReturnHadErrorRef,
    relayPipeMessage,
    apiMetricsRef,
    loadingStartTimeRef,
    onTurnComplete,
  } = deps

  if (shouldQuery) {
    const freshClients = preferLiveMcpClients(
      store.getState().mcp.clients,
      initialMcpClients,
    )
    void diagnosticTracker.handleQueryStart(freshClients)
    const ideClient = getConnectedIdeClient(freshClients)
    if (ideClient) {
      void closeOpenDiffs(ideClient)
    }
  }

  void maybeMarkProjectOnboardingComplete()

  if (
    !titleDisabled &&
    !sessionTitle &&
    !sessionAiTitle &&
    !agentTitle &&
    !haikuTitleAttemptedRef.current
  ) {
    const firstUserMessage = newMessages.find(
      m => m.type === 'user' && !m.isMeta,
    )
    const rawText =
      firstUserMessage?.type === 'user'
        ? getContentText(
            firstUserMessage.message!.content as string | ContentBlockParam[],
          )
        : null
    const prose = rawText
      ? resolveSessionTitleInput({ text: rawText, commands })
      : null
    const isContinuationTurn = newMessages.some(
      m =>
        m.type === 'user' &&
        (m as { origin?: { kind?: string } }).origin?.kind ===
          'auto-continuation',
    )
    const candidate = resolveTitleCandidate({
      prose,
      isContinuationTurn,
      fallback: titleFallbackRef?.current,
      isSubstantive: prose !== null,
    })
    if (candidate) {
      haikuTitleAttemptedRef.current = true
      if (titleFallbackRef) {
        titleFallbackRef.current = candidate
      }
      const titleSessionId = getSessionId()
      void generateSessionTitle(
        candidate.text,
        new AbortController().signal,
      ).then(
        title => {
          if (titleSessionId !== getSessionId()) return
          if (title) {
            if (titleFallbackRef) {
              titleFallbackRef.current = advanceTitleFallback(candidate, {
                kind: 'titled',
                title,
              })
            }
            setHaikuTitle(title)
            saveAiGeneratedTitle(titleSessionId as UUID, title)
            getReplBridgeHandle()?.adoptLocalAiTitle?.()
          } else {
            if (titleFallbackRef) {
              titleFallbackRef.current = advanceTitleFallback(candidate, {
                kind: 'unusable',
              })
            }
            haikuTitleAttemptedRef.current = false
          }
        },
        () => {
          if (titleFallbackRef) {
            titleFallbackRef.current = advanceTitleFallback(candidate, {
              kind: 'failed',
            })
          }
          haikuTitleAttemptedRef.current = false
        },
      )
    }
  }

  store.setState(prev => {
    const curAllow = prev.toolPermissionContext.alwaysAllowRules.command
    const allowSame =
      curAllow === additionalAllowedTools ||
      (curAllow?.length === additionalAllowedTools.length &&
        curAllow.every((v, i) => v === additionalAllowedTools[i]))
    const curDeny = prev.toolPermissionContext.alwaysDenyRules.command ?? []
    const nextDeny =
      additionalDisallowedTools.length === 0
        ? curDeny
        : Array.from(new Set([...curDeny, ...additionalDisallowedTools]))
    const denySame =
      curDeny.length === nextDeny.length &&
      curDeny.every((v, i) => v === nextDeny[i])
    if (
      allowSame &&
      denySame &&
      prev.toolPermissionContext.pollEventDeliveryGuard !== true &&
      prev.toolPermissionContext.strippedDangerousRules?.command === undefined
    ) {
      return prev
    }
    const cleared = clearCommandScopedAllowRules(prev.toolPermissionContext)
    return {
      ...prev,
      toolPermissionContext: {
        ...cleared,
        alwaysAllowRules: {
          ...cleared.alwaysAllowRules,
          command: additionalAllowedTools,
        },
        alwaysDenyRules: {
          ...cleared.alwaysDenyRules,
          command: nextDeny.length > 0 ? nextDeny : undefined,
        },
        pollEventDeliveryGuard: undefined,
      },
    }
  })

  if (!shouldQuery) {
    if (newMessages.some(isCompactBoundaryMessage)) {
      setConversationId(randomUUID())
      setAppState(prev =>
        pruneDisplayedMessageContent(prev, messagesRef.current),
      )
      if (feature('PROACTIVE') || feature('KAIROS')) {
        proactiveModule?.setContextBlocked(false)
      }
    }
    resetLoadingState()
    setAbortController(null)
    return
  }

  // Official 2.1.327 #398: wait for initial plugin load to settle before
  // starting a turn (especially restarted or autonomous turns) so plugin
  // commands, agents, and hooks are loaded before the turn runs.
  await waitForInitialPluginsLoaded(abortController.signal)

  const toolUseContext = getToolUseContext(
    messagesIncludingNewMessages,
    newMessages,
    abortController,
    mainLoopModelParam,
  )
  const { tools: freshTools, mcpClients: freshMcpClients } =
    toolUseContext.options

  if (effort !== undefined) {
    const previousGetAppState = toolUseContext.getAppState
    toolUseContext.getAppState = () => ({
      ...previousGetAppState(),
      sessionEffort: levelSessionEffort(effort),
    })
    try {
      const { leftoverIhr } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../../utils/collapseReadSearch.js') as typeof import('../../utils/collapseReadSearch.js')
      leftoverIhr.main.setTurnEffort(effort)
    } catch {
      // isolation — optional
    }
  }

  const modelFacts = await resolveModelFacts(mainLoopModelParam, {
    credentials: toolUseContext.credentials,
    abortController,
  })
  const promptRenderEpoch = getPromptRenderEpoch()

  queryCheckpoint('query_context_loading_start')
  const [, , defaultSystemPrompt, baseUserContext, systemContext] =
    await Promise.all([
      undefined,
      feature('TRANSCRIPT_CLASSIFIER')
        ? checkAndDisableAutoModeIfNeeded(
            toolPermissionContext,
            setAppState,
            store.getState().fastMode,
          )
        : undefined,
      getSystemPrompt(
        freshTools,
        mainLoopModelParam,
        Array.from(toolPermissionContext.additionalWorkingDirectories.keys()),
        freshMcpClients,
      ),
      getUserContext(),
      getSystemContext(),
    ])
  const userContext = {
    ...baseUserContext,
    ...getCoordinatorUserContext(
      freshMcpClients,
      isScratchpadEnabled() ? getScratchpadDir() : undefined,
      freshTools,
    ),
    ...((feature('PROACTIVE') || feature('KAIROS')) &&
    proactiveModule?.isProactiveActive() &&
    !terminalFocusRef.current
      ? {
          terminalFocus:
            'The terminal is unfocused \u2014 the user is not actively watching.',
        }
      : {}),
  }
  queryCheckpoint('query_context_loading_end')

  const systemPrompt = buildEffectiveSystemPrompt({
    mainThreadAgentDefinition,
    toolUseContext,
    customSystemPrompt,
    defaultSystemPrompt,
    appendSystemPrompt,
  })
  toolUseContext.renderedSystemPrompt = systemPrompt

  queryCheckpoint('query_query_start')
  resetTurnHookDuration()
  resetTurnToolDuration()
  resetTurnClassifierDuration()

  const turnInput: QueryParams = {
    messages: messagesIncludingNewMessages,
    systemPrompt,
    userContext,
    systemContext,
    canUseTool,
    toolUseContext,
    querySource: getQuerySourceForREPL(),
    stopHookActive,
    promptRenderEpoch,
    modelFacts,
    // Official 2.1.328 #555: rebuild dynamic systemPrompt after autocompact /
    // reactive compact the same way `/compact` does.
    renderSystemPrompt: async ctx => {
      const freshDefaultSystemPrompt = await getSystemPrompt(
        ctx.options.tools,
        ctx.options.mainLoopModel,
        Array.from(
          ctx
            .getAppState()
            .toolPermissionContext.additionalWorkingDirectories.keys(),
        ),
        ctx.options.mcpClients,
      )
      const rebuilt = buildEffectiveSystemPrompt({
        mainThreadAgentDefinition,
        toolUseContext: ctx,
        customSystemPrompt,
        defaultSystemPrompt: freshDefaultSystemPrompt,
        appendSystemPrompt,
      })
      return {
        systemPrompt: rebuilt,
        promptRenderEpoch: getPromptRenderEpoch(),
      }
    },
  }
  const onAbort = () => {
    void hostEngine.interrupt('user-cancel')
  }
  if (abortController.signal.aborted) {
    onAbort()
  } else {
    abortController.signal.addEventListener('abort', onAbort, { once: true })
  }
  let result: SDKResultMessage | undefined
  try {
    result = await runHostEngineTurn({
      engine: hostEngine,
      feed: engineFeed,
      onRead: deps.onEngineRead,
      onMainRequestStart: () => {
        if (!abortController.signal.aborted) deps.onMainRequestStart?.()
      },
      onStatus: deps.onEngineStatus,
      turnInput,
      newMessages,
      onQueryEvent: event => {
        onQueryEvent(event as Parameters<typeof onQueryEvent>[0])
      },
      addNotification: n => {
        addNotification({
          key: n.key ?? 'engine-notification',
          text: n.text,
          priority:
            n.priority === 'low' ||
            n.priority === 'medium' ||
            n.priority === 'high' ||
            n.priority === 'immediate'
              ? n.priority
              : 'medium',
          timeoutMs: n.timeoutMs,
        })
      },
    })
  } finally {
    abortController.signal.removeEventListener('abort', onAbort)
  }

  {
    // densable _runImpl post-query
    const arm = leftArrowDeferRef.current
    if (arm) {
      arm.clearCapTimer()
      leftArrowDeferRef.current = null
      if (!abortController.signal.aborted) {
        const liveTasks = (store.getState().tasks ?? {}) as Record<
          string,
          TaskState
        >
        const abandon = countAbandonableLeftArrow(liveTasks)
        const newMonitors = countNewMonitorsSincePress(
          liveTasks,
          arm.carriedAtPress,
        )
        const queued = countLeftArrowBlockingQueuedCommands(getCommandQueue())
        const hasUnsent = inputValueRef.current.trim() !== ''
        if (
          queued > 0 ||
          hasUnsent ||
          (!arm.confirmedInterstitial && abandon > 0) ||
          newMonitors > 0
        ) {
          const [why, hint] =
            queued > 0
              ? [
                  `${queued} queued ${queued === 1 ? 'command' : 'commands'} would be lost`,
                  'Press \u2190 again once the queue clears.',
                ]
              : hasUnsent
                ? [
                    'you have unsent text in the input',
                    'Send it or clear it, then press \u2190 again.',
                  ]
                : newMonitors > 0
                  ? [
                      `${newMonitors} Artifact comment ${newMonitors === 1 ? 'monitor' : 'monitors'} started after you pressed \u2190`,
                      'Press \u2190 again to review and confirm.',
                    ]
                  : [
                      `${abandon} background ${abandon === 1 ? 'task' : 'tasks'} would be abandoned`,
                      'Press \u2190 again to confirm.',
                    ]
          // densable post-query refuse: K({append, Ss(...,"warning")}) — not yi
          setMessages(prev => [
            ...prev,
            createSystemMessage(
              `Backgrounding cancelled \u2014 ${why}. ${hint}`,
              'warning',
            ),
          ])
          markIdleForkMidTurn()
        } else {
          // densable: q.current=!0; await K9(W.getSnapshot(),…); $e=await he.proceed();
          // append Ss($e,"warning"); G()
          // tip: recordTranscript (storageV5 5th arg invent-ban)
          leftArrowToAgentsFired.current = true
          try {
            const { recordTranscript } = await import(
              '../../utils/sessionStorage.js'
            )
            await recordTranscript(messagesRef.current as never)
          } catch {
            /* best-effort persist before handoff */
          }
          const $e = await arm.proceed()
          setMessages(prev => [...prev, createSystemMessage($e, 'warning')])
          markIdleForkMidTurn()
        }
      } else if (abortController.signal.reason !== 'background') {
        setMessages(prev => [
          ...prev,
          createSystemMessage(LEFT_ARROW_STOPPED_TURN_TOAST, 'warning'),
        ])
      }
    }
  }

  if (
    buddyEnabled &&
    typeof (globalThis as Record<string, unknown>).fireCompanionObserver ===
      'function'
  ) {
    const _fireCompanionObserver = (globalThis as Record<string, unknown>)
      .fireCompanionObserver as (
      msgs: unknown,
      cb: (r: unknown) => void,
    ) => void
    void _fireCompanionObserver(messagesRef.current, reaction =>
      setAppState(prev =>
        prev.companionReaction === (reaction as typeof prev.companionReaction)
          ? prev
          : {
              ...prev,
              companionReaction: reaction as typeof prev.companionReaction,
            },
      ),
    )
  }

  queryCheckpoint('query_end')

  if (feature('UDS_INBOX')) {
    if (abortController.signal.aborted) {
      pipeReturnHadErrorRef.current = true
      relayPipeMessage({
        type: 'error',
        data: 'Slave request was interrupted before completion.',
      })
    }
  }

  if (process.env.USER_TYPE === 'ant' && apiMetricsRef.current.length > 0) {
    const entries = apiMetricsRef.current

    const ttfts = entries.map(e => e.ttftMs)
    const otpsValues = entries.map(e => {
      const delta = Math.round(
        (e.endResponseLength - e.responseLengthBaseline) / 4,
      )
      const samplingMs = e.lastTokenTime - e.firstTokenTime
      return samplingMs > 0 ? Math.round(delta / (samplingMs / 1000)) : 0
    })

    const isMultiRequest = entries.length > 1
    const hookMs = getTurnHookDurationMs()
    const hookCount = getTurnHookCount()
    const toolMs = getTurnToolDurationMs()
    const toolCount = getTurnToolCount()
    const classifierMs = getTurnClassifierDurationMs()
    const classifierCount = getTurnClassifierCount()
    const turnMs = performance.now() - loadingStartTimeRef.current
    setMessages(prev => [
      ...prev,
      createApiMetricsMessage({
        ttftMs: isMultiRequest ? median(ttfts) : ttfts[0]!,
        otps: isMultiRequest ? median(otpsValues) : otpsValues[0]!,
        isP50: isMultiRequest,
        hookDurationMs: hookMs > 0 ? hookMs : undefined,
        hookCount: hookCount > 0 ? hookCount : undefined,
        turnDurationMs: turnMs > 0 ? turnMs : undefined,
        toolDurationMs: toolMs > 0 ? toolMs : undefined,
        toolCount: toolCount > 0 ? toolCount : undefined,
        classifierDurationMs: classifierMs > 0 ? classifierMs : undefined,
        classifierCount: classifierCount > 0 ? classifierCount : undefined,
        configWriteCount: getGlobalConfigWriteCount(),
      }),
    ])
  }

  resetLoadingState()
  logQueryProfileReport()
  await onTurnComplete?.(
    messagesRef.current,
    typeof result?.terminal_reason === 'string'
      ? result.terminal_reason
      : undefined,
  )
  return result
}

/**
 * Orchestrates a full REPL turn: `queryGuard` concurrency guard & re-queueing,
 * `executeReplTurnImpl` execution, and `finally` cleanup (turn duration,
 * UDS_INBOX completion, bridge notification, and user-cancel auto-restore).
 */
export async function runReplTurn(
  args: RunReplTurnArgs,
  deps: RunReplTurnDeps,
): Promise<boolean> {
  const {
    newMessages,
    abortController,
    shouldQuery,
    additionalAllowedTools,
    mainLoopModelParam,
    onBeforeQueryCallback,
    input,
    effort,
    stopHookActive,
    clientPlatform,
    additionalDisallowedTools = [],
  } = args

  const {
    store,
    queryGuard,
    pipeReturnHadErrorRef,
    relayPipeMessage,
    resetTimingRefs,
    setMessages,
    messagesRef,
    responseLengthRef,
    apiMetricsRef,
    setStreamingToolUses,
    clearStreamingText,
    displayTransform,
    mrOnBeforeQuery,
    mrOnTurnComplete,
    setLastQueryCompletionTime,
    resetLoadingState,
    sendBridgeResultRef,
    setAppState,
    loadingStartTimeRef,
    totalPausedMsRef,
    proactiveActive,
    swarmStartTimeRef,
    swarmBudgetInfoRef,
    backgroundWaitStartTimeRef,
    setAbortController,
    inputValueRef,
    restoreMessageSyncRef,
  } = deps

  if (isAgentSwarmsEnabled()) {
    const teamName = getTeamName()
    const agentName = getAgentName()
    if (teamName && agentName) {
      void setMemberActive(teamName, agentName, true)
    }
  }

  const thisGeneration = queryGuard.tryStart()
  if (thisGeneration === null) {
    logEvent('tengu_concurrent_onquery_detected', {})

    let enqueued = false
    for (const m of newMessages) {
      if (m.type !== 'user') continue
      if (m.dispatchEcho === true) continue
      const row = m as UserMessage &
        Partial<QueuedCommand> & {
          queueOrigin?: QueuedCommand['origin']
          queueMode?: QueuedCommand['mode']
          queueSkipAttachments?: boolean
          queueSkipSlashCommands?: boolean
          queueTranscriptOnly?: boolean
        }
      const origin = row.queueOrigin ?? row.origin
      const mode =
        row.queueMode ??
        (origin?.kind === 'task-notification' ? 'task-notification' : 'prompt')
      if (m.isMeta && !isMetaVisibleOrigin(origin)) {
        continue
      }
      if ((m as { stackedExpansion?: boolean }).stackedExpansion) {
        continue
      }
      const userContent = m.message?.content
      if (userContent === undefined) continue
      const stackedOriginal = (m as { stackedOriginalInput?: string })
        .stackedOriginalInput
      const textContent =
        stackedOriginal ??
        getContentText(userContent as string | ContentBlockParam[])
      if (textContent === null || textContent === undefined) continue
      const queuePriority = (m as { queuePriority?: 'now' | 'next' | 'later' })
        .queuePriority
      const verifiedSlackHumanTurn = (m as { verifiedSlackHumanTurn?: boolean })
        .verifiedSlackHumanTurn
      const promptSource = (m as { promptSource?: string }).promptSource
      enqueue({
        value: textContent,
        mode,
        agentId: getMainThreadAgentId(),
        uuid: m.uuid,
        admissionExempt: 'resurrected',
        origin,
        isMeta: m.isMeta,
        skipAttachments:
          row.queueSkipAttachments === true || mode === 'task-notification'
            ? true
            : undefined,
        skipSlashCommands:
          isMetaVisibleOrigin(origin) ||
          row.queueSkipSlashCommands === true ||
          row.textNotTyped === true ||
          row.handedOff === true,
        ...(row.queueTranscriptOnly === true ? { shouldQuery: false } : {}),
        ...(row.textNotTyped === true || row.handedOff === true
          ? { textNotTyped: true, noPersonArrived: true, drainOnly: true }
          : {}),
        ...(row.taskDelivery !== undefined
          ? { taskDelivery: row.taskDelivery }
          : {}),
        ...(row.scheduledTaskId !== undefined
          ? { scheduledTaskId: row.scheduledTaskId }
          : {}),
        ...(row.scheduledFireId !== undefined
          ? { scheduledFireId: row.scheduledFireId }
          : {}),
        ...(row.wakeupSource !== undefined
          ? { wakeupSource: row.wakeupSource }
          : {}),
        ...(row.fromConnector === true ? { fromConnector: true } : {}),
        ...(row.toolsUsed !== undefined ? { toolsUsed: row.toolsUsed } : {}),
        ...(row.projectsUserTurn === true ? { projectsUserTurn: true } : {}),
        ...(row.emailSenderTurn !== undefined
          ? { emailSenderTurn: row.emailSenderTurn }
          : {}),
        ...(row.answeredPost !== undefined
          ? { answeredPost: row.answeredPost }
          : {}),
        ...(row.hearthRelayRows !== undefined
          ? { hearthRelayRows: row.hearthRelayRows }
          : {}),
        ...(row.hearthRelayMessageIds !== undefined
          ? { hearthRelayMessageIds: row.hearthRelayMessageIds }
          : {}),
        ...(row.hearthRelayThreadTs !== undefined
          ? { hearthRelayThreadTs: row.hearthRelayThreadTs }
          : {}),
        ...(stopHookActive !== undefined ? { stopHookActive } : {}),
        ...(clientPlatform !== undefined ? { clientPlatform } : {}),
        ...(queuePriority !== undefined ? { priority: queuePriority } : {}),
        ...(verifiedSlackHumanTurn !== undefined
          ? { verifiedSlackHumanTurn }
          : {}),
        ...(promptSource === 'suggestion_accepted'
          ? { inputSource: 'suggestion_accepted' }
          : {}),
        ...(stackedOriginal !== undefined
          ? { preExpansionValue: stackedOriginal }
          : {}),
      })
      if (!enqueued) {
        enqueued = true
        logEvent('tengu_concurrent_onquery_enqueued', {})
      }
    }
    return false
  }

  setMainLoopBusy(true)
  let engineResult: SDKResultMessage | undefined

  try {
    pipeReturnHadErrorRef.current = false
    resetTimingRefs()
    setMessages(oldMessages => [...oldMessages, ...newMessages])
    responseLengthRef.current = 0
    if (feature('TOKEN_BUDGET')) {
      const parsedBudget = input ? parseTokenBudget(input) : null
      snapshotOutputTokensForTurn(parsedBudget ?? getCurrentTurnTokenBudget())
    }
    apiMetricsRef.current = []
    setStreamingToolUses([])
    clearStreamingText()
    displayTransform.newTurn()

    const headHooks = shouldQuery
      ? deps.awaitSessionStartHooks?.(abortController.signal)
      : undefined
    if (headHooks) await headHooks
    const latestMessages = messagesRef.current

    if (input) {
      await mrOnBeforeQuery(input, latestMessages, newMessages.length)
    }

    if (onBeforeQueryCallback && input) {
      const shouldProceed = await onBeforeQueryCallback(input, latestMessages)
      if (!shouldProceed) {
        return true
      }
    }

    const idleRunner = getIdleCompactionRunner()
    idleRunner.clear()
    const heldSummary = idleRunner.consumeHeldSummary() as MessageType[] | null
    let effectiveLatestMessages = latestMessages
    if (heldSummary && heldSummary.length > 0) {
      const injected = [
        ...heldSummary,
        createSystemMessage(IDLE_COMPACT_SUMMARIZED_MESSAGE, 'info'),
      ]
      setMessages(oldMessages => [...injected, ...oldMessages])
      effectiveLatestMessages = [...injected, ...latestMessages]
    }
    const lastPrevMsg = latestMessages.at(-1)
    const lastPrevTs =
      lastPrevMsg &&
      'timestamp' in lastPrevMsg &&
      typeof lastPrevMsg.timestamp === 'string'
        ? Date.parse(lastPrevMsg.timestamp)
        : undefined
    idleRunner.consumeReturnAfterIdle(
      lastPrevTs !== undefined && !Number.isNaN(lastPrevTs)
        ? lastPrevTs
        : undefined,
      tokenCountWithEstimation(effectiveLatestMessages),
    )

    try {
      engineResult = await executeReplTurnImpl(
        deps,
        effectiveLatestMessages,
        newMessages,
        abortController,
        shouldQuery,
        additionalAllowedTools,
        mainLoopModelParam,
        effort,
        stopHookActive,
        additionalDisallowedTools,
      )
    } catch (error) {
      if (feature('UDS_INBOX')) {
        pipeReturnHadErrorRef.current = true
        relayPipeMessage({
          type: 'error',
          data: error instanceof Error ? error.message : String(error),
        })
      }
      throw error
    }
  } finally {
    if (queryGuard.end(thisGeneration)) {
      const turnEndMs = Date.now()
      setMainLoopBusy(false)
      setLastQueryCompletionTime(turnEndMs)
      resetLoadingState()
      const idleRunner = getIdleCompactionRunner()
      idleRunner.recordTurnEnd(
        abortController.signal.aborted ? 'aborted' : 'completed',
      )
      idleRunner.arm(
        turnEndMs,
        () => (messagesRef.current.length > 0 ? messagesRef.current : null),
        {
          isInteractive: true,
          getContextTokens: () => tokenCountWithEstimation(messagesRef.current),
        },
      )

      await mrOnTurnComplete(
        messagesRef.current,
        abortController.signal.aborted,
      )

      if (feature('UDS_INBOX') && !pipeReturnHadErrorRef.current) {
        relayPipeMessage({
          type: 'done',
          data: '',
        })
      }

      sendBridgeResultRef.current()

      if (process.env.USER_TYPE === 'ant' && !abortController.signal.aborted) {
        setAppState(prev => {
          if (prev.tungstenActiveSession === undefined) return prev
          if (prev.tungstenPanelAutoHidden === true) return prev
          return { ...prev, tungstenPanelAutoHidden: true }
        })
      }

      let budgetInfo:
        | { tokens: number; limit: number; nudges: number }
        | undefined
      if (feature('TOKEN_BUDGET')) {
        if (
          getCurrentTurnTokenBudget() !== null &&
          getCurrentTurnTokenBudget()! > 0 &&
          !abortController.signal.aborted
        ) {
          budgetInfo = {
            tokens: getTurnOutputTokens(),
            limit: getCurrentTurnTokenBudget()!,
            nudges: getBudgetContinuationCount(),
          }
        }
        snapshotOutputTokensForTurn(null)
      }

      const turnDurationMs =
        performance.now() -
        loadingStartTimeRef.current -
        totalPausedMsRef.current
      const terminalReason =
        typeof engineResult?.terminal_reason === 'string'
          ? engineResult.terminal_reason
          : undefined
      if (
        !abortController.signal.aborted &&
        !proactiveActive &&
        engineResult?.is_error !== true &&
        !isUserAbortTerminalReason(terminalReason) &&
        !isErrorClassTerminalReason(terminalReason)
      ) {
        const hasRunningSwarmAgents = getAllInProcessTeammateTasks(
          store.getState().tasks,
        ).some(t => t.status === 'running')
        if (hasRunningSwarmAgents) {
          if (swarmStartTimeRef.current === null) {
            swarmStartTimeRef.current = loadingStartTimeRef.current
          }
          if (budgetInfo) {
            swarmBudgetInfoRef.current = budgetInfo
          }
        } else {
          const now = performance.now()
          const resolvedDuration = resolveTurnDurationWithBackgroundWait({
            tasks: store.getState().tasks,
            queuedCommands: getCommandQueue(),
            turnDurationMs,
            turnStartTime: loadingStartTimeRef.current,
            now,
            backgroundWaitStartTime: backgroundWaitStartTimeRef.current,
          })
          backgroundWaitStartTimeRef.current =
            resolvedDuration.backgroundWaitStartTime
          setMessages(prev => {
            const turnDurationMsg = createTurnDurationMessage(
              resolvedDuration.durationMs,
              budgetInfo,
              count(prev, isLoggableMessage),
              resolvedDuration.pendingBackgroundAgentCount,
              resolvedDuration.pendingWorkflowCount,
            )
            // Official 2.1.326 #159: suppress the "done" (`turn_duration`) line
            // when the turn ended in an API error or permission refusal /
            // interruption and no background wait is pending.
            if (
              resolvedDuration.backgroundWaitStartTime === null &&
              shouldSuppressTurnDurationForFailedOrRefusedTurn(
                [...prev, turnDurationMsg],
                prev.length,
              )
            ) {
              return prev
            }
            return [...prev, turnDurationMsg]
          })
        }
      }
      setAbortController(null)
    }

    if (
      abortController.signal.reason === 'user-cancel' &&
      !queryGuard.isActive &&
      inputValueRef.current === '' &&
      getCommandQueueLength() === 0 &&
      !someInFlightDrainCommand() &&
      !store.getState().viewingAgentTaskId
    ) {
      const msgs = messagesRef.current
      const lastUserMsg = msgs.findLast(selectableUserMessagesFilter)
      if (lastUserMsg) {
        const idx = msgs.lastIndexOf(lastUserMsg)
        if (messagesAfterAreOnlySynthetic(msgs, idx)) {
          removeLastFromHistory()
          restoreMessageSyncRef.current(lastUserMsg)
        }
      }
    }
  }
  return true
}
