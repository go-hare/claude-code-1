// Background task entry for local workflow execution.
// Makes workflow scripts visible in the footer pill and Shift+Down
// dialog. Follows the DreamTask pattern: lifecycle + UI surfacing via
// the existing task registry.

import { getIsNonInteractiveSession } from '../../bootstrap/state.js'
import type { AppState } from '../../state/AppState.js'
import type { SetAppState, Task, TaskStateBase } from '../../Task.js'
import { createTaskStateBase, generateTaskId } from '../../Task.js'
import type { AgentId } from '../../types/ids.js'
import type { SdkWorkflowProgress } from '../../types/workflowProgress.js'
import { logForDebugging } from '../../utils/debug.js'
import {
  addKeepaliveReason,
  registerTask,
  removeKeepaliveReason,
  updateTaskState,
  workflowKeepaliveReason,
} from '../../utils/task/framework.js'

/** densable NqK=500 — keep at most this many workflow_log entries after trim. */
export const WORKFLOW_PROGRESS_LOG_CAP = 500

export type LocalWorkflowTaskState = TaskStateBase & {
  type: 'local_workflow'
  /** meta.name from the workflow script (e.g. 'spec'). */
  workflowName: string
  /** Absolute path to the workflow file on disk. */
  workflowFile: string
  /** Human-readable one-line summary for the task list. */
  summary?: string
  /**
   * densable sm8/tm8: cumulative progress deltas for Desktop / panel fold.
   * Upsert key for agent/phase is `${type}:${index}`; logs append.
   */
  workflowProgress: SdkWorkflowProgress[]
  /** densable progressVersion — bumps by delta batch length on each apply. */
  progressVersion: number
  /** Highest workflow_agent index seen in start state (densable agentCount). */
  agentCount: number
  /** Sum of workflow_agent.tokens across current progress list. */
  totalTokens: number
  /** Sum of workflow_agent.toolCalls across current progress list. */
  totalToolCalls: number
  /**
   * densable meta.phases titles from run_started — host fold shows not-started
   * skeleton phases before agents emit (B03 declaredPhases).
   */
  declaredPhases?: string[]
  /** Captured output from workflow execution. */
  output?: string
  /** Failure reason surfaced to BackgroundTasksDialog (parallels RunProgress.error). */
  error?: string
  /** Engine run id (may equal task id when not resumed). densable workflowRunId. */
  workflowRunId?: string
  /** Agent that spawned this task. Used for orphan cleanup. */
  agentId?: AgentId
  /** Abort controller for cancellation. */
  abortController?: AbortController
  /**
   * Pending action for a sub-agent within this workflow.
   * The workflow execution loop polls this field and acts on it.
   * `agentId` is the engine numeric agent() index as string for UI keys.
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
    workflowRunId?: string
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
    // densable sm8 defaults
    workflowProgress: [],
    progressVersion: 0,
    agentCount: 0,
    totalTokens: 0,
    totalToolCalls: 0,
    declaredPhases: undefined,
    workflowRunId: opts.workflowRunId,
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

/**
 * densable B03 — store meta.phases titles for host fold skeleton rows.
 * Called from taskProgressBridge on run_started.
 */
export function setWorkflowDeclaredPhases(
  taskId: string,
  phases: string[],
  setAppState: SetAppState,
): void {
  updateTaskState<LocalWorkflowTaskState>(taskId, setAppState, task => {
    if (task.type !== 'local_workflow') return task
    if (task.status !== 'running' && task.status !== 'paused') return task
    return {
      ...task,
      declaredPhases: phases.length > 0 ? phases : undefined,
    }
  })
}

/**
 * densable tm8 — merge a batch of progress deltas into task.workflowProgress.
 *
 * - workflow_agent / workflow_phase: upsert by `${type}:${index}`
 * - workflow_log (and other append-only): push; when length > 2*cap, drop oldest logs
 * - recomputes agentCount / totalTokens / totalToolCalls
 * - no-ops when task is not running
 *
 * Returns the updated progress snapshot when applied, else null.
 */
export function applyWorkflowProgressDeltas(
  taskId: string,
  deltas: SdkWorkflowProgress[],
  setAppState: SetAppState,
  logCap: number = WORKFLOW_PROGRESS_LOG_CAP,
): {
  workflowProgress: SdkWorkflowProgress[]
  progressVersion: number
  agentCount: number
  totalTokens: number
  totalToolCalls: number
} | null {
  if (deltas.length === 0) return null
  let applied: {
    workflowProgress: SdkWorkflowProgress[]
    progressVersion: number
    agentCount: number
    totalTokens: number
    totalToolCalls: number
  } | null = null

  updateTaskState<LocalWorkflowTaskState>(taskId, setAppState, task => {
    if (task.status !== 'running') return task
    if (task.type !== 'local_workflow') return task

    const next = [...(task.workflowProgress ?? [])]
    const indexMap = new Map<string, number>()
    for (let i = 0; i < next.length; i++) {
      const item = next[i]!
      if (item.type === 'workflow_agent' || item.type === 'workflow_phase') {
        indexMap.set(`${item.type}:${item.index}`, i)
      }
    }

    let agentCount = task.agentCount ?? 0
    let sawAppendOnly = false
    for (const delta of deltas) {
      if (delta.type === 'workflow_agent' || delta.type === 'workflow_phase') {
        const key = `${delta.type}:${delta.index}`
        const existing = indexMap.get(key)
        if (existing !== undefined) {
          next[existing] = delta
        } else {
          indexMap.set(key, next.length)
          next.push(delta)
        }
        if (delta.type === 'workflow_agent' && delta.state === 'start') {
          agentCount = Math.max(agentCount, delta.index)
        }
      } else {
        next.push(delta)
        sawAppendOnly = true
      }
    }

    let trimmed = next
    if (sawAppendOnly && next.length > logCap * 2) {
      let toDrop = next.length - logCap
      const kept: SdkWorkflowProgress[] = []
      for (const item of next) {
        if (toDrop > 0 && item.type === 'workflow_log') {
          toDrop--
          continue
        }
        kept.push(item)
      }
      trimmed = kept
    }

    let totalTokens = 0
    let totalToolCalls = 0
    for (const item of trimmed) {
      if (item.type === 'workflow_agent') {
        if (item.tokens) totalTokens += item.tokens
        if (item.toolCalls) totalToolCalls += item.toolCalls
      }
    }

    const progressVersion = (task.progressVersion ?? 0) + deltas.length
    applied = {
      workflowProgress: trimmed,
      progressVersion,
      agentCount,
      totalTokens,
      totalToolCalls,
    }
    return {
      ...task,
      ...applied,
    }
  })

  return applied
}

/**
 * Consume and clear pendingAgentAction (skip/retry) for engine pendingAction().
 * Returns the kind when present and task is running; otherwise null.
 */
export function consumePendingAgentAction(
  taskId: string,
  setAppState: SetAppState,
): { kind: 'skip' | 'retry'; agentId: AgentId } | null {
  let consumed: { kind: 'skip' | 'retry'; agentId: AgentId } | null = null
  updateTaskState<LocalWorkflowTaskState>(taskId, setAppState, task => {
    if (task.status !== 'running') return task
    const pending = task.pendingAgentAction
    if (!pending) return task
    consumed = {
      kind: pending.kind,
      agentId: pending.agentId,
    }
    return {
      ...task,
      pendingAgentAction: undefined,
    }
  })
  return consumed
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
