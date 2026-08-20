/**
 * UDS Client — connect to peer Claude Code sessions via Unix Domain Sockets.
 *
 * Peers are discovered by reading the PID-file registry in ~/.claude/sessions/
 * (written by concurrentSessions.ts) and checking each entry's
 * `messagingSocketPath` field. A peer is "alive" if its PID is running and
 * its socket accepts a ping/pong round-trip.
 */

import { createConnection, type Socket } from 'net'
import { readdir, readFile } from 'fs/promises'
import { join } from 'path'
import { getClaudeConfigHomeDir } from './envUtils.js'
import { logForDebugging } from './debug.js'
import { errorMessage, getErrnoCode, isFsInaccessible } from './errors.js'
import { isProcessRunning } from './genericProcessUtils.js'
import { jsonParse, jsonStringify } from './slowOperations.js'
import type { SessionKind } from './concurrentSessions.js'
import {
  MAX_UDS_FRAME_BYTES,
  MAX_UDS_LINE_CHARS,
  UdsMessageTooLargeError,
  type UdsMessage,
} from './udsMessaging.js'
import {
  canonicalOutboundPaceKey,
  createUdsOutboundPacedError,
  getOutboundPacer,
  NOOP_OUTBOUND_RESERVE,
  shouldPaceOutboundSend,
  type ReserveResult,
} from './udsOutboundPacer.js'
import { attachUdsResponseReader, getChunkBytes } from './udsResponseReader.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PeerSession = {
  pid: number
  sessionId?: string
  cwd?: string
  startedAt?: number
  kind?: SessionKind
  name?: string
  messagingSocketPath?: string
  entrypoint?: string
  bridgeSessionId?: string | null
  alive: boolean
}

export class UdsPeerConnectionError extends Error {
  readonly socketPath: string

  constructor(socketPath: string, cause: unknown) {
    super(
      `Failed to connect to peer at ${socketPath}: ${errorMessage(cause)}`,
      { cause },
    )
    this.name = 'UdsPeerConnectionError'
    this.socketPath = socketPath
  }
}

/**
 * densable Bt-style fail-closed when the target has no live capability voucher.
 * `code` is the short classifier (e.g. `no live inbox registered for the target pipe`).
 */
export class UdsUnvouchedPipeError extends Error {
  readonly code: string
  readonly socketPath: string
  readonly kind: string

  constructor(socketPath: string, kind: string) {
    super(
      `No running session has registered an inbox at ${socketPath} (ENOINBOX: ${kind}) — refusing to send to an unvouched pipe`,
    )
    this.name = 'UdsUnvouchedPipeError'
    this.code = 'no live inbox registered for the target pipe'
    this.socketPath = socketPath
    this.kind = kind
  }
}

/**
 * densable QHr / qKo — connect-fail that should refund a reserved outbound token.
 * SEA: ENOENT | ECONNREFUSED | (bt && errorClass===E5d).
 * Post-write timeout wrapped as UdsPeerConnectionError must NOT refund.
 */
export function isUdsConnectFailError(error: unknown): boolean {
  const code = getErrnoCode(error)
  if (code === 'ENOENT' || code === 'ECONNREFUSED') return true
  // Walk cause chain for errno (UdsPeerConnectionError wraps connect causes).
  if (error instanceof Error && error.cause !== undefined) {
    const causeCode = getErrnoCode(error.cause)
    if (causeCode === 'ENOENT' || causeCode === 'ECONNREFUSED') return true
  }
  return false
}

// ---------------------------------------------------------------------------
// Session directory
// ---------------------------------------------------------------------------

