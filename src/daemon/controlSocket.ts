/**
 * Control Socket — daemon listens for dispatch/status/stop/attach/subscribe requests.
 *
 * Upstream equivalent: `SG4` (startControlSocket) + `JmO` (handleRequest) in the official binary.
 *
 * Protocol: JSON over newline-delimited stream.
 * - Client connects, sends one JSON line
 * - Server responds with one JSON line, then closes (normal ops)
 * - For streaming ops (attach/subscribe/lease): server sends ack, then keeps connection open
 *
 * Path (official Ll):
 *   Unix: /tmp/cc-daemon-<uid>/<sha256(configDir)[:8]>/control.sock
 *   Windows: named pipe \\.\pipe\cc-daemon-<pipeKey>-control
 */

import { createConnection, createServer, type Server, type Socket } from 'net'
import { mkdir, unlink } from 'fs/promises'
import { dirname } from 'path'
import {
  getControlSocketPath,
  getDaemonInstanceDir,
  createSignal,
  type Signal,
} from './bgWorker.js'
import { jsonParse, jsonStringify } from '../utils/slowOperations.js'
import { logEvent } from '../services/analytics/index.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Max request size (1MB) — official $S_ */
const MAX_REQUEST_SIZE = 1_048_576

/**
 * densable aAp GZs — EADDRINUSE bind retry budget (ms).
 * Official: `let E=Date.now()+GZs; for(;;){ listen; if EADDRINUSE && now<E sleep 100 }`.
 * Windows named pipes and Unix AF_UNIX both surface EADDRINUSE when a live
 * peer still holds the endpoint; retry covers race with a dying predecessor.
 */
export const CONTROL_SOCKET_BIND_RETRY_MS = 10_000

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ControlRequest {
  op: string
  proto?: number
  [key: string]: unknown
}

export interface ControlResponse {
  ok: boolean
  [key: string]: unknown
}

export interface LeaseInfo {
  label?: string
}

/**
 * Request handler signature.
 * Return a ControlResponse to send it and close the socket.
 * Return null/undefined to indicate the handler has taken ownership of the socket.
 */
export type RequestHandler = (
  req: ControlRequest,
  socket: Socket,
  remainder: Buffer,
  addLease: (socket: Socket, info: LeaseInfo | null) => void,
) =>
  | Promise<ControlResponse | null | undefined>
  | ControlResponse
  | null
  | undefined

// ---------------------------------------------------------------------------
// Server — official SG4
// ---------------------------------------------------------------------------

export type ControlSocketCloseOpts = {
  /**
   * densable aAp close(A): when true, do not server.close()+unlink path —
   * unref only. Yielding supervisor must leave the path for the successor
   * (214 #26: dying daemon must not delete successor control socket).
   */
  skipUnlink?: boolean
}

export interface ControlSocketInstance {
  close: (opts?: ControlSocketCloseOpts) => Promise<void>
  leaseCount: () => number
  onLeaseChange: Signal<[]>
}

export async function startControlSocket(
  handler: RequestHandler,
): Promise<ControlSocketInstance> {
  const socketPath = getControlSocketPath()

  // densable aAp:
  //   await QQr() (unix mkdir 0o700); controlKey = e2d();
  //   await unlink(path).catch; listen with EADDRINUSE retry ≤ GZs (10s)
  // Windows named pipe (qRs/Hne): no unlink; bind fails EADDRINUSE if live peer.
  // Exclusivity primary: daemon.lock R9d/installDaemonLock.
  // Local product (unix only): probe live connect before unlink — densable does
  // not probe; refuse dual-supervisor if a peer still answers after lock race.
  if (process.platform !== 'win32') {
    const dir = getDaemonInstanceDir()
    await mkdir(dir, { recursive: true, mode: 0o700 }).catch(() => {})
    const peerLive = await probeControlSocketLive(socketPath)
    if (peerLive) {
      throw new Error(
        `control socket already in use by a live daemon (${socketPath}) — another supervisor holds the path`,
      )
    }
    await unlink(socketPath).catch(() => {})
  }

  const connections = new Set<Socket>()
  const leases = new Map<Socket, LeaseInfo | null>()
  const onLeaseChange = createSignal<[]>()

  const addLease = (socket: Socket, info: LeaseInfo | null): void => {
    if (leases.has(socket)) return
    leases.set(socket, info)
    socket.once('close', () => {
      leases.delete(socket)
      onLeaseChange.emit()
    })
    onLeaseChange.emit()
  }

  const server: Server = createServer((socket: Socket) => {
    socket.on('error', () => socket.destroy())
    socket.setTimeout(30_000, () => socket.destroy())
    connections.add(socket)
    socket.once('close', () => connections.delete(socket))

    // Peer UID validation (Unix only)
    const peerReject = validatePeerUid(socket)
    if (peerReject) {
      // Official: tengu_daemon_peer_uid_reject
      logEvent('tengu_daemon_peer_uid_reject', {})
      socket.once('data', () =>
        respond(socket, { ok: false, code: 'EPEERUID', error: peerReject }),
      )
      return
    }

    let buf = Buffer.alloc(0)
    const onData = (chunk: Buffer): void => {
      buf = Buffer.concat([buf, chunk])
      const nl = buf.indexOf(10) // '\n'
      if (nl < 0) {
        if (buf.length > MAX_REQUEST_SIZE) {
          socket.off('data', onData)
          respond(socket, {
            ok: false,
            code: 'ETOOLARGE',
            error: `request exceeds ${MAX_REQUEST_SIZE >> 20}MB — shorten the prompt or send in parts`,
          })
        }
        return
      }
      socket.off('data', onData)
      socket.setTimeout(0)
      const line = buf.subarray(0, nl).toString('utf8')
      const remainder = buf.subarray(nl + 1)
      handleLine(line, socket, remainder, handler, addLease)
    }
    socket.on('data', onData)
  })

  // densable aAp: post-listen errors soft-warn; pre-listen uses once(error).
  let bindSettled = false
  server.on('error', err => {
    if (!bindSettled) return
    console.error('[daemon] control socket error:', err)
  })

  // densable aAp: retry listen on EADDRINUSE until GZs (10s), 100ms sleep.
  const bindDeadline = Date.now() + CONTROL_SOCKET_BIND_RETRY_MS
  for (;;) {
    try {
      await new Promise<void>((resolve, reject) => {
        const onErr = (err: Error): void => {
          reject(err)
        }
        server.once('error', onErr)
        server.listen(socketPath, () => {
          server.removeListener('error', onErr)
          resolve()
        })
      })
      bindSettled = true
      break
    } catch (err) {
      const code =
        err && typeof err === 'object' && 'code' in err
          ? String((err as { code?: unknown }).code)
          : undefined
      if (code !== 'EADDRINUSE' || Date.now() >= bindDeadline) {
        throw err
      }
      server.removeAllListeners('listening')
      await new Promise(r => setTimeout(r, 100))
    }
  }

  // densable aAp: y flag — once skipUnlink, never unlink later from this instance
  let skipUnlinkSticky = false

  return {
    // densable:
    //   close:(A)=>new Promise((w)=>{for(let x of c)x.destroy();
    //     if(A?.skipUnlink)return y=!0,_.unref(),void w();
    //     _.close(()=>{if(!A?.skipUnlink)Oca.unlink(a).catch(()=>{});w()})})
    async close(opts?: ControlSocketCloseOpts) {
      for (const sock of connections) sock.destroy()
      if (opts?.skipUnlink) {
        skipUnlinkSticky = true
        // Leave FD open until process exit so successor bind race is not
        // compounded by a half-closed listener; unref so exit is not blocked.
        server.unref()
        return
      }
      await new Promise<void>(r => server.close(() => r()))
      // densable aAp close: unlink unless skipUnlink; windows named pipe no path file
      if (!skipUnlinkSticky && process.platform !== 'win32') {
        await unlink(socketPath).catch(() => {})
      }
    },
    leaseCount: () => leases.size,
    onLeaseChange,
  }
}

