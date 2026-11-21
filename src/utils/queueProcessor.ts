import type { QueuedCommand } from '../types/textInputTypes.js'
import {
  clearInFlightDrainBatch,
  dequeue,
  dequeueAllMatching,
  hasCommandsInQueue,
  peek,
  setInFlightDrainBatch,
} from './messageQueueManager.js'

type ProcessQueueParams = {
  executeInput: (commands: QueuedCommand[]) => Promise<void>
}

type ProcessQueueResult = {
  processed: boolean
}

/**
 * Check if a queued command is a slash command (value starts with '/').
 */
function isSlashCommand(cmd: QueuedCommand): boolean {
  if (cmd.mode === 'poll-event') {
    return false
  }
  if (typeof cmd.value === 'string') {
    return (
      cmd.value.trim().startsWith('/') &&
      (!cmd.skipSlashCommands || cmd.bridgeOrigin === true)
    )
  }
  // For ContentBlockParam[], check the first text block
  for (const block of cmd.value) {
    if (block.type === 'text') {
      return (
        block.text.trim().startsWith('/') &&
        (!cmd.skipSlashCommands || cmd.bridgeOrigin === true)
      )
    }
  }
  return false
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

  const next = peek(cmd => isMainThread(cmd) && cmd.passive !== true)
  if (!next) {
    return { processed: false }
  }

  // densable KJ: first main-thread command still in Enter Unn — do not drain.
  if (next.screeningPending === true) {
    return { processed: false }
  }

  // Slash commands and bash-mode commands are processed individually.
  // Bash commands need per-command error isolation, exit codes, and progress UI.
  // densable btt: drainOnly is taken as a singleton then stop.
  if (isSlashCommand(next) || next.mode === 'bash' || next.drainOnly === true) {
    const cmd = dequeue(cmd => cmd === next)!
    const batch = [cmd]
    setInFlightDrainBatch(batch)
    void executeInput(batch).finally(() => clearInFlightDrainBatch(batch))
    return { processed: true }
  }

  // Official 2.1.328 t0t / cz (chunk@319736883.js @1829080-1830100):
  // Drain all non-slash-command items matching mode, priority tier, and
  // transcript-only (shouldQuery === false) polarity. Filtering to targetPriority
  // before checking screeningPending / drainOnly ensures 'now' items are never
  // blocked behind a screeningPending 'next' item, and breaking on a second item
  // carrying ideSelection.text prevents dropping its selection.
  const targetMode = next.mode
  const targetPriority = next.priority ?? 'next'
  const targetTranscriptOnly = next.shouldQuery === false
  let stop = false
  let batchCount = 0
  const commands = dequeueAllMatching(cmd => {
    if (stop) return false
    if (!isMainThread(cmd) || cmd.passive === true) {
      return false
    }
    if ((cmd.priority ?? 'next') !== targetPriority) {
      return false
    }
    if (cmd.screeningPending === true || cmd.drainOnly === true) {
      stop = true
      return false
    }
    if (
      isSlashCommand(cmd) ||
      cmd.mode !== targetMode ||
      (cmd.shouldQuery === false) !== targetTranscriptOnly
    ) {
      return false
    }
    if (batchCount > 0 && cmd.ideSelection?.text) {
      stop = true
      return false
    }
    batchCount++
    return true
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
