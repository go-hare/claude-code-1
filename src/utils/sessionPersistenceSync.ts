/**
 * 2.1.246 #49 — official persist-sync `ur` / `Wt` / `yo` / `zr`.
 * 09-16 promoted to HAVE.
 *
 * Official `Wt` @233514854: reverse `Qt`=`_i` @205118281, `dr`=`Tno`,
 * `Xt`=`si` JSON.parse, `sr`=`WJe`, `Xe`=`gh`, `ar`=`kno`, `Ke`=`on` ENOENT.
 * Gate: `o=t?fr(i):null; c=t&&o?or(t,o):Qt(i)`. `or`=`xeo`=`bSa`.
 * `zr`=`X` @207951400: hover+storage+K → `R`/`listEntries`; else FS.
 * `yo`=`d!==void 0?bo(d,i):lr`. `Jt`=`d` @205835800. `Zt`=`g`.
 */

import { readdir, stat } from 'fs/promises'
import { basename, dirname, join, sep as pathSep } from 'path'
import {
  getOriginalCwd,
  getSessionId,
  getSessionProjectDir,
} from '../bootstrap/state.js'
import { asAgentId } from '../types/ids.js'
import { logForDebugging } from './debug.js'
import { errorMessage, isENOENT } from './errors.js'
import { readLinesReverse } from './fsOperations.js'
import { isValidStoragePathSegment } from './sessionNameJobSidecar.js'
import { getProjectDir } from './sessionStoragePortable.js'
import { isHoverRestOn } from './storageV5/index.js'
import {
  applyScanPrecautionHold,
  isCanonicalSessionTranscriptBasename,
  isHistorySuppressionJsonlLine,
  getAgentTranscriptPath,
  getProject,
  getProjectsDir,
  getTranscriptPathForSession,
  isSessionHistorySuppressed,
  markSessionHistorySuppressed,
  setInternalEventReader,
  setInternalEventWriter,
  shouldSuppressSessionTitleHistory,
  type InternalEventReadResult,
} from './sessionStorage.js'

export type PersistEventWriter = (
  eventType: string,
  payload: Record<string, unknown>,
  options?: Record<string, unknown>,
) => Promise<void>

export type PersistTranscriptReaders = {
  readMain: () => Promise<{
    events?: Array<{ payload?: { uuid?: string } }>
  } | null>
  readSubagents: () => Promise<{
    events?: Array<{ payload?: { uuid?: string } }>
  } | null>
}

/**
 * The leftover readers carry the narrow view `backfillPersistedTranscripts` needs for uuid
 * dedup. The hydrate registry wants full payloads, so widen on the way in
 * rather than loosening what the backfill path declares.
 */
function asInternalEventReader(
  read: PersistTranscriptReaders['readMain'],
): () => Promise<InternalEventReadResult | null> {
  return async () => {
    const raw = await read()
    if (!raw?.events) return null
    return {
      events: raw.events.map(event => ({
        payload: (event.payload ?? {}) as Record<string, unknown>,
      })),
    }
  }
}

export type PersistEvent = {
  type: string
  uuid: string
  subtype?: string
  compactMetadata?: {
    preservedMessages?: { uuids?: string[] }
  }
}

/** densable leftover persist `Vt`. */
export const MAX_SUBAGENT_TRANSCRIPTS = 20

/** densable leftover persist `Rn` / `oad` / `Wn` @205858 — 5 MiB. */
export const MAX_SUBAGENT_TRANSCRIPT_BYTES = 5_242_880

/** densable leftover persist `ar` / `kno`. */
export const MAX_TRANSCRIPT_SCAN_LINES = 100_000

export type SubagentTranscriptEntry = {
  agentId: string
  path: string
  size: number
  mtimeMs: number
}

/**
 * densable leftover persist `Qe`/`Je`/`Ze` main path.
 * `h=a!==null&&Je(o,a)?a:Ze(o)`. Not getActiveSessionTranscriptPath (`zS()??Du()`).
 */
