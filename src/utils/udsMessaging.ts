/**
 * UDS Messaging Layer — Unix Domain Socket IPC for Claude Code instances.
 *
 * Each session auto-creates a UDS server so peer sessions can send messages.
 * Protocol: newline-delimited JSON (NDJSON), one message per line.
 *
 * Socket path defaults to a tmpdir-based path derived from the session PID,
 * but can be overridden via --messaging-socket-path.
 */

import { createHash, randomBytes, timingSafeEqual } from 'crypto'
import { createServer, type Server, type Socket } from 'net'
import { chmod, lstat, mkdir, readFile, readdir, unlink } from 'fs/promises'
import { dirname, join, resolve } from 'path'
import { tmpdir } from 'os'
import { od } from './atomicWriteOd.js'
import { registerCleanup } from './cleanupRegistry.js'
import { logForDebugging } from './debug.js'
import { errorMessage } from './errors.js'
import { getClaudeConfigHomeDir } from './envUtils.js'
import { attachNdjsonFramer } from './ndjsonFramer.js'
import { attachUdsResponseReader } from './udsResponseReader.js'
import { logError } from './log.js'
import {
  buildProcessStartIdentityFields,
  getProcessLstartString,
  ownProcStartAsync,
  pickProcessStartIdentity,
} from './genericProcessUtils.js'
import { isUncOrNtObjectPath } from './path.js'
import { getPlatform } from './platform.js'
import { jsonParse, jsonStringify } from './slowOperations.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type UdsMessageType =
  | 'text'
  | 'notification'
  | 'query'
  | 'response'
  | 'error'
  | 'ping'
  | 'pong'
  /** densable 2.1.236 — control plane (notify_when_idle / peer_idle_notice). */
  | 'control'

export type UdsMessage = {
  /** Discriminator */
  type: UdsMessageType
  /** densable control action (type=control only) */
  action?: string
  /** Payload text / JSON content */
  data?: string
  /** Sender socket path (so the receiver can reply) */
  from?: string
  /** ISO timestamp */
  ts?: string
  /** Optional metadata */
  meta?: Record<string, unknown>
  /** densable control fields (notify_when_idle / peer_idle_notice) */
  msg_id?: string
  orig_msg_id?: string
  state?: string
  finished_at?: string
  detail?: string
  from_mode?: string
  status?: string
  reason?: string
  /** densable 2.1.238 #29 — refused is wire-mapped as expired + status_detail. */
  status_detail?: string
  drop_reason?: string
  dropped_msg_ids?: string[]
}

export type UdsInboxEntry = {
  id: string
  message: UdsMessage
  receivedAt: number
  status: 'pending' | 'processed'
}

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let server: Server | null = null
let socketPath: string | null = null
let onEnqueueCb: (() => void) | null = null
const clients = new Set<Socket>()
const inbox: UdsInboxEntry[] = []
let nextId = 1
let defaultSocketPath: string | null = null
let authToken: string | null = null
/** densable ykh.authRequired — `requireAuth ?? mti()` (Windows-only default). */
let authRequired = false
/** densable lastStartDegradedCause — Unix key publish fail continues. */
let lastStartDegradedCause: string | undefined
let capabilityFilePath: string | null = null
let inboxBytes = 0

export const MAX_UDS_INBOX_ENTRIES = 1_000
export const MAX_UDS_FRAME_BYTES = 64 * 1024
/** densable X1r — hard 1MiB newline-framed cross-session line cap (send refuse + recv drop). */
export const MAX_UDS_LINE_CHARS = 1_048_576
/**
 * Receive-side budget for the same X1r line, expressed in the bytes the framer
 * actually counts. UTF-8 costs at most 3 bytes per UTF-16 code unit (astral
 * chars are 4 bytes across 2 units), so a line the sender accepted under
 * MAX_UDS_LINE_CHARS can never exceed this — otherwise multibyte payloads would
 * pass the send refuse and then be dropped as an opaque connection reset.
 */
export const MAX_UDS_LINE_BYTES = 3 * MAX_UDS_LINE_CHARS
export const MAX_UDS_INBOX_BYTES = 2 * 1024 * 1024
export const MAX_UDS_CLIENTS = 128
export const UDS_AUTH_TIMEOUT_MS = 2_000
export const UDS_IDLE_TIMEOUT_MS = 30_000

/** densable eFd — typed refuse when serialized UDS wire exceeds X1r. */
export const UDS_MESSAGE_TOO_LARGE_ERROR_CLASS = 'message_too_large' as const

/**
 * densable yt/tFd — upfront refuse for oversized cross-session UDS lines.
 * User message + short code match SEA exactly (en-US toLocaleString + em dash).
 */
export class UdsMessageTooLargeError extends Error {
  readonly errorClass = UDS_MESSAGE_TOO_LARGE_ERROR_CLASS
  /** densable yt short / second ctor arg */
  readonly code = 'cross-session message exceeds the line cap'
  readonly serializedChars: number
  readonly limitChars: number

  constructor(serializedChars: number, limitChars: number) {
    super(
      `Message too large for cross-session delivery: the serialized message is ${serializedChars.toLocaleString('en-US')} characters and the limit is ${limitChars.toLocaleString('en-US')}. Shorten the message text — put bulk content in a file the recipient can read rather than in the message — or split it into smaller messages.`,
    )
    this.name = 'UdsMessageTooLargeError'
    this.serializedChars = serializedChars
    this.limitChars = limitChars
  }
}

/** densable yZt */
export function isUdsMessageTooLargeError(
  error: unknown,
): error is UdsMessageTooLargeError {
  return (
    error instanceof UdsMessageTooLargeError &&
    error.errorClass === UDS_MESSAGE_TOO_LARGE_ERROR_CLASS
  )
}

/** macOS/BSD AF_UNIX `sun_path` limit (bytes, excluding NUL). */
export const MAX_UNIX_SOCKET_PATH_LENGTH = 104

// ---------------------------------------------------------------------------
// Public API — socket path helpers
// ---------------------------------------------------------------------------

export function assertValidUnixSocketPath(path: string): void {
  if (process.platform === 'win32') return
  const byteLength = Buffer.byteLength(path, 'utf8')
  if (byteLength > MAX_UNIX_SOCKET_PATH_LENGTH) {
    throw new Error(
      `[udsMessaging] socket path is ${byteLength} bytes (max ${MAX_UNIX_SOCKET_PATH_LENGTH}): ${path}`,
    )
  }
}

