// Shared logic for stopping a running task.
// Used by TaskStopTool (LLM-invoked) and SDK stop_task control request.
//
// densable H1e portable (surgical fuse, not wip whole-package):
// - Elo: fuzzy/name/registry resolve when exact id miss
// - ownership: callerAgentId may only stop tasks it owns (tns: undefined=main ok)
// - observer: cannot stop self; OH path uses agentId ownership + Fjr
// - YC park (zle): running || parked allowed
// - source=user → hAe stoppedByUser stamp (mem + disk Gzg)
// - after kill, if target was YC: cascade descendants via Beo (parentAgentId chain)
// - bash: suppress exit-137 notify; cross-owner XFu notify true bash owner

import type { AppState } from '../state/AppState.js'
import type { TaskStateBase } from '../Task.js'
import { getTaskByType } from '../tasks.js'
import {
  STATUS_TAG,
  SUMMARY_TAG,
  TASK_ID_TAG,
  TASK_NOTIFICATION_TAG,
  TOOL_USE_ID_TAG,
} from '../constants/xml.js'
import { asAgentId } from '../types/ids.js'
import { enqueuePendingNotification } from '../utils/messageQueueManager.js'
import { stopObserverPairing } from '../utils/observerAgents.js'
import { emitTaskTerminatedSdk } from '../utils/sdkEventQueue.js'
import { isParkedKeepaliveAgent } from '../utils/task/framework.js'
import { escapeXml } from '../utils/xml.js'
import {
  isDescendantAgentOf,
  isLocalAgentTask,
  isObserverAgentTask,
  killAsyncAgent,
  markAgentStoppedByUser,
  markAgentsNotified,
  type LocalAgentTaskState,
} from './LocalAgentTask/LocalAgentTask.js'
import { isLocalShellTask } from './LocalShellTask/guards.js'
import {
  formatTaskNotFoundMessage,
  resolveTaskForStop,
} from './resolveTaskForStop.js'

export class StopTaskError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'not_found'
      | 'not_running'
      | 'unsupported_type'
      | 'not_owner',
  ) {
    super(message)
    this.name = 'StopTaskError'
  }
}

type StopTaskContext = {
  getAppState: () => AppState
  setAppState: (f: (prev: AppState) => AppState) => void
  /**
   * densable H1e callerAgentId — the agent invoking TaskStop.
   * undefined = main session (always allowed).
   */
  callerAgentId?: string
  /**
   * densable H1e source — user UI/tool vs system. User stamps hAe + Fjr.
   */
  source?: 'user' | 'system'
  /**
   * densable H1e killedBy (default "user").
   */
  killedBy?: 'user' | 'parent' | 'system'
}

type StopTaskResult = {
  taskId: string
  taskType: string
  command: string | undefined
}

/** densable tns(caller, owner): undefined caller always owns. */
function callerOwnsTask(
  callerAgentId: string | undefined,
  ownerAgentId: string | undefined,
): boolean {
  if (callerAgentId === undefined) return true
  return callerAgentId === ownerAgentId
}

/** densable dWr */
function ownerLabel(ownerAgentId: string | undefined): string {
  return ownerAgentId ?? 'main session'
}

/**
 * densable XFu — notify bash owner when stopper ≠ owner.
 * Uses task-notification priority next to owner's agent queue.
 */
function notifyBashOwnerOfCrossStop(opts: {
  taskId: string
  toolUseId?: string
  description: string
  ownerAgentId: string
  stopperAgentId: string | undefined
}): void {
  const summary = `Task "${opts.description}" was stopped by ${ownerLabel(opts.stopperAgentId)}`
  const toolUseXml = opts.toolUseId
    ? `\n<${TOOL_USE_ID_TAG}>${escapeXml(opts.toolUseId)}</${TOOL_USE_ID_TAG}>`
    : ''
  const value = `<${TASK_NOTIFICATION_TAG}>
<${TASK_ID_TAG}>${escapeXml(opts.taskId)}</${TASK_ID_TAG}>${toolUseXml}
<${STATUS_TAG}>stopped</${STATUS_TAG}>
<${SUMMARY_TAG}>${escapeXml(summary)}</${SUMMARY_TAG}>
</${TASK_NOTIFICATION_TAG}>`
  enqueuePendingNotification({
    value,
    mode: 'task-notification',
    priority: 'next',
    agentId: asAgentId(opts.ownerAgentId),
  })
}

/**
 * densable Fjr — stop observer pairing + write observerStopped tombstone.
 * Fire-and-forget; pairing may already be gone.
 */
function fireObserverTombstone(
  taskId: string,
  agentType: string | undefined,
): void {
  void stopObserverPairing(taskId, {
    ...(agentType !== undefined ? { agentType } : {}),
  }).catch(() => {})
}

/**
 * Look up a task by ID (Elo fuzzy on miss), validate ownership + running/parked,
 * kill it, cascade descendants when the target was YC-parked (densable H1e).
 *
 * Throws {@link StopTaskError} when the task cannot be stopped.
 */
