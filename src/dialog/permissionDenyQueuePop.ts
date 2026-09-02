/**
 * Tip: Host/doo deny must restore queued commands the old
 * PermissionRequest onReject path used (popAllEditable).
 * REPL registers the popper; settle + interactiveHandler call it.
 */

let popper: (() => void) | null = null

export function setPermissionDenyQueuePop(fn: (() => void) | null): void {
  popper = fn
}

export function popQueuedCommandsOnPermissionDeny(): void {
  popper?.()
}
