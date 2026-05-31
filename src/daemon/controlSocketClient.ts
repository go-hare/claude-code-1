/**
 * Control Socket Client — sends requests to the daemon control socket.
 * Split from controlSocket.ts to avoid circular imports.
 */

import { connect } from 'net'
import { getControlSocketPath } from './bgWorker.js'
import { jsonParse, jsonStringify } from '../utils/slowOperations.js'

export interface ControlResponse {
  ok: boolean
  [key: string]: unknown
}

/**
 * Send a request to the daemon control socket.
 * Returns the response, or { ok: false } if the daemon is unreachable.
 */
export async function sendControlRequest(
  req: Record<string, unknown>,
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
