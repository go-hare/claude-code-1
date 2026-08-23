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
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  unlink,
} from 'fs/promises'
import { dirname, join } from 'path'
import { tmpdir } from 'os'
import { registerCleanup } from './cleanupRegistry.js'
import { logForDebugging } from './debug.js'
import { errorMessage } from './errors.js'
import { getClaudeConfigHomeDir } from './envUtils.js'
import { attachNdjsonFramer } from './ndjsonFramer.js'
import { attachUdsResponseReader } from './udsResponseReader.js'
import { logError } from './log.js'
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

/** densable hbr — extract named-pipe leaf from `\\.\pipe\name` / `//?/pipe/name`. */
export function parseWindowsNamedPipeName(path: string): string | undefined {
  const match = /^[\\/]{2}[.?][\\/]pipe[\\/]([^\\/]+)$/i.exec(path)
  if (match === null || match[1] === '.' || match[1] === '..') return undefined
  return match[1]
}

function getCapabilityDir(): string {
  return join(getClaudeConfigHomeDir(), 'messaging-capabilities')
}

function getCapabilityPath(socket: string): string {
  const digest = createHash('sha256').update(socket).digest('hex')
  return join(getCapabilityDir(), `${digest}.json`)
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  )
}

async function assertPrivateCapabilityDir(dir: string): Promise<void> {
  let stat: Awaited<ReturnType<typeof lstat>>
  try {
    stat = await lstat(dir)
  } catch (error) {
    if (!isNotFound(error)) throw error
    await mkdir(dir, { recursive: true, mode: 0o700 })
    stat = await lstat(dir)
  }

  assertPrivateDirectory(stat, dir, 'capability directory')
  await chmod(dir, 0o700)
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

async function writePrivateFileExclusive(
  path: string,
  content: string,
): Promise<void> {
  const handle = await open(path, 'wx', 0o600)
  try {
    await handle.writeFile(content, 'utf-8')
  } finally {
    await handle.close()
  }
  await chmod(path, 0o600)
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

async function writeCapabilityFile(
  socket: string,
  token: string,
): Promise<void> {
  const dir = getCapabilityDir()
  await assertPrivateCapabilityDir(dir)
  const target = getCapabilityPath(socket)
  const temp = `${target}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`
  try {
    await writePrivateFileExclusive(
      temp,
      jsonStringify({ socketPath: socket, authToken: token }),
    )
    await rename(temp, target)
  } catch (error) {
    try {
      await unlink(temp)
    } catch {
      // Temp file may not exist if exclusive creation failed.
    }
    throw error
  }
  capabilityFilePath = target
}

export async function readUdsCapabilityToken(
  socket: string,
): Promise<string | undefined> {
  try {
    const parsed = jsonParse(
      await readFile(getCapabilityPath(socket), 'utf-8'),
    ) as Record<string, unknown>
    if (parsed.socketPath === socket && typeof parsed.authToken === 'string') {
      return parsed.authToken
    }
  } catch {
    // Missing or unreadable capability file means the peer is not addressable.
  }
  return undefined
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
    authToken = randomBytes(32).toString('hex')
  }
  return authToken
}

function getMessageAuthToken(message: UdsMessage): string | undefined {
  const token = message.meta?.authToken
  return typeof token === 'string' ? token : undefined
}

function isAuthorizedMessage(message: UdsMessage): boolean {
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
export async function startUdsMessaging(
  path: string,
  opts?: { isExplicit?: boolean },
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
        let authenticated = false
        let closing = false
        const closeWithError = (data: string): void => {
          if (closing || socket.destroyed) return
          closing = true
          socket.pause()
          writeSocketErrorAndDestroy(socket, data)
        }
        const authTimer = setTimeout(() => {
          if (authenticated || socket.destroyed) return
          logForDebugging('[udsMessaging] closing unauthenticated idle client')
          closeWithError('authentication timeout')
        }, UDS_AUTH_TIMEOUT_MS)
        unrefTimer(authTimer)
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
              clearTimeout(authTimer)
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
          clearTimeout(authTimer)
          clients.delete(socket)
        })

        socket.on('error', err => {
          clearTimeout(authTimer)
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

    // densable 2.1.228 #4 — publish inbox auth key after listen; failure is
    // hard (`key_publish_failed`) so we never run an inbox peers cannot auth.
    try {
      await writeCapabilityFile(path, token)
    } catch (publishErr) {
      const detail =
        publishErr instanceof Error ? publishErr.message : String(publishErr)
      logForDebugging(
        `[uds-messaging] Failed to publish the inbox auth key (refusing to run an inbox no peer can authenticate to): ${detail}`,
      )
      const err = new Error(
        `[uds-messaging] Failed to publish the inbox auth key (refusing to run an inbox no peer can authenticate to): ${detail}`,
      )
      ;(err as Error & { code?: string }).code = 'key_publish_failed'
      throw err
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
          send: async (target, fields) => {
            const token = await readUdsCapabilityToken(target)
            if (!token) {
              throw new Error(`no capability token for ${target}`)
            }
            await sendUdsMessage(
              target,
              {
                type: 'control',
                from: path,
                ts: new Date().toISOString(),
                ...fields,
              },
              { authToken: token },
            )
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
