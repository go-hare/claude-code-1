import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs'
import type { Permutations } from 'src/types/utils.js'
import {
  getMainThreadAgentId,
  getSessionId,
  isMainThreadQueuedCommand,
} from '../bootstrap/state.js'
import type { AppState } from '../state/AppState.js'
import type {
  QueueOperation,
  QueueOperationMessage,
} from '../types/messageQueueTypes.js'
import type {
  EditablePromptInputMode,
  PromptInputMode,
  QueuedCommand,
  QueuePriority,
} from '../types/textInputTypes.js'
import type { PastedContent } from './config.js'
import { logForDebugging } from './debug.js'
import { extractTextContent, isHumanLikeOrigin } from './messages.js'
import { parseAddress } from './peerAddress.js'
import {
  getOwnHopTokens,
  getPeerAdmissionGuard,
  getPeerAdmissionLimits,
} from './peerAdmission.js'
import { type PeerReceiptDropReason, sendPeerReceipt } from './peerReceipts.js'
import { recordQueueOperation } from './sessionStorage.js'
import { createSignal } from './signal.js'
import { recordHandbackDelivery } from './subagentHandback.js'

export type SetAppState = (f: (prev: AppState) => AppState) => void

// ============================================================================
// Logging helper
// ============================================================================

function logOperation(operation: QueueOperation, content?: string): void {
  const sessionId = getSessionId()
  const queueOp: QueueOperationMessage = {
    type: 'queue-operation',
    operation,
    timestamp: new Date().toISOString(),
    sessionId,
    ...(content !== undefined && { content }),
  }
  void recordQueueOperation(queueOp)
}

// ============================================================================
// Unified command queue (module-level, independent of React state)
//
// All commands — user input, task notifications, orphaned permissions — go
// through this single queue. React components subscribe via
// useSyncExternalStore (subscribeToCommandQueue / getCommandQueueSnapshot).
// Non-React code (print.ts streaming loop) reads directly via
// getCommandQueue() / getCommandQueueLength().
//
// Priority determines dequeue order: 'now' > 'next' > 'later'.
// Within the same priority, commands are processed FIFO.
// ============================================================================

const commandQueue: QueuedCommand[] = []
/** Frozen snapshot — recreated on every mutation for useSyncExternalStore. */
let snapshot: readonly QueuedCommand[] = Object.freeze([])
const queueChanged = createSignal()

/**
 * Official Ntl `w` / Cuy — commands already dequeued but still executing.
 * Esc restore must see this so a queued turn is not treated as "user moved on".
 */
let inFlightDrainBatch: QueuedCommand[] | null = null

/**
 * densable print Kc cancel-pending (`he`/`ye`/`ke`/`Se`). Cap 256.
 * Never export minify he|ye|ke|Se.
 */
const CANCEL_PENDING_CAP = 256
const cancelPending = new Set<string>()
const cancelPendingAcked = new Set<string>()

function notifySubscribers(): void {
  snapshot = Object.freeze([...commandQueue])
  queueChanged.emit()
}

// ============================================================================
// useSyncExternalStore interface
// ============================================================================

/**
 * Subscribe to command queue changes.
 * Compatible with React's useSyncExternalStore.
 */
export const subscribeToCommandQueue = queueChanged.subscribe

/**
 * Get current snapshot of the command queue.
 * Compatible with React's useSyncExternalStore.
 * Returns a frozen array that only changes reference on mutation.
 */
export function getCommandQueueSnapshot(): readonly QueuedCommand[] {
  return snapshot
}

// ============================================================================
// Read operations (for non-React code)
// ============================================================================

/**
 * Get a mutable copy of the current queue.
 * Use for one-off reads where you need the actual commands.
 */
export function getCommandQueue(): QueuedCommand[] {
  return [...commandQueue]
}

/**
 * Get the current queue length without copying.
 * densable j4i — full queue including nested/subagent-addressed entries.
 */
export function getCommandQueueLength(): number {
  return commandQueue.length
}

/**
 * densable Xwt / getMainThreadQueueLength — count of AL entries only
 * (`cmd.agentId === mi()`). Full length would keep the REPL spinner spinning
 * when only nested/subagent notifications remain (processQueueIfReady never
 * drains them on the main thread). Spinner and mainIsBusy must use this, not
 * getCommandQueueLength().
 */
export function getMainThreadQueueLength(): number {
  let n = 0
  for (const cmd of commandQueue) {
    if (isMainThreadQueuedCommand(cmd)) n++
  }
  return n
}

/**
 * Check if there are commands in the queue.
 */
export function hasCommandsInQueue(): boolean {
  return commandQueue.length > 0
}

