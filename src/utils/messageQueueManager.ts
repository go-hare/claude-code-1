import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs'
import {
  buildPollEventEnvelope,
  mintPollEventNonce,
  POLL_CHUNK_MAX_BYTES,
  POLL_CHUNK_MAX_EVENTS,
  POLL_EVENT_KIND_REPL_EVAL,
  POLL_EVENT_KIND_REPL_STATUS,
  stampPollEventNonce,
} from '@claude-code/builtin-tools/tools/PollTool/constants.js'
import type { Permutations } from 'src/types/utils.js'
import {
  addToHistory,
  isValidPasteId,
  mintPasteId,
  parseReferences,
  renumberPasteRefInDisplay,
} from '../history.js'
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
  QueuedCommand as BaseQueuedCommand,
  QueuePriority,
} from '../types/textInputTypes.js'

/**
 * Official 2.1.323 (#2066): formally include optional `textNotTyped` on
 * `QueuedCommand` so picked @-mention titles/names from claude.ai / desktop
 * (tagged by `inboundMessages.ts`) propagate intact through the command queue.
 */
export type QueuedCommand = Omit<BaseQueuedCommand, 'pollEvent'> & {
  textNotTyped?: boolean
  /** Official 2.1.328 (`chunk@294254613.js:775500`): resurrect prompt if interrupted within N ms of mid-turn absorption. */
  requeueIfInterruptedWithinMs?: number
  /** Official 2.1.328: resurrected/put-back prompt runs in its own turn. */
  runsAlone?: boolean
  /** Official 2.1.328: prompt needs re-screening after resurrection. */
  screeningOwed?: boolean
  /** Official 2.1.328: waits out stop without being dropped. */
  waitsOutStop?: boolean
  /** Official 2.1.328: synthetic user-stop notice exempt from cancel_queued clearing. */
  userStopNotice?: boolean
  pollEvent?: NonNullable<BaseQueuedCommand['pollEvent']> & {
    group?: string
    startsTurn?: boolean
    settleDelivered?: () => void
  }
}
import type { PastedContent } from './config.js'
import { stripCrossSessionHopChain } from './crossSessionMessage.js'
import { logForDebugging } from './debug.js'
import { extractTextContent, isHumanLikeOrigin } from './messages.js'
import { parseAddress } from './peerAddress.js'
import {
  getOwnHopTokens,
  getPeerAdmissionGuard,
  getPeerAdmissionLimits,
} from './peerAdmission.js'
import { type PeerReceiptDropReason, sendPeerReceipt } from './peerReceipts.js'
import {
  COMMAND_LEFT_QUEUE_AS_TEXT,
  COMMAND_REMOVED_BEFORE_RUN,
  failCommandRunWaits,
  resetCommandRunWaits,
} from './processUserInput/commandRunWaits.js'
import {
  resetPromptSubmitWaits,
  settlePromptSubmitWaitsRemoved,
} from './processUserInput/promptSubmitWaits.js'
import { resetTurnHookQueuedPrompts } from './processUserInput/turnHookQueuedPrompts.js'
import { recordQueueOperation } from './sessionStorage.js'
import { registerCleanup } from './cleanupRegistry.js'
import { createSignal, type Signal } from './signal.js'
import { recordHandbackDelivery } from './subagentHandback.js'
import { getTurnAttributionKey } from './turnAttribution.js'

export type SetAppState = (f: (prev: AppState) => AppState) => void

// ============================================================================
// Logging helper (densable Qvo — session.append { door: 'queue' } writer)
// ============================================================================

export const QUEUE_RECORD_HOOK_TIMEOUT_MS = 1000

export type QueueRecordHookRunner = (
  content: string,
  hookOrigin?: unknown,
) => Promise<string> | string | undefined

let queueSessionReadyPromise: Promise<unknown> | null = null
let customQueueRecordHookRunner: QueueRecordHookRunner | null = null

/** densable `P8i` — hold queue record hooks until session load settles. */
export function setQueueSessionReadyPromise(
  promise: Promise<unknown> | null,
): void {
  if (promise === null) {
    queueSessionReadyPromise = null
    return
  }
  const clear = (): void => {
    if (queueSessionReadyPromise === promise) {
      queueSessionReadyPromise = null
    }
  }
  queueSessionReadyPromise = promise
  promise.then(clear, clear)
}

/** densable `Jvo.set` — override or clear the queue record hook runner. */
export function setQueueRecordHookRunner(
  runner: QueueRecordHookRunner | null,
): void {
  customQueueRecordHookRunner = runner
}

function defaultQueueRecordHookRunner(
  content: string,
  hookOrigin?: unknown,
): Promise<string> | undefined {
  try {
    // Lazy require avoids static cycle with functionHooksModules.ts.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fhm = require('./plugins/functionHooksModules.js') as {
      hasMatchingFunctionHook?: (
        event: string,
        matcher?: Record<string, unknown>,
      ) => boolean
      runFunctionHookChain?: (
        event: string,
        payload: Record<string, unknown>,
        tail: (input: Record<string, unknown>) => Promise<unknown>,
      ) => Promise<unknown>
    }
    if (!fhm.hasMatchingFunctionHook?.('session.append', { door: 'queue' })) {
      return undefined
    }
    if (!fhm.runFunctionHookChain) {
      return undefined
    }
    const syntheticMessage = {
      type: 'user',
      message: { role: 'user', content },
    }
    return Promise.resolve(
      fhm.runFunctionHookChain(
        'session.append',
        {
          door: 'queue',
          message: syntheticMessage,
          ...(hookOrigin !== undefined && { hookOrigin }),
        },
        async input => input.message,
      ),
    ).then(
      answered => {
        if (typeof answered === 'string') return answered
        if (answered && typeof answered === 'object') {
          const msgObj =
            'message' in answered &&
            answered.message &&
            typeof answered.message === 'object'
              ? (answered.message as { content?: unknown })
              : (answered as { content?: unknown })
          const rawContent =
            'message' in (msgObj as Record<string, unknown>) &&
            (msgObj as { message?: { content?: unknown } }).message
              ? (msgObj as { message: { content?: unknown } }).message.content
              : msgObj.content
          if (typeof rawContent === 'string') return rawContent
          if (Array.isArray(rawContent)) {
            return extractTextContent(rawContent)
          }
        }
        return content
      },
      () => content,
    )
  } catch {
    return undefined
  }
}

function logQueueRecordError(err: unknown): void {
  try {
    if (err instanceof Error && err.name === 'AbortError') {
      logForDebugging("A queue record's chain was aborted")
      return
    }
    logForDebugging(
      `A queue record failed: ${err instanceof Error ? err.message : String(err)}`,
      { level: 'warn' },
    )
  } catch {
    logForDebugging('A queue record failed with an unreadable error')
  }
}

/**
 * densable `Qvo(e)` — wraps `insertQueueOperation` / `recordQueueOperation`
 * with FIFO ordering, `session.append` `{ door: 'queue' }` rewrite, and a
 * 1000ms `.unref()` timeout fallback so disk persistence never stalls.
 */
export function createQueueRecordWriter(
  writeRecord: (record: QueueOperationMessage) => void,
  options?: { timeoutMs?: number },
): (record: QueueOperationMessage, hookOrigin?: unknown) => void {
  const timeoutMs = options?.timeoutMs ?? QUEUE_RECORD_HOOK_TIMEOUT_MS
  const queue: QueueOperationMessage[] = []
  const inFlight = new Map<
    QueueOperationMessage,
    ReturnType<typeof setTimeout>
  >()
  const waitingReady = new Map<QueueOperationMessage, () => boolean>()
  let cleanupRegistered = false
  let isClosed = false

  function flushHead(): void {
    let head = queue[0]
    while (
      head !== undefined &&
      !inFlight.has(head) &&
      !waitingReady.has(head)
    ) {
      queue.shift()
      try {
        writeRecord(head)
      } catch (err) {
        logQueueRecordError(err)
      }
      head = queue[0]
    }
  }

  function drainWaiting(settledPromise?: Promise<unknown>): void {
    const current = queueSessionReadyPromise
    const ready = current === null || current === settledPromise
    for (const [rec, start] of ready ? waitingReady : []) {
      waitingReady.delete(rec)
      try {
        if (start()) break
      } catch (err) {
        logQueueRecordError(err)
      }
    }
    flushHead()
  }

  function settleRecord(
    orig: QueueOperationMessage,
    updated: QueueOperationMessage,
  ): void {
    const timer = inFlight.get(orig)
    if (timer === undefined) return
    clearTimeout(timer)
    inFlight.delete(orig)
    const idx = queue.indexOf(orig)
    if (idx !== -1) {
      queue[idx] = updated
    }
    drainWaiting()
  }

  function closeWriter(): void {
    isClosed = true
    for (const timer of inFlight.values()) {
      clearTimeout(timer)
    }
    inFlight.clear()
    waitingReady.clear()
    flushHead()
  }

  function ensureCleanup(): void {
    if (!cleanupRegistered) {
      cleanupRegistered = true
      registerCleanup(async () => {
        closeWriter()
      })
    }
  }

  function startHook(
    record: QueueOperationMessage,
    content: string,
    hookOrigin?: unknown,
  ): boolean {
    const runner = customQueueRecordHookRunner ?? defaultQueueRecordHookRunner
    const result = runner(content, hookOrigin)
    if (result === undefined) return false
    ensureCleanup()
    const timer = setTimeout(settleRecord, timeoutMs, record, record)
    timer.unref?.()
    inFlight.set(record, timer)
    Promise.resolve(result).then(
      rewritten => {
        if (typeof rewritten === 'string') {
          settleRecord(record, { ...record, content: rewritten })
          return
        }
        logQueueRecordError(
          new Error('A queue record came back from its hooks no text'),
        )
        settleRecord(record, record)
      },
      err => {
        logQueueRecordError(err)
        settleRecord(record, record)
      },
    )
    return true
  }

  return (record: QueueOperationMessage, hookOrigin?: unknown): void => {
    const { content } = record
    const canHook = typeof content === 'string' && !isClosed
    const ready = queueSessionReadyPromise
    if (canHook && (ready !== null || waitingReady.size > 0)) {
      queue.push(record)
      waitingReady.set(record, () => startHook(record, content, hookOrigin))
      ensureCleanup()
      if (ready !== null && waitingReady.size === 1) {
        ready.then(
          () => drainWaiting(ready),
          () => drainWaiting(ready),
        )
      }
      return
    }
    let started = false
    try {
      started = canHook && startHook(record, content, hookOrigin)
    } catch (err) {
      logQueueRecordError(err)
      queue.push(record)
      flushHead()
      return
    }
    if (!started && queue.length === 0) {
      writeRecord(record)
      return
    }
    queue.push(record)
  }
}