// ---------------------------------------------------------------------------
// Stale-path probe — product fortify before unlink+listen
// ---------------------------------------------------------------------------

/**
 * Returns true when a peer still accepts connects on the control sock path.
 * Stale leftover files fail connect (ENOENT/ECONNREFUSED) → false → safe unlink.
 * Timeout → treat as live (refuse steal) to avoid dual supervisor on slow peer.
 */
async function probeControlSocketLive(
  socketPath: string,
  timeoutMs = 250,
): Promise<boolean> {
  return await new Promise(resolve => {
    let settled = false
    const done = (live: boolean): void => {
      if (settled) return
      settled = true
      resolve(live)
    }
    const sock = createConnection(socketPath)
    const timer = setTimeout(() => {
      sock.destroy()
      done(true)
    }, timeoutMs)
    timer.unref?.()
    sock.once('connect', () => {
      clearTimeout(timer)
      sock.destroy()
      done(true)
    })
    sock.once('error', () => {
      clearTimeout(timer)
      done(false)
    })
  })
}

// ---------------------------------------------------------------------------
// Peer UID validation — official VG4
// ---------------------------------------------------------------------------

function validatePeerUid(socket: Socket): string | null {
  const myUid = process.getuid?.()
  if (myUid == null) return null

  // Node.js doesn't expose SO_PEERCRED directly, but on Linux/macOS
  // the socket object may have a remoteFamily. For Unix domain sockets,
  // we rely on directory permissions (0o700) for security.
  // The official code uses a native binding; we skip this check gracefully.
  return null
}

// ---------------------------------------------------------------------------
// Request handling
// ---------------------------------------------------------------------------

async function handleLine(
  line: string,
  socket: Socket,
  remainder: Buffer,
  handler: RequestHandler,
  addLease: (socket: Socket, info: LeaseInfo | null) => void,
): Promise<void> {
  let req: ControlRequest
  try {
    const parsed = jsonParse(line)
    if (!parsed || typeof parsed !== 'object') {
      respond(socket, { ok: false, error: 'bad json', code: 'EUNKNOWN' })
      return
    }
    req = parsed as ControlRequest
  } catch {
    respond(socket, { ok: false, error: 'bad json', code: 'EUNKNOWN' })
    return
  }

  try {
    const resp = await handler(req, socket, remainder, addLease)
    if (resp != null) {
      respond(socket, resp)
    }
  } catch (e) {
    respond(socket, {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      code: 'EUNKNOWN',
    })
  }
}

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

/** Send a JSON response and close the socket — official NT */
export function respond(socket: Socket, resp: ControlResponse): void {
  if (socket.destroyed) return
  socket.end(jsonStringify(resp) + '\n')
}

/** Write a JSON line WITHOUT closing — official zS_ */
export function writeJsonLine(
  socket: Socket,
  data: Record<string, unknown>,
): void {
  if (socket.destroyed) return
  socket.write(jsonStringify(data) + '\n')
}

// ---------------------------------------------------------------------------
// Client — send requests to the daemon control socket
// ---------------------------------------------------------------------------

export { sendControlRequest, isDaemonReachable } from './controlSocketClient.js'

// Re-export path helpers for consumers that import from controlSocket
export { getControlSocketPath } from './bgWorker.js'
