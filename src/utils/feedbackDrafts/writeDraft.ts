import { mkdir, open, readdir, readFile, stat, unlink } from 'fs/promises'
import { basename, dirname, join } from 'path'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js'
import { getSessionId } from '../../bootstrap/state.js'
import { isENOENT } from '../errors.js'
import { getClaudeConfigHomeDir } from '../envUtils.js'
import { isValidStoragePathSegment } from '../sessionNameJobSidecar.js'
import {
  getProjectDir,
  getProjectsDir,
  getTranscriptPathForSession,
} from '../sessionPaths.js'
import { logForDebugging } from '../debug.js'
import { jsonStringify } from '../slowOperations.js'
import { atomicWriteFileWithMode } from '../storageV5/atomicWrite.js'
import { validateStorageKey } from '../storageV5/writeValidate.js'
import type { StorageV5 } from '../storageV5/createLocalFsBackend.js'
import {
  FEEDBACK_DRAFT_FILE_MODE,
  FEEDBACK_DRAFT_TTL_MS,
  FEEDBACK_PROJECT_DIR_KEY_RE,
  FEEDBACK_TRANSCRIPT_AVAIL_TAIL_BYTES,
  MAX_FEEDBACK_DRAFT_BYTES,
  MAX_KEPT_FEEDBACK_DRAFTS,
} from './constants.js'
import {
  type FeedbackDraft,
  isFeedbackDraftId,
  isFeedbackFailureMode,
  isFeedbackSessionId,
  isFeedbackTaskCategory,
  isFeedbackThinkingType,
  isFeedbackTrigger,
  isFeedbackType,
} from './draft.js'
import {
  clearFeedbackNoticeForDraft,
  decrementSessionDraftCount,
} from './notice.js'

export type FeedbackDraftStorageKey = {
  namespace: 'feedbackDraft'
  draftId: string
}

export type WriteFeedbackDraftResult =
  | { success: true; draft: FeedbackDraft; evicted: FeedbackDraft[] }
  | { success: false; reason: 'too_large' | 'write_failed' }

function asStorage(value: unknown): StorageV5 | undefined {
  if (!value || typeof value !== 'object') return
  const rec = value as Partial<StorageV5>
  if (
    typeof rec.write !== 'function' ||
    typeof rec.delete !== 'function' ||
    typeof rec.listEntries !== 'function' ||
    typeof rec.read !== 'function'
  ) {
    return
  }
  return value as StorageV5
}

function writeErrorLabel(error: unknown): string {
  if (!error || typeof error !== 'object') return 'unknown'
  const rec = error as { telemetryCode?: unknown; code?: unknown }
  if (typeof rec.telemetryCode === 'string') return rec.telemetryCode
  if (typeof rec.code === 'string') {
    return typeof rec.telemetryCode === 'string'
      ? `${rec.code} ${rec.telemetryCode}`
      : rec.code
  }
  return 'unknown'
}

/** densable leftover UKe */
export function getFeedbackDraftsDir(): string {
  return join(getClaudeConfigHomeDir(), 'feedback', 'drafts')
}

/** densable leftover ygr */
export function feedbackDraftStorageKey(
  draftId: string,
): FeedbackDraftStorageKey {
  if (!isFeedbackDraftId(draftId)) throw Error('invalid feedback draft id')
  return { namespace: 'feedbackDraft', draftId }
}

/** densable leftover hgr */
export function feedbackDraftFilePath(draftId: string): string {
  if (!isFeedbackDraftId(draftId)) throw Error('invalid feedback draft id')
  return join(getFeedbackDraftsDir(), `${draftId}.json`)
}