/**
 * densable Opu: whether the queue has an Esc-cancellable / poppable command.
 * Uses x4 = isQueuedCommandEditable (mode ∉ {task-notification}, !isMeta,
 * human-like origin). Background task-notification entries alone must NOT
 * keep chat:cancel active at an idle prompt — otherwise Esc-Esc never reaches
 * the rewind message selector (densable 2.1.216 #12).
 */
export function hasEditableCommandsInQueue(): boolean {
  return commandQueue.some(isQueuedCommandEditable)
}

/**
 * Trigger a re-check by notifying subscribers.
 * Use after async processing completes to ensure remaining commands
 * are picked up by useSyncExternalStore consumers.
 */
export function recheckCommandQueue(): void {
  if (commandQueue.length > 0) {
    notifySubscribers()
  }
}

// ============================================================================
// Write operations
// ============================================================================

/**
 * Local fortify over densable 2.1.211 IT/cf: official push does NOT stamp
 * agentId — every densable call site passes agentId:mi() explicitly. Local
 * callers sometimes omit; stamp sticky mi() so AL drains them. Explicit
 * agentId (nested owner / subagent) is preserved. Not dual-OR drain.
 * densable also never rewrites agentId on mJo/ZR — sticky mi() keeps old
 * main stamps AL-matchable without queue rewrite.
 */
function withMainThreadAgentId(command: QueuedCommand): QueuedCommand {
  if (command.agentId !== undefined) return command
  return { ...command, agentId: getMainThreadAgentId() }
}

// ============================================================================
// densable 2.1.252 Sn/ap — task-notification value cap
// ============================================================================

/** densable Q8n — cap passed to ap for task-notification. */
export const TASK_NOTIFICATION_CHAR_CAP = 100_000
/** densable jYt — hysteresis: skip truncate when length <= cap + jYt. */
const TASK_NOTIFICATION_CAP_HYSTERESIS = 1024
/** densable HVe — ap default when Sn is not passing Q8n. */
const DEFAULT_TRUNCATE_CHAR_CAP = 10_000
/** densable WYt — nested truncation markers in the omitted middle. */
const NESTED_TRUNCATION_MARKER =
  /\n\n\.\.\. \[(\d+) characters truncated\] \.\.\.\n\n/g

/** densable zYt */
function formatTruncationMarker(omitted: number): string {
  return `\n\n... [${omitted} characters truncated] ...\n\n`
}

/** densable ce — prefix slice; drop trailing high surrogate U+D800–DBFF. */
function slicePrefixUtf16(text: string, max: number): string {
  if (max <= 0) return ''
  if (text.length <= max) return text
  const sliced = text.slice(0, max)
  const last = sliced.charCodeAt(max - 1)
  return last >= 0xd800 && last <= 0xdbff ? sliced.slice(0, -1) : sliced
}

/** densable vg — suffix slice; drop leading low surrogate U+DC00–DFFF. */
function sliceSuffixUtf16(text: string, max: number): string {
  if (max <= 0) return ''
  if (text.length <= max) return text
  const sliced = text.slice(-max)
  const first = sliced.charCodeAt(0)
  return first >= 0xdc00 && first <= 0xdfff ? sliced.slice(1) : sliced
}

/** densable Mve */
function truncateHeadTail(
  text: string,
  head: number,
  tail: number,
  marker: (omitted: number) => string,
): string {
  if (text.length <= head + tail) return text
  const prefix = head > 0 ? slicePrefixUtf16(text, head) : ''
  const suffix = tail > 0 ? sliceSuffixUtf16(text, tail) : ''
  const omitted = text.length - prefix.length - suffix.length
  return `${prefix}${marker(omitted)}${suffix}`
}

/** densable ap */
function truncateWithHysteresis(
  text: string,
  cap: number = DEFAULT_TRUNCATE_CHAR_CAP,
): string {
  if (text.length <= cap + TASK_NOTIFICATION_CAP_HYSTERESIS) {
    return text
  }
  const head = Math.floor(cap / 2)
  const tail = cap - head
  return truncateHeadTail(text, head, tail, omitted => {
    // Gold slices the requested halves, not surrogate-adjusted lengths.
    const middle = text.slice(head, text.length - tail)
    let nestedExtra = 0
    for (const match of middle.matchAll(NESTED_TRUNCATION_MARKER)) {
      const digits = match[1]!
      const nested = digits.length <= 15 ? Number(digits) : Number.NaN
      if (Number.isSafeInteger(nested) && nested >= match[0].length) {
        nestedExtra += nested - match[0].length
      }
    }
    return formatTruncationMarker(omitted + nestedExtra)
  })
}

/** densable ap(value, Q8n) */
export function capTaskNotificationValue(value: string): string {
  return truncateWithHysteresis(value, TASK_NOTIFICATION_CHAR_CAP)
}

export type ReportingAdmissionResult =
  | { admitted: true }
  | { admitted: false; reason: string }