export function getMainTranscriptPathForPersist(sessionId?: string): string {
  const o = sessionId ?? getSessionId()
  const a = getProject().sessionFile
  return a !== null && isCanonicalSessionTranscriptBasename(o, a)
    ? a
    : getTranscriptPathForSession(o)
}

/** densable leftover persist `gh` / `Xe`. */
export function isCompactBoundaryEvent(event: PersistEvent): boolean {
  return event.type === 'system' && event.subtype === 'compact_boundary'
}

/** densable leftover persist `X$` type union. Official `pn` not inlined. */
export function isPersistableEventType(event: { type?: unknown }): boolean {
  return (
    event.type === 'user' ||
    event.type === 'assistant' ||
    event.type === 'attachment' ||
    event.type === 'system'
  )
}

/** densable leftover persist `WJe` / `sr`. */
export function isPersistEvent(event: unknown): event is PersistEvent {
  if (typeof event !== 'object' || event === null) return false
  if (!('type' in event) || !('uuid' in event)) return false
  const rec = event as { type?: unknown; uuid?: unknown }
  return typeof rec.uuid === 'string' && isPersistableEventType(rec)
}

/** densable leftover persist `si` / `Xt`. */
export function parsePersistTranscriptLine(line: string): unknown {
  return JSON.parse(line)
}

/** densable leftover persist `Qt` / `_i` @205118281 — `readLinesReverse`. */
export const readTranscriptLinesReverse = readLinesReverse

/** densable leftover persist `B6s` — first xeo page maxBytes. */
export const RECORD_PAGE_FIRST_MAX_BYTES = 262_144

/** densable leftover persist `Peo` — subsequent xeo page maxBytes. */
export const RECORD_PAGE_NEXT_MAX_BYTES = 2_097_152

/** densable leftover `_799` `L.transcript` / `Bn.transcript` / `j`. */
export type TranscriptStorageKey = {
  namespace: 'transcript'
  projectKey: string
  sessionId: string
  agentId?: string
  agentRelPath?: string[]
}

/**
 * densable leftover `_799` `j` / `Bn.transcript`.
 * `i(obj,k,v)` only adds when `v!==void 0`.
 */
export function createTranscriptStorageKey(
  projectKey: string,
  sessionId: string,
  agentId?: string,
  agentRelPath?: string[],
): TranscriptStorageKey {
  const key: TranscriptStorageKey = {
    namespace: 'transcript',
    projectKey,
    sessionId,
  }
  if (agentId !== undefined) key.agentId = agentId
  if (agentRelPath !== undefined) key.agentRelPath = agentRelPath
  return key
}

/**
 * densable leftover `tr` / `Q8c` / `Ua` @207280432 transcript arm.
 * Official `mn`/`Tn`/`an` are hb field tables (`Tn` @207246472), not a
 * leftover persist caller. `nr`=`Fad`=`every(C)`. `===void 0` → `qt`.
 */
export function getTranscriptKeyValidationError(
  key: TranscriptStorageKey,
): string | undefined {
  if (key.namespace !== 'transcript') return 'invalid'
  if (
    !isValidStoragePathSegment(key.projectKey) ||
    !isValidStoragePathSegment(key.sessionId)
  ) {
    return 'invalid'
  }
  if (key.agentId !== undefined && !isValidStoragePathSegment(key.agentId))
    return 'invalid'
  if (key.agentRelPath !== undefined) {
    if (
      !Array.isArray(key.agentRelPath) ||
      key.agentRelPath.length === 0 ||
      !key.agentRelPath.every(isValidStoragePathSegment)
    ) {
      return 'invalid'
    }
  }
  return undefined
}

/** densable leftover persist `qt`. */
export function asValidTranscriptKeyOrNull(
  key: TranscriptStorageKey,
): TranscriptStorageKey | null {
  return getTranscriptKeyValidationError(key) === undefined ? key : null
}

