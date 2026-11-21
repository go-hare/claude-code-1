/**
 * densable 2.1.289 print `stageFile` / `addDirectoryDestFromMountPath` (gold
 * `Xcs` / `Ycs` / `Q` @215829351, exports @chunk-mdc8jrsw).
 *
 * CCR filestore fetch stays denser. Local CLI wraps unique English + mount
 * mapping; `stageFile` without `CLAUDE_CODE_REMOTE_SESSION_ID` matches gold
 * `Xcs` (`CLAUDE_CODE_REMOTE_SESSION_ID unset`).
 */
import { createHash, randomBytes } from 'node:crypto'
import {
  chmod,
  link,
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rmdir,
  stat,
  unlink,
  utimes,
  writeFile,
} from 'node:fs/promises'
import {
  basename as nodeBasename,
  dirname as nodeDirname,
  isAbsolute as nodeIsAbsolute,
  join as nodeJoin,
  relative as nodeRelative,
  sep as nodeSep,
} from 'node:path'
import {
  basename as posixBasename,
  isAbsolute as posixIsAbsolute,
  normalize as posixNormalize,
  relative as posixRelative,
} from 'node:path/posix'
import { DEFAULT_STAGE_FILE_ROOT } from './syncedFileSyncer.js'

export const KEPT_FOLDER_PREFIX = '.kept-'
export const KEPT_FOLDER_MAX_COUNT = 64
export const STAGE_MOVE_ASIDE_MAX_TRIES = 3

/** Official `pir` — matches one or more `.kept-<ts>-<8hex>/` path segments. */
export const KEPT_FOLDER_PATH_RE = /^(?:\.kept-[0-9TZ]+-[0-9a-f]{8}\/)+$/

export type StageExistingState =
  | 'absent'
  | 'same'
  | 'changed'
  | 'directory'
  | 'other'
  | 'unknown'

export type StageWriteWithKeptResult =
  | { status: 'published'; movedAsideTo?: string }
  | { status: 'same' }
  | {
      status: 'refused'
      code: string
      why: string
      leavesADifferentFile?: boolean
    }

function sha256Hex(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}

function makeKeptFolderName(now: Date = new Date()): string {
  const stamp = now.toISOString().replace(/[-:.]/g, '')
  const suffix = randomBytes(4).toString('hex')
  return `${KEPT_FOLDER_PREFIX}${stamp}-${suffix}`
}

/**
 * Official 2.1.326 #32 (`ze`) — inspect an existing destination path without
 * depending on feature flags (works identically on Linux with no flags loaded).
 */
export async function inspectExistingStagedPath(
  destPath: string,
  incoming: Buffer | { size: number; sha256: string },
): Promise<StageExistingState> {
  try {
    const st = await lstat(destPath)
    if (st.isDirectory()) return 'directory'
    if (!st.isFile()) return 'other'
    if (Buffer.isBuffer(incoming)) {
      if (st.size !== incoming.length) return 'changed'
      const current = await readFile(destPath)
      return current.equals(incoming) ? 'same' : 'changed'
    }
    if (st.size !== incoming.size) return 'changed'
    const current = await readFile(destPath)
    return sha256Hex(current) === incoming.sha256 ? 'same' : 'changed'
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code
    if (code === 'ENOENT' || code === 'ENOTDIR') return 'absent'
    return 'unknown'
  }
}

/**
 * Official 2.1.326 #32 (`Nn` + `Et` + `Tn`) — publish a re-sent file without
 * overwriting Claude's changed copy on Linux (including when no feature flags
 * are loaded):
 * - Tries hard-link (`link(2)`) first so an existing file is never clobbered.
 * - If the target exists with identical bytes, touches mtime and returns `same`.
 * - If the target exists with different content, moves Claude's copy into a
 *   `.kept-<timestamp>-<hex>/` sibling folder (up to 64 kept folders) before
 *   publishing; if the cap is reached or moving fails, refuses to save and
 *   leaves Claude's copy untouched.
 */
