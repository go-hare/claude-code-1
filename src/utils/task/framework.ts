import {
  OUTPUT_FILE_TAG,
  STATUS_TAG,
  SUMMARY_TAG,
  TASK_ID_TAG,
  TASK_NOTIFICATION_TAG,
  TASK_TYPE_TAG,
  TOOL_USE_ID_TAG,
} from '../../constants/xml.js'
import type { AppState } from '../../state/AppState.js'
import {
  isTerminalTaskStatus,
  type TaskStatus,
  type TaskType,
} from '../../Task.js'
import type { TaskState } from '../../tasks/types.js'
import {
  enqueuePendingNotification,
  getCommandQueue,
} from '../messageQueueManager.js'
import { enqueueSdkEvent } from '../sdkEventQueue.js'
import { getTaskOutputDelta, getTaskOutputPath } from './diskOutput.js'

// Standard polling interval for all tasks
export const POLL_INTERVAL_MS = 1000

// Duration to display killed tasks before eviction
export const STOPPED_DISPLAY_MS = 3_000

// Grace period for terminal local_agent tasks in the coordinator panel
// densable _re=30000 (tB empty-KA schedule + QYi non-park path)
export const PANEL_GRACE_MS = 30_000

/**
 * densable bot="flag:idle-window" — temporary self-KA reason stamped on DSu
 * complete so the agent stays YC-parked for CSu ms even with no live children.
 * okg timer tB's this reason after IDLE_WINDOW_MS.
 */
export const IDLE_WINDOW_KEEPALIVE_REASON = 'flag:idle-window'

/** densable CSu=30000 — idle-window timer delay (same as panel grace). */
export const IDLE_WINDOW_MS = PANEL_GRACE_MS

// Attachment type for task status updates
export type TaskAttachment = {
  type: 'task_status'
  taskId: string
  toolUseId?: string
  taskType: TaskType
  status: TaskStatus
  description: string
  deltaSummary: string | null // New output since last attachment
}

type SetAppState = (updater: (prev: AppState) => AppState) => void

/**
 * Update a task's state in AppState.
 * Helper function for task implementations.
 * Generic to allow type-safe updates for specific task types.
 */
export function updateTaskState<T extends TaskState>(
  taskId: string,
  setAppState: SetAppState,
  updater: (task: T) => T,
): void {
  setAppState(prev => {
    const task = prev.tasks?.[taskId] as T | undefined
    if (!task) {
      return prev
    }
    const updated = updater(task)
    if (updated === task) {
      // Updater returned the same reference (early-return no-op). Skip the
      // spread so s.tasks subscribers don't re-render on unchanged state.
      return prev
    }
    return {
      ...prev,
      tasks: {
        ...prev.tasks,
        [taskId]: updated,
      },
    }
  })
}

/**
 * Register a new task in AppState.
 */
export function registerTask(task: TaskState, setAppState: SetAppState): void {
  let isReplacement = false
  setAppState(prev => {
    const existing = prev.tasks[task.id]
    isReplacement = existing !== undefined
    // Carry forward UI-held state on re-register (resumeAgentBackground
    // replaces the task; user's retain shouldn't reset). startTime keeps
    // the panel sort stable; messages + diskLoaded preserve the viewed
    // transcript across the replace (the user's just-appended prompt lives
    // in messages and isn't on disk yet).
    // Official ekg merge: retain/startTime/diskLoaded/pendingMessages +
    // keepaliveReasons/ownerAgentId/parentAgentId/spawnDepth so resume
    // replace does not drop live Gge holds or adopt owner tree.
    // Local also preserves messages (viewed transcript not yet on disk).
    type EkgCarry = {
      retain: boolean
      startTime: number
      diskLoaded?: boolean
      pendingMessages?: unknown
      messages?: unknown
      keepaliveReasons?: Set<string>
      ownerAgentId?: string
      parentAgentId?: string
      spawnDepth?: number
      isObserver?: boolean
    }
    const prevTask = existing as EkgCarry | undefined
    const merged: TaskState =
      prevTask && 'retain' in existing
        ? ({
            ...task,
            retain: prevTask.retain,
            startTime: prevTask.startTime,
            ...(prevTask.messages !== undefined
              ? { messages: prevTask.messages }
              : {}),
            diskLoaded: prevTask.diskLoaded,
            pendingMessages: prevTask.pendingMessages as string[] | undefined,
            ...(prevTask.keepaliveReasons !== undefined
              ? { keepaliveReasons: prevTask.keepaliveReasons }
              : {}),
            ...(prevTask.ownerAgentId !== undefined
              ? { ownerAgentId: prevTask.ownerAgentId }
              : {}),
            ...(prevTask.parentAgentId !== undefined
              ? { parentAgentId: prevTask.parentAgentId }
              : {}),
            ...(prevTask.spawnDepth !== undefined
              ? { spawnDepth: prevTask.spawnDepth }
              : {}),
            // Official ekg: ...s.isObserver!==void 0&&{isObserver:s.isObserver}
            ...(prevTask.isObserver !== undefined
              ? { isObserver: prevTask.isObserver }
              : {}),
          } as TaskState)
        : task
    return { ...prev, tasks: { ...prev.tasks, [task.id]: merged } }
  })

  // Replacement (resume) — not a new start. Skip to avoid double-emit.
  if (isReplacement) return

  enqueueSdkEvent({
    type: 'system',
    subtype: 'task_started',
    task_id: task.id,
    tool_use_id: task.toolUseId,
    description: task.description,
    task_type: task.type,
    workflow_name:
      'workflowName' in task
        ? (task.workflowName as string | undefined)
        : undefined,
    prompt: 'prompt' in task ? (task.prompt as string) : undefined,
  })
}