/**
 * densable leftover persist `fr` @233517100.
 * `er()`=`getProjectsDir()`, `Kt`=sep, `ye`=`isValidStoragePathSegment`, `nr`=every rv.
 */
export function parseTranscriptKeyFromPath(
  absPath: string,
): TranscriptStorageKey | null {
  const root = getProjectsDir() + pathSep
  if (!absPath.startsWith(root)) return null
  const segs = absPath.slice(root.length).split(pathSep)
  if (segs.length === 2 && segs[1]!.endsWith('.jsonl')) {
    const projectKey = segs[0]!
    const sessionId = segs[1]!.slice(0, -6)
    return isValidStoragePathSegment(projectKey) &&
      isValidStoragePathSegment(sessionId)
      ? asValidTranscriptKeyOrNull(
          createTranscriptStorageKey(projectKey, sessionId),
        )
      : null
  }
  if (
    segs.length >= 4 &&
    segs[2] === 'subagents' &&
    segs.at(-1)!.startsWith('agent-') &&
    segs.at(-1)!.endsWith('.jsonl')
  ) {
    const projectKey = segs[0]!
    const sessionId = segs[1]!
    const agentRelPath = segs.slice(3, -1)
    const agentId = segs.at(-1)!.slice(6, -6)
    return isValidStoragePathSegment(projectKey) &&
      isValidStoragePathSegment(sessionId) &&
      isValidStoragePathSegment(agentId) &&
      (agentRelPath.length === 0 ||
        agentRelPath.every(isValidStoragePathSegment))
      ? asValidTranscriptKeyOrNull(
          createTranscriptStorageKey(
            projectKey,
            sessionId,
            agentId,
            agentRelPath.length > 0 ? agentRelPath : undefined,
          ),
        )
      : null
  }
  return null
}

type TranscriptRecordStorage = {
  readRecords: (
    key: TranscriptStorageKey,
    opts: {
      order: 'backward'
      maxBytes?: number
      limit?: number
      fromSeq?: number
    },
  ) => Promise<
    | {
        ok: true
        value: {
          items: Array<{ seq: number; data: Uint8Array; byteLength?: number }>
          nextSeq?: number
        }
      }
    | { ok: false; error: { code?: string } }
  >
}

function coerceTranscriptRecordStorage(
  value: unknown,
): TranscriptRecordStorage | undefined {
  if (typeof value !== 'object' || value === null) return
  const rec = value as Record<string, unknown>
  if (typeof rec.readRecords !== 'function') return
  return value as TranscriptRecordStorage
}

/**
 * densable leftover persist `or`/`xeo` @218031079 (`bSa as or`).
 * Official `Wt` calls `or(t,o)` when `t&&o` — no extra reader gate.
 */