export type EnqueueReportingAdmissionOpts = {
  /** densable ds `receipt` — coalesced schedules optional UDS drop receipt. */
  receipt?: 'coalesced' | 'immediate'
  /** densable ds `ahead` — unshift instead of push. */
  ahead?: boolean
}

type PeerQueueOrigin = {
  kind?: string
  from?: string
  name?: string
  hopChain?: readonly string[]
  verifiedPeerPid?: number
  senderTaskId?: string
  msg_id?: string
  handback?: boolean
  flagged?: boolean
  admissionExempt?: string
}

/**
 * densable Mbe — cross-session peer (not subagent handback).
 * Handback peers carry senderTaskId and skip hop/rate/queue guards.
 */
function isCrossSessionPeerOrigin(
  origin: PeerQueueOrigin | undefined,
): origin is PeerQueueOrigin & { kind: 'peer' } {
  return origin?.kind === 'peer' && origin.senderTaskId === undefined
}

/** densable htt — verified / known peer address → full zo.admit path. */
function isVerifiedPeerOrigin(origin: PeerQueueOrigin): boolean {
  return origin.verifiedPeerPid !== undefined || origin.from !== 'unknown'
}

/** densable Un — count of queued cross-session peer commands. */
export function countQueuedPeerMessages(): number {
  let n = 0
  for (const cmd of commandQueue) {
    if (isCrossSessionPeerOrigin(cmd.origin as PeerQueueOrigin | undefined)) {
      n++
    }
  }
  return n
}

function peerCommandBody(command: QueuedCommand): string {
  return typeof command.value === 'string'
    ? command.value
    : extractTextContent(command.value, '\n')
}

function reportPeerDrop(opts: {
  reason: PeerReceiptDropReason
  from?: string
  name?: string
}): void {
  const who = opts.from ?? 'unknown'
  const named = opts.name ? ` (@${opts.name})` : ''
  logForDebugging(`[peer-guard] drop ${opts.reason} from ${who}${named}`, {
    level: 'warn',
  })
}

/**
 * densable Kr — optional UDS drop receipt when receipt mode is coalesced.
 * Full Ko trail coalescer not required; sendPeerReceipt is the installed host.
 */
function noteCoalescedPeerDropReceipt(
  command: QueuedCommand,
  reason: PeerReceiptDropReason,
): void {
  const origin = command.origin as PeerQueueOrigin | undefined
  if (origin?.kind !== 'peer' || typeof origin.from !== 'string') return
  if (parseAddress(origin.from).scheme !== 'uds') return
  sendPeerReceipt(
    {
      mode: command.mode,
      agentId: command.agentId,
      value: typeof command.value === 'string' ? command.value : undefined,
      origin: {
        kind: origin.kind,
        from: origin.from,
        msg_id: origin.msg_id,
        verifiedPeerPid: origin.verifiedPeerPid,
      },
    },
    'dropped',
    {
      dropReason: reason,
      ...(origin.msg_id !== undefined
        ? { droppedMsgIds: [origin.msg_id] }
        : {}),
    },
  )
}

/**
 * densable `yr` — admit cross-session peers via zo.checkHopChain / zo.admit /
 * maxQueuedPeerMessages. Non-peer and handback peers always admit.
 * Never export minify `yr`.
 */
function admitReportingCommand(
  command: QueuedCommand,
  receipt: 'coalesced' | 'immediate' = 'coalesced',
): ReportingAdmissionResult {
  const origin = command.origin as PeerQueueOrigin | undefined
  if (!isCrossSessionPeerOrigin(origin)) {
    return { admitted: true }
  }

  const resurrected =
    (command as { admissionExempt?: string }).admissionExempt ===
      'resurrected' || origin.admissionExempt === 'resurrected'
  const ownTokens = getOwnHopTokens()
  const guard = getPeerAdmissionGuard()

  if (!resurrected && !isVerifiedPeerOrigin(origin)) {
    const hop = guard.checkHopChain(origin.hopChain, ownTokens)
    if (hop && !hop.admitted) {
      reportPeerDrop({
        reason: hop.reason,
        from: origin.from,
        name: origin.name,
      })
      if (receipt === 'coalesced') {
        noteCoalescedPeerDropReceipt(command, hop.reason)
      }
      return { admitted: false, reason: hop.reason }
    }
  }

  if (!resurrected && isVerifiedPeerOrigin(origin)) {
    const body = peerCommandBody(command)
    const admitted = guard.admit({
      // Gold yr: Fr.from!=="unknown"?from:${Fr.from}:pid:${Fr.verifiedPeerPid}
      senderKey:
        origin.from !== 'unknown'
          ? `from:${origin.from}`
          : `pid:${origin.verifiedPeerPid}`,
      body,
      hopChain: origin.hopChain,
      ownTokens,
    })
    if (!admitted.admitted) {
      reportPeerDrop({
        reason: admitted.reason,
        from: origin.from,
        name: origin.name,
      })
      if (receipt === 'coalesced') {
        noteCoalescedPeerDropReceipt(command, admitted.reason)
      }
      return { admitted: false, reason: admitted.reason }
    }
  }

  if (
    countQueuedPeerMessages() >= getPeerAdmissionLimits().maxQueuedPeerMessages
  ) {
    reportPeerDrop({
      reason: 'queue-full',
      from: origin.from,
      name: origin.name,
    })
    if (receipt === 'coalesced') {
      noteCoalescedPeerDropReceipt(command, 'queue-full')
    }
    return { admitted: false, reason: 'queue-full' }
  }

  return { admitted: true }
}