function getSessionsDir(): string {
  return join(getClaudeConfigHomeDir(), 'sessions')
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

/**
 * List all live sessions from the PID registry, optionally probing their
 * UDS sockets for liveness. Sessions whose PID is no longer running are
 * excluded (and their stale files cleaned up).
 */
export async function listAllLiveSessions(): Promise<PeerSession[]> {
  const dir = getSessionsDir()
  let files: string[]
  try {
    files = await readdir(dir)
  } catch (e) {
    if (!isFsInaccessible(e)) {
      logForDebugging(`[udsClient] readdir failed: ${errorMessage(e)}`)
    }
    return []
  }

  const results: PeerSession[] = []

  for (const file of files) {
    if (!/^\d+\.json$/.test(file)) continue
    const pid = parseInt(file.slice(0, -5), 10)

    if (!isProcessRunning(pid)) {
      // Stale — skip (concurrentSessions handles cleanup)
      continue
    }

    try {
      const raw = await readFile(join(dir, file), 'utf8')
      const data = jsonParse(raw) as Record<string, unknown>
      results.push({
        pid,
        sessionId: data.sessionId as string | undefined,
        cwd: data.cwd as string | undefined,
        startedAt: data.startedAt as number | undefined,
        kind: data.kind as SessionKind | undefined,
        name: data.name as string | undefined,
        messagingSocketPath: data.messagingSocketPath as string | undefined,
        entrypoint: data.entrypoint as string | undefined,
        bridgeSessionId: data.bridgeSessionId as string | null | undefined,
        alive: true,
      })
    } catch {
      // Corrupted file — skip
    }
  }

  return results
}

/**
 * List peer sessions that have a UDS messaging socket (i.e. can receive
 * messages). Excludes the current process.
 */
export async function listPeers(): Promise<PeerSession[]> {
  const all = await listAllLiveSessions()
  return all.filter(s => s.pid !== process.pid && s.messagingSocketPath != null)
}

async function findAuthTokenForSocketPath(
  socketPath: string,
): Promise<string | undefined> {
  const { readUdsCapabilityToken } = await import('./udsMessaging.js')
  return readUdsCapabilityToken(socketPath)
}

/**
 * densable ULu-lite for go-hare's messaging-capabilities store.
 * Full densable uses per-PID `.${hash}.key` under sessions/ with dead-owner
 * ranking; we map missing capability → no-key for the same fail-closed surface
 * without inventing that key layout.
 */
async function resolveCapabilityForSocket(
  socketPath: string,
): Promise<{ kind: 'token'; token: string } | { kind: 'no-key' }> {
  const token = await findAuthTokenForSocketPath(socketPath)
  if (typeof token === 'string' && token.length > 0) {
    return { kind: 'token', token }
  }
  return { kind: 'no-key' }
}

// ---------------------------------------------------------------------------
// Connection helpers
// ---------------------------------------------------------------------------

/**
 * Probe a UDS socket to check if a server is listening (ping/pong).
 * Returns true if the peer responds within the timeout.
 */
export async function isPeerAlive(
  socketPath: string,
  timeoutMs = 3000,
  authToken?: string,
): Promise<boolean> {
  const token = authToken ?? (await findAuthTokenForSocketPath(socketPath))
  if (!token) return false

  return new Promise<boolean>(resolve => {
    const conn = createConnection(socketPath, () => {
      const ping: UdsMessage = {
        type: 'ping',
        ts: new Date().toISOString(),
        meta: { authToken: token },
      }
      conn.write(jsonStringify(ping) + '\n')
    })

    let resolved = false

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true
        conn.destroy()
        resolve(false)
      }
    }, timeoutMs)

    let buffer = ''
    conn.on('data', chunk => {
      if (
        Buffer.byteLength(buffer, 'utf8') + getChunkBytes(chunk) >
        MAX_UDS_FRAME_BYTES
      ) {
        if (!resolved) {
          resolved = true
          clearTimeout(timer)
          conn.destroy()
          resolve(false)
        }
        return
      }
      buffer += chunk.toString()
      if (buffer.includes('"pong"')) {
        if (!resolved) {
          resolved = true
          clearTimeout(timer)
          conn.end()
          resolve(true)
        }
      }
    })

    conn.on('error', () => {
      if (!resolved) {
        resolved = true
        clearTimeout(timer)
        resolve(false)
      }
    })
  })
}