/**
 * Eagerly evict a terminal task from AppState.
 * The task must be in a terminal state (completed/failed/killed) with notified=true.
 * This allows memory to be freed without waiting for the next query loop iteration.
 * The lazy GC in generateTaskAttachments() remains as a safety net.
 */
export function evictTerminalTask(
  taskId: string,
  setAppState: SetAppState,
): void {
  setAppState(prev => {
    const task = prev.tasks?.[taskId]
    if (!task) return prev
    if (!isTerminalTaskStatus(task.status)) return prev
    if (!task.notified) return prev
    // Official zle/tB: non-empty keepaliveReasons block GC until detach.
    if (
      'keepaliveReasons' in task &&
      (task as { keepaliveReasons?: Set<string> }).keepaliveReasons instanceof
        Set &&
      ((task as { keepaliveReasons?: Set<string> }).keepaliveReasons?.size ??
        0) > 0
    ) {
      return prev
    }
    // Panel grace period — blocks eviction until deadline passes.
    // 'retain' in task narrows to LocalAgentTaskState (the only type with
    // that field); evictAfter is optional so 'evictAfter' in task would
    // miss tasks that haven't had it set yet.
    if ('retain' in task && (task.evictAfter ?? Infinity) > Date.now()) {
      return prev
    }
    const { [taskId]: _, ...remainingTasks } = prev.tasks
    return { ...prev, tasks: remainingTasks }
  })
}

/**
 * Official Wge — read keepalive reason set (empty default).
 * Only local_agent tasks carry keepaliveReasons (Wl guard on Gge/tB).
 */
export function getKeepaliveReasons(task: {
  keepaliveReasons?: Set<string>
}): Set<string> {
  return task.keepaliveReasons ?? new Set()
}

/**
 * Official Gge(owner, reason, registry) portable.
 * Adds a keepalive reason on a local_agent owner so panel GC waits until
 * the child (workflow/bash/monitor/agent) detaches via removeKeepaliveReason.
 * No-op when owner missing or not a local_agent task.
 */
export function addKeepaliveReason(
  ownerAgentId: string | undefined | null,
  reason: string,
  setAppState: SetAppState,
): void {
  if (!ownerAgentId || !reason) return
  updateTaskState(ownerAgentId, setAppState, task => {
    if (task.type !== 'local_agent') return task
    const current = getKeepaliveReasons(
      task as { keepaliveReasons?: Set<string> },
    )
    if (current.has(reason)) return task
    return {
      ...task,
      keepaliveReasons: new Set(current).add(reason),
    }
  })
}

/**
 * Official tB(owner, reason, registry) portable.
 * Removes a keepalive reason. When the set becomes empty and the owner is
 * terminal + not retained + no evictAfter yet, sets PANEL_GRACE_MS deadline
 * (official Date.now()+_re with _re=30000).
 */