/**
 * Default socket path based on PID. Uses a flat file under a short temp
 * directory so the path stays within the AF_UNIX limit on macOS.
 *
 * On Windows, Node.js requires named pipe paths in the `\\.\pipe\` namespace;
 * file-system paths like `C:\...\Temp\x.sock` cause EACCES. Bun handles both
 * transparently, but we use the pipe format on Windows for Node.js compat.
 */
export function getDefaultUdsSocketPath(): string {
  if (defaultSocketPath) return defaultSocketPath
  const nonce = randomBytes(8).toString('hex')
  if (process.platform === 'win32') {
    defaultSocketPath = `\\\\.\\pipe\\claude-code-${process.pid}-${nonce}`
    return defaultSocketPath
  }

  defaultSocketPath = join(
    tmpdir(),
    'cc-socks',
    `${process.pid}-${nonce}`,
    'messaging.sock',
  )
  assertValidUnixSocketPath(defaultSocketPath)
  return defaultSocketPath
}

/**
 * Returns the socket path of the currently running server, or undefined
 * if the server has not been started.
 */
export function getUdsMessagingSocketPath(): string | undefined {
  return socketPath ?? undefined
}

export function formatUdsAddress(socket: string): string {
  return `uds:${socket}`
}

export function parseUdsTarget(target: string): {
  socketPath: string
} {
  if (target.includes('#token=')) {
    throw new Error(
      'UDS target must not include an inline auth token; use the ListAgents address',
    )
  }
  return { socketPath: target }
}

/**
 * densable TSe — only refuse Windows-style UNC paths that are NOT named pipes.
 * Absolute Unix paths (`/tmp/...`) and `\\.\pipe\...` / `//./pipe/...` are local IPC.
 * UNC shares like `\\server\share` are rejected by callers via
 * `Refusing to connect to non-local IPC path:`.
 */
export function isLocalIpcPath(path: string): boolean {
  // densable: if (!/^[\\/]{2}/.test(e)) return true; else named-pipe only
  if (!/^[\\/]{2}/.test(path)) return true
  return parseWindowsNamedPipeName(path) !== undefined
}

/**
 * densable ELe — Qei's socket-address check. Uses full Yc (UNC **or** NT
 * `\??\` via Eke), then jWe. Distinct from `isLocalIpcPath` (double-slash
 * only — that helper would pass `\??\C:\…`). In 239, TSe is
 * `isWorkshopEnabled`, not a path predicate.
 */
export function isLocalSocketAddress(value: string): boolean {
  if (!isUncOrNtObjectPath(value)) return true
  return parseWindowsNamedPipeName(value) !== undefined
}

/**
 * densable 2.1.239 jWe / hbr — extract named-pipe leaf from
 * `\\.\pipe\name` / `//?/pipe/name` / optional `LOCAL\` prefix.
 * Rejects `.` / `..`, trailing `.` or space, and `\\?\` paths that mix `/`.
 */
export function parseWindowsNamedPipeName(path: string): string | undefined {
  const match = /^[\\/]{2}[.?][\\/]pipe[\\/](?:(LOCAL)[\\/])?([^\\/]+)$/i.exec(
    path,
  )
  if (match === null || match[2] === '.' || match[2] === '..') {
    return undefined
  }
  const leaf = match[2]!
  if (/[. ]$/.test(leaf)) return undefined
  if (path.startsWith('\\\\?\\') && path.includes('/')) return undefined
  return match[1] === undefined ? leaf : `LOCAL\\${leaf}`
}

/** densable 2.1.239 IMr — `..` as a path segment. */
const HAS_DOTDOT_SEGMENT = /(^|[\\/])\.\.([\\/]|$)/

/**
 * densable Pm_ — nft only strips `/System/Volumes/Data` when the remainder
 * starts with one of these roots.
 */
const SYSTEM_VOLUMES_DATA_ROOTS = [
  'usr/local',
  'usr/libexec/cups',
  'usr/share/snmp',
  'AppleInternal',
  'Applications',
  'Library',
  'Users',
  'Volumes',
  'cores',
  'home',
  'media',
  'mnt',
  'opt',
  'pkg',
  'private',
  'sw',
]

/** densable Zei / dxn */
function looseCaseFold(value: string): string {
  return value.toUpperCase().toLowerCase()
}

/** densable Z4d — single code point (BMP length 1, non-BMP length 2). */
function isSingleCodePoint(value: string): boolean {
  const codePoint = value.codePointAt(0)
  return codePoint !== undefined && value.length === (codePoint > 65535 ? 2 : 1)
}

/**
 * densable h_a — Unicode case-fold; refuse multi-character mappings.
 */
function foldUnicodeCase(value: string): string {
  let out = ''
  for (const ch of value) {
    const upper = ch.toUpperCase()
    const step = isSingleCodePoint(upper) ? upper : ch
    const lower = step.toLowerCase()
    out += isSingleCodePoint(lower) ? lower : step
  }
  return out
}

/** densable lYb */
function nfcIfMacos(value: string): string {
  return getPlatform() === 'macos' ? value.normalize('NFC') : value
}

/**
 * densable nft — `/System/Volumes/Data/<Pm_>/…` → `/<Pm_>/…`.
 * Not platform-gated; IFn only calls it on macos.
 */
export function stripSystemVolumesDataPrefix(path: string): string {
  const parts = path.split('/')
  if (
    parts.length < 5 ||
    parts[0] !== '' ||
    looseCaseFold(parts[1] ?? '') !== 'system' ||
    looseCaseFold(parts[2] ?? '') !== 'volumes' ||
    looseCaseFold(parts[3] ?? '') !== 'data'
  ) {
    return path
  }
  const rest = parts.slice(4)
  for (const root of SYSTEM_VOLUMES_DATA_ROOTS) {
    const rootParts = root.split('/')
    if (rest.length < rootParts.length) continue
    if (
      rootParts.every(
        (part, i) => looseCaseFold(rest[i] ?? '') === looseCaseFold(part),
      )
    ) {
      return `/${rest.join('/')}`
    }
  }
  return path
}

