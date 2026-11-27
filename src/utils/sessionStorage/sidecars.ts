import { getSessionId } from '../../bootstrap/state.js'
import type { Entry } from '../../types/logs.js'
import { logForDebugging } from '../debug.js'
import { isDisklessActive, logDisklessWriteSkipped } from '../disklessGuards.js'
import {
  TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  errorMessage,
  isENOENT,
} from '../errors.js'
import {
  isValidStoragePathSegment,
  jobIdHasJsonlSegment,
} from '../sessionNameJobSidecar.js'
import {
  getProjectsDir,
  getTranscriptPathForSession,
  isTranscriptMessage,
} from '../sessionPaths.js'
import { LITE_READ_BUF_SIZE } from '../sessionStoragePortable.js'
import { sanitizeSessionTitle } from '../sessionTitleSanitize.js'
import { jsonParse, jsonStringify } from '../slowOperations.js'
import { isHoverRestOn } from '../storageV5/hoverRestPin.js'
import { getPinnedStorageV5 } from '../storageV5/index.js'
import { validateUuid } from '../uuid.js'
import { createHash } from 'crypto'
import {
  open as fsOpen,
  mkdir,
  readFile,
  stat,
  unlink,
  writeFile,
} from 'fs/promises'
import { basename, dirname, isAbsolute, join, relative, sep } from 'path'
import {
  type FileTailWindow,
  type InternalEventReadResult,
  METADATA_MARKER_BUFS,
  RESUME_HEAD_FILENAME,
  RESUME_HEAD_HEADER_LEN,
  RESUME_HEAD_HEADER_PREFIX,
  RESUME_HEAD_HEADER_SUFFIX,
  RESUME_HEAD_MAX_BOUNDARY_LEN,
  RESUME_HEAD_MAX_BYTES,
  RESUME_HEAD_MAX_GENERATION,
  RESUME_HEAD_MAX_PIECES,
  RESUME_HEAD_MAX_PRESERVED_BYTES,
  RESUME_HEAD_MIN_GAIN,
  RESUME_HEAD_MIN_ROW_STRIDE,
  RESUME_HEAD_PIECE_BYTES,
  RESUME_HEAD_RULES,
  RESUME_HEAD_SHA256_RE,
  RESUME_HEAD_VERSION,
  RESUME_HEAD_WINDOW_BYTES,
  type ResumeHeadData,
  type ResumeHeadParseResult,
  SAVED_CHAT_CROSS_MACHINE_REFUSAL_REASON,
  SAVED_CHAT_FILE_PREFIX,
  SIDECAR_KEY_MAX_REL_PATH_SEGMENTS,
  type SessionSidecarKey,
  type SidecarTextStorage,
  type TitleSidecarStorage,
  type TranscriptPersistenceBind,
} from './types.js'
import { getHostSessionStorageState } from './sessionState.js'
import { readFileTailAsync } from './fsHelpers.js'

/** densable Etf — sibling path of session jsonl: `….ccr-tip.json`. */
export function getCCRTipPathForSession(sessionId: string): string {
  const transcript = getTranscriptPathForSession(sessionId)
  return transcript.endsWith('.jsonl')
    ? `${transcript.slice(0, -6)}.ccr-tip.json`
    : `${transcript}.ccr-tip.json`
}

/** densable fHr — transcript entry with uuid (user/assistant/attachment/system). */
export function isTranscriptUuidPayload(
  entry: unknown,
): entry is { type: string; uuid: string } {
  return (
    typeof entry === 'object' &&
    entry !== null &&
    'type' in entry &&
    'uuid' in entry &&
    typeof (entry as { uuid: unknown }).uuid === 'string' &&
    isTranscriptMessage(entry as Entry)
  )
}

function getStorageV5ProjectsRoot(storageV5: unknown): string | undefined {
  if (typeof storageV5 !== 'object' || storageV5 === null) return undefined
  const roots = (storageV5 as { roots?: unknown }).roots
  if (typeof roots !== 'object' || roots === null) return undefined
  const configHome = (roots as { configHome?: unknown }).configHome
  return typeof configHome === 'string' && configHome.length > 0
    ? join(configHome, 'projects')
    : undefined
}

function asSidecarTextStorage(value: unknown): SidecarTextStorage | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  return value as SidecarTextStorage
}

async function readTextViaStorageV5(
  storage: SidecarTextStorage,
  key: unknown,
): Promise<string | null | undefined> {
  if (typeof storage.readText !== 'function') return undefined
  const res = await storage.readText([key])
  if (!res.ok) return null
  const item = res.value.items[0]
  if (!item) return null
  if ('found' in item) {
    return item.found && typeof item.value === 'string' ? item.value : null
  }
  return item.ok && typeof item.value === 'string' ? item.value : null
}

function resolveCCRTipSidecarKey(
  sessionId: string,
  storageV5?: unknown,
): SessionSidecarKey | undefined {
  const transcriptPath = getTranscriptPathForSession(sessionId)
  const bind = resolveMainSessionTranscriptKey(transcriptPath, storageV5)
  if (!bind) return undefined
  const key: SessionSidecarKey = {
    namespace: 'sidecar',
    projectKey: bind.key.projectKey,
    sessionId: bind.key.sessionId,
    relPath: ['ccr-tip.json'],
  }
  return getSidecarKeyValidationError(key) === undefined ? key : undefined
}

/** densable wtf */
export async function readCCRTip(
  sessionId: string,
  storageV5?: unknown,
): Promise<{ eventId: string; updatedAt?: string } | null> {
  try {
    let raw: string | null | undefined
    const effectiveStorage = storageV5 ?? getPinnedStorageV5()
    const storage = asSidecarTextStorage(effectiveStorage)
    if (storage && typeof storage.readText === 'function') {
      const key = resolveCCRTipSidecarKey(sessionId, effectiveStorage)
      if (key !== undefined) {
        raw = await readTextViaStorageV5(storage, key)
        if (raw === null) return null
      }
    }
    if (raw === undefined) {
      if (isDisklessActive()) return null
      raw = await readFile(getCCRTipPathForSession(sessionId), 'utf-8')
    }
    if (typeof raw !== 'string') return null
    const parsed = jsonParse(raw) as { eventId?: unknown; updatedAt?: unknown }
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof parsed.eventId === 'string'
    ) {
      return {
        eventId: parsed.eventId,
        ...(typeof parsed.updatedAt === 'string'
          ? { updatedAt: parsed.updatedAt }
          : {}),
      }
    }
    return null
  } catch {
    return null
  }
}