export async function* iterateTranscriptRecordPages(
  storage: unknown,
  key: TranscriptStorageKey,
): AsyncGenerator<string> {
  const e = coerceTranscriptRecordStorage(storage)
  if (!e) {
    throw new Error('v5 transcript stream read failed')
  }
  let fromSeq: number | undefined
  let anchor: Uint8Array | undefined
  let maxBytes = RECORD_PAGE_FIRST_MAX_BYTES
  let limitMode = false
  for (;;) {
    const page = await e.readRecords(
      key,
      limitMode
        ? { order: 'backward', limit: 2, fromSeq: fromSeq! }
        : {
            order: 'backward',
            maxBytes: maxBytes + (anchor?.byteLength ?? 0),
            ...(fromSeq !== undefined && { fromSeq }),
          },
    )
    if (!page.ok) {
      if (page.error.code === 'NotFound' && fromSeq === undefined) {
        const err = Object.assign(
          new Error(
            'ENOENT: no such file or directory, open (transcript stream)',
          ),
          { code: 'ENOENT', syscall: 'open' },
        )
        throw err
      }
      logForDebugging(
        `[transcript-reverse-read] stream read failed: ${page.error.code ?? 'error'}`,
      )
      throw new Error('v5 transcript stream read failed')
    }
    let items = page.value.items
    if (anchor !== undefined) {
      const head = items[0]
      if (
        head === undefined ||
        head.seq !== fromSeq ||
        Buffer.compare(Buffer.from(anchor), Buffer.from(head.data)) !== 0
      ) {
        logForDebugging(
          '[transcript-reverse-read] transcript stream changed between pages; abandoning the scan',
        )
        throw new Error('v5 transcript stream changed between pages')
      }
      items = items.slice(1)
    }
    if (items.length === 0) {
      if (page.value.nextSeq === undefined) return
      limitMode = true
      continue
    }
    limitMode = false
    let last: { seq: number; data: Uint8Array } | undefined
    for (const item of items) {
      const raw = item.data
      const end = raw.at(-1) === 10 ? raw.length - 1 : raw.length
      const line = Buffer.from(raw.buffer, raw.byteOffset, end).toString('utf8')
      if (line) {
        last = item
        yield line
      }
    }
    if (page.value.nextSeq === undefined) return
    if (last === undefined) {
      maxBytes += RECORD_PAGE_NEXT_MAX_BYTES
      continue
    }
    fromSeq = last.seq
    anchor = Buffer.from(last.data)
    maxBytes = RECORD_PAGE_NEXT_MAX_BYTES
  }
}

/** densable leftover persist `Ke` / `on` — ENOENT. */
export function isMissingTranscriptFile(err: unknown): boolean {
  return isENOENT(err)
}

/** densable leftover persist `Pn` / `Uwb` / `V`. */
export function getSubagentTranscriptPath(agentId: string): string {
  return getAgentTranscriptPath(asAgentId(agentId))
}

/** densable leftover persist `lr`. */
export async function readSubagentTranscriptFromDisk(
  agentId: string,
  filePath: string = getSubagentTranscriptPath(agentId),
): Promise<SubagentTranscriptEntry | null> {
  try {
    const s = await stat(filePath)
    return { agentId, path: filePath, size: s.size, mtimeMs: s.mtimeMs }
  } catch {
    return null
  }
}

/** densable leftover persist `Owb` / `K`. */
export function projectKeyIfDirectChildOfProjects(
  dir: string,
): string | undefined {
  return dirname(dir) === getProjectsDir() ? basename(dir) : undefined
}

/** densable leftover persist `wad` / `Zt`. */
export function createListPageBudget(pages = 10_000): {
  pagesLeft: number
  capped: number
} {
  return { pagesLeft: pages, capped: 0 }
}

type StorageListPage<T> =
  | {
      ok: true
      value: { items: T[]; cursor?: unknown }
    }
  | { ok: false; error: unknown }

/** densable leftover persist `vad` / `Jt` / `S` @205835800. */
export async function drainPagedListEntries<T>(
  fetchPage: (cursor?: unknown) => Promise<StorageListPage<T>>,
  consume: (items: T[]) => void | Promise<void>,
  opts?: {
    maxPages?: number
    budget?: { pagesLeft: number }
    until?: () => boolean
  },
): Promise<
  | { status: 'done' }
  | { status: 'capped' }
  | { status: 'error'; error: unknown }
> {
  const s = Math.max(1, Math.floor(opts?.maxPages ?? 10_000))
  let u: unknown
  for (let a = 0; a < s; a++) {
    if (opts?.budget !== undefined) {
      if (opts.budget.pagesLeft < 1) return { status: 'capped' }
      opts.budget.pagesLeft--
    }
    const n = await fetchPage(u)
    if (!n.ok) return { status: 'error', error: n.error }
    await consume(n.value.items)
    if (opts?.until?.()) return { status: 'done' }
    u = n.value.cursor
    if (!u) return { status: 'done' }
  }
  return { status: 'capped' }
}

