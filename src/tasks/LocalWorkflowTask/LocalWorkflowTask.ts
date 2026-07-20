// Background task entry for local workflow execution.
// Makes workflow scripts visible in the footer pill and Shift+Down
// dialog. Follows the DreamTask pattern: lifecycle + UI surfacing via
// the existing task registry.

import { getIsNonInteractiveSession } from '../../bootstrap/state.js'
import type { AppState } from '../../state/AppState.js'
import type { SetAppState, Task, TaskStateBase } from '../../Task.js'
import { createTaskStateBase, generateTaskId } from '../../Task.js'
import type { AgentId } from '../../types/ids.js'
import { logForDebugging } from '../../utils/debug.js'
import {
  addKeepaliveReason,
  registerTask,
  removeKeepaliveReason,
  updateTaskState,
  workflowKeepaliveReason,
} from '../../utils/task/framework.js'

export type LocalWorkflowTaskState = TaskStateBase & {
  type: 'local_workflow'
  /** meta.name from the workflow script (e.g. 'spec'). */
  workflowName: string
  /** Absolute path to the workflow file on disk. */
  workflowFile: string
  /** Human-readable one-line summary for the task list. */
  summary?: string
  /** Number of sub-agents spawned by this workflow. */
  agentCount?: number
  /** Captured output from workflow execution. */
  output?: string
  /** Failure reason surfaced to BackgroundTasksDialog (parallels RunProgress.error). */
  error?: string
  /** Agent that spawned this task. Used for orphan cleanup. */
  agentId?: AgentId
  /** Abort controller for cancellation. */
  abortController?: AbortController
  /**
   * Pending action for a sub-agent within this workflow.
   * The workflow execution loop polls this field and acts on it.
   */
  pendingAgentAction?: {
    kind: 'skip' | 'retry'
    agentId: AgentId
    requestedAt: number
  }
}

export function isLocalWorkflowTask(
  value: unknown,
): value is LocalWorkflowTaskState {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    (value as { type: string }).type === 'local_workflow'
  )
}

export function registerLocalWorkflowTask(
  setAppState: SetAppState,
  opts: {
    description: string
    workflowName: string
    workflowFile: string
    summary?: string
    toolUseId?: string
    agentId?: AgentId
    abortController?: AbortController
  },
): string {
  const id = generateTaskId('local_workflow')
  const task: LocalWorkflowTaskState = {
    ...createTaskStateBase(
      id,
      'local_workflow',
      opts.description,
      opts.toolUseId,
    ),
    type: 'local_workflow',
    status: 'running',
    workflowName: opts.workflowName,
    workflowFile: opts.workflowFile,
    summary: opts.summary,
    agentId: opts.agentId,
    abortController: opts.abortController,
  }
  registerTask(task, setAppState)
  // densable: if (y && !pn()) Gge(y, `workflow:${t}`, registry)
  // y = Yeo(parent) owner; local uses agentId field as the panel owner stamp.
  if (opts.agentId && !getIsNonInteractiveSession()) {
    addKeepaliveReason(opts.agentId, workflowKeepaliveReason(id), setAppState)
  }
  return id
}

function detachWorkflowKeepalive(
  taskId: string,
  agentId: AgentId | undefined,
  setAppState: SetAppState,
): void {
  if (!agentId) return
  removeKeepaliveReason(agentId, workflowKeepaliveReason(taskId), setAppState)
}

export function completeWorkflowTask(
  taskId: string,
  setAppState: SetAppState,
): void {
  let agentId: AgentId | undefined
  updateTaskState<LocalWorkflowTaskState>(taskId, setAppState, task => {
    agentId = task.agentId
    return {
      ...task,
      status: 'completed',
      endTime: Date.now(),
      notified: true,
      abortController: undefined,
    }
  })
  // densable complete path: tB(owner, workflow:id) when owner not still live/parked
  // Local always detaches — Jeo covers agent:/workflow: on parent complete.
  detachWorkflowKeepalive(taskId, agentId, setAppState)
}

export function failWorkflowTask(
  taskId: string,
  setAppState: SetAppState,
  error?: string,
): void {
  let agentId: AgentId | undefined
  updateTaskState<LocalWorkflowTaskState>(taskId, setAppState, task => {
    agentId = task.agentId
    return {
      ...task,
      status: 'failed',
      endTime: Date.now(),
      notified: true,
      abortController: undefined,
      ...(error !== undefined ? { error } : {}),
    }
  })
  detachWorkflowKeepalive(taskId, agentId, setAppState)
}

