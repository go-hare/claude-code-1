/**
 * densable 2.1.289 print drain start-gate + prewait latch (SEA Tl / Dm).
 * Semantic helpers only — invent-ban minify exports (Rl|Tl|Dm|Kc).
 */
import type { QueuedCommand } from 'src/types/textInputTypes.js'

export type PrintStartGate = {
  /** densable Tl.isHeadAhead */
  readonly isHeadAhead: boolean
  markAhead: () => void
  clearAhead: () => void
  /** densable Tl.followersFrom ← queuedAtWait snapshot */
  captureFollowersFrom: (queue: readonly QueuedCommand[]) => void
  /** densable Tl.admits */
  admits: (cmd: QueuedCommand) => boolean
  reset: () => void
}

/**
 * densable Tl — gate whether a follower may join / be held across after an
 * ahead-of-start steal. Local print has no full waitOut class; markAhead /
 * clearAhead / captureFollowersFrom are the portable surface.
 */
export function createPrintStartGate(): PrintStartGate {
  let isHeadAhead = false
  let followersFrom: WeakSet<QueuedCommand> | undefined

  return {
    get isHeadAhead() {
      return isHeadAhead
    },
    markAhead() {
      isHeadAhead = true
      followersFrom = undefined
    },
    clearAhead() {
      isHeadAhead = false
    },
    captureFollowersFrom(queue) {
      followersFrom = new WeakSet(queue)
    },
    admits(cmd) {
      // densable: !this.isHeadAhead&&(this.followersFrom?.has(e)??!0)
      return !isHeadAhead && (followersFrom?.has(cmd) ?? true)
    },
    reset() {
      isHeadAhead = false
      followersFrom = undefined
    },
  }
}

export type PrintPrewaitLatch = {
  interruptBeforeArm: (queue: readonly QueuedCommand[]) => void
  isDoomBoundary: (a: QueuedCommand, b: QueuedCommand) => boolean
  parkBatch: (intentBatchInFlight: boolean) => void
  dropParkedBatch: () => void
  reset: () => void
  /** densable note when user-intent cmds are already queued (arm helper). */
  noteUserIntentQueued: (queue: readonly QueuedCommand[]) => void
}

export type CreatePrintPrewaitLatchOpts = {
  isUserIntent: (cmd: QueuedCommand) => boolean
}

/**
 * densable Dm — latch user-intent commands at interrupt-before-arm so a
 * coalesce hold does not cross a doom boundary between latched and unlatched
 * commands.
 */
export function createPrintPrewaitLatch(
  opts: CreatePrintPrewaitLatchOpts,
): PrintPrewaitLatch {
  let interruptBeforeTurnArmed = false
  let intentDispatchPendingPreArm = false
  let latchDoomedCommands: WeakSet<QueuedCommand> | null = null
  let latchedWhileBatchParked = false

  const isUserIntent = opts.isUserIntent

  const reset = (): void => {
    interruptBeforeTurnArmed = false
    latchDoomedCommands = null
    latchedWhileBatchParked = false
  }

  return {
    interruptBeforeArm(queue) {
      if (
        !(intentDispatchPendingPreArm || queue.some(cmd => isUserIntent(cmd)))
      ) {
        return
      }
      interruptBeforeTurnArmed = true
      latchedWhileBatchParked = intentDispatchPendingPreArm
      latchDoomedCommands = new WeakSet(queue.filter(cmd => isUserIntent(cmd)))
    },
    isDoomBoundary(a, b) {
      // densable: interruptBeforeTurnArmed&&latch!==null&&has(a)!==has(b)
      return (
        interruptBeforeTurnArmed &&
        latchDoomedCommands !== null &&
        latchDoomedCommands.has(a) !== latchDoomedCommands.has(b)
      )
    },
    parkBatch(intentBatchInFlight) {
      intentDispatchPendingPreArm = intentBatchInFlight
    },
    dropParkedBatch() {
      reset()
      intentDispatchPendingPreArm = false
    },
    reset,
    noteUserIntentQueued(queue) {
      if (queue.some(cmd => isUserIntent(cmd))) {
        // Arm without requiring an interrupt if intent is already pending —
        // mirrors densable interruptBeforeArm queue.some(isUserIntent) gate.
        interruptBeforeTurnArmed = true
        latchedWhileBatchParked = intentDispatchPendingPreArm
        latchDoomedCommands = new WeakSet(
          queue.filter(cmd => isUserIntent(cmd)),
        )
      }
    },
  }
}

/**
 * densable commandLacksUserIntent inverted — main-thread prompt that is not
 * meta. Pass into createPrintPrewaitLatch({ isUserIntent }).
 */
export function isPrintUserIntentCommand(
  cmd: QueuedCommand,
  isMainThread: (cmd: QueuedCommand) => boolean,
): boolean {
  return isMainThread(cmd) && cmd.mode === 'prompt' && !cmd.isMeta
}