function parseQueuedDraft(raw: unknown): FeedbackDraft | null {
  if (!raw || typeof raw !== 'object') return null
  const rec = raw as Record<string, unknown>
  if (typeof rec.draft_id !== 'string' || !isFeedbackDraftId(rec.draft_id)) {
    return null
  }
  if (
    typeof rec.created_at !== 'string' ||
    !Number.isFinite(Date.parse(rec.created_at))
  ) {
    return null
  }
  if (
    typeof rec.source_session_id !== 'string' ||
    !isFeedbackSessionId(rec.source_session_id)
  ) {
    return null
  }
  if (typeof rec.cwd !== 'string' || typeof rec.model !== 'string') return null
  if (typeof rec.cli_version !== 'string' || typeof rec.os !== 'string')
    return null
  if (!Array.isArray(rec.request_ids)) return null
  if (!isFeedbackType(rec.type) || typeof rec.title !== 'string') return null
  if (typeof rec.details !== 'string' || !isFeedbackTrigger(rec.trigger))
    return null
  if (rec.status !== 'queued') return null
  return {
    draft_id: rec.draft_id,
    created_at: new Date(Date.parse(rec.created_at)).toISOString(),
    source_session_id: rec.source_session_id,
    cwd: rec.cwd,
    model: rec.model,
    cli_version: rec.cli_version,
    os: rec.os,
    request_ids: rec.request_ids.filter(
      (id): id is string => typeof id === 'string',
    ),
    type: rec.type,
    title: rec.title,
    details: rec.details,
    ...(typeof rec.area === 'string' ? { area: rec.area } : {}),
    ...(isFeedbackFailureMode(rec.failure_mode)
      ? { failure_mode: rec.failure_mode }
      : {}),
    ...(isFeedbackTaskCategory(rec.task_category)
      ? { task_category: rec.task_category }
      : {}),
    trigger: rec.trigger,
    ...(typeof rec.effort === 'string' ? { effort: rec.effort } : {}),
    ...(isFeedbackThinkingType(rec.thinking_type)
      ? { thinking_type: rec.thinking_type }
      : {}),
    ...(typeof rec.thinking_budget === 'number'
      ? { thinking_budget: rec.thinking_budget }
      : {}),
    ...(typeof rec.message_count === 'number'
      ? { message_count: rec.message_count }
      : {}),
    ...(typeof rec.assistant_turn_count === 'number'
      ? { assistant_turn_count: rec.assistant_turn_count }
      : {}),
    ...(typeof rec.subagent_count === 'number'
      ? { subagent_count: rec.subagent_count }
      : {}),
    transcript_ref:
      rec.transcript_ref && typeof rec.transcript_ref === 'object'
        ? (rec.transcript_ref as FeedbackDraft['transcript_ref'])
        : null,
    status: 'queued',
  }
}

/** densable leftover Mfs */
async function listFeedbackDraftKeys(
  storage: StorageV5,
): Promise<FeedbackDraftStorageKey[] | null> {
  const keys: FeedbackDraftStorageKey[] = []
  let cursor: unknown
  for (let page = 0; page < 32; page++) {
    const listed = await storage.listEntries(
      { namespace: 'feedbackDraft' },
      { cursor, skipKeyStats: true },
    )
    if (!listed.ok) {
      const code = listed.error.telemetryCode
      if (code !== undefined) {
        logForDebugging(
          `feedbackDrafts: draft listing failed: ${writeErrorLabel(listed.error)}`,
          { level: 'error' },
        )
        return null
      }
      throw new Error(
        `feedback draft listing failed: ${writeErrorLabel(listed.error)}`,
      )
    }
    for (const item of listed.value.items) {
      const draftId = item.key?.draftId
      if (
        item.kind === 'key' &&
        item.key?.namespace === 'feedbackDraft' &&
        typeof draftId === 'string'
      ) {
        keys.push({ namespace: 'feedbackDraft', draftId })
      }
    }
    if (listed.value.cursor === undefined) return keys
    cursor = listed.value.cursor
  }
  logForDebugging(
    'feedbackDrafts: draft listing kept offering cursors past the page cap; treating it as failed',
    { level: 'error' },
  )
  return null
}

/** densable leftover wgr */
export async function deleteFeedbackDraft(
  draftId: string,
  storageV5?: unknown,
): Promise<boolean> {
  const storage = asStorage(storageV5)
  if (storage) {
    const deleted = await storage.delete(feedbackDraftStorageKey(draftId))
    if (!deleted.ok) {
      if (deleted.error.telemetryCode !== undefined) return false
      throw new Error(
        `feedback draft delete failed: ${writeErrorLabel(deleted.error)}`,
      )
    }
    return deleted.value.existed
  }
  try {
    await unlink(feedbackDraftFilePath(draftId))
    return true
  } catch (error) {
    if (isENOENT(error)) return false
    throw error
  }
}