/**
 * densable `enqueueReportingAdmission` / `ds` — admit-then-push; on peer
 * handback origin call `recordHandbackDelivery` (m7n). Alias of gold `ds`.
 * Never export minify `ds`/`yr`.
 */
export function enqueueReportingAdmission(
  command: QueuedCommand,
  opts: EnqueueReportingAdmissionOpts = {},
): ReportingAdmissionResult {
  const admitted = admitReportingCommand(command, opts.receipt ?? 'coalesced')
  if (!admitted.admitted) return admitted

  const stamped = withMainThreadAgentId(command)
  const queued: QueuedCommand = {
    ...stamped,
    priority: stamped.priority ?? 'next',
  }
  if (opts.ahead) commandQueue.unshift(queued)
  else commandQueue.push(queued)

  const origin = command.origin as PeerQueueOrigin | undefined
  if (
    origin?.kind === 'peer' &&
    origin.handback === true &&
    origin.senderTaskId !== undefined &&
    (command as { admissionExempt?: string }).admissionExempt !== 'resurrected'
  ) {
    recordHandbackDelivery(origin.senderTaskId, String(command.agentId ?? ''), {
      flagged: origin.flagged === true,
    })
  }

  notifySubscribers()
  if (!(command as { unlogged?: boolean }).unlogged) {
    logOperation(
      'enqueue',
      typeof stamped.value === 'string' ? stamped.value : undefined,
    )
  }
  return { admitted: true }
}

/**
 * Add a command to the queue.
 * Used for user-initiated commands (prompt, bash, orphaned-permission).
 * Defaults priority to 'next' (processed before task notifications).
 * densable IT does not stamp agentId; local stamps sticky mi() when omitted.
 *
 * densable `xr` → `ds`: enqueue routes through enqueueReportingAdmission.
 */
export function enqueue(command: QueuedCommand): void {
  enqueueReportingAdmission(command)
}

/**
 * densable promoteToNow — send-now flushes the main-thread queue to priority now.
 * Does not cancel tools; REPL abort + backgroundNow handles the running turn.
 */
export function promoteMainThreadQueueToNow(): number {
  let n = 0
  for (const cmd of commandQueue) {
    if (!isMainThreadQueuedCommand(cmd)) continue
    if (cmd.priority === 'now') continue
    cmd.priority = 'now'
    n++
  }
  if (n > 0) notifySubscribers()
  return n
}

/**
 * Add a task notification to the queue.
 * Convenience wrapper that defaults priority to 'later' so user input
 * is never starved by system messages.
 * densable jr: admit once via yr, cap task-notification, then push directly —
 * never through ds, whose second yr would reject the same body as duplicate.
 * densable cf does not stamp agentId; local stamps sticky mi() when omitted.
 * Explicit agentId (owner / subagent) is preserved.
 */
export function enqueuePendingNotification(command: QueuedCommand): void {
  if (!admitReportingCommand(command).admitted) return

  // densable Sn: cap task-notification strings via ap(..., Q8n) before push.
  let queued = command
  if (
    command.mode === 'task-notification' &&
    typeof command.value === 'string'
  ) {
    const capped = capTaskNotificationValue(command.value)
    if (capped !== command.value) {
      logForDebugging(
        'enqueuePendingNotification: task-notification capped from ' +
          `${command.value.length} to ${capped.length} chars`,
        { level: 'warn' },
      )
      queued = { ...command, value: capped }
    }
  }
  const stamped = withMainThreadAgentId(queued)
  commandQueue.push({ ...stamped, priority: stamped.priority ?? 'later' })
  notifySubscribers()
  if (!(command as { unlogged?: boolean }).unlogged) {
    logOperation(
      'enqueue',
      typeof stamped.value === 'string' ? stamped.value : undefined,
    )
  }
}

const PRIORITY_ORDER: Record<QueuePriority, number> = {
  now: 0,
  next: 1,
  later: 2,
}

