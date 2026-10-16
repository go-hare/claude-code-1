/**
 * densable Gqe / hn / xKe subset — upload_asset treats file_path as a
 * Read trial (2.1.289 gold @210672229 / @210671818).
 */
import { createHash } from 'crypto'
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
  type BigIntStats,
} from 'fs'
import { relative, sep } from 'path'
import type { Tool, ToolPermissionContext } from '../../../Tool.js'
import type {
  PermissionDecision,
  PermissionResult,
} from '../../../types/permissions.js'
import { isNetworkUncPath } from '../../../utils/path.js'
import { getErrnoCode } from '../../../utils/errors.js'
import { walkPermissionPaths } from '../../../utils/fsOperations.js'
import { isEvalConfined } from '../../../utils/permissions/evalConfined.js'
import { checkReadPermissionForTool } from '../../../utils/permissions/filesystem.js'
import { DEFAULT_STAGE_FILE_ROOT } from '../../../utils/syncedFileSyncer.js'
import { isAnthropicHostedRemoteSession } from '../frameRelay.js'
import { un } from '../store.js'

export type UploadPathSource =
  | { kind: 'network' }
  | { kind: 'resolved'; real: string }
  | { kind: 'unresolved'; code?: string }

export type UploadSourcePin = {
  real: string
  /** densable RKe — `dev:ino:size:mtimeNs`, or null when lstat failed. */
  identity: string | null
  linked?: boolean
}

export type GqeOk = {
  refused?: undefined
  mode: string | undefined
  read: PermissionDecision
  sourcePin: UploadSourcePin | undefined
  readAsks: boolean
  hardLinked: boolean
  stagedUpload: boolean
  resolvesElsewhere: boolean
  pinRead: PermissionDecision | undefined
}

export type GqeRefused = { refused: PermissionResult }

const CHAT_ATTACHMENT_ALLOW =
  "The file is one of this session's chat attachments, which count as inside the working directories"

function pathUnderRoot(path: string, root: string): boolean {
  const rel = relative(root, path)
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..')
}

/** densable MN subset — network vs realpath. */
export function resolveUploadSource(path: string): UploadPathSource {
  if (isNetworkUncPath(path)) return { kind: 'network' }
  try {
    return { kind: 'resolved', real: realpathSync(path) }
  } catch (error) {
    return { kind: 'unresolved', code: getErrnoCode(error) }
  }
}

/** densable RKe — bigint stat fields, so a rewrite is a different pin. */
export function uploadFileIdentity(st: {
  dev: number | bigint
  ino: number | bigint
  size: number | bigint
  mtimeNs: number | bigint
}): string {
  return `${st.dev}:${st.ino}:${st.size}:${st.mtimeNs}`
}

function attachmentIdentity(
  identity: string | null,
): { dev: number; ino: number } | null {
  if (identity === null) return null
  const [dev, ino] = identity.split(':')
  if (dev === undefined || ino === undefined) return null
  if (!/^\d+$/.test(dev) || !/^\d+$/.test(ino)) return null
  return { dev: Number(dev), ino: Number(ino) }
}

/** densable xKe — linked only for a regular file with nlink>1. */
export function xKe(real: string): UploadSourcePin {
  try {
    const st = lstatSync(real, { bigint: true })
    const identity = uploadFileIdentity(st)
    const linked = st.isFile() && st.nlink > 1n
    return linked ? { real, identity, linked: true } : { real, identity }
  } catch {
    return { real, identity: null }
  }
}

function stageAttachmentRoots(): string[] {
  const roots: string[] = []
  const env = process.env.CLAUDE_STAGE_FILE_ROOT
  if (env !== undefined && env !== '') roots.push(env)
  // DEFAULT mount is a CCR/hosted path — do not treat a local
  // /mnt/user-data/uploads as a chat attachment.
  if (
    isAnthropicHostedRemoteSession() ||
    process.env.CLAUDE_CODE_REMOTE_SESSION_ID
  ) {
    roots.push(DEFAULT_STAGE_FILE_ROOT)
  }
  return roots
}

/**
 * densable en / tn subset — chat-attachment carve-out. Stage-file roots
 * plus verifiedAttachments identity. bypass / servedCall skip.
 */