/** densable Ctf */
export async function writeCCRTip(
  sessionId: string,
  eventId: string,
  storageV5?: unknown,
): Promise<void> {
  const body = {
    eventId,
    updatedAt: new Date().toISOString(),
  }
  try {
    const effectiveStorage = storageV5 ?? getPinnedStorageV5()
    const storage = asSidecarTextStorage(effectiveStorage)
    if (storage && typeof storage.write === 'function') {
      const key = resolveCCRTipSidecarKey(sessionId, effectiveStorage)
      if (key !== undefined) {
        const res = await storage.write(key, jsonStringify(body), {
          mode: 0o600,
        })
        if (!res.ok) {
          logForDebugging(
            `Failed to write CCR tip sidecar via storage: ${res.error?.code ?? 'error'}`,
          )
        }
        return
      }
    }
    const tipPath = getCCRTipPathForSession(sessionId)
    if (isDisklessActive()) {
      logDisklessWriteSkipped('sessionStorage:writeCCRTip', tipPath)
      return
    }
    await mkdir(dirname(tipPath), { recursive: true, mode: 0o700 })
    await writeFile(tipPath, jsonStringify(body), {
      encoding: 'utf8',
      mode: 0o600,
    })
  } catch (err) {
    logForDebugging(`Failed to write CCR tip sidecar: ${errorMessage(err)}`)
  }
}

/**
 * densable J0a / updateCCRTipFromAckedBatch — last acked non-subagent
 * foreground transcript payload advances the tip.
 */
export async function updateCCRTipFromAckedBatch(
  batch: Array<{
    payload?: unknown
    session_agent_id?: string
    agent_id?: string
  }>,
): Promise<void> {
  for (let i = batch.length - 1; i >= 0; i--) {
    const row = batch[i]
    // densable J0a: only skip subagent stream rows (session_agent_id).
    // Foreground events may still carry agent_id; do not treat that as subagent.
    if (!row || row.session_agent_id) continue
    if (isTranscriptUuidPayload(row.payload)) {
      await writeCCRTip(getSessionId(), row.payload.uuid)
      return
    }
  }
}

/** densable X0a — uuid set from jsonl tail content. */
export function collectUuidsFromJsonlContent(content: string): Set<string> {
  const out = new Set<string>()
  for (const line of content.split('\n')) {
    if (!line) continue
    try {
      const parsed = jsonParse(line) as unknown
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        typeof (parsed as { uuid?: unknown }).uuid === 'string'
      ) {
        out.add((parsed as { uuid: string }).uuid)
      }
    } catch {
      // skip bad lines
    }
  }
  return out
}

/** densable Rtf — reverse walk of transcript uuids in a tail. */
function* iterateTranscriptUuidsFromTail(content: string): Generator<string> {
  const lines = content.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]
    if (!line) continue
    let parsed: unknown
    try {
      parsed = jsonParse(line)
    } catch {
      continue
    }
    if (isTranscriptUuidPayload(parsed)) {
      yield parsed.uuid
    }
  }
}

/** densable Atf — last transcript uuid in tail. */
export function lastTranscriptUuidInTail(content: string): string | undefined {
  for (const uuid of iterateTranscriptUuidsFromTail(content)) {
    return uuid
  }
  return undefined
}

/** densable ktf — first local uuid that intersects the server set, with walkback. */
export function findIntersectingUuid(
  content: string,
  serverUuids: Map<string, number>,
): { uuid: string; walkback: number } | undefined {
  let walkback = 0
  for (const uuid of iterateTranscriptUuidsFromTail(content)) {
    if (serverUuids.has(uuid)) {
      return { uuid, walkback }
    }
    walkback++
  }
  return undefined
}

/**
 * densable Dsi / getValidatedCCRTip — only return tip when feature on and tip
 * uuid is present in the local transcript tail (else fallback reasons).
 */
export async function getValidatedCCRTip(
  sessionId: string,
  enableDelta: boolean,
  preloadedTail?: FileTailWindow | null,
): Promise<{ eventId?: string; fallbackReason?: string }> {
  if (!enableDelta) {
    return { fallbackReason: 'client-gated' }
  }
  const [tip, tail] = await Promise.all([
    readCCRTip(sessionId),
    preloadedTail !== undefined
      ? Promise.resolve(preloadedTail)
      : readFileTailAsync(
          getTranscriptPathForSession(sessionId),
          LITE_READ_BUF_SIZE,
        ).catch(() => null),
  ])
  if (!tip) {
    return { fallbackReason: 'no-sidecar' }
  }
  if (!tail || !collectUuidsFromJsonlContent(tail.content).has(tip.eventId)) {
    return { fallbackReason: 'tip-not-in-tail' }
  }
  return { eventId: tip.eventId }
}

/** densable Rsi — content-bearing user/assistant payload. */
export function isContentBearingPayload(payload: unknown): boolean {
  if (typeof payload !== 'object' || payload === null) return false
  const t = (payload as { type?: unknown }).type
  return t === 'user' || t === 'assistant'
}