export async function publishStagedFileWithKeptProtection(
  uploadsDir: string,
  fileName: string,
  content: Buffer,
  opts?: { maxKeptFolders?: number; maxTries?: number; mode?: number },
): Promise<StageWriteWithKeptResult> {
  const maxKept = opts?.maxKeptFolders ?? KEPT_FOLDER_MAX_COUNT
  const maxTries = opts?.maxTries ?? STAGE_MOVE_ASIDE_MAX_TRIES
  const destPath = nodeJoin(uploadsDir, fileName)
  const parentDir = nodeDirname(destPath)
  await mkdir(parentDir, { recursive: true })

  const tmpName = `${STAGE_TMP_PREFIX}${randomBytes(8).toString('hex')}`
  const tmpPath = nodeJoin(parentDir, tmpName)
  let tmpCreated = false
  let movedAsideName: string | undefined
  let movedCount = 0
  const priorNote =
    '; an entry moved from this path earlier is in a .kept- folder beside it'

  const restoreMovedAside = async (): Promise<boolean> => {
    if (!movedAsideName) return false
    const keptFile = nodeJoin(uploadsDir, movedAsideName, fileName)
    try {
      let linked = false
      try {
        await link(keptFile, destPath)
        linked = true
      } catch (err) {
        if ((err as NodeJS.ErrnoException)?.code === 'EEXIST') throw err
      }
      if (linked) {
        await unlink(keptFile).catch(() => {})
      } else {
        const exists = await lstat(destPath).then(
          () => true,
          err => (err as NodeJS.ErrnoException)?.code !== 'ENOENT',
        )
        if (exists) return false
        await rename(keptFile, destPath)
      }
      await rmdir(nodeJoin(uploadsDir, movedAsideName)).catch(() => {})
      movedAsideName = undefined
      return true
    } catch {
      return false
    }
  }

  try {
    await writeFile(tmpPath, content, { flag: 'wx' })
    tmpCreated = true
    if (opts?.mode !== undefined) {
      await chmod(tmpPath, opts.mode)
    }

    for (let attempt = 1; ; attempt++) {
      let published = false
      let linkRefused = false
      try {
        await link(tmpPath, destPath)
        published = true
      } catch (err) {
        const code = (err as NodeJS.ErrnoException)?.code
        if (code !== 'EEXIST') {
          linkRefused = true
        }
      }

      if (published) {
        await unlink(tmpPath).catch(() => {})
        tmpCreated = false
        return movedAsideName
          ? { status: 'published', movedAsideTo: movedAsideName }
          : { status: 'published' }
      }

      const existing = await inspectExistingStagedPath(destPath, content)
      if (existing === 'same') {
        const now = new Date()
        await utimes(destPath, now, now).catch(() => {})
        await utimes(uploadsDir, now, now).catch(() => {})
        await unlink(tmpPath).catch(() => {})
        tmpCreated = false
        return { status: 'same' }
      }
      if (existing === 'absent') {
        if (linkRefused) {
          await rename(tmpPath, destPath)
          tmpCreated = false
          return movedAsideName
            ? { status: 'published', movedAsideTo: movedAsideName }
            : { status: 'published' }
        }
        continue
      }
      if (existing === 'directory') {
        return {
          status: 'refused',
          code: 'EISDIR',
          why: `not saved: a folder is at this path, and it was left there${movedCount === 0 ? '' : priorNote}`,
        }
      }
      if (existing === 'unknown') {
        if (await restoreMovedAside()) movedCount--
        return {
          status: 'refused',
          code: 'look_failed',
          why: `not saved: what is at this path could not be looked at, so it was left there${movedCount === 0 ? '' : priorNote}`,
        }
      }
      if (attempt >= maxTries) {
        if (await restoreMovedAside()) movedCount--
        return {
          status: 'refused',
          code: 'EEXIST',
          why: `not saved: the path was taken on each of ${maxTries} tries; anything there now was left there${movedCount === 0 ? '' : priorNote}`,
        }
      }

      const entries = await readdir(uploadsDir).catch(() => [] as string[])
      const keptCount = entries.filter(name =>
        name.startsWith(KEPT_FOLDER_PREFIX),
      ).length
      if (keptCount >= maxKept) {
        return {
          status: 'refused',
          code: 'kept_cap',
          why: `not saved: the uploads folder holds at least ${maxKept} folders of kept copies (named .kept-...), so what was at this path was left there; removing old ones makes room${movedCount === 0 ? '' : priorNote}`,
          leavesADifferentFile: true,
        }
      }

      const keptName = makeKeptFolderName()
      const keptDir = nodeJoin(uploadsDir, keptName)
      const keptTarget = nodeJoin(keptDir, fileName)
      try {
        await mkdir(keptDir, { mode: 0o700 })
        const keptTargetParent = nodeDirname(keptTarget)
        if (keptTargetParent !== keptDir) {
          await mkdir(keptTargetParent, { recursive: true, mode: 0o700 })
        }
        await rename(destPath, keptTarget)
        movedAsideName = keptName
        movedCount++
      } catch (err) {
        await rmdir(keptDir).catch(() => {})
        const recheck =
          (err as NodeJS.ErrnoException)?.code === 'ENOENT'
            ? await inspectExistingStagedPath(destPath, content)
            : undefined
        if (recheck !== 'absent' && recheck !== 'same') {
          return {
            status: 'refused',
            code: (err as NodeJS.ErrnoException)?.code ?? 'unknown',
            why: `not saved: what is at this path could not be moved into a folder of kept copies (${err}), and was left there${movedCount === 0 ? '' : priorNote}`,
            ...(recheck === undefined ||
            recheck === 'changed' ||
            recheck === 'other'
              ? { leavesADifferentFile: true }
              : {}),
          }
        }
      }
    }
  } finally {
    if (tmpCreated) {
      await unlink(tmpPath).catch(() => {})
    }
  }
}

