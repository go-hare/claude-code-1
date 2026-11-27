import { isDisklessActive, logDisklessWriteSkipped } from '../disklessGuards.js'
import { jsonParse } from '../slowOperations.js'
import {
  open as fsOpen,
  rename as fsRename,
  readFile,
  stat,
  unlink,
} from 'fs/promises'
import type { GcRowDisposition } from './types.js'
import { shouldSkipLowYieldCompact } from './sessionState.js'
import { fsyncDirBestEffort } from './fsHelpers.js'

const GC_ROW_DISPOSITION: Record<string, GcRowDisposition> = {
  user: 'transcript',
  assistant: 'transcript',
  system: 'transcript',
  attachment: 'transcript',
  progress: 'boundary-cleared',
  'file-history-snapshot': 'boundary-cleared',
  'file-history-delta': 'boundary-cleared',
  'last-prompt': 'boundary-cleared',
  'continued-in': 'boundary-cleared',
  'resume-head-vouch': 'boundary-cleared',
  'api-request-shape': 'boundary-cleared',
  'api-request-blob': 'boundary-cleared',
  'api-request': 'boundary-cleared',
  'api-request-resumed': 'boundary-cleared',
  'content-replacement': 'accumulate',
  'data-flow-records': 'accumulate',
  'data-flow-incomplete': 'accumulate',
  'fork-context-ref': 'accumulate',
  'frame-link': 'accumulate',
  'artifact-comment-monitor': 'accumulate',
  'memory-mode': 'accumulate',
  'derived-from': 'last-wins',
  summary: 'last-wins',
  'custom-title': 'last-wins',
  'ended-by-model': 'last-wins',
  'ai-title': 'last-wins',
  tag: 'last-wins',
  relocated: 'last-wins',
  'agent-name': 'last-wins',
  'agent-color': 'last-wins',
  'agent-setting': 'last-wins',
  'pr-link': 'last-wins',
  'artifact-autoreact-ledger': 'last-wins',
  'bridge-session': 'last-wins',
  'history-suppression': 'last-wins',
  'attribution-snapshot': 'last-wins',
  mode: 'last-wins',
  'permission-mode': 'last-wins',
  'repl-mode': 'last-wins',
  'session-model': 'last-wins',
  'isolation-latch': 'last-wins',
  'session-owner': 'last-wins',
  'dev-mods': 'last-wins',
  'atis-latch': 'last-wins',
  'tools-used': 'last-wins',
  'worktree-state': 'last-wins',
  'cost-state': 'last-wins',
  'queue-operation': 'last-wins',
  'observer-ref': 'last-wins',
}

/**
 * Official 2.1.328 `BZe`: large `last-wins` rows whose earlier occurrences are
 * dropped even on the same side of the latest `compact_boundary`.
 */
const GC_DROP_SUPERSEDED_LAST_WINS = new Set([
  'attribution-snapshot',
  'artifact-autoreact-ledger',
])

function getGcRowDisposition(type: string): GcRowDisposition {
  return GC_ROW_DISPOSITION[type] ?? 'accumulate'
}

/**
 * Official 2.1.328 (`chunk@294254613.js @401746`, `WZe` / `Htn` / `ztn`):
 * compute the set of line indices to retain during local transcript GC.
 *
 * Drops:
 *   - `tombstone` rows
 *   - pre-compact `transcript` and `boundary-cleared` rows before the latest
 *     `compact_boundary` (except `preservedMessages`, `preservedSegment`, and
 *     direct pre-boundary parents of post-boundary messages)
 *   - superseded `last-wins` rows before the boundary, `attribution-snapshot`
 *     rows at/before the latest non-preserved boundary, and superseded `BZe`
 *     (`attribution-snapshot`, `artifact-autoreact-ledger`) rows everywhere
 * while preserving `accumulate` metadata rows, the latest `last-wins` metadata
 * rows, post-boundary rows, and unparseable lines.
 */