export type TranscriptTailRead = {
  content: string
  bytesRead: number
  bytesTotal: number
}

/**
 * densable leftover Ri / Fkd / E — last `maxBytes` of a file.
 */
export async function readTranscriptTail(
  file: string,
  maxBytes: number,
): Promise<TranscriptTailRead> {
  const handle = await open(file, 'r')
  try {
    const { size } = await handle.stat()
    if (size === 0) {
      return { content: '', bytesRead: 0, bytesTotal: 0 }
    }
    const start = Math.max(0, size - maxBytes)
    const length = size - start
    const buf = Buffer.allocUnsafe(length)
    let offset = 0
    while (offset < length) {
      const { bytesRead } = await handle.read(
        buf,
        offset,
        length - offset,
        start + offset,
      )
      if (bytesRead === 0) break
      offset += bytesRead
    }
    return {
      content: buf.toString('utf8', 0, offset),
      bytesRead: offset,
      bytesTotal: size,
    }
  } finally {
    await handle.close()
  }
}

/** densable leftover ot `M<h` first-line drop after Ri */
export function dropTornTranscriptHead(
  content: string,
  bytesRead: number,
  bytesTotal: number,
): string {
  if (bytesRead >= bytesTotal) return content
  return content.slice(content.indexOf('\n') + 1)
}

/**
 * densable leftover Dfs / _Ba / _e — rebuild jsonl path.
 * Does not read `transcript_ref.session_file`.
 */
export async function resolveDraftTranscriptPath(
  draft: FeedbackDraft,
): Promise<string | null> {
  if (!draft.transcript_ref) return null
  if (!isFeedbackSessionId(draft.source_session_id)) return null
  if (draft.source_session_id === getSessionId()) {
    return getTranscriptPathForSession(draft.source_session_id)
  }
  const key = draft.transcript_ref.project_dir_key
  if (key !== undefined && FEEDBACK_PROJECT_DIR_KEY_RE.test(key)) {
    return join(getProjectsDir(), key, `${draft.source_session_id}.jsonl`)
  }
  return join(getProjectDir(draft.cwd), `${draft.source_session_id}.jsonl`)
}

/**
 * densable leftover Lfs — abs jsonl under projectsDir → transcript storage key.
 * After `ol` segments: `_r.transcript(r,o)` then `DE(s)===void 0?s:void 0`.
 * `DE` = leftover `z`/`Ua` = `validateStorageKey` (official `Ja`/`qcd`).
 */
export function transcriptAbsPathToStorageKey(
  file: string,
  projectsDir: string,
):
  | { namespace: 'transcript'; projectKey: string; sessionId: string }
  | undefined {
  if (!file.endsWith('.jsonl')) return
  const parent = dirname(file)
  const projectKey = basename(parent)
  const sessionId = basename(file).slice(0, -6)
  if (dirname(parent) !== projectsDir) return
  if (
    !isValidStoragePathSegment(projectKey) ||
    !isValidStoragePathSegment(sessionId)
  ) {
    return
  }
  const key = { namespace: 'transcript' as const, projectKey, sessionId }
  return validateStorageKey(key) === undefined ? key : undefined
}

/** densable leftover ogr */
export function transcriptContentCorroboratesDraft(
  content: string,
  draft: FeedbackDraft,
): boolean {
  for (const line of content.split('\n')) {
    if (!line) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }
    if (typeof parsed !== 'object' || parsed === null) continue
    const rec = parsed as Record<string, unknown>
    if (
      'sessionId' in rec &&
      'cwd' in rec &&
      rec.sessionId === draft.source_session_id &&
      rec.cwd === draft.cwd
    ) {
      return true
    }
  }
  return false
}

