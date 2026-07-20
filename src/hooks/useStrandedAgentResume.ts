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
  AgentStoppedByUserError,
  resumeAgentBackground,
} from '@claude-code/builtin-tools/tools/AgentTool/resumeAgent.js'

/**
 * densable luf / Weo.subscribe:
 * On agent complete with non-empty pendingMessages, drain queue and
 * resumeAgentBackground (Aye) with the first message; re-queue the rest.
 * Failures re-queue the head and surface a low-priority warning (except
 * AgentStoppedByUserError which is expected for user-killed agents).
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
      for (const msg of rest) {
        queuePendingMessage(agentId, msg, setAppState)
      }
      try {
        await resumeAgentBackground({
          agentId,
          prompt: head,
          toolUseContext: getToolUseContext(),
          canUseTool,
        })
      } catch (err) {
        // densable: re-queue head on failure so message is not lost
        queuePendingMessage(agentId, head, setAppState)
        if (err instanceof AgentStoppedByUserError) {
          logForDebugging(
            `[stranded-resume] skip user-stopped agent ${agentId}: ${errorMessage(err)}`,
          )
          return
        }
        logForDebugging(
          `[stranded-resume] failed for ${agentId}: ${errorMessage(err)}`,
        )
        addNotification({
          key: `stranded-resume-failed-${agentId}`,
          text: `Failed to deliver queued message to agent: ${errorMessage(err)}`,
          color: 'error',
          priority: 'low',
        })
      }
    },
    [getAppState, setAppState, getToolUseContext, canUseTool, addNotification],
  )

  useEffect(
    () =>
      strandedAgentResume.subscribe(agentId => {
        void deliver(agentId).catch(err => {
          // densable: B6/ResumeAgentStateError swallowed; others notify
          if (err instanceof AgentStoppedByUserError) return
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
