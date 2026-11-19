/**
 * Official 2.1.326 #246 (`UPs`, `uQi`, `Pzn`, `Pji`, `xji`) —
 * Rapid follow-up preemption scheduler for SDK / Claude Desktop sessions.
 *
 * When a consumer declares `rapidFollowupPreempt: true` in its `initialize`
 * control request (and the rollout flag `tengu_zippy_spindle` is on), a
 * queued human follow-up that arrives while the running turn has not yet
 * produced visible output preempts the running turn (emitting
 * `system/turn_preempted` and aborting the turn as an interrupt) so the
 * follow-up executes immediately instead of waiting.
 */
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import { logEvent } from '../services/analytics/index.js'
import { logError } from '../utils/log.js'

let sdkRapidFollowupPreemptDeclared: boolean | undefined

/** First-attached-client-wins capability declaration from `initialize`. */
export function declareSdkRapidFollowupPreempt(enabled: boolean): void {
  if (sdkRapidFollowupPreemptDeclared === undefined) {
    sdkRapidFollowupPreemptDeclared = enabled
  }
}

export function getSdkRapidFollowupPreempt(): boolean {
  return sdkRapidFollowupPreemptDeclared === true
}

export function resetSdkRapidFollowupPreemptForTesting(): void {
  sdkRapidFollowupPreemptDeclared = undefined
}

/** Official `uQi()` — requires both initialize capability and rollout gate. */
export function isRapidFollowupPreemptEnabled(): boolean {
  return (
    getSdkRapidFollowupPreempt() &&
    getFeatureValue_CACHED_MAY_BE_STALE('tengu_zippy_spindle', false)
  )
}

export type PreemptQueueMember = {
  uuid?: string
  mode?: string
  priority?: 'now' | 'next' | 'later'
  value?: unknown
  isMeta?: boolean
  shouldQuery?: boolean
  bridgeOrigin?: boolean
  verifiedSlackHumanTurn?: boolean
  wait?: boolean
  origin?: { kind?: string }
  isExecutable?: boolean
}

export type TurnPreemptedFrame = {
  type: 'system'
  subtype: 'turn_preempted'
  reason: 'rapid_followup'
  preempted_by_uuid: string
  preempted_message_uuids: string[]
}

export type RapidFollowupMessageQueue = {
  getCommandQueueSnapshot: () => readonly PreemptQueueMember[]
  subscribe: (listener: () => void) => () => void
}

export type RapidFollowupDrainState = {
  abortController?: AbortController
  endSessionRequested?: boolean
}

export type RapidFollowupPreemptOptions = {
  messageQueue: RapidFollowupMessageQueue
  drain: RapidFollowupDrainState
  enabled: () => boolean
  isSentNow?: (cmd: PreemptQueueMember) => boolean
  isShuttingDown?: () => boolean
  emit: (frame: TurnPreemptedFrame) => void
}

function isSlashCommandValue(value: unknown): boolean {
  return typeof value === 'string' && value.trimStart().startsWith('/')
}

function isExecutableEntry(cmd: PreemptQueueMember): boolean {
  return cmd.isExecutable !== false
}

function headCandidate(
  queue: readonly PreemptQueueMember[],
): PreemptQueueMember | undefined {
  return queue.find(
    cmd =>
      isExecutableEntry(cmd) &&
      (cmd.mode === 'prompt' ||
        cmd.mode === 'orphaned-permission' ||
        cmd.priority !== 'later'),
  )
}

/** Official `Pzn(cmd)` — true when a queued follow-up is eligible to preempt. */
export function isEligibleRapidFollowup(
  cmd: PreemptQueueMember,
  allowSlash?: (cmd: PreemptQueueMember) => boolean,
): boolean {
  const isHumanOrigin = cmd.origin === undefined || cmd.origin.kind === 'human'
  return (
    cmd.mode === 'prompt' &&
    isHumanOrigin &&
    cmd.verifiedSlackHumanTurn !== true &&
    cmd.bridgeOrigin !== true &&
    cmd.priority === 'next' &&
    !cmd.wait &&
    (!isSlashCommandValue(cmd.value) || allowSlash?.(cmd) === true)
  )
}

