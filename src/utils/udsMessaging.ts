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
import { unlinkSync } from 'fs'
import { createServer, type Server, type Socket } from 'net'
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  unlink,
} from 'fs/promises'
import { dirname, join, resolve, sep } from 'path'
import { tmpdir } from 'os'
import { od } from './atomicWriteOd.js'
import { registerCleanup } from './cleanupRegistry.js'
import { logForDebugging } from './debug.js'
import { errorMessage, getErrnoCode } from './errors.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../services/analytics/index.js'
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
import { p, tGn } from './overflowuidTrust.js'
import { getPlatform } from './platform.js'
import {
  getBootstrapSession,
  getBootstrapSessionHost,
  HostSlot,
  runWithSession,
} from './sessionHost.js'
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
  /** densable 2.1.239 H_a / TWd — first-line auth frame, never inbox'd. */
  | 'auth'

export type UdsMessage = {
  /** Discriminator */
  type: UdsMessageType
  /** densable H_a auth frame token (type=auth only). */
  token?: string
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
  /** Official 2.1.328 (`chunk@319503157.js @6698`) — comma-separated local hop chain. */
  local_chain?: string
}

export type UdsInboxEntry = {
  id: string
  message: UdsMessage
  receivedAt: number
  status: 'pending' | 'processed'
  /**
   * densable F$E / mli — kernel SO_PEERCRED / LOCAL_PEERPID on the accepted
   * socket. Drain copies this onto origin.verifiedPeerPid so yr htt / zo.admit
   * fire when wire `from` is omitted. Never trust a wire pid field.
   */
  peerPid?: number
  /** Official 2.1.328 (`chunk@319503157.js @6698`) — true for verified same-machine peer. */
  verifiedLocal?: boolean
  /** Populated when `countLocalHops` is true; subject to hop budget. */
  hopChain?: string[]
  /** Populated when `shouldSkipLocalHopCount` is true; exempt from hop budget. */
  fullHopChain?: string[]
}

/** Official `Pgr` (`chunk@285257860.js @972715`) — valid UDS `from` sender shape. */
const VALID_LOCAL_FROM_RE = /^[A-Za-z0-9%:_/.-]{1,300}$/
/** Official `Eus` (`chunk@285257860.js @972644`) — 24-hex hop tokens, max 32 entries. */
const LOCAL_CHAIN_RE = /^[0-9a-f]{24}(?:,[0-9a-f]{24}){0,31}$/

/**
 * Official 2.1.328 (`Qe` in `chunk@319503157.js @6698`) — classify whether an
 * inbound UDS peer message is verified-local and route its `local_chain` into
 * `fullHopChain` (exempt from hop counting when `shouldSkipLocalHopCount` is
 * true) or `hopChain` (counted when `countLocalHops` is enabled).
 */