export function removeKeepaliveReason(
  ownerAgentId: string | undefined | null,
  reason: string,
  setAppState: SetAppState,
): void {
  if (!ownerAgentId || !reason) return
  updateTaskState(ownerAgentId, setAppState, task => {
    if (task.type !== 'local_agent') return task
    const agent = task as {
      type: 'local_agent'
      status: TaskStatus
      retain?: boolean
      evictAfter?: number
      keepaliveReasons?: Set<string>
    }
    const current = getKeepaliveReasons(agent)
    if (!current.has(reason)) return task
    const next = new Set(current)
    next.delete(reason)
    const shouldScheduleEvict =
      next.size === 0 &&
      isTerminalTaskStatus(agent.status) &&
      !agent.retain &&
      agent.evictAfter === undefined
    return {
      ...task,
      keepaliveReasons: next,
      ...(shouldScheduleEvict
        ? { evictAfter: Date.now() + PANEL_GRACE_MS }
        : {}),
    }
  })
}

/** Official Gge/tB reason prefixes for child task types. */
export function agentKeepaliveReason(taskId: string): string {
  return `agent:${taskId}`
}
export function bashKeepaliveReason(taskId: string): string {
  return `bash:${taskId}`
}
export function monitorKeepaliveReason(taskId: string): string {
  return `monitor:${taskId}`
}
export function workflowKeepaliveReason(taskId: string): string {
  return `workflow:${taskId}`
}

/** densable bot self-KA reason (not a child prefix). */
export function idleWindowKeepaliveReason(): string {
  return IDLE_WINDOW_KEEPALIVE_REASON
}

/**
 * True when the set has any keepalive reason other than flag:idle-window.
 * densable DSu `l` flag: for (p of Wge) if p!==bot { l=true }.
 */
export function hasNonIdleWindowKeepalive(
  reasons: Iterable<string> | undefined | null,
): boolean {
  if (!reasons) return false
  for (const r of reasons) {
    if (r !== IDLE_WINDOW_KEEPALIVE_REASON) return true
  }
  return false
}

/**
 * Official QYi(task, {park}) — panel eviction deadline.
 * - retain → undefined (never auto-evict)
 * - park && keepaliveReasons non-empty → undefined (held open by children)
 * - else → Date.now() + PANEL_GRACE_MS (_re=30000)
 */
export function computePanelEvictAfter(
  task: {
    retain?: boolean
    keepaliveReasons?: Set<string>
  },
  opts: { park: boolean },
): number | undefined {
  if (task.retain) return undefined
  if (opts.park && (task.keepaliveReasons?.size ?? 0) > 0) return undefined
  return Date.now() + PANEL_GRACE_MS
}

/**
 * densable YC(task): completed + keepaliveReasons non-empty.
 * Local also requires type===local_agent. BRt ownerBusy uses YC(owner)&&!pn().
 */
export function isParkedKeepaliveAgent(task: {
  type?: string
  status?: TaskStatus
  keepaliveReasons?: Set<string>
}): boolean {
  return (
    task.type === 'local_agent' &&
    task.status === 'completed' &&
    (task.keepaliveReasons?.size ?? 0) > 0
  )
}

/**
 * densable Yqe park pe — count `agent:` keepalive reasons on owner task.
 * Gold: for (let He of Ce.keepaliveReasons) if(He.startsWith("agent:")) pe++
 */
export function countAgentKeepaliveChildren(
  ownerAgentId: string | undefined | null,
  getAppState: () => AppState,
): number {
  if (!ownerAgentId) return 0
  const task = getAppState().tasks?.[ownerAgentId]
  if (!task || task.type !== 'local_agent') return 0
  const reasons = getKeepaliveReasons(
    task as { keepaliveReasons?: Set<string> },
  )
  let pe = 0
  for (const r of reasons) {
    if (r.startsWith('agent:')) pe++
  }
  return pe
}

/**
 * Official JXt(ownerId, registry): owner still holds any `agent:` keepalive.
 * Used after Jeo to decide whether the finishing agent has live children.
 */
export function hasLiveAgentKeepaliveChildren(
  ownerAgentId: string | undefined | null,
  getAppState: () => AppState,
): boolean {
  return countAgentKeepaliveChildren(ownerAgentId, getAppState) > 0
}

