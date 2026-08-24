/**
 * densable `n3e` / `BE.permissionRecheck` — emit after session permission
 * rule updates so queued ToolUseConfirm items re-run hasPermissionsToUseTool.
 */

type Listener = () => void

const listeners = new Set<Listener>()

export function emitPermissionRecheck(): void {
  for (const listener of listeners) {
    try {
      listener()
    } catch {
      // ignore listener errors — densable EventEmitter style
    }
  }
}

export function onPermissionRecheck(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
