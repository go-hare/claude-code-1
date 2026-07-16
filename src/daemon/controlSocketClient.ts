/**
 * Control Socket Client — sends requests to the daemon control socket.
 * Split from controlSocket.ts to avoid circular imports.
 *
 * Official densable: IA (client-attach) — error codes:
 *   ETIMEOUT — socket idle timeout
 *   ENOCONN  — connect/error/parse/drop
 */

import { connect } from 'net'
import { getControlSocketPath } from './bgWorker.js'
import { jsonParse, jsonStringify } from '../utils/slowOperations.js'

export type ControlErrorCode = 'ETIMEOUT' | 'ENOCONN'

export interface ControlResponse {
  ok: boolean
  /** Official IA failure code when ok === false. */
  code?: ControlErrorCode | string
  [key: string]: unknown
}

/**
 * Send a request to the daemon control socket.
 * Official IA: default timeout 5000ms; codes ETIMEOUT / ENOCONN.
 */
export async function sendControlRequest(
  req: Record<string, unknown>,
  opts?: { timeoutMs?: number },
): Promise<ControlResponse> {
  const socketPath = getControlSocketPath()
  const timeout = opts?.timeoutMs ?? 5000

  return new Promise<ControlResponse>(resolve => {
    let client: ReturnType<typeof connect>
    try {
      client = connect(socketPath)
    } catch (err) {
      resolve({
        ok: false,
        code: 'ENOCONN',
        error: err instanceof Error ? err.message : String(err),
      })
      return
    }

    let responded = false

    const done = (resp: ControlResponse) => {
      if (responded) return
      responded = true
      try {
        client.destroy()
      } catch {
        // ignore
      }
      resolve(resp)
    }

    client.setTimeout(timeout, () => {
      done({ ok: false, code: 'ETIMEOUT', error: 'control socket timeout' })
    })

    client.on('error', (err: Error & { code?: string }) => {
      done({
        ok: false,
        code: 'ENOCONN',
        error:
          err.code === 'ENOENT'
            ? 'daemon not running'
            : err.message || String(err),
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
      } catch (err) {
        done({
          ok: false,
          code: 'ENOCONN',
          error: err instanceof Error ? err.message : 'invalid response',
        })
      }
    })

    client.once('close', () => {
      if (!responded) {
        if (buffer.trim()) {
          try {
            done(jsonParse(buffer.trim()) as ControlResponse)
          } catch {
            done({
              ok: false,
              code: 'ENOCONN',
              error: 'incomplete response',
            })
          }
        } else {
          done({
            ok: false,
            code: 'ENOCONN',
            error:
              'connection dropped mid-request — it may have restarted; retry',
          })
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