/**
 * densable Jr (pure status/JXt half): skip async_launched promote when the
 * agent is already non-running and has no live agent: children.
 * Gold full: Jr = Nt==="backgrounded" && !Zt && Vt!==void0 && Vt!=="running" && !JXt
 * Caller supplies backgrounded && !Zt (or mid-bg isBackgrounded).
 */
export function isJrDeadBackgroundPromote(
  status: TaskStatus | string | undefined,
  hasLiveAgentChildren: boolean,
): boolean {
  return status !== undefined && status !== 'running' && !hasLiveAgentChildren
}

/**
 * Official Jeo(ownerId, registry) — sweep stale keepalive holds on a local_agent.
 *
 * For each `agent:` / `workflow:` reason on the owner:
 * - if a task-notification is still queued for that child+owner → keep
 * - else if child missing OR child is local_agent/local_workflow and notified
 *   → tB detach
 *
 * Called before DSu complete so a finishing parent drops children that already
 * notified (or vanished) and no longer need panel parking.
 */
export function sweepStaleKeepaliveReasons(
  ownerAgentId: string | undefined | null,
  setAppState: SetAppState,
): void {
  if (!ownerAgentId) return

  // Snapshot owner + queue outside update so we can call removeKeepaliveReason
  // (which itself updates) without nested setAppState races.
  let reasons: string[] = []
  let ownerExists = false
  setAppState(prev => {
    const owner = prev.tasks?.[ownerAgentId]
    if (owner && owner.type === 'local_agent') {
      ownerExists = true
      reasons = [
        ...getKeepaliveReasons(owner as { keepaliveReasons?: Set<string> }),
      ]
    }
    return prev
  })
  if (!ownerExists || reasons.length === 0) return

  const pendingChildIds = new Set<string>()
  for (const cmd of getCommandQueue()) {
    if (
      cmd.mode === 'task-notification' &&
      cmd.agentId === ownerAgentId &&
      typeof cmd.taskId === 'string' &&
      cmd.taskId.length > 0
    ) {
      pendingChildIds.add(cmd.taskId)
    }
  }

  // Need a fresh tasks snapshot for child notified/missing checks.
  let tasks: Record<string, TaskState> = {}
  setAppState(prev => {
    tasks = prev.tasks ?? {}
    return prev
  })

  for (const reason of reasons) {
    let childId: string | undefined
    if (reason.startsWith('agent:')) childId = reason.slice('agent:'.length)
    else if (reason.startsWith('workflow:'))
      childId = reason.slice('workflow:'.length)
    else continue

    if (pendingChildIds.has(childId)) continue

    const child = tasks[childId]
    const shouldDetach =
      !child ||
      (child.type === 'local_agent' && child.notified) ||
      (child.type === 'local_workflow' && child.notified)
    if (shouldDetach) {
      removeKeepaliveReason(ownerAgentId, reason, setAppState)
    }
  }
}

/**
 * Get all running tasks.
 */
export function getRunningTasks(state: AppState): TaskState[] {
  const tasks = state.tasks ?? {}
  return Object.values(tasks).filter(task => task.status === 'running')
}

/**
 * Generate attachments for tasks with new output or status changes.
 * Called by the framework to create push notifications.
 */
export async function generateTaskAttachments(state: AppState): Promise<{
  attachments: TaskAttachment[]
  // Only the offset patch — NOT the full task. The task may transition to
  // completed during getTaskOutputDelta's async disk read, and spreading the
  // full stale snapshot would clobber that transition (zombifying the task).
  updatedTaskOffsets: Record<string, number>
  evictedTaskIds: string[]
}> {
  const attachments: TaskAttachment[] = []
  const updatedTaskOffsets: Record<string, number> = {}
  const evictedTaskIds: string[] = []
  const tasks = state.tasks ?? {}

  for (const taskState of Object.values(tasks)) {
    if (taskState.notified) {
      switch (taskState.status) {
        case 'completed':
        case 'failed':
        case 'killed':
          // Evict terminal tasks — they've been consumed and can be GC'd
          evictedTaskIds.push(taskState.id)
          continue
        case 'pending':
          // Keep in map — hasn't run yet, but parent already knows about it
          continue
        case 'running':
          // Fall through to running logic below
          break
      }
    }

    if (taskState.status === 'running') {
      const delta = await getTaskOutputDelta(
        taskState.id,
        taskState.outputOffset,
      )
      if (delta.content) {
        updatedTaskOffsets[taskState.id] = delta.newOffset
      }
    }

    // Completed tasks are NOT notified here — each task type handles its own
    // completion notification via enqueuePendingNotification(). Generating
    // attachments here would race with those per-type callbacks, causing
    // dual delivery (one inline attachment + one separate API turn).
  }

  return { attachments, updatedTaskOffsets, evictedTaskIds }
}