export function classifyInboundLocalHopChain(input: {
  authRole?: 'peer' | 'child'
  from?: string
  localChain?: string
  kernelPeerPid?: number
  authRequired: boolean
  countLocalHops?: boolean
}): {
  verifiedLocal?: true
  hopChain?: string[]
  fullHopChain?: string[]
} {
  const verifiedLocal =
    input.authRole === 'peer' &&
    typeof input.from === 'string' &&
    VALID_LOCAL_FROM_RE.test(input.from) &&
    (input.kernelPeerPid !== undefined || input.authRequired)
  if (!verifiedLocal) return {}

  const parsedChain =
    typeof input.localChain === 'string' &&
    LOCAL_CHAIN_RE.test(input.localChain)
      ? input.localChain.split(',')
      : undefined
  if (parsedChain === undefined) {
    return { verifiedLocal: true }
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { shouldSkipLocalHopCount } =
    require('./udsOutboundPacer.js') as typeof import('./udsOutboundPacer.js')
  const skip = shouldSkipLocalHopCount(
    { verifiedLocal: true },
    input.countLocalHops !== undefined
      ? { countLocalHops: input.countLocalHops }
      : undefined,
  )
  return skip
    ? { verifiedLocal: true, fullHopChain: parsedChain }
    : { verifiedLocal: true, hopChain: parsedChain }
}

// ---------------------------------------------------------------------------
// Per-host module state (Official 2.1.331 HostSlot [W-110 Swn])
// ---------------------------------------------------------------------------

/**
 * Official `s().lastStartFailureCause` / wZe @201218721.
 * SEA ye() assigns bind_failed / path_refused / key_publish_failed /
 * post_bind_setup_failed. socket_dir_refused is read by wZe + Bf notice;
 * leftover ensureSocketParent is the dir-setup that names the detail.
 */
export type UdsStartFailureCause =
  | 'socket_dir_refused'
  | 'path_refused'
  | 'bind_failed'
  | 'key_publish_failed'
  | 'post_bind_setup_failed'

type UdsMessagingHostState = {
  server: Server | null
  socketPath: string | null
  onEnqueueCb: (() => void) | null
  clients: Set<Socket>
  inbox: UdsInboxEntry[]
  nextId: number
  defaultSocketPath: string | null
  authToken: string | null
  /** densable kWd.childToken — env inject / DWd "child". */
  childToken: string | null
  /** densable ykh.authRequired — `requireAuth ?? mti()` (Windows-only default). */
  authRequired: boolean
  /** densable lastStartDegradedCause — Unix key publish fail continues. */
  lastStartDegradedCause: string | undefined
  lastStartFailureCause: UdsStartFailureCause | undefined
  lastStartFailureDetail: string | undefined
  /** Official `s().startInFlight` — Wnr wrap; wZe stays silent while starting. */
  startInFlight: boolean
  capabilityFilePath: string | null
  /** Official 2.1.328 (`chunk@319503157.js @37128`): active & in-flight keyfiles unlinked synchronously on process exit. */
  activeKeyFile: string | undefined
  pendingKeyFile: string | undefined
  inboxBytes: number
  /** Official `s().firstLineDeadlineMs`. */
  firstLineDeadlineMs: number
  /** Official `s().silentDropReported` — one telemetry hit per host. */
  silentDropReported: boolean
  /** Unregister function for this host's active UDS cleanup registration. */
  cleanupUnregister: (() => void) | null
}

const udsKeyFileOwners = new Set<WeakRef<UdsMessagingHostState>>()
const liveUdsMessagingStates = new Set<WeakRef<UdsMessagingHostState>>()
let processEnvUdsOwner: WeakRef<UdsMessagingHostState> | null = null

const udsMessagingHostSlot = new HostSlot<UdsMessagingHostState>(() => ({
  server: null,
  socketPath: null,
  onEnqueueCb: null,
  clients: new Set<Socket>(),
  inbox: [],
  nextId: 1,
  defaultSocketPath: null,
  authToken: null,
  childToken: null,
  authRequired: false,
  lastStartDegradedCause: undefined,
  lastStartFailureCause: undefined,
  lastStartFailureDetail: undefined,
  startInFlight: false,
  capabilityFilePath: null,
  activeKeyFile: undefined,
  pendingKeyFile: undefined,
  inboxBytes: 0,
  firstLineDeadlineMs: UDS_FIRST_LINE_DEADLINE_MS,
  silentDropReported: false,
  cleanupUnregister: null,
}))

function getUdsState(): UdsMessagingHostState {
  return udsMessagingHostSlot.of(getBootstrapSessionHost())
}

function registerLiveUdsState(state: UdsMessagingHostState): void {
  for (const ref of liveUdsMessagingStates) {
    const owner = ref.deref()
    if (owner === undefined) {
      liveUdsMessagingStates.delete(ref)
    } else if (owner === state) {
      return
    }
  }
  liveUdsMessagingStates.add(new WeakRef(state))
}

function unregisterLiveUdsState(state: UdsMessagingHostState): void {
  for (const ref of liveUdsMessagingStates) {
    const owner = ref.deref()
    if (owner === undefined || owner === state) {
      liveUdsMessagingStates.delete(ref)
    }
  }
}

function findSurvivingLiveUdsState(
  exclude: UdsMessagingHostState,
): UdsMessagingHostState | undefined {
  for (const ref of liveUdsMessagingStates) {
    const owner = ref.deref()
    if (owner === undefined) {
      liveUdsMessagingStates.delete(ref)
      continue
    }
    if (
      owner !== exclude &&
      owner.server !== null &&
      owner.socketPath !== null
    ) {
      return owner
    }
  }
  return undefined
}

function claimProcessEnvUdsOwnershipIfUnowned(
  state: UdsMessagingHostState,
  socketPath: string,
  childToken: string,
): boolean {
  const currentOwner = processEnvUdsOwner?.deref()
  if (
    currentOwner !== undefined &&
    currentOwner !== state &&
    currentOwner.server !== null &&
    currentOwner.socketPath !== null &&
    process.env.CLAUDE_CODE_MESSAGING_SOCKET === currentOwner.socketPath
  ) {
    return false
  }
  process.env.CLAUDE_CODE_MESSAGING_SOCKET = socketPath
  process.env.CLAUDE_CODE_MESSAGING_TOKEN = childToken
  processEnvUdsOwner = new WeakRef(state)
  return true
}

function releaseProcessEnvUdsOwnership(
  state: UdsMessagingHostState,
  stoppedSocketPath: string,
  stoppedChildToken: string | null,
): void {
  const ownedSocket =
    process.env.CLAUDE_CODE_MESSAGING_SOCKET === stoppedSocketPath
  const ownedToken =
    stoppedChildToken !== null &&
    process.env.CLAUDE_CODE_MESSAGING_TOKEN === stoppedChildToken
  if (processEnvUdsOwner?.deref() === state) {
    processEnvUdsOwner = null
  }
  if (!ownedSocket && !ownedToken) {
    return
  }
  const survivor = findSurvivingLiveUdsState(state)
  if (survivor !== undefined && survivor.socketPath !== null) {
    if (ownedSocket) {
      process.env.CLAUDE_CODE_MESSAGING_SOCKET = survivor.socketPath
    }
    if (ownedToken) {
      if (survivor.childToken !== null) {
        process.env.CLAUDE_CODE_MESSAGING_TOKEN = survivor.childToken
      } else {
        delete process.env.CLAUDE_CODE_MESSAGING_TOKEN
      }
    }
    processEnvUdsOwner = new WeakRef(survivor)
    return
  }
  if (ownedSocket) {
    delete process.env.CLAUDE_CODE_MESSAGING_SOCKET
  }
  if (ownedToken) {
    delete process.env.CLAUDE_CODE_MESSAGING_TOKEN
  }
}

function trackKeyFileOwner(state: UdsMessagingHostState): void {
  for (const ref of udsKeyFileOwners) {
    const owner = ref.deref()
    if (owner === undefined) {
      udsKeyFileOwners.delete(ref)
    } else if (owner === state) {
      return
    }
  }
  udsKeyFileOwners.add(new WeakRef(state))
}

/** Official `hn()` (`chunk@319503157.js @37128`) — register synchronous process exit handler once. */
function registerKeyFileExitCleanup(state: UdsMessagingHostState): void {
  trackKeyFileOwner(state)
  if (!process.listeners('exit').includes(unlinkUdsKeyFilesOnExit)) {
    process.on('exit', unlinkUdsKeyFilesOnExit)
  }
}

/**
 * Official `tta()` (`chunk@319503157.js @37140`) — synchronously unlink any
 * active or pending UDS messaging keyfile when the process exits abruptly.
 */
export function unlinkUdsKeyFilesOnExit(): void {
  try {
    const files = new Set<string>()
    for (const ref of udsKeyFileOwners) {
      const owner = ref.deref()
      if (owner === undefined) {
        udsKeyFileOwners.delete(ref)
        continue
      }
      if (owner.activeKeyFile !== undefined) files.add(owner.activeKeyFile)
      if (owner.pendingKeyFile !== undefined) files.add(owner.pendingKeyFile)
    }
    const current = udsMessagingHostSlot.peek(getBootstrapSessionHost())
    if (current !== undefined) {
      if (current.activeKeyFile !== undefined) files.add(current.activeKeyFile)
      if (current.pendingKeyFile !== undefined)
        files.add(current.pendingKeyFile)
    }
    for (const file of files) {
      try {
        unlinkSync(file)
      } catch {
        // already gone or inaccessible
      }
    }
  } catch {
    // best-effort synchronous cleanup on process exit
  }
}

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
/**
 * Official `bn` / `firstLineDeadlineMs` default — changelog 2.1.243 #57:
 * close a connection that sends no complete line within 30 seconds.
 */
export const UDS_FIRST_LINE_DEADLINE_MS = 30_000
/** @deprecated Official It() is first-complete-line, not idle-on-any-data. */
export const UDS_IDLE_TIMEOUT_MS = UDS_FIRST_LINE_DEADLINE_MS

/**
 * Official `In` — hint when the sockets path cannot be used.
 */
export const UDS_SOCKETS_PATH_HINT =
  'Point XDG_RUNTIME_DIR or CLAUDE_CODE_TMPDIR at a private (0700) directory you own to use a different location.'

/** Official `Vi`. */
export const UDS_SOCKETS_PATH_NOT_A_DIRECTORY = `A component of the sockets path is not a directory (a regular file is in the way). ${UDS_SOCKETS_PATH_HINT}`

/** Official `qi`. */
export const UDS_SOCKETS_PATH_SYMLINK_LOOP = `The sockets path runs through a symlink loop. ${UDS_SOCKETS_PATH_HINT}`

/**
 * Official `cn` — Re() `uid_collapse` @198268400.
 * UDS sockets-dir copy (mentions --messaging-socket-path). ≠ daemon `tsn`.
 */
export const UDS_SOCKETS_UID_COLLAPSE =
  'This process runs in a user namespace without a uid mapping (its own uid reads as the kernel overflow uid), so file ownership cannot be verified. Start it with a uid map (e.g. `unshare -Ur` / `--map-current-user`), or pass --messaging-socket-path.'

/**
 * Official Re() `directory_rule` @198268400.
 * Thrown when leftover ancestor walk fails gold `p()` @198269713.
 */
export const UDS_SOCKETS_DIRECTORY_RULE = `A directory on the sockets path is shared (world- or group-writable without the sticky bit, e.g. a container volume mounted at /tmp) or not owned by you or root. ${UDS_SOCKETS_PATH_HINT}`

/** Official wZe host snapshot (uFe / s()). */
export type UdsStartFailureSnapshot = {
  startInFlight?: boolean
  activeSocketPath?: string
  lastStartFailureCause?: UdsStartFailureCause
  lastStartFailureDetail?: string
}

/**
 * Official `wZe` @201218721 sha=bf7e3df16fb2603b.
 * Gold: interpolates lastStartFailureDetail on socket_dir_refused.
 */
export function formatUdsStartFailureReason(
  e: UdsStartFailureSnapshot,
): string | undefined {
  if (e.startInFlight || e.activeSocketPath !== undefined) return
  switch (e.lastStartFailureCause) {
    case 'socket_dir_refused':
      return e.lastStartFailureDetail !== undefined
        ? `its socket directory could not be set up: ${e.lastStartFailureDetail}`
        : 'its socket directory could not be set up'
    case 'path_refused':
      return 'its socket path is not a usable local address'
    case 'bind_failed':
      return 'it could not be started'
    case 'key_publish_failed':
      return 'its peer key could not be published'
    case 'post_bind_setup_failed':
      return 'setting it up after bind failed'
    case undefined:
      return
  }
}

/** Official `Kmr`. */
export function getUdsStartFailureCause(): UdsStartFailureCause | undefined {
  return getUdsState().lastStartFailureCause
}

/** Official `r0t` — `return wZe(s())`. */
export function getUdsStartFailureReason(): string | undefined {
  const state = getUdsState()
  return formatUdsStartFailureReason({
    startInFlight: state.startInFlight,
    activeSocketPath: state.socketPath ?? undefined,
    lastStartFailureCause: state.lastStartFailureCause,
    lastStartFailureDetail: state.lastStartFailureDetail,
  })
}

/** Official `s().lastStartFailureDetail` — named by socket-dir setup. */
export function getUdsStartFailureDetail(): string | undefined {
  return getUdsState().lastStartFailureDetail
}

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

/** densable TWd / R_a — 16 bytes → 32 hex. */
const UDS_AUTH_TYPE = 'auth' as const
const UDS_PEER_TOKEN_BYTES = 16

/**
 * densable H_a — NDJSON auth preamble: `He({type:"auth",token})+"\n"`.
 * Official cmp prefixes the payload with this line when IWd found a token.
 */
export function serializeUdsAuthFrame(token: string): string {
  return jsonStringify({ type: UDS_AUTH_TYPE, token }) + '\n'
}

/** densable PWd */
export function isUdsAuthFrame(
  value: unknown,
): value is { type: 'auth'; token: unknown } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    (value as { type: unknown }).type === UDS_AUTH_TYPE
  )
}