/**
 * Remove and return the highest-priority command, or undefined if empty.
 * Within the same priority level, commands are dequeued FIFO.
 *
 * An optional `filter` narrows the candidates: only commands for which the
 * predicate returns `true` are considered. Non-matching commands stay in the
 * queue untouched. This lets between-turn drains (SDK, REPL) restrict to
 * main-thread commands (densable AL: `cmd.agentId === mi()`) without
 * restructuring the existing while-loop patterns.
 */
export function dequeue(
  filter?: (cmd: QueuedCommand) => boolean,
): QueuedCommand | undefined {
  if (commandQueue.length === 0) {
    return undefined
  }

  // Find the first command with the highest priority (respecting filter)
  let bestIdx = -1
  let bestPriority = Infinity
  for (let i = 0; i < commandQueue.length; i++) {
    const cmd = commandQueue[i]!
    if (filter && !filter(cmd)) continue
    const priority = PRIORITY_ORDER[cmd.priority ?? 'next']
    if (priority < bestPriority) {
      bestIdx = i
      bestPriority = priority
    }
  }

  if (bestIdx === -1) return undefined

  const [dequeued] = commandQueue.splice(bestIdx, 1)
  notifySubscribers()
  logOperation('dequeue')
  return dequeued
}

/**
 * Remove and return all commands from the queue.
 * Logs a dequeue operation for each command.
 */
export function dequeueAll(): QueuedCommand[] {
  if (commandQueue.length === 0) {
    return []
  }

  const commands = [...commandQueue]
  commandQueue.length = 0
  notifySubscribers()

  for (const _cmd of commands) {
    logOperation('dequeue')
  }

  return commands
}

/**
 * Return the highest-priority command without removing it, or undefined if empty.
 * Accepts an optional `filter` — only commands passing the predicate are considered.
 */
export function peek(
  filter?: (cmd: QueuedCommand) => boolean,
): QueuedCommand | undefined {
  if (commandQueue.length === 0) {
    return undefined
  }
  let bestIdx = -1
  let bestPriority = Infinity
  for (let i = 0; i < commandQueue.length; i++) {
    const cmd = commandQueue[i]!
    if (filter && !filter(cmd)) continue
    const priority = PRIORITY_ORDER[cmd.priority ?? 'next']
    if (priority < bestPriority) {
      bestIdx = i
      bestPriority = priority
    }
  }
  if (bestIdx === -1) return undefined
  return commandQueue[bestIdx]
}

/**
 * Remove and return all commands matching a predicate, preserving priority order.
 * Non-matching commands stay in the queue.
 */
export function dequeueAllMatching(
  predicate: (cmd: QueuedCommand) => boolean,
): QueuedCommand[] {
  const matched: QueuedCommand[] = []
  const remaining: QueuedCommand[] = []
  for (const cmd of commandQueue) {
    if (predicate(cmd)) {
      matched.push(cmd)
    } else {
      remaining.push(cmd)
    }
  }
  if (matched.length === 0) {
    return []
  }
  commandQueue.length = 0
  commandQueue.push(...remaining)
  notifySubscribers()
  for (const _cmd of matched) {
    logOperation('dequeue')
  }
  return matched
}

/**
 * Remove specific commands from the queue by reference identity.
 * Callers must pass the same object references that are in the queue
 * (e.g. from getCommandsByMaxPriority). Logs a 'remove' operation for each.
 */
export function remove(commandsToRemove: QueuedCommand[]): void {
  if (commandsToRemove.length === 0) {
    return
  }

  const before = commandQueue.length
  for (let i = commandQueue.length - 1; i >= 0; i--) {
    if (commandsToRemove.includes(commandQueue[i]!)) {
      commandQueue.splice(i, 1)
    }
  }

  if (commandQueue.length !== before) {
    notifySubscribers()
  }

  for (const _cmd of commandsToRemove) {
    logOperation('remove')
  }
}

/**
 * Remove commands matching a predicate.
 * Returns the removed commands.
 */
export function removeByFilter(
  predicate: (cmd: QueuedCommand) => boolean,
): QueuedCommand[] {
  const removed: QueuedCommand[] = []
  for (let i = commandQueue.length - 1; i >= 0; i--) {
    if (predicate(commandQueue[i]!)) {
      removed.unshift(commandQueue.splice(i, 1)[0]!)
    }
  }

  if (removed.length > 0) {
    notifySubscribers()
    for (const _cmd of removed) {
      logOperation('remove')
    }
  }

  return removed
}

/**
 * Clear all commands from the queue.
 * Used by ESC cancellation to discard queued notifications.
 */
export function clearCommandQueue(): void {
  if (commandQueue.length === 0) {
    return
  }
  commandQueue.length = 0
  notifySubscribers()
}

/**
 * Clear all commands and reset snapshot.
 * Used for test cleanup.
 */
