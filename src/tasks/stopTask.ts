// Shared logic for stopping a running task.
// Used by TaskStopTool (LLM-invoked) and SDK stop_task control request.
//
// densable H1e portable (surgical fuse, not wip whole-package):
// - Elo: fuzzy/name/registry resolve when exact id miss
// - ownership: callerAgentId may only stop tasks it owns (tns: undefined=main ok)
// - observer: cannot stop self; OH path uses agentId ownership + Fjr
// - YC park (zle): running || parked allowed
// - source=user → jCe/hAe stoppedByUser stamp (mem + disk Gzg); TaskStop omits source
// - after kill, if target was YC: cascade descendants via Beo (parentAgentId chain)
// - bash: suppress exit-137 notify; cross-owner XFu notify true bash owner

import { getMainThreadAgentId } from '../bootstrap/state.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import type { AppState } from '../state/AppState.js'
import type { TaskStateBase } from '../Task.js'
import { getTaskByType } from '../tasks.js'
import { asAgentId } from '../types/ids.js'
import {
  isAgentKillLoopSettled,
  isTerminalAgentTaskStatus,
} from '../utils/agentStopBag.js'
import { enqueuePendingNotification } from '../utils/messageQueueManager.js'
import { stopObserverPairing } from '../utils/observerAgents.js'
import { emitTaskTerminatedSdk } from '../utils/sdkEventQueue.js'
import {
  formatTaskNotificationXml,
  isParkedKeepaliveAgent,
} from '../utils/task/framework.js'
import { createTaskRegistry } from '../utils/taskRegistry.js'
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
   * densable H1e source — only when explicitly "user" stamps jCe/hAe + Fjr.
   * densable pNe has NO default; TaskStop tool omits source (parent kill).
   * True user UI (BackgroundTasksDialog / SDK stop_task) must pass source:"user".
   */
  source?: 'user' | 'client' | 'system'
  /**
   * densable H1e killedBy (default "user"). TaskStop tool uses "parent".
   */
  killedBy?: 'user' | 'parent' | 'system'
}

