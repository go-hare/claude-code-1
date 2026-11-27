import { feature } from 'bun:bundle'
import type * as React from 'react'
import { useCallback, useEffect, useRef } from 'react'
import { getFeatureValue_CACHED_MAY_BE_STALE } from 'src/services/analytics/growthbook.js'
import { logEvent } from 'src/services/analytics/index.js'
import { getSessionId } from '../../bootstrap/state.js'
import type { Notification } from '../../context/notifications.js'
import { addToHistory } from '../../history.js'
import {
  codeModeBackgroundRefusal,
  isCodeModeEnabled,
} from '../../services/codeMode/optIn.js'
import type { AppState } from '../../state/AppStateStore.js'
import type { Store } from '../../state/store.js'
import type { TaskState } from '../../tasks/types.js'
import type { ToolPermissionContext } from '../../Tool.js'
import type { Message as MessageType } from '../../types/message.js'
import { logForDebugging } from '../../utils/debug.js'
import {
  buildLeftArrowConfirmState,
  collectFrameLiveMonitorSlugs,
  countAbandonableLeftArrow,
  countActiveInFlight,
  countLeftArrowBlockingQueuedCommands,
  countNewMonitorsSincePress,
  evaluateLeftArrowIhtGates,
  formatDeferCapRestartableToast,
  formatDeferMonitorCancelToast,
  formatDeferSkipAbandonToast,
  isLeftArrowDeferStickyQueueCmd,
  type LeftArrowConfirmState,
  shouldShowLeftArrowFailureMessage,
} from '../../utils/leftArrowConfirm.js'
import {
  isLeftArrowBetweenCalls,
  isLeftArrowStreamOpen,
  LEFT_ARROW_VIA_BLOCKED_TOAST,
  type LeftArrowVia,
  resolveLeftArrowVia,
  rewriteLeftArrowViaForAbortController,
} from '../../utils/leftArrowVia.js'
import type { MessageQueueInstance } from '../../utils/messageQueueManager.js'
import { createSystemMessage } from '../../utils/messages.js'
import type { QueryGuard } from '../../utils/QueryGuard.js'
import { isPersistenceSuppressed } from '../../utils/sessionPersistenceStatus.js'
import type { TurnController } from './TurnController.js'
import type { LeftArrowDeferArm, Props } from './types.js'

const LEFT_ARROW_DEFER_REPRESS_MS = 1000

/**
 * Owns the left-arrow-on-empty fleet/background handoff state, confirm dialog
 * state, defer-then-fork arm timer, and `onLeftArrowOnEmpty` gesture handler.
 */