export const STAGE_FILE_OUTPUTS_MOUNT_PREFIX = '/outputs'
export const STAGE_FILE_UPLOADS_MOUNT_PREFIX = '/uploads'
export const STAGE_FILE_HOME_MOUNT_PREFIX = '/uploads/.home'
export const STAGE_TMP_PREFIX = '.stage-tmp.'
export const DEFAULT_STAGE_HOME_ROOT = '/home/claude'

export const STAGE_OUTPUTS_UNSUPPORTED_RUNNER =
  'STAGE_OUTPUTS_UNSUPPORTED_RUNNER'
export const STAGE_PARENT_ESCAPE = 'STAGE_PARENT_ESCAPE'
const STAGE_FETCH_TIMEOUT_MS = 30_000
const STAGE_STALL_TIMEOUT_MS = 60_000

export type StageMount = {
  dest: string
  root: string
  readOnly: boolean
  neverReplace: boolean
}

export type StageFilestoreCredential = {
  filestore_jwt?: string
  filesystem_id?: string
  filestore_url?: string
}

export type StageFileFetchResult =
  | { ok: true; data: Buffer }
  | {
      ok: false
      error: string
      status?: number
      notFound?: boolean
      permanent?: boolean
      errno?: string
    }

export type StageFileFetchFn = (
  mountPath: string,
  opts?: { signal?: AbortSignal },
) => Promise<StageFileFetchResult>

export type StageFileOptions = {
  fetchContent?: StageFileFetchFn
  sdkUrl?: string
  signal?: AbortSignal
  maxKeptFolders?: number
  maxTries?: number
}

export type StageFileRequest = {
  mount_path: string
  force?: boolean
  filestore_path?: string
  resync?: unknown
  content_sha256?: string
  expected_local_sha256?: string
}

