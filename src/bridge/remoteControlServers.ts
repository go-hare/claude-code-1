/**
 * densable 2.1.218 multi-env Remote Control server list (daemon_rc_add / qpn / jpn / OWs).
 *
 * densable:
 *   OWs(e) — normalize remoteControl config to array of {dir, ...}
 *   qpn({dir,name,spawnMode,...}) — daemon_rc_add upsert by dir
 *   jpn(dir) — daemon_rc_remove
 *   Add-server UI: if !EUe(dir) → Trust this directory? → Omt(dir) → qpn
 *
 * Local: persist on GlobalConfig.remoteControl (densable-compatible field).
 */

import { feature } from 'bun:bundle'
import { basename } from 'path'
import {
  getGlobalConfig,
  saveGlobalConfig,
  type GlobalConfig,
} from '../utils/config.js'

export type RemoteControlServerEntry = {
  dir: string
  name?: string
  spawnMode?: 'same-dir' | 'worktree'
  capacity?: number
  permissionMode?: string
  sandbox?: boolean
  createSessionOnStart?: boolean
}

/** densable OWs — normalize remoteControl field to entry array. */
export function normalizeRemoteControlList(
  value: unknown,
): RemoteControlServerEntry[] {
  if (Array.isArray(value)) {
    return value.filter(
      (t): t is RemoteControlServerEntry =>
        !!t &&
        typeof t === 'object' &&
        typeof (t as { dir?: unknown }).dir === 'string',
    )
  }
  if (
    value &&
    typeof value === 'object' &&
    typeof (value as { dir?: unknown }).dir === 'string'
  ) {
    return [value as RemoteControlServerEntry]
  }
  return []
}

export function listRemoteControlServers(): RemoteControlServerEntry[] {
  return normalizeRemoteControlList(getGlobalConfig().remoteControl)
}

/** densable $Lf row — name/spawnMode defaults + shared isRunning (daemon lock alive). */
export type RemoteControlServerView = {
  dir: string
  name: string
  spawnMode: 'same-dir' | 'worktree'
  isRunning: boolean
  capacity?: number
  permissionMode?: string
  sandbox?: boolean
  createSessionOnStart?: boolean
}

/**
 * densable $Lf — list remoteControl entries with status.
 * isRunning is global daemon alive (eI()!==null), not per-dir.
 */
export async function listRemoteControlServersWithStatus(): Promise<
  RemoteControlServerView[]
> {
  const list = listRemoteControlServers()
  let isRunning = false
  try {
    const { readAliveDaemonLock } = await import('../daemon/daemonLock.js')
    isRunning = (await readAliveDaemonLock()) !== null
  } catch {
    isRunning = false
  }
  return list.map(n => ({
    dir: n.dir,
    name: n.name?.trim() || basename(n.dir),
    spawnMode: n.spawnMode ?? 'same-dir',
    isRunning,
    ...(n.capacity !== undefined ? { capacity: n.capacity } : {}),
    ...(n.permissionMode !== undefined
      ? { permissionMode: n.permissionMode }
      : {}),
    ...(n.sandbox !== undefined ? { sandbox: n.sandbox } : {}),
    ...(n.createSessionOnStart !== undefined
      ? { createSessionOnStart: n.createSessionOnStart }
      : {}),
  }))
}

/**
 * densable zb — "daemon" when daemon feature/platform available, else
 * "background service". Used in Remove-server confirm copy.
 */
export function backgroundServiceLabel(): string {
  // densable: return xit() ? "daemon" : "background service"
  // feature() only in if/ternary (Bun compile constraint)
  if (feature('DAEMON')) {
    return 'daemon'
  }
  return 'background service'
}

/**
 * densable qpn / daemon_rc_add — upsert by dir.
 * @returns 'added' | 'updated'
 */
export function addRemoteControlServer(
  entry: RemoteControlServerEntry,
): 'added' | 'updated' {
  if (!entry.dir || typeof entry.dir !== 'string') {
    throw new Error('remoteControl entry requires dir')
  }
  let result: 'added' | 'updated' = 'added'
  saveGlobalConfig(current => {
    const list = normalizeRemoteControlList(current.remoteControl)
    const idx = list.findIndex(s => s.dir === entry.dir)
    const next: RemoteControlServerEntry = {
      ...entry,
      name: entry.name?.trim() || basename(entry.dir),
      spawnMode: entry.spawnMode ?? 'same-dir',
    }
    if (idx >= 0) {
      list[idx] = { ...list[idx], ...compactDefined(next) }
      result = 'updated'
    } else {
      list.push(next)
      result = 'added'
    }
    return { ...current, remoteControl: list } as GlobalConfig
  })
  return result
}

/** densable jpn / daemon_rc_remove */
export function removeRemoteControlServer(dir: string): boolean {
  let removed = false
  saveGlobalConfig(current => {
    const list = normalizeRemoteControlList(current.remoteControl)
    const next = list.filter(s => s.dir !== dir)
    if (next.length === list.length) return current
    removed = true
    // Always write the array (including empty). Test saveGlobalConfig uses
    // Object.assign which cannot delete keys; empty list is densable-valid.
    return { ...current, remoteControl: next } as GlobalConfig
  })
  return removed
}

function compactDefined<T extends Record<string, unknown>>(obj: T): T {
  const out = { ...obj }
  for (const k of Object.keys(out)) {
    if (out[k] === undefined) delete out[k]
  }
  return out
}