/** densable M0a — local transcript already has user/assistant. */
export async function localTranscriptHasContentBearing(
  fullPath: string,
): Promise<boolean> {
  try {
    const fh = await fsOpen(fullPath, 'r')
    try {
      const buf = Buffer.allocUnsafe(LITE_READ_BUF_SIZE)
      let carry = ''
      for (;;) {
        const { bytesRead } = await fh.read(buf, 0, LITE_READ_BUF_SIZE, null)
        if (bytesRead <= 0) break
        const chunk = carry + buf.toString('utf8', 0, bytesRead)
        const lines = chunk.split('\n')
        carry = lines.pop() ?? ''
        for (const line of lines) {
          if (
            line.includes('"type":"user"') ||
            line.includes('"type": "user"') ||
            line.includes('"type":"assistant"') ||
            line.includes('"type": "assistant"')
          ) {
            return true
          }
        }
      }
      return (
        carry.includes('"type":"user"') ||
        carry.includes('"type": "user"') ||
        carry.includes('"type":"assistant"') ||
        carry.includes('"type": "assistant"')
      )
    } finally {
      await fh.close()
    }
  } catch {
    return false
  }
}

export function normalizeInternalEventRead(
  raw:
    | InternalEventReadResult
    | Array<{
        payload: Record<string, unknown>
        agent_id?: string
        session_agent_id?: string
        event_id?: string
      }>
    | null
    | undefined,
): InternalEventReadResult | null {
  if (!raw) return null
  if (Array.isArray(raw)) {
    return { events: raw }
  }
  return raw
}
/* eslint-enable custom-rules/no-sync-fs */

/** densable leftover `$e` / `MJe` — `join(dirname(transcript), sid, "custom-title.json")`. */
export function getCustomTitleSidecarPath(
  transcriptPath: string,
  sessionId: string,
): string {
  return join(dirname(transcriptPath), sessionId, 'custom-title.json')
}

function coerceTitleSidecarStorage(
  value: unknown,
): TitleSidecarStorage | undefined {
  if (typeof value !== 'object' || value === null) return
  const rec = value as Record<string, unknown>
  if (typeof rec.write !== 'function' || typeof rec.delete !== 'function') {
    return
  }
  return value as TitleSidecarStorage
}

/**
 * densable leftover `Ua` / `Q8c` sidecar arm.
 * `g(u)===void 0` → key ok. Full `mn`/`Tn`/`an` not inlined.
 */
export function getSidecarKeyValidationError(
  key: SessionSidecarKey,
): string | undefined {
  if (
    !isValidStoragePathSegment(key.projectKey) ||
    !isValidStoragePathSegment(key.sessionId)
  ) {
    return 'invalid'
  }
  if (
    key.relPath.length === 0 ||
    !key.relPath.every(isValidStoragePathSegment)
  ) {
    return 'invalid'
  }
  return undefined
}

/**
 * densable leftover `nPb` / `k` / `Tg`.
 * Walk sidecar abs path up to `y()`=`getProjectsDir()`. `p`=`E`/`jobIdHasJsonlSegment`.
 * `r`=`C`/`isValidStoragePathSegment`. `l.sidecar(d,f,i)`. `g(u)===void 0` → key.
 */
export function parseSessionSidecarKeyFromPath(
  absPath: string,
  storageV5?: unknown,
): SessionSidecarKey | undefined {
  const leaf = basename(absPath)
  if (jobIdHasJsonlSegment(leaf)) return
  const candidateRoots = [getProjectsDir()]
  const storageRoot = getStorageV5ProjectsRoot(storageV5)
  if (storageRoot && !candidateRoots.includes(storageRoot)) {
    candidateRoots.push(storageRoot)
  }
  for (const root of candidateRoots) {
    const segments = [leaf]
    let dir = dirname(absPath)
    while (
      dir !== root &&
      segments.length <= SIDECAR_KEY_MAX_REL_PATH_SEGMENTS + 1
    ) {
      const parent = dirname(dir)
      if (parent === dir) break
      segments.unshift(basename(dir))
      dir = parent
    }
    if (dir !== root || segments.length < 3) continue
    const [projectKey, sessionId, ...relPath] = segments
    if (
      !isValidStoragePathSegment(projectKey) ||
      !isValidStoragePathSegment(sessionId) ||
      relPath.length === 0 ||
      !relPath.every(isValidStoragePathSegment)
    ) {
      continue
    }
    const key: SessionSidecarKey = {
      namespace: 'sidecar',
      projectKey,
      sessionId,
      relPath,
    }
    if (getSidecarKeyValidationError(key) === undefined) {
      return key
    }
  }
  return undefined
}

/** densable leftover `DKt`. Official `Be()&&n` → `Tg` delete then return. */
async function deleteCustomTitleSidecar(
  transcriptPath: string,
  sessionId: string,
  storageV5?: unknown,
): Promise<void> {
  const sidecar = getCustomTitleSidecarPath(transcriptPath, sessionId)
  try {
    const effectiveStorage = storageV5 ?? getPinnedStorageV5()
    const storage = coerceTitleSidecarStorage(effectiveStorage)
    if (storage) {
      const key = parseSessionSidecarKeyFromPath(sidecar, effectiveStorage)
      if (key !== undefined) {
        const result = await storage.delete(key)
        if (!result.ok) {
          logForDebugging(
            `deleteSessionTitleSidecar: ${result.error?.code ?? 'error'} via storage`,
            { level: 'error' },
          )
        }
        return
      }
    }
    if (isDisklessActive()) {
      logDisklessWriteSkipped(
        'sessionStorage:deleteCustomTitleSidecar',
        sidecar,
      )
      return
    }
    await unlink(sidecar)
  } catch (err) {
    if (!isENOENT(err)) {
      logForDebugging(`deleteSessionTitleSidecar: ${errorMessage(err)}`, {
        level: 'error',
      })
    }
  }
}

/**
 * densable leftover `Reo`.
 * Uses injected/pinned `storageV5` whenever present (regardless of `isHoverRestOn()`).
 * `Tg(o)` then `write(...,{mode:384})`.
 * v5 attempt always returns (even on write fail). Else mkdir 448 / write 384.
 */
