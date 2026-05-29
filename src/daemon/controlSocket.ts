/**
 * Control Socket — daemon listens for dispatch/status/stop requests.
 *
 * Upstream equivalent: `kG_` (createControlSocket) in the official binary.
 *
 * Protocol: JSON over newline-delimited stream.
 * - Client connects, sends one JSON line
 * - Server responds with one JSON line, then closes
 *
 * Windows: named pipe \\.\pipe\cc-daemon-bg-<user>
 * Unix: unix domain socket ~/.claude/daemon/bg/control.sock
 */

import { createServer, connect, type Server, type Socket } from 'net'
import { mkdir, unlink } from 'fs/promises'
import { join, dirname } from 'path'
import { getClaudeConfigHomeDir } from '../utils/envUtils.js'
import { jsonParse, jsonStringify } from '../utils/slowOperations.js'

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function getBgDaemonDir(): string {
  return join(getClaudeConfigHomeDir(), 'daemon', 'bg')
}

export function getControlSocketPath(): string {
  if (process.platform === 'win32') {
    const user = process.env.USERNAME || process.env.USER || 'default'
    return `//./pipe/cc-daemon-bg-${user}`
  }
  return join(getBgDaemonDir(), 'control.sock')
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ControlRequest {
  op: string
  [key: string]: unknown
}

export interface ControlResponse {
  ok: boolean
  [key: string]: unknown
}

export type RequestHandler = (
  req: ControlRequest,
  socket: Socket,
) => Promise<ControlResponse> | ControlResponse

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

export async function startControlSocket(
  handler: RequestHandler,
): Promise<{ server: Server; close: () => Promise<void> }> {
  const socketPath = getControlSocketPath()

  // Ensure directory exists (unix only)
  if (process.platform !== 'win32') {
    await mkdir(dirname(socketPath), { recursive: true })
    await unlink(socketPath).catch(() => {})
  }

  const server = createServer((socket: Socket) => {
    socket.setTimeout(30_000, () => socket.destroy())

    let buffer = ''
    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString()
      const nl = buffer.indexOf('\n')
      if (nl < 0) {
        if (buffer.length > 1_048_576) {
          respond(socket, { ok: false, error: 'request too large' })
        }
        return
      }

      const line = buffer.slice(0, nl)
      buffer = buffer.slice(nl + 1)
      socket.setTimeout(0)

      handleLine(line, socket, handler)
    })

    socket.on('error', () => {
      // Client disconnected — ignore
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(socketPath, () => {
      server.removeListener('error', reject)
      resolve()
    })
  })

  return {
    server,
    async close() {
      await new Promise<void>(r => server.close(() => r()))
      if (process.platform !== 'win32') {
        await unlink(socketPath).catch(() => {})
      }
    },
  }
}

async function handleLine(
  line: string,
  socket: Socket,
  handler: RequestHandler,
): Promise<void> {
  try {
    const req = jsonParse(line) as ControlRequest
    if (!req || typeof req.op !== 'string') {
      respond(socket, { ok: false, error: 'missing op field' })
      return
    }
    const resp = await handler(req, socket)
    respond(socket, resp)
  } catch (e) {
    respond(socket, {
      ok: false,
      error: e instanceof Error ? e.message : 'parse error',
    })
  }
}

function respond(socket: Socket, resp: ControlResponse): void {
  if (socket.destroyed) return
  socket.end(jsonStringify(resp) + '\n')
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

/**
 * Send a request to the daemon control socket.
 * Returns the response, or { ok: false } if the daemon is unreachable.
 */
export async function sendControlRequest(
  req: ControlRequest,
  opts?: { timeoutMs?: number },
): Promise<ControlResponse> {
  const socketPath = getControlSocketPath()
  const timeout = opts?.timeoutMs ?? 5000

  return new Promise<ControlResponse>(resolve => {
    const client = connect(socketPath)
    let responded = false

    const done = (resp: ControlResponse) => {
      if (responded) return
      responded = true
      resolve(resp)
    }

    client.setTimeout(timeout, () => {
      client.destroy()
      done({ ok: false, error: 'timeout' })
    })

    client.on('error', (err: Error & { code?: string }) => {
      done({
        ok: false,
        error: err.code === 'ENOENT' ? 'daemon not running' : err.message,
      })
    })

    client.once('connect', () => {
      client.write(jsonStringify(req) + '\n')
    })

    let buffer = ''
    client.on('data', (chunk: Buffer) => {
      buffer += chunk.toString()
      const nl = buffer.indexOf('\n')
      if (nl < 0) return
      const line = buffer.slice(0, nl)
      try {
        done(jsonParse(line) as ControlResponse)
      } catch {
        done({ ok: false, error: 'invalid response' })
      }
      client.end()
    })

    client.on('end', () => {
      if (!responded) {
        if (buffer.trim()) {
          try {
            done(jsonParse(buffer.trim()) as ControlResponse)
          } catch {
            done({ ok: false, error: 'incomplete response' })
          }
        } else {
          done({ ok: false, error: 'connection closed' })
        }
      }
    })
  })
}

/**
 * Check if the daemon is reachable via control socket.
 */
export async function isDaemonReachable(): Promise<boolean> {
  const resp = await sendControlRequest({ op: 'ping' }, { timeoutMs: 2000 })
  return resp.ok === true
}