export type SendToUdsSocketOptions = {
  timeoutMs?: number
  /**
   * densable Wei / tengu_harbor_kite_mode_emit — when set, stamped on meta.fromMode
   * so the receiver's Bqp gate can apply mode-parity (bypass↔bypass / prompting↔prompting).
   */
  fromMode?: 'bypass' | 'prompting'
  /**
   * densable selfSent — wire hint only. Receivers ignore this field and stamp
   * selfSent only via kernel peer-cred ancestry (UTf/zTf), never forgeable `from`.
   */
  selfSent?: boolean
  /**
   * densable uEn fromName override (e.g. jid rename notice stamps new session name).
   * When omitted, falls back to current session title.
   */
  fromName?: string
}

/**
 * Send a text message to a peer's UDS socket. This is the high-level helper
 * used by SendMessageTool for `uds:<path>` addresses.
 */
export async function sendToUdsSocket(
  targetSocketPath: string,
  message: string | Record<string, unknown>,
  timeoutMsOrOpts: number | SendToUdsSocketOptions = 5000,
): Promise<void> {
  const opts: SendToUdsSocketOptions =
    typeof timeoutMsOrOpts === 'number'
      ? { timeoutMs: timeoutMsOrOpts }
      : timeoutMsOrOpts
  const timeoutMs = opts.timeoutMs ?? 5000

  const { parseUdsTarget, isLocalIpcPath } = await import('./udsMessaging.js')
  const target = parseUdsTarget(targetSocketPath)
  // densable TSe / WOd: refuse non-local IPC paths before any connect.
  if (!isLocalIpcPath(target.socketPath)) {
    throw new Error(
      `Refusing to connect to non-local IPC path: ${target.socketPath}`,
    )
  }
  const cap = await resolveCapabilityForSocket(target.socketPath)
  if (cap.kind !== 'token') {
    // densable: No running session has registered an inbox at … (ENOINBOX: kind)
    // — refusing to send to an unvouched pipe / code "no live inbox…"
    throw new UdsUnvouchedPipeError(target.socketPath, cap.kind)
  }
  const authToken = cap.token

  const rawBody = typeof message === 'string' ? message : jsonStringify(message)

  // Lazily import to avoid circular dep at module-load time
  const { getUdsMessagingSocketPath } = await import('./udsMessaging.js')
  const ownSocket = getUdsMessagingSocketPath()
  // densable n5s/fbr: wrap body with from= own uds address + optional from-name
  // (session title) so the receiver UI can show sender name inline.
  let fromName: string | undefined = opts.fromName
  if (fromName === undefined) {
    try {
      const { getSessionId } = await import('../bootstrap/state.js')
      const { getCurrentSessionTitle } = await import('./sessionStorage.js')
      fromName = getCurrentSessionTitle(getSessionId())
    } catch {
      // title optional
    }
  }
  const { wrapCrossSessionMessage } = await import('./crossSessionMessage.js')
  const fromAddr = ownSocket ? `uds:${ownSocket}` : undefined
  const data = wrapCrossSessionMessage(rawBody, {
    ...(fromAddr !== undefined ? { from: fromAddr } : {}),
    ...(fromName !== undefined ? { fromName } : {}),
    ...(opts.fromMode !== undefined ? { fromMode: opts.fromMode } : {}),
  })

  const udsMsg: UdsMessage = {
    type: 'text',
    data,
    ts: new Date().toISOString(),
    from: ownSocket,
    meta: {
      authToken,
      ...(opts.fromMode !== undefined ? { fromMode: opts.fromMode } : {}),
      ...(opts.selfSent === true ? { selfSent: true } : {}),
    },
  }

  // densable oFd/X1r: refuse oversized on-wire line BEFORE createConnection.
  // Local has no separate BVs auth preamble — auth lives in meta — so n = wire.length.
  const wire = `${jsonStringify(udsMsg)}\n`
  if (wire.length > MAX_UDS_LINE_CHARS) {
    throw new UdsMessageTooLargeError(wire.length, MAX_UDS_LINE_CHARS)
  }

  // densable CDn / P5d / jLb / T5d — reserve BEFORE send so paced messages are
  // never falsely marked sent. Windows + no own inbox → noop (zLb).
  // densable dX(e)??e — namespace-canonical pace key (not raw socketPath).
  const paceKey =
    canonicalOutboundPaceKey(target.socketPath) ?? target.socketPath
  const reservation: ReserveResult = shouldPaceOutboundSend({
    ownSocketPath: ownSocket,
  })
    ? getOutboundPacer().reserve(paceKey)
    : NOOP_OUTBOUND_RESERVE
  if (!reservation.ok) {
    logForDebugging(
      `[uds-client] paced: not sending to ${targetSocketPath} — ${reservation.sentInBurst} sent this burst; its inbox rate limit would drop more`,
    )
    throw createUdsOutboundPacedError(reservation.sentInBurst)
  }

  // densable $id — track outbound peer as rename-notice correspondent.
  try {
    const { noteSessionNameCorrespondent } = await import(
      './sessionNameUniqueness.js'
    )
    const peerAddr = `uds:${target.socketPath}`
    // Resolve pid from live registry when possible (jid validates pid→sock).
    let peerPid = 0
    try {
      const { listLiveSessionRecords } = await import('./concurrentSessions.js')
      const live = await listLiveSessionRecords()
      const hit = live.find(r => r.messagingSocketPath === target.socketPath)
      if (hit) peerPid = hit.pid
    } catch {
      // optional
    }
    noteSessionNameCorrespondent(peerAddr, peerPid)
  } catch {
    // optional uniqueness tracking
  }

  try {
    await new Promise<void>((resolve, reject) => {
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

      conn = createConnection(target.socketPath, () => {
        conn.write(wire, err => {
          if (err) finish(err)
        })
      })
      attachUdsResponseReader(conn, {
        maxFrameBytes: MAX_UDS_FRAME_BYTES,
        onSettled: finish,
        formatSocketError: err =>
          new UdsPeerConnectionError(target.socketPath, err),
      })
      conn.setTimeout(timeoutMs, () => {
        finish(
          new UdsPeerConnectionError(
            target.socketPath,
            new Error('Connection timed out'),
          ),
        )
      })
    })
  } catch (err) {
    // densable QHr — connect-fail refunds the reserved token.
    if (isUdsConnectFailError(err)) {
      reservation.refund()
    }
    throw err
  }
}

