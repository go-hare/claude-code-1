/**
 * Headless turn interrupt receipts, rewind settlement, async message cancellation,
 * and incoming control_cancel_request handling.
 */
import type { QueuedCommand } from 'src/types/textInputTypes.js'
import {
  settleTaken,
  requeueTaken,
  removeByFilter,
  getCommandQueueSnapshot,
  isFoldInFlight,
  dequeueAllMatching,
  forgoRequeue,
  markCancelPending,
} from 'src/utils/messageQueueManager.js'
import { isMainThreadQueuedCommand } from 'src/bootstrap/state.js'
import { createAbortErrorReason } from 'src/utils/abortController.js'
import { sleep } from 'src/utils/sleep.js'
import { logEvent } from 'src/services/analytics/index.js'
import type { Message, NormalizedUserMessage } from 'src/types/message.js'

export type HeadlessInterruptReceipt = {
  still_queued: string[]
  cancelled?: string[]
  put_back?: string[]
  turn?: 'stopped' | 'idle' | 'spared'
}

/**
 * Official 2.1.328 (`iw` + `Eh` in `chunk@323105654.js:367814, 825773-828500`):
 * Handle interrupt queue side effects (`requeueTaken` / `settleTaken` /
 * `cancel_queued: true`) and build the official receipt payload.
 */
export function buildHeadlessInterruptReceipt(opts: {
  cancelQueued: boolean
  turnOutcome?: 'stopped' | 'idle' | 'spared'
  onCommandLifecycle?: (uuid: string, state: 'queued' | 'cancelled') => void
  onPollEventsDiscarded?: (commands: QueuedCommand[], reason: string) => void
}): HeadlessInterruptReceipt {
  const {
    cancelQueued,
    turnOutcome,
    onCommandLifecycle,
    onPollEventsDiscarded,
  } = opts

  // Official `iw`: when not cancelling queued commands, resurrect any prompt
  // absorbed mid-turn within its interrupt requeue window.
  if (cancelQueued) {
    settleTaken()
  } else {
    const putBackCmd = requeueTaken()
    if (putBackCmd?.uuid !== undefined) {
      onCommandLifecycle?.(putBackCmd.uuid, 'queued')
    }
  }

  if (cancelQueued) {
    const removed = removeByFilter(
      cmd =>
        isMainThreadQueuedCommand(cmd) &&
        (cmd as { userStopNotice?: boolean }).userStopNotice !== true,
    )
    if (removed.length > 0) {
      onPollEventsDiscarded?.(removed, 'interrupt cleared the queue')
    }
    const cancelled: string[] = []
    for (const cmd of removed) {
      if (cmd.uuid !== undefined) {
        cancelled.push(cmd.uuid)
        onCommandLifecycle?.(cmd.uuid, 'cancelled')
      }
    }
    return {
      still_queued: [],
      cancelled,
      ...(turnOutcome !== undefined ? { turn: turnOutcome } : {}),
    }
  }

  const snapshot = getCommandQueueSnapshot()
  const stillQueued: string[] = snapshot
    .filter(isMainThreadQueuedCommand)
    .map(cmd => cmd.uuid)
    .filter((u): u is NonNullable<typeof u> => u !== undefined)
  const putBack = snapshot.flatMap(cmd =>
    (cmd as { runsAlone?: boolean }).runsAlone === true &&
    cmd.uuid !== undefined
      ? [cmd.uuid]
      : [],
  )
  return {
    still_queued: stillQueued,
    ...(putBack.length > 0 ? { put_back: putBack } : {}),
    ...(turnOutcome !== undefined ? { turn: turnOutcome } : {}),
  }
}

/**
 * Official 2.1.328 (`chunk@323105654.js:860400-861500`): when
 * `rewind_conversation` requests `interrupt_if_running: true`, abort the
 * active turn and await settlement BEFORE mutating `mutableMessages`.
 */
