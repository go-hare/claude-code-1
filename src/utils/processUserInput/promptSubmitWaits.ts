/**
 * densable 2.1.289 `Gat` / `vZ` / `hss` / `LBn`.
 *
 * Plugin `$.prompt.submit` records a waiter keyed by queue uuid; Art takes it
 * (`Ios(hss(uuid))`) so Unn can settle the plugin promise. Enter Unn does not
 * record — screening uses `settleScreening`. Never export densable ids.
 */

export type PromptSubmitWaitHandle = {
  origin?: unknown
  settle: (result: unknown) => void
}

const waits = new Map<string, PromptSubmitWaitHandle>()

const REMOVED_BEFORE_RUN = 'the prompt was removed from the queue before it ran'

export const EARLIER_PROMPT_IN_BATCH_FAILED =
  'an earlier prompt in the batch failed'

/** densable `vZ.record` / `LBn`. */
export function recordPromptSubmitWait(
  uuid: string,
  origin?: unknown,
): Promise<unknown> {
  return new Promise(resolve => {
    waits.set(uuid, { origin, settle: resolve })
  })
}

/** densable `hss` — take-and-delete; undefined uuid is a no-op. */
export function takePromptSubmitWait(
  uuid?: string,
): PromptSubmitWaitHandle | undefined {
  if (uuid === undefined) return undefined
  const handle = waits.get(uuid)
  waits.delete(uuid)
  return handle
}

/**
 * densable `vZ.settleEach` — settle waiters still in the map. Art takes
 * first, so a later settleEach is a no-op for those uuids.
 */
export function settlePromptSubmitWaitsEach(
  commands: readonly { uuid?: string }[],
  result: () => unknown,
): void {
  for (const command of commands) {
    if (command.uuid === undefined) continue
    const handle = waits.get(command.uuid)
    if (!handle) continue
    waits.delete(command.uuid)
    handle.settle(result())
  }
}

/**
 * densable `vZ.settleEach` for queue `remove` / pop / clear. Drain dequeue
 * must not call this; Art takes the waiter first.
 */
export function settlePromptSubmitWaitsRemoved(
  commands: readonly { uuid?: string }[],
): void {
  settlePromptSubmitWaitsEach(commands, () => ({ drop: REMOVED_BEFORE_RUN }))
}

/**
 * densable `mss` / `Bat` — `using` around a WZe/Art batch. Dispose drops
 * waiters that Art never took.
 */
export function batchPromptSubmitWaitGuard(
  commands: readonly { uuid?: string }[],
): Disposable {
  return {
    [Symbol.dispose]() {
      settlePromptSubmitWaitsEach(commands, () => ({
        drop: EARLIER_PROMPT_IN_BATCH_FAILED,
      }))
    },
  }
}

/** Test / queue-reset cleanup. */
export function resetPromptSubmitWaits(): void {
  waits.clear()
}
