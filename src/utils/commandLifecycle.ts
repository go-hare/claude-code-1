import { enqueueSdkEvent } from './sdkEventQueue.js'

type CommandLifecycleState = 'started' | 'completed'

type CommandLifecycleListener = (
  uuid: string,
  state: CommandLifecycleState,
) => void

let listener: CommandLifecycleListener | null = null

export function setCommandLifecycleListener(
  cb: CommandLifecycleListener | null,
): void {
  listener = cb
}

/**
 * Official 2.1.x: command lifecycle is both a CCR delivery signal and a
 * stream-json `{ type: "command_lifecycle", uuid, state }` frame.
 * Listener covers remoteIO/CCR; enqueueSdkEvent covers print Host/SDK
 * (no-op in TUI via getIsNonInteractiveSession gate).
 */
export function notifyCommandLifecycle(
  uuid: string,
  state: CommandLifecycleState,
): void {
  listener?.(uuid, state)
  if (!uuid) return
  enqueueSdkEvent({
    type: 'command_lifecycle',
    uuid,
    state,
  })
}
