// Shared logic for stopping a running task.
// Used by TaskStopTool (LLM-invoked) and SDK stop_task control request.
//
// Official densable ySr (local_agent slice):
// - running || YC(parked) → hAe(stoppedByUser) + XV + gtf(descendant cascade)
// - otherwise → dismiss panel (evict from registry)

import type { AppState } from '../state/AppState.js'
import type { SetAppState, TaskStateBase } from '../Task.js'
import { getTaskByType } from '../tasks.js'
import { emitTaskTerminatedSdk } from '../utils/sdkEventQueue.js'
import { isParkedKeepaliveAgent } from '../utils/task/framework.js'
import {
  isLocalAgentTask,
  killAsyncAgent,
  killDescendantAgents,
  markAgentStoppedByUser,
  markAgentsNotified,
  type LocalAgentTaskState,
} from './LocalAgentTask/LocalAgentTask.js'
import { isLocalShellTask } from './LocalShellTask/guards.js'
import {
  formatTaskNotFoundMessage,
  resolveTaskQuery,
} from './resolveTaskQuery.js'

/**
 * densable Kw — task is "background-eligible": status running|pending and
 * not explicitly foreground (`isBackgrounded === false`).
 */
function isBackgroundEligibleTask(task: TaskStateBase): boolean {
  if (task.status !== 'running' && task.status !== 'pending') return false
  if (
    'isBackgrounded' in task &&
    (task as { isBackgrounded?: boolean }).isBackgrounded === false
  ) {
    return false
  }
  return true
}

/**
 * densable LLe — jGr killable kind: non-observer local_agent, or local_workflow.
 */
function isJgrKillableKind(task: TaskStateBase): boolean {
  if (isLocalAgentTask(task)) {
    return task.isObserver !== true
  }
  return task.type === 'local_workflow'
}

function isObserverLocalAgent(task: TaskStateBase): boolean {
  return isLocalAgentTask(task) && task.isObserver === true
}

/**
 * densable jGr — bulk system kill on interrupt / rewind / query abort residual.
 *
 * Selects:
 *   (OH && status==="running") || (status==="running" && Kw && LLe)
 * For each:
 *   !OH → hAe (stoppedByUser)
 *   nas(type).kill(..., "system")
 *   local_agent && !OH → Kle + lf("stopped")
 *
 * Does NOT kill foreground agents (isBackgrounded===false) or YC-parked
 * (only running). User-facing ESC killAgents is kSu/UPa (separate path).
 */
export function bulkSystemKillTasks(
  tasks: Record<string, TaskStateBase>,
  setAppState: SetAppState,
): void {
  for (const task of Object.values(tasks)) {
    const isObserver = isObserverLocalAgent(task)
    const shouldKill =
      (isObserver && task.status === 'running') ||
      (task.status === 'running' &&
        isBackgroundEligibleTask(task) &&
        isJgrKillableKind(task))
    if (!shouldKill) continue

    // densable: if(!OH(n)) hAe(n.id,t)
    if (!isObserver) {
      if (isLocalAgentTask(task)) {
        markAgentStoppedByUser(task.id, setAppState)
      } else {
        // local_workflow: hAe only stamps stoppedByUser (no Gzg)
        setAppState(prev => {
          const cur = prev.tasks?.[task.id]
          if (!cur || (cur as { stoppedByUser?: boolean }).stoppedByUser) {
            return prev
          }
          return {
            ...prev,
            tasks: {
              ...prev.tasks,
              [task.id]: { ...cur, stoppedByUser: true },
            },
          }
        })
      }
    }

    // densable: nas(n.type)?.kill(n.id,t,r,"system") — fire-and-forget
    if (isLocalAgentTask(task)) {
      killAsyncAgent(task.id, setAppState, 'system')
    } else {
      const impl = getTaskByType(task.type)
      void impl?.kill(task.id, setAppState, 'system')
    }

    // densable: local_agent && !OH → Kle + lf stopped
    if (isLocalAgentTask(task) && !isObserver) {
      markAgentsNotified(task.id, setAppState)
      emitTaskTerminatedSdk(task.id, 'stopped', {
        toolUseId: task.toolUseId,
        summary: task.description,
      })
    }
  }
}

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
   * Official ySr `source` — "user" marks stoppedByUser on cascade descendants
   * even for observers. Defaults to "user" for TaskStopTool / SDK stop.
   */
  source?: string
  /**
   * Official densable H1e `callerAgentId` (Vqe from tool context).
   * `undefined` = main session (always allowed). When set, must match the
   * target's agentId unless cascading via gtf (not this gate).
   */
  callerAgentId?: string
  /**
   * Official densable H1e `killedBy` (default "user"). TaskStop passes
   * "parent" so XV stamps the task and BRt says "was stopped by Claude".
   * SDK / panel stop keep "user".
   */
  killedBy?: 'user' | 'parent' | 'system'
}