export function useReplLeftArrowAgents(params: {
  onOpenAgents: Props['onOpenAgents']
  store: Store<AppState>
  tasks: AppState['tasks']
  toolPermissionContext: ToolPermissionContext
  messageQueue: MessageQueueInstance
  turnController: TurnController
  queryGuard: QueryGuard
  isLoading: boolean
  isExternalLoading: boolean
  messagesRef: React.RefObject<MessageType[]>
  inputValueRef: React.RefObject<string>
  turnStartRef: React.RefObject<{ length: number; uuid?: string } | null>
  getStreamingTextRaw: () => string | null
  setMessages: (action: React.SetStateAction<MessageType[]>) => void
  addNotification: (notif: Notification) => void
  hasPendingQuestion: boolean
  leftArrowConfirm: LeftArrowConfirmState | null
  setLeftArrowConfirm: React.Dispatch<
    React.SetStateAction<LeftArrowConfirmState | null>
  >
  leftArrowDeferRef: React.RefObject<LeftArrowDeferArm | null>
  leftArrowToAgentsFired: React.RefObject<boolean>
  handOverInFlight: Store<boolean>
}): {
  onLeftArrowOnEmpty: (() => void) | undefined
} {
  const {
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
    hasPendingQuestion,
    leftArrowConfirm,
    setLeftArrowConfirm,
    leftArrowDeferRef,
    leftArrowToAgentsFired,
    handOverInFlight,
  } = params

  const hasPendingQuestionRef = useRef(false)
  hasPendingQuestionRef.current = hasPendingQuestion
  const leftArrowConfirmOpenRef = useRef(false)
  leftArrowConfirmOpenRef.current = leftArrowConfirm != null

  // densable TurnController finally: clearCapTimer on unmount
  useEffect(() => {
    return () => {
      const arm = leftArrowDeferRef.current
      if (arm) {
        arm.clearCapTimer()
        leftArrowDeferRef.current = null
      }
    }
  }, [leftArrowDeferRef])

  const handleLeftArrowOnEmpty = useCallback(() => {
    if (!onOpenAgents) return
    const openAgents = onOpenAgents
    const taskSnap = (tasks ?? {}) as Record<string, TaskState>
    const carriedAtPress = collectFrameLiveMonitorSlugs(taskSnap)

    // densable iHt: if (jpt.current || _r.current) return
    if (leftArrowToAgentsFired.current || leftArrowConfirmOpenRef.current) {
      return
    }

    const yi = (text: string) => {
      const visibleText = shouldShowLeftArrowFailureMessage(
        text,
        Boolean(store.getState().replBridgeEnabled),
      )
      if (!visibleText) {
        if (text) {
          logForDebugging(
            `leftArrowGesture: ← failed; withheld from screen while Remote Control is on: ${text}`,
          )
        }
        return
      }
      setMessages(prev => {
        const last = prev.at(-1)
        if (
          last?.type === 'system' &&
          last.subtype === 'informational' &&
          last.content === visibleText
        ) {
          return prev
        }
        return [...prev, createSystemMessage(visibleText, 'warning')]
      })
    }
    const Sl = (text: string) => {
      leftArrowToAgentsFired.current = false
      yi(text)
    }

    // densable iHt four gates before Ki
    {
      const Xr = countActiveInFlight(taskSnap)
      const iht = evaluateLeftArrowIhtGates({
        persistenceDisabled: isPersistenceSuppressed(),
        endedByModel: store.getState().endedByModel === true,
        queuedCount: countLeftArrowBlockingQueuedCommands(
          messageQueue.getCommands(),
        ),
        draft: inputValueRef.current,
        inFlight: Xr,
      })
      if (iht.blocked) {
        if (iht.emitBlockedEvent) {
          logEvent('tengu_left_arrow_blocked', {
            reason: iht.reason as never,
            inflight_count: iht.inflightCount,
            inflight_kinds: [...Xr.kinds].sort().join(',') as never,
          })
        }
        yi(iht.toast)
        return
      }
    }

    // densable: if Ki.current → second-press while defer-armed
    const deferArm = leftArrowDeferRef.current
    if (deferArm) {
      const sinceLast = Date.now() - deferArm.lastPressMs
      deferArm.lastPressMs = Date.now()
      if (sinceLast < LEFT_ARROW_DEFER_REPRESS_MS) return
      const liveTasks = (store.getState().tasks ?? {}) as Record<
        string,
        TaskState
      >
      const abandon = countAbandonableLeftArrow(liveTasks)
      if (!deferArm.confirmedInterstitial && abandon > 0) {
        addNotification({
          key: 'left-arrow-defer',
          text: formatDeferSkipAbandonToast(abandon),
          color: 'warning',
          priority: 'immediate',
        })
        return
      }
      const newMonitors = countNewMonitorsSincePress(
        liveTasks,
        deferArm.carriedAtPress,
      )
      if (newMonitors > 0) {
        deferArm.clearCapTimer()
        leftArrowDeferRef.current = null
        addNotification({
          key: 'left-arrow-defer',
          text: formatDeferMonitorCancelToast(newMonitors),
          color: 'warning',
          priority: 'immediate',
        })
        return
      }
      const ac = turnController.abortController
      if (ac && !ac.signal.aborted && queryGuard.isActive) {
        deferArm.clearCapTimer()
        leftArrowDeferRef.current = null
        void fireLeftArrowOpenAgents(deferArm.confirmedInterstitial, {
          forceVia: 'abort-then-fork',
          abortAfterFlush: ac,
          deferWaitMs: Date.now() - deferArm.armedAtMs,
          carriedAtPress: deferArm.carriedAtPress,
        }).then(Sl)
      } else if (!queryGuard.isActive) {
        deferArm.clearCapTimer()
        leftArrowDeferRef.current = null
        void deferArm.proceed().then(yi)
      }
      return
    }

    // densable: nh=dtn(...) before Swh/LAc — fail closed, no toast
    {
      const streamPeek = getStreamingTextRaw()
      const nh = resolveLeftArrowVia({
        isBg: false,
        isLoading: queryGuard.isActive,
        isExternalLoading,
        betweenCalls: isLeftArrowBetweenCalls(
          messagesRef.current as Array<{
            type: string
            message?: { stop_reason?: string | null }
          }>,
          isLeftArrowStreamOpen(streamPeek),
        ),
        inFlight: countActiveInFlight(taskSnap),
      })
      if (!nh.ok) {
        logEvent('tengu_left_arrow_blocked', {
          reason: nh.reason as never,
          inflight_count: nh.inFlight.count,
          inflight_kinds: [...nh.inFlight.kinds].sort().join(',') as never,
        })
        return
      }
    }

    // densable: if Swh → Ot(Tt) LAc confirm; else Mu(false).
    const confirm = buildLeftArrowConfirmState(taskSnap, hasSummary => {
      void fireLeftArrowOpenAgents(hasSummary, { carriedAtPress }).then(Sl)
    })
    if (confirm) {
      setLeftArrowConfirm(confirm)
      return
    }
    void fireLeftArrowOpenAgents(false, { carriedAtPress }).then(Sl)

    async function fireLeftArrowOpenAgents(
      confirmedInterstitial: boolean,
      opts?: {
        forceVia?: 'abort-then-fork' | 'idle-fork' | 'defer-then-fork'
        abortAfterFlush?: AbortController
        deferWaitMs?: number
        deferCapFired?: boolean
        carriedAtPress?: Set<string>
      },
    ): Promise<string> {
      const monitorsAtPress =
        opts?.carriedAtPress ?? collectFrameLiveMonitorSlugs(taskSnap)
      const ban = countNewMonitorsSincePress(
        (store.getState().tasks ?? {}) as Record<string, TaskState>,
        monitorsAtPress,
      )
      if (ban > 0 && !opts?.forceVia) {
        addNotification({
          key: 'left-arrow-defer',
          text: formatDeferMonitorCancelToast(ban),
          color: 'warning',
          priority: 'immediate',
        })
        return ''
      }
      const snap = messagesRef.current as Array<{
        type: string
        uuid?: string
        isMeta?: boolean
        message?: {
          content?: unknown
          stop_reason?: string | null
        }
      }>
      // Lazy import to keep REPL cold path light.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const {
        buildInFlightPartialText,
        findForkBoundaryUuid,
        collectPortableCheckpoint,
      } =
        require('../../utils/bgCheckpoint.js') as typeof import('../../utils/bgCheckpoint.js')
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getSessionCronTasks } =
        require('../../bootstrap/state.js') as typeof import('../../bootstrap/state.js')
      const partialFromMsgs = buildInFlightPartialText(
        snap,
        isLoading ? getStreamingTextRaw() : null,
      )
      const boundaryUuid = findForkBoundaryUuid(snap)
      const collected = collectPortableCheckpoint({
        tasks: tasks as unknown as Record<
          string,
          import('../../utils/bgCheckpoint.js').PortableTaskLike
        >,
        cron: getSessionCronTasks(),
      })
      const checkpoint = collected?.payload
      const allow = toolPermissionContext?.alwaysAllowRules?.session ?? []
      const deny = toolPermissionContext?.alwaysDenyRules?.session ?? []
      const sessionPermissionRules =
        allow.length > 0 || deny.length > 0
          ? {
              allow: [...allow],
              deny: [...deny],
            }
          : undefined
      let memoryToggledOff: boolean | undefined
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { isAutoMemoryEnabled } =
          require('../../memdir/paths.js') as typeof import('../../memdir/paths.js')
        memoryToggledOff = !isAutoMemoryEnabled() ? true : undefined
      } catch {
        memoryToggledOff = undefined
      }
      if (collected) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { stashLeftArrowCheckpointLive } =
          require('../../utils/bgCheckpoint.js') as typeof import('../../utils/bgCheckpoint.js')
        stashLeftArrowCheckpointLive(collected)
      }
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { shouldReplyOnIdleFork } =
        require('../../cli/bg/leftArrowAgents.js') as typeof import('../../cli/bg/leftArrowAgents.js')
      const ig = turnController.abortController
      const liveAc = ig && !ig.signal.aborted ? ig : undefined
      const streamPeek = getStreamingTextRaw()
      const hasStreamText = isLeftArrowStreamOpen(streamPeek)
      let via: LeftArrowVia
      if (opts?.forceVia) {
        via = opts.forceVia
      } else {
        const fe = resolveLeftArrowVia({
          isBg: false,
          isLoading: queryGuard.isActive,
          isExternalLoading,
          betweenCalls: isLeftArrowBetweenCalls(snap, hasStreamText),
          inFlight: countActiveInFlight(
            (store.getState().tasks ?? {}) as Record<string, TaskState>,
          ),
        })
        if (!fe.ok) {
          logEvent('tengu_left_arrow_blocked', {
            reason: fe.reason as never,
            inflight_count: fe.inFlight.count,
            inflight_kinds: [...fe.inFlight.kinds].sort().join(',') as never,
          })
          addNotification({
            key: 'left-arrow-blocked',
            text: LEFT_ARROW_VIA_BLOCKED_TOAST,
            color: 'warning',
            priority: 'immediate',
          })
          return ''
        }
        via = rewriteLeftArrowViaForAbortController(fe.via, ig)
      }

      if (via === 'defer-then-fork' && !opts?.forceVia) {
        const armedAtMs = Date.now()
        const deferCapMs =
          getFeatureValue_CACHED_MAY_BE_STALE('tengu_defer_cap_ms', 10_000) ??
          10_000
        const timer = setTimeout(() => {
          const arm = leftArrowDeferRef.current
          if (!arm || arm.armedAtMs !== armedAtMs) return
          const hy = (store.getState().tasks ?? {}) as Record<string, TaskState>
          const fre = messageQueue
            .getCommands()
            .filter(c => !isLeftArrowDeferStickyQueueCmd(c)).length
          if (
            fre > 0 ||
            (!arm.confirmedInterstitial && countAbandonableLeftArrow(hy) > 0) ||
            countNewMonitorsSincePress(hy, arm.carriedAtPress) > 0
          ) {
            if (fre > 0) {
              logEvent('tengu_defer_cap_refused_queued', {
                queue_len: fre,
                wait_ms: Date.now() - armedAtMs,
              })
            }
            return
          }
          const inflight = countActiveInFlight(hy)
          const restartable = inflight.restartableCount ?? 0
          if (restartable > 0) {
            logEvent('tengu_defer_cap_refused_restartable', {
              restartable_count: restartable,
              wait_ms: Date.now() - armedAtMs,
            })
            addNotification({
              key: 'left-arrow-defer',
              text: formatDeferCapRestartableToast(restartable),
              color: 'warning',
              priority: 'immediate',
            })
            return
          }
          const mre = turnController.abortController
          if (mre && !mre.signal.aborted && queryGuard.isActive) {
            if (inputValueRef.current.trim() !== '') {
              logEvent('tengu_defer_cap_cancelled_draft', {
                wait_ms: Date.now() - armedAtMs,
              })
              leftArrowDeferRef.current = null
              addNotification({
                key: 'left-arrow-defer',
                text: 'Backgrounding cancelled \u2014 you have unsent text in the input. Send it or clear it, then press \u2190 again.',
                color: 'warning',
                priority: 'immediate',
              })
              return
            }
            if (hasPendingQuestionRef.current) {
              logEvent('tengu_defer_cap_refused_ask', {
                wait_ms: Date.now() - armedAtMs,
              })
              addNotification({
                key: 'left-arrow-defer',
                text: 'Still backgrounding after the current tool \u2014 a question is waiting for your answer.',
                color: 'suggestion',
                priority: 'immediate',
              })
              return
            }
            leftArrowDeferRef.current = null
            void fireLeftArrowOpenAgents(arm.confirmedInterstitial, {
              forceVia: 'abort-then-fork',
              abortAfterFlush: mre,
              deferWaitMs: Date.now() - armedAtMs,
              deferCapFired: true,
              carriedAtPress: arm.carriedAtPress,
            }).then(Sl)
          }
        }, deferCapMs)
        leftArrowDeferRef.current = {
          confirmedInterstitial,
          armedAtMs,
          lastPressMs: armedAtMs,
          clearCapTimer: () => clearTimeout(timer),
          carriedAtPress: monitorsAtPress,
          proceed: () =>
            fireLeftArrowOpenAgents(confirmedInterstitial, {
              forceVia: 'defer-then-fork',
              deferWaitMs: Date.now() - armedAtMs,
              carriedAtPress: monitorsAtPress,
            }).then(IY => {
              leftArrowToAgentsFired.current = false
              return IY
            }),
        }
        addNotification({
          key: 'left-arrow-defer',
          text: 'Backgrounding after the current tool finishes…',
          color: 'suggestion',
          priority: 'immediate',
        })
        return ''
      }

      const replyOnResume =
        via === 'abort-then-fork' || via === 'defer-then-fork'
          ? true
          : shouldReplyOnIdleFork(turnStartRef.current, snap)
      const abortAfterFlush =
        opts?.abortAfterFlush ??
        (via === 'abort-then-fork' ? liveAc : undefined)
      const handoffInFlight = countActiveInFlight(
        (store.getState().tasks ?? {}) as Record<string, TaskState>,
      )
      const partialForHandoff = isLoading
        ? partialFromMsgs || getStreamingTextRaw()
        : null
      const agentsPayload = {
        messages: snap,
        via,
        confirmedInterstitial,
        deferWaitMs: opts?.deferWaitMs,
        deferCapFired: opts?.deferCapFired,
        inflightCount: handoffInFlight.count,
        inflightKinds: handoffInFlight.kinds,
        restartableCount: handoffInFlight.restartableCount,
        partialChars: (partialForHandoff ?? '').length,
        partialText: partialForHandoff,
        boundaryUuid,
        agentsCount: checkpoint?.agents?.length ?? 0,
        checkpoint: checkpoint
          ? {
              shells: checkpoint.shells,
              cron: checkpoint.cron,
              agents: checkpoint.agents,
              workflows: checkpoint.workflows,
              frameLive: checkpoint.frameLive,
            }
          : undefined,
        liveMonitorSlugs: [...monitorsAtPress],
        sessionPermissionRules,
        memoryToggledOff,
        replyOnResume,
        abortAfterFlush,
      }
      if (isCodeModeEnabled()) {
        return codeModeBackgroundRefusal()
      }
      leftArrowToAgentsFired.current = true
      handOverInFlight.setState(() => true)
      try {
        const lateAc = turnController.abortController
        if (lateAc && !lateAc.signal.aborted && lateAc !== abortAfterFlush) {
          lateAc.abort('background')
        }
        for (const qCmd of messageQueue.getCommands()) {
          if (qCmd.historyEntry) {
            try {
              addToHistory(qCmd.historyEntry)
            } catch {
              /* best-effort history save */
            }
          }
        }
        const { isLeftArrowDaemonDetachOnly, openAgentsViaLeftArrow } =
          await import('../../cli/bg/leftArrowAgents.js')
        if (isLeftArrowDaemonDetachOnly()) {
          const sessionId = getSessionId()
          openAgents({
            ...agentsPayload,
            alreadyOpened: {
              ok: true,
              short: sessionId.slice(0, 8),
              sessionId,
            },
          })
          return 'Detached — use `claude agents` to see background sessions.'
        }
        if (feature('BG_SESSIONS')) {
          let opened: import('../../cli/bg/leftArrowAgents.js').LeftArrowOpenResult
          try {
            opened = await openAgentsViaLeftArrow(snap, {
              via,
              confirmedInterstitial,
              deferWaitMs: opts?.deferWaitMs,
              deferCapFired: opts?.deferCapFired,
              inflightCount: handoffInFlight.count,
              inflightKinds: handoffInFlight.kinds,
              restartableCount: handoffInFlight.restartableCount,
              partialChars: (partialForHandoff ?? '').length,
              partialText: partialForHandoff,
              boundaryUuid,
              agentsCount: checkpoint?.agents?.length ?? 0,
              checkpoint: agentsPayload.checkpoint,
              liveMonitorSlugs: [...monitorsAtPress],
              sessionPermissionRules,
              memoryToggledOff,
              replyOnResume,
              abortAfterFlush,
            })
          } catch {
            return "Couldn't background this session (an internal error was logged)"
          }
          if (!opened.ok) {
            return opened.error
          }
          openAgents({ ...agentsPayload, alreadyOpened: opened })
        } else {
          openAgents(agentsPayload)
        }
        return await new Promise<string>(() => {
          /* densable yHy: in-process fleet never returns to REPL */
        })
      } finally {
        handOverInFlight.setState(() => false)
      }
    }
  }, [
    onOpenAgents,
    tasks,
    store,
    setMessages,
    messageQueue,
    inputValueRef,
    addNotification,
    turnController,
    queryGuard,
    getStreamingTextRaw,
    isExternalLoading,
    messagesRef,
    isLoading,
    toolPermissionContext,
    turnStartRef,
    handOverInFlight,
  ])

  return {
    onLeftArrowOnEmpty: onOpenAgents ? handleLeftArrowOnEmpty : undefined,
  }
}
