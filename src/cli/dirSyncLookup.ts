/**
 * densable 2.1.283 leftover dir-sync LOOKUP wrap.
 * Gold SEA `/tmp/official-283/package/claude`:
 * - ito @196030082 / ato @196030166
 * - q9 @196031203
 * - gC @196032132
 * - R @196040117
 * - TBn @182125118 / M @196041459
 * - aLe / ee @196047200
 * - W/x/B @196047325
 * - Ie @196047583
 * - Ue @196048448
 * - te/re @196048705
 * - hn @202412591 / kRr @181572085
 * - fn @202412770 / Fo @202412951
 *
 * `_g` settings.read only (no settings writes). No laptop FS pull engine.
 * Semantic exports; minify names only in comments.
 */

import type { Dirent } from 'fs'
import { lstat, readdir, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import { toInfraSessionId } from 'src/bridge/sessionIdCompat.js'
import { getOriginalCwd } from 'src/bootstrap/state.js'
import { errorMessage, getErrnoCode, isENOENT } from 'src/utils/errors.js'
import { findGitRoot } from 'src/utils/git.js'
import { logForDebugging } from 'src/utils/debug.js'
import {
  getProjectDir,
  getProjectsDir,
  sanitizePath,
} from 'src/utils/sessionStoragePortable.js'
import {
  isHoverRestOn,
  type StorageV5,
  type StorageV5Result,
} from 'src/utils/storageV5/index.js'
import { DIR_SYNC_ENGINE_DECLINED_LINE } from './cloudSession.js'
import { isViolinWoodEnabled, isViolinWoodEnabledSync } from './violinWood.js'

/** gold `Q5n` @176573707 */
export const DIR_SYNC_RECORD_SUFFIX = '.dir-sync.json'
/** gold `p` empty-marker suffix @195603050 */
export const DIR_SYNC_EMPTY_MARKER_SUFFIX = '.dir-sync-empty.json'
/** gold `ne` @196047200 */
export const DIR_SYNC_ELSEWHERE_LISTING_CAP = 4000
/** gold `T` @196047200 */
export const DIR_SYNC_ELSEWHERE_PROBE_BATCH = 16
/** gold `S` @196031203 notice backlog */
export const DIR_SYNC_NOTICE_BACKLOG_CAP = 50
/** gold `b` @195683894 c4t max */
const DIR_SYNC_RECORD_MAX_BYTES = 67_108_864

const CREATED_EMPTY_WHYS = [
  'flag_off',
  'consent_off',
  'not_served',
  'arm_slow',
  'arm_failed',
  'cancelled',
  'no_word',
] as const

export type CreatedEmptyWhy = (typeof CREATED_EMPTY_WHYS)[number]

export type CreatedEmptyMarker = {
  version: 1
  kind: 'created_empty_unfilled'
  sessionId: string
  createdAtMs: number
  why: CreatedEmptyWhy
}

export type DirSyncFileKind = 'dir' | 'symlink' | 'file' | 'other' | 'unknown'

export type DirSyncNoticeLevel = 'info' | 'warning' | 'error'

export type DirSyncNotice = {
  line: string
  level: DirSyncNoticeLevel
  notice?: unknown
}

export type DirSyncElsewhereLookup =
  | { kind: 'elsewhere' }
  | { kind: 'nowhere' }
  | { kind: 'nowhere'; ownRecord: true }
  | { kind: 'unknown'; why: string }

export type DirSyncV5Handle = {
  backend: StorageV5
  key: Record<string, unknown>
}

export type LaptopDirSyncStoppedReason =
  | 'created_empty_unfilled'
  | 'engine_declined'
  | 'engine_unsupported'
  | 'arm_failed'
  | 'store_unreadable'

export type LaptopDirSyncEngineSpec =
  | {
      kind: 'stopped'
      reason: LaptopDirSyncStoppedReason
      line: string
      level?: DirSyncNoticeLevel
      silent?: boolean
      withholdFirstSend?: unknown
    }
  | { kind: 'not_armed'; reason: string; line: string }
  | { kind: 'off'; withholdFirstSend?: unknown }
  | { kind: 'git'; [k: string]: unknown }
  | { kind: 'folder'; [k: string]: unknown }

export type LaptopDirSyncSessionHandle = {
  sessionId: string
  gitRoot: string
  status: ReturnType<typeof createDirSyncNoticeBus>
  sync: ReturnType<typeof createStoppedSync>
  createFacts?: unknown
}

function dirSyncSessionId(id: string): string {
  return toInfraSessionId(id)
}

function mq(sessionId: string): string {
  return /^[A-Za-z0-9_-]{1,128}$/.test(sessionId)
    ? sessionId
    : sanitizePath(sessionId)
}

function R4t(sessionId: string): string {
  return `${mq(sessionId)}${DIR_SYNC_RECORD_SUFFIX}`
}

function emptyMarkerName(sessionId: string): string {
  return `${mq(sessionId)}${DIR_SYNC_EMPTY_MARKER_SUFFIX}`
}

/** gold `eEt` @195603080 */
export function emptyMarkerPath(recordPath: string, sessionId: string): string {
  return join(dirname(recordPath), emptyMarkerName(sessionId))
}

/** gold `iTn` @195602965 — invalid key → undefined (missing v5). */
export function dirSyncRecordV5Key(
  projectKey: string,
  sessionId: string,
): Record<string, unknown> | undefined {
  const n = {
    namespace: 'dirSyncRecord',
    projectKey,
    sessionId: mq(sessionId),
  }
  if (typeof n !== 'object' || n === null) return
  return n
}

/** gold `hQ` @195602782 — path + optional v5 key; no FS pull engine. */
export async function dirSyncRecordHandle(
  gitRoot: string,
  sessionId: string,
  storageV5?: StorageV5,
): Promise<{
  path: string
  projectKey: string
  v5: DirSyncV5Handle | undefined
}> {
  const o = gitRoot
  const s = join(getProjectDir(o), R4t(sessionId))
  const i = sanitizePath(o)
  const a =
    storageV5 === undefined ? undefined : dirSyncRecordV5Key(i, sessionId)
  return {
    path: s,
    projectKey: i,
    v5:
      storageV5 === undefined || a === undefined
        ? undefined
        : { backend: storageV5, key: a },
  }
}

/** gold `Zwt` @195602717 */
export async function dirSyncRecordPath(
  gitRoot: string,
  sessionId: string,
  storageV5?: StorageV5,
): Promise<string> {
  void storageV5
  return join(getProjectDir(gitRoot), R4t(sessionId))
}

function parseCreatedEmptyMarker(
  content: Buffer,
  sessionId: string,
): CreatedEmptyMarker | null {
  let e: unknown
  try {
    e = JSON.parse(content.toString('utf8'))
  } catch {
    return null
  }
  if (typeof e !== 'object' || e === null) return null
  const r = e as Record<string, unknown>
  if (r.version !== 1 || r.kind !== 'created_empty_unfilled') return null
  if (r.sessionId !== sessionId || typeof r.sessionId !== 'string') return null
  if (typeof r.createdAtMs !== 'number' || !Number.isInteger(r.createdAtMs)) {
    return null
  }
  if (
    typeof r.why !== 'string' ||
    !CREATED_EMPTY_WHYS.includes(r.why as CreatedEmptyWhy)
  ) {
    return null
  }
  return {
    version: 1,
    kind: 'created_empty_unfilled',
    sessionId: r.sessionId,
    createdAtMs: r.createdAtMs,
    why: r.why as CreatedEmptyWhy,
  }
}

async function c4tV5Read(v5: DirSyncV5Handle): Promise<{
  kind: 'ok' | 'absent' | 'unreadable'
  content?: Buffer
}> {
  try {
    const t = await v5.backend.read([
      { key: v5.key, offset: 0, length: DIR_SYNC_RECORD_MAX_BYTES + 1 },
    ])
    if (!t.ok) return { kind: 'unreadable' }
    const [r] = t.value.items
    if (!r?.found) return { kind: 'absent' }
    if (r.totalBytes > DIR_SYNC_RECORD_MAX_BYTES) return { kind: 'unreadable' }
    const value = r.value
    if (value === undefined) return { kind: 'unreadable' }
    return {
      kind: 'ok',
      content: Buffer.from(value.buffer, value.byteOffset, value.byteLength),
    }
  } catch {
    return { kind: 'unreadable' }
  }
}

/**
 * gold `ito` @196030082 — storageV5 read wrap.
 * `_g` settings.read only (no settings.set). missing v5 → null.
 */
export async function readDirSyncV5(
  markerPath: string,
  sessionId: string,
  storageV5?: StorageV5 | DirSyncV5Handle,
): Promise<CreatedEmptyMarker | null> {
  void markerPath
  const handle =
    storageV5 === undefined
      ? undefined
      : 'backend' in storageV5 && 'key' in storageV5
        ? storageV5
        : undefined
  if (handle === undefined) return null
  const e = await c4tV5Read(handle)
  return e.kind === 'ok' && e.content !== undefined
    ? parseCreatedEmptyMarker(e.content, sessionId)
    : null
}

/**
 * gold `ato` @196030166 — created-empty marker. Lookup wrap; no FS pull engine.
 */
export async function noteDirSyncV5({
  gitRoot,
  sessionId,
  storageV5,
  why,
}: {
  gitRoot: string
  sessionId: string
  storageV5?: StorageV5
  why: CreatedEmptyWhy
}): Promise<void> {
  const i = dirSyncSessionId(sessionId)
  try {
    const a = await dirSyncRecordHandle(gitRoot, i, storageV5)
    const markerPath = emptyMarkerPath(a.path, i)
    const existing =
      a.v5 !== undefined
        ? await c4tV5Read(a.v5)
        : (await existsFileIfParentDir(a.path)) === false
          ? { kind: 'absent' as const }
          : { kind: 'unreadable' as const }
    if (existing.kind !== 'absent') return
    const m: CreatedEmptyMarker = {
      version: 1,
      kind: 'created_empty_unfilled',
      sessionId: i,
      createdAtMs: Date.now(),
      why,
    }
    const body = Buffer.from(JSON.stringify(m), 'utf8')
    if (a.v5 !== undefined) {
      const written = await a.v5.backend.write(a.v5.key, body)
      if (written.ok) return
    }
    await writeFile(markerPath, body)
  } catch (a) {
    logForDebugging(
      `[dirSync] created-empty marker for ${i} not written: could not work out its path: ${errorMessage(a)}; a later attach will not be warned that this session is empty`,
    )
  }
}

/**
 * gold `q9` @196031203 notice bus. Backlog 50 until a subscriber is live.
 */
export function createDirSyncNoticeBus(): {
  publish: (line: string, level: DirSyncNoticeLevel, notice?: unknown) => void
  takeBacklog: () => DirSyncNotice[]
  subscribe: (listener: (c: DirSyncNotice) => void) => () => void
} {
  const listeners = new Set<(c: DirSyncNotice) => void>()
  let t: DirSyncNotice[] = []
  let n = 0
  return {
    publish(e, i, r) {
      const c =
        r === undefined
          ? { line: e, level: i }
          : { line: e, level: i, notice: r }
      if (n === 0) {
        t = [...t, c].slice(-DIR_SYNC_NOTICE_BACKLOG_CAP)
        return
      }
      for (const listener of listeners) listener(c)
    },
    takeBacklog() {
      const e = t
      t = []
      return e
    },
    subscribe(e) {
      n += 1
      listeners.add(e)
      return () => {
        n -= 1
        listeners.delete(e)
      }
    },
  }
}

/**
 * gold `gC` @196032132 file kind dir/symlink/file/other.
 */
export async function fileKindDirSymlink(
  i: Dirent,
  e: string,
  t: DirSyncFileKind,
): Promise<DirSyncFileKind> {
  if (i.isDirectory()) return 'dir'
  if (i.isSymbolicLink()) return 'symlink'
  if (i.isFile()) return 'file'
  if (
    i.isFIFO() ||
    i.isSocket() ||
    i.isBlockDevice() ||
    i.isCharacterDevice()
  ) {
    return 'other'
  }
  try {
    const r = await lstat(e)
    return r.isDirectory()
      ? 'dir'
      : r.isSymbolicLink()
        ? 'symlink'
        : r.isFile()
          ? 'file'
          : 'other'
  } catch {
    return t
  }
}

function createStoppedSync(
  publish: (line: string, level: DirSyncNoticeLevel) => void,
  n: LaptopDirSyncStoppedReason | string,
  r: string,
  s: DirSyncNoticeLevel = 'warning',
  _g?: unknown,
): {
  state: () => { state: 'stopped'; reason: string; message: string }
  messageSent: () => void
  beforeSend: () => Promise<void>
  afterResult: () => void
  laneChanged: () => void
  afterConnect: () => void
  afterDisconnect: () => void
  drain: () => Promise<boolean>
  shutdown: () => Promise<void>
} {
  void _g
  let h = false
  const b = (): void => {
    if (!h) {
      h = true
      publish(r, s)
    }
  }
  return {
    state: () => ({ state: 'stopped', reason: n, message: r }),
    messageSent() {},
    beforeSend: async () => b(),
    afterResult() {},
    laneChanged() {},
    afterConnect: b,
    afterDisconnect() {},
    drain: async () => true,
    shutdown: async () => {},
  }
}

/**
 * gold `R` @196040117 stopped-handle factory (sibling of Me).
 * git/folder openers are the FS pull engine — not copied. Those kinds wrap
 * gold `$Ce()` false as stopped `engine_declined` (`OCo`).
 */
export function createStoppedLaptopDirSyncSession({
  sessionId: f,
  gitRoot: g,
  boundToThisMachine: s,
  hostConsented: a = false,
  createFacts: S,
  credentials: o,
  registry: F,
  storageV5: y,
  engine: n,
}: {
  sessionId: string
  gitRoot: string
  boundToThisMachine?: boolean | Promise<boolean>
  hostConsented?: boolean
  createFacts?: unknown
  credentials?: unknown
  registry?: { hold?: (u: unknown, tag?: unknown) => void }
  storageV5?: StorageV5
  engine: LaptopDirSyncEngineSpec
}): LaptopDirSyncSessionHandle {
  void s
  void a
  void o
  void y
  const i = dirSyncSessionId(f)
  const h = createDirSyncNoticeBus()
  const declined: LaptopDirSyncEngineSpec = {
    kind: 'stopped',
    reason: 'engine_declined',
    line: DIR_SYNC_ENGINE_DECLINED_LINE,
    level: 'info',
  }
  const engine = n.kind === 'git' || n.kind === 'folder' ? declined : n
  const u: LaptopDirSyncSessionHandle = {
    sessionId: i,
    gitRoot: g,
    status: h,
    sync:
      engine.kind === 'not_armed'
        ? createStoppedSync(h.publish, 'not_armed', engine.line, 'warning')
        : engine.kind === 'off'
          ? createStoppedSync(
              h.publish,
              'engine_declined',
              DIR_SYNC_ENGINE_DECLINED_LINE,
              'info',
            )
          : engine.kind === 'stopped' && engine.silent === true
            ? createStoppedSync(
                h.publish,
                engine.reason,
                engine.line,
                engine.level ?? 'warning',
              )
            : createStoppedSync(
                h.publish,
                engine.kind === 'stopped' ? engine.reason : 'engine_declined',
                engine.kind === 'stopped'
                  ? engine.line
                  : DIR_SYNC_ENGINE_DECLINED_LINE,
                engine.kind === 'stopped'
                  ? (engine.level ?? 'warning')
                  : 'info',
              ),
    ...(S !== undefined && { createFacts: S }),
  }
  F?.hold?.(u)
  return u
}

/**
 * gold `TBn` @182125118 / `M` @196041459
 * `TBn()==="on"?"given":"switched_off"`
 */
export async function dirSyncWoodGate(): Promise<'on' | 'switched_off'> {
  if (await isViolinWoodEnabled()) return 'on'
  return 'switched_off'
}

export async function dirSyncEngineConsent(): Promise<
  'given' | 'switched_off'
> {
  return (await dirSyncWoodGate()) === 'on' ? 'given' : 'switched_off'
}

/**
 * gold `aLe` / `ee` @196047200 — folder path, not git-engine compositor.
 */
export function isGitRepositoryRoot(f: string): boolean {
  const root = findGitRoot(f)
  return root !== null && root === f
}

export function gitRepositoryRootOrNull(f: string): string | null {
  return isGitRepositoryRoot(f) ? f : null
}

const ELSEWHERE: DirSyncElsewhereLookup = { kind: 'elsewhere' }
const NOWHERE: DirSyncElsewhereLookup = { kind: 'nowhere' }
const NOWHERE_OWN: DirSyncElsewhereLookup = { kind: 'nowhere', ownRecord: true }

/** gold `W` @196047325 exists file/dir via lstat. */
export async function existsKind(
  f: string,
  g: 'file' | 'dir',
): Promise<boolean | undefined> {
  return lstat(f).then(
    s => (g === 'file' ? s.isFile() : s.isDirectory()) || undefined,
    s => {
      const a = getErrnoCode(s)
      return a === 'ENOENT' || a === 'ENOTDIR' ? false : undefined
    },
  )
}

export function existsFile(f: string): Promise<boolean | undefined> {
  return existsKind(f, 'file')
}

export async function existsFileIfParentDir(
  f: string,
): Promise<boolean | undefined> {
  const g = await existsKind(dirname(f), 'dir')
  return g === true ? existsFile(f) : g
}

function dirSyncElsewhereFailed(err: unknown): DirSyncElsewhereLookup {
  logForDebugging(
    `[dirSync] looking for this session's base elsewhere failed: ${errorMessage(err)}`,
    { level: 'warn' },
  )
  return { kind: 'unknown', why: 'listing_failed' }
}

/**
 * gold `re` @196048705 v5 listing. LOOKUP only.
 */
export async function listDirSyncBaseElsewhereV5(
  f: StorageV5,
  g: string,
  s: string,
  a: number,
): Promise<DirSyncElsewhereLookup> {
  const S = await dirSyncRecordHandle(g, s, f)
  if (S.v5 === undefined) {
    const i = await existsFileIfParentDir(S.path)
    if (i !== false)
      return i ? NOWHERE_OWN : { kind: 'unknown', why: 'here_unreadable' }
  } else {
    const i = await f.scopeKind({
      namespace: 'transcript',
      projectKey: S.projectKey,
    })
    if (!i.ok || i.value.kind === 'link' || i.value.kind === 'other') {
      return { kind: 'unknown', why: 'here_unreadable' }
    }
    if (i.value.kind === 'directory') {
      const h = await f.statMeta(S.v5.key)
      if (h.ok) return NOWHERE_OWN
      if (h.error.code !== 'NotFound') {
        return { kind: 'unknown', why: 'here_unreadable' }
      }
    }
  }
  const o: string[] = []
  let F: unknown
  do {
    const i: StorageV5Result<{
      items: Array<{
        kind: 'key' | 'scope'
        scope?: { namespace?: string; projectKey?: string }
      }>
      cursor?: unknown
    }> = await f.listEntries(
      { namespace: 'transcript' },
      { cursor: F, skipScopeStats: true, skipKeyStats: true },
    )
    if (!i.ok) {
      logForDebugging(
        `[dirSync] looking for this session's base elsewhere failed: ${i.error.code}`,
        { level: 'warn' },
      )
      return { kind: 'unknown', why: 'listing_failed' }
    }
    for (const h of i.value.items) {
      if (h.kind === 'scope' && h.scope?.namespace === 'transcript') {
        const u = h.scope.projectKey
        if (u !== undefined) o.push(u)
      }
    }
    F = i.value.cursor
  } while (F !== undefined && o.length < a)
  const y = o.slice(0, a)
  let n = false
  for (let i = 0; i < y.length; i += DIR_SYNC_ELSEWHERE_PROBE_BATCH) {
    const h = await Promise.all(
      y.slice(i, i + DIR_SYNC_ELSEWHERE_PROBE_BATCH).map(async u => {
        const b = dirSyncRecordV5Key(u, s)
        if (b === undefined) return
        const D = await f.statMeta(b)
        return D.ok ? true : D.error.code === 'NotFound' ? false : undefined
      }),
    )
    if (h.includes(true)) return ELSEWHERE
    n ||= h.includes(undefined)
  }
  return n
    ? { kind: 'unknown', why: 'probe_failed' }
    : F !== undefined || o.length > y.length
      ? { kind: 'unknown', why: 'listing_capped' }
      : NOWHERE
}

/**
 * gold `te` @196048705 lookup catch log `[dirSync] looki`
 */
export async function lookupDirSyncBaseElsewhereV5(
  f: StorageV5,
  g: string,
  s: string,
  a: number,
): Promise<DirSyncElsewhereLookup> {
  try {
    return await listDirSyncBaseElsewhereV5(f, g, s, a)
  } catch (S) {
    return dirSyncElsewhereFailed(S)
  }
}

/**
 * gold `Ue` @196048448 dump FULL string
 */
export function DIR_SYNC_ELSEWHERE_LINE(cwd = getOriginalCwd()): string {
  return `File sync for this session was set up from another directory on this machine, not ${cwd}: edits here are not uploaded, and Claude's changes are not written here. Attaching from that directory resumes it if sync is still on there.`
}

/**
 * gold `Ie` @196047583 `{kind:"unknown", why:"not_looked"}` if !es()
 */
export async function lookupDirSyncBaseElsewhere(
  f: string,
  g?: StorageV5,
  s = DIR_SYNC_ELSEWHERE_LISTING_CAP,
): Promise<DirSyncElsewhereLookup> {
  if (!isViolinWoodEnabledSync()) return { kind: 'unknown', why: 'not_looked' }
  const a = dirSyncSessionId(f)
  const S = getOriginalCwd()
  const o = findGitRoot(S) ?? S
  if (isHoverRestOn() && g !== undefined) {
    return lookupDirSyncBaseElsewhereV5(g, o, a, s)
  }
  const F = await dirSyncRecordPath(o, a, g)
  const y = getProjectsDir()
  const n = R4t(a)
  try {
    const i = await existsFileIfParentDir(F)
    if (i !== false)
      return i ? NOWHERE_OWN : { kind: 'unknown', why: 'here_unreadable' }
    const h = await readdir(y, { withFileTypes: true })
    const u = await Promise.all(
      h.map(e => fileKindDirSymlink(e, join(y, e.name), 'unknown')),
    )
    const b = h.filter((_e, r) => u[r] === 'dir')
    const D = b.slice(0, s)
    let w = u.some(e => e === 'symlink' || e === 'unknown')
    for (let e = 0; e < D.length; e += DIR_SYNC_ELSEWHERE_PROBE_BATCH) {
      const r = await Promise.all(
        D.slice(e, e + DIR_SYNC_ELSEWHERE_PROBE_BATCH).map(k =>
          existsFile(join(y, k.name, n)),
        ),
      )
      if (r.includes(true)) return ELSEWHERE
      w ||= r.includes(undefined)
    }
    return w
      ? { kind: 'unknown', why: 'probe_failed' }
      : b.length > D.length
        ? { kind: 'unknown', why: 'listing_capped' }
        : NOWHERE
  } catch (i) {
    if (isENOENT(i)) return NOWHERE
    return dirSyncElsewhereFailed(i)
  }
}

export type DirectorySyncHandleTake = (
  sessionId: string,
) => Promise<LaptopDirSyncSessionHandle | undefined> | undefined

export type DirectorySyncHandleRelease = (
  sessionId: string,
) => Promise<void> | void

/**
 * gold `kRr` @181572085 — `y_().take(e)`.
 * No dir-sync registry / laptop FS pull engine; default is no handle.
 * Tests inject `takeDirSync`.
 */
function takeDirSyncFromLookup(_sessionId: string): undefined {
  return undefined
}

/**
 * gold `Fo` @202412951 — `y_().retire(e)`.
 * No dir-sync registry engine; default is a no-op retire.
 */
async function releaseDirSyncFromLookup(_sessionId: string): Promise<void> {}

/**
 * gold `hn` @202412591
 * FULL: `[headlessCloud] directory-sync handle unavailable: ${l(r)}`
 */
export function takeDirectorySyncHandle(
  sessionId: string,
  seams: { takeDirSync?: DirectorySyncHandleTake } = {},
): Promise<LaptopDirSyncSessionHandle | undefined> {
  const s = (seams.takeDirSync ?? takeDirSyncFromLookup)(sessionId)
  return s === undefined
    ? Promise.resolve(undefined)
    : s.catch((r: unknown) => {
        logForDebugging(
          `[headlessCloud] directory-sync handle unavailable: ${errorMessage(r)}`,
        )
        return
      })
}

/**
 * gold `fn` @202412770
 * FULL: `[headlessCloud] directory-sync handle not released: ${l(s)}`
 */
export async function releaseDirectorySyncHandle(
  handle:
    | Promise<LaptopDirSyncSessionHandle | undefined>
    | LaptopDirSyncSessionHandle
    | undefined,
  seams: { releaseDirSync?: DirectorySyncHandleRelease } = {},
): Promise<void> {
  try {
    const s = await handle
    if (s === undefined) return
    await (seams.releaseDirSync ?? releaseDirSyncFromLookup)(s.sessionId)
  } catch (err) {
    logForDebugging(
      `[headlessCloud] directory-sync handle not released: ${errorMessage(err)}`,
    )
  }
}