export async function writeCustomTitleSidecar(
  transcriptPath: string,
  sessionId: string,
  title: string,
  storageV5?: unknown,
): Promise<void> {
  if (!sanitizeSessionTitle(title)) {
    await deleteCustomTitleSidecar(transcriptPath, sessionId, storageV5)
    return
  }
  const sidecar = getCustomTitleSidecarPath(transcriptPath, sessionId)
  try {
    const effectiveStorage = storageV5 ?? getPinnedStorageV5()
    const storage = coerceTitleSidecarStorage(effectiveStorage)
    if (storage) {
      const key = parseSessionSidecarKeyFromPath(sidecar, effectiveStorage)
      if (key !== undefined) {
        const result = await storage.write(
          key,
          jsonStringify({ customTitle: title }),
          { mode: 384 },
        )
        if (!result.ok) {
          logForDebugging(
            `writeSessionTitleSidecar: ${result.error?.code ?? 'error'} via storage`,
            { level: 'error' },
          )
        }
        return
      }
    }
    if (isDisklessActive()) {
      logDisklessWriteSkipped('sessionStorage:writeCustomTitleSidecar', sidecar)
      return
    }
    await mkdir(dirname(sidecar), { recursive: true, mode: 0o700 })
    await writeFile(sidecar, jsonStringify({ customTitle: title }), {
      mode: 0o600,
    })
  } catch (err) {
    logForDebugging(`writeSessionTitleSidecar: ${errorMessage(err)}`, {
      level: 'error',
    })
  }
}

/**
 * 2.1.309 #1139 (SEA rXi / DOr): Fallback reader for `<dir>/<sessionId>/custom-title.json`
 * when the JSONL tail does not contain a `custom-title` entry.
 */
export async function readCustomTitleSidecar(
  transcriptPath: string,
  sessionId: string,
  storageV5?: unknown,
): Promise<string | undefined> {
  const sidecarPath = join(
    dirname(transcriptPath),
    sessionId,
    'custom-title.json',
  )
  try {
    let raw: string | null | undefined
    const effectiveStorage = storageV5 ?? getPinnedStorageV5()
    const storage = asSidecarTextStorage(effectiveStorage)
    if (storage && typeof storage.readText === 'function') {
      const key = parseSessionSidecarKeyFromPath(sidecarPath, effectiveStorage)
      if (key !== undefined) {
        raw = await readTextViaStorageV5(storage, key)
        if (raw === null) return undefined
      }
    }
    if (raw === undefined) {
      if (isDisklessActive()) return undefined
      raw = await readFile(sidecarPath, 'utf8')
    }
    if (typeof raw !== 'string') return undefined
    const parsed: unknown = jsonParse(raw)
    if (
      parsed &&
      typeof parsed === 'object' &&
      'customTitle' in parsed &&
      typeof (parsed as { customTitle?: unknown }).customTitle === 'string'
    ) {
      const trimmed = (parsed as { customTitle: string }).customTitle.trim()
      return trimmed || undefined
    }
  } catch {
    // Missing or unreadable sidecar is expected when never renamed
  }
  return undefined
}

export function resolveMainSessionTranscriptKey(
  filePath: string,
  storageV5: unknown,
): TranscriptPersistenceBind | undefined {
  if (storageV5 === undefined) return
  if (!filePath.endsWith('.jsonl')) return
  const r = dirname(filePath)
  const parentOfProject = dirname(r)
  const candidateRoots = [getProjectsDir()]
  const storageRoot = getStorageV5ProjectsRoot(storageV5)
  if (storageRoot && !candidateRoots.includes(storageRoot)) {
    candidateRoots.push(storageRoot)
  }
  const matchedRoot = candidateRoots.find(root => parentOfProject === root)
  if (matchedRoot === undefined) return
  const n = basename(r)
  const t = basename(filePath, '.jsonl')
  if (filePath !== join(matchedRoot, n, `${t}.jsonl`)) return
  if (!isValidStoragePathSegment(n) || !isValidStoragePathSegment(t)) return
  return {
    backend: storageV5,
    key: { namespace: 'transcript', projectKey: n, sessionId: t },
  }
}

/**
 * densable leftover `$ib` / `uE` / `I` @210422xxx.
 * `s()`=`isHoverRestOn`; `o()`=`getProjectsDir`; `c.transcript`+`f`=`tr`.
 * Main `{projects}/{projectKey}/{session}.jsonl` only — not subagents (`O`).
 */
export function bindMainSessionTranscriptPersistence(
  filePath: string,
  storageV5: unknown,
): TranscriptPersistenceBind | undefined {
  if (!isHoverRestOn() || storageV5 === undefined) return
  return resolveMainSessionTranscriptKey(filePath, storageV5)
}

/**
 * densable leftover `ajb` / `O` @210422xxx.
 * Subagent `{projects}/{pk}/{sid}/subagents/.../agent-{id}.jsonl`.
 */
export function bindSubagentTranscriptPersistence(
  filePath: string,
  storageV5: unknown,
): TranscriptPersistenceBind | undefined {
  if (!isHoverRestOn() || storageV5 === undefined) return
  const root = getProjectsDir()
  const r = relative(root, filePath)
  if (r === '' || r === '..' || r.startsWith(`..${sep}`) || isAbsolute(r)) {
    return
  }
  const n = r.split(sep)
  if (filePath !== join(root, ...n)) return
  const t = n.at(-1)
  if (
    n.length < 4 ||
    n[2] !== 'subagents' ||
    t === undefined ||
    !t.startsWith('agent-') ||
    !t.endsWith('.jsonl')
  ) {
    return
  }
  const d = t.slice(6, -6)
  const u = n.slice(3, -1)
  const projectKey = n[0]
  const sessionId = n[1]
  if (
    projectKey === undefined ||
    sessionId === undefined ||
    !isValidStoragePathSegment(projectKey) ||
    !isValidStoragePathSegment(sessionId) ||
    !isValidStoragePathSegment(d) ||
    (u.length > 0 && !u.every(isValidStoragePathSegment))
  ) {
    return
  }
  return {
    backend: storageV5,
    key: {
      namespace: 'transcript',
      projectKey,
      sessionId,
      agentId: d,
      ...(u.length > 0 && { agentRelPath: u }),
    },
  }
}