/** densable IFn — macos nft + strip `/private/{var,tmp,etc}`. */
function stripMacPrivatePrefix(path: string): string {
  if (getPlatform() !== 'macos') return path
  const normalized = stripSystemVolumesDataPrefix(path)
  const match = /^\/private(\/(?:var|tmp|etc)(?:\/.*)?)$/.exec(normalized)
  return match ? match[1]! : normalized
}

/** densable Jei */
function caseFoldResolvedSocketPath(path: string): string {
  const platform = getPlatform()
  return platform === 'macos' || platform === 'windows'
    ? stripMacPrivatePrefix(foldUnicodeCase(nfcIfMacos(path)))
    : path
}

export type MessagingSocketRelation = 'same' | 'maybe' | 'different'

/**
 * densable eWd — named-pipe leaf via jWe, else resolve + Jei/Zei.
 * IMr paths never return `same` unless the raw strings are identical.
 */
export function compareMessagingSocketPaths(
  left: string,
  right: string,
): MessagingSocketRelation {
  const leftPipe = parseWindowsNamedPipeName(left)
  const rightPipe = parseWindowsNamedPipeName(right)
  if (leftPipe !== undefined || rightPipe !== undefined) {
    if (leftPipe === undefined || rightPipe === undefined) return 'different'
    if (foldUnicodeCase(leftPipe) === foldUnicodeCase(rightPipe)) return 'same'
    return looseCaseFold(leftPipe) === looseCaseFold(rightPipe)
      ? 'maybe'
      : 'different'
  }
  if (left === right) return 'same'
  if (HAS_DOTDOT_SEGMENT.test(left) || HAS_DOTDOT_SEGMENT.test(right)) {
    return caseFoldResolvedSocketPath(stripMacPrivatePrefix(resolve(left))) ===
      caseFoldResolvedSocketPath(stripMacPrivatePrefix(resolve(right)))
      ? 'maybe'
      : 'different'
  }
  const leftResolved = stripMacPrivatePrefix(resolve(left))
  const rightResolved = stripMacPrivatePrefix(resolve(right))
  if (leftResolved === rightResolved) return 'same'
  const platform = getPlatform()
  const foldPlatform = platform === 'macos' || platform === 'windows'
  return caseFoldResolvedSocketPath(leftResolved) ===
    caseFoldResolvedSocketPath(rightResolved) ||
    (foldPlatform &&
      looseCaseFold(leftResolved) === looseCaseFold(rightResolved))
    ? 'maybe'
    : 'different'
}

/** densable eti */
export function messagingSocketsMayBeSame(
  left: string,
  right: string,
): boolean {
  return compareMessagingSocketPaths(left, right) !== 'different'
}

/** densable HFn — eWd === "same". */
export function messagingSocketsAreSame(left: string, right: string): boolean {
  return compareMessagingSocketPaths(left, right) === 'same'
}

/** densable Xen — own inbox exists and HFn(target, own). */
export function isDefinitelyOwnMessagingSocket(target: string): boolean {
  const own = getUdsMessagingSocketPath()
  return own !== undefined && messagingSocketsAreSame(target, own)
}

/** densable VEt — own inbox socket exists and eti(target, own). */
export function isOwnMessagingSocketTarget(target: string): boolean {
  const own = getUdsMessagingSocketPath()
  return own !== undefined && messagingSocketsMayBeSame(target, own)
}

/**
 * densable 2.1.239 lQ — canonicalize a messaging socket before hashing.
 * Named pipe → `\\.\pipe\${jWe leaf}` with `[A-Z]+` folded; `..` segments
 * refuse; else `path.resolve`.
 */
export function canonicalizeMessagingSocketPath(
  path: string,
): string | undefined {
  const pipe = parseWindowsNamedPipeName(path)
  if (pipe !== undefined) {
    return `\\\\.\\pipe\\${pipe.replace(/[A-Z]+/g, run => run.toLowerCase())}`
  }
  if (HAS_DOTDOT_SEGMENT.test(path)) return undefined
  try {
    return resolve(path)
  } catch {
    return undefined
  }
}

/** densable 2.1.239 I_a — live key file. */
const MESSAGING_KEY_FILE = /^(\d+)\.[0-9a-f]{64}\.key$/
/** densable 2.1.239 CYb — od() staging leftover. */
const MESSAGING_KEY_TMP = /^(\d+)\.[0-9a-f]{64}\.key\.tmp\.[0-9a-f]+$/
/** densable 2.1.239 xYb / R_a=16. */
const PEER_TOKEN = /^[0-9a-f]{32}$/
/** densable 2.1.239 RYb. */
const MESSAGING_KEY_MAX_BYTES = 4096
/** densable 2.1.239 od → KGo mode 384. */
const MESSAGING_KEY_MODE = 0o600
/** densable 2.1.239 SYb — b7 only considers this pid range. */
const MAX_MESSAGING_PID = 2147483647
const PROC_START_FORMAT_THRESHOLD = 300000000000000000

export type MessagingCapability =
  | { kind: 'token'; token: string }
  | { kind: 'no-key' }
  | { kind: 'unusable' }
  | { kind: 'dead-owner' }

/** densable 2.1.239 kLe. */
function getSessionsDir(): string {
  return join(getClaudeConfigHomeDir(), 'sessions')
}

/** densable 2.1.239 CWd. */
export function hashMessagingSocketPath(socket: string): string | undefined {
  const canonical = canonicalizeMessagingSocketPath(socket)
  if (canonical === undefined) return undefined
  return createHash('sha256').update(canonical).digest('hex')
}

/** densable 2.1.239 HYb. */
export function deriveMessagingKeyName(pid: number, socket: string): string {
  const digest = hashMessagingSocketPath(socket)
  if (digest === undefined) {
    throw new Error(
      'refusing to derive a messaging key name for a non-canonical socket path',
    )
  }
  return `${pid}.${digest}.key`
}

/**
 * densable 2.1.239 b7 — dead owner. Invalid pid is not dead; only ESRCH is.
 */
export function isDeadMessagingPid(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 1 || pid > MAX_MESSAGING_PID) {
    return false
  }
  try {
    process.kill(pid, 0)
    return false
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ESRCH'
  }
}

/** densable 2.1.239 BFn — exact or opposite-side FILETIME/Ticks pair. */
function messagingStartIdentityMatches(
  expected: unknown,
  current: unknown,
): boolean {
  if (current === expected) return true
  const left = Number(expected)
  const right = Number(current)
  return (
    Number.isFinite(left) &&
    Number.isFinite(right) &&
    left > PROC_START_FORMAT_THRESHOLD !== right > PROC_START_FORMAT_THRESHOLD
  )
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  )
}