/** densable leftover Nfs */
export async function isFeedbackDraftTranscriptAvailable(
  draft: FeedbackDraft,
  storageV5?: unknown,
): Promise<boolean> {
  const file = await resolveDraftTranscriptPath(draft)
  if (file === null) return false
  const fromThisSession = draft.source_session_id === getSessionId()
  const storage = asStorage(storageV5)
  if (storage) {
    const key = transcriptAbsPathToStorageKey(file, getProjectsDir())
    if (key !== undefined) {
      try {
        if (fromThisSession) {
          return (await storage.statMeta(key)).ok
        }
        const read = await storage.read([
          { key, tail: FEEDBACK_TRANSCRIPT_AVAIL_TAIL_BYTES },
        ])
        if (!read.ok) return false
        const item = read.value.items[0]
        return (
          item.found === true &&
          item.value !== undefined &&
          transcriptContentCorroboratesDraft(
            Buffer.from(item.value).toString('utf8'),
            draft,
          )
        )
      } catch {
        return false
      }
    }
  }
  if (fromThisSession) {
    try {
      await stat(file)
      return true
    } catch {
      return false
    }
  }
  try {
    const tail = await readTranscriptTail(
      file,
      FEEDBACK_TRANSCRIPT_AVAIL_TAIL_BYTES,
    )
    return transcriptContentCorroboratesDraft(tail.content, draft)
  } catch {
    return false
  }
}

function persistableDraft(draft: FeedbackDraft): FeedbackDraft {
  const { transcriptAvailable: _ignored, ...rest } = draft
  return rest
}

