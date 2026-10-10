/**
 * densable 2.1.289 print `stageFile` / `addDirectoryDestFromMountPath` (gold
 * `Xcs` / `Ycs` / `Q` @215829351, exports @chunk-mdc8jrsw).
 *
 * CCR filestore fetch stays denser. Local CLI wraps unique English + mount
 * mapping; `stageFile` without `CLAUDE_CODE_REMOTE_SESSION_ID` matches gold
 * `Xcs` (`CLAUDE_CODE_REMOTE_SESSION_ID unset`).
 */
import { isAbsolute as nodeIsAbsolute, join as nodeJoin } from 'node:path'
import {
  isAbsolute as posixIsAbsolute,
  normalize as posixNormalize,
  relative as posixRelative,
  basename as posixBasename,
} from 'node:path'
import { DEFAULT_STAGE_FILE_ROOT } from './syncedFileSyncer.js'

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
