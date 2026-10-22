/**
 * densable 2.1.289 host-keyed SDK event queue (`o_` / `mx` / `Nr` / `n_` /
 * `r_` / `X5r` / `Vi` / `LQe` / `J5r` / `Di` / `gx`).
 *
 * Semantic names only — never export minify
 * `o_|mx|Nr|Zv|R4o|n_|r_|X5r|Vi|LQe|J5r|Di|gx|hx|e9o|h0e|Ytr`.
 *
 * Host-keyed bag (`mx.of(U().host)`) plus ALS override — not a process
 * singleton array.
 */
import { AsyncLocalStorage } from 'async_hooks'
import type { UUID } from 'crypto'
import { randomUUID } from 'crypto'
import {
  getIsNonInteractiveSession,
  getSessionId,
  isReplBridgeActive,
} from '../bootstrap/state.js'
import { logForDebugging } from './debug.js'
import { getBootstrapSessionHost } from './sessionRoot.js'

type TaskStartedEvent = {
  type: 'system'
  subtype: 'task_started'
  task_id: string
  tool_use_id?: string
  description: string
  subagent_type?: string
  is_backgrounded?: boolean
  spawn_depth?: number
  task_type?: string
  workflow_name?: string
  prompt?: string
  skip_transcript?: boolean
  ambient?: boolean
}