/** densable leftover Sgr */
export async function listFeedbackDrafts(
  options: {
    now?: Date
    lightweight?: boolean
    skipTranscriptCheck?: boolean
  } = {},
  storageV5?: unknown,
): Promise<{ queued: FeedbackDraft[]; expired: FeedbackDraft[] }> {
  const now = options.now ?? new Date()
  const storage = asStorage(storageV5)
  const queued: FeedbackDraft[] = []
  const expired: FeedbackDraft[] = []
  let invalidId = 0
  let oversized = 0

  const loadOne = async (
    filename: string,
    bytes: Buffer | null,
  ): Promise<void> => {
    if (bytes === null) return
    if (bytes.length > MAX_FEEDBACK_DRAFT_BYTES) {
      oversized++
      return
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(bytes.toString('utf8'))
    } catch {
      return
    }
    const draft = parseQueuedDraft(parsed)
    if (!draft) {
      const draftId =
        parsed && typeof parsed === 'object'
          ? (parsed as { draft_id?: unknown }).draft_id
          : undefined
      if (typeof draftId === 'string' && !isFeedbackDraftId(draftId)) {
        invalidId++
      }
      return
    }
    if (filename !== `${draft.draft_id}.json`) {
      invalidId++
      return
    }
    const created = Date.parse(draft.created_at)
    if (
      Number.isFinite(created) &&
      now.getTime() - created > FEEDBACK_DRAFT_TTL_MS
    ) {
      if (options.lightweight === true) return
      if (
        await deleteFeedbackDraft(draft.draft_id, storageV5).catch(() => false)
      ) {
        expired.push(draft)
        logEvent('tengu_feedback_draft_expired', {
          type: draft.type as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          trigger:
            draft.trigger as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          age_days: Math.round(
            (now.getTime() - created) / 86400000,
          ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        })
      }
      return
    }
    queued.push({
      ...draft,
      transcriptAvailable: options.skipTranscriptCheck
        ? false
        : await isFeedbackDraftTranscriptAvailable(draft, storageV5),
    })
  }

  if (storage) {
    const keys = await listFeedbackDraftKeys(storage)
    if (keys === null) return { queued: [], expired: [] }
    for (const key of keys) {
      const read = await storage.read([
        { key, tail: MAX_FEEDBACK_DRAFT_BYTES + 1 },
      ])
      const item = read.ok ? read.value.items[0] : undefined
      const bytes =
        item?.found && item.value !== undefined ? Buffer.from(item.value) : null
      await loadOne(`${key.draftId}.json`, bytes)
    }
  } else {
    let names: string[]
    try {
      names = await readdir(getFeedbackDraftsDir())
    } catch (error) {
      if (isENOENT(error)) return { queued: [], expired: [] }
      throw error
    }
    for (const name of names.filter(file => file.endsWith('.json'))) {
      let bytes: Buffer
      try {
        bytes = await readFile(join(getFeedbackDraftsDir(), name))
      } catch {
        continue
      }
      await loadOne(name, bytes)
    }
  }

  queued.sort((a, b) => b.created_at.localeCompare(a.created_at))
  if (invalidId > 0) {
    logEvent('tengu_feedback_draft_invalid_id', {
      count:
        invalidId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
  }
  if (oversized > 0) {
    logEvent('tengu_feedback_draft_oversized_file', {
      count:
        oversized as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
  }
  return { queued, expired }
}

/** densable leftover bgr */
export async function writeFeedbackDraft(
  draft: FeedbackDraft,
  now: Date = new Date(),
  storageV5?: unknown,
): Promise<WriteFeedbackDraftResult> {
  const serialized = jsonStringify(persistableDraft(draft), null, 2)
  if (
    serialized === undefined ||
    Buffer.byteLength(serialized, 'utf8') > MAX_FEEDBACK_DRAFT_BYTES
  ) {
    return { success: false, reason: 'too_large' }
  }
  const storage = asStorage(storageV5)
  if (storage) {
    try {
      const written = await storage.write(
        feedbackDraftStorageKey(draft.draft_id),
        serialized,
        { mode: FEEDBACK_DRAFT_FILE_MODE },
      )
      if (!written.ok) {
        logForDebugging(
          `feedbackDrafts: draft write failed: ${writeErrorLabel(written.error)}`,
          { level: 'error' },
        )
        return { success: false, reason: 'write_failed' }
      }
    } catch (error) {
      logForDebugging(
        `feedbackDrafts: draft write failed: ${error instanceof Error ? error.name : 'unknown'}`,
        { level: 'error' },
      )
      return { success: false, reason: 'write_failed' }
    }
  } else {
    try {
      await mkdir(getFeedbackDraftsDir(), { recursive: true })
      await atomicWriteFileWithMode(
        feedbackDraftFilePath(draft.draft_id),
        serialized,
        FEEDBACK_DRAFT_FILE_MODE,
      )
    } catch (error) {
      logForDebugging(
        `feedbackDrafts: draft write failed: ${error instanceof Error ? error.name : 'unknown'}`,
        { level: 'error' },
      )
      return { success: false, reason: 'write_failed' }
    }
  }

  const evicted: FeedbackDraft[] = []
  try {
    const { queued } = await listFeedbackDrafts(
      { now, skipTranscriptCheck: true },
      storageV5,
    )
    if (queued.length > MAX_KEPT_FEEDBACK_DRAFTS) {
      const oldest = queued
        .slice()
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
      for (const draftToEvict of oldest.slice(
        0,
        queued.length - MAX_KEPT_FEEDBACK_DRAFTS,
      )) {
        await deleteFeedbackDraft(draftToEvict.draft_id, storageV5)
        evicted.push(draftToEvict)
      }
    }
  } catch (error) {
    logForDebugging(
      `feedbackDrafts: eviction sweep failed: ${error instanceof Error ? error.name : 'unknown'}`,
      { level: 'error' },
    )
  }
  return { success: true, draft, evicted }
}

/** densable leftover fwc */
export async function countQueuedDraftsForSession(
  sessionId: string,
  storageV5?: unknown,
): Promise<number> {
  const { queued } = await listFeedbackDrafts({ lightweight: true }, storageV5)
  return queued.filter(draft => draft.source_session_id === sessionId).length
}

/** densable leftover ut */
export async function discardFeedbackDraft(
  draft: FeedbackDraft,
  discardedVia: string,
  storageV5?: unknown,
): Promise<void> {
  const existed = await deleteFeedbackDraft(draft.draft_id, storageV5)
  clearFeedbackNoticeForDraft(draft.draft_id)
  if (!existed) return
  if (draft.source_session_id === getSessionId()) {
    decrementSessionDraftCount(1)
  }
  logEvent('tengu_feedback_draft_discarded', {
    type: draft.type as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    trigger:
      draft.trigger as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    discarded_via:
      discardedVia as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
}