function timingSafeTokenEqual(
  provided: string,
  expected: string | null | undefined,
): boolean {
  if (!expected) return false
  const a = Buffer.from(provided, 'utf8')
  const b = Buffer.from(expected, 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/**
 * densable DWd — classify an auth-frame token against active peer/child.
 */
export function classifyUdsAuthToken(
  token: unknown,
  tokens?: { peerToken?: string | null; childToken?: string | null },
): 'peer' | 'child' | undefined {
  if (tokens === undefined || typeof token !== 'string') return undefined
  if (timingSafeTokenEqual(token, tokens.peerToken)) return 'peer'
  if (timingSafeTokenEqual(token, tokens.childToken)) return 'child'
  return undefined
}

/** densable HWd — `H_a("0".repeat(R_a*2)).length` */
export const UDS_AUTH_FRAME_SIZE = serializeUdsAuthFrame(
  '0'.repeat(UDS_PEER_TOKEN_BYTES * 2),
).length

/**
 * densable lmp — refuse when auth-frame reserve + JSON + newline exceeds X1r.
 * Official always counts HWd even when the send omits the auth line.
 */
export function assertUdsPayloadUnderLineCap(serializedJson: string): void {
  const chars = UDS_AUTH_FRAME_SIZE + serializedJson.length + 1
  if (chars > MAX_UDS_LINE_CHARS) {
    throw new UdsMessageTooLargeError(chars, MAX_UDS_LINE_CHARS)
  }
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
      `[uds-messaging] Socket path too long (${byteLength} bytes, max ~${MAX_UNIX_SOCKET_PATH_LENGTH}): ${path}. Try a shorter --messaging-socket-path, or set CLAUDE_CODE_TMPDIR or $XDG_RUNTIME_DIR to a shorter directory.`,
    )
  }
}

