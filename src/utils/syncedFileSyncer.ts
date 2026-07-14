/**
 * Official working-sync densable (wEf / V6o / constants).
 *
 * Full CCR filestore push/pull (j6o / lane rows / etag conflict) remains denser.
 * This densifies:
 * - path ignore + root-escape helpers
 * - constants (MAX_WORKING_FILE_BYTES, poll/backoff, SYNCED_FILE_ROOT)
 * - startSyncedFileSyncer: mkdir + local mtime scan loop (no remote push)
 */

import { mkdir, readdir, lstat, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'

/** Official xxe — 25 MiB. */
export const MAX_WORKING_FILE_BYTES = 26_214_400
/** Official R1a. */
export const MAX_SCAN_ENTRIES = 4096
/** Official MNb concurrency. */
export const MAX_PUSH_CONCURRENCY = 4
/** Official v1a poll interval ms. */
export const WORKING_SYNC_POLL_MS = 5_000
/** Official _Ef max poll backoff. */
export const POLL_BACKOFF_MAX_MS = 120_000
/** Official bEf parent mkdir attempts. */
export const PARENT_MKDIR_ATTEMPTS = 5
/** Official TEf parent mkdir backoff. */
export const PARENT_MKDIR_BACKOFF_MS = 2_000
/** Official SYNCED_FILE_ROOT default mount. */
export const SYNCED_FILE_ROOT = '/mnt/user-data/working'
/** Official STAGE_FILE defaults (denser stage path still package-local). */
export const DEFAULT_STAGE_FILE_ROOT = '/mnt/user-data/uploads'
/**
 * Official WORKING_FILESTORE_PREFIX / Bbr — CCR filestore path prefix for
 * working-sync objects (`${prefix}/${relPath}`).
 */
export const WORKING_FILESTORE_PREFIX = 'working'
/** Official yEf densable default timeout for put/get (ms). */
export const WORKING_FILESTORE_TIMEOUT_MS = 30_000

/**
 * Official V6o shouldIgnore — skip dot segments, ~ backups, .swp/.tmp.
 */
export function shouldIgnoreSyncedPath(relPath: string): boolean {
  for (const part of relPath.split(/[/\\]/)) {
    if (!part) continue
    if (part.startsWith('.')) return true
    if (part.endsWith('~')) return true
    if (part.endsWith('.swp')) return true
    if (part.endsWith('.tmp')) return true
  }
  return false
}

/**
 * Official escapesSyncRoot densable — true when resolved path leaves root.
 */
export function escapesSyncRoot(root: string, relPath: string): boolean {
  const resolved = join(root, relPath)
  const rel = relative(root, resolved)
  return rel.startsWith('..') || rel === '..' || rel.split(sep).includes('..')
}

export function relUnderSyncDir(root: string, absPath: string): string {
  return relative(root, absPath).split(sep).join('/')
}

/**
 * Official filestore object path densable — `${WORKING_FILESTORE_PREFIX}/${rel}`.
 */
export function buildWorkingFilestorePath(
  relPath: string,
  prefix: string = WORKING_FILESTORE_PREFIX,
): string {
  const clean = relPath.replace(/^\/+/, '')
  return `${prefix}/${clean}`
}

/** Official sha256Hex densable for content etag. */
export function sha256Hex(buf: Uint8Array | string): string {
  // Lazy require so tests/bootstrap don't pull crypto at module load.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createHash } = require('node:crypto') as typeof import('node:crypto')
  return createHash('sha256').update(buf).digest('hex')
}

export type SyncedTransportKind =
  | 'timeout'
  | 'network'
  | 'auth'
  | 'http'
  | 'other'

/**
 * Official SEf densable — whether a transport/http error is retryable.
 */
export function isRetryableTransport(
  kind: SyncedTransportKind | string,
  status?: number,
): boolean {
  if (kind === 'timeout' || kind === 'network') return true
  if (kind === 'auth' || kind === 'other') return false
  if (status === undefined) return true
  return status === 408 || status === 429 || status >= 500
}

/**
 * Official EEf densable pure — build error result for put/get failures.
 */
export function classifySyncedFileTransportError(
  op: 'put' | 'get' | string,
  kind: SyncedTransportKind | string,
  status?: number,
): { kind: 'error'; message: string; retryable: boolean } {
  const retryable = isRetryableTransport(kind, status)
  return {
    kind: 'error',
    message: `${op} failed: ${kind}${status !== undefined ? ` ${status}` : ''}`,
    retryable,
  }
}

export type PushSyncedFileResult =
  | { kind: 'ok'; content_sha256: string }
  | { kind: 'conflict' }
  | { kind: 'error'; message: string; retryable: boolean }

export type GetSyncedFileResult =
  | { kind: 'ok'; buf: Buffer; content_sha256: string }
  | { kind: 'not_found' }
  | { kind: 'error'; message: string; retryable: boolean }

export type ApplySyncedFileWriteResult =
  | { kind: 'ok'; absPath: string; bytes: number }
  | { kind: 'skipped'; reason: string }
  | { kind: 'error'; message: string }

/**
 * Official J2t apply densable — write a getSyncedFile buffer under sync root.
 * Guards ignore patterns + root escape; creates parent dirs.
 * Real CCR lane/etag reconcile remains denser; this is the local write body.
 */
export async function applySyncedFileWrite(input: {
  root: string
  relPath: string
  content: Buffer | Uint8Array | string
}): Promise<ApplySyncedFileWriteResult> {
  const rel = input.relPath.replace(/^[/\\]+/, '')
  if (!rel) {
    return { kind: 'skipped', reason: 'empty_path' }
  }
  // Escape check before ignore — `..` segments are both ignored and escapes.
  if (escapesSyncRoot(input.root, rel)) {
    return { kind: 'error', message: 'path escapes sync root' }
  }
  if (shouldIgnoreSyncedPath(rel)) {
    return { kind: 'skipped', reason: 'ignored_path' }
  }
  const absPath = join(input.root, rel)
  try {
    await mkdir(dirname(absPath), { recursive: true })
    const buf =
      typeof input.content === 'string'
        ? Buffer.from(input.content)
        : Buffer.from(input.content)
    if (buf.byteLength > MAX_WORKING_FILE_BYTES) {
      return {
        kind: 'error',
        message: `file exceeds MAX_WORKING_FILE_BYTES (${MAX_WORKING_FILE_BYTES})`,
      }
    }
    await writeFile(absPath, buf)
    return { kind: 'ok', absPath, bytes: buf.byteLength }
  } catch (err) {
    return {
      kind: 'error',
      message: err instanceof Error ? err.message : String(err),
    }
  }
}

/**
 * Official J2t download densable — get remote object then apply local write.
 * Injectable get transport; no-op error when transport missing.
 */
export async function downloadAndApplySyncedFile(input: {
  root: string
  relPath: string
  prefix?: string
  get?: Parameters<typeof getSyncedFile>[0]['get']
}): Promise<
  | ApplySyncedFileWriteResult
  | { kind: 'not_found' }
  | { kind: 'error'; message: string; retryable: boolean }
> {
  const got = await getSyncedFile({
    relPath: input.relPath,
    ...(input.prefix ? { prefix: input.prefix } : {}),
    ...(input.get ? { get: input.get } : {}),
  })
  if (got.kind !== 'ok') return got
  return applySyncedFileWrite({
    root: input.root,
    relPath: input.relPath,
    content: got.buf,
  })
}

/**
 * Official j6o densable — push a working file to CCR filestore via injectable
 * put transport. Real bi.put remains denser when host not provided.
 */
export async function pushSyncedFile(input: {
  relPath: string
  content: Buffer | Uint8Array | string
  ifMatchSha256?: string
  workerEpoch?: number | string
  prefix?: string
  put?: (body: {
    path: string
    content: string
    if_match_sha256?: string
    worker_epoch: number | string
  }) => Promise<{
    ok: boolean
    reason?: string
    status?: number
    data?: { content_sha256?: string }
  }>
}): Promise<PushSyncedFileResult> {
  const path = buildWorkingFilestorePath(input.relPath, input.prefix)
  const contentB64 = Buffer.from(input.content as Uint8Array).toString('base64')
  const body = {
    path,
    content: contentB64,
    ...(input.ifMatchSha256 ? { if_match_sha256: input.ifMatchSha256 } : {}),
    worker_epoch: input.workerEpoch ?? 0,
  }
  if (!input.put) {
    return {
      kind: 'error',
      message: 'put gated: no filestore transport',
      retryable: false,
    }
  }
  try {
    const res = await input.put(body)
    // Official j6o: 409 etag conflict is soft-fail (ok:false + status/reason).
    if (res.status === 409 || res.reason === 'conflict') {
      return { kind: 'conflict' }
    }
    if (!res.ok) {
      return {
        kind: 'error',
        message: `put gated: ${res.reason ?? 'unknown'}`,
        retryable: isRetryableTransport('http', res.status),
      }
    }
    const hash =
      res.data?.content_sha256 ??
      sha256Hex(Buffer.from(input.content as Uint8Array))
    return { kind: 'ok', content_sha256: hash }
  } catch (err) {
    const status =
      err && typeof err === 'object' && 'status' in err
        ? Number((err as { status?: unknown }).status)
        : undefined
    const kind =
      err && typeof err === 'object' && 'kind' in err
        ? String((err as { kind?: unknown }).kind)
        : 'other'
    return classifySyncedFileTransportError('put', kind, status)
  }
}

/**
 * Official J2t densable — get a working file from CCR filestore via injectable
 * get transport. Real bi.get remains denser when host not provided.
 */
export async function getSyncedFile(input: {
  relPath: string
  prefix?: string
  get?: (path: string) => Promise<{
    ok: boolean
    reason?: string
    status?: number
    data?: { content?: string; content_sha256?: string }
  }>
}): Promise<GetSyncedFileResult> {
  const path = buildWorkingFilestorePath(input.relPath, input.prefix)
  if (!input.get) {
    return {
      kind: 'error',
      message: 'get gated: no filestore transport',
      retryable: false,
    }
  }
  try {
    const res = await input.get(path)
    if (!res.ok) {
      return {
        kind: 'error',
        message: `get gated: ${res.reason ?? 'unknown'}`,
        retryable: false,
      }
    }
    if (res.status === 404) return { kind: 'not_found' }
    const content = res.data?.content
    if (typeof content !== 'string') {
      return {
        kind: 'error',
        message: 'get failed: missing content',
        retryable: false,
      }
    }
    const buf = Buffer.from(content, 'base64')
    const hash = res.data?.content_sha256 ?? sha256Hex(buf)
    return { kind: 'ok', buf, content_sha256: hash }
  } catch (err) {
    const status =
      err && typeof err === 'object' && 'status' in err
        ? Number((err as { status?: unknown }).status)
        : undefined
    const kind =
      err && typeof err === 'object' && 'kind' in err
        ? String((err as { kind?: unknown }).kind)
        : 'other'
    return classifySyncedFileTransportError('get', kind, status)
  }
}

/**
 * Official put body max densable — base64 expansion of MAX_WORKING_FILE_BYTES.
 */
export function maxWorkingFilestoreBodyBytes(
  maxFileBytes: number = MAX_WORKING_FILE_BYTES,
): number {
  return Math.ceil((maxFileBytes * 4) / 3) + 1024
}

/** Official j6o/J2t CCR paths densable. */
export const WORKING_FILESTORE_PUT_PATH = '/worker/synced_file'
/** Official remote list densable path (lane inventory). */
export const WORKING_FILESTORE_LIST_PATH = '/worker/synced_files'
export function buildWorkingFilestoreGetPath(
  relPath: string,
  prefix: string = WORKING_FILESTORE_PREFIX,
): string {
  const objectPath = buildWorkingFilestorePath(relPath, prefix)
  return `${WORKING_FILESTORE_PUT_PATH}?path=${encodeURIComponent(objectPath)}`
}

export function buildWorkingFilestoreListPath(
  prefix: string = WORKING_FILESTORE_PREFIX,
  cursor?: string,
): string {
  const qs = new URLSearchParams({ prefix })
  if (cursor) qs.set('cursor', cursor)
  return `${WORKING_FILESTORE_LIST_PATH}?${qs.toString()}`
}

/**
 * Official lane row densable — remote filestore inventory entry.
 * `path` is the object path (`working/rel`) or relative under prefix.
 */
export type SyncedFileLaneRow = {
  path: string
  content_sha256?: string
  size?: number
  mtime_ms?: number
}

/**
 * Normalize a lane path to a sync-root relative path (posix).
 * Accepts either `working/foo` or `foo`.
 */
export function laneRowToRelPath(
  rowPath: string,
  prefix: string = WORKING_FILESTORE_PREFIX,
): string {
  const cleaned = rowPath.replace(/^\/+/, '')
  const pfx = `${prefix.replace(/\/+$/, '')}/`
  if (cleaned === prefix || cleaned === prefix.replace(/\/+$/, '')) return ''
  if (cleaned.startsWith(pfx)) return cleaned.slice(pfx.length)
  return cleaned
}

export type SyncedFileLaneAction =
  | { action: 'skip'; relPath: string; reason: 'equal' | 'ignored' | 'empty' }
  | { action: 'pull'; relPath: string; remoteSha256?: string }
  | {
      action: 'push'
      relPath: string
      localSha256?: string
      ifMatchSha256?: string
    }
  | {
      action: 'conflict'
      relPath: string
      localSha256?: string
      remoteSha256?: string
    }

/**
 * Official lane/etag reconcile densable (pure) — decide pull/push/skip/conflict
 * from local etag map + remote list + optional local-only paths.
 *
 * Rules:
 * - ignored / empty rel → skip
 * - remote-only (or remote sha ≠ local) → pull
 * - local-only with local sha → push (no if-match)
 * - both present, equal sha → skip equal
 * - both present, unequal sha + preferLocal → conflict (caller resolves)
 * - both present, unequal sha + !preferLocal → pull (remote wins default)
 */
export function planSyncedFileLaneReconcile(input: {
  remote: readonly SyncedFileLaneRow[]
  /** relPath → content_sha256 (local etag cache). */
  localEtags?: ReadonlyMap<string, string> | Record<string, string>
  /** Local-only paths not present remotely (from scan). */
  localOnly?: readonly string[]
  prefix?: string
  /**
   * When both sides have different sha256, prefer local (emit conflict) instead
   * of pull. Default false → remote wins (pull).
   */
  preferLocalOnConflict?: boolean
}): SyncedFileLaneAction[] {
  const prefix = input.prefix ?? WORKING_FILESTORE_PREFIX
  const localMap = new Map<string, string>()
  if (input.localEtags) {
    if (input.localEtags instanceof Map) {
      for (const [k, v] of input.localEtags) localMap.set(k, v)
    } else {
      for (const [k, v] of Object.entries(input.localEtags)) localMap.set(k, v)
    }
  }
  const actions: SyncedFileLaneAction[] = []
  const seenRemote = new Set<string>()

  for (const row of input.remote) {
    const rel = laneRowToRelPath(row.path, prefix)
    if (!rel) {
      actions.push({ action: 'skip', relPath: rel, reason: 'empty' })
      continue
    }
    if (shouldIgnoreSyncedPath(rel)) {
      actions.push({ action: 'skip', relPath: rel, reason: 'ignored' })
      continue
    }
    seenRemote.add(rel)
    const localSha = localMap.get(rel)
    const remoteSha = row.content_sha256
    if (localSha && remoteSha && localSha === remoteSha) {
      actions.push({ action: 'skip', relPath: rel, reason: 'equal' })
      continue
    }
    if (localSha && remoteSha && localSha !== remoteSha) {
      if (input.preferLocalOnConflict) {
        actions.push({
          action: 'conflict',
          relPath: rel,
          localSha256: localSha,
          remoteSha256: remoteSha,
        })
      } else {
        actions.push({
          action: 'pull',
          relPath: rel,
          ...(remoteSha ? { remoteSha256: remoteSha } : {}),
        })
      }
      continue
    }
    // remote-only or local missing sha → pull
    actions.push({
      action: 'pull',
      relPath: rel,
      ...(remoteSha ? { remoteSha256: remoteSha } : {}),
    })
  }

  for (const rel of input.localOnly ?? []) {
    if (!rel || seenRemote.has(rel)) continue
    if (shouldIgnoreSyncedPath(rel)) {
      actions.push({ action: 'skip', relPath: rel, reason: 'ignored' })
      continue
    }
    actions.push({
      action: 'push',
      relPath: rel,
      ...(localMap.get(rel) ? { localSha256: localMap.get(rel) } : {}),
    })
  }

  return actions
}

export type ReconcileSyncedFileLanesResult = {
  pulled: number
  pushed: number
  skipped: number
  conflicts: number
  errors: number
  details: Array<{
    relPath: string
    action: string
    ok: boolean
    reason?: string
  }>
}

/**
 * Official lane reconcile executor densable — list remote (injectable) + plan +
 * pull/push with etag cache update. Full CCR worker host remains denser when
 * list/get/put are not provided.
 */
export async function reconcileSyncedFileLanes(input: {
  root: string
  prefix?: string
  localEtags?: Map<string, string>
  localOnly?: readonly string[]
  preferLocalOnConflict?: boolean
  list?: () => Promise<SyncedFileLaneRow[]>
  get?: NonNullable<Parameters<typeof getSyncedFile>[0]['get']>
  put?: NonNullable<Parameters<typeof pushSyncedFile>[0]['put']>
  workerEpoch?: number | string
  /**
   * Optional local content reader for push (defaults to readFile under root).
   */
  readLocal?: (relPath: string) => Promise<Buffer | null>
}): Promise<ReconcileSyncedFileLanesResult> {
  const etags = input.localEtags ?? new Map<string, string>()
  const remote = input.list ? await input.list() : []
  const plan = planSyncedFileLaneReconcile({
    remote,
    localEtags: etags,
    ...(input.localOnly ? { localOnly: input.localOnly } : {}),
    ...(input.prefix ? { prefix: input.prefix } : {}),
    preferLocalOnConflict: input.preferLocalOnConflict,
  })

  const details: ReconcileSyncedFileLanesResult['details'] = []
  let pulled = 0
  let pushed = 0
  let skipped = 0
  let conflicts = 0
  let errors = 0

  const readLocal =
    input.readLocal ??
    (async (rel: string) => {
      try {
        return await readFile(join(input.root, rel))
      } catch {
        return null
      }
    })

  for (const step of plan) {
    if (step.action === 'skip') {
      skipped++
      details.push({
        relPath: step.relPath,
        action: 'skip',
        ok: true,
        reason: step.reason,
      })
      continue
    }
    if (step.action === 'conflict') {
      conflicts++
      details.push({
        relPath: step.relPath,
        action: 'conflict',
        ok: false,
        reason: 'etag_mismatch',
      })
      continue
    }
    if (step.action === 'pull') {
      if (!input.get) {
        errors++
        details.push({
          relPath: step.relPath,
          action: 'pull',
          ok: false,
          reason: 'no_get_transport',
        })
        continue
      }
      const applied = await downloadAndApplySyncedFile({
        root: input.root,
        relPath: step.relPath,
        ...(input.prefix ? { prefix: input.prefix } : {}),
        get: input.get,
      })
      if (applied.kind === 'ok') {
        if (step.remoteSha256) etags.set(step.relPath, step.remoteSha256)
        pulled++
        details.push({ relPath: step.relPath, action: 'pull', ok: true })
      } else if (applied.kind === 'not_found') {
        errors++
        details.push({
          relPath: step.relPath,
          action: 'pull',
          ok: false,
          reason: 'not_found',
        })
      } else if (applied.kind === 'skipped') {
        skipped++
        details.push({
          relPath: step.relPath,
          action: 'pull',
          ok: true,
          reason: applied.reason,
        })
      } else {
        errors++
        details.push({
          relPath: step.relPath,
          action: 'pull',
          ok: false,
          reason: applied.message,
        })
      }
      continue
    }
    // push
    if (!input.put) {
      errors++
      details.push({
        relPath: step.relPath,
        action: 'push',
        ok: false,
        reason: 'no_put_transport',
      })
      continue
    }
    const content = await readLocal(step.relPath)
    if (!content) {
      errors++
      details.push({
        relPath: step.relPath,
        action: 'push',
        ok: false,
        reason: 'missing_local',
      })
      continue
    }
    const result = await pushSyncedFile({
      relPath: step.relPath,
      content,
      ifMatchSha256: step.ifMatchSha256 ?? etags.get(step.relPath),
      workerEpoch: input.workerEpoch,
      ...(input.prefix ? { prefix: input.prefix } : {}),
      put: input.put,
    })
    if (result.kind === 'ok') {
      etags.set(step.relPath, result.content_sha256)
      pushed++
      details.push({ relPath: step.relPath, action: 'push', ok: true })
    } else if (result.kind === 'conflict') {
      conflicts++
      details.push({
        relPath: step.relPath,
        action: 'push',
        ok: false,
        reason: 'conflict',
      })
    } else {
      errors++
      details.push({
        relPath: step.relPath,
        action: 'push',
        ok: false,
        reason: result.message,
      })
    }
  }

  return { pulled, pushed, skipped, conflicts, errors, details }
}

/**
 * Official j6o/J2t transport factory densable — builds put/get callables from
 * an injectable CCR request host. Real bi.put/get remains denser when no host.
 *
 * Official shapes:
 *   put /worker/synced_file {path, content base64, if_match_sha256?, worker_epoch}
 *   get /worker/synced_file?path=...
 */
export function createWorkingFilestoreTransports(input: {
  request: (args: {
    method: 'put' | 'get'
    path: string
    body?: unknown
    timeoutMs?: number
    maxBodyLength?: number
    maxContentLength?: number
  }) => Promise<{
    ok: boolean
    reason?: string
    status?: number
    data?: { content?: string; content_sha256?: string }
  }>
  workerEpoch?: number | string
  prefix?: string
  timeoutMs?: number
}): {
  put: NonNullable<Parameters<typeof pushSyncedFile>[0]['put']>
  get: NonNullable<Parameters<typeof getSyncedFile>[0]['get']>
} {
  const timeoutMs = input.timeoutMs ?? WORKING_FILESTORE_TIMEOUT_MS
  const maxBody = maxWorkingFilestoreBodyBytes()
  return {
    put: async body => {
      return input.request({
        method: 'put',
        path: WORKING_FILESTORE_PUT_PATH,
        body: {
          path: body.path,
          content: body.content,
          ...(body.if_match_sha256
            ? { if_match_sha256: body.if_match_sha256 }
            : {}),
          worker_epoch: body.worker_epoch,
        },
        timeoutMs,
        maxBodyLength: maxBody,
      })
    },
    get: async objectPath => {
      const qs = `${WORKING_FILESTORE_PUT_PATH}?path=${encodeURIComponent(objectPath)}`
      return input.request({
        method: 'get',
        path: qs,
        timeoutMs,
        maxContentLength: maxBody,
      })
    },
  }
}

export type SyncedFileSyncerHandle = {
  initialReconcile: Promise<void>
  flush: () => Promise<void>
  pendingCount: () => number
  pollBackoffUntilForTest: () => number
  stop: () => void
  /** Local densable: last seen mtimes (relPath → mtimeMs). */
  getSeenState: () => ReadonlyMap<string, number>
}

let active: SyncedFileSyncerHandle | null = null

export function stopActiveSyncerForTest(): void {
  active?.stop()
  active = null
}

export function getActiveSyncerForTest(): SyncedFileSyncerHandle | null {
  return active
}

async function ensureSyncRoot(root: string): Promise<boolean> {
  for (let attempt = 1; ; attempt++) {
    try {
      await mkdir(root, { recursive: true })
      return true
    } catch (err) {
      const code =
        err && typeof err === 'object' && 'code' in err
          ? String((err as { code?: unknown }).code)
          : undefined
      if (code === 'EEXIST') return true
      if (code === 'ENOENT' && attempt < PARENT_MKDIR_ATTEMPTS) {
        await new Promise(r => setTimeout(r, PARENT_MKDIR_BACKOFF_MS))
        continue
      }
      return false
    }
  }
}

export type StartSyncedFileSyncerOptions = {
  /**
   * Official j6o put transport densable. When provided, changed files are
   * pushed via pushSyncedFile. Without it, only local mtime scan runs.
   */
  put?: NonNullable<Parameters<typeof pushSyncedFile>[0]['put']>
  /** Optional etag cache (relPath → content_sha256) for if_match_sha256. */
  etags?: Map<string, string>
  /** Max file size for push (default MAX_WORKING_FILE_BYTES). */
  maxFileBytes?: number
  workerEpoch?: number | string
}

/**
 * Official wEf densable — local scan loop + optional j6o filestore push.
 */
export async function startSyncedFileSyncer(
  root: string = SYNCED_FILE_ROOT,
  options?: StartSyncedFileSyncerOptions,
): Promise<SyncedFileSyncerHandle | null> {
  if (!(await ensureSyncRoot(root))) return null

  const seen = new Map<string, number>()
  const inFlight = new Set<string>()
  const etags = options?.etags ?? new Map<string, string>()
  const put = options?.put
  const maxFileBytes = options?.maxFileBytes ?? MAX_WORKING_FILE_BYTES
  let stopped = false
  let scanCapLogged = false
  let pollBackoffUntil = 0
  let pollBackoffMs = 0
  let concurrentScans = 0

  const scanOnce = async (): Promise<void> => {
    const queue: string[] = ['']
    let entries = 0
    let hitCap = false
    let sawError = false
    const visited = new Set<string>()

    while (queue.length > 0 && !stopped) {
      const dirRel = queue.shift()!
      let dirents
      try {
        dirents = await readdir(join(root, dirRel), { withFileTypes: true })
      } catch {
        sawError = true
        continue
      }
      for (const d of dirents) {
        if (++entries > MAX_SCAN_ENTRIES) {
          hitCap = true
          if (!scanCapLogged) scanCapLogged = true
          queue.length = 0
          break
        }
        const rel = dirRel ? `${dirRel}/${d.name}` : d.name
        visited.add(rel)
        if (shouldIgnoreSyncedPath(rel)) continue
        if (d.isDirectory()) {
          queue.push(rel)
          continue
        }
        if (!d.isFile()) continue
        let mtimeMs: number
        let size = 0
        try {
          const st = await lstat(join(root, rel))
          mtimeMs = st.mtimeMs
          size = st.size
        } catch {
          continue
        }
        if (seen.get(rel) === mtimeMs) continue
        if (inFlight.has(rel)) continue
        inFlight.add(rel)
        try {
          // Official j6o densable: push when transport present and under size cap.
          if (put && size > 0 && size <= maxFileBytes) {
            try {
              const content = await readFile(join(root, rel))
              const result = await pushSyncedFile({
                relPath: rel,
                content,
                ifMatchSha256: etags.get(rel),
                workerEpoch: options?.workerEpoch,
                put,
              })
              if (result.kind === 'ok') {
                etags.set(rel, result.content_sha256)
                seen.set(rel, mtimeMs)
              } else if (result.kind === 'conflict') {
                // Conflict: keep local mtime unmarked so next poll retries denser.
              } else {
                // Non-retryable transport: still mark seen to avoid spin.
                if (!result.retryable) seen.set(rel, mtimeMs)
              }
            } catch {
              // read/push best-effort
            }
          } else {
            // Local densable: record mtime only (remote push denser).
            seen.set(rel, mtimeMs)
          }
        } finally {
          inFlight.delete(rel)
        }
      }
    }

    if (!hitCap && !sawError && !stopped) {
      for (const key of [...seen.keys()]) {
        if (!visited.has(key)) seen.delete(key)
      }
    }

    if (hitCap) {
      pollBackoffMs =
        pollBackoffMs === 0
          ? WORKING_SYNC_POLL_MS * 2
          : Math.min(pollBackoffMs * 2, POLL_BACKOFF_MAX_MS)
      pollBackoffUntil = Date.now() + pollBackoffMs
    } else if (inFlight.size === 0) {
      pollBackoffMs = 0
      pollBackoffUntil = 0
    }
  }

  const flush = async (): Promise<void> => {
    concurrentScans++
    try {
      await scanOnce()
    } finally {
      concurrentScans--
    }
  }

  const initialReconcile = flush()
  const timer = setInterval(() => {
    if (concurrentScans > 0 || Date.now() < pollBackoffUntil) return
    void flush()
  }, WORKING_SYNC_POLL_MS)
  timer.unref?.()

  const handle: SyncedFileSyncerHandle = {
    initialReconcile,
    flush,
    pendingCount: () => inFlight.size,
    pollBackoffUntilForTest: () => pollBackoffUntil,
    stop() {
      stopped = true
      clearInterval(timer)
      if (active === handle) active = null
    },
    getSeenState: () => seen,
  }
  active = handle
  return handle
}
