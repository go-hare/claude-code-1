import { enqueueSdkEvent } from './sdkEventQueue.js'
import { getBootstrapSession, RootSessionSlot } from './sessionHost.js'

/**
 * densable S8o / Host command_lifecycle states (2.1.218 #11).
 * Pre-218 local only used started|completed; S8o also emits
 * queued (enqueued turn), cancelled (in-flight teardown), discarded
 * (still queued at close).
 */
export type CommandLifecycleState =
  | 'queued'
  | 'started'
  | 'completed'
  | 'cancelled'
  | 'discarded'

type CommandLifecycleListener = (
  uuid: string,
  state: CommandLifecycleState,
) => void

const fallbackCommandLifecycleSession = { root: {} as object }
const commandLifecycleBySession = new RootSessionSlot<{
  listener: CommandLifecycleListener | null
}>(() => ({ listener: null }))

function getCommandLifecycleState(): {
  listener: CommandLifecycleListener | null
} {
  try {
    const session = getBootstrapSession()
    if (session?.root) return commandLifecycleBySession.of(session)
  } catch {
    // Fall back when sessionHost is mocked
  }
  return commandLifecycleBySession.of(fallbackCommandLifecycleSession)
}

export function setCommandLifecycleListener(
  cb: CommandLifecycleListener | null,
): void {
  getCommandLifecycleState().listener = cb
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
  getCommandLifecycleState().listener?.(uuid, state)
  if (!uuid) return
  enqueueSdkEvent({
    type: 'command_lifecycle',
    uuid,
    state,
  })
}