export class NeedsWholeTranscript extends Error {
  reason: string
  constructor(reason: string) {
    super('a load from the resume head gave up')
    this.reason = reason
    this.name = 'NeedsWholeTranscript'
  }
}

export function resumeHeadSha256(buf: Buffer | Uint8Array): string {
  return createHash('sha256').update(buf).digest('hex')
}

/**
 * Gold `yne` @289068350 — compute `<projectDir>/<sessionId>/resume-head.jsonl`
 * for a valid `<projectDir>/<sessionId>.jsonl` transcript path.
 */
export function getResumeHeadPath(
  transcriptPath: string,
  projectDir: string,
): string | null {
  const file = basename(transcriptPath)
  const dir = dirname(transcriptPath)
  if (!file.endsWith('.jsonl') || dirname(dir) !== projectDir) {
    return null
  }
  const sessionId = file.slice(0, -6)
  if (validateUuid(sessionId) === null) return null
  return join(dir, sessionId, RESUME_HEAD_FILENAME)
}

function resumeHeadWindowStart(boundaryOffset: number): number {
  return Math.max(0, boundaryOffset - RESUME_HEAD_WINDOW_BYTES)
}

function isResumeHeadTooScattered(
  rowOffsets: readonly number[],
  rowLengths: readonly number[],
  windowStart: number,
): { pieces: number; tooScattered: boolean } {
  let pieces = 0
  let lastPiece = -1
  for (let i = 0; i < rowOffsets.length; i++) {
    const startPiece = Math.floor(
      Math.max(0, rowOffsets[i]! - 1) / RESUME_HEAD_PIECE_BYTES,
    )
    const endPiece = Math.floor(
      (rowOffsets[i]! + rowLengths[i]!) / RESUME_HEAD_PIECE_BYTES,
    )
    pieces += endPiece - Math.max(startPiece, lastPiece + 1) + 1
    lastPiece = endPiece
  }
  return {
    pieces,
    tooScattered:
      pieces > RESUME_HEAD_MAX_PIECES ||
      pieces * 4 > Math.floor(windowStart / RESUME_HEAD_PIECE_BYTES),
  }
}

/**
 * Gold `_ne` @289068800 — serialize a `resume-head.jsonl` buffer with its
 * leading `{"sha256":"..."}` integrity line.
 */
export function serializeResumeHead(
  head: ResumeHeadData,
  tableKey = 'v1',
): Buffer {
  const payload = {
    version: RESUME_HEAD_VERSION,
    rules: RESUME_HEAD_RULES,
    table: tableKey,
    boundaryOffset: head.boundaryOffset,
    boundaryLength: head.boundaryLength,
    probe: head.probe,
    generation: head.generation,
    rowOffsets: head.rowOffsets,
    rowLengths: head.rowLengths,
  }
  const body = Buffer.from(jsonStringify(payload) + '\n', 'utf8')
  const header = Buffer.from(
    RESUME_HEAD_HEADER_PREFIX +
      resumeHeadSha256(body) +
      RESUME_HEAD_HEADER_SUFFIX,
    'utf8',
  )
  return Buffer.concat([header, body])
}

/**
 * Gold `G2t` @289069100 — validate checksum, version, rules, and non-overlapping
 * monotonic row offsets/lengths of a `resume-head.jsonl` buffer.
 */
export function parseResumeHead(
  buf: Buffer,
  expectedTableKey = 'v1',
): ResumeHeadParseResult {
  if (buf.length > RESUME_HEAD_MAX_BYTES) return 'too_large'
  const header = buf.toString('latin1', 0, RESUME_HEAD_HEADER_LEN)
  const hex = header.slice(
    RESUME_HEAD_HEADER_PREFIX.length,
    -RESUME_HEAD_HEADER_SUFFIX.length,
  )
  if (
    buf.length <= RESUME_HEAD_HEADER_LEN ||
    header !== RESUME_HEAD_HEADER_PREFIX + hex + RESUME_HEAD_HEADER_SUFFIX ||
    !RESUME_HEAD_SHA256_RE.test(hex)
  ) {
    return 'malformed'
  }
  if (resumeHeadSha256(buf.subarray(RESUME_HEAD_HEADER_LEN)) !== hex) {
    return 'checksum'
  }
  let raw: unknown
  try {
    raw = jsonParse(buf.toString('utf8', RESUME_HEAD_HEADER_LEN))
  } catch {
    return 'malformed'
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return 'malformed'
  }
  const obj = raw as Record<string, unknown>
  if (typeof obj.version !== 'number' || typeof obj.rules !== 'number') {
    return 'malformed'
  }
  if (obj.version !== RESUME_HEAD_VERSION) return 'other_version'
  if (obj.rules !== RESUME_HEAD_RULES || obj.table !== expectedTableKey) {
    return 'other_rules'
  }
  if (
    !Array.isArray(obj.rowOffsets) ||
    !Array.isArray(obj.rowLengths) ||
    obj.rowOffsets.length >
      RESUME_HEAD_MAX_BYTES / RESUME_HEAD_MIN_ROW_STRIDE ||
    obj.rowLengths.length >
      RESUME_HEAD_MAX_BYTES / RESUME_HEAD_MIN_ROW_STRIDE ||
    obj.rowOffsets.length !== obj.rowLengths.length
  ) {
    return 'malformed'
  }
  const boundaryOffset = obj.boundaryOffset
  const boundaryLength = obj.boundaryLength
  const probe = obj.probe
  const generation = obj.generation
  if (
    typeof boundaryOffset !== 'number' ||
    !Number.isSafeInteger(boundaryOffset) ||
    boundaryOffset < 1 ||
    typeof boundaryLength !== 'number' ||
    !Number.isSafeInteger(boundaryLength) ||
    boundaryLength < 1 ||
    boundaryLength > RESUME_HEAD_MAX_BOUNDARY_LEN ||
    !Number.isSafeInteger(boundaryOffset + boundaryLength) ||
    typeof probe !== 'string' ||
    !RESUME_HEAD_SHA256_RE.test(probe) ||
    typeof generation !== 'number' ||
    !Number.isSafeInteger(generation) ||
    generation < 0 ||
    generation > RESUME_HEAD_MAX_GENERATION
  ) {
    return 'malformed'
  }

  const rowOffsets: number[] = []
  const rowLengths: number[] = []
  const windowStart = resumeHeadWindowStart(boundaryOffset)
  let totalBytes = 0
  let prevEnd = -1
  for (let i = 0; i < obj.rowOffsets.length; i++) {
    const offset = obj.rowOffsets[i]
    const length = obj.rowLengths[i]
    if (
      typeof offset !== 'number' ||
      !Number.isSafeInteger(offset) ||
      typeof length !== 'number' ||
      !Number.isSafeInteger(length) ||
      length < 1 ||
      length > RESUME_HEAD_MAX_PRESERVED_BYTES ||
      offset <= prevEnd ||
      offset >= windowStart ||
      offset + length >= boundaryOffset
    ) {
      return 'malformed'
    }
    rowOffsets.push(offset)
    rowLengths.push(length)
    totalBytes += length + 1
    prevEnd = offset + length
  }
  if (
    totalBytes > RESUME_HEAD_MAX_PRESERVED_BYTES ||
    isResumeHeadTooScattered(rowOffsets, rowLengths, windowStart).tooScattered
  ) {
    return 'malformed'
  }
  return {
    boundaryOffset,
    boundaryLength,
    probe,
    generation,
    rowOffsets,
    rowLengths,
  }
}

