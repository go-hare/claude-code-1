import type { UUID } from 'crypto'
import { randomUUID } from 'crypto'
import { getIsNonInteractiveSession, getSessionId } from '../bootstrap/state.js'
import type { SdkWorkflowProgress } from '../types/tools.js'

type TaskStartedEvent = {
  type: 'system'
  subtype: 'task_started'
  task_id: string
  tool_use_id?: string
  description: string
  task_type?: string
  workflow_name?: string
  prompt?: string
}

type TaskProgressEvent = {
  type: 'system'
  subtype: 'task_progress'
  task_id: string
  tool_use_id?: string
  description: string
  usage: {
    total_tokens: number
    tool_uses: number
    duration_ms: number
  }
  last_tool_name?: string
  summary?: string
  // Delta batch of workflow state changes. Clients upsert by
  // `${type}:${index}` then group by phaseIndex to rebuild the phase tree,
  // same fold as collectFromEvents + groupByPhase in PhaseProgress.tsx.
  workflow_progress?: SdkWorkflowProgress[]
}

// Emitted when a foreground agent completes without being backgrounded.
// Drained by drainSdkEvents() directly into the output stream — does NOT
// go through the print.ts XML task_notification parser and does NOT trigger
// the LLM loop. Consumers (e.g. VS Code session.ts) use this to remove the
// task from the subagent panel.
type TaskNotificationSdkEvent = {
  type: 'system'
  subtype: 'task_notification'
  task_id: string
  tool_use_id?: string
  status: 'completed' | 'failed' | 'stopped'
  output_file: string
  summary: string
  usage?: {
    total_tokens: number
    tool_uses: number
    duration_ms: number
  }
}

// Mirrors notifySessionStateChanged. The CCR bridge already receives this
// via its own listener; SDK consumers (scmuxd, VS Code) need the same signal
// to know when the main turn's generator is idle vs actively producing.
// The 'idle' transition fires AFTER heldBackResult flushes and the bg-agent
// do-while loop exits — so SDK consumers can trust it as the authoritative
// "turn is over" signal even when result was withheld for background agents.
type SessionStateChangedEvent = {
  type: 'system'
  subtype: 'session_state_changed'
  state: 'idle' | 'running' | 'requires_action'
}

export type SdkEvent =
  | TaskStartedEvent
  | TaskProgressEvent
  | TaskNotificationSdkEvent
  | SessionStateChangedEvent

const MAX_QUEUE_SIZE = 1000
const queue: SdkEvent[] = []

/**
 * densable c7c — once-gate so lf / print dual paths never double-close a task
 * for SDK / Host consumers (Jp Tasks pane).
 */
const emittedTerminalTaskIds = new Set<string>()

/** densable k4i — allow a later terminal bookend after resume/re-notify. */
export function clearTaskTerminatedSdkGate(taskId: string): void {
  emittedTerminalTaskIds.delete(taskId)
}

/** densable c7c — returns true on first terminal emit for this taskId. */
function claimTaskTerminatedSdkGate(taskId: string): boolean {
  if (emittedTerminalTaskIds.has(taskId)) {
    return false
  }
  emittedTerminalTaskIds.add(taskId)
  return true
}

export function enqueueSdkEvent(event: SdkEvent): void {
  // SDK events are only consumed (drained) in headless/streaming mode.
  // In TUI mode they would accumulate up to the cap and never be read.
  if (!getIsNonInteractiveSession()) {
    return
  }
  if (queue.length >= MAX_QUEUE_SIZE) {
    // densable BC: prefer evicting non-bookend events so task_started /
    // task_notification stay available for Host Tasks UI.
    const nonBookend = queue.findIndex(
      e =>
        e.type !== 'system' ||
        (e.subtype !== 'task_started' && e.subtype !== 'task_notification'),
    )
    if (nonBookend === -1) {
      queue.shift()
    } else {
      queue.splice(nonBookend, 1)
    }
  }
  queue.push(event)
}

export function drainSdkEvents(): Array<
  SdkEvent & { uuid: UUID; session_id: string; timestamp: string }
> {
  if (queue.length === 0) {
    return []
  }
  const events = queue.splice(0)
  // densable / Host Jp: ISO timestamp so Tasks pane startedAt/completedAt
  // resolve from raw.timestamp (open-claude-web timestampFromRaw) instead of
  // only receive-time fallback.
  const timestamp = new Date().toISOString()
  return events.map(e => ({
    ...e,
    uuid: randomUUID(),
    session_id: getSessionId(),
    timestamp,
  }))
}

/**
 * densable lf — emit a task_notification SDK event for a task terminal state.
 *
 * registerTask() always emits task_started; this is the closing bookend.
 * Once-gated (c7c): safe to call from both BRt XML enqueue and print.ts
 * conversion without double-closing Host Tasks.
 *
 * Paths that suppress the XML notification (notified:true pre-set, kill
 * paths, abort branches) must still call this so SDK consumers
 * (Scuttle's bg-task dot, VS Code / open-claude-web Tasks pane) see close.
 *
 * @returns true if this call enqueued the bookend (first claim).
 */
export function emitTaskTerminatedSdk(
  taskId: string,
  status: 'completed' | 'failed' | 'stopped',
  opts?: {
    toolUseId?: string
    summary?: string
    outputFile?: string
    usage?: { total_tokens: number; tool_uses: number; duration_ms: number }
  },
): boolean {
  if (!claimTaskTerminatedSdkGate(taskId)) {
    return false
  }
  enqueueSdkEvent({
    type: 'system',
    subtype: 'task_notification',
    task_id: taskId,
    tool_use_id: opts?.toolUseId,
    status,
    output_file: opts?.outputFile ?? '',
    summary: opts?.summary ?? '',
    usage: opts?.usage,
  })
  return true
}
