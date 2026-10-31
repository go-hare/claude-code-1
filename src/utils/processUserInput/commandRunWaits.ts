/**
 * densable 2.1.289 `Lat` / `SZ` / `W0n` / `Ess`.
 *
 * Plugin `$.command.run` records a waiter keyed by queue uuid; slash takes it
 * so command.run can settle. Discard/consume fail the waiter. Never export
 * densable ids.
 */

export type CommandRunWaitHandle = {
  origin?: unknown
  settle: (result: unknown) => void
  fail: (error: unknown) => void
}

const waits = new Map<string, CommandRunWaitHandle>()

export const COMMAND_REMOVED_BEFORE_RUN =
  'the command was removed from the queue before it ran'

export const COMMAND_LEFT_QUEUE_AS_TEXT =
  'the command left the queue as text for the model; it did not run'

export const COMMAND_RUN_DID_NOT_RUN =
  'the command did not go through command.run (no command of that name was enabled by then, or it was refused before it ran)'

export const TURN_INTERRUPTED_BEFORE_COMMAND_RAN =
  'the turn was interrupted before the command ran'

/** densable `W0n` / `SZ.record`. */
export function recordCommandRunWait(
  uuid: string,
  origin?: unknown,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    waits.set(uuid, { origin, settle: resolve, fail: reject })
  })
}

/** densable `SZ.take`. */
export function takeCommandRunWait(
  uuid?: string,
): CommandRunWaitHandle | undefined {
  if (uuid === undefined) return undefined
  const handle = waits.get(uuid)
  waits.delete(uuid)
  return handle
}

/** densable Lat `r()` — fail waiters still in the map. */
export function failCommandRunWaits(
  commands: readonly { uuid?: string }[],
  message: string,
): void {
  for (const command of commands) {
    if (command.uuid === undefined) continue
    const handle = waits.get(command.uuid)
    if (!handle) continue
    waits.delete(command.uuid)
    handle.fail(new Error(message))
  }
}

/**
 * densable `Ess` — take at slash start; dispose fails Oat if never settled.
 */
export function wrapCommandRunWait(handle?: CommandRunWaitHandle): {
  origin: unknown
  settle: (result: unknown) => void
  fail: (error: unknown) => void
  [Symbol.dispose](): void
} {
  let done = false
  return {
    origin: handle?.origin,
    settle(result) {
      done = true
      handle?.settle(result)
    },
    fail(error) {
      done = true
      handle?.fail(error)
    },
    [Symbol.dispose]() {
      if (!done) {
        done = true
        handle?.fail(new Error(COMMAND_RUN_DID_NOT_RUN))
      }
    },
  }
}

/** Test / queue-reset cleanup. */
export function resetCommandRunWaits(): void {
  waits.clear()
}