function tn(
  spelled: string,
  real: string,
  perms: ToolPermissionContext,
  pin: UploadSourcePin | undefined,
): {
  inside: boolean
  pin: UploadSourcePin | undefined
  byDirectory?: boolean
} {
  const bypass =
    perms.mode === 'bypassPermissions' ||
    perms.shouldAvoidPermissionPrompts === true ||
    Reflect.get(perms, 'servedCall') === true
  if (bypass) return { inside: false, pin }
  const sourcePin = pin ?? xKe(real)
  // Gold en: linked pin is never an attachment. spelled≠real is a
  // symlink hop — lstat(realpath) would miss it.
  if (
    sourcePin.linked === true ||
    spelled !== real ||
    xKe(spelled).linked === true
  ) {
    return { inside: false, pin: sourcePin }
  }
  for (const root of stageAttachmentRoots()) {
    if (!pathUnderRoot(real, root)) continue
    const byDirectory = real === root
    const stamped = attachmentIdentity(sourcePin.identity)
    if (stamped !== null) {
      un().verifiedAttachments.set(sourcePin.real, stamped)
    }
    return { inside: true, pin: sourcePin, byDirectory }
  }
  const verified = un().verifiedAttachments.get(sourcePin.real)
  const live = attachmentIdentity(sourcePin.identity)
  if (
    live !== null &&
    verified !== undefined &&
    verified.dev === live.dev &&
    verified.ino === live.ino
  ) {
    return { inside: true, pin: sourcePin }
  }
  return { inside: false, pin: sourcePin }
}

/** densable hn @210671818 — workingDir ask + attachment → allow. */
export function hn(
  read: PermissionDecision,
  spelled: string,
  source: UploadPathSource,
  perms: ToolPermissionContext,
  pin: UploadSourcePin | undefined,
): {
  read: PermissionDecision
  pin: UploadSourcePin | undefined
  stagedByDirectory?: boolean
} {
  if (
    read.behavior !== 'ask' ||
    read.decisionReason?.type !== 'workingDir' ||
    source.kind !== 'resolved'
  ) {
    return { read, pin }
  }
  const {
    inside,
    pin: next,
    byDirectory,
  } = tn(spelled, source.real, perms, pin)
  if (!inside) return { read, pin: next ?? pin }
  return {
    ...(byDirectory ? { stagedByDirectory: true } : {}),
    read: {
      behavior: 'allow',
      decisionReason: { type: 'other', reason: CHAT_ATTACHMENT_ALLOW },
    },
    pin: next,
  }
}

function qv(
  real: string,
  tool: Tool,
  perms: ToolPermissionContext,
): PermissionDecision {
  return checkReadPermissionForTool(tool, { file_path: real }, perms)
}

/**
 * densable Gqe @210672229 — Read trial + attachment carve-out + real-path pin.
 */
export function Gqe(
  tool: Tool,
  input: { [key: string]: unknown },
  spelled: string,
  source: UploadPathSource,
  perms: ToolPermissionContext,
  existingPin: UploadSourcePin | undefined,
): GqeOk | GqeRefused {
  const { read, pin, stagedByDirectory } = hn(
    checkReadPermissionForTool(tool, input, perms),
    spelled,
    source,
    perms,
    existingPin,
  )
  if (read.behavior === 'deny') return { refused: read }
  const pinRead =
    source.kind === 'resolved' && source.real !== spelled
      ? qv(source.real, tool, perms)
      : undefined
  if (pinRead?.behavior === 'deny') {
    return {
      refused: {
        ...pinRead,
        message: `Permission to read ${spelled} has been denied (it resolves, through a symbolic link, to a path a Read rule denies).`,
      },
    }
  }
  const sourcePin =
    pin ?? (source.kind === 'resolved' ? xKe(source.real) : undefined)
  const readAsks = read.behavior === 'ask' || pinRead?.behavior === 'ask'
  const hardLinked = sourcePin?.linked === true
  if ((readAsks || hardLinked) && isEvalConfined()) {
    return {
      refused: {
        behavior: 'deny',
        message: `Permission to read ${spelled} has been denied.`,
        decisionReason: {
          type: 'other',
          reason: 'source outside the readable set in an evaluation run',
        },
      },
    }
  }
  return {
    mode: perms.mode,
    read,
    sourcePin,
    readAsks,
    hardLinked,
    stagedUpload: stagedByDirectory === true,
    resolvesElsewhere: source.kind === 'resolved' && source.real !== spelled,
    pinRead,
  }
}