const defaultQueueRecordWriter = createQueueRecordWriter(queueOp => {
  void recordQueueOperation(queueOp)
})

function logOperation(operation: QueueOperation, content?: string): void {
  const sessionId = getSessionId()
  const queueOp: QueueOperationMessage = {
    type: 'queue-operation',
    operation,
    timestamp: new Date().toISOString(),
    sessionId,
    ...(content !== undefined && { content }),
  }
  defaultQueueRecordWriter(queueOp)
}

// ============================================================================
// Unified command queue (instantiable MessageQueueInstance + default active)
//
// All commands — user input, task notifications, orphaned permissions — go
// through a queue instance. React components subscribe via
// useSyncExternalStore (queue.subscribe / queue.getSnapshot, or
// subscribeToCommandQueue / getCommandQueueSnapshot).
// Non-React code (print.ts streaming loop) reads directly via
// getCommandQueue() / getCommandQueueLength() on the active instance.
//
// Priority determines dequeue order: 'now' > 'next' > 'later'.
// Within the same priority, commands are processed FIFO.
// ============================================================================

const CANCEL_PENDING_CAP = 256

/**
 * Instantiable command queue (official `MessageQueueInstance` / `zVe` value).
 * Encapsulates the queue array, frozen snapshot, change/event signals,
 * in-flight drain batch, cancel-pending tracking, and fold-in-flight state.
 */
export class MessageQueueInstance {
  private readonly commandQueue: QueuedCommand[] = []
  /** Official 2.1.328 (`k`): commands held until current turn finishes. */
  private readonly queuedAfterTurn: QueuedCommand[] = []
  /** Frozen snapshot — recreated on every mutation for useSyncExternalStore. */
  private snapshot: readonly QueuedCommand[] = Object.freeze([])
  private readonly queueChanged = createSignal()
  /** densable `Ibe().commandsConsumed` / `$X`. */
  private readonly commandsConsumed = createSignal<[QueuedCommand[]]>()
  /** densable `Ibe().commandsDiscarded` / `Ept`. */
  private readonly commandsDiscarded = createSignal<[QueuedCommand[]]>()

  /**
   * Official Ntl `w` / Cuy — commands already dequeued but still executing.
   * Esc restore must see this so a queued turn is not treated as "user moved on".
   */
  private inFlightDrainBatch: QueuedCommand[] | null = null

  /**
   * densable print Kc cancel-pending (`he`/`ye`/`ke`/`Se`). Cap 256.
   * Never export minify he|ye|ke|Se.
   */
  private readonly cancelPending = new Set<string>()
  private readonly cancelPendingAcked = new Set<string>()

  /**
   * densable `ve` — uuids whose mid-turn fold is in flight. `yt` refuses these.
   */
  private readonly foldInFlight = new Set<string>()
  /** densable `qe` — mid-turn fold suspended. `Ft` is `qe` (gold also ORs `Mr()`). */
  private midTurnFoldSuspended = false
  /** Official 2.1.328 — active Poll tool calls keyed by agentId (or '__main__'). */
  private readonly activePollCalls = new Set<string>()
  /** Official 2.1.328 (`xe`) — active holdBack predicate and marked commands. */
  private activeHold:
    | {
        holds: (cmd: QueuedCommand) => boolean
        marked: Set<QueuedCommand>
      }
    | undefined = undefined
  /** Official 2.1.328 (`ts`) — clock source for interrupt requeue window. */
  private readonly nowFn: () => number
  /** Official 2.1.328 (`Zi`) — last mid-turn absorbed prompt eligible for interrupt requeue. */
  private requeueCandidate:
    | {
        uuid: string | undefined
        cmd: QueuedCommand
        withinMs: number | undefined
        until: number | undefined
      }
    | undefined = undefined
  /** Official 2.1.328 (`Ol`) — UUIDs resurrected via requeueTaken(). */
  private readonly putBackUuids = new Set<string>()

  constructor(opts?: { now?: () => number }) {
    this.nowFn =
      opts?.now ??
      (() => Math.max(performance.timeOrigin + performance.now(), Date.now()))
  }

  private applyHoldBack(cmd: QueuedCommand): boolean {
    if (
      this.activeHold === undefined ||
      cmd.passive === true ||
      !this.activeHold.holds(cmd)
    ) {
      return false
    }
    cmd.passive = true
    this.activeHold.marked.add(cmd)
    return true
  }

  /**
   * Subscribe to command queue changes.
   * Compatible with React's useSyncExternalStore.
   */
  readonly subscribe = (listener: () => void): (() => void) =>
    this.queueChanged.subscribe(listener)

  readonly subscribeCommandsConsumed = (
    listener: (commands: QueuedCommand[]) => void,
  ): (() => void) => this.commandsConsumed.subscribe(listener)

  readonly subscribeCommandsDiscarded = (
    listener: (commands: QueuedCommand[]) => void,
  ): (() => void) => this.commandsDiscarded.subscribe(listener)

  /**
   * Get current snapshot of the command queue.
   * Compatible with React's useSyncExternalStore.
   * Returns a frozen array that only changes reference on mutation.
   */
  readonly getSnapshot = (): readonly QueuedCommand[] => this.snapshot

  private notifySubscribers(): void {
    this.snapshot = Object.freeze([...this.commandQueue])
    this.queueChanged.emit()
  }

  getCommands(): QueuedCommand[] {
    return [...this.commandQueue]
  }

  getLength(): number {
    return this.commandQueue.length
  }

  getMainThreadLength(): number {
    let n = 0
    for (const cmd of this.commandQueue) {
      if (isMainThreadQueuedCommand(cmd)) n++
    }
    return n
  }

  hasCommands(): boolean {
    return this.commandQueue.length > 0
  }

  hasEditableCommands(): boolean {
    return this.commandQueue.some(isQueuedCommandEditable)
  }

  recheck(): void {
    if (this.commandQueue.length > 0) {
      this.notifySubscribers()
    }
  }

  countQueuedPeerMessages(): number {
    let n = 0
    for (const cmd of this.commandQueue) {
      if (isCrossSessionPeerOrigin(cmd.origin as PeerQueueOrigin | undefined)) {
        n++
      }
    }
    return n
  }