type StopTaskResult = {
  taskId: string
  taskType: string
  command: string | undefined
  /** Official ySr return: "killed" | "dismissed" (optional for callers). */
  outcome?: 'killed' | 'dismissed'
}

/**
 * Look up a task by ID, stop it (running or YC parked local_agent), and
 * cascade-kill descendants (official gtf).
 *
 * Throws {@link StopTaskError} when the task cannot be stopped (not found,
 * not stoppable, or unsupported type). Callers can inspect `error.code`.
 */
/**
 * Official densable tns — caller may stop target when caller is main
 * (undefined) or identity-equal to the target agentId.
 */
function callerOwnsAgent(
  callerAgentId: string | undefined,
  targetAgentId: string | undefined,
): boolean {
  if (callerAgentId === undefined) return true
  return callerAgentId === targetAgentId
}

function ownerLabel(agentId: string | undefined): string {
  return agentId ?? 'main session'
}

export async function stopTask(
  taskIdQuery: string,
  context: StopTaskContext,
): Promise<StopTaskResult> {
  const { getAppState, setAppState } = context
  const source = context.source ?? 'user'
  const callerAgentId = context.callerAgentId
  const killedBy = context.killedBy ?? 'user'
  const appState = getAppState()
  // densable H1e: a=query, l=r.get(a); if !l Elo → maybe rewrite a to resolved id
  let taskId = taskIdQuery
  let task = appState.tasks?.[taskId] as TaskStateBase | undefined

  if (!task) {
    // densable: if(!l){ m=Elo(...); ambiguous→not_found; found→l,a; else suggestion }
    const resolved = resolveTaskQuery(
      taskIdQuery,
      appState.tasks ?? {},
      getAppState,
    )
    if (resolved.status === 'ambiguous') {
      throw new StopTaskError(resolved.message, 'not_found')
    }
    if (resolved.status === 'found') {
      task = resolved.task
      taskId = resolved.task.id
    } else {
      throw new StopTaskError(
        formatTaskNotFoundMessage(
          taskIdQuery,
          appState.tasks ?? {},
          getAppState,
          resolved.suggestion,
          callerAgentId,
        ),
        'not_found',
      )
    }
  }

  // densable u: display query (resolvedId) when Elo rewrote the id
  const displayId =
    taskId === taskIdQuery ? taskId : `${taskIdQuery} (${taskId})`

  // Official ySr local_agent: allow running OR YC parked (completed+KA).
  // Non-agent types still require running (prior local contract).
  if (isLocalAgentTask(task)) {
    return stopLocalAgentTask(task, {
      getAppState,
      setAppState,
      source,
      callerAgentId,
      killedBy,
      displayId,
    })
  }

  if (task.status !== 'running') {
    throw new StopTaskError(
      `Task ${displayId} is not running (status: ${task.status})`,
      'not_running',
    )
  }

  // densable H1e non-OH ownership: !tns(caller, l.agentId) → not_owner
  // Shell owner is task.agentId (undefined = main). Do NOT fall back to taskId.
  // Teammates use identity.agentId (no top-level agentId) → undefined = main-owned.
  const shellAgentId =
    'agentId' in task && typeof (task as { agentId?: string }).agentId === 'string'
      ? (task as { agentId: string }).agentId
      : undefined
  if (!callerOwnsAgent(callerAgentId, shellAgentId)) {
    throw new StopTaskError(
      `Task ${displayId} is owned by ${ownerLabel(shellAgentId)}; agent ${callerAgentId} cannot stop it.`,
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

  // densable: await d.kill(a,r,n,s) — local Task.kill(taskId, set, killedBy).
  // Shells ignore killedBy (no field); local_agent stamps via killAsyncAgent.
  await taskImpl.kill(taskId, setAppState, killedBy)

  // Bash: suppress the "exit code 137" notification (noise). Agent tasks: don't
  // suppress — the AbortError catch sends a notification carrying
  // extractPartialResult(agentMessages), which is the payload not noise.
  if (isLocalShellTask(task)) {
    let suppressed = false
    setAppState(prev => {
      const prevTask = prev.tasks[taskId]
      if (!prevTask || prevTask.notified) {
        return prev
      }
      suppressed = true
      return {
        ...prev,
        tasks: {
          ...prev.tasks,
          [taskId]: { ...prevTask, notified: true },
        },
      }
    })
    // Suppressing the XML notification also suppresses print.ts's parsed
    // task_notification SDK event — emit it directly so SDK consumers see
    // the task close. densable: if(m) lf(a,"stopped",...)
    if (suppressed) {
      emitTaskTerminatedSdk(taskId, 'stopped', {
        toolUseId: task.toolUseId,
        summary: task.description,
      })
    }
    // densable XFu: if(Jk(l)&&l.agentId!==void 0&&i!==l.agentId) XFu({...})
    // densable call site omits stopperAgentId → dWr(undefined) → "main session".
    if (shellAgentId !== undefined && callerAgentId !== shellAgentId) {
      notifyShellStoppedByOther({
        taskId,
        toolUseId: task.toolUseId,
        description: task.description ?? task.command,
        ownerAgentId: shellAgentId,
      })
    }
  }

  const command = isLocalShellTask(task) ? task.command : task.description

  return { taskId, taskType: task.type, command, outcome: 'killed' }
}

/**
 * Official densable XFu — when a shell owned by agent A is stopped by caller
 * ≠ A, enqueue a task-notification to the owner:
 *   Task "…" was stopped by ${dWr(stopperAgentId)}
 * densable call site omits stopperAgentId (dWr(undefined) → "main session").
 * Optional stopperAgentId kept for tests / future agent-vs-agent naming.
 */
function notifyShellStoppedByOther(opts: {
  taskId: string
  toolUseId?: string
  description: string
  ownerAgentId: string
  /** densable dWr(e) = e ?? "main session" */
  stopperAgentId?: string
}): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { enqueuePendingNotification } = require('../utils/messageQueueManager.js') as {
      enqueuePendingNotification: (msg: {
        value: string
        mode: string
        priority: string
        agentId?: string
      }) => void
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const tags = require('../constants/xml.js') as {
      TASK_NOTIFICATION_TAG: string
      TASK_ID_TAG: string
      TOOL_USE_ID_TAG: string
      STATUS_TAG: string
      SUMMARY_TAG: string
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { escapeXml } = require('../utils/xml.js') as {
      escapeXml: (s: string) => string
    }
    // densable dWr(e){return e??"main session"}
    const stopper = opts.stopperAgentId ?? 'main session'
    const summary = `Task "${opts.description}" was stopped by ${stopper}`
    // densable XFu: Ul(r) on toolUseId, Ul(t) on taskId, Ul(s) on summary
    const toolUseIdLine = opts.toolUseId
      ? `\n<${tags.TOOL_USE_ID_TAG}>${escapeXml(opts.toolUseId)}</${tags.TOOL_USE_ID_TAG}>`
      : ''
    const message = `<${tags.TASK_NOTIFICATION_TAG}>
<${tags.TASK_ID_TAG}>${escapeXml(opts.taskId)}</${tags.TASK_ID_TAG}>${toolUseIdLine}
<${tags.STATUS_TAG}>stopped</${tags.STATUS_TAG}>
<${tags.SUMMARY_TAG}>${escapeXml(summary)}</${tags.SUMMARY_TAG}>
</${tags.TASK_NOTIFICATION_TAG}>`
    enqueuePendingNotification({
      value: message,
      mode: 'task-notification',
      priority: 'next',
      agentId: opts.ownerAgentId,
    })
  } catch {
    /* optional — queue not available in some test stubs */
  }
}

/**
 * Official Rba densable — force-dismiss panel: retain:false, diskLoaded:false,
 * evictAfter:0 (hide immediately). Keeps task entry; clears viewing if focused.
 */
function dismissLocalAgentPanel(
  taskId: string,
  setAppState: StopTaskContext['setAppState'],
): void {
  setAppState(prev => {
    const n = prev.tasks?.[taskId]
    if (!n || n.type !== 'local_agent') return prev
    if (n.status === 'running') return prev
    if ((n as { evictAfter?: number }).evictAfter === 0) return prev
    const viewingThis = prev.viewingAgentTaskId === taskId
    return {
      ...prev,
      tasks: {
        ...prev.tasks,
        [taskId]: {
          ...n,
          retain: false,
          diskLoaded: false,
          messages: undefined,
          evictAfter: 0,
        },
      },
      ...(viewingThis
        ? {
            viewingAgentTaskId: undefined,
            viewSelectionMode: 'none' as const,
          }
        : {}),
    }
  })
}

function fjrObserverSelf(
  taskId: string,
  agentType: string | undefined,
): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { stopObserverPairingInPlace } = require('../utils/observerAgents.js') as {
      stopObserverPairingInPlace: (
        observerTaskId: string,
        opts?: { agentType?: string },
      ) => boolean
    }
    stopObserverPairingInPlace(taskId, { agentType })
  } catch {
    /* optional */
  }
}