type TaskProgressEvent = {
  type: 'system'
  subtype: 'task_progress'
  task_id: string
  tool_use_id?: string
  description: string
  subagent_type?: string
  usage: {
    total_tokens: number
    tool_uses: number
    duration_ms: number
  }
  last_tool_name?: string
  summary?: string
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
  reason?: 'worker_restart'
  output_file: string
  summary: string
  usage?: {
    total_tokens: number
    tool_uses: number
    duration_ms: number
  }
  resource_links?: unknown[]
  skip_transcript?: boolean
  ambient?: boolean
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

/** densable xa / Vi — Stop-hook block-cap toast (system/notification). */
type NotificationSdkEvent = {
  type: 'system'
  subtype: 'notification'
  key: string
  text: string
  priority: string
  color?: string
}

/**
 * densable 2.1.211 Zlr/BC — full live background-task set (REPLACE semantics).
 * Level signal; not an edge bookend. Host swaps its set for `tasks`.
 */
export type BackgroundTasksChangedTask = {
  task_id: string
  task_type: string
  description: string
  ambient?: boolean
}

type BackgroundTasksChangedSdkEvent = {
  type: 'system'
  subtype: 'background_tasks_changed'
  tasks: BackgroundTasksChangedTask[]
}

/**
 * densable 2.1.224 #21 — compact progress / idle status for RC clients.
 * Wire shape matches print.ts / densable $Oi: system/status + status field.
 */
type SdkStatusEvent = {
  type: 'system'
  subtype: 'status'
  /** densable $Oi / SDKStatusSchema — only compacting is a known status value */
  status: 'compacting' | null
  uuid?: string
  session_id?: string
}

/**
 * densable conversation_reset — /clear propagates to attached RC clients.
 * Distinct from system/status; densable yBo + WS bookend.
 */
type ConversationResetSdkEvent = {
  type: 'conversation_reset'
  new_conversation_id: string
  uuid?: string
  session_id?: string
}

/** densable stream_event frames may hit enqueue; JT skips them without a listener. */
type StreamEventSdkEvent = {
  type: 'stream_event'
  [key: string]: unknown
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
  | NotificationSdkEvent
  | BackgroundTasksChangedSdkEvent
  | SdkStatusEvent
  | ConversationResetSdkEvent
  | StreamEventSdkEvent

export type DrainedSdkEvent = SdkEvent & {
  uuid: UUID | string
  session_id: string
  timestamp?: string
}

const MAX_QUEUE_SIZE = 1000
const MAX_EVICTED_KEYS = 1000
const DEFAULT_QUEUE_KEY = 'cli'

/**
 * densable `z` — WeakMap host → bag. Check `!== undefined`, not truthy.
 */
class WeakOwnerCache<T> {
  #e: () => T
  #t = new WeakMap<object, T>()
  constructor(e: () => T) {
    this.#e = e
  }
  of(e: object): T {
    const t = this.#t.get(e)
    if (t !== undefined) return t
    const o = this.#e()
    this.#t.set(e, o)
    return o
  }
}

/**
 * densable `Wf` without hostedWorker: `c$()` =
 * `CLAUDE_CODE_ENVIRONMENT_KIND==="bridge"`. HostedWorker lives on leftover
 * SessionHost — not invented here.
 */
export function shouldRedactPersistedSdkLane(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.CLAUDE_CODE_ENVIRONMENT_KIND === 'bridge'
}

/**
 * densable `o_` — per-host multi-key SDK event queue bag.
 */
export class SdkEventQueueBag {
  queueKey: () => string = () => DEFAULT_QUEUE_KEY
  queuesByKey = new Map<string, SdkEvent[]>()
  evictedKeys = new Set<string>()
  enqueueListener: (() => void) | null = null
  queueUsedReported = false
  nonbookendEvictionReported = false
  bookendEvictionReported = false
  /**
   * densable `Wf` without hostedWorker: `ENVIRONMENT_KIND==="bridge"`.
   * Gold bag default is `()=>false`; print/SDK host then overwrite. CLI analog
   * is live so bridge print stamps gx without a leftover SessionHost field.
   */
  redactsPersistedLane: () => boolean = shouldRedactPersistedSdkLane

  setQueueKey(key: string | (() => string)): void {
    this.queueKey = typeof key === 'function' ? key : () => key
  }

  currentKey(): string {
    return this.queueKey()
  }

  setEnqueueListener(listener: (() => void) | null): void {
    this.enqueueListener = listener
  }

  queueCount(): number {
    return this.queuesByKey.size
  }

  reset(): void {
    this.queuesByKey.clear()
    this.evictedKeys.clear()
    this.queueKey = () => DEFAULT_QUEUE_KEY
    this.enqueueListener = null
    this.redactsPersistedLane = shouldRedactPersistedSdkLane
    this.queueUsedReported = false
    this.nonbookendEvictionReported = false
    this.bookendEvictionReported = false
  }

  currentQueueOrCreate(): SdkEvent[] | null {
    const key = this.queueKey()
    if (this.evictedKeys.has(key)) return null
    let queue = this.queuesByKey.get(key)
    if (!queue) {
      queue = []
      this.queuesByKey.set(key, queue)
    }
    return queue
  }

  currentQueueOrNull(): SdkEvent[] | null {
    return this.queuesByKey.get(this.queueKey()) ?? null
  }

  evictKey(key: string): void {
    this.queuesByKey.delete(key)
    this.evictedKeys.add(key)
    if (this.evictedKeys.size > MAX_EVICTED_KEYS) {
      const oldest = this.evictedKeys.values().next().value
      if (oldest !== undefined) this.evictedKeys.delete(oldest)
    }
  }

  /**
   * densable JT + BC: queue when headless/print OR REPL Remote Control live.
   * Keep fork Host-critical subtypes under pressure (broader than gold SEA
   * keep-set) so existing eviction tests stay green.
   */
  enqueue(event: SdkEvent): void {
    if (!getIsNonInteractiveSession() && !isReplBridgeActive()) {
      return
    }
    // densable: stream_event is interactive-noise unless a drain listener is live.
    if (
      event.type === 'stream_event' &&
      !getIsNonInteractiveSession() &&
      this.enqueueListener === null
    ) {
      return
    }
    const queue = this.currentQueueOrCreate()
    if (!queue) return
    if (queue.length >= MAX_QUEUE_SIZE) {
      if (event.type === 'stream_event') return
      const nonBookend = queue.findIndex(e => {
        if (e.type === 'conversation_reset') return false
        if (e.type === 'command_lifecycle') return false
        if (e.type !== 'system') return true
        if (e.subtype === 'status' && e.status === null) return false
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
        this.bookendEvictionReported = true
        const softBookend = queue.findIndex(e => {
          if (e.type === 'conversation_reset') return false
          if (
            e.type === 'system' &&
            ((e.subtype === 'status' && e.status === null) ||
              e.subtype === 'task_started' ||
              e.subtype === 'task_notification')
          ) {
            return false
          }
          return true
        })
        if (softBookend === -1) {
          queue.shift()
        } else {
          queue.splice(softBookend, 1)
        }
      } else {
        this.nonbookendEvictionReported = true
        queue.splice(nonBookend, 1)
      }
    }
    queue.push(event)
    this.queueUsedReported = true
    this.enqueueListener?.()
  }

  hasQueued(pred: (event: SdkEvent) => boolean): boolean {
    const queue = this.currentQueueOrNull()
    return queue !== null && queue.some(pred)
  }

  drain(): DrainedSdkEvent[] {
    const queue = this.currentQueueOrNull()
    if (!queue || queue.length === 0) return []
    return this.stamp(queue.splice(0), getSessionId())
  }

  drainForSession(sessionId: string): DrainedSdkEvent[] {
    const queue = this.queuesByKey.get(sessionId)
    if (!queue || queue.length === 0) return []
    return this.stamp(queue.splice(0), sessionId)
  }

  stamp(events: SdkEvent[], sessionId: string): DrainedSdkEvent[] {
    const redact = this.redactsPersistedLane()
    const timestamp = new Date().toISOString()
    return events.map(e => {
      const redacted = redact ? redactPersistedLaneEvent(e) : e
      const base: DrainedSdkEvent = {
        ...redacted,
        // command_lifecycle.uuid is the user-command id Host/CCR ack against —
        // never replace with a fresh randomUUID (Official 2.1 yield shape).
        uuid:
          redacted.type === 'command_lifecycle'
            ? redacted.uuid
            : (randomUUID() as UUID),
        session_id: sessionId,
      }
      if (
        redacted.type === 'system' &&
        (redacted.subtype === 'task_started' ||
          redacted.subtype === 'task_notification' ||
          redacted.subtype === 'task_progress')
      ) {
        return base
      }
      return { ...base, timestamp }
    })
  }
}

/** densable `gx` — blank task_notification.output_file on redacted lanes. */
function redactPersistedLaneEvent(event: SdkEvent): SdkEvent {
  if (event.type === 'system' && event.subtype === 'task_notification') {
    return { ...event, output_file: '' }
  }
  return event
}

/**
 * densable `n_` fragment — once-gate set for terminal task_notification emits.
 * Kept as its own host bag (not the full leftover task-output bag).
 */
export class SdkTerminalEmitClaimsBag {
  terminalEmitClaims = new Set<string>()

  reset(): void {
    this.terminalEmitClaims.clear()
  }
}

const hostQueues = new WeakOwnerCache(() => new SdkEventQueueBag())
const queueAls = new AsyncLocalStorage<SdkEventQueueBag>()

const hostTerminalClaims = new WeakOwnerCache(
  () => new SdkTerminalEmitClaimsBag(),
)
const terminalClaimsAls = new AsyncLocalStorage<SdkTerminalEmitClaimsBag>()

/** densable `mx.of(host)` — bag for a host object. */
export function sdkEventQueueOf(host: object): SdkEventQueueBag {
  return hostQueues.of(host)
}

/** densable `Nr` — ALS override, else bootstrap host bag. */
export function getSdkEventQueue(): SdkEventQueueBag {
  return queueAls.getStore() ?? hostQueues.of(getBootstrapSessionHost())
}

/** densable `R4o`-style — run `fn` with an ALS queue bag. */
export function runWithSdkEventQueue<T>(bag: SdkEventQueueBag, fn: () => T): T {
  return queueAls.run(bag, fn)
}

function getSdkTerminalEmitClaimsBag(): SdkTerminalEmitClaimsBag {
  return (
    terminalClaimsAls.getStore() ??
    hostTerminalClaims.of(getBootstrapSessionHost())
  )
}

/** densable `dx.of(host)` fragment — terminal once-gate bag for a host. */
export function sdkTerminalEmitClaimsOf(
  host: object,
): SdkTerminalEmitClaimsBag {
  return hostTerminalClaims.of(host)
}

/** Run `fn` with an ALS terminal-claims bag (test / host isolation). */
export function runWithSdkTerminalEmitClaims<T>(
  bag: SdkTerminalEmitClaimsBag,
  fn: () => T,
): T {
  return terminalClaimsAls.run(bag, fn)
}

/** densable `hx` / `e9o`. */
export function getSdkEventQueueKey(): string {
  return getSdkEventQueue().currentKey()
}

/** densable `setQueueKey` public wrapper. */
export function setSdkEventQueueKey(key: string | (() => string)): void {
  getSdkEventQueue().setQueueKey(key)
}

/**
 * densable MGe — register (or clear with null) the post-enqueue listener.
 * Replaces any previous listener (one-slot).
 */
export function setSdkEventEnqueueListener(
  listener: (() => void) | null,
): void {
  getSdkEventQueue().setEnqueueListener(listener)
}

/** densable k4i / X5r — allow a later terminal bookend after resume/re-notify. */
export function clearTaskTerminatedSdkGate(taskId: string): void {
  getSdkTerminalEmitClaimsBag().terminalEmitClaims.delete(taskId)
}

/** densable c7c / r_ — returns true on first terminal emit for this taskId. */
function claimTaskTerminatedSdkGate(taskId: string): boolean {
  const claims = getSdkTerminalEmitClaimsBag().terminalEmitClaims
  if (claims.has(taskId)) return false
  claims.add(taskId)
  return true
}

/** densable Vi. */
export function enqueueSdkEvent(event: SdkEvent): void {
  getSdkEventQueue().enqueue(event)
}

/**
 * densable leftover hook `QK` / `jj` @206816743 — `Io().hasQueued(e)`.
 * Peek. Does not drain.
 */
export function hasMatchingQueuedSdkEvent(
  pred: (event: SdkEvent) => boolean,
): boolean {
  return getSdkEventQueue().hasQueued(pred)
}

/**
 * densable leftover hook `S_e` / `Nn` @209368305.
 * `a_e` = `zK().filter(S_e).map(iCe)`.
 */
export function isBridgeForwardableSdkEvent(event: {
  type?: string
  subtype?: string
}): boolean {
  return (
    event.type === 'conversation_reset' ||
    (event.type === 'system' && event.subtype === 'status') ||
    event.subtype === 'task_started' ||
    event.subtype === 'task_progress' ||
    event.subtype === 'task_updated' ||
    event.subtype === 'task_notification' ||
    event.subtype === 'background_tasks_changed' ||
    event.subtype === 'thinking_tokens' ||
    event.subtype === 'code_change_published' ||
    event.subtype === 'vcs_state_changed'
  )
}

/** densable LQe. */
export function drainSdkEvents(): DrainedSdkEvent[] {
  const bag = getSdkEventQueue()
  const key = bag.currentKey()
  const sessionId = getSessionId()
  // densable 2.1.289: warn when e9o() !== sessionId && e9o() !== "cli"
  if (key !== sessionId && key !== DEFAULT_QUEUE_KEY) {
    logForDebugging(
      `drainSdkEvents: current queue key "${key}" differs from session "${sessionId}" and default "${DEFAULT_QUEUE_KEY}"`,
    )
  }
  return bag.drain()
}

/** densable J5r. */
export function drainSdkEventsForSession(sessionId: string): DrainedSdkEvent[] {
  return getSdkEventQueue().drainForSession(sessionId)
}

export function resetSdkEventQueueForTests(): void {
  getSdkEventQueue().reset()
  getSdkTerminalEmitClaimsBag().reset()
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
 * densable lf / Di — emit a task_notification SDK event for a task terminal state.
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
    reason?: 'worker_restart'
    resourceLinks?: unknown[]
    skipTranscript?: boolean
    ambient?: boolean
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
    reason: opts?.reason,
    output_file: opts?.outputFile ?? '',
    summary: opts?.summary ?? '',
    usage: opts?.usage,
    resource_links: opts?.resourceLinks,
    skip_transcript: opts?.skipTranscript,
    ambient: opts?.ambient,
  })
  return true
}
