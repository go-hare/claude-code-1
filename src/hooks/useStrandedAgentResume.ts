import { useCallback, useEffect } from 'react'
import type { CanUseToolFn } from './useCanUseTool.js'
import type { ToolUseContext } from '../Tool.js'
import {
  drainPendingMessages,
  queuePendingMessage,
  strandedAgentResume,
} from '../tasks/LocalAgentTask/LocalAgentTask.js'
import type { AppState } from '../state/AppState.js'
import { logForDebugging } from '../utils/debug.js'
import { errorMessage } from '../utils/errors.js'
import {
  ResumeAgentStateError,
  resumeAgentBackground,
} from '@claude-code/builtin-tools/tools/AgentTool/resumeAgent.js'

/**
 * densable luf / Weo.subscribe:
 * On agent complete with non-empty pendingMessages, drain queue and
 * resumeAgentBackground (Aye) with the first message; re-queue the rest.
 *
 * densable:
 *   Qeo → [a,...l]; for c of l: sqe(i,c.text,e,{origin:c.origin,isMeta:c.isMeta})
 *   try Aye({prompt:a.text,promptOrigin:a.origin,promptIsMeta:a.isMeta})
 *   catch { re-queue head; rethrow }
 *   outer: if (s instanceof B6) return; else xe + warning notify
 * B6 covers ResumeAgentStateError and AgentStoppedByUserError (orr⊂B6).
 */
export function useStrandedAgentResume({
  getAppState,
  setAppState,
  getToolUseContext,
  canUseTool,
  addNotification,
}: {
  getAppState: () => AppState
  setAppState: (f: (prev: AppState) => AppState) => void
  getToolUseContext: () => ToolUseContext
  canUseTool: CanUseToolFn
  addNotification: (n: {
    key: string
    text: string
    color?: 'error'
    priority: 'low'
  }) => void
}): void {
  const deliver = useCallback(
    async (agentId: string) => {
      const drained = drainPendingMessages(agentId, getAppState, setAppState)
      if (drained.length === 0) return
      const [head, ...rest] = drained
      for (const entry of rest) {
        // densable: sqe(i, c.text, e, {origin:c.origin, isMeta:c.isMeta})
        queuePendingMessage(agentId, entry, setAppState)
      }
      try {
        await resumeAgentBackground({
          agentId,
          prompt: head.text,
          toolUseContext: getToolUseContext(),
          canUseTool,
          // densable Aye promptOrigin / promptIsMeta → cIt + isMeta on sidechain
          promptIsMeta: head.isMeta,
          promptOrigin: head.origin,
          promptOriginKind: head.origin?.kind,
        })
      } catch (err) {
        // densable: re-queue head then rethrow — outer swallows B6 / notifies rest
        queuePendingMessage(agentId, head, setAppState)
        throw err
      }
    },
    [getAppState, setAppState, getToolUseContext, canUseTool],
  )

  useEffect(
    () =>
      strandedAgentResume.subscribe(agentId => {
        void deliver(agentId).catch(err => {
          // densable: if (s instanceof B6) return — covers CAS + stoppedByUser
          if (err instanceof ResumeAgentStateError) {
            logForDebugging(
              `[stranded-resume] skip B6 for ${agentId}: ${errorMessage(err)}`,
            )
            return
          }
          logForDebugging(
            `[stranded-resume] unhandled: ${errorMessage(err as Error)}`,
          )
          addNotification({
            key: `stranded-resume-failed-${agentId}`,
            text: `Failed to deliver queued message to agent: ${errorMessage(err as Error)}`,
            color: 'error',
            priority: 'low',
          })
        })
      }),
    [deliver, addNotification],
  )
}