/**
 * Gold `z2t` @289070400 — in-memory index over preserved rows before `boundaryOffset`.
 */
export class PreservedResumeRows {
  readonly rowOffsets: readonly number[]
  readonly rowLengths: readonly number[]
  readonly bytes: Buffer
  private readonly startsInBytes: number[] = []

  constructor(
    rowOffsets: readonly number[],
    rowLengths: readonly number[],
    bytes: Buffer,
  ) {
    this.rowOffsets = rowOffsets
    this.rowLengths = rowLengths
    this.bytes = bytes
    let pos = 0
    for (const len of rowLengths) {
      this.startsInBytes.push(pos)
      pos += len + 1
    }
  }

  scan(
    fn: (buf: Buffer, start: number, length: number, offset: number) => void,
  ): void {
    for (let i = 0; i < this.rowOffsets.length; i++) {
      fn(
        this.bytes,
        this.startsInBytes[i]!,
        this.rowLengths[i]!,
        this.rowOffsets[i]!,
      )
    }
  }

  read(offset: number, length: number): Buffer {
    const { rowOffsets, rowLengths, bytes } = this
    if (rowOffsets.length === 0) {
      throw new NeedsWholeTranscript('read_before_boundary')
    }
    let lo = 0
    let hi = rowOffsets.length - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (rowOffsets[mid]! < offset) lo = mid + 1
      else hi = mid
    }
    if (rowOffsets[lo] !== offset) {
      throw new NeedsWholeTranscript('read_before_boundary')
    }
    const targetEnd = offset + length
    let idx = lo
    let curEnd = offset + rowLengths[idx]!
    while (
      curEnd < targetEnd &&
      idx + 1 < rowOffsets.length &&
      rowOffsets[idx + 1] === curEnd + 1
    ) {
      idx++
      curEnd = rowOffsets[idx]! + rowLengths[idx]!
    }
    if (curEnd !== targetEnd) {
      throw new NeedsWholeTranscript('read_before_boundary')
    }
    const start = this.startsInBytes[lo]!
    return bytes.subarray(start, start + length)
  }
}

/**
 * Vouch that a `resume-head.jsonl` boundary probe matches the transcript bytes
 * at `[head.boundaryOffset, head.boundaryOffset + head.boundaryLength)`.
 */
export function vouchResumeHeadProbe(
  transcriptBytes: Buffer,
  head: Pick<ResumeHeadData, 'boundaryOffset' | 'boundaryLength' | 'probe'>,
): boolean {
  const end = head.boundaryOffset + head.boundaryLength
  if (head.boundaryOffset < 0 || end > transcriptBytes.length) return false
  return (
    resumeHeadSha256(transcriptBytes.subarray(head.boundaryOffset, end)) ===
    head.probe
  )
}

function resolveResumeHeadStorageKeys(
  headPath: string,
  storageV5?: unknown,
):
  | {
      transcriptKey: TranscriptPersistenceBind['key']
      sidecarKey: SessionSidecarKey
    }
  | undefined {
  const sessionDir = dirname(headPath)
  const transcriptPath = `${sessionDir}.jsonl`
  const bind = resolveMainSessionTranscriptKey(transcriptPath, storageV5)
  if (!bind) return undefined
  const sidecarKey: SessionSidecarKey = {
    namespace: 'sidecar',
    projectKey: bind.key.projectKey,
    sessionId: bind.key.sessionId,
    relPath: ['resume-head.json'],
  }
  if (getSidecarKeyValidationError(sidecarKey) !== undefined) return undefined
  return { transcriptKey: bind.key, sidecarKey }
}

/**
 * Low-memory transcript load via `resume-head.jsonl` + `PreservedResumeRows` (#1205).
 * Returns null if side-file is absent/invalid or probe mismatches, allowing
 * callers to fall back to `readTranscriptForLoad`.
 */