type StorageListEntry = {
  kind?: string
  size?: number
  mtimeMs?: number
  key?: {
    namespace?: string
    projectKey?: string
    sessionId?: string
    agentId?: string
    agentRelPath?: string[]
  }
}

type ListEntriesStorage = {
  listEntries: (
    scope: Record<string, unknown>,
    opts: Record<string, unknown>,
  ) => Promise<StorageListPage<StorageListEntry>>
}

function coerceListEntriesStorage(
  value: unknown,
): ListEntriesStorage | undefined {
  if (typeof value !== 'object' || value === null) return
  const rec = value as Record<string, unknown>
  if (typeof rec.listEntries !== 'function') return
  return value as ListEntriesStorage
}

function joinTranscriptFolderKey(key: {
  projectKey: string
  sessionId: string
  agentRelPath?: string[]
}): string {
  return [key.projectKey, key.sessionId, ...(key.agentRelPath ?? [])].join('/')
}

/**
 * densable leftover persist `R` @207951616.
 * `t.listEntries` transcript keys with agentId and no agentRelPath.
 */
export async function listSubagentIdsForSession(
  storage: unknown,
  projectKey: string,
  sessionId: string,
): Promise<string[]> {
  const t = coerceListEntriesStorage(storage)
  if (!t) return []
  const r: string[] = []
  try {
    const page = await drainPagedListEntries(
      cursor =>
        t.listEntries(
          { namespace: 'transcript', projectKey, sessionId },
          {
            skipKeyStats: true,
            skipScopeStats: true,
            ...(cursor !== undefined && { cursor }),
          },
        ),
      items => {
        for (const i of items) {
          if (
            i.kind === 'key' &&
            i.key?.namespace === 'transcript' &&
            i.key.agentId !== undefined &&
            i.key.agentRelPath === undefined &&
            isValidStoragePathSegment(i.key.agentId)
          ) {
            r.push(i.key.agentId)
          }
        }
      },
    )
    return page.status === 'done' ? r : []
  } catch {
    return []
  }
}

/**
 * densable leftover persist `zr` / `Vwb` / `X` @207951400.
 * `l()&&t&&n → R(t,n,c())`; else FS `m()`.
 */
export async function listSessionTranscriptPaths(
  storageV5?: unknown,
): Promise<string[]> {
  const e = getSessionProjectDir() ?? getProjectDir(getOriginalCwd())
  const n = projectKeyIfDirectChildOfProjects(e)
  if (isHoverRestOn() && storageV5 !== undefined && n !== undefined) {
    return listSubagentIdsForSession(storageV5, n, getSessionId())
  }
  const dir = join(e, getSessionId(), 'subagents')
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    return entries
      .filter(
        s =>
          s.isFile() &&
          s.name.startsWith('agent-') &&
          s.name.endsWith('.jsonl'),
      )
      .map(s => s.name.slice(6, -6))
  } catch {
    return []
  }
}

/**
 * densable leftover persist `bo` @233515529.
 */
