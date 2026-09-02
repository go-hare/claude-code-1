/**
 * UDS Client — connect to peer Claude Code sessions via Unix Domain Sockets.
 *
 * Peers are discovered by reading the PID-file registry in ~/.claude/sessions/
 * (written by concurrentSessions.ts) and checking each entry's
 * `messagingSocketPath` field. A peer is "alive" if its PID is running and
 * its socket accepts a ping/pong round-trip.
 */

import { randomUUID } from 'crypto'
import { createConnection, type Socket } from 'net'
import { lstat, readdir, readFile } from 'fs/promises'
import { join } from 'path'
import { getClaudeConfigHomeDir } from './envUtils.js'
import { logForDebugging } from './debug.js'
import { errorMessage, getErrnoCode, isFsInaccessible } from './errors.js'
import { isProcessRunning } from './genericProcessUtils.js'
import { jsonParse, jsonStringify } from './slowOperations.js'
import type { SessionKind } from './concurrentSessions.js'
import {
  MAX_UDS_FRAME_BYTES,
  assertUdsPayloadUnderLineCap,
  serializeUdsAuthFrame,
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
import { attachUdsResponseReader } from './udsResponseReader.js'

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
  /** densable 2.1.238 #28 — pre-warm spare hidden until claimed. */
  spare?: boolean
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
        ...(data.spare === true ? { spare: true } : {}),
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
  // densable hya — hide unclaimed pre-warm spare workers from ListAgents.
  return all.filter(
    s => s.pid !== process.pid && s.messagingSocketPath != null && !s.spare,
  )
}

/** densable 2.1.239 IWd kinds — token / no-key / unusable / dead-owner. */
async function resolveCapabilityForSocket(
  socketPath: string,
): Promise<
  | { kind: 'token'; token: string }
  | { kind: 'no-key' }
  | { kind: 'unusable' }
  | { kind: 'dead-owner' }
> {
  const { isMessagingLiveOwnerRequired, resolveMessagingCapability } =
    await import('./udsMessaging.js')
  // densable cmp: IWd(e, { requireLiveOwner: mti() }) — mti is Windows-only.
  return resolveMessagingCapability(socketPath, {
    requireLiveOwner: isMessagingLiveOwnerRequired(),
  })
}

/** Official `_1e` — cmp control-plane refuse kinds. */
export class UdsControlSendError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'UdsControlSendError'
    this.code = code
  }
}

/**
 * Official `mli` — `Bun.ant.getPeerPid` on the connected fd.
 * Windows returns undefined (cmp skips expectPeerPid there).
 */
export function readConnectedPeerPid(socket: Socket): number | undefined {
  if (process.platform === 'win32') return undefined
  const handle = (socket as { _handle?: { fd?: number } })._handle
  const fd = typeof handle?.fd === 'number' ? handle.fd : -1
  try {
    const getPeerPid = (
      globalThis as {
        Bun?: { ant?: { getPeerPid?: (fd: number) => number | null } }
      }
    ).Bun?.ant?.getPeerPid
    const pid = fd < 0 ? null : (getPeerPid?.(fd) ?? null)
    if (pid !== null && pid > 0) return pid
    logForDebugging(`[peer-cred] peer pid unavailable (fd=${fd}, got=${pid})`)
    return undefined
  } catch (err) {
    logForDebugging(`[peer-cred] peer pid lookup failed: ${errorMessage(err)}`)
    return undefined
  }
}

/** Official cmp `noFollowSymlink` arm. `lr` is ENOENT-only. */
async function vetReplyTargetNotSymlink(path: string): Promise<void> {
  try {
    const st = await lstat(path)
    if (st.isSymbolicLink()) {
      throw new UdsControlSendError(
        'symlink',
        'Refusing to send: reply target is a symlink',
      )
    }
  } catch (err) {
    if (err instanceof UdsControlSendError) throw err
    if (getErrnoCode(err) === 'ENOENT') throw err
    logForDebugging(
      `[uds-client] reply target unvettable: ${errorMessage(err) || 'lstat failed'}`,
    )
    throw new UdsControlSendError(
      'unvettable',
      'Refusing to send: cannot vet reply target',
    )
  }
}