function assertPrivateDirectory(
  stat: Awaited<ReturnType<typeof lstat>>,
  dir: string,
  label: string,
): void {
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(
      `[udsMessaging] ${label} is not a private directory: ${dir}`,
    )
  }
  if (process.platform !== 'win32') {
    const broadMode = Number(stat.mode) & 0o077
    if (broadMode !== 0) {
      throw new Error(
        `[udsMessaging] ${label} permissions are too broad: ${dir}`,
      )
    }
    if (
      typeof process.getuid === 'function' &&
      Number(stat.uid) !== process.getuid()
    ) {
      throw new Error(
        `[udsMessaging] ${label} owner does not match current user: ${dir}`,
      )
    }
  }
}

type MessagingKeyPayload = {
  peerToken: string
  procStart?: string
  procStartFt?: string
}

function parseMessagingKeyPayload(
  raw: string,
): MessagingKeyPayload | undefined {
  try {
    const data = jsonParse(raw)
    if (typeof data !== 'object' || data === null) return undefined
    const rec = data as Record<string, unknown>
    if (typeof rec.peerToken !== 'string' || !PEER_TOKEN.test(rec.peerToken)) {
      return undefined
    }
    return {
      peerToken: rec.peerToken,
      ...(typeof rec.procStart === 'string'
        ? { procStart: rec.procStart }
        : {}),
      ...(typeof rec.procStartFt === 'string'
        ? { procStartFt: rec.procStartFt }
        : {}),
    }
  } catch {
    return undefined
  }
}

/** densable 2.1.239 zC — regular file, size ≤ RYb. */
async function readMessagingKeyFile(path: string): Promise<string | null> {
  try {
    const stat = await lstat(path)
    if (!stat.isFile() || stat.size > MESSAGING_KEY_MAX_BYTES) return null
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

/** densable 2.1.239 PYb — sweep dead-owner CYb temps when fBr permits. */
async function sweepDeadMessagingKeyTmps(
  dir: string,
  permitted: boolean,
): Promise<void> {
  if (!permitted) return
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return
  }
  await Promise.all(
    names.map(async name => {
      const match = MESSAGING_KEY_TMP.exec(name)
      if (match && isDeadMessagingPid(parseInt(match[1]!, 10))) {
        try {
          await unlink(join(dir, name))
        } catch {
          // stale temp may already be gone
        }
      }
    }),
  )
}

async function ensureSocketParent(path: string): Promise<void> {
  const dir = dirname(path)
  try {
    try {
      const stat = await lstat(dir)
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw new Error(
          `[udsMessaging] socket parent is not a directory: ${dir}`,
        )
      }
      assertPrivateDirectory(stat, dir, 'socket parent')
      return
    } catch (error) {
      if (!isNotFound(error)) throw error
    }

    await mkdir(dir, { recursive: true, mode: 0o700 })
    await chmod(dir, 0o700)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    // densable SEA: sockets-dir setup failure uses this exact prefix.
    throw new Error(
      `[uds-messaging] Failed to set up sockets directory (refusing to bind): ${detail}`,
      { cause: error instanceof Error ? error : undefined },
    )
  }
}

/** densable 2.1.239 xWd — publish `${pid}.${hash}.key` under sessions/. */
async function writeCapabilityFile(
  socket: string,
  token: string,
  { sweepPermitted }: { sweepPermitted: boolean },
): Promise<void> {
  const dir = getSessionsDir()
  await mkdir(dir, { recursive: true, mode: 0o700 })
  await sweepDeadMessagingKeyTmps(dir, sweepPermitted)
  const target = join(dir, deriveMessagingKeyName(process.pid, socket))
  try {
    await unlink(target)
  } catch {
    // first publish, or already gone
  }
  await od(
    target,
    jsonStringify({
      peerToken: token,
      ...buildProcessStartIdentityFields(await ownProcStartAsync()),
    }),
    MESSAGING_KEY_MODE,
  )
  capabilityFilePath = target
}

/**
 * densable `mti` — send-side IWd `requireLiveOwner` is Windows-only.
 * Unix/macOS/WSL leave the flag off (cmp still uses a token when present).
 */
export function isMessagingLiveOwnerRequired(): boolean {
  // densable Wt() === "windows" — WSL is linux, so live-owner stays off.
  return process.platform === 'win32'
}

/** densable 2.1.239 pmp / k4r session-record cap (zC 262144). */
const SESSION_RECORD_MAX_BYTES = 262144

type MessagingRegistryInboxRow = {
  pid: number
  sock: string
  procStart?: string
  procStartFt?: string
}

/** densable qS — kill(0) live probe; pid ≤ 1 is not live. */
function isLiveMessagingPid(pid: number): boolean {
  if (pid <= 1) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** densable pxa / cBr — live start identity equals stamped procStart. */
async function sessionRecordStartMatches(
  row: MessagingRegistryInboxRow,
): Promise<boolean> {
  const stamped = row.procStartFt ?? row.procStart
  if (stamped === undefined || isDeadMessagingPid(row.pid)) return false
  const live = await getProcessLstartString(row.pid)
  if (live === undefined) return false
  return messagingStartIdentityMatches(stamped, live)
}

/** densable k4r + pmp fields rvv reads — no live-sweep. */
async function listMessagingRegistryInboxRows(): Promise<
  MessagingRegistryInboxRow[]
> {
  const dir = getSessionsDir()
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return []
  }
  const rows = await Promise.all(
    names
      .filter(name => /^\d+\.json$/.test(name))
      .map(async (name): Promise<MessagingRegistryInboxRow | null> => {
        const pidStr = name.replace(/\.json$/, '')
        const pid = parseInt(pidStr, 10)
        if (Number.isNaN(pid)) return null
        const path = join(dir, name)
        if (String(pid) !== pidStr) {
          void unlink(path).catch(() => {})
          return null
        }
        try {
          const stat = await lstat(path)
          if (!stat.isFile() || stat.size > SESSION_RECORD_MAX_BYTES) {
            return null
          }
          const data = jsonParse(await readFile(path, 'utf8')) as Record<
            string,
            unknown
          >
          return {
            pid,
            sock:
              typeof data.messagingSocketPath === 'string'
                ? data.messagingSocketPath
                : '',
            ...(typeof data.procStart === 'string'
              ? { procStart: data.procStart }
              : {}),
            ...(typeof data.procStartFt === 'string'
              ? { procStartFt: data.procStartFt }
              : {}),
          }
        } catch {
          return null
        }
      }),
  )
  return rows.filter((row): row is MessagingRegistryInboxRow => row !== null)
}