export async function readSubagentTranscriptsFromStorage(
  storage: unknown,
  agentIds: string[],
): Promise<Array<SubagentTranscriptEntry | null>> {
  const i = coerceListEntriesStorage(storage)
  const s = agentIds.map(c => {
    const f = getSubagentTranscriptPath(c)
    return { agentId: c, path: f, key: parseTranscriptKeyFromPath(f) }
  })
  const t = (c: TranscriptStorageKey | null): TranscriptStorageKey | null =>
    c !== null && c.namespace === 'transcript' && c.agentId !== undefined
      ? c
      : null
  const a = new Map<
    string,
    { projectKey: string; sessionId: string; agentRelPath?: string[] }
  >()
  for (const { key: c } of s) {
    const f = t(c)
    if (f !== null) {
      a.set(joinTranscriptFolderKey(f), {
        projectKey: f.projectKey,
        sessionId: f.sessionId,
        ...(f.agentRelPath !== undefined && { agentRelPath: f.agentRelPath }),
      })
    }
  }
  const h = new Map<string, Map<string, { size: number; mtimeMs: number }>>()
  const _ = createListPageBudget()
  if (i) {
    await Promise.all(
      [...a].map(
        async ([c, { projectKey: f, sessionId: y, agentRelPath: g }]) => {
          const A = new Map<string, { size: number; mtimeMs: number }>()
          h.set(c, A)
          const m = (): boolean => h.delete(c)
          const E =
            g === undefined
              ? `session ${y}`
              : `session ${y} subtree ${g.join('/')}`
          try {
            const C = await drainPagedListEntries(
              cursor =>
                i.listEntries(
                  {
                    namespace: 'transcript',
                    projectKey: f,
                    sessionId: y,
                    ...(g !== undefined && { agentRelPath: g }),
                  },
                  {
                    skipScopeStats: true,
                    ...(cursor !== undefined && { cursor }),
                  },
                ),
              items => {
                for (const P of items) {
                  if (
                    P.kind === 'key' &&
                    P.key?.namespace === 'transcript' &&
                    P.key.agentId !== undefined &&
                    joinTranscriptFolderKey({
                      projectKey: P.key.projectKey ?? '',
                      sessionId: P.key.sessionId ?? '',
                      agentRelPath: P.key.agentRelPath,
                    }) === c &&
                    P.size !== undefined &&
                    P.mtimeMs !== undefined
                  ) {
                    A.set(P.key.agentId, { size: P.size, mtimeMs: P.mtimeMs })
                  }
                }
              },
              { budget: _ },
            )
            if (C.status !== 'done') {
              logForDebugging(
                `[persistence-sync] subagent listing for ${E} ${
                  C.status === 'error'
                    ? `failed: ${errorMessage(C.error)}`
                    : 'was capped'
                } — its subagents are skipped`,
              )
              m()
            }
          } catch (C) {
            logForDebugging(
              `[persistence-sync] subagent listing for ${E} threw: ${errorMessage(C)} — its subagents are skipped`,
            )
            m()
          }
        },
      ),
    )
  }
  return Promise.all(
    s.map(async ({ agentId: c, path: f, key: y }) => {
      const g = t(y)
      if (g === null) return readSubagentTranscriptFromDisk(c, f)
      const A = h.get(joinTranscriptFolderKey(g))
      const m = A?.get(g.agentId!)
      if (m === undefined && A !== undefined) {
        logForDebugging(
          `[persistence-sync] subagent ${c} not in its folder's listing — skipped`,
        )
      }
      return m === undefined ? null : { agentId: c, path: f, ...m }
    }),
  )
}

/**
 * densable leftover persist `yo` @233514478.
 * `t=(d!==void 0?await bo(d,i):await Promise.all(i.map(lr)))`.
 */
export async function collectSubagentTranscripts(
  agentIds: string[],
  storageV5?: unknown,
): Promise<SubagentTranscriptEntry[]> {
  const t = (
    storageV5 !== undefined
      ? await readSubagentTranscriptsFromStorage(storageV5, agentIds)
      : await Promise.all(
          agentIds.map(id => readSubagentTranscriptFromDisk(id)),
        )
  ).filter((c): c is SubagentTranscriptEntry => c !== null)
  const o = t.filter(c => c.size <= MAX_SUBAGENT_TRANSCRIPT_BYTES)
  const a = o
    .sort((c, f) => f.mtimeMs - c.mtimeMs)
    .slice(0, MAX_SUBAGENT_TRANSCRIPTS)
  const overBytes = t.length - o.length
  const overAgents = o.length - a.length
  if (overBytes > 0 || overAgents > 0) {
    logForDebugging(
      `[persistence-sync] Subagent backfill capped: ${overBytes} over ${MAX_SUBAGENT_TRANSCRIPT_BYTES}B, ${overAgents} beyond ${MAX_SUBAGENT_TRANSCRIPTS}-agent limit (live stream unaffected)`,
    )
  }
  return a
}