export async function interruptAndWaitForRewindSettlement(opts: {
  getAbortController: () => AbortController | undefined
  isRunning: () => boolean
  getSettlingPromise: () => Promise<void> | undefined
  timeoutMs?: number
}): Promise<{ settled: boolean }> {
  const timeoutMs = opts.timeoutMs ?? 10_000
  const deadline = Date.now() + timeoutMs
  opts.getAbortController()?.abort(createAbortErrorReason('remote-cancel'))

  const settling = opts.getSettlingPromise()
  if (settling !== undefined) {
    let timer: ReturnType<typeof setTimeout> | undefined
    await Promise.race([
      settling.catch(() => undefined),
      new Promise<void>(resolve => {
        timer = setTimeout(resolve, Math.max(0, deadline - Date.now()))
      }),
    ])
    if (timer !== undefined) clearTimeout(timer)
  }

  while (opts.isRunning() && Date.now() < deadline) {
    opts.getAbortController()?.abort(createAbortErrorReason('remote-cancel'))
    await sleep(20)
  }
  return { settled: !opts.isRunning() }
}

/**
 * Official 2.1.328 (`Fw` + `Dw` in `chunk@323105654.js:428066, 853787`):
 * Cancel a queued async message while guarding against in-flight mid-turn
 * folds, forgoing requeue, marking cancel-pending, and emitting lifecycle.
 */
export function handleHeadlessCancelAsyncMessage(opts: {
  targetUuid: string
  sender?: 'host' | 'remote_client'
  onCommandLifecycle?: (uuid: string, state: 'cancelled') => void
  onPollEventsDiscarded?: (commands: QueuedCommand[], reason: string) => void
  clearPrewaitIfNothingPending?: () => void
}): { cancelled: boolean; message_uuid?: string } {
  const sender = opts.sender ?? 'host'
  const { targetUuid } = opts
  const matchingBefore = getCommandQueueSnapshot().filter(
    cmd => cmd.uuid === targetUuid,
  )
  const canEchoUuid =
    matchingBefore.length > 0 &&
    matchingBefore.every(cmd => cmd.drainOnly !== true)

  const foldInFlight = isFoldInFlight(targetUuid)
  const removed = foldInFlight
    ? []
    : dequeueAllMatching(
        cmd =>
          cmd.uuid === targetUuid &&
          (sender === 'host' || cmd.bridgeOrigin === true),
      )

  if (removed.length === 0 && sender === 'host') {
    forgoRequeue(targetUuid)
  }
  if (removed.length === 0 && !foldInFlight && sender === 'host') {
    markCancelPending(targetUuid)
  }
  if (removed.length > 0) {
    opts.onPollEventsDiscarded?.(removed, 'cancelled by the host')
  }
  opts.clearPrewaitIfNothingPending?.()
  for (const cmd of removed) {
    if (cmd.uuid !== undefined) {
      opts.onCommandLifecycle?.(cmd.uuid, 'cancelled')
    }
  }
  const cancelled = removed.length > 0
  return cancelled && canEchoUuid
    ? { cancelled, message_uuid: targetUuid }
    : { cancelled }
}

/**
 * Official 2.1.328 (`chunk@323105654.js:917860`): abort an in-flight
 * control_request tracked by `request_id` when `control_cancel_request` arrives.
 */
export function handleIncomingControlCancelRequest(
  inFlightControlRequests: Map<string, AbortController>,
  requestId: string | undefined,
): boolean {
  const controller =
    requestId !== undefined ? inFlightControlRequests.get(requestId) : undefined
  logEvent('tengu_sdk_control_cancel_request', {
    in_flight: Boolean(controller),
  })
  if (!controller) return false
  controller.abort(createAbortErrorReason('remote-cancel'))
  return true
}

/**
 * Removes an interrupted user message and its synthetic assistant sentinel
 * from the message array. Used during gateway-triggered restarts to clean up
 * the message history before re-enqueuing the interrupted prompt.
 *
 * @internal Exported for testing
 */

export function removeInterruptedMessage(
  messages: Message[],
  interruptedUserMessage: NormalizedUserMessage,
): void {
  const idx = messages.findIndex(m => m.uuid === interruptedUserMessage.uuid)
  if (idx !== -1) {
    // Remove the user message and the sentinel that immediately follows it.
    // splice safely handles the case where idx is the last element.
    messages.splice(idx, 2)
  }
}