/**
 * densable `rvv` — a live session-registry inbox matches this canonical socket.
 * Dead pid skip; stamped `procStart`/`procStartFt` must BFn-match; else qS.
 */
export async function hasLiveRegisteredInbox(socket: string): Promise<boolean> {
  const canonical = canonicalizeMessagingSocketPath(socket)
  if (canonical === undefined) return false
  for (const row of await listMessagingRegistryInboxRows()) {
    if (!row.sock || canonicalizeMessagingSocketPath(row.sock) !== canonical) {
      continue
    }
    if (isDeadMessagingPid(row.pid)) continue
    if ((row.procStartFt ?? row.procStart) !== undefined) {
      if (await sessionRecordStartMatches(row)) return true
      continue
    }
    if (isLiveMessagingPid(row.pid)) return true
  }
  return false
}

/**
 * densable 2.1.239 IWd — resolve peerToken from sessions/ `*.${hash}.key`.
 */
export async function resolveMessagingCapability(
  socket: string,
  opts?: { requireLiveOwner?: boolean },
): Promise<MessagingCapability> {
  const dir = getSessionsDir()
  let names: string[]
  try {
    names = await readdir(dir)
  } catch (error) {
    return isNotFound(error) ? { kind: 'no-key' } : { kind: 'unusable' }
  }
  const digest = hashMessagingSocketPath(socket)
  if (digest === undefined) return { kind: 'no-key' }
  const suffix = `.${digest}.key`
  const candidates = names
    .filter(name => name.endsWith(suffix))
    .map(file => {
      const match = MESSAGING_KEY_FILE.exec(file)
      return match ? { file, pid: parseInt(match[1]!, 10) } : undefined
    })
    .filter((row): row is { file: string; pid: number } => row !== undefined)
  if (candidates.length === 0) return { kind: 'no-key' }

  const load = async (
    file: string,
  ): Promise<MessagingKeyPayload | undefined> => {
    const raw = await readMessagingKeyFile(join(dir, file))
    if (raw === null) return undefined
    return parseMessagingKeyPayload(raw)
  }

  if (candidates.length === 1) {
    const row = candidates[0]!
    if (opts?.requireLiveOwner && isDeadMessagingPid(row.pid)) {
      return { kind: 'dead-owner' }
    }
    const payload = await load(row.file)
    if (payload === undefined) return { kind: 'unusable' }
    if (opts?.requireLiveOwner) {
      const stamped = pickProcessStartIdentity(payload)
      if (stamped !== undefined) {
        const live = await getProcessLstartString(row.pid)
        if (
          live !== undefined &&
          !messagingStartIdentityMatches(stamped, live)
        ) {
          return { kind: 'dead-owner' }
        }
      }
    }
    return { kind: 'token', token: payload.peerToken }
  }

  let best: { rank: number; peerToken: string } | undefined
  for (const { file, pid } of candidates) {
    const payload = await load(file)
    if (payload === undefined) continue
    let rank = 0
    if (!isDeadMessagingPid(pid)) {
      const stamped = pickProcessStartIdentity(payload)
      const live =
        stamped === undefined ? undefined : await getProcessLstartString(pid)
      if (stamped === undefined || live === undefined) rank = 1
      else rank = messagingStartIdentityMatches(stamped, live) ? 2 : 0
    }
    if (best === undefined || rank > best.rank) {
      best = { rank, peerToken: payload.peerToken }
    }
  }
  if (best === undefined) return { kind: 'unusable' }
  if (opts?.requireLiveOwner && best.rank === 0) return { kind: 'dead-owner' }
  return { kind: 'token', token: best.peerToken }
}

export async function readUdsCapabilityToken(
  socket: string,
): Promise<string | undefined> {
  const cap = await resolveMessagingCapability(socket)
  return cap.kind === 'token' ? cap.token : undefined
}

// ---------------------------------------------------------------------------
// Inbox
// ---------------------------------------------------------------------------

/**
 * Register a callback invoked whenever a message is enqueued into the inbox.
 * Used by the print/SDK query loop to kick off processing.
 */
export function setOnEnqueue(cb: (() => void) | null): void {
  onEnqueueCb = cb
}

/**
 * Drain all pending inbox messages and release retained history.
 */
export function drainInbox(): UdsInboxEntry[] {
  const pending = inbox.splice(0, inbox.length)
  inboxBytes = 0
  for (const entry of pending) {
    entry.status = 'processed'
  }
  return pending
}

function getMessageBytes(message: UdsMessage): number {
  return Buffer.byteLength(jsonStringify(message), 'utf8')
}

function enqueueInboxEntry(entry: UdsInboxEntry): boolean {
  const entryBytes = getMessageBytes(entry.message)
  if (
    entryBytes > MAX_UDS_LINE_BYTES ||
    inbox.length >= MAX_UDS_INBOX_ENTRIES ||
    inboxBytes + entryBytes > MAX_UDS_INBOX_BYTES
  ) {
    logError(
      new Error(
        `[udsMessaging] inbox full (${inbox.length}/${MAX_UDS_INBOX_ENTRIES}, ${inboxBytes}/${MAX_UDS_INBOX_BYTES} bytes); dropping message type=${entry.message.type}`,
      ),
    )
    return false
  }
  inbox.push(entry)
  inboxBytes += entryBytes
  return true
}

function ensureAuthToken(): string {
  if (!authToken) {
    // densable 2.1.239 R_a=16 → xYb 32 hex.
    authToken = randomBytes(16).toString('hex')
  }
  return authToken
}

function getMessageAuthToken(message: UdsMessage): string | undefined {
  const token = message.meta?.authToken
  return typeof token === 'string' ? token : undefined
}

function isAuthorizedMessage(message: UdsMessage): boolean {
  // Official F$E: drop missing/bad auth only when authRequired (mti/Windows).
  if (!authRequired) return true
  const provided = getMessageAuthToken(message)
  if (!provided || !authToken) return false
  const providedBuffer = Buffer.from(provided, 'utf8')
  const expectedBuffer = Buffer.from(authToken, 'utf8')
  if (providedBuffer.length !== expectedBuffer.length) return false
  return timingSafeEqual(providedBuffer, expectedBuffer)
}

