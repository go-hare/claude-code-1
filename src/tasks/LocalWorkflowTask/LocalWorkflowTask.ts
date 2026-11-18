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
import { logEvent } from '../../services/analytics/index.js'
import { logForDebugging } from '../../utils/debug.js'
import { emitTaskTerminatedSdk } from '../../utils/sdkEventQueue.js'
import { evictTaskOutput } from '../../utils/task/diskOutput.js'
import {
  addKeepaliveReason,
  registerTask,
  removeKeepaliveReason,
  updateTaskState,
  workflowKeepaliveReason,
} from '../../utils/task/framework.js'
import {
  createTaskRegistry,
  type TaskRegistry,
} from '../../utils/taskRegistry.js'

/** densable NqK=500 — keep at most this many workflow_log entries after trim. */
export const WORKFLOW_PROGRESS_LOG_CAP = 500
/** densable gx=30000 — panel grace window before terminal workflow eviction. */
export const WORKFLOW_PANEL_GRACE_MS = 30_000

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
  /** densable `evictAfter` (`u+gx` @195578800) — terminal panel grace deadline. */
  evictAfter?: number
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
    getAppState?: () => AppState
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
  // densable: if (u && !Ce()) YP(u, `workflow:${t}`, taskRegistry)
  // Ce = non-interactive. getAppState stays optional for non-owner register;
  // Gge requires Xm (no silent skip when owner keepalive should attach).
  if (opts.agentId && !getIsNonInteractiveSession()) {
    const getAppState = opts.getAppState
    if (!getAppState) {
      throw new TypeError(
        'getAppState is required to attach workflow keepalive',
      )
    }
    addKeepaliveReason(
      opts.agentId,
      workflowKeepaliveReason(id),
      createTaskRegistry(getAppState, setAppState),
    )
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
  registry: TaskRegistry,
): void {
  if (!agentId) return
  removeKeepaliveReason(agentId, workflowKeepaliveReason(taskId), registry)
}

function registryFromAppState(
  setAppState: SetAppState,
  getAppState?: () => AppState,
): TaskRegistry {
  const readState: () => AppState =
    getAppState ??
    (() => {
      let snapshot = { tasks: {} } as unknown as AppState
      setAppState(prev => {
        snapshot = prev
        return prev
      })
      return snapshot
    })
  return createTaskRegistry(readState, setAppState)
}

export function completeWorkflowTask(
  taskId: string,
  setAppState: SetAppState,
  getAppState?: () => AppState,
): void {
  let agentId: AgentId | undefined
  updateTaskState<LocalWorkflowTaskState>(taskId, setAppState, task => {
    agentId = task.agentId
    const now = Date.now()
    return {
      ...task,
      status: 'completed',
      endTime: now,
      evictAfter: now + WORKFLOW_PANEL_GRACE_MS,
      notified: true,
      abortController: undefined,
    }
  })
  // densable hx(owner, `workflow:${id}`, Xm).
  if (agentId) {
    detachWorkflowKeepalive(
      taskId,
      agentId,
      registryFromAppState(setAppState, getAppState),
    )
  }
}