function safeCall(fn: () => void): void {
  try {
    fn()
  } catch (err) {
    logError(err instanceof Error ? err : new Error(String(err)))
  }
}

/** Official `UPs` — manages rapid follow-up preemption across turns. */
export class RapidFollowupPreemptController {
  private readonly messageQueue: RapidFollowupMessageQueue
  private readonly drain: RapidFollowupDrainState
  private readonly enabled: () => boolean
  private readonly isSentNow: (cmd: PreemptQueueMember) => boolean
  private readonly isShuttingDown: () => boolean
  private readonly emit: (frame: TurnPreemptedFrame) => void
  private readonly judged = new WeakSet<PreemptQueueMember>()
  private turnRunning = false
  private turn:
    | { messageUuids: string[]; compacting: boolean; open: boolean }
    | undefined
  private held: PreemptQueueMember | undefined
  private preemptedBy: string | undefined

  constructor(opts: RapidFollowupPreemptOptions) {
    this.messageQueue = opts.messageQueue
    this.drain = opts.drain
    this.enabled = opts.enabled
    this.isSentNow = opts.isSentNow ?? (() => false)
    this.isShuttingDown = opts.isShuttingDown ?? (() => false)
    this.emit = opts.emit
  }

  install(): () => void {
    this.takeArrivingFollowup()
    return this.messageQueue.subscribe(() =>
      safeCall(() => this.onQueueChanged()),
    )
  }

  noteTurnStart({
    command,
    members,
  }: {
    command: PreemptQueueMember
    members: readonly PreemptQueueMember[]
  }): void {
    const prevPreempt = this.preemptedBy
    const isPreemptTurn =
      prevPreempt !== undefined && members.some(m => m.uuid === prevPreempt)
    if (
      prevPreempt !== undefined &&
      (isPreemptTurn ||
        !this.messageQueue
          .getCommandQueueSnapshot()
          .some(m => m.uuid === prevPreempt))
    ) {
      this.preemptedBy = undefined
    }
    this.turnRunning = true
    const eligible =
      command.mode === 'prompt' &&
      !command.isMeta &&
      command.shouldQuery !== false &&
      !isSlashCommandValue(command.value) &&
      !members.some(m => m.priority === 'now' || m.bridgeOrigin === true) &&
      !isPreemptTurn
    this.turn = eligible
      ? {
          messageUuids: members
            .map(m => m.uuid)
            .filter((id): id is string => id !== undefined),
          compacting: false,
          open: false,
        }
      : undefined
    if (this.turn === undefined) {
      this.held = undefined
    }
  }

  noteFrame(frame: Record<string, unknown>): void {
    const turn = this.turn
    if (turn === undefined) return
    const type = frame.type
    if (type === 'system' && frame.subtype === 'status') {
      if (frame.status !== 'requesting') {
        turn.compacting = frame.status === 'compacting'
      }
      return
    }
    const isVisibleMainOutput =
      type === 'result' ||
      ((type === 'assistant' ||
        (type === 'user' && !('isReplay' in frame)) ||
        (type === 'stream_event' &&
          typeof frame.event === 'object' &&
          frame.event !== null &&
          ((frame.event as { type?: string }).type === 'content_block_start' ||
            (frame.event as { type?: string }).type ===
              'content_block_delta'))) &&
        (frame.parent_tool_use_id === null ||
          frame.parent_tool_use_id === undefined))
    if (isVisibleMainOutput) {
      this.turn = undefined
      this.held = undefined
      return
    }
    if (type === 'system' && frame.subtype === 'init') {
      turn.open = true
      const held = this.held
      this.held = undefined
      if (held === undefined) return
      const snapshot = this.messageQueue.getCommandQueueSnapshot()
      if (
        headCandidate(snapshot) === held &&
        !snapshot.some(m => m.priority === 'now' && isExecutableEntry(m))
      ) {
        safeCall(() => this.preempt(held))
      }
    }
  }

  noteTurnEnd(): void {
    this.turnRunning = false
    this.turn = undefined
    this.held = undefined
  }