function writeSocketMessage(socket: Socket, message: UdsMessage): void {
  if (socket.destroyed) return
  socket.write(jsonStringify(message) + '\n')
}

function writeSocketMessageAndDestroy(
  socket: Socket,
  message: UdsMessage,
): void {
  if (socket.destroyed) return
  socket.write(jsonStringify(message) + '\n', () => {
    if (!socket.destroyed) socket.destroy()
  })
}

function writeSocketErrorAndDestroy(socket: Socket, data: string): void {
  writeSocketMessageAndDestroy(socket, {
    type: 'error',
    data,
    ts: new Date().toISOString(),
  })
}

function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
  const maybeUnref = (timer as { unref?: () => void }).unref
  if (typeof maybeUnref === 'function') {
    maybeUnref.call(timer)
  }
}

async function closeServer(serverToClose: Server): Promise<void> {
  await new Promise<void>(resolve => {
    serverToClose.close(() => resolve())
  })
}

async function removeSocketPath(path: string): Promise<void> {
  if (process.platform === 'win32') return
  try {
    await unlink(path)
  } catch {
    // Already gone.
  }
}

function stripAuthToken(message: UdsMessage): UdsMessage {
  const { authToken: _authToken, ...metaWithoutAuth } = message.meta ?? {}
  return {
    ...message,
    meta: Object.keys(metaWithoutAuth).length > 0 ? metaWithoutAuth : undefined,
  }
}

