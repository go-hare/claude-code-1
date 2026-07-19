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

// Emitted when a task reaches a terminal state (official lf bookend).
// Drained by drainSdkEvents() directly into the output stream — does NOT
// trigger the LLM loop. Official print/headless path is lf-only (no XML→SDK
// parse). Consumers (e.g. VS Code session.ts) use this to remove the task
// from the subagent panel.
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
 * Official c7c / x4i — once-gate so lf (emitTaskTerminatedSdk) does not
 * double-bookend the same task_id in one process.
 */
const taskTerminatedOnce = new Set<string>()

export function enqueueSdkEvent(event: SdkEvent): void {
  // SDK events are only consumed (drained) in headless/streaming mode.
  // In TUI mode they would accumulate up to the cap and never be read.
  if (!getIsNonInteractiveSession()) {
    return
  }
  if (queue.length >= MAX_QUEUE_SIZE) {
    queue.shift()
  }
  queue.push(event)
}

export function drainSdkEvents(): Array<
  SdkEvent & { uuid: UUID; session_id: string }
> {
  if (queue.length === 0) {
    return []
  }
  const events = queue.splice(0)
  return events.map(e => ({
    ...e,
    uuid: randomUUID(),
    session_id: getSessionId(),
  }))
}

/** Official k4i — release once-gate (tests / rare re-open). */
export function clearTaskTerminatedSdkOnce(taskId?: string): void {
  if (taskId === undefined) taskTerminatedOnce.clear()
  else taskTerminatedOnce.delete(taskId)
}

/**
 * Emit a task_notification SDK event for a task reaching a terminal state.
 *
 * Official lf portable — once-gated (c7c). registerTask() always emits
 * task_started; this is the closing bookend for SDK consumers.
 * Call from exit paths that set a task terminal (kill, abort, orphan
 * Hqb/Dqb/kqb multi F$a, adopt fail notify). XML task_notification still
 * feeds the LLM loop via ask(); it no longer double-constructs SDK events
 * in print.ts (official lf-only headless bookend).
 *
 * @returns true when the once-gate accepted the emit (queued if non-interactive).
 * Official lf returns void after c7c skip; boolean is portable for tests/callers.
 */
export function emitTaskTerminatedSdk(
  taskId: string,
  status: 'completed' | 'failed' | 'stopped',
  opts?: {
    toolUseId?: string
    summary?: string
    outputFile?: string
    usage?: { total_tokens: number; tool_uses: number; duration_ms: number }
    /**
     * When true, skip official c7c once-gate (rare). Default gated.
     */
    force?: boolean
  },
): boolean {
  // Official lf: if (!c7c(e)) return
  if (!opts?.force) {
    if (taskTerminatedOnce.has(taskId)) return false
    taskTerminatedOnce.add(taskId)
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
