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

import { createServer, type Server, type Socket } from 'net'
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

export interface ControlSocketInstance {
  close: () => Promise<void>
  leaseCount: () => number
  onLeaseChange: Signal<[]>
}

export async function startControlSocket(
  handler: RequestHandler,
): Promise<ControlSocketInstance> {
  const socketPath = getControlSocketPath()

  // Ensure directory exists with correct permissions
  if (process.platform !== 'win32') {
    const dir = getDaemonInstanceDir()
    await mkdir(dir, { recursive: true, mode: 0o700 }).catch(() => {})
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

  server.on('error', err =>
    console.error('[daemon] control socket error:', err),
  )

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(socketPath, () => {
      server.removeListener('error', reject)
      resolve()
    })
  })

  return {
    async close() {
      for (const sock of connections) sock.destroy()
      await new Promise<void>(r => server.close(() => r()))
      if (process.platform !== 'win32') {
        await unlink(socketPath).catch(() => {})
      }
    },
    leaseCount: () => leases.size,
    onLeaseChange,
  }
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
