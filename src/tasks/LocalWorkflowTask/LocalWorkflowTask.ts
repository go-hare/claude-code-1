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
  isParkedKeepaliveAgent,
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
  /**
   * Official ownerAgentId — parent local_agent for Gge/tB keepalive
   * (`workflow:${taskId}`). Prefer this over agentId for detach.
   */
  ownerAgentId?: string
  /** Official workflowRunId (ess / hDs adopt + resumeFromRunId). */
  workflowRunId?: string
  /** Official scriptPath (may equal workflowFile). */
  scriptPath?: string
  /** Official empty script body on ess stub. */
  script?: string
  /** Official empty prompt on ess stub. */
  prompt?: string
  /** Abort controller for cancellation. */
  abortController?: AbortController
  /**
   * Pending action for a sub-agent within this workflow.
   * The workflow execution loop polls this field and acts on it.
   * Official j6u aborts agentControllers Map; portable polls this field.
   */
  pendingAgentAction?: {
    kind: 'skip' | 'retry'
    agentId: AgentId
    requestedAt: number
  }
}

export { workflowKeepaliveReason }

function resolveWorkflowOwner(
  task: LocalWorkflowTaskState,
): string | undefined {
  return task.ownerAgentId ?? task.agentId
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
    /** Official ownerAgentId for Gge keepalive (defaults to agentId). */
    ownerAgentId?: string
    workflowRunId?: string
    scriptPath?: string
    abortController?: AbortController
  },
): string {
  const id = generateTaskId('local_workflow')
  const ownerAgentId = opts.ownerAgentId ?? opts.agentId
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
    ownerAgentId,
    workflowRunId: opts.workflowRunId,
    scriptPath: opts.scriptPath ?? opts.workflowFile,
    abortController: opts.abortController,
  }
  registerTask(task, setAppState)
  // Official: if (y && !pn()) Gge(y, `workflow:${t}`, registry)
  // pn() = !isInteractive → skip Gge in non-interactive/headless sessions.
  if (ownerAgentId && !getIsNonInteractiveSession()) {
    addKeepaliveReason(ownerAgentId, workflowKeepaliveReason(id), setAppState)
  }
  return id
}

/**
 * Official Hao owner-busy guard (mirrors BRt):
 *   w = Wl(owner) && ((YC(owner) && !pn()) || owner.status === 'running')
 *   if (!(firstNotify && w)) tB(owner, `workflow:${id}`)
 * First-notify + busy owner keeps the KA hold so Jeo can later drop it
 * only when the task-notification is drained / child is notified without queue.
 */
function maybeDetachWorkflowKeepalive(
  owner: string | undefined,
  taskId: string,
  firstNotify: boolean,
  setAppState: SetAppState,
): void {
  let ownerBusy = false
  setAppState(prev => {
    const o = owner ? prev.tasks?.[owner] : undefined
    if (o && o.type === 'local_agent') {
      const parked =
        isParkedKeepaliveAgent(o) && !getIsNonInteractiveSession()
      const running = o.status === 'running'
      ownerBusy = parked || running
    }
    return prev
  })
  if (!(firstNotify && ownerBusy)) {
    removeKeepaliveReason(owner, workflowKeepaliveReason(taskId), setAppState)
  }
}

export function completeWorkflowTask(
  taskId: string,
  setAppState: SetAppState,
): void {
  let owner: string | undefined
  // Official Hao `_` = first transition to notified (shouldEnqueue).
  let firstNotify = false
  updateTaskState<LocalWorkflowTaskState>(taskId, setAppState, task => {
    owner = resolveWorkflowOwner(task)
    if (task.notified) {
      // Already notified (e.g. suppress / double complete) — still update
      // terminal fields but firstNotify stays false → always tB below.
      return {
        ...task,
        status: 'completed',
        endTime: task.endTime ?? Date.now(),
        abortController: undefined,
        pendingAgentAction: undefined,
      }
    }
    firstNotify = true
    return {
      ...task,
      status: 'completed',
      endTime: Date.now(),
      notified: true,
      abortController: undefined,
      pendingAgentAction: undefined,
    }
  })
  // Official Hao: if (!(p && _)) tB(owner, workflow:id) — not always-detach.
  maybeDetachWorkflowKeepalive(owner, taskId, firstNotify, setAppState)
}

export function failWorkflowTask(
  taskId: string,
  setAppState: SetAppState,
  error?: string,
): void {
  let owner: string | undefined
  let firstNotify = false
  updateTaskState<LocalWorkflowTaskState>(taskId, setAppState, task => {
    owner = resolveWorkflowOwner(task)
    if (task.notified) {
      return {
        ...task,
        status: 'failed',
        endTime: task.endTime ?? Date.now(),
        abortController: undefined,
        pendingAgentAction: undefined,
        ...(error !== undefined ? { error } : {}),
      }
    }
    firstNotify = true
    return {
      ...task,
      status: 'failed',
      endTime: Date.now(),
      notified: true,
      abortController: undefined,
      pendingAgentAction: undefined,
      ...(error !== undefined ? { error } : {}),
    }
  })
  maybeDetachWorkflowKeepalive(owner, taskId, firstNotify, setAppState)
}

/**
 * Official zit / xao(..., "paused", {notified:!0}) portable.
 *
 * Only transitions from `running`. Aborts the controller, sets status
 * `paused` + `notified: true` + `endTime`, clears abortController.
 * Does NOT set evictAfter (official UE excludes paused from terminal eviction).
 * On success, official tB(ownerAgentId, `workflow:${id}`) detaches keepalive.
 *
 * Called from CAo.checkpointAgents after abort(J0("background")), and from
 * Workflow UI onPause. Returns true when the task was running and updated.
 */
export function pauseWorkflowTask(
  taskId: string,
  setAppState: SetAppState,
): boolean {
  let paused = false
  let owner: string | undefined
  updateTaskState<LocalWorkflowTaskState>(taskId, setAppState, task => {
    if (task.status !== 'running') return task
    paused = true
    owner = resolveWorkflowOwner(task)
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
  // Official zit: if (r) tB(r.ownerAgentId, `workflow:${e}`, t)
  if (paused) {
    removeKeepaliveReason(owner, workflowKeepaliveReason(taskId), setAppState)
  }
  return paused
}

/**
 * Kill a running or paused workflow task. Called from BackgroundTasksDialog
 * via the feature-gated `killWorkflowTask` binding.
 * Official bye: xao killed + tB(owner, workflow:id) + zS + lf stopped.
 */
export function killWorkflowTask(
  taskId: string,
  setAppState: SetAppState,
): void {
  let killed = false
  let owner: string | undefined
  updateTaskState<LocalWorkflowTaskState>(taskId, setAppState, task => {
    if (task.status !== 'running' && task.status !== 'paused') return task
    killed = true
    owner = resolveWorkflowOwner(task)
    try {
      task.abortController?.abort()
    } catch {
      /* ignore */
    }
    return {
      ...task,
      status: 'killed',
      endTime: Date.now(),
      notified: true,
      abortController: undefined,
      pendingAgentAction: undefined,
    }
  })
  if (killed) {
    removeKeepaliveReason(owner, workflowKeepaliveReason(taskId), setAppState)
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