/**
 * densable leftover persist `Wt` @233514854.
 * `o=t?fr(i):null; c=t&&o?or(t,o):Qt(i)`.
 */
export async function readTranscriptEventsReverse(
  transcriptPath: string,
  seen: ReadonlySet<string> = new Set(),
  continueAfterCompact = true,
  storageV5?: unknown,
): Promise<'tainted' | 'budget-exhausted' | PersistEvent[]> {
  const collected: PersistEvent[] = []
  let pastCompact = false
  try {
    let postCompact = 0
    const key = storageV5 ? parseTranscriptKeyFromPath(transcriptPath) : null
    const lines =
      storageV5 && key
        ? iterateTranscriptRecordPages(storageV5, key)
        : readTranscriptLinesReverse(transcriptPath)
    for await (const line of lines) {
      if (isHistorySuppressionJsonlLine(line)) {
        logForDebugging(
          '[persistence-sync] Refusing backfill: history-suppression entry in transcript',
        )
        return 'tainted'
      }
      if (pastCompact) {
        if (++postCompact >= MAX_TRANSCRIPT_SCAN_LINES) {
          logForDebugging(
            '[persistence-sync] Refusing backfill: pre-boundary taint sweep exhausted its line budget without a verdict',
          )
          return 'budget-exhausted'
        }
        continue
      }
      let parsed: unknown
      try {
        parsed = parsePersistTranscriptLine(line)
      } catch {
        continue
      }
      if (!isPersistEvent(parsed)) continue
      if (!seen.has(parsed.uuid)) collected.push(parsed)
      if (isCompactBoundaryEvent(parsed)) {
        if (!continueAfterCompact) break
        pastCompact = true
      }
    }
  } catch (err) {
    if (isMissingTranscriptFile(err)) return []
    throw err
  }
  return collected.reverse()
}

function buildPersistWriteOptions(
  event: PersistEvent,
  agentId?: string,
): Record<string, unknown> {
  return {
    ...(isCompactBoundaryEvent(event) && {
      isCompaction: true,
      preservedEventIds: event.compactMetadata?.preservedMessages?.uuids,
    }),
    ...(agentId !== undefined && { agentId }),
  }
}

/**
 * densable leftover `ur` @233512291.
 */