export type StageFileResult =
  | { ok: true; noop?: string; outputPath?: string; movedAsideTo?: string }
  | { ok: false; error: string; permanent?: boolean; notFound?: boolean }

function posixRelUnder(root: string, abs: string): string | null {
  const rel = posixRelative(root, abs)
  if (rel === '' || rel === '.') return null
  if (rel.split('/').includes('..') || posixIsAbsolute(rel)) return null
  return rel
}

function isManagedRemoteSession(vouched: boolean): boolean {
  return Boolean(
    vouched
      ? true
      : process.env.CLAUDE_CODE_REMOTE_SESSION_ID &&
          process.env.CLAUDE_CODE_ENVIRONMENT_KIND,
  )
}

function stageFileRoot(): string {
  const raw = process.env.CLAUDE_STAGE_FILE_ROOT
  if (!raw) return DEFAULT_STAGE_FILE_ROOT
  if (!nodeIsAbsolute(raw)) {
    throw new Error('CLAUDE_STAGE_FILE_ROOT must be an absolute path')
  }
  return raw
}

function outputsRoot(): string {
  return nodeJoin(stageFileRoot(), 'outputs')
}

function homeRoot(): string {
  return DEFAULT_STAGE_HOME_ROOT
}

function destOnRoot(root: string, posixRel: string): string {
  return nodeJoin(root, ...posixRel.split('/').filter(Boolean))
}

/**
 * densable `Q` — parse a virtual mount_path.
 */
export function resolveStageMount(
  mountPath: string,
  vouched = false,
): StageMount {
  if (mountPath.includes('\0')) {
    throw new Error('mount_path contains null bytes')
  }
  if (!posixIsAbsolute(mountPath)) {
    throw new Error('mount_path must be absolute')
  }
  if (mountPath.split('/').includes('..')) {
    throw new Error('mount_path must not contain ".." segments')
  }
  const normalized = posixNormalize(mountPath)
  const homeRel = posixRelUnder(STAGE_FILE_HOME_MOUNT_PREFIX, normalized)
  if (homeRel !== null && isManagedRemoteSession(vouched)) {
    return {
      dest: destOnRoot(homeRoot(), homeRel),
      root: homeRoot(),
      readOnly: false,
      neverReplace: true,
    }
  }
  if (posixBasename(normalized).startsWith(STAGE_TMP_PREFIX)) {
    throw new Error('mount_path names a reserved temporary-file name')
  }
  const uploadRel = posixRelUnder(STAGE_FILE_UPLOADS_MOUNT_PREFIX, normalized)
  if (uploadRel !== null) {
    return {
      dest: destOnRoot(stageFileRoot(), uploadRel),
      root: stageFileRoot(),
      readOnly: true,
      neverReplace: false,
    }
  }
  const outputRel = posixRelUnder(STAGE_FILE_OUTPUTS_MOUNT_PREFIX, normalized)
  if (outputRel !== null) {
    if (!isManagedRemoteSession(vouched)) {
      const err = new Error(
        'staging under /outputs/ is only supported on managed remote sessions',
      )
      ;(err as Error & { code: string }).code = STAGE_OUTPUTS_UNSUPPORTED_RUNNER
      throw err
    }
    return {
      dest: destOnRoot(outputsRoot(), outputRel),
      root: outputsRoot(),
      readOnly: false,
      neverReplace: false,
    }
  }
  throw new Error('mount_path must be under /uploads/ or /outputs/')
}

/**
 * densable `Ycs` / `addDirectoryDestFromMountPath`.
 */
