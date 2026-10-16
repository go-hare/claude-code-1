import { enqueueSdkEvent } from '../sdkEventQueue.js'

/**
 * Emit a `task_progress` SDK event. Shared by background agents (per tool_use
 * in runAsyncAgentLifecycle) and workflows (per flushProgress batch). Accepts
 * already-computed primitives so callers can derive them from their own state
 * shapes (ProgressTracker for agents, LocalWorkflowTaskState for workflows).
 *
 * densable 2.1.289: outward wire has no workflow_progress on task_progress.
 */
export function emitTaskProgress(params: {
  taskId: string
  toolUseId: string | undefined
  description: string
  startTime: number
  totalTokens: number
  toolUses: number
  lastToolName?: string
  summary?: string
  subagentType?: string
  /** @deprecated densable 2.1.289 outward schema dropped workflow_progress. */
  workflowProgress?: unknown
}): void {
  enqueueSdkEvent({
    type: 'system',
    subtype: 'task_progress',
    task_id: params.taskId,
    tool_use_id: params.toolUseId,
    description: params.description,
    subagent_type: params.subagentType,
    usage: {
      total_tokens: params.totalTokens,
      tool_uses: params.toolUses,
      duration_ms: Date.now() - params.startTime,
    },
    last_tool_name: params.lastToolName,
    summary: params.summary,
  })
}
