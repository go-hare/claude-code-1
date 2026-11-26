/**
 * Tracks timestamps of in-process settings-file writes so the chokidar watcher
 * in changeDetector.ts can ignore its own echoes.
 *
 * Extracted from changeDetector.ts to break the settings.ts → changeDetector.ts →
 * hooks.ts → … → settings.ts cycle. settings.ts needs to mark "I'm about to
 * write" before the write lands; changeDetector needs to read the mark when
 * chokidar fires. The map is the only shared state — everything else in
 * changeDetector (chokidar, hooks, mdm polling) is irrelevant to settings.ts.
 *
 * Callers pass resolved paths. The path→source resolution (getSettingsFilePathForSource)
 * lives in settings.ts, so settings.ts does it before calling here. No imports.
 */

import { createHash } from 'crypto'
import { normalize } from 'path'
import { getBootstrapSessionHost, HostSlot } from '../sessionHost.js'

type InternalWriteRecord = {
  markedAt: number
  contentHash: string | undefined
}

export type FirstReadStatSnapshot = {
  mtimeMs: number
  size: number
  ino?: number
  ctimeMs?: number
}

type HostInternalWritesState = {
  writes: Map<string, InternalWriteRecord>
  firstReads: Map<string, FirstReadStatSnapshot | null>
  ownWritesBeforeFirstCheck: Map<string, { contentHash: string }>
  firstReadsClosed: boolean
}

const hostInternalWritesSlot = new HostSlot<HostInternalWritesState>(() => ({
  writes: new Map(),
  firstReads: new Map(),
  ownWritesBeforeFirstCheck: new Map(),
  firstReadsClosed: false,
}))

function getHostInternalWritesState(): HostInternalWritesState {
  return hostInternalWritesSlot.of(getBootstrapSessionHost())
}

/**
 * Normalize line endings (CRLF -> LF, matching SEA `sV`) and hash with SHA-256
 * so `changeDetector` can compare disk contents against what we wrote.
 */
export function hashSettingsContent(content: string | Buffer): string {
  const text = (
    typeof content === 'string' ? content : content.toString('utf8')
  ).replaceAll('\r\n', '\n')
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

export function markInternalWrite(
  path: string,
  content?: string | Buffer,
): void {
  const state = getHostInternalWritesState()
  const key = normalize(path)
  const contentHash =
    content !== undefined ? hashSettingsContent(content) : undefined
  state.writes.set(key, {
    markedAt: Date.now(),
    contentHash,
  })
  if (!state.firstReadsClosed && contentHash !== undefined) {
    state.ownWritesBeforeFirstCheck.set(key, { contentHash })
  }
}

export function recordFirstReadStat(
  path: string,
  stat: FirstReadStatSnapshot | null,
): void {
  const state = getHostInternalWritesState()
  const key = normalize(path)
  if (!state.firstReadsClosed && !state.firstReads.has(key)) {
    state.firstReads.set(key, stat)
  }
}

export function hasFirstReadStat(path: string): boolean {
  return getHostInternalWritesState().firstReads.has(normalize(path))
}

export function getFirstReadStat(
  path: string,
): FirstReadStatSnapshot | null | undefined {
  return getHostInternalWritesState().firstReads.get(normalize(path))
}

export function getOwnWriteBeforeFirstCheck(
  path: string,
): { contentHash: string } | undefined {
  return getHostInternalWritesState().ownWritesBeforeFirstCheck.get(
    normalize(path),
  )
}

export function forgetFirstReads(): void {
  const state = getHostInternalWritesState()
  state.firstReadsClosed = true
  state.firstReads.clear()
  state.ownWritesBeforeFirstCheck.clear()
}

/**
 * Returns the recorded content hash (or `''` if marked without content) if
 * `path` was marked within `windowMs`, consuming the mark on match.
 * Returns `undefined` when no fresh mark exists.
 */
export function consumeInternalWrite(
  path: string,
  windowMs: number,
): string | undefined {
  const state = getHostInternalWritesState()
  const key = normalize(path)
  const rec = state.writes.get(key)
  if (rec !== undefined && Date.now() - rec.markedAt < windowMs) {
    state.writes.delete(key)
    return rec.contentHash ?? ''
  }
  return undefined
}

export function clearInternalWrites(): void {
  const state = getHostInternalWritesState()
  state.writes.clear()
  state.firstReads.clear()
  state.ownWritesBeforeFirstCheck.clear()
  state.firstReadsClosed = false
}
