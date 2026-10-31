/**
 * densable 2.1.289 `nRt` / `U5e` / `Noe` / `tdo` / `vrs`.
 *
 * Plugin `$.prompt.submit` / `$.command.run` uuids marked when the outer hook
 * is turn.start | turn.complete. Never export densable ids.
 */

const marked = new Set<string>()

/** densable `Noe`. */
export function markTurnHookQueuedPrompt(
  uuid: string,
  rootEvent: string | undefined,
  queue: readonly { uuid?: string }[],
): void {
  if (rootEvent !== 'turn.start' && rootEvent !== 'turn.complete') return
  const live = new Set(
    queue
      .map(command => command.uuid)
      .filter((id): id is string => id !== undefined),
  )
  for (const id of marked) {
    if (!live.has(id)) marked.delete(id)
  }
  marked.add(uuid)
}

/** densable `tdo`. */
export function isTurnHookQueuedPrompt(uuid?: string): boolean {
  return uuid !== undefined && marked.has(uuid)
}

/** densable `vrs` — wait until the uuid is in the command queue. */
export function waitForTurnHookQueuedPrompt(uuid: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getCommandQueue, subscribeToCommandQueue } =
    require('../messageQueueManager.js') as typeof import('../messageQueueManager.js')
  if (getCommandQueue().some(command => command.uuid === uuid)) {
    return Promise.resolve()
  }
  return new Promise(resolve => {
    const unsubscribe = subscribeToCommandQueue(() => {
      if (getCommandQueue().some(command => command.uuid === uuid)) {
        unsubscribe()
        resolve()
      }
    })
  })
}

/** Test / queue-reset cleanup. densable `U5e.clear`. */
export function resetTurnHookQueuedPrompts(): void {
  marked.clear()
}
