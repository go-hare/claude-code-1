/**
 * densable aLe + xl — reject a file_paths list before any file is opened.
 */
import { extname } from 'path'
import {
  ARTIFACT_ASSET_CONTENT_TYPES,
  isNetworkOrDevicePath,
} from '../outDirPaths.js'
import { expandPath } from '../../../utils/path.js'

/** densable QR */
export const UPLOAD_BATCH_MAX_FILES = 25
/** densable gne */
export const UPLOAD_BATCH_MAX_PATH_CHARS = 1024

const BATCH_LIST = `\`file_paths\` must be a list of 1 to ${UPLOAD_BATCH_MAX_FILES} local file paths`

const SOLO_TEXT = new Set([
  'text/csv',
  'text/markdown',
  'application/json',
  'text/plain',
])

const TAKES = [...ARTIFACT_ASSET_CONTENT_TYPES.keys()]
  .map(ext => ext.slice(1))
  .join(', ')

const NETWORK =
  'upload_asset reads only local files — file_path names a network path (UNC share, /net automount, or device-style path), reaches one through a link on the way, or has a directory or link on the way that could not be examined; if the file is on a network location, copy it onto a local disk first'

function label(index: number, filePath: string): string {
  const base = filePath.split(/[/\\]/).pop()
  return `file_paths[${index}] ${base && base.length > 0 ? base : filePath}`
}

/**
 * densable aLe — shape only. Path rules are xl, after the script gate.
 */
export function uploadBatchShapeError(filePaths: unknown): string | null {
  if (!Array.isArray(filePaths) || filePaths.length === 0) {
    return `${BATCH_LIST}.`
  }
  if (filePaths.length > UPLOAD_BATCH_MAX_FILES) {
    return `${BATCH_LIST} — ${filePaths.length} were given; send the rest in further calls.`
  }
  for (const written of filePaths) {
    if (typeof written !== 'string' || written === '') return `${BATCH_LIST}.`
  }
  return null
}

/**
 * densable xl. Duplicate expanded paths are rejected here; resolved-inode
 * duplicates are still rejected after open.
 */
export function uploadBatchEntryError(
  filePaths: readonly string[],
): string | null {
  const seen = new Set<string>()
  for (let index = 0; index < filePaths.length; index++) {
    const written = filePaths[index] ?? ''
    const problem = entryProblem(written)
    if (problem !== null) return `${label(index, written)}: ${problem}`
    const absolute = expandPath(written)
    if (seen.has(absolute)) {
      return `${label(index, written)}: names the same file as an earlier entry — list each file once.`
    }
    seen.add(absolute)
  }
  return null
}

/** Shape plus entry rules. Callers that must insert the script gate use the two halves. */
export function uploadBatchListError(filePaths: unknown): string | null {
  const shape = uploadBatchShapeError(filePaths)
  if (shape !== null) return shape
  return uploadBatchEntryError(filePaths as string[])
}

function entryProblem(written: string): string | null {
  if (written.includes('\0')) return 'a path cannot hold a NUL character'
  const contentType = ARTIFACT_ASSET_CONTENT_TYPES.get(
    extname(written).toLowerCase(),
  )
  if (contentType === undefined) {
    return `unsupported asset type: upload_asset takes ${TAKES}.`
  }
  if (SOLO_TEXT.has(contentType)) {
    return 'a CSV, Markdown, JSON or plain-text file is approved on its own — upload it in its own call with `file_path`; the other files can go together.'
  }
  const absolute = expandPath(written)
  if (
    written.length > UPLOAD_BATCH_MAX_PATH_CHARS ||
    absolute.length > UPLOAD_BATCH_MAX_PATH_CHARS
  ) {
    return `this path is longer than ${UPLOAD_BATCH_MAX_PATH_CHARS} characters, as written or as an absolute path, which is more than an approval can show in full — upload that file by itself with \`file_path\`.`
  }
  if (isNetworkOrDevicePath(absolute)) return `${NETWORK}.`
  return null
}