export async function tryLoadResumeHeadRows(
  filePath: string,
  fileSize: number,
  expectedTableKey = 'v1',
): Promise<{
  preservedRows: PreservedResumeRows
  postBoundaryBuf: Buffer
  hasPreservedSegment: boolean
  boundaryOffset: number
} | null> {
  if (isDisklessActive()) return null
  if (!filePath.endsWith('.jsonl')) return null
  const headPath = getResumeHeadPath(filePath, dirname(dirname(filePath)))
  if (!headPath) return null
  let headBuf: Buffer
  try {
    headBuf = await readFile(headPath)
  } catch {
    return null
  }
  const head = parseResumeHead(headBuf, expectedTableKey)
  if (typeof head === 'string') return null
  if (
    head.boundaryOffset < 0 ||
    head.boundaryOffset + head.boundaryLength > fileSize
  ) {
    return null
  }
  const fh = await fsOpen(filePath, 'r')
  try {
    const probeBuf = Buffer.allocUnsafe(head.boundaryLength)
    const { bytesRead } = await fh.read(
      probeBuf,
      0,
      head.boundaryLength,
      head.boundaryOffset,
    )
    if (bytesRead !== head.boundaryLength) return null
    if (resumeHeadSha256(probeBuf) !== head.probe) return null

    const rowChunks: Buffer[] = []
    for (let i = 0; i < head.rowOffsets.length; i++) {
      const len = head.rowLengths[i]!
      const rowBuf = Buffer.allocUnsafe(len + 1)
      const res = await fh.read(rowBuf, 0, len, head.rowOffsets[i]!)
      if (res.bytesRead !== len) return null
      rowBuf[len] = 0x0a
      rowChunks.push(rowBuf)
    }
    const preservedRows = new PreservedResumeRows(
      head.rowOffsets,
      head.rowLengths,
      Buffer.concat(rowChunks),
    )

    const tailLen = fileSize - head.boundaryOffset
    const postBoundaryBuf = Buffer.allocUnsafe(tailLen)
    let offset = 0
    while (offset < tailLen) {
      const r = await fh.read(
        postBoundaryBuf,
        offset,
        tailLen - offset,
        head.boundaryOffset + offset,
      )
      if (r.bytesRead <= 0) break
      offset += r.bytesRead
    }
    const finalTail =
      offset === tailLen ? postBoundaryBuf : postBoundaryBuf.subarray(0, offset)
    return {
      preservedRows,
      postBoundaryBuf: finalTail,
      hasPreservedSegment: finalTail.includes('"preservedSegment"'),
      boundaryOffset: head.boundaryOffset,
    }
  } finally {
    await fh.close().catch(() => {})
  }
}

/**
 * Official 2.1.328 `Nmr` / `Lmr` (`chunk@294254613.js @420598`):
 * Write or remove `<projectDir>/<sessionId>/resume-head.jsonl` using
 * `serializeResumeHead()`.
 */
export async function writeResumeHeadFile(
  headPath: string,
  head: ResumeHeadData | null,
  tableKey = 'v1',
  storageV5?: unknown,
): Promise<void> {
  const sessionDir = dirname(headPath)
  const transcriptPath = `${sessionDir}.jsonl`
  try {
    const effectiveStorage = storageV5 ?? getPinnedStorageV5()
    const storage = asSidecarTextStorage(effectiveStorage)
    if (
      storage &&
      typeof storage.write === 'function' &&
      typeof storage.delete === 'function'
    ) {
      const keys = resolveResumeHeadStorageKeys(headPath, effectiveStorage)
      if (keys !== undefined) {
        if (head === null) {
          await storage.delete(keys.sidecarKey).catch(() => {})
          return
        }
        if (typeof storage.stat === 'function') {
          const st = await storage.stat(keys.transcriptKey)
          if (!st.ok) return
        }
        const serialized = serializeResumeHead(head, tableKey)
        const res = await storage.write(keys.sidecarKey, serialized, {
          mode: 0o600,
        })
        if (!res.ok) {
          logForDebugging(
            `Could not update resume-head via storage: ${res.error?.code ?? 'error'}`,
          )
        }
        return
      }
    }
    if (isDisklessActive()) {
      logDisklessWriteSkipped('sessionStorage:writeResumeHeadFile', headPath)
      return
    }
    if (head === null) {
      await unlink(headPath).catch(() => {})
      return
    }
    const transcriptExists = await stat(transcriptPath).then(
      () => true,
      () => false,
    )
    if (!transcriptExists) return
    await mkdir(sessionDir, { recursive: true, mode: 0o700 })
    const serialized = serializeResumeHead(head, tableKey)
    await writeFile(headPath, serialized, { mode: 0o600 })
  } catch (err) {
    if (!isENOENT(err)) {
      logForDebugging(
        `Could not update resume-head.jsonl, the side file that speeds up loading this transcript. Loads still work, and may read the whole file: ${errorMessage(err)}`,
      )
    }
  }
}

/**
 * Official 2.1.328 `Pde` (`chunk@294254613.js @420598`):
 * Serialize per-path writes/removals to `resume-head.jsonl`.
 */
export function scheduleWriteResumeHead(
  headPath: string,
  head: ResumeHeadData | null,
  tableKey = 'v1',
): Promise<void> {
  const { resumeHeadWriteChains } = getHostSessionStorageState()
  const prev = resumeHeadWriteChains.get(headPath) ?? Promise.resolve()
  const next = prev
    .catch(() => {})
    .then(() => writeResumeHeadFile(headPath, head, tableKey))
  resumeHeadWriteChains.set(headPath, next)
  void next.finally(() => {
    if (resumeHeadWriteChains.get(headPath) === next) {
      resumeHeadWriteChains.delete(headPath)
    }
  })
  return next
}

/**
 * Official 2.1.328 `_nn` (`chunk@294254613.js @420598, @714199`):
 * Plan a `ResumeHeadData` payload from a transcript file and a known
 * `compact_boundary` byte offset so subsequent loads hit `tryLoadResumeHeadRows`.
 */