export type SendUdsControlOpts = {
  /** Official Tli `expectPeerPid` — Unix connect-time SO_PEERCRED check. */
  expectPeerPid?: number
}

/**
 * Official `Tli` / `T4r` — control frame through `cmp`.
 * Always `noFollowSymlink:true`. Token optional after no-key+rvv voucher.
 */
export async function sendUdsControl(
  targetSocketPath: string,
  fields: Record<string, unknown>,
  opts?: SendUdsControlOpts,
): Promise<void> {
  const {
    isLocalSocketAddress,
    isMessagingLiveOwnerRequired,
    hasLiveRegisteredInbox,
    parseWindowsNamedPipeName,
  } = await import('./udsMessaging.js')

  // Official cmp: ELe, not TSe.
  if (!isLocalSocketAddress(targetSocketPath)) {
    throw new UdsControlSendError(
      'non-local',
      `Refusing to connect to non-local IPC path: ${targetSocketPath}`,
    )
  }

  const cap = await resolveCapabilityForSocket(targetSocketPath)
  let authToken: string | undefined =
    cap.kind === 'token' ? cap.token : undefined
  if (isMessagingLiveOwnerRequired() && cap.kind !== 'token') {
    if (
      !(
        cap.kind === 'no-key' &&
        (await hasLiveRegisteredInbox(targetSocketPath))
      )
    ) {
      throw new UdsUnvouchedPipeError(targetSocketPath, cap.kind)
    }
    authToken = undefined
  }

  const skipSymlinkVet =
    process.platform === 'win32' &&
    parseWindowsNamedPipeName(targetSocketPath) !== undefined
  if (!skipSymlinkVet) {
    await vetReplyTargetNotSymlink(targetSocketPath)
  }

  const action = typeof fields.action === 'string' ? fields.action : 'control'
  logForDebugging(
    `[uds-client] Sending control:${action} to ${targetSocketPath}`,
  )

  // Official Tli: `{type:"control", ...t, ...q3e()}`. q3e is `{msgV:1, msg_id}`.
  // Keep caller `msg_id` when present — local subscribeToPeerIdle reuses this
  // sender; official T4r callers (receipt / idle notice) omit msg_id.
  const outbound: Record<string, unknown> = {
    ...fields,
    type: 'control',
    msgV: 1,
    msg_id:
      typeof fields.msg_id === 'string' && fields.msg_id.length > 0
        ? fields.msg_id
        : randomUUID(),
  }
  if (authToken !== undefined) {
    const meta =
      outbound.meta &&
      typeof outbound.meta === 'object' &&
      !Array.isArray(outbound.meta)
        ? { ...(outbound.meta as Record<string, unknown>) }
        : {}
    meta.authToken = authToken
    outbound.meta = meta
  }

  const wire = `${jsonStringify(outbound)}\n`
  const expectPeerPid = opts?.expectPeerPid

  // Official cmp: write, macos delayed end, else end, resolve on close.
  const MACOS_UDS_CONTROL_END_DELAY_MS = 150
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
        resolve()
      }
    }

    conn = createConnection(targetSocketPath, () => {
      if (expectPeerPid !== undefined && process.platform !== 'win32') {
        const pid = readConnectedPeerPid(conn)
        if (pid === undefined) {
          finish(
            new UdsControlSendError(
              'endpoint-unverifiable',
              'Refusing to send: connected endpoint identity could not be read',
            ),
          )
          return
        }
        if (pid !== expectPeerPid) {
          logForDebugging(
            `[uds-client] connected endpoint is pid ${pid}, expected ${expectPeerPid} — refusing to write`,
          )
          finish(
            new UdsControlSendError(
              'wrong-endpoint',
              'Refusing to send: connected endpoint is not the expected process',
            ),
          )
          return
        }
      }
      conn.write(wire, err => {
        if (err) {
          finish(err)
          return
        }
        if (process.platform === 'darwin') {
          setTimeout(() => {
            if (!conn.destroyed) conn.end()
          }, MACOS_UDS_CONTROL_END_DELAY_MS)
        } else {
          conn.end()
        }
      })
    })
    conn.on('error', err => finish(err))
    conn.on('close', () => {
      if (!settled) {
        logForDebugging(`[uds-client] Sent to ${targetSocketPath}`)
        finish()
      }
    })
    conn.setTimeout(5000, () => {
      finish(new Error(`Timed out sending to ${targetSocketPath}`))
    })
  })
}