export function buildTranscriptGcKeepLineSet(
  lines: readonly string[],
): Set<number> {
  type CompactMetaShape = {
    preservedMessages?: { uuids?: string[] }
    preservedSegment?: { headUuid?: string; tailUuid?: string }
  }

  let lastBoundaryIdx = -1
  let lastNonPreservedBoundaryIdx = -1
  let lastCompactMeta: CompactMetaShape | undefined

  const transcriptByUuid = new Map<
    string,
    { parent?: string | null; idx: number }
  >()
  const snapshotByMsgId = new Map<string, number>()
  const deltasByMsgId = new Map<string, number[]>()
  const keepIdx = new Set<number>()
  const lastMeta = new Map<string, { idx: number; type: string }>()
  const supersededLastWins = new Set<number>()
  const tombstoneIdx = new Set<number>()

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    if (!raw) continue
    let start = 0
    while (start < raw.length && raw.charCodeAt(start) === 0) start++
    const line = start > 0 ? raw.slice(start) : raw
    let obj: Record<string, unknown> | null = null
    try {
      const parsed = jsonParse(line)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        obj = parsed as Record<string, unknown>
      }
    } catch {
      obj = null
    }
    if (!obj) {
      keepIdx.add(i)
      continue
    }
    const type = typeof obj.type === 'string' ? obj.type : ''
    if (!type) {
      keepIdx.add(i)
      continue
    }
    if (type === 'tombstone') {
      tombstoneIdx.add(i)
      continue
    }
    if (type === 'file-history-snapshot' && typeof obj.messageId === 'string') {
      snapshotByMsgId.set(obj.messageId, i)
    } else if (
      type === 'file-history-delta' &&
      typeof obj.messageId === 'string'
    ) {
      const arr = deltasByMsgId.get(obj.messageId)
      if (arr) arr.push(i)
      else deltasByMsgId.set(obj.messageId, [i])
    }

    const disposition = getGcRowDisposition(type)
    if (disposition === 'transcript') {
      if (typeof obj.uuid === 'string') {
        const parent =
          typeof obj.parentUuid === 'string'
            ? obj.parentUuid
            : obj.parentUuid === null
              ? null
              : undefined
        transcriptByUuid.set(obj.uuid, { parent, idx: i })
      }
      if (type === 'system' && obj.subtype === 'compact_boundary') {
        lastBoundaryIdx = i
        const meta =
          obj.compactMetadata &&
          typeof obj.compactMetadata === 'object' &&
          !Array.isArray(obj.compactMetadata)
            ? (obj.compactMetadata as CompactMetaShape)
            : undefined
        lastCompactMeta = meta
        if (!meta?.preservedSegment && !meta?.preservedMessages) {
          lastNonPreservedBoundaryIdx = i
        }
      }
    } else if (disposition === 'accumulate') {
      keepIdx.add(i)
    } else if (disposition === 'last-wins') {
      const scopeId =
        type === 'summary'
          ? typeof obj.leafUuid === 'string'
            ? obj.leafUuid
            : ''
          : typeof obj.sessionId === 'string'
            ? obj.sessionId
            : ''
      const key = `${type}:${scopeId}`
      const prev = lastMeta.get(key)
      if (prev && GC_DROP_SUPERSEDED_LAST_WINS.has(type)) {
        supersededLastWins.add(prev.idx)
      }
      lastMeta.set(key, { idx: i, type })
    }
  }

  const buildFallbackAllNonTombstone = (): Set<number> => {
    const fallback = new Set<number>()
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i]) continue
      if (tombstoneIdx.has(i) || supersededLastWins.has(i)) continue
      fallback.add(i)
    }
    return fallback
  }

  if (lastBoundaryIdx < 0) {
    return buildFallbackAllNonTombstone()
  }

  // Preserve compactMetadata.preservedMessages or compactMetadata.preservedSegment
  if (Array.isArray(lastCompactMeta?.preservedMessages?.uuids)) {
    for (const uuid of lastCompactMeta.preservedMessages.uuids) {
      const rec = transcriptByUuid.get(uuid)
      if (!rec) {
        return buildFallbackAllNonTombstone()
      }
      keepIdx.add(rec.idx)
      const snapIdx = snapshotByMsgId.get(uuid)
      if (snapIdx !== undefined) keepIdx.add(snapIdx)
      const deltaIdxs = deltasByMsgId.get(uuid)
      if (deltaIdxs) {
        for (const d of deltaIdxs) keepIdx.add(d)
      }
    }
  } else if (
    lastCompactMeta?.preservedSegment?.headUuid &&
    lastCompactMeta?.preservedSegment?.tailUuid
  ) {
    const { headUuid, tailUuid } = lastCompactMeta.preservedSegment
    let cur: string | null | undefined = tailUuid
    const seen = new Set<string>()
    while (cur && !seen.has(cur)) {
      seen.add(cur)
      const rec = transcriptByUuid.get(cur)
      if (rec) {
        keepIdx.add(rec.idx)
        const snapIdx = snapshotByMsgId.get(cur)
        if (snapIdx !== undefined) keepIdx.add(snapIdx)
        const deltaIdxs = deltasByMsgId.get(cur)
        if (deltaIdxs) {
          for (const d of deltaIdxs) keepIdx.add(d)
        }
        if (cur === headUuid) break
      }
      cur = rec?.parent
    }
    if (cur !== headUuid) {
      return buildFallbackAllNonTombstone()
    }
  }

  // Preserve direct pre-boundary parents of post-boundary transcript messages
  for (const { parent, idx } of transcriptByUuid.values()) {
    if (!parent || idx < lastBoundaryIdx) continue
    const parentRec = transcriptByUuid.get(parent)
    if (parentRec && parentRec.idx < lastBoundaryIdx) {
      keepIdx.add(parentRec.idx)
    }
  }

  // Retain the latest pre-boundary `last-wins` metadata rows (`ztn`), dropping
  // `attribution-snapshot` rows at or before the latest non-preserved boundary.
  for (const { idx, type } of lastMeta.values()) {
    if (
      idx < lastBoundaryIdx &&
      (type !== 'attribution-snapshot' || idx > lastNonPreservedBoundaryIdx)
    ) {
      keepIdx.add(idx)
    }
  }

  const result = new Set<number>()
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i]) continue
    if (tombstoneIdx.has(i) || supersededLastWins.has(i)) continue
    if (i >= lastBoundaryIdx || keepIdx.has(i)) {
      result.add(i)
    }
  }
  return result
}