export function resetCommandQueue(): void {
  commandQueue.length = 0
  snapshot = Object.freeze([])
  inFlightDrainBatch = null
  cancelPending.clear()
  cancelPendingAcked.clear()
}

/**
 * densable `he` — mark a queued uuid cancelled by the host.
 * `terminalEmitted:true` also acks (returns true the first time).
 */
export function markCancelPending(
  uuid: string,
  opts?: { terminalEmitted?: boolean },
): boolean {
  if (cancelPending.delete(uuid)) {
    cancelPending.add(uuid)
  } else {
    if (
      opts?.terminalEmitted !== true &&
      cancelPending.size >= CANCEL_PENDING_CAP
    ) {
      let evict: string | undefined
      for (const id of cancelPending) {
        if (!cancelPendingAcked.has(id)) {
          evict = id
          break
        }
      }
      if (evict !== undefined) cancelPending.delete(evict)
    }
    cancelPending.add(uuid)
  }
  if (opts?.terminalEmitted !== true) return false
  if (cancelPendingAcked.has(uuid)) return false
  cancelPendingAcked.add(uuid)
  return true
}

/** densable `ye` — consume (delete) a pending cancel. */
export function consumeCancelPending(uuid: string): boolean {
  return cancelPending.delete(uuid)
}

/** densable `ke` — consume the terminal-emitted ack. */
export function consumeCancelPendingAcked(uuid: string): boolean {
  return cancelPendingAcked.delete(uuid)
}

/** densable `Se`. */
export function hasCancelPendingAcked(uuid: string): boolean {
  return cancelPendingAcked.has(uuid)
}

/**
 * Official `setInFlightDrainBatch` — mark a dequeued batch as still executing.
 * Cuy sets this synchronously after dequeue, before executeInput.
 */
export function setInFlightDrainBatch(batch: QueuedCommand[]): void {
  inFlightDrainBatch = batch
}

/**
 * Official `clearInFlightDrainBatch` — only clears when `batch` is omitted
 * or is the same reference currently held (a newer drain must not be wiped).
 */
export function clearInFlightDrainBatch(batch?: QueuedCommand[]): void {
  if (batch === undefined || inFlightDrainBatch === batch) {
    inFlightDrainBatch = null
  }
}

/**
 * Official `someInFlightDrainCommand`. No predicate → any in-flight drain.
 */
export function someInFlightDrainCommand(
  pred?: (cmd: QueuedCommand) => boolean,
): boolean {
  if (inFlightDrainBatch === null) return false
  if (pred === undefined) return inFlightDrainBatch.length > 0
  return inFlightDrainBatch.some(pred)
}

// ============================================================================
// Editable mode helpers
// ============================================================================

const NON_EDITABLE_MODES = new Set<PromptInputMode>([
  'task-notification',
  'poll-event',
] satisfies Permutations<Exclude<PromptInputMode, EditablePromptInputMode>>)

export function isPromptInputModeEditable(
  mode: PromptInputMode,
): mode is EditablePromptInputMode {
  return !NON_EDITABLE_MODES.has(mode)
}

/**
 * Whether this queued command can be pulled into the input buffer via UP/ESC.
 * densable aJ: editable mode && !isMeta && Mj(origin) — non-human origins
 * (even non-meta) must not leak into the user's input buffer.
 */
export function isQueuedCommandEditable(cmd: QueuedCommand): boolean {
  return (
    isPromptInputModeEditable(cmd.mode) &&
    !cmd.isMeta &&
    isHumanLikeOrigin(cmd.origin)
  )
}

/**
 * densable U4i — queue preview under the prompt.
 * Visible for: channel | task-notification | auto-continuation | observer |
 * peer(+senderTaskId|force) | else aJ (editable && !isMeta && Mj(origin)).
 * Superset of editable — meta system origins show but stay non-editable.
 * Ace ≠ U4i: do not shrink this to Ace-only kinds.
 */
/**
 * densable U4i(e,t): `t` is forcePeer only when typeof t==="boolean".
 * Array.prototype.filter passes (element, index) — without the typeof guard,
 * index leaks as forcePeer and incorrectly shows peer-without-senderTaskId.
 */
export function isQueuedCommandVisible(
  cmd: QueuedCommand,
  forcePeer?: boolean,
): boolean {
  // densable: let r = typeof t === "boolean" ? t : !1
  const force = typeof forcePeer === 'boolean' ? forcePeer : false
  const origin = cmd.origin
  if (origin?.kind === 'channel') return true
  if (origin?.kind === 'task-notification') return true
  if (origin?.kind === 'auto-continuation') return true
  if (origin?.kind === 'observer') return true
  if (origin?.kind === 'peer') {
    if (origin.senderTaskId !== undefined) return true
    if (force) return true
  }
  return isQueuedCommandEditable(cmd)
}