  private admitReportingCommand(
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
      this.countQueuedPeerMessages() >=
      getPeerAdmissionLimits().maxQueuedPeerMessages
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

  enqueueReportingAdmission(
    command: QueuedCommand,
    opts: EnqueueReportingAdmissionOpts = {},
  ): ReportingAdmissionResult {
    const admitted = this.admitReportingCommand(
      command,
      opts.receipt ?? 'coalesced',
    )
    if (!admitted.admitted) return admitted

    const stamped = withMainThreadAgentId(stripPeerCommandHopChain(command))
    const queued: QueuedCommand = {
      ...stamped,
      priority: stamped.priority ?? 'next',
    }
    this.applyHoldBack(queued)
    if (opts.ahead) this.commandQueue.unshift(queued)
    else this.commandQueue.push(queued)

    const origin = command.origin as PeerQueueOrigin | undefined
    if (
      origin?.kind === 'peer' &&
      origin.handback === true &&
      origin.senderTaskId !== undefined &&
      (command as { admissionExempt?: string }).admissionExempt !==
        'resurrected'
    ) {
      recordHandbackDelivery(
        origin.senderTaskId,
        String(command.agentId ?? ''),
        {
          flagged: origin.flagged === true,
        },
      )
    }

    this.notifySubscribers()
    if (!(command as { unlogged?: boolean }).unlogged) {
      logOperation(
        'enqueue',
        typeof stamped.value === 'string' ? stamped.value : undefined,
      )
    }
    return { admitted: true }
  }

  enqueue(command: QueuedCommand): void {
    this.enqueueReportingAdmission(command)
  }

  registerFoldInFlight(commands: Array<{ uuid?: string }>): void {
    for (const cmd of commands) {
      if (cmd.uuid !== undefined) this.foldInFlight.add(cmd.uuid)
    }
  }

  unregisterFoldInFlight(commands: Array<{ uuid?: string }>): void {
    for (const cmd of commands) {
      if (cmd.uuid !== undefined) this.foldInFlight.delete(cmd.uuid)
    }
  }

  isFoldInFlight(uuid: string): boolean {
    return this.foldInFlight.has(uuid)
  }

  suspendMidTurnFold(): void {
    if (this.midTurnFoldSuspended) return
    this.midTurnFoldSuspended = true
    this.notifySubscribers()
  }

  isMidTurnFoldSuspended(): boolean {
    const { isShutdownCommitted } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./shutdownCommitted.js') as typeof import('./shutdownCommitted.js')
    return this.midTurnFoldSuspended || isShutdownCommitted()
  }

  promoteToNow(uuid: string): boolean {
    const cmd = this.commandQueue.find(row => row.uuid === uuid)
    if (
      cmd === undefined ||
      cmd.priority === 'now' ||
      this.foldInFlight.has(uuid)
    ) {
      return false
    }
    cmd.priority = 'now'
    this.notifySubscribers()
    return true
  }

  demoteFromNow(uuid: string, raisedFrom: QueuePriority): boolean {
    const cmd = this.commandQueue.find(row => row.uuid === uuid)
    if (cmd === undefined || cmd.priority !== 'now') return false
    cmd.priority = raisedFrom
    this.notifySubscribers()
    return true
  }

  promoteMainThreadQueueToNow(): number {
    let n = 0
    for (const cmd of this.commandQueue) {
      if (!isMainThreadQueuedCommand(cmd)) continue
      if (cmd.uuid !== undefined) {
        if (this.promoteToNow(cmd.uuid)) n++
        continue
      }
      if (cmd.priority === 'now') continue
      cmd.priority = 'now'
      n++
    }
    if (n > 0) this.notifySubscribers()
    return n
  }

  enqueuePendingNotification(
    command: QueuedCommand,
    opts?: { turnAttribution?: 'inherit' | 'none' },
  ): void {
    if (!this.admitReportingCommand(command).admitted) return

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
    const inherit = opts?.turnAttribution === 'inherit'
    if (inherit && queued.mode === 'task-notification') {
      const origin = queued.origin
      if (origin === undefined || origin.kind === 'task-notification') {
        queued = {
          ...queued,
          origin: {
            ...(origin ?? { kind: 'task-notification' }),
            producer: 'session-task',
          },
        }
      }
    }
    const inheritedKey =
      queued.inheritedTurnAttributionKey ??
      (inherit && queued.mode === 'task-notification'
        ? getTurnAttributionKey()
        : undefined)
    const stamped = withMainThreadAgentId(stripPeerCommandHopChain(queued))
    const entry: QueuedCommand = {
      ...stamped,
      priority: stamped.priority ?? 'later',
      ...(inheritedKey !== undefined
        ? { inheritedTurnAttributionKey: inheritedKey }
        : {}),
    }
    this.applyHoldBack(entry)
    this.commandQueue.push(entry)
    this.notifySubscribers()
    if (!(command as { unlogged?: boolean }).unlogged) {
      logOperation(
        'enqueue',
        typeof stamped.value === 'string' ? stamped.value : undefined,
      )
    }
  }

  dequeue(filter?: (cmd: QueuedCommand) => boolean): QueuedCommand | undefined {
    if (this.commandQueue.length === 0) {
      return undefined
    }

    // Find the first command with the highest priority (respecting filter)
    let bestIdx = -1
    let bestPriority = Infinity
    for (let i = 0; i < this.commandQueue.length; i++) {
      const cmd = this.commandQueue[i]!
      if (filter && !filter(cmd)) continue
      const priority = PRIORITY_ORDER[cmd.priority ?? 'next']
      if (priority < bestPriority) {
        bestIdx = i
        bestPriority = priority
      }
    }

    if (bestIdx === -1) return undefined

    const [dequeued] = this.commandQueue.splice(bestIdx, 1)
    this.notifySubscribers()
    logOperation('dequeue')
    return dequeued
  }

  dequeueAll(): QueuedCommand[] {
    if (this.commandQueue.length === 0) {
      return []
    }

    const commands = [...this.commandQueue]
    this.commandQueue.length = 0
    this.notifySubscribers()

    for (const _cmd of commands) {
      logOperation('dequeue')
    }

    return commands
  }

  peek(filter?: (cmd: QueuedCommand) => boolean): QueuedCommand | undefined {
    if (this.commandQueue.length === 0) {
      return undefined
    }
    let bestIdx = -1
    let bestPriority = Infinity
    for (let i = 0; i < this.commandQueue.length; i++) {
      const cmd = this.commandQueue[i]!
      if (filter && !filter(cmd)) continue
      const priority = PRIORITY_ORDER[cmd.priority ?? 'next']
      if (priority < bestPriority) {
        bestIdx = i
        bestPriority = priority
      }
    }
    if (bestIdx === -1) return undefined
    return this.commandQueue[bestIdx]
  }

  settleScreening(
    uuid: string,
    update:
      | { dropped: true }
      | {
          promptSubmitted?: QueuedCommand['promptSubmitted']
          drainOnly?: boolean
        },
  ): boolean {
    const command = this.commandQueue.find(
      cmd => cmd.uuid === uuid && cmd.screeningPending === true,
    )
    if (command === undefined) return false
    if ('dropped' in update) {
      this.remove([command])
      return true
    }
    delete command.screeningPending
    command.promptSubmitted = update.promptSubmitted
    command.drainOnly = update.drainOnly
    this.notifySubscribers()
    return true
  }

  dequeueAllMatching(
    predicate: (cmd: QueuedCommand) => boolean,
  ): QueuedCommand[] {
    const matched: QueuedCommand[] = []
    const remaining: QueuedCommand[] = []
    for (const cmd of this.commandQueue) {
      if (predicate(cmd)) {
        matched.push(cmd)
      } else {
        remaining.push(cmd)
      }
    }
    if (matched.length === 0) {
      return []
    }
    this.commandQueue.length = 0
    this.commandQueue.push(...remaining)
    this.notifySubscribers()
    for (const _cmd of matched) {
      logOperation('dequeue')
    }
    return matched
  }

  private spliceQueuedCommands(
    commandsToRemove: QueuedCommand[],
  ): QueuedCommand[] {
    if (commandsToRemove.length === 0) return []
    const removed: QueuedCommand[] = []
    for (let i = this.commandQueue.length - 1; i >= 0; i--) {
      if (commandsToRemove.includes(this.commandQueue[i]!)) {
        removed.unshift(this.commandQueue.splice(i, 1)[0]!)
      }
    }
    if (removed.length > 0) {
      this.notifySubscribers()
    }
    return removed
  }

  remove(commandsToRemove: QueuedCommand[]): void {
    if (commandsToRemove.length === 0) {
      return
    }

    this.spliceQueuedCommands(commandsToRemove)
    settlePromptSubmitWaitsRemoved(commandsToRemove)
    failCommandRunWaits(commandsToRemove, COMMAND_REMOVED_BEFORE_RUN)
    this.commandsDiscarded.emit(commandsToRemove)
    for (const _cmd of commandsToRemove) {
      logOperation('remove')
    }
  }

  consume(
    commandsToConsume: QueuedCommand[],
    opts?: { reason?: string },
  ): void {
    if (commandsToConsume.length === 0) {
      return
    }
    if (opts?.reason !== undefined) {
      logForDebugging(`consume: ${opts.reason}`)
    }

    const removed = this.spliceQueuedCommands(commandsToConsume)
    failCommandRunWaits(commandsToConsume, COMMAND_LEFT_QUEUE_AS_TEXT)
    this.commandsConsumed.emit(commandsToConsume)
    for (const _cmd of commandsToConsume) {
      logOperation('remove')
    }
    // Official 2.1.328 (`chunk@294254613.js:775500` `Ai`): record the last
    // mid-turn absorbed main-thread prompt so an interrupt within its requeue
    // window can resurrect it into its own turn.
    if (opts?.reason === 'absorbed_mid_turn') {
      for (const cmd of removed) {
        if (cmd.mode !== 'prompt' || !isMainThreadQueuedCommand(cmd)) continue
        const uuid = cmd.uuid
        const withinMs =
          uuid !== undefined &&
          cmd.shouldQuery !== false &&
          cmd.passive !== true &&
          !this.cancelPending.has(uuid)
            ? cmd.requeueIfInterruptedWithinMs
            : undefined
        if (withinMs !== undefined || this.requeueCandidate !== undefined) {
          this.requeueCandidate = { uuid, cmd, withinMs, until: undefined }
        }
      }
    }
  }

  /** Official 2.1.328 (`va`): arm the deadline on the last absorbed prompt. */
  startRequeueWindow(): void {
    if (this.requeueCandidate?.withinMs !== undefined) {
      this.requeueCandidate.until ??=
        this.nowFn() + this.requeueCandidate.withinMs
    }
  }

  /** Official 2.1.328 (`Xl`): close the requeue window; clear putBack set on turn end. */
  settleTaken({ turnEnded = false }: { turnEnded?: boolean } = {}): void {
    this.requeueCandidate = undefined
    if (turnEnded) {
      this.putBackUuids.clear()
    }
  }

  /** Official 2.1.328 (`Ja`): permanently cancel resurrection eligibility for uuid. */
  forgoRequeue(uuid: string): void {
    if (this.requeueCandidate?.uuid === uuid) {
      this.requeueCandidate.withinMs = undefined
    }
    for (const cmd of this.commandQueue) {
      if (cmd.uuid === uuid) {
        delete cmd.requeueIfInterruptedWithinMs
      }
    }
  }

  /**
   * Official 2.1.328 (`Ia`): if the last mid-turn absorbed prompt is still
   * within its interrupt requeue window, re-enqueue it ahead as a standalone
   * resurrected prompt (`drainOnly`, `runsAlone`, `admissionExempt: 'resurrected'`).
   */
  requeueTaken(): QueuedCommand | undefined {
    const taken = this.requeueCandidate
    this.requeueCandidate = undefined
    if (
      taken?.uuid === undefined ||
      taken.withinMs === undefined ||
      (taken.until !== undefined && this.nowFn() > taken.until)
    ) {
      return undefined
    }
    const {
      requeueIfInterruptedWithinMs: _withinMs,
      promptSubmitted,
      attachmentSourceUuid: _srcUuid,
      deliveryId: _deliveryId,
      ...rest
    } = taken.cmd
    this.putBackUuids.add(taken.uuid)
    this.foldInFlight.delete(taken.uuid)
    this.enqueueReportingAdmission(
      {
        ...rest,
        drainOnly: true,
        runsAlone: true,
        admissionExempt: 'resurrected',
        ...(promptSubmitted !== undefined ? { screeningOwed: true } : {}),
      },
      { ahead: true },
    )
    return taken.cmd
  }

  /** Official 2.1.328 (`Fa`): whether uuid was put back via requeueTaken(). */
  wasPutBack(uuid: string): boolean {
    return this.putBackUuids.has(uuid)
  }

  /** Official 2.1.328 (`il`): fate of a folded copy ('drop' | 'wait' | 'keep'). */
  foldCopyFate(uuid: string): 'drop' | 'wait' | 'keep' {
    if (this.putBackUuids.has(uuid)) return 'drop'
    if (
      this.foldInFlight.has(uuid) &&
      this.commandQueue.some(
        cmd =>
          cmd.uuid === uuid && cmd.requeueIfInterruptedWithinMs !== undefined,
      )
    ) {
      return 'wait'
    }
    return this.requeueCandidate?.uuid === uuid &&
      this.requeueCandidate.withinMs !== undefined &&
      (this.requeueCandidate.until === undefined ||
        this.nowFn() <= this.requeueCandidate.until)
      ? 'wait'
      : 'keep'
  }

  /** Official 2.1.328 (`Cu`): once the folded copy is written, forgo requeue. */
  foldCopyWritten(uuid: string): void {
    if (this.requeueCandidate?.uuid === uuid || this.foldInFlight.has(uuid)) {
      this.forgoRequeue(uuid)
    }
  }

  /** Official 2.1.328 (`Md`): remaining ms in the armed requeue window. */
  requeueWindowLeftMs(): number | undefined {
    if (
      this.requeueCandidate?.withinMs !== undefined &&
      this.requeueCandidate.until !== undefined &&
      this.nowFn() <= this.requeueCandidate.until
    ) {
      return this.requeueCandidate.until - this.nowFn()
    }
    return undefined
  }

  /**
   * Official 2.1.328 (`$e` in `chunk@294254613.js:760000`): mark matching queued
   * commands (and matching future enqueues) passive until the returned release
   * function is invoked.
   */
  holdBack(holds: (cmd: QueuedCommand) => boolean): () => number {
    if (this.activeHold !== undefined) {
      throw new Error(
        'holdBack: this message queue already has a hold; end it with the function the first call returned before setting another',
      )
    }
    const hold = { holds, marked: new Set<QueuedCommand>() }
    this.activeHold = hold
    try {
      let markedCount = 0
      for (const cmd of this.commandQueue) {
        if (this.applyHoldBack(cmd)) markedCount++
      }
      if (markedCount > 0) this.notifySubscribers()
    } catch (err) {
      if (this.activeHold === hold) this.activeHold = undefined
      for (const cmd of hold.marked) delete cmd.passive
      throw err
    }
    return () => {
      if (this.activeHold !== hold) return 0
      this.activeHold = undefined
      const held = this.commandQueue.filter(cmd => hold.marked.has(cmd))
      if (held.length === 0) return 0
      const remaining = this.commandQueue.filter(cmd => !hold.marked.has(cmd))
      for (const cmd of held) delete cmd.passive
      this.commandQueue.length = 0
      this.commandQueue.push(...remaining, ...held)
      this.notifySubscribers()
      return held.length
    }
  }

  /** Official 2.1.328 (`Le`): release a subset of currently held-back commands. */
  letHeldBackGo(pred: (cmd: QueuedCommand) => boolean): number {
    const marked = this.activeHold?.marked
    if (!marked) return 0
    const released = this.commandQueue.filter(
      cmd => marked.has(cmd) && pred(cmd),
    )
    for (const cmd of released) {
      delete cmd.passive
      marked.delete(cmd)
    }
    if (released.length > 0) this.notifySubscribers()
    return released.length
  }

  /** Official 2.1.328 (`ys`): stage a command to be enqueued ahead once the turn ends. */
  queueAfterTurn(cmd: QueuedCommand): void {
    this.queuedAfterTurn.push(cmd)
  }

  /**
   * Official 2.1.328 (`Hi`): release staged post-turn commands ahead in FIFO order
   * unless a `'now'` priority command is already waiting in the queue.
   */
  releaseQueuedAfterTurn(): void {
    const staged = this.queuedAfterTurn.splice(0)
    if (
      staged.length > 0 &&
      this.commandQueue.some(cmd => cmd.priority === 'now')
    ) {
      logForDebugging(
        `releaseQueuedAfterTurn: dropped ${staged.length}, a 'now' command waits`,
      )
      return
    }
    for (const cmd of staged.reverse()) {
      this.enqueueReportingAdmission(cmd, { ahead: true })
    }
  }

  removeByFilter(predicate: (cmd: QueuedCommand) => boolean): QueuedCommand[] {
    const removed: QueuedCommand[] = []
    for (let i = this.commandQueue.length - 1; i >= 0; i--) {
      if (predicate(this.commandQueue[i]!)) {
        removed.unshift(this.commandQueue.splice(i, 1)[0]!)
      }
    }

    if (removed.length > 0) {
      this.notifySubscribers()
      settlePromptSubmitWaitsRemoved(removed)
      failCommandRunWaits(removed, COMMAND_REMOVED_BEFORE_RUN)
      this.commandsDiscarded.emit(removed)
      for (const _cmd of removed) {
        logOperation('remove')
      }
    }

    return removed
  }

  clear(): void {
    if (this.commandQueue.length === 0) {
      return
    }
    const discarded = [...this.commandQueue]
    settlePromptSubmitWaitsRemoved(discarded)
    failCommandRunWaits(discarded, COMMAND_REMOVED_BEFORE_RUN)
    this.commandsDiscarded.emit(discarded)
    this.commandQueue.length = 0
    this.notifySubscribers()
  }

  reset(): void {
    this.commandQueue.length = 0
    this.queuedAfterTurn.length = 0
    this.snapshot = Object.freeze([])
    this.inFlightDrainBatch = null
    this.cancelPending.clear()
    this.cancelPendingAcked.clear()
    this.foldInFlight.clear()
    this.midTurnFoldSuspended = false
    this.activePollCalls.clear()
    this.activeHold = undefined
    this.requeueCandidate = undefined
    this.putBackUuids.clear()
    this.commandsConsumed.clear()
    this.commandsDiscarded.clear()
  }

  markCancelPending(
    uuid: string,
    opts?: { terminalEmitted?: boolean },
  ): boolean {
    if (this.cancelPending.delete(uuid)) {
      this.cancelPending.add(uuid)
    } else {
      if (
        opts?.terminalEmitted !== true &&
        this.cancelPending.size >= CANCEL_PENDING_CAP
      ) {
        let evict: string | undefined
        for (const id of this.cancelPending) {
          if (!this.cancelPendingAcked.has(id)) {
            evict = id
            break
          }
        }
        if (evict !== undefined) this.cancelPending.delete(evict)
      }
      this.cancelPending.add(uuid)
    }
    if (opts?.terminalEmitted !== true) return false
    if (this.cancelPendingAcked.has(uuid)) return false
    this.cancelPendingAcked.add(uuid)
    return true
  }

  consumeCancelPending(uuid: string): boolean {
    return this.cancelPending.delete(uuid)
  }

  consumeCancelPendingAcked(uuid: string): boolean {
    return this.cancelPendingAcked.delete(uuid)
  }

  hasCancelPendingAcked(uuid: string): boolean {
    return this.cancelPendingAcked.has(uuid)
  }

  setInFlightDrainBatch(batch: QueuedCommand[]): void {
    this.inFlightDrainBatch = batch
  }

  clearInFlightDrainBatch(batch?: QueuedCommand[]): void {
    if (batch === undefined || this.inFlightDrainBatch === batch) {
      this.inFlightDrainBatch = null
    }
  }

  someInFlightDrainCommand(pred?: (cmd: QueuedCommand) => boolean): boolean {
    if (this.inFlightDrainBatch === null) return false
    if (pred === undefined) return this.inFlightDrainBatch.length > 0
    return this.inFlightDrainBatch.some(pred)
  }

  hasPoppableEditableCommands(inputEmpty: boolean): boolean {
    return this.commandQueue.some(cmd =>
      isPoppableEditableCommand(cmd, inputEmpty),
    )
  }

  popAllEditable(
    currentInput: string,
    currentCursorOffset: number,
    currentPastedContents: Record<number, PastedContent> = {},
  ): PopAllEditableResult | undefined {
    if (this.commandQueue.length === 0) {
      return undefined
    }

    const inputEmpty = currentInput === ''
    const candidates = this.commandQueue.filter(cmd =>
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
      mode === 'bash'
        ? candidates
        : candidates.filter(cmd => cmd.mode !== 'bash')
    if (editable.length === 0) {
      return undefined
    }

    // Official 2.1.328 (`chunk@294254613.js:777500` `Bc`/`nu`/`KPt`/`Wnt`):
    // prefer `preExpansionValue` when present, remap colliding paste IDs, and
    // avoid off-by-1 cursorOffset when `currentInput === ''`.
    const remapped = remapEditablePasteIds(
      editable,
      currentInput,
      currentPastedContents,
    )
    const images: PastedContent[] = []
    let nextImageId = Date.now()
    const pulledTexts: string[] = []
    for (let i = 0; i < editable.length; i++) {
      const cmd = editable[i]!
      const slot = remapped[i]!
      pulledTexts.push(slot.text)
      images.push(...slot.entries)
      // Bridge/remote commands may embed images directly in ContentBlockParam[].
      const cmdImages = extractImagesFromValue(cmd.value, nextImageId)
      images.push(...cmdImages)
      nextImageId += cmdImages.length
    }
    const pulledJoined = pulledTexts.filter(Boolean).join('\n')
    const { text: newInput, cursorOffset } = joinPulledWithDraft(
      pulledJoined,
      currentInput,
      currentCursorOffset,
    )

    for (const command of editable) {
      logOperation(
        'popAll',
        typeof command.value === 'string' ? command.value : undefined,
      )
      // Official 2.1.295 (#424): keep pulled-back queued messages in prompt
      // history (with armUndo: false) so they aren't lost after ← + ↑/Esc.
      const text = extractEditableText(command)
      if (text) {
        const display = command.mode === 'bash' ? `!${text}` : text
        addToHistory(
          { display, pastedContents: command.pastedContents ?? {} },
          { armUndo: false },
        )
      }
    }

    // densable: keep commands not in Ft (incl. bash left behind on prompt restore)
    const popped = new Set(editable)
    const remaining = this.commandQueue.filter(cmd => !popped.has(cmd))
    this.commandQueue.length = 0
    this.commandQueue.push(...remaining)
    this.notifySubscribers()
    settlePromptSubmitWaitsRemoved(editable)

    const ideSelection = editable.findLast(
      cmd => cmd.ideSelection !== undefined,
    )?.ideSelection
    const textNotTyped = editable.some(cmd => cmd.textNotTyped === true)
    return {
      text: newInput,
      cursorOffset,
      images,
      mode,
      ideSelection,
      ...(textNotTyped ? { textNotTyped: true } : {}),
    }
  }

  popEditableAt(
    index: number,
    currentInput: string,
    currentCursorOffset: number,
    currentPastedContents: Record<number, PastedContent> = {},
  ): PopEditableAtResult | undefined {
    const cmd = this.commandQueue.filter(isQueuedCommandEditable)[index]
    if (!cmd) {
      return undefined
    }
    if (!isPoppableEditableCommand(cmd, currentInput === '')) {
      return undefined
    }

    const [slot] = remapEditablePasteIds(
      [cmd],
      currentInput,
      currentPastedContents,
    )
    const pulledText = slot!.text
    const { text: newInput, cursorOffset } = joinPulledWithDraft(
      pulledText,
      currentInput,
      currentCursorOffset,
    )

    const images: PastedContent[] = [
      ...slot!.entries,
      ...extractImagesFromValue(cmd.value, Date.now()),
    ]

    logOperation(
      'popOne',
      typeof cmd.value === 'string' ? cmd.value : undefined,
    )
    const historyText = extractEditableText(cmd)
    if (historyText) {
      const display = cmd.mode === 'bash' ? `!${historyText}` : historyText
      addToHistory(
        { display, pastedContents: cmd.pastedContents ?? {} },
        { armUndo: false },
      )
    }

    const gr = this.commandQueue.indexOf(cmd)
    if (gr !== -1) {
      this.commandQueue.splice(gr, 1)
      this.notifySubscribers()
      settlePromptSubmitWaitsRemoved([cmd])
    }

    return {
      text: newInput,
      cursorOffset,
      images,
      mode: cmd.mode === 'bash' ? 'bash' : 'prompt',
      ideSelection: cmd.ideSelection,
      ...(cmd.textNotTyped === true ? { textNotTyped: true } : {}),
    }
  }

  getCommandsByMaxPriority(maxPriority: QueuePriority): QueuedCommand[] {
    const threshold = PRIORITY_ORDER[maxPriority]
    return this.commandQueue.filter(
      cmd => PRIORITY_ORDER[cmd.priority ?? 'next'] <= threshold,
    )
  }

  countRemainingWakePollEventsAfter(taken: readonly QueuedCommand[]): number {
    const takenSet = new Set(taken)
    const agentId = taken.find(cmd => cmd.mode === 'poll-event')?.agentId
    return this.commandQueue.filter(
      cmd =>
        cmd.mode === 'poll-event' &&
        cmd.pollEvent?.wake === true &&
        !takenSet.has(cmd) &&
        (agentId === undefined || cmd.agentId === agentId),
    ).length
  }

  /**
   * Official 2.1.328 `tryBeginPollCall` — prevents duplicate concurrent Poll
   * calls per thread/agent.
   */
  tryBeginPollCall(agentId?: string): boolean {
    const key = agentId ?? '__main__'
    if (this.activePollCalls.has(key)) {
      return false
    }
    this.activePollCalls.add(key)
    return true
  }

  /** Official 2.1.328 `endPollCall` — releases the active Poll call guard. */
  endPollCall(agentId?: string): void {
    const key = agentId ?? '__main__'
    this.activePollCalls.delete(key)
  }

  /**
   * Official 2.1.328 `drainPollEventChunk` (`Iir`) — drains up to
   * `POLL_CHUNK_MAX_EVENTS` (20) events / `POLL_CHUNK_MAX_BYTES` (32KB),
   * keeping consecutive events with the same `pollEvent.group` together, and
   * returns the remaining wake poll-event count for the same thread/agent.
   */
  drainPollEventChunk(agentId?: string): {
    commands: QueuedCommand[]
    remainingWakeCount: number
  } {
    const matchesTarget = (cmd: QueuedCommand): boolean =>
      cmd.mode === 'poll-event' &&
      (agentId === undefined
        ? isMainThreadQueuedCommand(cmd)
        : cmd.agentId === agentId)

    const matching = this.commandQueue.filter(matchesTarget)
    if (matching.length === 0) {
      return { commands: [], remainingWakeCount: 0 }
    }

    const chunk: QueuedCommand[] = []
    let bytes = 0
    for (let i = 0; i < matching.length; ) {
      const groupId = matching[i]!.pollEvent?.group
      let end = i + 1
      while (
        groupId !== undefined &&
        end < matching.length &&
        matching[end]!.pollEvent?.group === groupId
      ) {
        end++
      }
      const group = matching.slice(i, end)
      const groupBytes = group.reduce((sum, cmd) => {
        const envBytes = Buffer.byteLength(
          cmd.pollEvent?.envelope ?? '',
          'utf8',
        )
        return sum + envBytes
      }, 0)
      if (
        chunk.length > 0 &&
        (chunk.length + group.length > POLL_CHUNK_MAX_EVENTS ||
          bytes + groupBytes > POLL_CHUNK_MAX_BYTES)
      ) {
        break
      }
      chunk.push(...group)
      bytes += groupBytes
      i = end
    }

    const takenSet = new Set(chunk)
    const remaining = this.commandQueue.filter(cmd => !takenSet.has(cmd))
    this.commandQueue.length = 0
    this.commandQueue.push(...remaining)
    this.notifySubscribers()

    const remainingWakeCount = this.commandQueue.filter(
      cmd => matchesTarget(cmd) && cmd.pollEvent?.wake === true,
    ).length

    return { commands: chunk, remainingWakeCount }
  }
}

export { MessageQueueInstance as MessageQueueManager }

export function createMessageQueue(): MessageQueueInstance {
  return new MessageQueueInstance()
}

export const defaultQueue = createMessageQueue()
let activeQueue: MessageQueueInstance = defaultQueue

export function getActiveMessageQueue(): MessageQueueInstance {
  return activeQueue
}

export function setActiveMessageQueue(queue: MessageQueueInstance): void {
  activeQueue = queue
}

export const subscribeCommandsConsumed: Signal<[QueuedCommand[]]>['subscribe'] =
  listener => activeQueue.subscribeCommandsConsumed(listener)
export const subscribeCommandsDiscarded: Signal<
  [QueuedCommand[]]
>['subscribe'] = listener => activeQueue.subscribeCommandsDiscarded(listener)

// ============================================================================
// useSyncExternalStore interface
// ============================================================================

/**
 * Subscribe to command queue changes.
 * Compatible with React's useSyncExternalStore.
 */
export const subscribeToCommandQueue: Signal['subscribe'] = listener =>
  activeQueue.subscribe(listener)

/**
 * Get current snapshot of the command queue.
 * Compatible with React's useSyncExternalStore.
 * Returns a frozen array that only changes reference on mutation.
 */
export function getCommandQueueSnapshot(): readonly QueuedCommand[] {
  return activeQueue.getSnapshot()
}

// ============================================================================
// Read operations (for non-React code)
// ============================================================================

/**
 * Get a mutable copy of the current queue.
 * Use for one-off reads where you need the actual commands.
 */
export function getCommandQueue(): QueuedCommand[] {
  return activeQueue.getCommands()
}

/**
 * Get the current queue length without copying.
 * densable j4i — full queue including nested/subagent-addressed entries.
 */
export function getCommandQueueLength(): number {
  return activeQueue.getLength()
}

/**
 * densable Xwt / getMainThreadQueueLength — count of AL entries only
 * (`cmd.agentId === mi()`). Full length would keep the REPL spinner spinning
 * when only nested/subagent notifications remain (processQueueIfReady never
 * drains them on the main thread). Spinner and mainIsBusy must use this, not
 * getCommandQueueLength().
 */
export function getMainThreadQueueLength(): number {
  return activeQueue.getMainThreadLength()
}

/**
 * Check if there are commands in the queue.
 */
export function hasCommandsInQueue(): boolean {
  return activeQueue.hasCommands()
}

/**
 * densable Opu: whether the queue has an Esc-cancellable / poppable command.
 * Uses x4 = isQueuedCommandEditable (mode ∉ {task-notification}, !isMeta,
 * human-like origin). Background task-notification entries alone must NOT
 * keep chat:cancel active at an idle prompt — otherwise Esc-Esc never reaches
 * the rewind message selector (densable 2.1.216 #12).
 */
export function hasEditableCommandsInQueue(): boolean {
  return activeQueue.hasEditableCommands()
}

/**
 * Trigger a re-check by notifying subscribers.
 * Use after async processing completes to ensure remaining commands
 * are picked up by useSyncExternalStore consumers.
 */
export function recheckCommandQueue(): void {
  activeQueue.recheck()
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

/**
 * Official 2.1.321 (#1881): cap how many queued `task-notification` items are
 * delivered in one turn/request when a backlog builds up (e.g. while Claude was
 * stopped and multiple background agents finished). Keeps the first
 * `maxCount - 1` notifications verbatim and folds the rest into one summary
 * `<task-notification>` so a single request never carries an unbounded flood.
 */
export const DEFAULT_TASK_NOTIFICATION_BATCH_CAP = 10

function extractNotificationSummaryLine(cmd: QueuedCommand): string {
  const raw = typeof cmd.value === 'string' ? cmd.value : ''
  const match = raw.match(/<summary>([\s\S]*?)<\/summary>/)
  if (match?.[1]) {
    return match[1].trim().slice(0, 160)
  }
  return raw.replace(/\s+/g, ' ').trim().slice(0, 160) || 'background task'
}

export function collapseBacklogTaskNotifications(
  commands: readonly QueuedCommand[],
  maxCount: number = DEFAULT_TASK_NOTIFICATION_BATCH_CAP,
): QueuedCommand[] {
  const cap = Math.max(2, maxCount)
  const notifications = commands.filter(cmd => cmd.mode === 'task-notification')
  if (notifications.length <= cap) {
    return [...commands]
  }
  const nonNotifications = commands.filter(
    cmd => cmd.mode !== 'task-notification',
  )
  const kept = notifications.slice(0, cap - 1)
  const folded = notifications.slice(cap - 1)
  const summaryLines = folded
    .slice(0, 20)
    .map(cmd => `- ${extractNotificationSummaryLine(cmd)}`)
    .join('\n')
  const omittedTail =
    folded.length > 20 ? `\n- ... and ${folded.length - 20} more` : ''
  const collapsed: QueuedCommand = {
    value: `<task-notification>
<summary>+${folded.length} more background task notifications folded (backlog cap ${cap})</summary>
<status>completed</status>
${summaryLines}${omittedTail}
</task-notification>`,
    mode: 'task-notification',
    skipAttachments: true,
    priority: 'later',
    agentId: folded[0]?.agentId ?? getMainThreadAgentId(),
  }
  return [...nonNotifications, ...kept, collapsed]
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

/** densable mtt — strip hop-chain attr from model-facing value on peer rows. */
function stripPeerCommandHopChain(command: QueuedCommand): QueuedCommand {
  if (
    !isCrossSessionPeerOrigin(command.origin as PeerQueueOrigin | undefined)
  ) {
    return command
  }
  const val = command.value
  if (typeof val === 'string') {
    const stripped = stripCrossSessionHopChain(val)
    return stripped === val ? command : { ...command, value: stripped }
  }
  let changed = false
  const next = val.map(block => {
    if (block.type !== 'text') return block
    const stripped = stripCrossSessionHopChain(block.text)
    if (stripped === block.text) return block
    changed = true
    return { ...block, text: stripped }
  })
  return changed ? { ...command, value: next } : command
}

/** densable htt — verified / known peer address → full zo.admit path. */
function isVerifiedPeerOrigin(origin: PeerQueueOrigin): boolean {
  return origin.verifiedPeerPid !== undefined || origin.from !== 'unknown'
}

/** densable Un — count of queued cross-session peer commands. */
export function countQueuedPeerMessages(): number {
  return activeQueue.countQueuedPeerMessages()
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
 * densable `enqueueReportingAdmission` / `ds` — admit-then-push; on peer
 * handback origin call `recordHandbackDelivery` (m7n). Alias of gold `ds`.
 * Never export minify `ds`/`yr`.
 */
export function enqueueReportingAdmission(
  command: QueuedCommand,
  opts: EnqueueReportingAdmissionOpts = {},
): ReportingAdmissionResult {
  return activeQueue.enqueueReportingAdmission(command, opts)
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
  activeQueue.enqueue(command)
}

/**
 * densable `Te` — mark queued uuids as fold-in-flight.
 */
export function registerFoldInFlight(commands: Array<{ uuid?: string }>): void {
  activeQueue.registerFoldInFlight(commands)
}

/**
 * densable `xe`.
 */
export function unregisterFoldInFlight(
  commands: Array<{ uuid?: string }>,
): void {
  activeQueue.unregisterFoldInFlight(commands)
}

/** densable `Pe`. */
export function isFoldInFlight(uuid: string): boolean {
  return activeQueue.isFoldInFlight(uuid)
}

/** densable `Ze`. */
export function suspendMidTurnFold(): void {
  activeQueue.suspendMidTurnFold()
}

/** densable `Ft` — `qe || Mr()`. */
export function isMidTurnFoldSuspended(): boolean {
  return activeQueue.isMidTurnFoldSuspended()
}

/**
 * densable `yt` — raise one queued uuid to priority now.
 * False when missing, already now, or fold-in-flight.
 */
export function promoteToNow(uuid: string): boolean {
  return activeQueue.promoteToNow(uuid)
}

/**
 * densable `Ot` — restore a now-priority uuid to `raisedFrom`.
 */
export function demoteFromNow(
  uuid: string,
  raisedFrom: QueuePriority,
): boolean {
  return activeQueue.demoteFromNow(uuid, raisedFrom)
}

/**
 * Bulk raise of main-thread next/later → now. Gold send-now uses `yt` per uuid;
 * REPL typed send-now still flushes the main-thread batch.
 */
export function promoteMainThreadQueueToNow(): number {
  return activeQueue.promoteMainThreadQueueToNow()
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
export function enqueuePendingNotification(
  command: QueuedCommand,
  opts?: { turnAttribution?: 'inherit' | 'none' },
): void {
  activeQueue.enqueuePendingNotification(command, opts)
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
  return activeQueue.dequeue(filter)
}

/**
 * Remove and return all commands from the queue.
 * Logs a dequeue operation for each command.
 */
export function dequeueAll(): QueuedCommand[] {
  return activeQueue.dequeueAll()
}

/**
 * Return the highest-priority command without removing it, or undefined if empty.
 * Accepts an optional `filter` — only commands passing the predicate are considered.
 */
export function peek(
  filter?: (cmd: QueuedCommand) => boolean,
): QueuedCommand | undefined {
  return activeQueue.peek(filter)
}

/**
 * densable `Xe` / `bt` — stamp or drop a screeningPending queue row after
 * Enter Unn. dropped → remove (gold `os` `dropped_by_hook`). Else clear
 * pending and write promptSubmitted / drainOnly.
 */
export function settleScreening(
  uuid: string,
  update:
    | { dropped: true }
    | {
        promptSubmitted?: QueuedCommand['promptSubmitted']
        drainOnly?: boolean
      },
): boolean {
  return activeQueue.settleScreening(uuid, update)
}

/**
 * Remove and return all commands matching a predicate, preserving priority order.
 * Non-matching commands stay in the queue.
 */
export function dequeueAllMatching(
  predicate: (cmd: QueuedCommand) => boolean,
): QueuedCommand[] {
  return activeQueue.dequeueAllMatching(predicate)
}

/**
 * densable `os` / `xi` discarded — remove by identity and fail waiters as
 * discarded. Callers must pass the same object references that are in the
 * queue (e.g. from getCommandsByMaxPriority).
 */
export function remove(commandsToRemove: QueuedCommand[]): void {
  activeQueue.remove(commandsToRemove)
}

/**
 * densable `ir` / `xi` consumed — mid-turn drain to the model as text.
 * Does not settle prompt.submit as "removed"; Art already took those
 * waiters. command.run waiters fail as left-as-text.
 */
export function consume(
  commandsToConsume: QueuedCommand[],
  opts?: { reason?: string },
): void {
  activeQueue.consume(commandsToConsume, opts)
}

/** Official 2.1.328 (`va`): arm the interrupt requeue deadline for the last mid-turn absorbed prompt. */
export function startRequeueWindow(): void {
  activeQueue.startRequeueWindow()
}

/** Official 2.1.328 (`Xl`): close the interrupt requeue window; clear putBack set when `turnEnded`. */
export function settleTaken(opts?: { turnEnded?: boolean }): void {
  activeQueue.settleTaken(opts)
}

/** Official 2.1.328 (`Ja`): cancel interrupt requeue eligibility for `uuid`. */
export function forgoRequeue(uuid: string): void {
  activeQueue.forgoRequeue(uuid)
}

/** Official 2.1.328 (`Ia`): resurrect the last mid-turn absorbed prompt if still within its window. */
export function requeueTaken(): QueuedCommand | undefined {
  return activeQueue.requeueTaken()
}

/** Official 2.1.328 (`Fa`): whether `uuid` was resurrected via `requeueTaken()`. */
export function wasPutBack(uuid: string): boolean {
  return activeQueue.wasPutBack(uuid)
}

/** Official 2.1.328 (`il`): fate of a folded prompt copy ('drop' | 'wait' | 'keep'). */
export function foldCopyFate(uuid: string): 'drop' | 'wait' | 'keep' {
  return activeQueue.foldCopyFate(uuid)
}

/** Official 2.1.328 (`Cu`): mark folded copy written so it will no longer be requeued. */
export function foldCopyWritten(uuid: string): void {
  activeQueue.foldCopyWritten(uuid)
}

/** Official 2.1.328 (`Md`): remaining ms in the armed requeue window. */
export function requeueWindowLeftMs(): number | undefined {
  return activeQueue.requeueWindowLeftMs()
}

/** Official 2.1.328 (`$e`): temporarily hold matching commands passive until release is called. */
export function holdBack(holds: (cmd: QueuedCommand) => boolean): () => number {
  return activeQueue.holdBack(holds)
}

/** Official 2.1.328 (`Le`): release a subset of held-back commands matching `pred`. */
export function letHeldBackGo(pred: (cmd: QueuedCommand) => boolean): number {
  return activeQueue.letHeldBackGo(pred)
}

/** Official 2.1.328 (`ys`): stage a command to run ahead after the current turn finishes. */
export function queueAfterTurn(cmd: QueuedCommand): void {
  activeQueue.queueAfterTurn(cmd)
}

/** Official 2.1.328 (`Hi`): release staged post-turn commands ahead unless a `'now'` command waits. */
export function releaseQueuedAfterTurn(): void {
  activeQueue.releaseQueuedAfterTurn()
}

/**
 * Remove commands matching a predicate.
 * Returns the removed commands.
 */
export function removeByFilter(
  predicate: (cmd: QueuedCommand) => boolean,
): QueuedCommand[] {
  return activeQueue.removeByFilter(predicate)
}

/**
 * Clear all commands from the queue.
 * Used by ESC cancellation to discard queued notifications.
 */
export function clearCommandQueue(): void {
  activeQueue.clear()
}

/**
 * Clear all commands and reset snapshot.
 * Used for test cleanup.
 */
export function resetCommandQueue(): void {
  activeQueue.reset()
  activeQueue = defaultQueue
  defaultQueue.reset()
  resetPromptSubmitWaits()
  resetCommandRunWaits()
  resetTurnHookQueuedPrompts()
}

/**
 * densable `he` — mark a queued uuid cancelled by the host.
 * `terminalEmitted:true` also acks (returns true the first time).
 */
export function markCancelPending(
  uuid: string,
  opts?: { terminalEmitted?: boolean },
): boolean {
  return activeQueue.markCancelPending(uuid, opts)
}

/** densable `ye` — consume (delete) a pending cancel. */
export function consumeCancelPending(uuid: string): boolean {
  return activeQueue.consumeCancelPending(uuid)
}

/** densable `ke` — consume the terminal-emitted ack. */
export function consumeCancelPendingAcked(uuid: string): boolean {
  return activeQueue.consumeCancelPendingAcked(uuid)
}

/** densable `Se`. */
export function hasCancelPendingAcked(uuid: string): boolean {
  return activeQueue.hasCancelPendingAcked(uuid)
}

/**
 * Official `setInFlightDrainBatch` — mark a dequeued batch as still executing.
 * Cuy sets this synchronously after dequeue, before executeInput.
 */
export function setInFlightDrainBatch(batch: QueuedCommand[]): void {
  activeQueue.setInFlightDrainBatch(batch)
}

/**
 * Official `clearInFlightDrainBatch` — only clears when `batch` is omitted
 * or is the same reference currently held (a newer drain must not be wiped).
 */
export function clearInFlightDrainBatch(batch?: QueuedCommand[]): void {
  activeQueue.clearInFlightDrainBatch(batch)
}

/**
 * Official `someInFlightDrainCommand`. No predicate → any in-flight drain.
 */
export function someInFlightDrainCommand(
  pred?: (cmd: QueuedCommand) => boolean,
): boolean {
  return activeQueue.someInFlightDrainCommand(pred)
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

// ============================================================================
// Official 2.1.328 Poll call lifecycle & poll-event enqueue helpers
// ============================================================================

export function tryBeginPollCall(agentId?: string): boolean {
  return activeQueue.tryBeginPollCall(agentId)
}

export function endPollCall(agentId?: string): void {
  activeQueue.endPollCall(agentId)
}

export function drainPollEventChunk(agentId?: string): {
  commands: QueuedCommand[]
  remainingWakeCount: number
} {
  return activeQueue.drainPollEventChunk(agentId)
}

export function enqueueReplEvalPollEvent(opts: {
  evalId: number
  content: string
  isError?: boolean
  ms?: number
  agentId?: string
  toolUseId?: string
  startsTurn?: boolean
  wake?: boolean
  media?: unknown[]
}): void {
  const attrs: Record<string, string> = {
    eval: String(opts.evalId),
  }
  if (opts.ms !== undefined) {
    attrs.ms = String(Math.max(0, Math.round(opts.ms)))
  }
  if (opts.isError) {
    attrs.status = 'error'
  }
  const rawEnvelope = buildPollEventEnvelope({
    kind: POLL_EVENT_KIND_REPL_EVAL,
    at: new Date().toISOString(),
    content: '',
    attributes: attrs,
    children: [
      {
        tag: opts.isError ? 'error' : 'result',
        text: opts.content,
      },
    ],
  })
  const nonce = mintPollEventNonce()
  const envelope = stampPollEventNonce(rawEnvelope, nonce, 'element')
  const cmd: QueuedCommand = withMainThreadAgentId({
    value: envelope,
    mode: 'poll-event',
    priority: 'now',
    ...(opts.agentId !== undefined && {
      agentId: opts.agentId as QueuedCommand['agentId'],
    }),
    pollEvent: {
      kind: POLL_EVENT_KIND_REPL_EVAL,
      envelope,
      wake: opts.wake ?? true,
      ...(opts.startsTurn !== undefined && { startsTurn: opts.startsTurn }),
      ...(opts.media !== undefined && { media: opts.media }),
    },
  })
  activeQueue.enqueue(cmd)
}

export function enqueueReplStatusPollEvent(opts: {
  ledger: ReadonlyArray<{
    id: number
    state: string
    runningMs: number
    snippet: string
  }>
  agentId?: string
}): void {
  const lines = opts.ledger.map(
    entry =>
      `#${entry.id} (${entry.state}, ${Math.round(entry.runningMs / 1000)}s): ${entry.snippet}`,
  )
  const rawEnvelope = buildPollEventEnvelope({
    kind: POLL_EVENT_KIND_REPL_STATUS,
    at: new Date().toISOString(),
    content: lines.join('\n'),
    attributes: {
      pending: String(opts.ledger.length),
    },
  })
  const nonce = mintPollEventNonce()
  const envelope = stampPollEventNonce(rawEnvelope, nonce, 'element')
  const cmd: QueuedCommand = withMainThreadAgentId({
    value: envelope,
    mode: 'poll-event',
    priority: 'now',
    ...(opts.agentId !== undefined && {
      agentId: opts.agentId as QueuedCommand['agentId'],
    }),
    pollEvent: {
      kind: POLL_EVENT_KIND_REPL_STATUS,
      envelope,
      wake: false,
    },
  })
  activeQueue.enqueue(cmd)
}

/** densable `tp && uf` — main-thread editable, for T7e / zZe. */
export function isDrainableQueuedCommand(cmd: QueuedCommand): boolean {
  return isMainThreadQueuedCommand(cmd) && isQueuedCommandEditable(cmd)
}

/**
 * densable `T7e` — show the send-now hint under the queue preview.
 * Abort missing/aborted → hide. Else main-thread editables exist and none
 * are still in Enter Unn screening.
 */
export function canShowQueueSendNowHint(
  queue: readonly QueuedCommand[],
  abort: AbortController | null | undefined,
): boolean {
  if (abort == null || abort.signal.aborted) return false
  const drainable = queue.filter(isDrainableQueuedCommand)
  return (
    drainable.length > 0 &&
    !drainable.some(cmd => cmd.screeningPending === true)
  )
}

/**
 * densable 2-arg `zZe` @209635919 — restore IDE selection after Enter Unn
 * drop / cancel when no remaining drainable row still needs it.
 */
export function shouldHandBackIdeSelection(
  queue: readonly QueuedCommand[],
  captured: QueuedCommand['ideSelection'] | undefined,
): boolean {
  return !queue.some(
    cmd =>
      isDrainableQueuedCommand(cmd) &&
      (captured === undefined || cmd.ideSelection === undefined),
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

/** Official 2.1.328 (`uln`): command has a non-empty pre-expansion text draft. */
function hasPreExpansionValue(cmd: QueuedCommand): boolean {
  return (
    typeof cmd.preExpansionValue === 'string' &&
    cmd.preExpansionValue.trim() !== '' &&
    (cmd.skipSlashCommands === true ||
      cmd.pasteTagged === true ||
      cmd.pastedContents !== undefined)
  )
}

/** Official 2.1.328 (`KPt`): prefer `preExpansionValue` when available. */
function extractEditableText(cmd: QueuedCommand): string {
  if (hasPreExpansionValue(cmd)) {
    return cmd.preExpansionValue!
  }
  return extractTextFromValue(cmd.value)
}

/** Official 2.1.328 (`C4r`): extract editable pasted entries (images, inline, or all when pre-expansion). */
function extractEditablePastedContents(cmd: QueuedCommand): PastedContent[] {
  if (!cmd.pastedContents) return []
  const usePreExpansion = hasPreExpansionValue(cmd)
  return Object.values(cmd.pastedContents).filter(
    c => c.type === 'image' || c.inline === true || usePreExpansion,
  )
}

/**
 * Official 2.1.328 (`nu` in `chunk@294254613.js:777500`): remap text paste IDs
 * that collide with paste IDs or dangling `[Pasted text #N]` references in the
 * current draft or other pulled queued commands.
 */
function remapEditablePasteIds(
  cmds: QueuedCommand[],
  currentInput: string,
  currentPastedContents: Record<number, PastedContent>,
): Array<{ text: string; entries: PastedContent[] }> {
  const items = cmds.map(cmd => ({
    text: extractEditableText(cmd),
    entries: extractEditablePastedContents(cmd),
  }))
  const collectForeignRefIds = (
    text: string,
    ownIds: Set<number>,
  ): Set<number> => {
    const foreign = new Set<number>()
    for (const ref of parseReferences(text)) {
      if (isValidPasteId(ref.id) && !ownIds.has(ref.id)) {
        foreign.add(ref.id)
      }
    }
    return foreign
  }
  const currentOwnIds = new Set(Object.keys(currentPastedContents).map(Number))
  const foreignPerSlot = [
    collectForeignRefIds(currentInput, currentOwnIds),
    ...items.map(item =>
      collectForeignRefIds(item.text, new Set(item.entries.map(e => e.id))),
    ),
  ]
  const claimedIds = new Set<number>(currentOwnIds)
  return items.map((item, idx) => {
    const takenByOthers = new Set<number>(claimedIds)
    for (let slot = 0; slot < foreignPerSlot.length; slot++) {
      if (slot === idx + 1) continue
      for (const id of foreignPerSlot[slot]!) {
        takenByOthers.add(id)
      }
    }
    let text = item.text
    const entries = item.entries.map(entry => {
      if (entry.type !== 'text' || !takenByOthers.has(entry.id)) {
        claimedIds.add(entry.id)
        return entry
      }
      const combinedPasted: Record<number, unknown> = {
        ...currentPastedContents,
      }
      for (const id of claimedIds) combinedPasted[id] = true
      for (const id of takenByOthers) combinedPasted[id] = true
      const newId = mintPasteId(
        [currentInput, ...items.map(i => i.text)].join('\n'),
        combinedPasted,
      )
      text = renumberPasteRefInDisplay(text, entry.id, newId, 'text')
      claimedIds.add(newId)
      return { ...entry, id: newId }
    })
    return { text, entries }
  })
}

/**
 * Official 2.1.328 (`Wnt` in `chunk@294254613.js:758370`): combine pulled text
 * ahead of current input without off-by-1 cursorOffset when draft is empty.
 */
function joinPulledWithDraft(
  pulledText: string,
  currentInput: string,
  currentCursorOffset: number,
): { text: string; cursorOffset: number } {
  if (!pulledText) {
    return { text: currentInput, cursorOffset: currentCursorOffset }
  }
  if (!currentInput) {
    return {
      text: pulledText,
      cursorOffset: pulledText.length + currentCursorOffset,
    }
  }
  return {
    text: `${pulledText}\n${currentInput}`,
    cursorOffset: pulledText.length + 1 + currentCursorOffset,
  }
}

/**
 * densable XLr — image blocks in a queued value become PastedContent.
 * String values return [].
 */
export function extractImagesFromValue(
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
  /** densable pop-to-edit `returnIdeSelection`. */
  ideSelection?: QueuedCommand['ideSelection']
  /** Official 2.1.323 (#2066): preserved when any popped entry had `textNotTyped: true`. */
  textNotTyped?: boolean
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
  return activeQueue.hasPoppableEditableCommands(inputEmpty)
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
  currentPastedContents: Record<number, PastedContent> = {},
): PopAllEditableResult | undefined {
  return activeQueue.popAllEditable(
    currentInput,
    currentCursorOffset,
    currentPastedContents,
  )
}

export type PopEditableAtResult = PopAllEditableResult

/**
 * densable `Ne` / `popEditableAt` 1:1 (2.1.328).
 * Index is into `n.filter(lJ)` (editable), then NMt-gated, with `nu` paste-id
 * collision remapping and `Wnt` cursorOffset alignment.
 */
export function popEditableAt(
  index: number,
  currentInput: string,
  currentCursorOffset: number,
  currentPastedContents: Record<number, PastedContent> = {},
): PopEditableAtResult | undefined {
  return activeQueue.popEditableAt(
    index,
    currentInput,
    currentCursorOffset,
    currentPastedContents,
  )
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
  return activeQueue.getCommandsByMaxPriority(maxPriority)
}

/**
 * densable `ks` / `countRemainingWakePollEventsAfter` — wake poll-events
 * still queued after `taken` (same agent as the first poll-event in taken).
 */
export function countRemainingWakePollEventsAfter(
  taken: readonly QueuedCommand[],
): number {
  return activeQueue.countRemainingWakePollEventsAfter(taken)
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
  if (cmd.mode === 'poll-event' || cmd.textNotTyped === true) {
    return false
  }
  if (cmd.skipSlashCommands && cmd.bridgeOrigin !== true) {
    return false
  }
  if (typeof cmd.value === 'string') {
    return cmd.value.trim().startsWith('/')
  }
  if (!Array.isArray(cmd.value)) {
    return false
  }
  const lastBlock = cmd.value.at(-1)
  return (
    lastBlock?.type === 'text' &&
    typeof lastBlock.text === 'string' &&
    lastBlock.text.trim().startsWith('/')
  )
}