export async function backfillPersistedTranscripts(
  write: PersistEventWriter,
  readers: PersistTranscriptReaders,
  listing: string[] = [],
  storageV5?: unknown,
): Promise<{ uploadedMain: number; uploadedSubagents: number }> {
  if (isSessionHistorySuppressed()) {
    logForDebugging(
      '[persistence-sync] Refusing backfill: conversation carries a history-suppression taint',
    )
    return { uploadedMain: 0, uploadedSubagents: 0 }
  }
  const pinned = getSessionId()
  const [main, sub] = await Promise.all([
    readers.readMain(),
    readers.readSubagents(),
  ])
  const seen = new Set<string>()
  for (const event of main?.events ?? []) {
    const uuid = event.payload?.uuid
    if (typeof uuid === 'string') seen.add(uuid)
  }
  for (const event of sub?.events ?? []) {
    const uuid = event.payload?.uuid
    if (typeof uuid === 'string') seen.add(uuid)
  }
  logForDebugging(
    `[persistence-sync] Server has ${seen.size} events since compaction`,
  )
  const onWriteFail = (err: string): void => {
    logForDebugging(`[persistence-sync] Write failed: ${err}`)
  }
  if (pinned !== getSessionId()) {
    logForDebugging(
      '[persistence-sync] Refusing backfill: session id changed since the scan anchor was pinned (mid-scan /resume) — pinned content is not the current conversation',
    )
    return { uploadedMain: 0, uploadedSubagents: 0 }
  }
  if (shouldSuppressSessionTitleHistory(pinned)) {
    logForDebugging(
      '[persistence-sync] Refusing backfill: foreign binding or suppression carrier present at the post-await re-consult',
    )
    return { uploadedMain: 0, uploadedSubagents: 0 }
  }
  const mainPath = getMainTranscriptPathForPersist(pinned)
  const sweep = await readTranscriptEventsReverse(
    mainPath,
    seen,
    true,
    storageV5,
  )
  if (sweep === 'budget-exhausted') {
    applyScanPrecautionHold(pinned)
    logForDebugging(
      '[persistence-sync] Taint sweep budget exhausted: refusing this backfill (precautionary hold, no durable stamp)',
    )
    return { uploadedMain: 0, uploadedSubagents: 0 }
  }
  if (sweep === 'tainted') {
    markSessionHistorySuppressed(pinned as import('crypto').UUID)
    logForDebugging(
      '[persistence-sync] Main transcript tainted: aborting sync (subagents included), healing the in-memory flag',
    )
    return { uploadedMain: 0, uploadedSubagents: 0 }
  }
  for (const entry of sweep) {
    void write(
      'transcript',
      entry as Record<string, unknown>,
      buildPersistWriteOptions(entry),
    ).catch(err => onWriteFail(errorMessage(err)))
  }
  if (pinned !== getSessionId()) {
    logForDebugging(
      '[persistence-sync] Skipping subagent backfill: session id changed during the main read (mid-sync /resume)',
    )
    return { uploadedMain: sweep.length, uploadedSubagents: 0 }
  }
  let uploadedSubagents = 0
  for (const { agentId, path } of await collectSubagentTranscripts(
    listing,
    storageV5,
  )) {
    const subSweep = await readTranscriptEventsReverse(
      path,
      seen,
      false,
      storageV5,
    )
    if (subSweep === 'budget-exhausted') {
      applyScanPrecautionHold(pinned)
      break
    }
    if (subSweep === 'tainted') {
      markSessionHistorySuppressed(pinned as import('crypto').UUID)
      break
    }
    for (const entry of subSweep) {
      void write(
        'transcript',
        entry as Record<string, unknown>,
        buildPersistWriteOptions(entry, agentId),
      ).catch(err => onWriteFail(errorMessage(err)))
    }
    uploadedSubagents += subSweep.length
  }
  logForDebugging(
    `[persistence-sync] Uploaded ${sweep.length} main + ${uploadedSubagents} subagent entries`,
  )
  return { uploadedMain: sweep.length, uploadedSubagents }
}

/**
 * densable leftover init `Ei.onTransportPersistenceReady`.
 * `R||Ne()` → skip `ur`, still `ii`/`si`. `l=await zr(w); await ur(e,n,l,w)`.
 */
export function startTranscriptPersistenceBackfill(
  suppressed: boolean,
  writer: PersistEventWriter,
  readers: PersistTranscriptReaders,
  storageV5?: unknown,
): void {
  void (async () => {
    try {
      if (suppressed) {
        logForDebugging(
          '[bridge:repl] Persistence backfill suppressed (cross-account veto or foreign binding) — installing live writer only',
        )
      } else {
        const listing = await listSessionTranscriptPaths(storageV5)
        await backfillPersistedTranscripts(writer, readers, listing, storageV5)
      }
    } catch (err) {
      logForDebugging(
        `[bridge:repl] Persistence sync failed: ${errorMessage(err)}`,
        { level: 'error' },
      )
    }
    setInternalEventWriter(writer)
    setInternalEventReader(
      asInternalEventReader(readers.readMain),
      asInternalEventReader(readers.readSubagents),
    )
    logForDebugging(
      '[bridge:repl] Session persistence enabled — transcript writer + hydrate readers registered',
    )
  })()
}