export function addDirectoryDestFromMountPath(mountPath: string): string {
  let mount: StageMount | undefined
  try {
    mount = resolveStageMount(mountPath)
  } catch (err) {
    const code = (err as { code?: string }).code
    if (code === STAGE_OUTPUTS_UNSUPPORTED_RUNNER) {
      throw new Error('add_directory mount_path must be under /uploads/')
    }
    throw err
  }
  if (!mount.readOnly) {
    throw new Error(
      'add_directory mount_path must be under /uploads/ and not under /uploads/.home/',
    )
  }
  return mount.dest
}

export function stageTmpStem(dest: string): string {
  const base = posixBasename(dest.split('\\').join('/'))
  return `${STAGE_TMP_PREFIX}${base.slice(0, 16)}.`
}

/**
 * densable `Kcs` / `stageFileWireResult`.
 */
export function stageFileWireResult(result: { ok: true; noop?: string }): {
  ok: true
  noop?: string
} {
  return result.noop === undefined
    ? { ok: true }
    : { ok: true, noop: result.noop }
}

function isReadOnlyFsError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as NodeJS.ErrnoException).code === 'EROFS'
  )
}

function isPermanentHttpStatus(status: number): boolean {
  return status < 500 && status !== 408 && status !== 429
}

function isNewerLocal(
  st: { isFile(): boolean; mtimeMs: number; ctimeMs: number } | null,
  startedAtMs: number,
): boolean {
  return (
    st !== null &&
    st.isFile() &&
    (st.mtimeMs >= startedAtMs || st.ctimeMs >= startedAtMs)
  )
}

function assertParentUnderStageRoot(
  realRoot: string,
  realParent: string,
): void {
  const rel = nodeRelative(realRoot, realParent)
  if (
    rel.startsWith('..') ||
    rel.split(nodeSep).includes('..') ||
    nodeIsAbsolute(rel)
  ) {
    const err = new Error('dest parent escaped stage root')
    ;(err as Error & { code: string }).code = STAGE_PARENT_ESCAPE
    throw err
  }
}

async function cleanupStaleStageTmp(dir: string, stem: string): Promise<void> {
  const cutoff = Date.now() - 2 * STAGE_STALL_TIMEOUT_MS
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return
  }
  await Promise.all(
    entries
      .filter(name => name.startsWith(stem))
      .map(async name => {
        const full = nodeJoin(dir, name)
        try {
          if ((await stat(full)).mtimeMs < cutoff) {
            await unlink(full)
          }
        } catch {
          // Best-effort cleanup of stale temp files.
        }
      }),
  )
}

function normalizeHttpBaseUrl(rawUrl: string): string {
  const parsed = new URL(rawUrl)
  if (parsed.protocol === 'ws:') parsed.protocol = 'http:'
  else if (parsed.protocol === 'wss:') parsed.protocol = 'https:'
  return parsed.href.replace(/\/$/, '')
}

type ValidatedStageCredential = {
  filestoreJwt: string
  filesystemId: string
  filestoreUrl: string
}

async function resolveDefaultFilestoreBaseUrl(): Promise<string> {
  const { getOauthConfig } = await import('../constants/oauth.js')
  return getOauthConfig().BASE_API_URL
}

async function validateStageCredential(
  cred: StageFilestoreCredential,
): Promise<
  | { ok: true; cred: ValidatedStageCredential }
  | { ok: false; error: string; permanent?: boolean }
> {
  const jwt = cred.filestore_jwt
  const fsId = cred.filesystem_id
  if (!jwt || !fsId) {
    return {
      ok: false,
      error: 'list returned incomplete credential',
      permanent: true,
    }
  }
  const baseUrl = cred.filestore_url
    ? normalizeHttpBaseUrl(cred.filestore_url)
    : await resolveDefaultFilestoreBaseUrl()
  return {
    ok: true,
    cred: {
      filestoreJwt: jwt,
      filesystemId: fsId,
      filestoreUrl: baseUrl,
    },
  }
}

async function fetchWorkerFilesCredential(
  sdkUrl?: string,
  signal?: AbortSignal,
): Promise<
  | { ok: true; cred: ValidatedStageCredential }
  | { ok: false; error: string; status?: number; permanent?: boolean }