const PIN_CHANGED =
  'file_path no longer names the file that was approved (it moved, was replaced, or was rewritten) — retry the upload so it is checked again'
const PIN_READ_DENIED =
  'reading where file_path resolves is blocked by a Read permission rule — the upload was not attempted'
const PIN_VIA_LINK =
  'file_path reaches its file through a symbolic link that resolves somewhere this session may not read without asking — upload the file by its resolved path, or copy it under the working directory first'
const PIN_NOT_FILE = 'file_path must name a regular file to upload'
const PIN_EMPTY = 'the file is empty — nothing to upload'
const PIN_NETWORK =
  'upload_asset reads only local files — file_path names a network path (UNC share, /net automount, or device-style path), reaches one through a link on the way, or has a directory or link on the way that could not be examined; if the file is on a network location, copy it onto a local disk first'
const PIN_HARD_LINK =
  'file_path is one of several hard links to its file, and this approval did not examine that — copy the file to a fresh path under the working directory and upload the copy'
const PIN_NO_IDENTITY =
  'file_path is on a volume that reports no usable file identity (some network, FUSE, and virtual-disk mounts), so the approved file cannot be told apart from a replacement — copy it to an ordinary local directory and upload the copy'
const PIN_SOURCE_UNVERIFIED =
  'file_path: could not verify the file is the one that was admitted; retry the upload'
/** densable Gu @194024872 — admitted publish source and raw page cap. */
const ADMITTED_SOURCE_MAX_BYTES = 16_777_216

export type UploadByteRead =
  | { kind: 'ok'; bytes: Buffer; real: string }
  | { kind: 'error'; reason: string; message: string }

export type OpenedUpload = {
  kind: 'opened'
  fd: number
  size: number
  real: string
  identity: string
  digest?: string
}

function pinReadError(
  reason: string,
  message: string,
): Extract<UploadByteRead, { kind: 'error' }> {
  return { kind: 'error', reason, message }
}

/** densable yR — ino 0 / -1 / uint64 max cannot pin a file. */
function inodeUnusable(ino: bigint): boolean {
  return (
    ino === 0n ||
    ino === -1n ||
    ino === 0xffffffffffffffffn ||
    ino === 1n << 64n
  )
}

function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

type NormalizedPin = {
  real: string
  identity: string | null
  digest?: string
}

function normalizePin(
  pin:
    | {
        real?: unknown
        identity?: unknown
        digest?: unknown
      }
    | undefined,
): NormalizedPin | undefined {
  if (pin === undefined || typeof pin.real !== 'string') return undefined
  return {
    real: pin.real,
    identity: typeof pin.identity === 'string' ? pin.identity : null,
    ...(typeof pin.digest === 'string' ? { digest: pin.digest } : {}),
  }
}

/**
 * densable Ro().slice(1) — spellings after the requested path. Any deny
 * wins; any non-allow is a link the session has not approved.
 */
function unresolvedAncestorVerdict(
  spelled: string,
  readVerdict: (path: string) => 'allow' | 'deny' | 'ask',
): Extract<UploadByteRead, { kind: 'error' }> | undefined {
  const verdicts = walkPermissionPaths(spelled).paths.slice(1).map(readVerdict)
  if (verdicts.includes('deny')) {
    return pinReadError('read_denied', PIN_READ_DENIED)
  }
  if (verdicts.some(verdict => verdict !== 'allow')) {
    return pinReadError('via_link', PIN_VIA_LINK)
  }
  return undefined
}

/**
 * densable RTr — open the resolved file and require the approved pin.
 * Caller closes the fd via `closePinnedUpload` or `readOpenedUpload`.
 */
