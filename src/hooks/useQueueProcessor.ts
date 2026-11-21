import { useEffect, useState, useSyncExternalStore } from 'react'
import { isMainThreadQueuedCommand } from '../bootstrap/state.js'
import { useMessageQueue } from '../state/AppState.js'
import type { Store } from '../state/store.js'
import type { QueuedCommand } from '../types/textInputTypes.js'
import type { QueryGuard } from '../utils/QueryGuard.js'
import { processQueueIfReady } from '../utils/queueProcessor.js'

type UseQueueProcessorParams = {
  executeQueuedInput: (commands: QueuedCommand[]) => Promise<void>
  hasActiveLocalJsxUI: boolean
  queryGuard: QueryGuard
  awaitSessionStartHooks: (signal: AbortSignal) => Promise<void> | undefined
  handOverInFlight: Pick<Store<boolean>, 'subscribe' | 'getSnapshot'>
}

/**
 * Hook that processes queued commands when conditions are met.
 *
 * Uses a single unified command queue (module-level store). Priority determines
 * processing order: 'now' > 'next' (user input) > 'later' (task notifications).
 * The dequeue() function handles priority ordering automatically.
 *
 * Processing triggers when:
 * - No query active (queryGuard — reactive via useSyncExternalStore)
 * - Queue has items
 * - No active local JSX UI blocking input
 */
export function useQueueProcessor({
  executeQueuedInput,
  hasActiveLocalJsxUI,
  queryGuard,
  awaitSessionStartHooks,
  handOverInFlight,
}: UseQueueProcessorParams): void {
  // Subscribe to the query guard. Re-renders when a query starts or ends
  // (or when reserve/cancelReservation transitions dispatching state).
  const isQueryActive = useSyncExternalStore(
    queryGuard.subscribe,
    queryGuard.getSnapshot,
  )

  // Subscribe to the unified command queue via useSyncExternalStore.
  // This guarantees re-render when the store changes, bypassing
  // React context propagation delays that cause missed notifications in Ink.
  const messageQueue = useMessageQueue()
  const queueSnapshot = useSyncExternalStore(
    messageQueue.subscribe,
    messageQueue.getSnapshot,
  )

  const handover = useSyncExternalStore(
    handOverInFlight.subscribe,
    handOverInFlight.getSnapshot,
  )
  const [settledHooks, setSettledHooks] = useState(0)
  useEffect(() => {
    // Official Ruy: snapshot OR live isActive. forceEnd() flips both, but a
    // reserve()/tryStart() in the same tick can leave the snapshot stale.
    if (isQueryActive || queryGuard.isActive) return
    if (handover || handOverInFlight.getSnapshot()) return
    if (hasActiveLocalJsxUI) return
    if (queueSnapshot.length === 0) return

    // Official 2.1.328 lHe: resurrected rows wait outside the reservation so
    // an interrupted SessionStart wait cannot repeatedly dequeue them.
    const actionable = queueSnapshot.filter(
      command =>
        isMainThreadQueuedCommand(command) &&
        command.passive !== true &&
        command.mode !== 'poll-event',
    )
    if (
      actionable.length > 0 &&
      actionable.every(command => command.admissionExempt === 'resurrected')
    ) {
      const pending = awaitSessionStartHooks(new AbortController().signal)
      if (pending) {
        let active = true
        void pending
          .catch(() => {})
          .then(() => {
            if (!active) return
            if (
              !queryGuard.isActive &&
              !hasActiveLocalJsxUI &&
              !handOverInFlight.getSnapshot() &&
              messageQueue.getLength() > 0
            ) {
              processQueueIfReady({ executeInput: executeQueuedInput })
            }
            setSettledHooks(value => value + 1)
          })
        return () => {
          active = false
        }
      }
    }

    // Reservation is now owned by handlePromptSubmit (inside executeUserInput's
    // try block). The sync chain executeQueuedInput → handlePromptSubmit →
    // executeUserInput → queryGuard.reserve() runs before the first real await,
    // so by the time React re-runs this effect (due to the dequeue-triggered
    // snapshot change), isQueryActive is already true (dispatching) and the
    // guard above returns early. handlePromptSubmit's finally releases the
    // reservation via cancelReservation() (no-op if onQuery already ran end()).
    processQueueIfReady({ executeInput: executeQueuedInput })
  }, [
    queueSnapshot,
    isQueryActive,
    executeQueuedInput,
    hasActiveLocalJsxUI,
    queryGuard,
    awaitSessionStartHooks,
    settledHooks,
    handOverInFlight,
    handover,
  ])
}