/**
 * Extract text from a queued command value.
 * For strings, returns the string.
 * For ContentBlockParam[], extracts text from text blocks.
 */
function extractTextFromValue(value: string | ContentBlockParam[]): string {
  return typeof value === 'string' ? value : extractTextContent(value, '\n')
}

/**
 * Extract images from ContentBlockParam[] and convert to PastedContent format.
 * Returns empty array for string values or if no images found.
 */
function extractImagesFromValue(
  value: string | ContentBlockParam[],
  startId: number,
): PastedContent[] {
  if (typeof value === 'string') {
    return []
  }

  const images: PastedContent[] = []
  let imageIndex = 0
  for (const block of value) {
    if (block.type === 'image' && block.source.type === 'base64') {
      images.push({
        id: startId + imageIndex,
        type: 'image',
        content: block.source.data,
        mediaType: block.source.media_type,
        filename: `image${imageIndex + 1}`,
      })
      imageIndex++
    }
  }
  return images
}

export type PopAllEditableResult = {
  text: string
  cursorOffset: number
  images: PastedContent[]
  /** densable ve: bash iff every popped editable cmd is bash; else prompt */
  mode: 'bash' | 'prompt'
}

/**
 * densable NMt(e,t): editable && (inputEmpty || mode!=="bash").
 * Bang-shell queue entries only pop when the prompt is empty — otherwise ↑
 * would splice `!` text into a prompt draft and send it as plain text (#19).
 */
export function isPoppableEditableCommand(
  cmd: QueuedCommand,
  inputEmpty: boolean,
): boolean {
  return isQueuedCommandEditable(cmd) && (inputEmpty || cmd.mode !== 'bash')
}

/** densable txa(e): queue has an NMt-poppable entry given inputEmpty. */
export function hasPoppableEditableCommandsInQueue(
  inputEmpty: boolean,
): boolean {
  return commandQueue.some(cmd => isPoppableEditableCommand(cmd, inputEmpty))
}

/**
 * Pop editable commands and combine them with current input for editing.
 * densable `ve` 1:1 (2.1.234): NMt filter; mode bash only when every selected
 * cmd is bash; when restoring as prompt, leave bash entries in the queue.
 * Notification modes stay queued for auto-processing.
 */
export function popAllEditable(
  currentInput: string,
  currentCursorOffset: number,
): PopAllEditableResult | undefined {
  if (commandQueue.length === 0) {
    return undefined
  }

  const inputEmpty = currentInput === ''
  const candidates = commandQueue.filter(cmd =>
    isPoppableEditableCommand(cmd, inputEmpty),
  )
  if (candidates.length === 0) {
    return undefined
  }

  // densable: Je=je.every(mode==="bash")?"bash":"prompt"
  const mode: 'bash' | 'prompt' = candidates.every(cmd => cmd.mode === 'bash')
    ? 'bash'
    : 'prompt'
  // densable: Ft=Je==="bash"?je:je.filter(mode!=="bash")
  const editable =
    mode === 'bash' ? candidates : candidates.filter(cmd => cmd.mode !== 'bash')
  if (editable.length === 0) {
    return undefined
  }

  // Extract text from queued commands (handles both strings and ContentBlockParam[])
  const queuedTexts = editable.map(cmd => extractTextFromValue(cmd.value))
  const newInput = [...queuedTexts, currentInput].filter(Boolean).join('\n')

  // Calculate cursor offset: length of joined queued commands + 1 + current cursor offset
  const cursorOffset = queuedTexts.join('\n').length + 1 + currentCursorOffset

  // Extract images from queued commands
  const images: PastedContent[] = []
  let nextImageId = Date.now() // Use timestamp as base for unique IDs
  for (const cmd of editable) {
    // handlePromptSubmit queues images in pastedContents (value is a string).
    // Preserve the original PastedContent id so imageStore lookups still work.
    if (cmd.pastedContents) {
      for (const content of Object.values(cmd.pastedContents)) {
        if (content.type === 'image') {
          images.push(content)
        }
      }
    }
    // Bridge/remote commands may embed images directly in ContentBlockParam[].
    const cmdImages = extractImagesFromValue(cmd.value, nextImageId)
    images.push(...cmdImages)
    nextImageId += cmdImages.length
  }

  for (const command of editable) {
    logOperation(
      'popAll',
      typeof command.value === 'string' ? command.value : undefined,
    )
  }

  // densable: keep commands not in Ft (incl. bash left behind on prompt restore)
  const popped = new Set(editable)
  const remaining = commandQueue.filter(cmd => !popped.has(cmd))
  commandQueue.length = 0
  commandQueue.push(...remaining)
  notifySubscribers()

  return { text: newInput, cursorOffset, images, mode }
}

export type PopEditableAtResult = PopAllEditableResult

