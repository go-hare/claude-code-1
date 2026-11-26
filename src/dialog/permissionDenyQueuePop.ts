/**
 * Tip: Host/doo deny must restore queued commands the old
 * PermissionRequest onReject path used (popAllEditable).
 * REPL registers the popper; settle + interactiveHandler call it.
 */

import { getBootstrapSession, RootSessionSlot } from '../utils/sessionRoot.js'

const denyQueuePopBySession = new RootSessionSlot<{
  popper: (() => void) | null
}>(() => ({ popper: null }))

function getDenyQueuePopState(): { popper: (() => void) | null } {
  return denyQueuePopBySession.of(getBootstrapSession())
}

export function setPermissionDenyQueuePop(fn: (() => void) | null): void {
  getDenyQueuePopState().popper = fn
}

export function popQueuedCommandsOnPermissionDeny(): void {
  getDenyQueuePopState().popper?.()
}