/**
 * Official zit / xao(..., "paused", {notified:!0}) portable subset.
 *
 * Only transitions from `running`. Aborts the controller, sets status
 * `paused` + `notified: true` + `endTime`, clears abortController.
 * Does NOT set evictAfter (official UE excludes paused from terminal eviction).
 *
 * Called from bgCheckpoint.checkpointAgents after abort-for-background.
 * Returns true when the task was running and updated.
 */
export function pauseWorkflowTask(
  taskId: string,
  setAppState: SetAppState,
): boolean {
  let paused = false
  let agentId: AgentId | undefined
  updateTaskState<LocalWorkflowTaskState>(taskId, setAppState, task => {
    if (task.status !== 'running') return task
    paused = true
    agentId = task.agentId
    try {
      task.abortController?.abort()
    } catch {
      /* ignore */
    }
    return {
      ...task,
      status: 'paused',
      endTime: Date.now(),
      notified: true,
      abortController: undefined,
      pendingAgentAction: undefined,
    }
  })
  // densable zit: if (r) tB(r.ownerAgentId, `workflow:${e}`)
  if (paused) {
    detachWorkflowKeepalive(taskId, agentId, setAppState)
  }
  return paused
}

/**
 * Kill a running or paused workflow task. Called from BackgroundTasksDialog
 * via the feature-gated `killWorkflowTask` binding.
 * densable bye: tB(owner, workflow:id) after terminal.
 */
export function killWorkflowTask(
  taskId: string,
  setAppState: SetAppState,
): void {
  let agentId: AgentId | undefined
  let detached = false
  updateTaskState<LocalWorkflowTaskState>(taskId, setAppState, task => {
    if (task.status !== 'running' && task.status !== 'paused') return task
    agentId = task.agentId
    detached = true
    task.abortController?.abort()
    return {
      ...task,
      status: 'killed',
      endTime: Date.now(),
      notified: true,
      abortController: undefined,
    }
  })
  if (detached) {
    detachWorkflowKeepalive(taskId, agentId, setAppState)
  }
}

/**
 * Skip the current agent step within a running workflow.
 * Called from BackgroundTasksDialog via the feature-gated
 * `skipWorkflowAgent` binding: skipWorkflowAgent(taskId, agentId, setAppState).
 */
export function skipWorkflowAgent(
  taskId: string,
  agentId: AgentId,
  setAppState: SetAppState,
): void {
  logForDebugging(
    `skipWorkflowAgent: skipping agent ${agentId} in workflow task ${taskId}`,
  )
  updateTaskState<LocalWorkflowTaskState>(taskId, setAppState, task => {
    if (task.status !== 'running') return task
    return {
      ...task,
      pendingAgentAction: {
        kind: 'skip',
        agentId,
        requestedAt: Date.now(),
      },
    }
  })
}

/**
 * Retry the current agent step within a running workflow.
 * Called from BackgroundTasksDialog via the feature-gated
 * `retryWorkflowAgent` binding: retryWorkflowAgent(taskId, agentId, setAppState).
 */
export function retryWorkflowAgent(
  taskId: string,
  agentId: AgentId,
  setAppState: SetAppState,
): void {
  logForDebugging(
    `retryWorkflowAgent: retrying agent ${agentId} in workflow task ${taskId}`,
  )
  updateTaskState<LocalWorkflowTaskState>(taskId, setAppState, task => {
    if (task.status !== 'running') return task
    return {
      ...task,
      pendingAgentAction: {
        kind: 'retry',
        agentId,
        requestedAt: Date.now(),
      },
    }
  })
}

/**
 * Kill all running workflow tasks spawned by a given agent.
 * Called from runAgent.ts finally block.
 */
export function killWorkflowTasksForAgent(
  agentId: AgentId,
  getAppState: () => AppState,
  setAppState: SetAppState,
): void {
  const tasks = getAppState().tasks ?? {}
  for (const [taskId, task] of Object.entries(tasks)) {
    if (
      isLocalWorkflowTask(task) &&
      task.agentId === agentId &&
      task.status === 'running'
    ) {
      logForDebugging(
        `killWorkflowTasksForAgent: killing orphaned workflow task ${taskId} (agent ${agentId} exiting)`,
      )
      killWorkflowTask(taskId, setAppState)
    }
  }
}

export const LocalWorkflowTask: Task = {
  name: 'LocalWorkflowTask',
  type: 'local_workflow',
  async kill(taskId: string, setAppState: SetAppState) {
    killWorkflowTask(taskId, setAppState)
  },
}