/**
 * densable `Ne` / `popEditableAt` 1:1 (2.1.234 #20).
 * Index is into `n.filter(lJ)` (editable), then NMt-gated.
 * Paste-id remap (`ke`) is not ported — same extract path as `popAllEditable`.
 */
export function popEditableAt(
  index: number,
  currentInput: string,
  currentCursorOffset: number,
): PopEditableAtResult | undefined {
  const cmd = commandQueue.filter(isQueuedCommandEditable)[index]
  if (!cmd) {
    return undefined
  }
  if (!isPoppableEditableCommand(cmd, currentInput === '')) {
    return undefined
  }

  const text = extractTextFromValue(cmd.value)
  const newInput = [text, currentInput].filter(Boolean).join('\n')
  const cursorOffset = text.length + 1 + currentCursorOffset

  const images: PastedContent[] = []
  if (cmd.pastedContents) {
    for (const content of Object.values(cmd.pastedContents)) {
      if (content.type === 'image') {
        images.push(content)
      }
    }
  }
  images.push(...extractImagesFromValue(cmd.value, Date.now()))

  logOperation('popOne', typeof cmd.value === 'string' ? cmd.value : undefined)

  const gr = commandQueue.indexOf(cmd)
  if (gr !== -1) {
    commandQueue.splice(gr, 1)
    notifySubscribers()
  }

  return {
    text: newInput,
    cursorOffset,
    images,
    mode: cmd.mode === 'bash' ? 'bash' : 'prompt',
  }
}

/**
 * densable LI `lte()` branch — ↑ walks still-queued editables, then history.
 */
export function queueEditIndexAfterHistoryUp(
  current: number | null,
  editableCount: number,
): { queueEditIndex: number | null; historyUp: boolean } {
  if (current === null && editableCount > 0) {
    return { queueEditIndex: editableCount - 1, historyUp: false }
  }
  if (current !== null) {
    if (current > 0) {
      return { queueEditIndex: current - 1, historyUp: false }
    }
    return { queueEditIndex: null, historyUp: true }
  }
  return { queueEditIndex: null, historyUp: true }
}

/**
 * densable na `lte()` branch — ↓ walks still-queued editables, then footer/history.
 */
export function queueEditIndexAfterHistoryDown(
  current: number | null,
  editableCount: number,
): { queueEditIndex: number | null; consumed: boolean } {
  if (current === null) {
    return { queueEditIndex: null, consumed: false }
  }
  if (current < editableCount - 1) {
    return { queueEditIndex: current + 1, consumed: true }
  }
  return { queueEditIndex: null, consumed: true }
}

/** densable clamp effect: `if(yo===0)mr(null); else if(Er>yo-1)mr(yo-1)`. */
export function clampQueueEditIndex(
  current: number | null,
  editableCount: number,
): number | null {
  if (current === null) return null
  if (editableCount === 0) return null
  if (current > editableCount - 1) return editableCount - 1
  return current
}

/**
 * Get commands at or above a given priority level without removing them.
 * Useful for mid-chain draining where only urgent items should be processed.
 *
 * Priority order: 'now' (0) > 'next' (1) > 'later' (2).
 * Passing 'now' returns only now-priority commands; 'later' returns everything.
 */
export function getCommandsByMaxPriority(
  maxPriority: QueuePriority,
): QueuedCommand[] {
  const threshold = PRIORITY_ORDER[maxPriority]
  return commandQueue.filter(
    cmd => PRIORITY_ORDER[cmd.priority ?? 'next'] <= threshold,
  )
}

/**
 * densable `ks` / `countRemainingWakePollEventsAfter` — wake poll-events
 * still queued after `taken` (same agent as the first poll-event in taken).
 */
export function countRemainingWakePollEventsAfter(
  taken: readonly QueuedCommand[],
): number {
  const takenSet = new Set(taken)
  const agentId = taken.find(cmd => cmd.mode === 'poll-event')?.agentId
  return commandQueue.filter(
    cmd =>
      cmd.mode === 'poll-event' &&
      cmd.pollEvent?.wake === true &&
      !takenSet.has(cmd) &&
      (agentId === undefined || cmd.agentId === agentId),
  ).length
}

/**
 * Returns true if the command is a slash command that should be routed through
 * processSlashCommand rather than sent to the model as text.
 *
 * Commands with `skipSlashCommands` are usually treated as plain text, except
 * Remote Control bridge messages (`bridgeOrigin`) that are re-validated later
 * through isBridgeSafeCommand().
 */
export function isSlashCommand(cmd: QueuedCommand): boolean {
  if (cmd.mode === 'poll-event') {
    return false
  }
  return (
    typeof cmd.value === 'string' &&
    cmd.value.trim().startsWith('/') &&
    (!cmd.skipSlashCommands || cmd.bridgeOrigin === true)
  )
}