export function openPinnedUpload(input: {
  spelled: string
  pin?: { real?: unknown; identity?: unknown; digest?: unknown }
  byteLimit: number
  readVerdict: (path: string) => 'allow' | 'deny' | 'ask'
}): OpenedUpload | Extract<UploadByteRead, { kind: 'error' }> {
  const source = resolveUploadSource(input.spelled)
  if (source.kind === 'network') return pinReadError('network', PIN_NETWORK)
  const pinned = normalizePin(input.pin)
  if (source.kind === 'unresolved') {
    if (pinned !== undefined && pinned.identity !== null) {
      return pinReadError('changed', PIN_CHANGED)
    }
    const ancestor = unresolvedAncestorVerdict(input.spelled, input.readVerdict)
    if (ancestor !== undefined) return ancestor
    if (source.code === 'ENOENT' || source.code === 'ENOTDIR') {
      return pinReadError('missing', `File not found: ${input.spelled}.`)
    }
    return pinReadError(
      'read_error',
      `cannot read file_path (${source.code ?? 'unexpected error'})`,
    )
  }
  const real = source.real
  const verdict = real === input.spelled ? undefined : input.readVerdict(real)
  if (verdict === 'deny') return pinReadError('read_denied', PIN_READ_DENIED)
  if (pinned !== undefined) {
    if (real !== pinned.real) return pinReadError('changed', PIN_CHANGED)
  } else if (verdict !== undefined && verdict !== 'allow') {
    return pinReadError('via_link', PIN_VIA_LINK)
  }
  let listed: BigIntStats
  try {
    listed = lstatSync(real, { bigint: true })
  } catch (error) {
    const code = getErrnoCode(error)
    if (pinned !== undefined && (code === 'ENOENT' || code === 'ENOTDIR')) {
      return pinReadError('changed', PIN_CHANGED)
    }
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return pinReadError('missing', `File not found: ${input.spelled}.`)
    }
    return pinReadError(
      'read_error',
      `cannot read file_path (${code ?? 'unexpected error'})`,
    )
  }
  if (listed.isSymbolicLink()) return pinReadError('changed', PIN_CHANGED)
  if (!listed.isFile()) return pinReadError('not_a_file', PIN_NOT_FILE)
  if (pinned === undefined && listed.nlink > 1n) {
    return pinReadError('hard_link', PIN_HARD_LINK)
  }
  const flags = fsConstants.O_RDONLY | (fsConstants.O_NONBLOCK ?? 0)
  let fd: number
  try {
    fd = openSync(real, flags)
  } catch (error) {
    if (getErrnoCode(error) === 'ELOOP') {
      return pinReadError('changed', PIN_CHANGED)
    }
    const code = getErrnoCode(error)
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return pinReadError('missing', `File not found: ${input.spelled}.`)
    }
    return pinReadError(
      'read_error',
      `cannot read file_path (${code ?? 'unexpected error'})`,
    )
  }
  let keep = false
  try {
    const opened = fstatSync(fd, { bigint: true })
    if (!opened.isFile()) return pinReadError('not_a_file', PIN_NOT_FILE)
    if (inodeUnusable(opened.ino)) {
      return pinReadError('no_identity', PIN_NO_IDENTITY)
    }
    const expected =
      pinned !== undefined ? pinned.identity : uploadFileIdentity(listed)
    if (expected === null || uploadFileIdentity(opened) !== expected) {
      return pinReadError('changed', PIN_CHANGED)
    }
    const again = resolveUploadSource(input.spelled)
    if (again.kind !== 'resolved' || again.real !== real) {
      return pinReadError('changed', PIN_CHANGED)
    }
    const live = lstatSync(real, { bigint: true })
    if (live.dev !== opened.dev || live.ino !== opened.ino) {
      return pinReadError('changed', PIN_CHANGED)
    }
    const size = Number(opened.size)
    if (size === 0 || size > input.byteLimit) {
      return pinReadError(
        'size',
        size === 0
          ? PIN_EMPTY
          : `too large: ${Math.ceil((size * 10) / 1024 / 1024) / 10}MB (max ${input.byteLimit / 1024 / 1024}MB)`,
      )
    }
    keep = true
    return {
      kind: 'opened',
      fd,
      size,
      real,
      identity: uploadFileIdentity(opened),
      ...(pinned?.digest !== undefined ? { digest: pinned.digest } : {}),
    }
  } finally {
    if (!keep) closeSync(fd)
  }
}