/**
 * Connect to a peer and return the raw socket for bidirectional communication.
 * The caller owns the post-connect lifecycle through onSocketError, which is
 * attached before the Promise resolves so peer socket errors cannot be
 * swallowed or surface through a listener handoff window.
 * Pre-connect failures reject with UdsPeerConnectionError.
 * This only opens the transport; callers still own any capability handshake.
 */
export function connectToPeer(
  socketPath: string,
  onSocketError: (error: Error) => void,
  timeoutMs = 5000,
): Promise<Socket> {
  return new Promise<Socket>((resolve, reject) => {
    const conn = createConnection(socketPath)
    let settled = false
    const timeout = setTimeout(
      fail,
      timeoutMs,
      new Error('Connection timed out'),
    )
    function cleanupListeners(): void {
      clearTimeout(timeout)
      conn.off('error', fail)
    }
    function fail(cause: unknown): void {
      if (settled) {
        return
      }
      settled = true
      cleanupListeners()
      conn.destroy()
      reject(new UdsPeerConnectionError(socketPath, cause))
    }
    conn.once('connect', () => {
      if (settled) {
        return
      }
      settled = true
      cleanupListeners()
      conn.on('error', onSocketError)
      resolve(conn)
    })
    conn.on('error', fail)
  })
}

/**
 * Disconnect a previously connected peer socket.
 */
export function disconnectPeer(socket: Socket): void {
  if (!socket.destroyed) {
    socket.end()
  }
}
