/**
 * densable `n3e` / `BE.permissionRecheck` — emit after session permission
 * rule updates so queued ToolUseConfirm items re-run hasPermissionsToUseTool.
 */
import { getBootstrapSessionHost, HostSlot } from '../sessionHost.js'

type Listener = () => void

const listenersByHost = new HostSlot<Set<Listener>>(() => new Set())

export function emitPermissionRecheck(): void {
  const listeners = listenersByHost.peek(getBootstrapSessionHost())
  if (!listeners) return
  for (const listener of listeners) {
    try {
      listener()
    } catch {
      // ignore listener errors — densable EventEmitter style
    }
  }
}

export function onPermissionRecheck(listener: Listener): () => void {
  const listeners = listenersByHost.of(getBootstrapSessionHost())
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
