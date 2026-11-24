import type { QueuedCommand } from '../types/textInputTypes.js'
import {
  clearInFlightDrainBatch,
  dequeue,
  dequeueAllMatching,
  hasCommandsInQueue,
  peek,
  setInFlightDrainBatch,
} from './messageQueueManager.js'
import {
  getPromptSubmitLatch,
  isAheadOfSessionStart,
} from './processUserInput/promptSubmitEntries.js'

type ProcessQueueParams = {
  executeInput: (commands: QueuedCommand[]) => Promise<void>
  /** Official 2.1.328 (`t0t`): while SessionStart hooks run, wait unless false or ahead-of-session-start. */
  waitsOnSessionStart?: (cmd: QueuedCommand) => boolean
  /** Official 2.1.328 (`t0t` `H`): returns true if an Enter-screened promptSubmitted stamp is stale. */
  screeningStale?: (
    submitted: NonNullable<QueuedCommand['promptSubmitted']>,
  ) => boolean
}

type ProcessQueueResult = {
  processed: boolean
}

/**
 * Check if a queued command is a slash command (value starts with '/').
 * Official 2.1.328 (`r_` in `chunk@288448047.js`): for `ContentBlockParam[]`,
 * inspects the trailing block (`at(-1)`), matching `processUserInputBase`.
 */
function isSlashCommand(cmd: QueuedCommand): boolean {
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

/**
 * Processes commands from the queue.
 *
 * Slash commands (starting with '/') and bash-mode commands are processed
 * one at a time so each goes through the executeInput path individually.
 * Bash commands need individual processing to preserve per-command error
 * isolation, exit codes, and progress UI. Other non-slash commands are
 * batched: all items **with the same mode** as the highest-priority item
 * are drained at once and passed as a single array to executeInput — each
 * becomes its own user message with its own UUID. Different modes
 * (e.g. prompt vs task-notification) are never mixed because they are
 * treated differently downstream.
 *
 * The caller is responsible for ensuring no query is currently running
 * and for calling this function again after each command completes
 * until the queue is empty.
 *
 * @returns result with processed status
 */
export function processQueueIfReady({
  executeInput,
  waitsOnSessionStart = () => true,
  screeningStale,
}: ProcessQueueParams): ProcessQueueResult {
  // densable AL(cmd): main thread is agentId===mi(). Skip subagent-addressed
  // commands — an unfiltered peek returning a subagent notification would
  // set targetMode, dequeueAllMatching would find nothing matching that mode
  // on the main AL, and we'd return processed:false with the queue unchanged
  // → React effect never re-fires and any queued user prompt stalls.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { isMainThreadQueuedCommand } =
    require('../bootstrap/state.js') as typeof import('../bootstrap/state.js')
  const isMainThread = (cmd: QueuedCommand) => isMainThreadQueuedCommand(cmd)
  const isDrainableMainThread = (cmd: QueuedCommand) =>
    isMainThread(cmd) && cmd.passive !== true

  const dispatchSingle = (cmd: QueuedCommand): ProcessQueueResult => {
    const taken = dequeue(c => c === cmd)!
    const batch = [taken]
    setInFlightDrainBatch(batch)
    void executeInput(batch).finally(() => clearInFlightDrainBatch(batch))
    return { processed: true }
  }

  // Official 2.1.328 (`t0t` in `chunk@319736883.js:1829150`): SessionStart
  // barrier — while SessionStart hooks are in flight, hold queued commands
  // unless they were explicitly stamped ahead-of-session-start or exempt.
  if (getPromptSubmitLatch() !== undefined) {
    const ahead = peek(
      cmd => isDrainableMainThread(cmd) && isAheadOfSessionStart(cmd.uuid),
    )
    const fallback = peek(isDrainableMainThread)
    const candidate =
      ahead ?? (fallback?.screeningPending === true ? undefined : fallback)
    if (!candidate || (ahead === undefined && waitsOnSessionStart(candidate))) {
      return { processed: false }
    }
    return dispatchSingle(candidate)
  }

  const next = peek(isDrainableMainThread)
  if (!next) {
    return { processed: false }
  }

  // densable KJ: first main-thread command still in Enter Unn — do not drain.
  if (next.screeningPending === true) {
    return { processed: false }
  }

  // Slash commands, bash-mode commands, and drainOnly/runsAlone items run solo.
  // Bash commands need per-command error isolation, exit codes, and progress UI.
  if (
    isSlashCommand(next) ||
    next.mode === 'bash' ||
    next.drainOnly === true ||
    (next as { runsAlone?: boolean }).runsAlone === true
  ) {
    return dispatchSingle(next)
  }

  // Official 2.1.328 t0t / cz (chunk@319736883.js @1829080-1830100):
  // Drain all non-slash-command items matching mode, priority tier, and
  // transcript-only (shouldQuery === false) polarity. Filtering to targetPriority
  // before checking screeningPending / drainOnly ensures 'now' items are never
  // blocked behind a screeningPending 'next' item. Also enforce:
  // - promptSubmitted staleness / stopped batch splitting
  // - `@`-mention split guard (`!value.includes('@')`) when coalescing screened prompts
  // - ideSelection.text split on second item
  const targetMode = next.mode
  const targetPriority = next.priority ?? 'next'
  const targetTranscriptOnly = next.shouldQuery === false
  let stop = false
  let batchCount = 0
  let prevScreenedFresh = true
  const commands = dequeueAllMatching(cmd => {
    if (stop) return false
    if (!isDrainableMainThread(cmd)) {
      return false
    }
    if ((cmd.priority ?? 'next') !== targetPriority) {
      return false
    }
    if (cmd.screeningPending === true) {
      stop = true
      return false
    }
    const runsAlone = (cmd as { runsAlone?: boolean }).runsAlone === true
    const screenedFresh =
      prevScreenedFresh &&
      cmd.drainOnly !== true &&
      !runsAlone &&
      cmd.promptSubmitted !== undefined &&
      cmd.promptSubmitted.stopped === undefined &&
      screeningStale !== undefined &&
      !screeningStale(cmd.promptSubmitted)
    if (
      (cmd.promptSubmitted !== undefined ||
        cmd.drainOnly === true ||
        runsAlone) &&
      !screenedFresh
    ) {
      stop = true
      if (batchCount > 0) return false
    }
    const matchesBatch =
      !isSlashCommand(cmd) &&
      cmd.mode === targetMode &&
      (cmd.shouldQuery === false) === targetTranscriptOnly
    if (batchCount > 0 && cmd.ideSelection?.text) {
      stop = true
      return false
    }
    if (
      batchCount > 0 &&
      prevScreenedFresh &&
      !(
        screenedFresh &&
        matchesBatch &&
        typeof cmd.value === 'string' &&
        !cmd.value.includes('@')
      )
    ) {
      stop = true
      return false
    }
    if (matchesBatch) {
      batchCount++
      prevScreenedFresh = screenedFresh
    }
    return matchesBatch
  })
  if (commands.length === 0) {
    return { processed: false }
  }

  setInFlightDrainBatch(commands)
  void executeInput(commands).finally(() => clearInFlightDrainBatch(commands))
  return { processed: true }
}

/**
 * Checks if the queue has pending commands.
 * Use this to determine if queue processing should be triggered.
 */
export function hasQueuedCommands(): boolean {
  return hasCommandsInQueue()
}