/**
 * Apply the outputOffset patches and evictions from generateTaskAttachments.
 * Merges patches against FRESH prev.tasks (not the stale pre-await snapshot),
 * so concurrent status transitions aren't clobbered.
 */
export function applyTaskOffsetsAndEvictions(
  setAppState: SetAppState,
  updatedTaskOffsets: Record<string, number>,
  evictedTaskIds: string[],
): void {
  const offsetIds = Object.keys(updatedTaskOffsets)
  if (offsetIds.length === 0 && evictedTaskIds.length === 0) {
    return
  }
  setAppState(prev => {
    let changed = false
    const newTasks = { ...prev.tasks }
    for (const id of offsetIds) {
      const fresh = newTasks[id]
      // Re-check status on fresh state — task may have completed during the
      // await. If it's no longer running, the offset update is moot.
      if (fresh?.status === 'running') {
        newTasks[id] = { ...fresh, outputOffset: updatedTaskOffsets[id]! }
        changed = true
      }
    }
    for (const id of evictedTaskIds) {
      const fresh = newTasks[id]
      // Re-check terminal+notified on fresh state (TOCTOU: resume may have
      // replaced the task during the generateTaskAttachments await)
      if (!fresh || !isTerminalTaskStatus(fresh.status) || !fresh.notified) {
        continue
      }
      if (
        'keepaliveReasons' in fresh &&
        (fresh as { keepaliveReasons?: Set<string> })
          .keepaliveReasons instanceof Set &&
        ((fresh as { keepaliveReasons?: Set<string> }).keepaliveReasons?.size ??
          0) > 0
      ) {
        continue
      }
      if ('retain' in fresh && (fresh.evictAfter ?? Infinity) > Date.now()) {
        continue
      }
      delete newTasks[id]
      changed = true
    }
    return changed ? { ...prev, tasks: newTasks } : prev
  })
}

/**
 * Poll all running tasks and check for updates.
 * This is the main polling loop called by the framework.
 */
export async function pollTasks(
  getAppState: () => AppState,
  setAppState: SetAppState,
): Promise<void> {
  const state = getAppState()
  const { attachments, updatedTaskOffsets, evictedTaskIds } =
    await generateTaskAttachments(state)

  applyTaskOffsetsAndEvictions(setAppState, updatedTaskOffsets, evictedTaskIds)

  // Send notifications for completed tasks
  for (const attachment of attachments) {
    enqueueTaskNotification(attachment)
  }
}

/**
 * Enqueue a task notification to the message queue.
 */
function enqueueTaskNotification(attachment: TaskAttachment): void {
  const statusText = getStatusText(attachment.status)

  const outputPath = getTaskOutputPath(attachment.taskId)
  const toolUseIdLine = attachment.toolUseId
    ? `\n<${TOOL_USE_ID_TAG}>${attachment.toolUseId}</${TOOL_USE_ID_TAG}>`
    : ''
  const message = `<${TASK_NOTIFICATION_TAG}>
<${TASK_ID_TAG}>${attachment.taskId}</${TASK_ID_TAG}>${toolUseIdLine}
<${TASK_TYPE_TAG}>${attachment.taskType}</${TASK_TYPE_TAG}>
<${OUTPUT_FILE_TAG}>${outputPath}</${OUTPUT_FILE_TAG}>
<${STATUS_TAG}>${attachment.status}</${STATUS_TAG}>
<${SUMMARY_TAG}>Task "${attachment.description}" ${statusText}</${SUMMARY_TAG}>
</${TASK_NOTIFICATION_TAG}>`

  enqueuePendingNotification({ value: message, mode: 'task-notification' })
}

/**
 * Get human-readable status text.
 */
function getStatusText(status: TaskStatus): string {
  switch (status) {
    case 'completed':
      return 'completed successfully'
    case 'failed':
      return 'failed'
    case 'killed':
      return 'was stopped'
    case 'running':
      return 'is running'
    case 'pending':
      return 'is pending'
    case 'paused':
      return 'was paused'
  }
}