/**
 * Official ySr local_agent branch + gtf cascade.
 *
 * Densable ySr:
 *   if (e.isObserver) {
 *     // H1e(OH): Fjr on user; status!=="running" → XV only (covers YC);
 *     // running → hAe(user) + kill (no gtf — OH cascade only when zle, but
 *     // OH non-running returns before that loop)
 *     if (user && !running && !YC) Rba
 *     return "killed"  // never "dismissed"
 *   }
 *   if (!running && !YC) return Rba, "dismissed"
 *   hAe; XV; gtf; return "killed"
 */
function stopLocalAgentTask(
  task: LocalAgentTaskState,
  context: StopTaskContext & { displayId?: string },
): StopTaskResult {
  const {
    getAppState,
    setAppState,
    source = 'user',
    callerAgentId,
    killedBy = 'user',
  } = context
  const taskId = task.id
  // densable u — Elo may rewrite query → id; errors show "name (id)" form.
  const displayId = context.displayId ?? taskId
  const targetAgentId = task.agentId ?? taskId
  const parked = isParkedKeepaliveAgent(task)
  const killable = task.status === 'running' || parked

  // Official ySr observer branch first — always outcome "killed" (never dismissed).
  if (task.isObserver === true) {
    // densable H1e OH ownership:
    //   if(i!==void 0&&i===l.agentId) throw cannot stop itself
    //   if(!tns(i,l.agentId)) throw not_owner
    if (callerAgentId !== undefined && callerAgentId === targetAgentId) {
      throw new StopTaskError(
        `Observer ${displayId} cannot stop itself; use the task UI or a main-session TaskStop.`,
        'not_owner',
      )
    }
    if (!callerOwnsAgent(callerAgentId, targetAgentId)) {
      throw new StopTaskError(
        `Task ${displayId} is owned by ${ownerLabel(targetAgentId)}; agent ${callerAgentId} cannot stop it.`,
        'not_owner',
      )
    }
    // H1e OH: user-source pairing stop-in-place (Fjr) before kill/Rba.
    if (source === 'user') {
      fjrObserverSelf(taskId, task.agentType)
    }
    if (task.status === 'running') {
      // H1e running OH: hAe(user) then kill. No gtf — densable OH path
      // never reaches the descendant loop for non-zle self.
      if (source === 'user') {
        markAgentStoppedByUser(taskId, setAppState)
      }
      // densable OH non-running uses XV(a,r) default killedBy user; running
      // goes through d.kill(..., killedBy) which is parent for TaskStop.
      killAsyncAgent(taskId, setAppState, killedBy)
    } else if (parked) {
      // H1e: status!=="running" early-return XV(a,r) — densable omits killedBy
      // so default "user". Still pass through context for TaskStop parent stamp.
      killAsyncAgent(taskId, setAppState, killedBy)
    } else if (source === 'user') {
      // densable ySr: if(user && !running && !YC) Rba; still return killed
      dismissLocalAgentPanel(taskId, setAppState)
    }
    return {
      taskId,
      taskType: task.type,
      command: task.description,
      outcome: 'killed',
    }
  }

  // densable H1e non-OH ownership after OH branch:
  //   if(!OH(l)&&!tns(i,l.agentId)) throw not_owner
  if (!callerOwnsAgent(callerAgentId, targetAgentId)) {
    throw new StopTaskError(
      `Task ${displayId} is owned by ${ownerLabel(targetAgentId)}; agent ${callerAgentId} cannot stop it.`,
      'not_owner',
    )
  }

  if (!killable) {
    // Official non-observer terminal: Rba → dismissed
    dismissLocalAgentPanel(taskId, setAppState)
    return {
      taskId,
      taskType: task.type,
      command: task.description,
      outcome: 'dismissed',
    }
  }

  // Snapshot tasks before kill for gtf descendant walk (Beo needs pre-kill tree).
  const tasksSnapshot = getAppState().tasks ?? {}

  // Official: if (Wl(i)&&(running||YC)) hAe(e.id,t)
  markAgentStoppedByUser(taskId, setAppState)
  // Suppress per-agent async notif when bulk/cascade may re-notify — Kle on self
  // is densable for descendants; parent stop from TaskStop still uses BRt paths
  // via XV when needed. Mark notified to align with Kle bulk patterns.
  markAgentsNotified(taskId, setAppState)
  // densable ySr: XV(e.id,t,"user") hardcodes user; H1e TaskStop uses
  // d.kill(..., killedBy:"parent") instead. Local unifies on context.killedBy.
  killAsyncAgent(taskId, setAppState, killedBy)
  // Official: gtf(e,t,{source}) — descendants always XV(...,"user")
  killDescendantAgents(
    { id: taskId, agentId: task.agentId ?? taskId },
    tasksSnapshot,
    setAppState,
    { source },
  )

  return {
    taskId,
    taskType: task.type,
    command: task.description,
    outcome: 'killed',
  }
}
