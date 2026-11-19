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

const writes = new Map<string, InternalWriteRecord>()
const firstReads = new Map<string, FirstReadStatSnapshot | null>()
const ownWritesBeforeFirstCheck = new Map<string, { contentHash: string }>()
let firstReadsClosed = false

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
  const key = normalize(path)
  const contentHash =
    content !== undefined ? hashSettingsContent(content) : undefined
  writes.set(key, {
    markedAt: Date.now(),
    contentHash,
  })
  if (!firstReadsClosed && contentHash !== undefined) {
    ownWritesBeforeFirstCheck.set(key, { contentHash })
  }
}

export function recordFirstReadStat(
  path: string,
  stat: FirstReadStatSnapshot | null,
): void {
  const key = normalize(path)
  if (!firstReadsClosed && !firstReads.has(key)) {
    firstReads.set(key, stat)
  }
}

export function hasFirstReadStat(path: string): boolean {
  return firstReads.has(normalize(path))
}

export function getFirstReadStat(
  path: string,
): FirstReadStatSnapshot | null | undefined {
  return firstReads.get(normalize(path))
}

export function getOwnWriteBeforeFirstCheck(
  path: string,
): { contentHash: string } | undefined {
  return ownWritesBeforeFirstCheck.get(normalize(path))
}

export function forgetFirstReads(): void {
  firstReadsClosed = true
  firstReads.clear()
  ownWritesBeforeFirstCheck.clear()
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
  const key = normalize(path)
  const rec = writes.get(key)
  if (rec !== undefined && Date.now() - rec.markedAt < windowMs) {
    writes.delete(key)
    return rec.contentHash ?? ''
  }
  return undefined
}

export function clearInternalWrites(): void {
  writes.clear()
  firstReads.clear()
  ownWritesBeforeFirstCheck.clear()
  firstReadsClosed = false
}
