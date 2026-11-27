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
import {
  getBootstrapSessionHost,
  hasActiveSessionAls,
  HostSlot,
} from '../sessionHost.js'

type InternalWriteRecord = {
  markedAt: number
  contentHash: string | undefined
}

type ProcessWideInternalWriteRecord = InternalWriteRecord & {
  ownerHost: WeakRef<object>
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

const PROCESS_WIDE_INTERNAL_WRITE_TTL_MS = 60_000
const MAX_RECORDS_PER_PATH = 16

const hostInternalWritesSlot = new HostSlot<HostInternalWritesState>(() => ({
  writes: new Map(),
  firstReads: new Map(),
  ownWritesBeforeFirstCheck: new Map(),
  firstReadsClosed: false,
}))

/**
 * Process-wide path-keyed internal write marks (with short TTL and weak host
 * ownership) so the process-global chokidar watcher firing outside ALS can
 * suppress self-write echoes for writes initiated inside any isolated host.
 */
const processWideInternalWrites = new Map<
  string,
  ProcessWideInternalWriteRecord[]
>()

function getHostInternalWritesState(): HostInternalWritesState {
  return hostInternalWritesSlot.of(getBootstrapSessionHost())
}

function pruneProcessWideInternalWrites(now: number): void {
  for (const [pathKey, list] of processWideInternalWrites) {
    const alive = list.filter(
      rec =>
        now - rec.markedAt < PROCESS_WIDE_INTERNAL_WRITE_TTL_MS &&
        rec.ownerHost.deref() !== undefined,
    )
    if (alive.length === 0) {
      processWideInternalWrites.delete(pathKey)
    } else if (alive.length !== list.length) {
      processWideInternalWrites.set(pathKey, alive)
    }
  }
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
  const host = getBootstrapSessionHost()
  const state = hostInternalWritesSlot.of(host)
  const key = normalize(path)
  const now = Date.now()
  const contentHash =
    content !== undefined ? hashSettingsContent(content) : undefined
  state.writes.set(key, {
    markedAt: now,
    contentHash,
  })
  if (processWideInternalWrites.size > 64) {
    pruneProcessWideInternalWrites(now)
  }
  const existing = processWideInternalWrites.get(key)
  const nextList = (existing ?? []).filter(
    rec =>
      now - rec.markedAt < PROCESS_WIDE_INTERNAL_WRITE_TTL_MS &&
      rec.ownerHost.deref() !== undefined &&
      rec.ownerHost.deref() !== host,
  )
  nextList.push({
    markedAt: now,
    contentHash,
    ownerHost: new WeakRef(host),
  })
  if (nextList.length > MAX_RECORDS_PER_PATH) {
    nextList.splice(0, nextList.length - MAX_RECORDS_PER_PATH)
  }
  processWideInternalWrites.set(key, nextList)
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
 * Consume the newest fresh process-wide internal write mark for `path` across
 * all hosts (used by the process-global chokidar callback firing outside ALS).
 */
export function consumeProcessInternalWrite(
  path: string,
  windowMs: number,
): string | undefined {
  const key = normalize(path)
  const list = processWideInternalWrites.get(key)
  if (!list || list.length === 0) return undefined
  const now = Date.now()
  let matched: ProcessWideInternalWriteRecord | undefined
  const remaining: ProcessWideInternalWriteRecord[] = []
  for (let i = list.length - 1; i >= 0; i--) {
    const rec = list[i]!
    const owner = rec.ownerHost.deref()
    if (
      owner === undefined ||
      now - rec.markedAt >= PROCESS_WIDE_INTERNAL_WRITE_TTL_MS
    ) {
      continue
    }
    if (matched === undefined && now - rec.markedAt < windowMs) {
      matched = rec
      hostInternalWritesSlot.peek(owner)?.writes.delete(key)
      continue
    }
    remaining.push(rec)
  }
  if (remaining.length === 0) {
    processWideInternalWrites.delete(key)
  } else {
    remaining.reverse()
    processWideInternalWrites.set(key, remaining)
  }
  return matched !== undefined ? (matched.contentHash ?? '') : undefined
}

/**
 * Returns the recorded content hash (or `''` if marked without content) if
 * `path` was marked within `windowMs`, consuming the mark on match.
 * Returns `undefined` when no fresh mark exists.
 *
 * Inside an isolated ALS host, only consumes marks belonging to the active
 * host (preserving per-host isolation). Outside ALS (such as the process-global
 * chokidar callback), consumes from the process-wide path-keyed map so
 * self-write echoes from any host are suppressed.
 */
export function consumeInternalWrite(
  path: string,
  windowMs: number,
): string | undefined {
  if (!hasActiveSessionAls()) {
    return consumeProcessInternalWrite(path, windowMs)
  }
  const host = getBootstrapSessionHost()
  const state = hostInternalWritesSlot.of(host)
  const key = normalize(path)
  const rec = state.writes.get(key)
  if (rec !== undefined && Date.now() - rec.markedAt < windowMs) {
    state.writes.delete(key)
    const list = processWideInternalWrites.get(key)
    if (list) {
      const next = list.filter(
        entry =>
          entry.ownerHost.deref() !== undefined &&
          entry.ownerHost.deref() !== host,
      )
      if (next.length === 0) {
        processWideInternalWrites.delete(key)
      } else {
        processWideInternalWrites.set(key, next)
      }
    }
    return rec.contentHash ?? ''
  }
  return undefined
}

export function clearInternalWrites(): void {
  const host = getBootstrapSessionHost()
  const state = hostInternalWritesSlot.of(host)
  state.writes.clear()
  state.firstReads.clear()
  state.ownWritesBeforeFirstCheck.clear()
  state.firstReadsClosed = false
  if (!hasActiveSessionAls()) {
    processWideInternalWrites.clear()
    return
  }
  for (const [key, list] of processWideInternalWrites) {
    const next = list.filter(
      rec =>
        rec.ownerHost.deref() !== undefined && rec.ownerHost.deref() !== host,
    )
    if (next.length === 0) {
      processWideInternalWrites.delete(key)
    } else if (next.length !== list.length) {
      processWideInternalWrites.set(key, next)
    }
  }
}