type StopTaskResult = {
  taskId: string
  taskType: string
  command: string | undefined
  note?: string
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

const STOP_SUMMARY_MAX_CHARS = 1000
const STOP_SUMMARY_HEAD_CHARS = 500
const STOP_SUMMARY_TAIL_CHARS = 300

function sliceHeadSurrogateSafe(text: string, n: number): string {
  if (n <= 0) return ''
  if (text.length <= n) return text
  const head = text.slice(0, n)
  const last = head.charCodeAt(n - 1)
  return last >= 0xd800 && last <= 0xdbff ? head.slice(0, -1) : head
}

function sliceTailSurrogateSafe(text: string, n: number): string {
  if (n <= 0) return ''
  if (text.length <= n) return text
  const tail = text.slice(-n)
  const first = tail.charCodeAt(0)
  return first >= 0xdc00 && first <= 0xdfff ? tail.slice(1) : tail
}

/**
 * Official 2.1.331 `Wre` (@7207654): truncate long (>1000 char) stop summaries
 * to head (500) + tail (300) BEFORE XML escaping (`sn(Wre(...))`) so entity
 * escapes like `&amp;` are never sliced in half.
 */
export function truncateStopSummary(text: string): string {
  if (text.length <= STOP_SUMMARY_MAX_CHARS) return text
  const head = sliceHeadSurrogateSafe(text, STOP_SUMMARY_HEAD_CHARS)
  const tail = sliceTailSurrogateSafe(text, STOP_SUMMARY_TAIL_CHARS)
  const omitted = text.length - head.length - tail.length
  return `${head}…[${omitted} chars omitted]…${tail}`
}

/**
 * Official 2.1.331 `pdi` — notify bash owner when stopper ≠ owner.
 * Applies `Wre` truncation BEFORE `escapeXml`.
 */
function notifyBashOwnerOfCrossStop(opts: {
  taskId: string
  toolUseId?: string
  description: string
  ownerAgentId: string
  stopperAgentId: string | undefined
}): void {
  const summary = `Task "${opts.description}" was stopped by ${ownerLabel(opts.stopperAgentId)}`
  const value = formatTaskNotificationXml({
    taskId: escapeXml(opts.taskId),
    toolUseId: opts.toolUseId ? escapeXml(opts.toolUseId) : undefined,
    status: 'stopped',
    summary: escapeXml(truncateStopSummary(summary)),
  })
  enqueuePendingNotification({
    value,
    mode: 'task-notification',
    skipAttachments: true,
    priority: 'next',
    agentId: asAgentId(opts.ownerAgentId),
    taskId: opts.taskId,
  })
}

const MCP_TASK_STOPPED_NOTE =
  'No result will follow. The MCP server may already have done some of the work, or may still finish it.'

/**
 * Official 2.1.331 `VIn` — passive main-session notification when user or
 * connected client stops a background task (`tengu_rosy_donut`, default true).
 * Applies `Wre` truncation BEFORE `escapeXml`.
 */
function notifyUserStoppedMainShellTask(opts: {
  taskId: string
  toolUseId?: string
  description: string
  source?: 'user' | 'client' | 'system'
  outputFile?: string
  note?: string
}): void {
  const base =
    opts.source === 'client'
      ? `Task "${opts.description}" was stopped by the user or by the app connected to this session`
      : `Task "${opts.description}" was stopped by the user`
  const summary = opts.note === undefined ? base : `${base}. ${opts.note}`
  const value = formatTaskNotificationXml({
    taskId: escapeXml(opts.taskId),
    toolUseId: opts.toolUseId ? escapeXml(opts.toolUseId) : undefined,
    outputFile: opts.outputFile ? escapeXml(opts.outputFile) : undefined,
    status: 'killed',
    summary: escapeXml(truncateStopSummary(summary)),
  })
  enqueuePendingNotification({
    value,
    mode: 'task-notification',
    skipAttachments: true,
    priority: 'next',
    passive: true,
    agentId: getMainThreadAgentId(),
    taskId: opts.taskId,
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
 * Official 2.1.331 `ho(task, taskId)` (@325138700) — true when a terminal
 * `local_agent` or `local_workflow` still has an unsettled kill-loop.
 */
export function isUnsettledTerminalKillLoop(
  task: TaskStateBase,
  taskId: string,
): boolean {
  return (
    isTerminalAgentTaskStatus(task.status) &&
    (task.type === 'local_agent' || task.type === 'local_workflow') &&
    !isAgentKillLoopSettled(taskId)
  )
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
    // densable pNe: no default for source — only stamp when source==="user"
    source,
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
  // Official 2.1.331 `D9o` (`Mln(y, C.agentId)`): for `local_agent`, check the
  // agent's own `agentId` so an agent can stop itself (main/user/self allowed);
  // for other tasks (e.g. `local_bash`), check `task.agentId` (the owning agent).
  const taskAgentId = agentTask
    ? agentTask.agentId
    : typeof (task as unknown as { agentId?: string }).agentId === 'string'
      ? (task as unknown as { agentId: string }).agentId
      : undefined

  const isUserOrClientStop = source === 'user' || source === 'client'

  // densable OH path: observer self-stop forbidden; ownership via agentId; Fjr on user/client
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
    if (isUserOrClientStop) {
      fireObserverTombstone(
        resolvedId,
        typeof agentTask.agentType === 'string'
          ? agentTask.agentType
          : undefined,
      )
    }
    // Official 2.1.331: kill parked/terminal observer unless its terminal kill-loop is still unsettled.
    if (
      agentTask.status !== 'running' &&
      !(
        isTerminalAgentTaskStatus(agentTask.status) &&
        !isAgentKillLoopSettled(resolvedId)
      )
    ) {
      killAsyncAgent(
        resolvedId,
        createTaskRegistry(getAppState, setAppState),
        killedBy,
      )
      return {
        taskId: resolvedId,
        taskType: task.type,
        command: task.description,
      }
    }
  }

  // Official 2.1.331 `D9o` (@325133600): status running OR YC-parked OR
  // source-stopped non-running monitor_ws OR paused workflow OR unsettled kill-loop.
  const parked = agentTask ? isParkedKeepaliveAgent(agentTask) : false
  const stoppedMonitorWsByUser =
    task.status !== 'running' &&
    task.type === 'monitor_ws' &&
    isUserOrClientStop
  const pausedWorkflow =
    task.type === 'local_workflow' && task.status === 'paused'
  const unsettledKillLoop = isUnsettledTerminalKillLoop(task, resolvedId)
  if (
    task.status !== 'running' &&
    !parked &&
    !stoppedMonitorWsByUser &&
    !pausedWorkflow &&
    !unsettledKillLoop
  ) {
    throw new StopTaskError(
      `Task ${displayId} is not running (status: ${task.status})`,
      'not_running',
    )
  }

  // Official 2.1.331 `D9o`: non-observer ownership / self-stop check.
  if (!isObserver && !callerOwnsTask(callerAgentId, taskAgentId)) {
    const prefix = agentTask
      ? `The main session, the user or the agent itself can stop task ${displayId}`
      : `Task ${displayId} is owned by ${ownerLabel(taskAgentId)}`
    throw new StopTaskError(
      `${prefix}; agent ${callerAgentId} cannot stop it.`,
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

  // Official 2.1.331: stamp stoppedByUser for user/client stops (not system stops)
  if (isUserOrClientStop && agentTask) {
    markAgentStoppedByUser(resolvedId, setAppState)
  }

  // Official 2.1.331 `if (L)` (@325135100): task already ended, but its loop is
  // still unsettled — re-signal abort and report status without throwing not_running.
  if (unsettledKillLoop) {
    const abortCtrl = (task as { abortController?: AbortController })
      .abortController
    if (abortCtrl && !abortCtrl.signal.aborted) {
      abortCtrl.abort()
    }
    return {
      taskId: resolvedId,
      taskType: task.type,
      command: isLocalShellTask(task) ? task.command : task.description,
      note: `had already ended (${task.status}) but its loop had not exited; re-signalled it and killed 0 process group(s). The record remains listed while the loop is still live.`,
    }
  }

  // Capture YC-before-kill for cascade gate (densable p=zle(l))
  const wasParked = parked

  await taskImpl.kill(
    resolvedId,
    createTaskRegistry(getAppState, setAppState),
    killedBy,
  )

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
      if (child.isObserver !== true) {
        emitTaskTerminatedSdk(child.id, 'stopped', {
          toolUseId: child.toolUseId,
          summary: child.description,
        })
      }
      if (isUserOrClientStop) {
        markAgentStoppedByUser(child.id, setAppState)
      }
      killAsyncAgent(
        child.id,
        createTaskRegistry(getAppState, setAppState),
        killedBy,
      )
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

    // densable Xvo / Jvo @195001530:
    // Cross-owner bash stop → notify true owner; main-thread user stop → passive Jvo.
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
    if (
      bashOwner === undefined &&
      isUserOrClientStop &&
      getFeatureValue_CACHED_MAY_BE_STALE('tengu_rosy_donut', true)
    ) {
      notifyUserStoppedMainShellTask({
        taskId: resolvedId,
        toolUseId: task.toolUseId,
        description: task.description,
        source,
        outputFile: task.outputFile,
      })
    }
  }

  const command = isLocalShellTask(task) ? task.command : task.description

  if (
    task.type === 'mcp_task' &&
    getAppState().tasks?.[resolvedId]?.status === 'killed'
  ) {
    if (
      isUserOrClientStop &&
      getFeatureValue_CACHED_MAY_BE_STALE('tengu_rosy_donut', true)
    ) {
      notifyUserStoppedMainShellTask({
        taskId: resolvedId,
        toolUseId: task.toolUseId,
        description: task.description,
        source,
        note: MCP_TASK_STOPPED_NOTE,
      })
    }
    return {
      taskId: resolvedId,
      taskType: task.type,
      command,
      note: `(${task.description}) is stopped. Cancellations are fire and forget, so there is no confirmation from the MCP server, and it may already have done some of the work. Only check on it if the user asks.`,
    }
  }

  return { taskId: resolvedId, taskType: task.type, command }
}