export function failWorkflowTask(
  taskId: string,
  setAppState: SetAppState,
  error?: string,
  getAppState?: () => AppState,
): void {
  let agentId: AgentId | undefined
  updateTaskState<LocalWorkflowTaskState>(taskId, setAppState, task => {
    agentId = task.agentId
    const now = Date.now()
    return {
      ...task,
      status: 'failed',
      endTime: now,
      evictAfter: now + WORKFLOW_PANEL_GRACE_MS,
      notified: true,
      abortController: undefined,
      ...(error !== undefined ? { error } : {}),
    }
  })
  if (agentId) {
    detachWorkflowKeepalive(
      taskId,
      agentId,
      registryFromAppState(setAppState, getAppState),
    )
  }
  void evictTaskOutput(taskId)
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
  registry: TaskRegistry,
): boolean {
  let paused = false
  let agentId: AgentId | undefined
  registry.update<LocalWorkflowTaskState>(taskId, task => {
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
    detachWorkflowKeepalive(taskId, agentId, registry)
  }
  return paused
}

/**
 * Kill a running or paused workflow task. Called from BackgroundTasksDialog
 * via the feature-gated `killWorkflowTask` binding.
 * densable bye: tB(owner, workflow:id) after terminal.
 */
export function killWorkflowTask(taskId: string, registry: TaskRegistry): void {
  let agentId: AgentId | undefined
  let toolUseId: string | undefined
  let description: string | undefined
  let detached = false
  registry.update<LocalWorkflowTaskState>(taskId, task => {
    if (task.status !== 'running' && task.status !== 'paused') return task
    agentId = task.agentId
    toolUseId = task.toolUseId
    description = task.description
    detached = true
    task.abortController?.abort()
    const now = Date.now()
    return {
      ...task,
      status: 'killed',
      endTime: now,
      evictAfter: now + WORKFLOW_PANEL_GRACE_MS,
      notified: true,
      abortController: undefined,
    }
  })
  if (detached) {
    detachWorkflowKeepalive(taskId, agentId, registry)
    void evictTaskOutput(taskId)
    emitTaskTerminatedSdk(taskId, 'stopped', {
      toolUseId,
      summary: description,
    })
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
      killWorkflowTask(taskId, createTaskRegistry(getAppState, setAppState))
    }
  }
}

export const CARRIED_WORKFLOW_DONT_ASK_NOTE =
  " This session's permission mode cannot ask for approval, so the run will not continue in this session unless that call is already allowed."

export type CarriedWorkflowHandoff = {
  taskId: string
  workflowRunId?: string
  withholdScriptFromSdkEvents?: boolean
}

/**
 * Official `qqe` (2.1.300 #815):
 * Background sessions resume a carried workflow through the Workflow tool's
 * approval instead of running it from the handoff file.
 */
export function adoptCarriedWorkflowNeedsConsent(
  handoff: CarriedWorkflowHandoff,
  ctx: {
    taskRegistry: TaskRegistry
    permissionMode?: string
    onScriptSha256Reset?: (workflowRunId: string) => void
    onNeedsConsent: (
      handoff: CarriedWorkflowHandoff,
      reason: string,
      dontAskNote: string,
    ) => void
  },
): boolean {
  try {
    ctx.taskRegistry.remove(handoff.taskId)
    const alreadyRunning = Object.values(ctx.taskRegistry.all()).some(
      t =>
        isLocalWorkflowTask(t) &&
        t.status === 'running' &&
        handoff.workflowRunId !== undefined &&
        t.workflowRunId === handoff.workflowRunId,
    )
    if (alreadyRunning) return false
    const hiddenScript = handoff.withholdScriptFromSdkEvents === true
    const isDontAsk = !hiddenScript && ctx.permissionMode === 'dontAsk'
    if (hiddenScript && handoff.workflowRunId !== undefined) {
      ctx.onScriptSha256Reset?.(handoff.workflowRunId)
    }
    const reason = hiddenScript
      ? 'it hides its script, so what launched it starts it again'
      : 'a carried workflow runs again only through the Workflow tool'
    ctx.onNeedsConsent(
      handoff,
      reason,
      isDontAsk ? CARRIED_WORKFLOW_DONT_ASK_NOTE : '',
    )
    logEvent('tengu_task_local_workflow_adopt_resume_needs_consent', {})
    return true
  } catch (err) {
    logForDebugging(
      `adoptCarriedWorkflowNeedsConsent failed: ${err instanceof Error ? err.message : String(err)}`,
    )
    return false
  }
}

export const LocalWorkflowTask: Task = {
  name: 'LocalWorkflowTask',
  type: 'local_workflow',
  async kill(taskId, registry) {
    killWorkflowTask(taskId, registry)
  },
}
