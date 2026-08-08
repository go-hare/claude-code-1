/**
 * densable 2.1.217 #2 — transcript writer degraded tracking (CUs / iNt / Bsn / wUs).
 *
 * densable:
 * - Td_ = ENOSPC, EROFS, EDQUOT, ENAMETOOLONG (always degrade)
 * - wd_ = EACCES, EPERM (non-win32 degrade)
 * - Id_ sources = drain | materialize | adopt
 * - Hd_=3 consecutive failures, xd_=60000ms window → degrade
 * - kd_=300000ms consecutive window reset
 * - FUe store holds {code, source, filePath} or null
 * - events: tengu_transcript_write_failed / tengu_transcript_writer_recovered
 */

import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'

export type TranscriptWriterDegraded = {
  code: string
  source: TranscriptWriteSource
  filePath: string
}

export type TranscriptWriteSource =
  | 'drain'
  | 'materialize'
  | 'adopt'
  | 'append'
  | 'other'

const ALWAYS_DEGRADE_CODES = new Set([
  'ENOSPC',
  'EROFS',
  'EDQUOT',
  'ENAMETOOLONG',
])
const PERM_DEGRADE_CODES = new Set(['EACCES', 'EPERM'])
const TRACKED_SOURCES = new Set<TranscriptWriteSource>([
  'drain',
  'materialize',
  'adopt',
  'append',
])

const CONSECUTIVE_THRESHOLD = 3
const CONSECUTIVE_WINDOW_MS = 60_000
const CONSECUTIVE_GAP_MS = 300_000

type FailureStamp = {
  consecutive: number
  firstAtMs: number
  lastAtMs: number
}

let degraded: TranscriptWriterDegraded | null = null
const failureByPath = new Map<string, FailureStamp>()
const listeners = new Set<() => void>()

function emit(): void {
  for (const l of listeners) {
    try {
      l()
    } catch {
      // ignore subscriber errors
    }
  }
}

/** densable Bsn */
export function getTranscriptWriterDegraded(): TranscriptWriterDegraded | null {
  return degraded
}

/** densable wUs */
export function subscribeTranscriptWriterHealth(
  listener: () => void,
): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** densable Cd_ — whether errno should immediately degrade */
export function isImmediateTranscriptDegradeCode(
  code: string | undefined,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (code === undefined) return false
  if (ALWAYS_DEGRADE_CODES.has(code)) return true
  if (platform !== 'win32' && PERM_DEGRADE_CODES.has(code)) return true
  return false
}

function errnoCode(err: unknown): string | undefined {
  if (err && typeof err === 'object' && 'code' in err) {
    const c = (err as { code?: unknown }).code
    if (typeof c === 'string') return c
  }
  return undefined
}

/**
 * densable iNt — record a transcript write failure; may enter degraded state.
 */
export function recordTranscriptWriteFailure(
  source: TranscriptWriteSource,
  err: unknown,
  filePath = '<no-file>',
  now = Date.now(),
): void {
  const code = errnoCode(err) ?? 'unknown'
  const prev = failureByPath.get(filePath)
  const stamp: FailureStamp =
    prev !== undefined && now - prev.lastAtMs < CONSECUTIVE_GAP_MS
      ? {
          consecutive: prev.consecutive + 1,
          firstAtMs: prev.firstAtMs,
          lastAtMs: now,
        }
      : { consecutive: 1, firstAtMs: now, lastAtMs: now }
  failureByPath.set(filePath, stamp)

  let becameDegraded = false
  if (
    degraded === null &&
    filePath !== '<no-file>' &&
    TRACKED_SOURCES.has(source)
  ) {
    const consecutiveHit =
      stamp.consecutive >= CONSECUTIVE_THRESHOLD &&
      now - stamp.firstAtMs >= CONSECUTIVE_WINDOW_MS
    if (isImmediateTranscriptDegradeCode(code) || consecutiveHit) {
      degraded = { code, source, filePath }
      becameDegraded = true
    }
  }

  logEvent('tengu_transcript_write_failed', {
    source:
      source as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    errno_code:
      code as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    errno_enospc: code === 'ENOSPC',
    errno_emfile: code === 'EMFILE',
    consecutive_failures: stamp.consecutive,
    degraded: degraded !== null,
  })

  if (becameDegraded) emit()
}

/** densable EVd — clear failure stamp for path; recover if matching */
export function recordTranscriptWriteSuccess(filePath: string): void {
  failureByPath.delete(filePath)
  if (degraded?.filePath === filePath) {
    const prev = degraded
    degraded = null
    logEvent('tengu_transcript_writer_recovered', {
      source:
        prev.source as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    emit()
  }
}

/** densable AVd — test reset */
export function resetTranscriptWriterHealthForTest(): void {
  failureByPath.clear()
  degraded = null
  emit()
}

/**
 * densable wZd — when setSessionFile moves the active jsonl path, remap
 * writer-health stamps so consecutive-failure tracking follows the new file.
 * Also remaps the session sidecar dir (`foo.jsonl` → `foo/`).
 */
export function remapTranscriptWriterPaths(
  from: string | null,
  to: string | null,
): void {
  if (from === null || from === to) return
  const sideOf = (p: string): string | null =>
    p.endsWith('.jsonl') ? `${p.slice(0, -6)}/` : null
  const fromSide = sideOf(from)
  const toSide = to === null ? null : sideOf(to)
  const mapPath = (p: string): string | null => {
    if (p === from) return to
    if (fromSide !== null && p.startsWith(fromSide)) {
      return toSide === null ? null : toSide + p.slice(fromSide.length)
    }
    return p
  }
  for (const [key, stamp] of Array.from(failureByPath.entries())) {
    const next = mapPath(key)
    if (next !== key) {
      failureByPath.delete(key)
      if (next !== null) failureByPath.set(next, stamp)
    }
  }
  if (degraded !== null) {
    const next = mapPath(degraded.filePath)
    if (next !== degraded.filePath) {
      if (next === null) {
        degraded = null
      } else {
        degraded = { ...degraded, filePath: next }
      }
      emit()
    }
  }
}

/** densable woS human labels */
export const TRANSCRIPT_ERRNO_LABELS: Record<string, string> = {
  ENOSPC: 'disk full',
  EROFS: 'read-only filesystem',
  EDQUOT: 'disk quota exceeded',
  ENAMETOOLONG: 'path too long',
  EACCES: 'permission denied',
  EPERM: 'permission denied',
}

export function formatTranscriptWriterDegradedPrimary(
  state: TranscriptWriterDegraded,
): string {
  const label = TRANSCRIPT_ERRNO_LABELS[state.code]
  if (label) {
    return `Transcript writes are failing (${label} — ${state.code})`
  }
  return `Transcript writes are failing (${state.code})`
}

export function formatTranscriptWriterDegradedHint(): string {
  return '· recent messages may not be saved for resume'
}

export function formatTranscriptWriterDegradedNotificationText(
  state: TranscriptWriterDegraded,
): string {
  return `${formatTranscriptWriterDegradedPrimary(state)} ${formatTranscriptWriterDegradedHint()}`
}
