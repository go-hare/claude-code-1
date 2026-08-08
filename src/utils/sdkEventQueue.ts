import type { UUID } from 'crypto'
import { randomUUID } from 'crypto'
import {
  getIsNonInteractiveSession,
  getSessionId,
  isReplBridgeActive,
} from '../bootstrap/state.js'
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

/**
 * Official 2.1.x stream-json: query yields
 * `{ type: "command_lifecycle", uuid, state }` for user-command ack
 * (started when batch begins, completed on turn/control close).
 * densable Host treats this as non-transcript (oWK skip).
 * `uuid` is the **command** uuid — must not be rewritten on drain.
 */
type CommandLifecycleSdkEvent = {
  type: 'command_lifecycle'
  uuid: string
  /** densable S8o: queued|started|completed|cancelled|discarded */
  state: 'queued' | 'started' | 'completed' | 'cancelled' | 'discarded'
}

/**
 * Official 2.1.x: live thinking-token estimate during redacted-thinking
 * (API often streams only pings + thinking_delta.estimated_tokens).
 * Host/SDK progress; not conversation content.
 */
type ThinkingTokensSdkEvent = {
  type: 'system'
  subtype: 'thinking_tokens'
  estimated_tokens: number
  estimated_tokens_delta: number
}

/**
 * Official 2.1.x: wire-safe TaskState patch for Host Tasks map merge.
 * Excludes abortController / messages / result.
 */
export type TaskUpdatedPatch = {
  status?: 'pending' | 'running' | 'completed' | 'failed' | 'killed' | 'paused'
  description?: string
  end_time?: number
  total_paused_ms?: number
  error?: string
  is_backgrounded?: boolean
}

type TaskUpdatedSdkEvent = {
  type: 'system'
  subtype: 'task_updated'
  task_id: string
  patch: TaskUpdatedPatch
}

/** Official 2.1.x mid-turn progress line for non-CCR Hosts. */
type TaskSummarySdkEvent = {
  type: 'system'
  subtype: 'task_summary'
  detail: string | null
}

/** Official 2.1.x permanent model fallback notification. */
type ModelFallbackSdkEvent = {
  type: 'system'
  subtype: 'model_fallback'
  trigger: 'model_not_found' | 'overloaded'
  original_model: string
  fallback_model: string
  content: string
}

/**
 * densable 2.1.211 Zlr/BC — full live background-task set (REPLACE semantics).
 * Level signal; not an edge bookend. Host swaps its set for `tasks`.
 */
export type BackgroundTasksChangedTask = {
  task_id: string
  task_type: string
  description: string
}

type BackgroundTasksChangedSdkEvent = {
  type: 'system'
  subtype: 'background_tasks_changed'
  tasks: BackgroundTasksChangedTask[]
}

export type SdkEvent =
  | TaskStartedEvent
  | TaskProgressEvent
  | TaskNotificationSdkEvent
  | SessionStateChangedEvent
  | CommandLifecycleSdkEvent
  | ThinkingTokensSdkEvent
  | TaskUpdatedSdkEvent
  | TaskSummarySdkEvent
  | ModelFallbackSdkEvent
  | BackgroundTasksChangedSdkEvent

const MAX_QUEUE_SIZE = 1000
const queue: SdkEvent[] = []

/**
 * densable NZc / MGe — optional listener fired after each successful enqueue.
 * useReplBridge registers a drain that writeSdkMessages task_* frames so RC
 * clients that join mid-run receive workflow agent grid progress.
 */
let onEnqueueListener: (() => void) | null = null

/**
 * densable MGe — register (or clear with null) the post-enqueue listener.
 * Replaces any previous listener (one-slot, densable process-global).
 */
export function setSdkEventEnqueueListener(
  listener: (() => void) | null,
): void {
  onEnqueueListener = listener
}

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
  // densable JT: queue when headless/print (dn) OR REPL Remote Control live (FC).
  // Pure TUI with no bridge would never drain — skip to avoid cap churn.
  if (!getIsNonInteractiveSession() && !isReplBridgeActive()) {
    return
  }
  if (queue.length >= MAX_QUEUE_SIZE) {
    // densable BC: prefer evicting non-bookend events so task_started /
    // task_notification stay available for Host Tasks UI. Also keep
    // command_lifecycle (Official 2.1 command uuid ack) when possible.
    const nonBookend = queue.findIndex(e => {
      if (e.type === 'command_lifecycle') return false
      if (e.type !== 'system') return true
      // Keep Tasks / Host-critical bookends under pressure.
      // Official 2.1 also treats task_summary / model_fallback as
      // scarce Host signals (prefer drop high-volume noise first).
      return (
        e.subtype !== 'task_started' &&
        e.subtype !== 'task_notification' &&
        e.subtype !== 'task_updated' &&
        e.subtype !== 'thinking_tokens' &&
        e.subtype !== 'task_summary' &&
        e.subtype !== 'model_fallback' &&
        // densable 2.1.211 level set — keep latest membership under pressure
        e.subtype !== 'background_tasks_changed'
      )
    })
    if (nonBookend === -1) {
      queue.shift()
    } else {
      queue.splice(nonBookend, 1)
    }
  }
  queue.push(event)
  onEnqueueListener?.()
}

export function drainSdkEvents(): Array<
  SdkEvent & { uuid: UUID | string; session_id: string; timestamp: string }
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
    // command_lifecycle.uuid is the user-command id Host/CCR ack against —
    // never replace with a fresh randomUUID (Official 2.1 yield shape).
    uuid: e.type === 'command_lifecycle' ? e.uuid : (randomUUID() as UUID),
    session_id: getSessionId(),
    timestamp,
  }))
}

/**
 * Official 2.1.x — emit system/thinking_tokens for Host live estimate.
 * Call from QueryEngine when thinking_delta carries estimated_tokens.
 */
export function emitThinkingTokensSdk(
  estimatedTokens: number,
  estimatedTokensDelta: number,
): void {
  enqueueSdkEvent({
    type: 'system',
    subtype: 'thinking_tokens',
    estimated_tokens: estimatedTokens,
    estimated_tokens_delta: estimatedTokensDelta,
  })
}

/** Official 2.1.x — Host Tasks map patch (clients merge by task_id). */
export function emitTaskUpdatedSdk(
  taskId: string,
  patch: TaskUpdatedPatch,
): void {
  if (!taskId || Object.keys(patch).length === 0) return
  enqueueSdkEvent({
    type: 'system',
    subtype: 'task_updated',
    task_id: taskId,
    patch,
  })
}

/**
 * Official 2.1.x — mid-turn progress phrase for LocalSessionManager.
 * detail null clears (idle).
 */
export function emitTaskSummarySdk(detail: string | null): void {
  enqueueSdkEvent({
    type: 'system',
    subtype: 'task_summary',
    detail,
  })
}

/** Official 2.1.x — permanent fallback model switch. */
export function emitModelFallbackSdk(args: {
  trigger: 'model_not_found' | 'overloaded'
  originalModel: string
  fallbackModel: string
  content: string
}): void {
  enqueueSdkEvent({
    type: 'system',
    subtype: 'model_fallback',
    trigger: args.trigger,
    original_model: args.originalModel,
    fallback_model: args.fallbackModel,
    content: args.content,
  })
}

/**
 * densable 2.1.211 BC({type:"system",subtype:"background_tasks_changed",tasks})
 * REPLACE semantics: full live set after membership change.
 */
export function emitBackgroundTasksChangedSdk(
  tasks: BackgroundTasksChangedTask[],
): void {
  enqueueSdkEvent({
    type: 'system',
    subtype: 'background_tasks_changed',
    tasks,
  })
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