function withRequestAuthToken(message: UdsMessage, token: string): UdsMessage {
  return {
    ...message,
    meta: {
      ...message.meta,
      authToken: token,
    },
  }
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

/**
 * Start the UDS messaging server on the given socket path.
 *
 * Exports `CLAUDE_CODE_MESSAGING_SOCKET` into `process.env` so child
 * processes (hooks, spawned agents) can discover and connect back.
 */
export function getUdsStartDegradedCause(): string | undefined {
  return lastStartDegradedCause
}

export async function startUdsMessaging(
  path: string,
  opts?: { isExplicit?: boolean; requireAuth?: boolean },
): Promise<void> {
  if (server) {
    logForDebugging('[udsMessaging] server already running, skipping start')
    return
  }

  assertValidUnixSocketPath(path)

  // Ensure parent directory exists (skip on Windows — pipe paths aren't files)
  if (process.platform !== 'win32') {
    await ensureSocketParent(path)
  }

  // Clean up stale socket file (skip on Windows — pipe paths aren't files)
  if (process.platform !== 'win32') {
    try {
      await unlink(path)
    } catch {
      // ENOENT is fine
    }
  }

  const token = ensureAuthToken()
  // Official Ckh: authRequired = t.requireAuth ?? mti()
  authRequired = opts?.requireAuth ?? isMessagingLiveOwnerRequired()
  lastStartDegradedCause = undefined
  let startedServer: Server | null = null
  let exportedSocketEnv = false
  try {
    await new Promise<void>((resolve, reject) => {
      const srv = createServer(socket => {
        if (clients.size >= MAX_UDS_CLIENTS) {
          logForDebugging(
            `[udsMessaging] rejected client: ${clients.size}/${MAX_UDS_CLIENTS} clients already connected`,
          )
          socket.destroy()
          return
        }
        clients.add(socket)
        logForDebugging(
          `[udsMessaging] client connected (total: ${clients.size})`,
        )
        let authenticated = !authRequired
        let closing = false
        const closeWithError = (data: string): void => {
          if (closing || socket.destroyed) return
          closing = true
          socket.pause()
          writeSocketErrorAndDestroy(socket, data)
        }
        const authTimer = authRequired
          ? setTimeout(() => {
              if (authenticated || socket.destroyed) return
              logForDebugging(
                '[udsMessaging] closing unauthenticated idle client',
              )
              closeWithError('authentication timeout')
            }, UDS_AUTH_TIMEOUT_MS)
          : undefined
        if (authTimer !== undefined) unrefTimer(authTimer)
        socket.setTimeout(UDS_IDLE_TIMEOUT_MS, () => {
          logForDebugging('[udsMessaging] closing idle client')
          closeWithError('idle timeout')
        })

        attachNdjsonFramer<UdsMessage>(
          socket,
          msg => {
            if (!isAuthorizedMessage(msg)) {
              logForDebugging(
                `[udsMessaging] rejected unauthenticated message type=${msg.type}`,
              )
              closeWithError('unauthorized')
              return
            }
            if (!authenticated) {
              authenticated = true
              if (authTimer !== undefined) clearTimeout(authTimer)
            }

            // Handle ping with automatic pong
            if (msg.type === 'ping') {
              writeSocketMessage(socket, {
                type: 'pong',
                from: socketPath ?? undefined,
                ts: new Date().toISOString(),
              })
              return
            }

            // densable 2.1.236 GAP #2 — control frames (notify_when_idle /
            // peer_idle_notice) are handled out-of-band; never enter the text inbox.
            if (msg.type === 'control') {
              const sanitizedControl = stripAuthToken(msg)
              try {
                const { handleInboundControlFrame } =
                  require('./udsIdleNotify.js') as typeof import('./udsIdleNotify.js')
                void handleInboundControlFrame(
                  sanitizedControl,
                  socketPath ?? undefined,
                )
              } catch (err) {
                logForDebugging(
                  `[udsMessaging] control handler failed: ${errorMessage(err)}`,
                )
              }
              writeSocketMessage(socket, {
                type: 'response',
                data: 'ok',
                ts: new Date().toISOString(),
              })
              return
            }

            // Enqueue into inbox
            const sanitizedMessage = stripAuthToken(msg)
            const entry: UdsInboxEntry = {
              id: `uds-${nextId++}`,
              message: sanitizedMessage,
              receivedAt: Date.now(),
              status: 'pending',
            }
            if (!enqueueInboxEntry(entry)) {
              // densable 2.1.238 #30 — queue-full drop receipt; keep close string.
              try {
                const { noteInboxQueueFullDrop } =
                  require('./peerReceipts.js') as typeof import('./peerReceipts.js')
                noteInboxQueueFullDrop(sanitizedMessage)
              } catch {
                // optional
              }
              closeWithError('inbox full')
              return
            }
            // densable $id / Nid.noteCorrespondent — track UDS peers for rename notice
            try {
              const fromRaw = sanitizedMessage.from
              if (typeof fromRaw === 'string' && fromRaw.length > 0) {
                const addr = fromRaw.startsWith('uds:')
                  ? fromRaw
                  : fromRaw.startsWith('/')
                    ? `uds:${fromRaw}`
                    : null
                if (addr) {
                  const sockPath = addr.slice(4)
                  void import('./sessionNameUniqueness.js').then(
                    async ({ noteSessionNameCorrespondent }) => {
                      let peerPid = 0
                      try {
                        const { listLiveSessionRecords } = await import(
                          './concurrentSessions.js'
                        )
                        const live = await listLiveSessionRecords()
                        const hit = live.find(
                          r => r.messagingSocketPath === sockPath,
                        )
                        if (hit) peerPid = hit.pid
                      } catch {
                        // optional
                      }
                      noteSessionNameCorrespondent(addr, peerPid)
                    },
                  )
                }
              }
            } catch {
              // optional uniqueness tracking
            }
            logForDebugging(
              `[udsMessaging] enqueued message type=${msg.type} from=${msg.from ?? 'unknown'}`,
            )
            writeSocketMessage(socket, {
              type: 'response',
              data: 'ok',
              ts: new Date().toISOString(),
              meta: { id: entry.id },
            })
            onEnqueueCb?.()
          },
          text => jsonParse(text) as UdsMessage,
          {
            // densable X1r — same 1MiB line cap as send refuse (oFd/tFd),
            // measured in the framer's bytes rather than the sender's chars.
            maxFrameBytes: MAX_UDS_LINE_BYTES,
            onFrameError: () => {
              // densable recv drop: log + destroy (no silent tool success).
              logForDebugging(
                `[uds-messaging] Line exceeded ${MAX_UDS_LINE_BYTES} bytes; dropping connection`,
              )
              if (!socket.destroyed) socket.destroy()
            },
            onInvalidFrame: error => {
              logForDebugging(
                `[udsMessaging] invalid client frame: ${errorMessage(error)}`,
              )
              closeWithError('invalid frame')
            },
            destroyOnFrameError: false,
          },
        )

        socket.on('close', () => {
          if (authTimer !== undefined) clearTimeout(authTimer)
          clients.delete(socket)
        })

        socket.on('error', err => {
          if (authTimer !== undefined) clearTimeout(authTimer)
          clients.delete(socket)
          logForDebugging(`[udsMessaging] client error: ${errorMessage(err)}`)
        })
      })

      const rejectBeforeListen = (error: Error): void => {
        // densable SEA listen/bind failure prefix
        reject(
          new Error(
            `[uds-messaging] Failed to create server: ${errorMessage(error)}`,
            { cause: error },
          ),
        )
      }
      const logRuntimeError = (error: Error): void => {
        logForDebugging(
          `[udsMessaging] server error on ${path}${opts?.isExplicit ? ' (explicit)' : ''}: ${errorMessage(error)}`,
        )
      }

      srv.once('error', rejectBeforeListen)

      srv.listen(path, () => {
        void (async () => {
          try {
            if (process.platform !== 'win32') {
              // Restrict socket permissions to owner-only. On macOS with
              // Node.js v22, the listen callback may fire before the socket
              // file is visible on disk (observed with nested tmpdir paths).
              // The parent directory is already 0o700, so skipping chmod when
              // the file is not yet visible is safe.
              try {
                await chmod(path, 0o600)
              } catch (err: unknown) {
                if (
                  !(
                    err instanceof Error &&
                    (err as NodeJS.ErrnoException).code === 'ENOENT'
                  )
                ) {
                  throw err
                }
                logForDebugging(
                  `[udsMessaging] chmod skipped: socket file not yet visible at ${path}`,
                )
              }
            }
            srv.off('error', rejectBeforeListen)
            srv.on('error', logRuntimeError)
            server = srv
            startedServer = srv
            resolve()
          } catch (error) {
            srv.off('error', rejectBeforeListen)
            const closeError =
              error instanceof Error ? error : new Error(errorMessage(error))
            let rejected = false
            const rejectOnce = (): void => {
              if (rejected) return
              rejected = true
              reject(closeError)
            }
            const fallback = setTimeout(rejectOnce, 1_000)
            unrefTimer(fallback)
            srv.close(() => {
              clearTimeout(fallback)
              rejectOnce()
            })
          }
        })()
      })
    })

    // Official Ckh: key publish fail is hard only when authRequired.
    try {
      const { isRegistrySweepPermitted } =
        require('./concurrentSessions.js') as typeof import('./concurrentSessions.js')
      await writeCapabilityFile(path, token, {
        sweepPermitted: await isRegistrySweepPermitted(),
      })
    } catch (publishErr) {
      const detail =
        publishErr instanceof Error ? publishErr.message : String(publishErr)
      if (authRequired) {
        logForDebugging(
          `[uds-messaging] Failed to publish the inbox auth key (refusing to run an inbox no peer can authenticate to): ${detail}`,
        )
        const err = new Error(
          `[uds-messaging] Failed to publish the inbox auth key (refusing to run an inbox no peer can authenticate to): ${detail}`,
        )
        ;(err as Error & { code?: string }).code = 'key_publish_failed'
        throw err
      }
      logForDebugging(
        `[uds-messaging] Failed to publish the inbox auth key; peers will send unauthenticated (accepted: auth is optional on this platform): ${detail}`,
      )
      lastStartDegradedCause = 'key_publish_failed'
    }
    socketPath = path
    // Export so child processes can discover the socket only after the
    // capability file exists and the listener is ready.
    process.env.CLAUDE_CODE_MESSAGING_SOCKET = path
    exportedSocketEnv = true
    // densable also exports CLAUDE_CODE_MESSAGING_TOKEN for inject/socat.
    // Tradeoff (SEA-aligned): child processes inherit this env; token is also
    // on-disk in the capability file. Do not invent a non-env soft-auth path.
    process.env.CLAUDE_CODE_MESSAGING_TOKEN = token
    // densable kla — stamp messagingSocketPath + features:["notify_idle"] voucher.
    try {
      const { updateSessionMessagingSocket } =
        require('./concurrentSessions.js') as typeof import('./concurrentSessions.js')
      void updateSessionMessagingSocket(path)
    } catch {
      // session registry optional (tests / early boot)
    }
    // densable $Ri — register peer_idle_notice sender when inbox starts.
    try {
      const {
        setPeerIdleNoticeSender,
        buildPeerIdleNoticeSender,
        flushIdleSubscribers,
      } = require('./udsIdleNotify.js') as typeof import('./udsIdleNotify.js')
      setPeerIdleNoticeSender(buildPeerIdleNoticeSender(path))
      // densable afl — sendPeerReceipt over the same control plane.
      try {
        const { installPeerReceiptSender } =
          require('./peerReceipts.js') as typeof import('./peerReceipts.js')
        const { vetReplyAddress } =
          require('./udsIdleNotify.js') as typeof import('./udsIdleNotify.js')
        const from = formatUdsAddress(path)
        installPeerReceiptSender({
          ownSocketPath: path,
          from,
          vetReplyAddress,
          send: async (target, fields, sendOpts) => {
            // Official sTl → T4r → Tli → cmp (noFollowSymlink + expectPeerPid).
            const { sendUdsControl } = await import('./udsClient.js')
            await sendUdsControl(target, fields, sendOpts)
          },
        })
      } catch (receiptErr) {
        logForDebugging(
          `[udsMessaging] peer-receipt sender wire failed: ${errorMessage(receiptErr)}`,
        )
      }
      // Arm idle fire when main-loop refcount returns to 0 (turn finished).
      try {
        const { setMainLoopBecameIdleListener } =
          require('./sessionActivity.js') as typeof import('./sessionActivity.js')
        setMainLoopBecameIdleListener(() => {
          void flushIdleSubscribers({ state: 'idle' })
        })
      } catch {
        // sessionActivity optional at early boot
      }
    } catch (err) {
      logForDebugging(
        `[udsMessaging] idle-notify sender wire failed: ${errorMessage(err)}`,
      )
    }
    logForDebugging(
      `[udsMessaging] Listening: ${path}${opts?.isExplicit ? ' (explicit)' : ''}`,
    )
  } catch (error) {
    if (capabilityFilePath) {
      try {
        await unlink(capabilityFilePath)
      } catch {
        // Already gone.
      }
      capabilityFilePath = null
    }
    if (startedServer) {
      await closeServer(startedServer)
    }
    if (server === startedServer) {
      server = null
    }
    await removeSocketPath(path)
    if (exportedSocketEnv) {
      delete process.env.CLAUDE_CODE_MESSAGING_SOCKET
      delete process.env.CLAUDE_CODE_MESSAGING_TOKEN
    }
    socketPath = null
    defaultSocketPath = null
    authToken = null
    authRequired = false
    throw error
  }

  // Register cleanup so the socket file is removed on exit
  registerCleanup(async () => {
    await stopUdsMessaging()
  })
}

/**
 * Stop the UDS messaging server and clean up the socket file.
 */
export async function stopUdsMessaging(): Promise<void> {
  defaultSocketPath = null
  if (!server) return

  // densable: on exit, fire one peer_idle_notice (state=exited) per inbound sub.
  try {
    const { flushIdleSubscribers, setPeerIdleNoticeSender } =
      require('./udsIdleNotify.js') as typeof import('./udsIdleNotify.js')
    await flushIdleSubscribers({ state: 'exited' })
    setPeerIdleNoticeSender(null)
  } catch {
    // best-effort
  }
  try {
    const { setSendPeerReceipt } =
      require('./peerReceipts.js') as typeof import('./peerReceipts.js')
    setSendPeerReceipt(null)
  } catch {
    // optional
  }
  try {
    const { setMainLoopBecameIdleListener } =
      require('./sessionActivity.js') as typeof import('./sessionActivity.js')
    setMainLoopBecameIdleListener(null)
  } catch {
    // optional
  }
  try {
    const { updateSessionMessagingSocket } =
      require('./concurrentSessions.js') as typeof import('./concurrentSessions.js')
    void updateSessionMessagingSocket(undefined)
  } catch {
    // optional
  }

  // Close all connected clients
  for (const socket of clients) {
    socket.destroy()
  }
  clients.clear()

  await new Promise<void>(resolve => {
    server!.close(() => resolve())
  })
  server = null
  inbox.length = 0
  inboxBytes = 0
  onEnqueueCb = null

  // Remove socket file (skip on Windows — pipe paths aren't files)
  if (socketPath) {
    await removeSocketPath(socketPath)
    delete process.env.CLAUDE_CODE_MESSAGING_SOCKET
    delete process.env.CLAUDE_CODE_MESSAGING_TOKEN
    logForDebugging(
      `[udsMessaging] server stopped, socket removed: ${socketPath}`,
    )
    socketPath = null
    authToken = null
    authRequired = false
    lastStartDegradedCause = undefined
  }
  if (capabilityFilePath) {
    try {
      await unlink(capabilityFilePath)
    } catch {
      // Already gone
    }
    capabilityFilePath = null
  }
}

/**
 * Send a UDS message to a specific socket path (outbound — used when this
 * session wants to push a message to a peer's server).
 */
export async function sendUdsMessage(
  targetSocketPath: string,
  message: UdsMessage,
  opts: { authToken?: string } = {},
): Promise<void> {
  const { createConnection } = await import('net')
  const token = opts.authToken ?? authToken
  if (!token) {
    throw new Error('Cannot send UDS message without auth token')
  }
  const outbound = withRequestAuthToken(
    {
      ...message,
      from: message.from ?? socketPath ?? undefined,
      ts: message.ts ?? new Date().toISOString(),
    },
    token,
  )

  return new Promise<void>((resolve, reject) => {
    let settled = false
    let conn: ReturnType<typeof createConnection>
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      if (error) {
        conn.destroy(error)
        reject(error)
      } else {
        conn.end()
        resolve()
      }
    }

    conn = createConnection(targetSocketPath, () => {
      conn.write(jsonStringify(outbound) + '\n', err => {
        if (err) finish(err)
      })
    })
    attachUdsResponseReader(conn, {
      maxFrameBytes: MAX_UDS_FRAME_BYTES,
      acceptPong: true,
      onSettled: finish,
    })
    // Timeout so we don't hang on unreachable sockets
    conn.setTimeout(5000, () => {
      finish(new Error('Connection timed out'))
    })
  })
}
