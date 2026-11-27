import {
  POLL_EVENT_KIND_REPL_EVAL,
  POLL_EVENT_KIND_REPL_STATUS,
} from '@claude-code/builtin-tools/tools/PollTool/constants.js'
import type { RefObject } from 'react'
import {
  getSessionId,
  isMainThreadQueuedCommand,
} from '../../bootstrap/state.js'
import {
  createHostEngine,
  type HostEngine,
  isErrorClassTerminalReason,
  isUserAbortTerminalReason,
} from '../../engine/hostEngine.js'
import type { QueryParams } from '../../query.js'
import { query } from '../../query.js'
import type { Terminal as QueryTerminal } from '../../query/transitions.js'
import { REPL_MAIN_THREAD_KEY } from '../../services/codeMode/constants.js'
import { isCodeModeEnabled } from '../../services/codeMode/optIn.js'
import {
  isReplSpliceWaitEnabled,
  lingerForAsyncReplEvents,
  replSpliceEventBatching,
} from '../../services/codeMode/replSessions.js'
import { clearGoalOnUnrecoverableError } from '../../services/goal/goalUnrecoverableClear.js'
import type { QueuedCommand } from '../../types/textInputTypes.js'
import { getAbortReasonMessage } from '../../utils/abortController.js'
import {
  enqueueReplStatusPollEvent,
  type MessageQueueInstance,
} from '../../utils/messageQueueManager.js'
import type { TurnController } from './TurnController.js'

/**
 * Construct the default self-owned REPL HostEngine when no external engine
 * is passed in via `Props.engine`.
 */
export function createReplHostEngine(deps: {
  turnControllerRef: RefObject<TurnController | null>
  messageQueueRef: RefObject<MessageQueueInstance | null>
}): HostEngine {
  const { turnControllerRef, messageQueueRef } = deps
  return createHostEngine<QueryParams>({
    sessionId: getSessionId(),
    prepareTurn: async () => {
      const turn = turnControllerRef.current
      if (!turn) throw new Error('engine: turn controller is not mounted')
      return turn.readPendingQueryParams()
    },
    runTurn: async function* (prepared, abortController) {
      // Official 2.1.328 HGt (chunk@306199530.js @73100-73350, @83300-84900):
      // Preserve externalAc.signal.reason verbatim on engine abortController,
      // back-propagate refusal-fallback-edit to externalAc, remove BOTH abort
      // listeners in finally, and let hostEngine synthesize the result envelope
      // AFTER runTurn exits and finally cleanup completes.
      const externalAc = prepared.toolUseContext.abortController
      const hasDistinctExternalAc = Boolean(
        externalAc && externalAc !== abortController,
      )
      const onExternalAbort = () => {
        if (!abortController.signal.aborted) {
          abortController.abort(externalAc?.signal.reason)
        }
      }
      const onEngineAbort = () => {
        if (
          getAbortReasonMessage(abortController.signal.reason) ===
            'refusal-fallback-edit' &&
          externalAc &&
          externalAc !== abortController &&
          !externalAc.signal.aborted
        ) {
          externalAc.abort(abortController.signal.reason)
        }
      }
      if (hasDistinctExternalAc && externalAc) {
        if (externalAc.signal.aborted) {
          abortController.abort(externalAc.signal.reason)
        } else {
          externalAc.signal.addEventListener('abort', onExternalAbort, {
            once: true,
          })
        }
        if (abortController.signal.aborted) {
          onEngineAbort()
        } else {
          abortController.signal.addEventListener('abort', onEngineAbort, {
            once: true,
          })
        }
      }
      const toolUseContext = {
        ...prepared.toolUseContext,
        abortController,
      }
      let terminal: QueryTerminal | undefined
      let thrown: unknown
      try {
        try {
          terminal = yield* query({
            ...prepared,
            toolUseContext,
          })
        } catch (err) {
          thrown = err
        }
        // Official 2.1.328 Hc (chunk@305854618.js @104576):
        // Linger briefly for detached/unwaited async Code Mode REPL eval
        // events at turn end before reporting pending status.
        if (
          thrown === undefined &&
          !abortController.signal.aborted &&
          !isUserAbortTerminalReason(terminal?.reason) &&
          !isErrorClassTerminalReason(terminal?.reason) &&
          isCodeModeEnabled() &&
          isReplSpliceWaitEnabled()
        ) {
          const mq = messageQueueRef.current
          if (mq) {
            await lingerForAsyncReplEvents({
              key: REPL_MAIN_THREAD_KEY,
              signal: abortController.signal,
              getNews: () =>
                mq
                  .getCommands()
                  .filter(
                    cmd =>
                      isMainThreadQueuedCommand(cmd) &&
                      !(
                        cmd.mode === 'poll-event' &&
                        cmd.pollEvent?.kind === POLL_EVENT_KIND_REPL_STATUS
                      ),
                  ),
              subscribe: fn => mq.subscribe(fn),
              isEvalSettleItem: item => {
                const cmd = item as QueuedCommand
                return (
                  cmd.mode === 'poll-event' &&
                  cmd.pollEvent?.kind === POLL_EVENT_KIND_REPL_EVAL
                )
              },
              onPendingStatus: pending => {
                enqueueReplStatusPollEvent({ ledger: pending })
              },
              ...replSpliceEventBatching(),
            })
          }
        }
        // densable Ebe finally: yield* pXp(activeGoal, toolUseContext, querySource, terminal)
        const clearTerminal =
          terminal ??
          (thrown !== undefined
            ? ({ reason: 'api_error', error: thrown } as QueryTerminal)
            : undefined)
        yield* clearGoalOnUnrecoverableError(
          toolUseContext.getAppState().activeGoal,
          toolUseContext,
          prepared.querySource,
          clearTerminal,
        )
        if (thrown !== undefined) {
          throw thrown
        }
        return terminal
      } finally {
        if (hasDistinctExternalAc) {
          externalAc?.signal.removeEventListener('abort', onExternalAbort)
          abortController.signal.removeEventListener('abort', onEngineAbort)
        }
      }
    },
  })
}