export async function stopTask(
  taskId: string,
  context: StopTaskContext,
): Promise<StopTaskResult> {
  const {
    getAppState,
    setAppState,
    callerAgentId,
    source = 'user',
    killedBy = 'user',
  } = context
  const appState = getAppState()
  let resolvedId = taskId
  let task = appState.tasks?.[taskId] as TaskStateBase | undefined
  let suggestion: string | undefined

  // densable Elo: exact miss → name/registry/fuzzy
  if (!task) {
    const resolved = resolveTaskForStop(taskId, getAppState)
    if (resolved.status === 'ambiguous') {
      throw new StopTaskError(resolved.message, 'not_found')
    }
    if (resolved.status === 'found') {
      task = resolved.task
      resolvedId = resolved.taskId
    } else {
      suggestion = resolved.suggestion
    }
  }

  if (!task) {
    throw new StopTaskError(
      formatTaskNotFoundMessage(taskId, getAppState, suggestion, callerAgentId),
      'not_found',
    )
  }

  const displayId =
    resolvedId === taskId ? resolvedId : `${taskId} (${resolvedId})`
  const isObserver = isObserverAgentTask(task)
  const agentTask = isLocalAgentTask(task)
    ? (task as LocalAgentTaskState)
    : null
  // densable tns(caller, task.agentId): bash/workflow/monitor stamp agentId as owner;
  // local_agent prefers ownerAgentId (panel holder) then agentId.
  // densable H1e non-OH path uses l.agentId (bash owner); local_agent uses agentId too
  // for ownership of the agent process itself.
  const ownerId = agentTask
    ? (agentTask.ownerAgentId ?? agentTask.agentId)
    : typeof (task as unknown as { agentId?: string }).agentId === 'string'
      ? (task as unknown as { agentId: string }).agentId
      : undefined

  // densable OH path: observer self-stop forbidden; ownership via agentId; Fjr on user
  if (isObserver && agentTask) {
    if (callerAgentId !== undefined && callerAgentId === agentTask.agentId) {
      throw new StopTaskError(
        `Observer ${displayId} cannot stop itself; use the task UI or a main-session TaskStop.`,
        'not_owner',
      )
    }
    if (!callerOwnsTask(callerAgentId, agentTask.agentId)) {
      throw new StopTaskError(
        `Task ${displayId} is owned by ${ownerLabel(agentTask.agentId)}; agent ${callerAgentId} cannot stop it.`,
        'not_owner',
      )
    }
    if (source === 'user') {
      fireObserverTombstone(
        resolvedId,
        typeof agentTask.agentType === 'string'
          ? agentTask.agentType
          : undefined,
      )
    }
    // densable: if status!==running return XV (kill parked/terminal observer)
    if (agentTask.status !== 'running') {
      killAsyncAgent(resolvedId, setAppState, killedBy)
      return {
        taskId: resolvedId,
        taskType: task.type,
        command: task.description,
      }
    }
  }

  // densable: status running OR zle(YC park)
  const parked = agentTask ? isParkedKeepaliveAgent(agentTask) : false
  if (task.status !== 'running' && !parked) {
    throw new StopTaskError(
      `Task ${displayId} is not running (status: ${task.status})`,
      'not_running',
    )
  }

  // densable: non-observer ownership check (agentId for observer already handled)
  if (!isObserver && !callerOwnsTask(callerAgentId, ownerId)) {
    throw new StopTaskError(
      `Task ${displayId} is owned by ${ownerLabel(ownerId)}; agent ${callerAgentId} cannot stop it.`,
      'not_owner',
    )
  }

  const taskImpl = getTaskByType(task.type)
  if (!taskImpl) {
    throw new StopTaskError(
      `Unsupported task type: ${task.type}`,
      'unsupported_type',
    )
  }

  // densable: if (source==="user") hAe
  if (source === 'user' && agentTask) {
    markAgentStoppedByUser(resolvedId, setAppState)
  }

  // Capture YC-before-kill for cascade gate (densable p=zle(l))
  const wasParked = parked

  await taskImpl.kill(resolvedId, setAppState, killedBy)

  // densable H1e cascade: only when target was YC parked before kill
  if (wasParked && agentTask) {
    const ancestorId = agentTask.agentId ?? resolvedId
    const tasksAfter = getAppState().tasks ?? {}
    for (const child of Object.values(tasksAfter)) {
      if (!isLocalAgentTask(child) || child.id === resolvedId) continue
      const live = child.status === 'running' || isParkedKeepaliveAgent(child)
      if (!live) continue
      if (!isDescendantAgentOf(child, ancestorId, tasksAfter)) continue
      // densable H1e cascade does not call Fjr (gtf does); keep H1e lean:
      // Kle notify suppress + hAe + kill
      markAgentsNotified(child.id, setAppState)
      if (source === 'user') {
        markAgentStoppedByUser(child.id, setAppState)
      }
      killAsyncAgent(child.id, setAppState, killedBy)
    }
  }

  // Bash: suppress the "exit code 137" notification (noise). Agent tasks: don't
  // suppress — the AbortError catch sends a notification carrying
  // extractPartialResult(agentMessages), which is the payload not noise.
  if (isLocalShellTask(task)) {
    let suppressed = false
    setAppState(prev => {
      const prevTask = prev.tasks[resolvedId]
      if (!prevTask || prevTask.notified) {
        return prev
      }
      suppressed = true
      return {
        ...prev,
        tasks: {
          ...prev.tasks,
          [resolvedId]: { ...prevTask, notified: true },
        },
      }
    })
    // Suppressing the XML notification also suppresses print.ts's parsed
    // task_notification SDK event — emit it directly so SDK consumers see
    // the task close.
    if (suppressed) {
      emitTaskTerminatedSdk(resolvedId, 'stopped', {
        toolUseId: task.toolUseId,
        summary: task.description,
      })
    }

    // densable XFu: Jk(l)&&l.agentId!==void 0&&i!==l.agentId
    // Cross-owner bash stop → notify true owner (agentId on shell task).
    const bashOwner = (task as { agentId?: string }).agentId
    if (bashOwner !== undefined && callerAgentId !== bashOwner) {
      notifyBashOwnerOfCrossStop({
        taskId: resolvedId,
        toolUseId: task.toolUseId,
        description: task.description,
        ownerAgentId: bashOwner,
        stopperAgentId: callerAgentId,
      })
    }
  }

  const command = isLocalShellTask(task) ? task.command : task.description

  return { taskId: resolvedId, taskType: task.type, command }
}