export function defaultTranscriptGcKeepLine(line: string): boolean {
  if (!line) return false
  try {
    const parsed = jsonParse(line) as { type?: unknown } | null
    if (parsed && typeof parsed === 'object' && parsed.type === 'tombstone') {
      return false
    }
  } catch {
    // Preserve unparseable lines rather than silently dropping data
  }
  return true
}

/**
 * Official #530 — split JSONL transcript strictly on `\n` (and strip trailing
 * `\r`), NEVER on Unicode line/paragraph separators U+2028 / U+2029, so
 * messages containing U+2028 or U+2029 are preserved intact during local GC.
 */
export function splitTranscriptJsonlLines(content: string): string[] {
  const lines: string[] = []
  let start = 0
  for (let i = 0; i <= content.length; i++) {
    if (i === content.length || content.charCodeAt(i) === 10) {
      let line = content.slice(start, i)
      if (line.endsWith('\r')) {
        line = line.slice(0, -1)
      }
      if (line.length > 0) {
        lines.push(line)
      }
      start = i + 1
    }
  }
  return lines
}

/**
 * Compact a transcript JSONL string by keeping only reachable/non-superseded
 * lines while preserving U+2028 / U+2029 and skipping low-yield rewrites (<10%).
 */
export function compactTranscriptJsonl(
  content: string,
  shouldKeepLine: (
    line: string,
    index: number,
  ) => boolean = defaultTranscriptGcKeepLine,
): {
  compacted: string
  skippedLowYield: boolean
  bytesBefore: number
  reclaimableBytes: number
} {
  const bytesBefore = Buffer.byteLength(content, 'utf8')
  const lines = splitTranscriptJsonlLines(content)
  const effectiveKeep: (line: string, index: number) => boolean =
    shouldKeepLine === defaultTranscriptGcKeepLine
      ? (() => {
          const keepSet = buildTranscriptGcKeepLineSet(lines)
          return (_line: string, index: number) => keepSet.has(index)
        })()
      : shouldKeepLine
  const kept: string[] = []
  let keptBytes = 0
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (effectiveKeep(line, i)) {
      kept.push(line)
      keptBytes += Buffer.byteLength(line, 'utf8') + 1
    }
  }
  const reclaimableBytes = Math.max(0, bytesBefore - keptBytes)
  if (reclaimableBytes === 0) {
    return {
      compacted: content,
      skippedLowYield: false,
      bytesBefore,
      reclaimableBytes: 0,
    }
  }
  if (shouldSkipLowYieldCompact(bytesBefore, reclaimableBytes)) {
    return {
      compacted: content,
      skippedLowYield: true,
      bytesBefore,
      reclaimableBytes,
    }
  }
  const compacted = kept.length > 0 ? `${kept.join('\n')}\n` : ''
  return {
    compacted,
    skippedLowYield: false,
    bytesBefore,
    reclaimableBytes,
  }
}

/**
 * Read 3 sample slices (start, middle, end — up to 4KB each) from `filePath`
 * at `size` so `compactTranscriptFileAtomic` can detect concurrent in-place
 * rewrites even when `ino`, `size`, and `mtimeMs` happen to match (#2104).
 */