> {
  const rawSdkUrl =
    sdkUrl ??
    process.env.CLAUDE_CODE_SESSION_INGRESS_URL ??
    process.env.CLAUDE_CODE_SDK_URL
  if (!rawSdkUrl) {
    return {
      ok: false,
      error: 'ccr-session host requires --sdk-url',
      permanent: true,
    }
  }
  let baseUrl: string
  try {
    baseUrl = normalizeHttpBaseUrl(rawSdkUrl)
  } catch (err) {
    return {
      ok: false,
      error: `invalid sdk url: ${err instanceof Error ? err.message : String(err)}`,
      permanent: true,
    }
  }
  const { default: axios } = await import('axios')
  const { getSessionIngressAuthHeaders } = await import(
    './sessionIngressAuth.js'
  )
  try {
    const resp = await axios.get<StageFilestoreCredential>(
      `${baseUrl}/worker/files`,
      {
        headers: {
          ...getSessionIngressAuthHeaders(),
          'anthropic-version': '2023-06-01',
        },
        timeout: STAGE_FETCH_TIMEOUT_MS,
        signal,
        validateStatus: () => true,
      },
    )
    if (resp.status < 200 || resp.status >= 300) {
      return {
        ok: false,
        error: `list failed: http ${resp.status}`,
        status: resp.status,
        ...(isPermanentHttpStatus(resp.status) ? { permanent: true } : {}),
      }
    }
    return await validateStageCredential(resp.data ?? {})
  } catch (err) {
    return {
      ok: false,
      error: `list failed: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

async function fetchFilestoreFileBytes(
  mountPath: string,
  credential: StageFilestoreCredential | undefined,
  options?: StageFileOptions,
): Promise<StageFileFetchResult> {
  if (options?.fetchContent) {
    return await options.fetchContent(mountPath, { signal: options.signal })
  }

  let credentialUsed = false
  const acquireCred = async () => {
    if (credential !== undefined) {
      if (credentialUsed) {
        return {
          ok: false as const,
          error: 'read failed: credential expired',
        }
      }
      credentialUsed = true
      return await validateStageCredential(credential)
    }
    return await fetchWorkerFilesCredential(options?.sdkUrl, options?.signal)
  }

  let credResult = await acquireCred()
  if (!credResult.ok) return credResult
  let cred = credResult.cred

  const { default: axios } = await import('axios')

  for (let attempt = 0; attempt <= 1; attempt++) {
    const controller = new AbortController()
    const onExternalAbort = () => controller.abort(options?.signal?.reason)
    if (options?.signal) {
      if (options.signal.aborted) {
        controller.abort(options.signal.reason)
      } else {
        options.signal.addEventListener('abort', onExternalAbort, {
          once: true,
        })
      }
    }
    const timer = setTimeout(() => {
      controller.abort(new Error('readFile stall: no bytes for 60s'))
    }, STAGE_STALL_TIMEOUT_MS)

    try {
      const resp = await axios.post<ArrayBuffer>(
        `${cred.filestoreUrl}/v1/filestore/fs/readFile`,
        {
          filesystem_id: cred.filesystemId,
          path: mountPath,
        },
        {
          headers: {
            Authorization: `Bearer ${cred.filestoreJwt}`,
          },
          responseType: 'arraybuffer',
          timeout: 0,
          signal: controller.signal,
          validateStatus: () => true,
        },
      )
      clearTimeout(timer)
      if (resp.status === 401 && attempt === 0) {
        credResult = await acquireCred()
        if (!credResult.ok) return credResult
        cred = credResult.cred
        continue
      }
      if (resp.status < 200 || resp.status >= 300) {
        return {
          ok: false,
          error: `read failed: http ${resp.status}`,
          status: resp.status,
          ...(isPermanentHttpStatus(resp.status) ? { permanent: true } : {}),
          ...(resp.status === 404 ? { notFound: true } : {}),
        }
      }
      const data = Buffer.from(resp.data)
      const contentLengthHeader = resp.headers['content-length']
      const expectedLength =
        contentLengthHeader !== undefined ? Number(contentLengthHeader) : -1
      if (
        Number.isFinite(expectedLength) &&
        expectedLength >= 0 &&
        data.byteLength !== expectedLength
      ) {
        return {
          ok: false,
          error: `read truncated: got ${data.byteLength} of ${expectedLength} bytes`,
        }
      }
      return { ok: true, data }
    } catch (err) {
      clearTimeout(timer)
      if (controller.signal.aborted && !options?.signal?.aborted) {
        return {
          ok: false,
          error: `read stalled: no bytes for ${STAGE_STALL_TIMEOUT_MS}ms`,
        }
      }
      return {
        ok: false,
        error: `read failed: ${err instanceof Error ? err.message : String(err)}`,
      }
    } finally {
      options?.signal?.removeEventListener('abort', onExternalAbort)
    }
  }

  return { ok: false, error: 'read failed: retry loop exhausted' }
}

/**
 * Official 2.1.328 `nPl` / `Ve` + `Nn` (`stageFile`) — validate mount path,
 * fetch file bytes from CCR filestore (or injected fetcher), write temp file,
 * and atomically publish via `publishStagedFileWithKeptProtection()`.
 */
export async function stageFile(
  request: StageFileRequest,
  credential?: StageFilestoreCredential,
  homeFilesFlag: string = 'off',
  options?: StageFileOptions,
): Promise<StageFileResult> {
  if (
    credential === undefined &&
    !process.env.CLAUDE_CODE_REMOTE_SESSION_ID &&
    !options?.fetchContent
  ) {
    return { ok: false, error: 'CLAUDE_CODE_REMOTE_SESSION_ID unset' }
  }
  if (credential !== undefined && request.filestore_path) {
    return { ok: false, error: 'synced documents are not staged here' }
  }
  if (
    request.filestore_path &&
    process.env.CLAUDE_CODE_ENVIRONMENT_KIND !== undefined
  ) {
    return {
      ok: false,
      error: 'synced-file staging not supported on this runner kind',
    }
  }

  let mount: StageMount
  try {
    mount = resolveStageMount(request.mount_path, credential !== undefined)
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }

  if (mount.neverReplace && homeFilesFlag === 'off') {
    return { ok: true, noop: 'home_files_off' }
  }
  if (mount.neverReplace && request.resync !== undefined) {
    return { ok: true, noop: 'resent_announcement' }
  }
  if (mount.neverReplace && request.force !== false) {
    return { ok: true, noop: 'unchecked_announcement' }
  }
  if (mount.neverReplace && homeFilesFlag === 'not_loaded') {
    return { ok: false, error: 'the flag for home files has not loaded' }
  }

  const isOutput = mount.root === outputsRoot()
  const isDefaultUploadsRoot =
    mount.readOnly && !mount.neverReplace && !process.env.CLAUDE_STAGE_FILE_ROOT

  if (!request.force && !mount.neverReplace) {
    try {
      const existing = await stat(mount.dest)
      if (existing.isFile()) {
        return {
          ok: true,
          noop: 'already_present',
          ...(isOutput ? { outputPath: mount.dest } : {}),
        }
      }
    } catch {
      // Destination absent; continue to fetch and stage.
    }
  }

  const startedAtMs = Date.now()
  const parentDir = nodeDirname(mount.dest)
  const fileName = nodeBasename(mount.dest)

  try {
    await mkdir(mount.root, { recursive: true })
    await mkdir(parentDir, { recursive: true })
    const realRoot = await realpath(mount.root)
    const realParent = await realpath(parentDir)
    assertParentUnderStageRoot(realRoot, realParent)
    await cleanupStaleStageTmp(parentDir, stageTmpStem(mount.dest))
  } catch (err) {
    if (isDefaultUploadsRoot && isReadOnlyFsError(err)) {
      return { ok: true, noop: 'readonly_mount' }
    }
    const code =
      typeof err === 'object' && err !== null && 'code' in err
        ? String((err as { code?: unknown }).code)
        : 'unknown'
    return {
      ok: false,
      error:
        code === STAGE_PARENT_ESCAPE
          ? 'dest parent escaped stage root'
          : `mkdir failed: ${code}`,
    }
  }

  const fetched = await fetchFilestoreFileBytes(
    request.mount_path,
    credential,
    options,
  )
  if (!fetched.ok) {
    if (isDefaultUploadsRoot && fetched.errno === 'EROFS') {
      return { ok: true, noop: 'readonly_mount' }
    }
    return {
      ok: false,
      error: fetched.error,
      ...(fetched.permanent ? { permanent: true } : {}),
      ...(fetched.notFound ? { notFound: true } : {}),
    }
  }

  if (mount.neverReplace) {
    const existing = await inspectExistingStagedPath(mount.dest, fetched.data)
    if (existing === 'same') {
      return { ok: true, noop: 'already_present' }
    }
    if (existing !== 'absent') {
      return { ok: true, noop: 'path_occupied' }
    }
    const tmpPath = nodeJoin(
      parentDir,
      `${STAGE_TMP_PREFIX}${randomBytes(8).toString('hex')}`,
    )
    let tmpCreated = false
    try {
      await writeFile(tmpPath, fetched.data, { flag: 'wx', mode: 0o644 })
      tmpCreated = true
      try {
        await link(tmpPath, mount.dest)
        await unlink(tmpPath).catch(() => {})
        tmpCreated = false
        return { ok: true, outputPath: mount.dest }
      } catch (err) {
        if ((err as NodeJS.ErrnoException)?.code === 'EEXIST') {
          const raced = await inspectExistingStagedPath(
            mount.dest,
            fetched.data,
          )
          return {
            ok: true,
            noop: raced === 'same' ? 'already_present' : 'path_occupied',
          }
        }
        throw err
      }
    } catch (err) {
      const code =
        typeof err === 'object' && err !== null && 'code' in err
          ? String((err as { code?: unknown }).code)
          : 'unknown'
      return { ok: false, error: `write failed: ${code}` }
    } finally {
      if (tmpCreated) {
        await unlink(tmpPath).catch(() => {})
      }
    }
  }

  if (isOutput) {
    const current = await stat(mount.dest).catch(() => null)
    if (isNewerLocal(current, startedAtMs)) {
      return { ok: true, noop: 'newer_local' }
    }
  }

  try {
    const published = await publishStagedFileWithKeptProtection(
      parentDir,
      fileName,
      fetched.data,
      {
        maxKeptFolders: options?.maxKeptFolders,
        maxTries: options?.maxTries,
        mode: mount.readOnly ? 0o444 : 0o644,
      },
    )
    if (published.status === 'same') {
      return {
        ok: true,
        noop: 'already_present',
        ...(isOutput ? { outputPath: mount.dest } : {}),
      }
    }
    if (published.status === 'refused') {
      return { ok: false, error: published.why }
    }
    return {
      ok: true,
      ...(isOutput ? { outputPath: mount.dest } : {}),
      ...(published.movedAsideTo
        ? { movedAsideTo: published.movedAsideTo }
        : {}),
    }
  } catch (err) {
    if (isDefaultUploadsRoot && isReadOnlyFsError(err)) {
      return { ok: true, noop: 'readonly_mount' }
    }
    const code =
      typeof err === 'object' && err !== null && 'code' in err
        ? String((err as { code?: unknown }).code)
        : 'unknown'
    return { ok: false, error: `write failed: ${code}` }
  }
}