export function closePinnedUpload(fd: number): void {
  closeSync(fd)
}

/** densable xTr — read the opened fd, then close it. */
export function readOpenedUpload(opened: OpenedUpload): UploadByteRead {
  const { fd, size, identity, digest, real } = opened
  try {
    const again = fstatSync(fd, { bigint: true })
    if (uploadFileIdentity(again) !== identity) {
      return pinReadError('changed', PIN_CHANGED)
    }
    const bytes = Buffer.allocUnsafe(size)
    let offset = 0
    while (offset < size) {
      const n = readSync(fd, bytes, offset, size - offset, offset)
      if (n === 0) break
      offset += n
    }
    const extra = Buffer.alloc(1)
    const extraN = readSync(fd, extra, 0, 1, size)
    if (offset !== size || extraN !== 0) {
      return pinReadError('changed', PIN_CHANGED)
    }
    if (digest !== undefined && sha256Hex(bytes) !== digest) {
      return pinReadError('changed', PIN_CHANGED)
    }
    return { kind: 'ok', bytes, real }
  } catch (error) {
    const code = getErrnoCode(error)
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return pinReadError('missing', 'File not found.')
    }
    return pinReadError(
      'read_error',
      `cannot read file_path (${code ?? 'unexpected error'})`,
    )
  } finally {
    closeSync(fd)
  }
}

/**
 * densable RTr + xTr — open the resolved file and require it to still be
 * the approved pin before any bytes are returned.
 */
export function readPinnedUploadBytes(input: {
  spelled: string
  pin?: { real?: unknown; identity?: unknown; digest?: unknown }
  byteLimit: number
  readVerdict: (path: string) => 'allow' | 'deny' | 'ask'
}): UploadByteRead {
  const opened = openPinnedUpload(input)
  if (opened.kind !== 'opened') return opened
  return readOpenedUpload(opened)
}

/**
 * densable iQt — bytes of a single-link regular file whose sha256 is the
 * admitted publish source. Symlinks and hard links are not that file.
 */
export function readAdmittedUploadBytes(
  spelled: string,
  sha256: string,
): { kind: 'ok'; bytes: Buffer } | { kind: 'unverified' } {
  if (isNetworkUncPath(spelled)) return { kind: 'unverified' }
  let listed: BigIntStats
  try {
    listed = lstatSync(spelled, { bigint: true })
  } catch {
    return { kind: 'unverified' }
  }
  if (listed.isSymbolicLink() || !listed.isFile() || listed.nlink !== 1n) {
    return { kind: 'unverified' }
  }
  if (listed.size > BigInt(ADMITTED_SOURCE_MAX_BYTES)) {
    return { kind: 'unverified' }
  }
  const flags =
    fsConstants.O_RDONLY |
    (fsConstants.O_NOFOLLOW ?? 0) |
    (fsConstants.O_NONBLOCK ?? 0)
  let fd: number
  try {
    fd = openSync(spelled, flags)
  } catch {
    return { kind: 'unverified' }
  }
  try {
    const opened = fstatSync(fd, { bigint: true })
    if (
      !opened.isFile() ||
      opened.nlink !== 1n ||
      opened.ino !== listed.ino ||
      opened.dev !== listed.dev ||
      opened.size > BigInt(ADMITTED_SOURCE_MAX_BYTES)
    ) {
      return { kind: 'unverified' }
    }
    const size = Number(opened.size)
    const bytes = Buffer.allocUnsafe(size)
    let offset = 0
    while (offset < size) {
      const n = readSync(fd, bytes, offset, size - offset, offset)
      if (n === 0) break
      offset += n
    }
    if (offset !== size || sha256Hex(bytes) !== sha256) {
      return { kind: 'unverified' }
    }
    const live = fstatSync(fd, { bigint: true })
    if (live.nlink !== 1n) return { kind: 'unverified' }
    return { kind: 'ok', bytes }
  } catch {
    return { kind: 'unverified' }
  } finally {
    closeSync(fd)
  }
}

export const UPLOAD_PIN_SOURCE_UNVERIFIED = PIN_SOURCE_UNVERIFIED
export const UPLOAD_BATCH_FROM_SCRIPT =
  '`file_paths` cannot be used from a script — pass one `file_path` per call'