  private onQueueChanged(): void {
    const followup = this.takeArrivingFollowup()
    if (
      followup === undefined ||
      followup.uuid === undefined ||
      !this.enabled() ||
      !isEligibleRapidFollowup(followup) ||
      this.isSentNow(followup)
    ) {
      return
    }
    if (this.turn?.open) {
      this.preempt(followup)
    } else if (this.turn !== undefined || !this.turnRunning) {
      this.held = followup
    }
  }

  private preempt(followup: PreemptQueueMember): void {
    const uuid = followup.uuid
    const turn = this.turn
    const abortController = this.drain.abortController
    if (
      uuid === undefined ||
      turn === undefined ||
      !turn.open ||
      turn.compacting ||
      abortController === undefined ||
      abortController.signal.aborted ||
      this.drain.endSessionRequested ||
      this.isShuttingDown()
    ) {
      return
    }
    this.emit({
      type: 'system',
      subtype: 'turn_preempted',
      reason: 'rapid_followup',
      preempted_by_uuid: uuid,
      preempted_message_uuids: turn.messageUuids,
    })
    this.preemptedBy = uuid
    logEvent('tengu_print_rapid_followup_preempt', {})
    abortController.abort(new Error('interrupt'))
  }

  private takeArrivingFollowup(): PreemptQueueMember | undefined {
    const snapshot = this.messageQueue.getCommandQueueSnapshot()
    const head = headCandidate(snapshot)
    const isNew = head !== undefined && !this.judged.has(head)
    for (const item of snapshot) {
      this.judged.add(item)
    }
    return isNew ? head : undefined
  }
}

/**
 * Official 2.1.326 #95 (`storeStopOverTheCutOffTurn` / `tookCutOffTurn`):
 * tracks an interrupted turn re-enqueued on remote session restart. If Stop
 * (`interrupt`) arrives while Claude Code is restarting (before the queued
 * re-run begins), cancels the queued re-run AND persists an interruption marker
 * over the cut-off turn so neither this start nor a later restart re-runs it.
 */
export class CutOffReRunStopTracker {
  private pending:
    | {
        reRunUuid: string
        takenOutMessage: Record<string, unknown>
      }
    | undefined
  private movedPastCutOffTurn = false
  private stopSettlingPromise: Promise<void> | undefined

  arm(reRunUuid: string, takenOutMessage: Record<string, unknown>): void {
    this.pending = { reRunUuid, takenOutMessage }
    this.movedPastCutOffTurn = false
  }

  markStarted(cmdUuid: string | undefined): void {
    if (this.pending && cmdUuid === this.pending.reRunUuid) {
      this.movedPastCutOffTurn = true
      this.pending = undefined
    }
  }

  hasPendingCutOffReRun(): boolean {
    return this.pending !== undefined && !this.movedPastCutOffTurn
  }

  getPendingReRunUuid(): string | undefined {
    return this.pending?.reRunUuid
  }

  getStopSettlingPromise(): Promise<void> | undefined {
    return this.stopSettlingPromise
  }

  /**
   * Cancel the queued cut-off re-run and persist the cut-off message followed
   * by a user-interruption sentinel so a subsequent restart also treats the
   * turn as stopped. Returns `true` if a pending cut-off re-run was cancelled.
   */
  handleInterruptBeforeStart(opts: {
    removeFromQueue: (reRunUuid: string) => boolean
    currentMessages: readonly Record<string, unknown>[]
    buildInterruptionMessage: () => Record<string, unknown>
    persistTranscript: (messages: Record<string, unknown>[]) => Promise<void>
    onError?: (err: unknown) => void
  }): boolean {
    if (!this.pending || this.movedPastCutOffTurn) {
      return false
    }
    const { reRunUuid, takenOutMessage } = this.pending
    const removed = opts.removeFromQueue(reRunUuid)
    this.movedPastCutOffTurn = true
    this.pending = undefined
    if (!removed) {
      return false
    }
    const toPersist = [
      ...opts.currentMessages,
      takenOutMessage,
      opts.buildInterruptionMessage(),
    ]
    this.stopSettlingPromise = opts.persistTranscript(toPersist).catch(err => {
      opts.onError?.(err)
    })
    return true
  }
}