/**
 * Official runtime root for default Unix sockets: XDG_RUNTIME_DIR, then
 * CLAUDE_CODE_TMPDIR, then os.tmpdir(). Userns/rootless own XDG_RUNTIME_DIR.
 */
export function getUdsRuntimeDir(): string {
  return (
    process.env.XDG_RUNTIME_DIR || process.env.CLAUDE_CODE_TMPDIR || tmpdir()
  )
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
  const state = getUdsState()
  if (state.defaultSocketPath) return state.defaultSocketPath
  const nonce = randomBytes(8).toString('hex')
  if (process.platform === 'win32') {
    state.defaultSocketPath = `\\\\.\\pipe\\claude-code-${process.pid}-${nonce}`
    return state.defaultSocketPath
  }

  state.defaultSocketPath = join(
    getUdsRuntimeDir(),
    'cc-socks',
    `${process.pid}-${nonce}`,
    'messaging.sock',
  )
  assertValidUnixSocketPath(state.defaultSocketPath)
  return state.defaultSocketPath
}

/**
 * Returns the socket path of the currently running server, or undefined
 * if the server has not been started.
 */
export function getUdsMessagingSocketPath(): string | undefined {
  return getUdsState().socketPath ?? undefined
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

/**
 * Official Re() kinds leftover already throws as the message itself
 * (Vi / qi / cn / directory_rule / foreign_owner→V).
 */
function isOfficialSocketsDirRefuse(error: unknown): error is Error {
  return (
    error instanceof Error &&
    (error.message === UDS_SOCKETS_PATH_NOT_A_DIRECTORY ||
      error.message === UDS_SOCKETS_PATH_SYMLINK_LOOP ||
      error.message === UDS_SOCKETS_UID_COLLAPSE ||
      error.message === UDS_SOCKETS_DIRECTORY_RULE ||
      error.message === UDS_SOCKETS_PATH_HINT)
  )
}

/**
 * Official leftover dir walk + 248 Ce() overflowuid vet @198269713:
 * `r=await tGn()` then `r?.uidCollapses` → uid_collapse (`cn`).
 * Ancestor owner via gold `p()` (root-equivalent only on eGn dirs).
 * Does not rewrite official `C()` symlink/inode walker. Leaf 0700/owner
 * stays leftover `assertPrivateDirectory` (`s()`, not `p()`).
 */
async function walkSocketsPathComponents(dir: string): Promise<void> {
  const uid = process.getuid?.()
  const snap = await tGn()
  if (snap?.uidCollapses) {
    throw new Error(UDS_SOCKETS_UID_COLLAPSE)
  }

  const resolved = resolve(dir)
  const parts = resolved.split(/[\\/]+/).filter(part => part.length > 0)
  if (parts.length === 0) return

  let acc = process.platform === 'win32' ? `${parts[0]}${sep}` : sep
  const start = process.platform === 'win32' ? 1 : 0
  for (let i = start; i < parts.length; i++) {
    acc = join(acc, parts[i]!)
    try {
      const stat = await lstat(acc)
      if (stat.isSymbolicLink()) {
        let resolvedLink: string | undefined
        try {
          resolvedLink = await realpath(acc)
        } catch (error) {
          if (getErrnoCode(error) === 'ELOOP') {
            throw new Error(UDS_SOCKETS_PATH_SYMLINK_LOOP)
          }
          throw error
        }
        if (!p(Number(stat.uid), false, resolvedLink, uid, snap)) {
          throw new Error(UDS_SOCKETS_PATH_HINT)
        }
      } else if (stat.isFile() || !stat.isDirectory()) {
        throw new Error(UDS_SOCKETS_PATH_NOT_A_DIRECTORY)
      } else if (!p(Number(stat.uid), false, acc, uid, snap)) {
        throw new Error(UDS_SOCKETS_DIRECTORY_RULE)
      }
    } catch (error) {
      if (isOfficialSocketsDirRefuse(error)) {
        throw error
      }
      const code = getErrnoCode(error)
      if (code === 'ENOENT') continue
      if (code === 'ELOOP') throw new Error(UDS_SOCKETS_PATH_SYMLINK_LOOP)
      if (code === 'ENOTDIR') throw new Error(UDS_SOCKETS_PATH_NOT_A_DIRECTORY)
      throw error
    }
  }
}

async function ensureSocketParent(path: string): Promise<void> {
  const dir = dirname(path)
  try {
    await walkSocketsPathComponents(dir)
    try {
      const stat = await lstat(dir)
      if (stat.isFile() || (!stat.isDirectory() && !stat.isSymbolicLink())) {
        throw new Error(UDS_SOCKETS_PATH_NOT_A_DIRECTORY)
      }
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
    if (isOfficialSocketsDirRefuse(error)) {
      throw error
    }
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
  state: UdsMessagingHostState = getUdsState(),
): Promise<void> {
  const dir = getSessionsDir()
  await mkdir(dir, { recursive: true, mode: 0o700 })
  await sweepDeadMessagingKeyTmps(dir, sweepPermitted)
  const target = join(dir, deriveMessagingKeyName(process.pid, socket))
  // Official 2.1.328 (`chunk@319503157.js @31385`): track pendingKeyFile and arm
  // synchronous exit cleanup BEFORE publishing the keyfile.
  state.pendingKeyFile = target
  registerKeyFileExitCleanup(state)
  try {
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
    state.capabilityFilePath = target
    state.activeKeyFile = target
  } finally {
    state.pendingKeyFile = undefined
  }
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
  getUdsState().onEnqueueCb = cb
}

/**
 * Drain all pending inbox messages and release retained history.
 */
export function drainInbox(): UdsInboxEntry[] {
  const state = getUdsState()
  const pending = state.inbox.splice(0, state.inbox.length)
  state.inboxBytes = 0
  for (const entry of pending) {
    entry.status = 'processed'
  }
  return pending
}

function getMessageBytes(message: UdsMessage): number {
  return Buffer.byteLength(jsonStringify(message), 'utf8')
}

function enqueueInboxEntry(
  entry: UdsInboxEntry,
  state: UdsMessagingHostState = getUdsState(),
): boolean {
  const entryBytes = getMessageBytes(entry.message)
  if (
    entryBytes > MAX_UDS_LINE_BYTES ||
    state.inbox.length >= MAX_UDS_INBOX_ENTRIES ||
    state.inboxBytes + entryBytes > MAX_UDS_INBOX_BYTES
  ) {
    logError(
      new Error(
        `[udsMessaging] inbox full (${state.inbox.length}/${MAX_UDS_INBOX_ENTRIES}, ${state.inboxBytes}/${MAX_UDS_INBOX_BYTES} bytes); dropping message type=${entry.message.type}`,
      ),
    )
    return false
  }
  state.inbox.push(entry)
  state.inboxBytes += entryBytes
  return true
}

function ensureAuthTokens(state: UdsMessagingHostState = getUdsState()): {
  peerToken: string
  childToken: string
} {
  if (!state.authToken) {
    // densable 2.1.239 R_a=16 → xYb 32 hex. kWd: peer + child.
    state.authToken = randomBytes(UDS_PEER_TOKEN_BYTES).toString('hex')
  }
  if (!state.childToken) {
    state.childToken = randomBytes(UDS_PEER_TOKEN_BYTES).toString('hex')
  }
  return { peerToken: state.authToken, childToken: state.childToken }
}

function ensureAuthToken(): string {
  return ensureAuthTokens().peerToken
}

function getMessageAuthToken(message: UdsMessage): string | undefined {
  const token = message.meta?.authToken
  return typeof token === 'string' ? token : undefined
}

function isAuthorizedMessage(
  message: UdsMessage,
  state: UdsMessagingHostState = getUdsState(),
): boolean {
  // Official F$E: drop missing/bad auth only when authRequired (mti/Windows).
  if (!state.authRequired) return true
  const provided = getMessageAuthToken(message)
  if (!provided || !state.authToken) return false
  const providedBuffer = Buffer.from(provided, 'utf8')
  const expectedBuffer = Buffer.from(state.authToken, 'utf8')
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

function isWindowsNamedPipePath(path: string): boolean {
  return (
    process.platform === 'win32' &&
    parseWindowsNamedPipeName(path) !== undefined
  )
}

async function removeSocketPath(path: string): Promise<void> {
  if (isWindowsNamedPipePath(path)) return
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
  return getUdsState().lastStartDegradedCause
}

export async function startUdsMessaging(
  path: string,
  opts?: {
    isExplicit?: boolean
    requireAuth?: boolean
    firstLineDeadlineMs?: number
  },
): Promise<void> {
  const state = getUdsState()
  if (state.server) {
    logForDebugging('[udsMessaging] server already running, skipping start')
    return
  }

  // Official Wnr: startInFlight wrap. ye() stamps bind_failed first.
  state.startInFlight = true
  state.lastStartFailureCause = 'bind_failed'
  state.lastStartFailureDetail = undefined
  try {
    await startUdsMessagingBody(path, opts, state)
  } finally {
    state.startInFlight = false
  }
}

async function startUdsMessagingBody(
  path: string,
  opts?: {
    isExplicit?: boolean
    requireAuth?: boolean
    firstLineDeadlineMs?: number
  },
  state: UdsMessagingHostState = getUdsState(),
): Promise<void> {
  assertValidUnixSocketPath(path)
  const sessionRef = new WeakRef(getBootstrapSession().root)
  const stateRef = new WeakRef(state)
  const runInCapturedSession = <T>(fn: () => T): T | undefined => {
    const targetSession = sessionRef.deref()
    if (targetSession === undefined) {
      return undefined
    }
    return runWithSession(targetSession, fn)
  }

  // Ensure parent directory exists (skip only for Windows named pipes).
  // Official leftover dir walk (Tn / Un / refuse-to-bind) names lastStartFailureDetail.
  if (!isWindowsNamedPipePath(path)) {
    try {
      await ensureSocketParent(path)
    } catch (error) {
      state.lastStartFailureCause = 'socket_dir_refused'
      state.lastStartFailureDetail =
        error instanceof Error ? error.message : String(error)
      throw error
    }
  }

  // Clean up stale socket file (skip only for Windows named pipes).
  if (!isWindowsNamedPipePath(path)) {
    try {
      await unlink(path)
    } catch {
      // ENOENT is fine
    }
  }

  const tokens = ensureAuthTokens(state)
  const token = tokens.peerToken
  // Official Ckh: authRequired = t.requireAuth ?? mti()
  state.authRequired = opts?.requireAuth ?? isMessagingLiveOwnerRequired()
  // Official `s().firstLineDeadlineMs = n.firstLineDeadlineMs ?? bn`
  state.firstLineDeadlineMs =
    opts?.firstLineDeadlineMs ?? UDS_FIRST_LINE_DEADLINE_MS
  state.lastStartDegradedCause = undefined
  let startedServer: Server | null = null
  let exportedSocketEnv = false
  let stampedHopAddress = false
  try {
    await new Promise<void>((resolve, reject) => {
      const srv = createServer(socket => {
        const targetSession = sessionRef.deref()
        if (targetSession === undefined) {
          socket.destroy()
          return
        }
        runWithSession(targetSession, () => {
          if (state.clients.size >= MAX_UDS_CLIENTS) {
            logForDebugging(
              `[udsMessaging] rejected client: ${state.clients.size}/${MAX_UDS_CLIENTS} clients already connected`,
            )
            socket.destroy()
            return
          }
          state.clients.add(socket)
          logForDebugging(
            `[udsMessaging] client connected (total: ${state.clients.size})`,
          )
          // densable F$E mli — stamp once per accepted socket, not per frame.
          let kernelPeerPid: number | undefined
          try {
            const { readConnectedPeerPid } =
              require('./udsClient.js') as typeof import('./udsClient.js')
            kernelPeerPid = readConnectedPeerPid(socket)
          } catch {
            kernelPeerPid = undefined
          }
          let authenticated = !state.authRequired
          /** densable F$E `a` — DWd role after first-line H_a. */
          let authRole: 'peer' | 'child' | undefined
          let sawFirstLine = false
          let closing = false
          const closeWithError = (data: string): void => {
            if (closing || socket.destroyed) return
            closing = true
            socket.pause()
            writeSocketErrorAndDestroy(socket, data)
          }
          const authTimer = state.authRequired
            ? setTimeout(() => {
                const liveSession = sessionRef.deref()
                if (liveSession === undefined) {
                  if (!authenticated && !socket.destroyed) {
                    closeWithError('authentication timeout')
                  }
                  return
                }
                runWithSession(liveSession, () => {
                  if (authenticated || socket.destroyed) return
                  logForDebugging(
                    '[udsMessaging] closing unauthenticated idle client',
                  )
                  closeWithError('authentication timeout')
                })
              }, UDS_AUTH_TIMEOUT_MS)
            : undefined
          if (authTimer !== undefined) unrefTimer(authTimer)
          // Official It() — first complete line (including a blank line) clears
          // the deadline. Not Node socket.setTimeout idle-on-any-data.
          const deadlineMs = state.firstLineDeadlineMs
          let firstLineTimer: ReturnType<typeof setTimeout> | undefined =
            setTimeout(() => {
              firstLineTimer = undefined
              const liveSession = sessionRef.deref()
              if (liveSession === undefined) {
                if (!socket.destroyed) socket.destroy()
                return
              }
              runWithSession(liveSession, () => {
                try {
                  logForDebugging(
                    `[uds-messaging] Closing a connection that sent no complete line within ${deadlineMs} ms`,
                  )
                  if (!state.silentDropReported) {
                    state.silentDropReported = true
                    logEvent('cross_session_inbox_auth', {
                      reason:
                        'silent_connection_deadline' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                    })
                  }
                  socket.destroy()
                } catch (error) {
                  logForDebugging(
                    `[uds-messaging] Failed to close a silent connection: ${error}`,
                    { level: 'warn' },
                  )
                }
              })
            }, deadlineMs)
          unrefTimer(firstLineTimer)
          const clearFirstLineDeadline = (): void => {
            if (firstLineTimer !== undefined) {
              clearTimeout(firstLineTimer)
              firstLineTimer = undefined
            }
          }
          socket.once('close', clearFirstLineDeadline)
          socket.once('error', clearFirstLineDeadline)
          const onDataForDeadline = (chunk: Buffer | string): void => {
            const hasNewline =
              typeof chunk === 'string'
                ? chunk.includes('\n')
                : chunk.includes(0x0a)
            if (hasNewline) {
              clearFirstLineDeadline()
              socket.off('data', onDataForDeadline)
            }
          }
          socket.on('data', onDataForDeadline)

          attachNdjsonFramer<UdsMessage>(
            socket,
            msg => {
              const liveSession = sessionRef.deref()
              if (liveSession === undefined) {
                if (!socket.destroyed) socket.destroy()
                return
              }
              runWithSession(liveSession, () => {
                const first = !sawFirstLine
                sawFirstLine = true
                // densable F$E: first PWd frame is DWd; never inbox'd.
                if (isUdsAuthFrame(msg)) {
                  if (first) {
                    authRole = classifyUdsAuthToken(msg.token, {
                      peerToken: state.authToken,
                      childToken: state.childToken,
                    })
                    if (authRole !== undefined) {
                      authenticated = true
                      if (authTimer !== undefined) clearTimeout(authTimer)
                    } else if (state.authRequired) {
                      logForDebugging(
                        '[udsMessaging] rejected a bad auth frame',
                      )
                      closeWithError('unauthorized')
                    }
                  }
                  return
                }
                if (state.authRequired && authRole === undefined) {
                  // Official: no successful auth frame → drop the line.
                  // Local leftover: still accept meta.authToken (pre-H_a inject).
                  if (!isAuthorizedMessage(msg, state)) {
                    logForDebugging(
                      `[udsMessaging] rejected unauthenticated message type=${msg.type}`,
                    )
                    closeWithError('unauthorized')
                    return
                  }
                }
                if (!authenticated) {
                  authenticated = true
                  if (authTimer !== undefined) clearTimeout(authTimer)
                }

                // Handle ping with automatic pong
                if (msg.type === 'ping') {
                  writeSocketMessage(socket, {
                    type: 'pong',
                    from: state.socketPath ?? undefined,
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
                      state.socketPath ?? undefined,
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
                const localHopMeta = classifyInboundLocalHopChain({
                  authRole,
                  from: sanitizedMessage.from,
                  localChain: sanitizedMessage.local_chain,
                  kernelPeerPid,
                  authRequired: state.authRequired,
                })
                const entry: UdsInboxEntry = {
                  id: `uds-${state.nextId++}`,
                  message: sanitizedMessage,
                  receivedAt: Date.now(),
                  status: 'pending',
                  ...(kernelPeerPid !== undefined
                    ? { peerPid: kernelPeerPid }
                    : {}),
                  ...localHopMeta,
                }
                if (!enqueueInboxEntry(entry, state)) {
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
                          await runInCapturedSession(async () => {
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
                          })
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
                state.onEnqueueCb?.()
              })
            },
            text => jsonParse(text) as UdsMessage,
            {
              // densable X1r / BUt — gold recv counts JS string `.length` after
              // utf8 (chars, not bytes). Byte budget stays a UTF-8 backstop.
              // Do not socket.setEncoding('utf8') — framer expects Buffer.
              maxFrameBytes: MAX_UDS_LINE_BYTES,
              maxFrameChars: MAX_UDS_LINE_CHARS,
              onFrameError: () => {
                // densable recv drop: log + destroy (no silent tool success).
                logForDebugging(
                  `[uds-messaging] Line exceeded ${MAX_UDS_LINE_CHARS} chars; dropping connection`,
                  { level: 'warn' },
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
            clearFirstLineDeadline()
            state.clients.delete(socket)
          })

          socket.on('error', err => {
            if (authTimer !== undefined) clearTimeout(authTimer)
            clearFirstLineDeadline()
            state.clients.delete(socket)
            logForDebugging(`[udsMessaging] client error: ${errorMessage(err)}`)
          })
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
            state.server = srv
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
      await writeCapabilityFile(
        path,
        token,
        {
          sweepPermitted: await isRegistrySweepPermitted(),
        },
        state,
      )
    } catch (publishErr) {
      const detail =
        publishErr instanceof Error ? publishErr.message : String(publishErr)
      if (state.authRequired) {
        logForDebugging(
          `[uds-messaging] Failed to publish the inbox auth key (refusing to run an inbox no peer can authenticate to): ${detail}`,
        )
        const err = new Error(
          `[uds-messaging] Failed to publish the inbox auth key (refusing to run an inbox no peer can authenticate to): ${detail}`,
        )
        ;(err as Error & { code?: string }).code = 'key_publish_failed'
        state.lastStartFailureCause = 'key_publish_failed'
        throw err
      }
      logForDebugging(
        `[uds-messaging] Failed to publish the inbox auth key; peers will send unauthenticated (accepted: auth is optional on this platform): ${detail}`,
      )
      state.lastStartDegradedCause = 'key_publish_failed'
    }
    state.socketPath = path
    registerLiveUdsState(state)
    // Export so child processes can discover the socket only after the
    // capability file exists and the listener is ready. If another live UDS
    // host already owns process.env, keep that owner intact.
    // densable Ckh: CLAUDE_CODE_MESSAGING_TOKEN is kWd.childToken (DWd "child").
    // peerToken stays in the capability file / IWd. Do not invent a non-env path.
    exportedSocketEnv = claimProcessEnvUdsOwnershipIfUnowned(
      state,
      path,
      tokens.childToken,
    )
    // densable q2r(EW(e)) — stamp own hop token for K2r hop-loop.
    try {
      const { setOwnUdsHopAddress } =
        require('./peerAdmission.js') as typeof import('./peerAdmission.js')
      setOwnUdsHopAddress(formatUdsAddress(path))
      stampedHopAddress = true
    } catch {
      // peerAdmission optional at early boot / tests
    }
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
          runInCapturedSession(() => {
            void flushIdleSubscribers({ state: 'idle' })
          })
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
    logForDebugging(
      `[uds-messaging] Connect when the data is ready (run the command first, then connect and write its output as ONE line, as in the node recipe above): a connection that sends no complete line within ${state.firstLineDeadlineMs} ms is closed`,
      { level: 'info' },
    )
    // Official ye(): lastStartFailureCause=void 0 after listen succeeds.
    state.lastStartFailureCause = undefined
    state.lastStartFailureDetail = undefined
  } catch (error) {
    unregisterLiveUdsState(state)
    if (state.capabilityFilePath) {
      try {
        await unlink(state.capabilityFilePath)
      } catch {
        // Already gone.
      }
      state.capabilityFilePath = null
    }
    state.activeKeyFile = undefined
    state.pendingKeyFile = undefined
    if (startedServer) {
      await closeServer(startedServer)
    }
    if (state.server === startedServer) {
      state.server = null
    }
    await removeSocketPath(path)
    if (exportedSocketEnv) {
      releaseProcessEnvUdsOwnership(state, path, tokens.childToken)
    }
    if (stampedHopAddress) {
      try {
        const { setOwnUdsHopAddress } =
          require('./peerAdmission.js') as typeof import('./peerAdmission.js')
        setOwnUdsHopAddress(undefined)
      } catch {
        // optional
      }
    }
    state.socketPath = null
    state.defaultSocketPath = null
    state.authToken = null
    state.childToken = null
    state.authRequired = false
    const code = (error as { code?: string }).code
    if (code === 'key_publish_failed') {
      state.lastStartFailureCause = 'key_publish_failed'
    } else if (startedServer && state.lastStartFailureCause === 'bind_failed') {
      state.lastStartFailureCause = 'post_bind_setup_failed'
    }
    logForDebugging(`[uds-messaging] Failed to start: ${error}`, {
      level: 'error',
    })
    throw error
  }

  // Register cleanup so the socket file is removed on exit.
  // If the captured root session is still alive, re-enter its ALS context and
  // call stopUdsMessaging(). If the session was GC'd, close the orphaned state
  // directly without touching the default bootstrap host.
  state.cleanupUnregister?.()
  state.cleanupUnregister = registerCleanup(() =>
    cleanupCapturedUdsSession(sessionRef, stateRef),
  )
}

type WeakRefLike<T extends object> = {
  deref(): T | undefined
}

async function cleanupCapturedUdsSession(
  sessionRef: WeakRefLike<ReturnType<typeof getBootstrapSession>>,
  stateRef: WeakRefLike<UdsMessagingHostState>,
): Promise<void> {
  const targetSession = sessionRef.deref()
  if (targetSession !== undefined) {
    await runWithSession(targetSession, () => stopUdsMessaging())
    return
  }
  const deadState = stateRef.deref()
  if (deadState !== undefined) {
    await stopUdsMessagingState(deadState, { detachHostCallbacks: false })
  }
}

async function stopUdsMessagingState(
  state: UdsMessagingHostState,
  opts: { detachHostCallbacks: boolean },
): Promise<void> {
  state.defaultSocketPath = null
  const unregisterCleanup = state.cleanupUnregister
  state.cleanupUnregister = null
  unregisterCleanup?.()
  if (!state.server) return

  unregisterLiveUdsState(state)

  if (opts.detachHostCallbacks) {
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
  }

  // Close all connected clients
  for (const socket of state.clients) {
    socket.destroy()
  }
  state.clients.clear()

  const activeServer = state.server
  await new Promise<void>(resolve => {
    activeServer.close(() => resolve())
  })
  state.server = null
  state.inbox.length = 0
  state.inboxBytes = 0
  state.onEnqueueCb = null

  // Remove socket file (skip on Windows — pipe paths aren't files)
  if (state.socketPath) {
    const stoppedSocketPath = state.socketPath
    const stoppedChildToken = state.childToken
    state.socketPath = null
    state.authToken = null
    state.childToken = null
    state.authRequired = false
    state.lastStartDegradedCause = undefined
    await removeSocketPath(stoppedSocketPath)
    releaseProcessEnvUdsOwnership(state, stoppedSocketPath, stoppedChildToken)
    if (opts.detachHostCallbacks) {
      try {
        const { setOwnUdsHopAddress } =
          require('./peerAdmission.js') as typeof import('./peerAdmission.js')
        setOwnUdsHopAddress(undefined)
      } catch {
        // optional
      }
    }
    logForDebugging(
      `[udsMessaging] server stopped, socket removed: ${stoppedSocketPath}`,
    )
  }
  if (state.capabilityFilePath) {
    try {
      await unlink(state.capabilityFilePath)
    } catch {
      // Already gone
    }
    state.capabilityFilePath = null
  }
  state.activeKeyFile = undefined
  state.pendingKeyFile = undefined
}

/**
 * Stop the UDS messaging server and clean up the socket file.
 */
export async function stopUdsMessaging(): Promise<void> {
  await stopUdsMessagingState(getUdsState(), { detachHostCallbacks: true })
}

/**
 * Test-only helper that exercises the dead-sessionRef cleanup path in
 * `cleanupCapturedUdsSession` deterministically without relying on GC timing.
 */
export async function _runUdsDeadSessionCleanupForTests(
  host: object,
): Promise<void> {
  const deadState = udsMessagingHostSlot.peek(host)
  if (deadState === undefined) return
  await cleanupCapturedUdsSession(
    { deref: () => undefined },
    new WeakRef(deadState),
  )
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
  const state = getUdsState()
  const { createConnection } = await import('net')
  // densable cmp: IWd(target) peerToken, then H_a prefix. Own token is fallback
  // for same-process sends before the key file is visible.
  const cap = await resolveMessagingCapability(targetSocketPath)
  const token =
    opts.authToken ??
    (cap.kind === 'token' ? cap.token : undefined) ??
    state.authToken
  if (!token) {
    throw new Error('Cannot send UDS message without auth token')
  }
  const outbound: UdsMessage = {
    ...message,
    from: message.from ?? state.socketPath ?? undefined,
    ts: message.ts ?? new Date().toISOString(),
  }
  const payload = jsonStringify(outbound)
  assertUdsPayloadUnderLineCap(payload)
  // densable cmp: `c+i+\n` — auth frame then message JSON.
  const wire = serializeUdsAuthFrame(token) + payload + '\n'

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
      conn.write(wire, err => {
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
