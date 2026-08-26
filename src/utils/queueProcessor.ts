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

  // Slash commands and bash-mode commands are processed individually.
  // Bash commands need per-command error isolation, exit codes, and progress UI.
  if (isSlashCommand(next) || next.mode === 'bash') {
    const cmd = dequeue(cmd => cmd === next)!
    const batch = [cmd]
    setInFlightDrainBatch(batch)
    void executeInput(batch).finally(() => clearInFlightDrainBatch(batch))
    return { processed: true }
  }

  // Drain all non-slash-command items with the same mode at once.
  // Official Cuy: skip passive wake/receipt rows (they are not a user turn).
  const targetMode = next.mode
  const commands = dequeueAllMatching(
    cmd =>
      isMainThread(cmd) &&
      !isSlashCommand(cmd) &&
      cmd.passive !== true &&
      cmd.mode === targetMode,
  )
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