export async function planResumeHeadForTranscript(
  filePath: string,
  fileSize: number,
  boundaryOffset: number,
  opts?: {
    previousGeneration?: number
    ignoreMinGain?: boolean
  },
): Promise<ResumeHeadData | null> {
  if (isDisklessActive()) return null
  if (boundaryOffset < 1 || boundaryOffset >= fileSize) return null
  if (!opts?.ignoreMinGain && boundaryOffset < RESUME_HEAD_MIN_GAIN) {
    return null
  }
  const generation =
    opts?.previousGeneration !== undefined ? opts.previousGeneration + 1 : 0
  if (generation > RESUME_HEAD_MAX_GENERATION) return null

  const fh = await fsOpen(filePath, 'r')
  try {
    const maxBoundaryRead = Math.min(
      RESUME_HEAD_MAX_BOUNDARY_LEN + 1,
      fileSize - boundaryOffset,
    )
    const boundaryBuf = Buffer.allocUnsafe(maxBoundaryRead)
    const { bytesRead } = await fh.read(
      boundaryBuf,
      0,
      maxBoundaryRead,
      boundaryOffset,
    )
    if (bytesRead <= 0) return null
    const slice = boundaryBuf.subarray(0, bytesRead)
    const nlIdx = slice.indexOf(0x0a)
    const boundaryLength = nlIdx === -1 ? bytesRead : nlIdx
    if (boundaryLength < 1 || boundaryLength > RESUME_HEAD_MAX_BOUNDARY_LEN) {
      return null
    }
    const probe = resumeHeadSha256(slice.subarray(0, boundaryLength))

    // Collect metadata row offsets/lengths strictly before windowStart.
    const windowStart = resumeHeadWindowStart(boundaryOffset)
    const rowOffsets: number[] = []
    const rowLengths: number[] = []
    let totalPreservedBytes = 0

    if (windowStart > 0) {
      const CHUNK_SIZE = 64 * 1024
      const readBuf = Buffer.allocUnsafe(CHUNK_SIZE)
      let filePos = 0
      let lineStartOffset = 0
      let lineBuf: Buffer = Buffer.alloc(0)
      let skipOversizeLine = false

      const inspectLine = (buf: Buffer, offset: number): void => {
        if (buf.length === 0 || offset >= windowStart) return
        if (offset + buf.length >= boundaryOffset) return
        if (buf.length > RESUME_HEAD_MAX_PRESERVED_BYTES) return
        for (const marker of METADATA_MARKER_BUFS) {
          if (buf.includes(marker)) {
            if (
              totalPreservedBytes + buf.length + 1 <=
              RESUME_HEAD_MAX_PRESERVED_BYTES
            ) {
              rowOffsets.push(offset)
              rowLengths.push(buf.length)
              totalPreservedBytes += buf.length + 1
            }
            break
          }
        }
      }

      while (filePos < windowStart) {
        const toRead = Math.min(CHUNK_SIZE, windowStart - filePos)
        const res = await fh.read(readBuf, 0, toRead, filePos)
        if (res.bytesRead <= 0) break
        const chunk = readBuf.subarray(0, res.bytesRead)
        let cursor = 0
        while (cursor < chunk.length) {
          const nl = chunk.indexOf(0x0a, cursor)
          if (nl === -1) {
            if (!skipOversizeLine) {
              const tail = chunk.subarray(cursor)
              if (lineBuf.length + tail.length > 64 * 1024) {
                skipOversizeLine = true
                lineBuf = Buffer.alloc(0)
              } else {
                lineBuf =
                  lineBuf.length === 0
                    ? Buffer.from(tail)
                    : Buffer.concat([lineBuf, tail])
              }
            }
            break
          }
          if (!skipOversizeLine) {
            const seg = chunk.subarray(cursor, nl)
            const fullLine =
              lineBuf.length === 0 ? seg : Buffer.concat([lineBuf, seg])
            inspectLine(fullLine, lineStartOffset)
          }
          lineBuf = Buffer.alloc(0)
          skipOversizeLine = false
          cursor = nl + 1
          lineStartOffset = filePos + cursor
        }
        filePos += res.bytesRead
      }
      if (!skipOversizeLine && lineBuf.length > 0) {
        inspectLine(lineBuf, lineStartOffset)
      }
    }

    if (
      isResumeHeadTooScattered(rowOffsets, rowLengths, windowStart).tooScattered
    ) {
      return null
    }
    return {
      boundaryOffset,
      boundaryLength,
      probe,
      generation,
      rowOffsets,
      rowLengths,
    }
  } finally {
    await fh.close().catch(() => {})
  }
}

/**
 * Official 2.1.331 `P1o(filePath)`:
 * True when the file's basename starts with `artifact-chat.` (case-insensitive).
 */
export function isSavedChatFilePath(filePath: string): boolean {
  return basename(filePath.replace(/\\/g, '/'))
    .toLowerCase()
    .startsWith(SAVED_CHAT_FILE_PREFIX)
}

/**
 * Official 2.1.331 user-facing message refusing cross-machine saved chat reads.
 */
export function formatCrossMachineSavedChatRefusalMessage(
  toolName = 'Read',
): string {
  return `The ${toolName} tool doesn't send files saved from claude.ai chats to a session on another machine. To read this file, use a Claude Code session on the machine where the file is.`
}

/**
 * Official 2.1.331 `T` error thrown when a remote/cross-machine tool call
 * attempts to read a saved claude.ai chat file (`artifact-chat.*`).
 */
export class CrossMachineSavedChatReadError extends TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS {
  constructor(toolName = 'Read') {
    super(
      formatCrossMachineSavedChatRefusalMessage(toolName),
      SAVED_CHAT_CROSS_MACHINE_REFUSAL_REASON,
    )
    this.name = 'CrossMachineSavedChatReadError'
  }
}

/**
 * Official 2.1.331 `Qji` guard:
 * Refuses reading any path (or symlink spelling) whose basename identifies a
 * saved claude.ai chat file when invoked on behalf of another machine
 * (`remoteCall !== undefined` or `forRemoteExecution === true`).
 */
export function assertNotCrossMachineSavedChatRead(
  paths: readonly string[],
  options: {
    remoteCall?: unknown
    forRemoteExecution?: boolean
    toolName?: string
  },
): void {
  const isCrossMachine =
    options.remoteCall !== undefined || options.forRemoteExecution === true
  if (isCrossMachine && paths.some(isSavedChatFilePath)) {
    throw new CrossMachineSavedChatReadError(options.toolName ?? 'Read')
  }
}