// ---------------------------------------------------------------------------
// Connection helpers
// ---------------------------------------------------------------------------

/**
 * Official `ump` — 250ms bare connect. No capability file, no ping/pong.
 * Connect success or EBUSY (Windows named-pipe full) is alive.
 */
export async function isPeerAlive(
  socketPath: string,
  timeoutMs = 250,
  _authToken?: string,
): Promise<boolean> {
  const { isLocalSocketAddress } = await import('./udsMessaging.js')
  if (!isLocalSocketAddress(socketPath)) return false

  return new Promise<boolean>(resolve => {
    let settled = false
    const conn = createConnection(socketPath)
    const done = (alive: boolean): void => {
      if (settled) return
      settled = true
      conn.destroy()
      resolve(alive)
    }
    conn.on('connect', () => done(true))
    conn.on('error', err => done(getErrnoCode(err) === 'EBUSY'))
    conn.setTimeout(timeoutMs, () => done(false))
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

  const {
    parseUdsTarget,
    isLocalSocketAddress,
    isMessagingLiveOwnerRequired,
    hasLiveRegisteredInbox,
  } = await import('./udsMessaging.js')
  const target = parseUdsTarget(targetSocketPath)
  // Official cmp: ELe (`isLocalSocketAddress`), not the old double-slash gate.
  if (!isLocalSocketAddress(target.socketPath)) {
    throw new Error(
      `Refusing to connect to non-local IPC path: ${target.socketPath}`,
    )
  }
  const cap = await resolveCapabilityForSocket(target.socketPath)
  // densable cmp: Sli only when mti() && kind!==token && !(no-key && rvv).
  // Unix leaves requireLiveOwner off and does not throw here.
  let authToken: string | undefined =
    cap.kind === 'token' ? cap.token : undefined
  if (isMessagingLiveOwnerRequired() && cap.kind !== 'token') {
    if (
      !(
        cap.kind === 'no-key' &&
        (await hasLiveRegisteredInbox(target.socketPath))
      )
    ) {
      throw new UdsUnvouchedPipeError(target.socketPath, cap.kind)
    }
    authToken = undefined
  }

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

  const msgId = randomUUID()
  const udsMsg: UdsMessage = {
    type: 'text',
    data,
    ts: new Date().toISOString(),
    from: ownSocket,
    msg_id: msgId,
    meta: {
      msg_id: msgId,
      ...(opts.fromMode !== undefined ? { fromMode: opts.fromMode } : {}),
      ...(opts.selfSent === true ? { selfSent: true } : {}),
    },
  }

  // densable lmp / oFd: HWd + He(msg) + 1, even when the auth line is omitted.
  const payload = jsonStringify(udsMsg)
  assertUdsPayloadUnderLineCap(payload)
  // densable cmp: `c+i+\n` — H_a(token) prefix when IWd found a token.
  const wire =
    (authToken !== undefined ? serializeUdsAuthFrame(authToken) : '') +
    payload +
    '\n'

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

  // densable fXd — correlate outbound UDS text with peer_message_status receipts.
  const destAddr = `uds:${target.socketPath}`
  try {
    const { noteOutstandingSend } = await import('./peerReceipts.js')
    noteOutstandingSend(msgId, destAddr)
  } catch {
    // optional
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
    try {
      const { forgetOutstandingSend } = await import('./peerReceipts.js')
      forgetOutstandingSend(msgId)
    } catch {
      // optional
    }
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
