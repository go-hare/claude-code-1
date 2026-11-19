/**
 * densable 2.1.289 print `stageFile` / `addDirectoryDestFromMountPath` (gold
 * `Xcs` / `Ycs` / `Q` @215829351, exports @chunk-mdc8jrsw).
 *
 * CCR filestore fetch stays denser. Local CLI wraps unique English + mount
 * mapping; `stageFile` without `CLAUDE_CODE_REMOTE_SESSION_ID` matches gold
 * `Xcs` (`CLAUDE_CODE_REMOTE_SESSION_ID unset`).
 */
import { randomBytes, createHash } from 'node:crypto'
import {
  link,
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
  rmdir,
  unlink,
  utimes,
  writeFile,
} from 'node:fs/promises'
import {
  dirname as nodeDirname,
  isAbsolute as nodeIsAbsolute,
  join as nodeJoin,
} from 'node:path'
import {
  isAbsolute as posixIsAbsolute,
  normalize as posixNormalize,
  relative as posixRelative,
  basename as posixBasename,
} from 'node:path'
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
  opts?: { maxKeptFolders?: number; maxTries?: number },
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
    await writeFile(tmpPath, content)
    tmpCreated = true

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
      try {
        await mkdir(keptDir, { mode: 0o700 })
        await rename(destPath, nodeJoin(keptDir, fileName))
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

export type StageMount = {
  dest: string
  root: string
  readOnly: boolean
  neverReplace: boolean
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
  | { ok: true; noop?: string; outputPath?: string }
  | { ok: false; error: string }

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

/**
 * densable `Xcs` / `stageFile` — local analog. Filestore fetch is CCR denser;
 * without a remote session id this matches gold's first return.
 */
export async function stageFile(
  request: StageFileRequest,
  credential?: unknown,
  _homeFilesFlag: string = 'off',
): Promise<StageFileResult> {
  if (credential === undefined && !process.env.CLAUDE_CODE_REMOTE_SESSION_ID) {
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
  try {
    resolveStageMount(request.mount_path, credential !== undefined)
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
  return { ok: false, error: 'CLAUDE_CODE_REMOTE_SESSION_ID unset' }
}