async function readCompactSamples(
  filePath: string,
  size: number,
): Promise<Buffer[]> {
  const sampleBytes = 4096
  const ranges: Array<[number, number]> = [
    [0, Math.min(sampleBytes, size)],
    [
      Math.max(0, Math.floor(size / 2) - Math.floor(sampleBytes / 2)),
      Math.min(sampleBytes, size),
    ],
    [Math.max(0, size - sampleBytes), Math.min(sampleBytes, size)],
  ]
  const fh = await fsOpen(filePath, 'r')
  try {
    const out: Buffer[] = []
    for (const [offset, len] of ranges) {
      const buf = Buffer.alloc(len)
      let read = 0
      while (read < len) {
        const { bytesRead } = await fh.read(
          buf,
          read,
          len - read,
          offset + read,
        )
        if (bytesRead <= 0) break
        read += bytesRead
      }
      out.push(buf.subarray(0, read))
    }
    return out
  } finally {
    await fh.close().catch(() => {})
  }
}

/**
 * 2.1.304 #968 + 2.1.323 #2104 (SEA performCompactTranscript): Atomically
 * compact a transcript JSONL file via temp file + sync + rename, guarding
 * against concurrent rewrites by another process with `ino` + `size` +
 * `mtimeMs` + 3-slice content sample verification and trailing-newline check.
 */
export async function compactTranscriptFileAtomic(
  filePath: string,
  shouldKeepLine: (line: string, index: number) => boolean,
): Promise<{
  compacted: boolean
  skippedLowYield: boolean
  bytesBefore: number
  bytesAfter: number
  abortedReason?: 'snapshot_mid_line' | 'source_changed'
}> {
  if (isDisklessActive()) {
    logDisklessWriteSkipped(
      'sessionStorage:compactTranscriptFileAtomic',
      filePath,
    )
    return {
      compacted: false,
      skippedLowYield: false,
      bytesBefore: 0,
      bytesAfter: 0,
    }
  }
  const beforeStat = await stat(filePath)
  const beforeSamples = await readCompactSamples(filePath, beforeStat.size)
  const tailSample = beforeSamples[2]
  if (!tailSample || tailSample.length === 0 || tailSample.at(-1) !== 0x0a) {
    return {
      compacted: false,
      skippedLowYield: false,
      bytesBefore: beforeStat.size,
      bytesAfter: beforeStat.size,
      abortedReason: 'snapshot_mid_line',
    }
  }
  const content = await readFile(filePath, 'utf8')
  const { compacted, skippedLowYield, bytesBefore, reclaimableBytes } =
    compactTranscriptJsonl(content, shouldKeepLine)
  if (skippedLowYield || reclaimableBytes === 0) {
    return {
      compacted: false,
      skippedLowYield,
      bytesBefore,
      bytesAfter: bytesBefore,
    }
  }
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`
  let handle: Awaited<ReturnType<typeof fsOpen>> | undefined
  let renamed = false
  try {
    handle = await fsOpen(tmpPath, 'wx', 0o600)
    await handle.writeFile(compacted, 'utf8')
    try {
      await handle.sync()
    } catch {
      // Best-effort on filesystems without fsync
    }
    await handle.close()
    handle = undefined
    const currentStat = await stat(filePath)
    // Official 2.1.323 #2104: check inode (`ino`), size, mtimeMs, AND 3-slice
    // byte samples so concurrent replacement or in-place rewrite by another
    // process never loses messages.
    if (
      currentStat.ino !== beforeStat.ino ||
      currentStat.size !== beforeStat.size ||
      currentStat.mtimeMs !== beforeStat.mtimeMs
    ) {
      return {
        compacted: false,
        skippedLowYield: false,
        bytesBefore,
        bytesAfter: currentStat.size,
        abortedReason: 'source_changed',
      }
    }
    const afterSamples = await readCompactSamples(filePath, beforeStat.size)
    const sampleChanged = beforeSamples.some(
      (buf, idx) => !afterSamples[idx] || !buf.equals(afterSamples[idx]!),
    )
    if (sampleChanged) {
      return {
        compacted: false,
        skippedLowYield: false,
        bytesBefore,
        bytesAfter: currentStat.size,
        abortedReason: 'source_changed',
      }
    }
    await fsRename(tmpPath, filePath)
    renamed = true
    await fsyncDirBestEffort(filePath)
    return {
      compacted: true,
      skippedLowYield: false,
      bytesBefore,
      bytesAfter: Buffer.byteLength(compacted, 'utf8'),
    }
  } finally {
    if (handle !== undefined) {
      await handle.close().catch(() => {})
    }
    if (!renamed) {
      await unlink(tmpPath).catch(() => {})
    }
  }
}
