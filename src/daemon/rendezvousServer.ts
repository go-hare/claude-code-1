/**
 * Rendezvous Server — session-side server for daemon ↔ session communication.
 *
 * Upstream equivalent: cn8 module (startRendezvousServer/stopRendezvousServer/sendRv).
 *
 * The daemon connects to this server to:
 *   - Send "repaint" requests (triggers Ink forceRedraw)
 *   - Send "reply" messages (enqueues user input)
 *   - Send "shutdown" (graceful exit)
 *   - Send "attacher-caps" (terminal capabilities)
 *   - Receive "heartbeat" (keep-alive)
 *   - Receive "state" patches (session state updates)
 *   - Receive "repaint-done" acknowledgements
 *
 * Protocol: newline-delimited JSON over Unix socket / Windows named pipe.
 */

import { createServer, type Server, type Socket } from 'net'
import { unlink } from 'fs/promises'
import { StringDecoder } from 'string_decoder'
import { instances } from '@anthropic/ink'
import { jsonParse, jsonStringify } from '../utils/slowOperations.js'

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let server: Server | undefined
let client: Socket | undefined
let heartbeatTimer: ReturnType<typeof setInterval> | undefined

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Start the rendezvous server. Reads socket path from CLAUDE_BG_RENDEZVOUS_SOCK
 * environment variable (set by daemon when spawning bg sessions).
 */
export async function startRendezvousServer(): Promise<void> {
  const sockPath = process.env.CLAUDE_BG_RENDEZVOUS_SOCK
  if (!sockPath || server) return

  delete process.env.CLAUDE_BG_RENDEZVOUS_SOCK
  await unlink(sockPath).catch(() => {})

  server = createServer((socket: Socket) => {
    // Only one client at a time (daemon supervisor)
    client?.destroy()
    client = socket

    socket.on('error', () => socket.destroy())
    socket.once('close', () => {
      if (client === socket) client = undefined
    })

    let buf = ''
    const decoder = new StringDecoder('utf8')
    socket.on('data', (chunk: Buffer) => {
      buf += decoder.write(chunk)
      let nl: number
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl)
        buf = buf.slice(nl + 1)
        if (line) handleMessage(line)
      }
      if (buf.length > 1_048_576) {
        buf = ''
        socket.destroy()
      }
    })
  })

  server.on('error', (err: Error) => {
    // Log but don't crash — rv is best-effort
    if (process.env.CLAUDE_CODE_DEBUG) {
      process.stderr.write(`[bg-rv] server error: ${err.message}\n`)
    }
  })

  server.listen(sockPath)
  server.unref()

  // Heartbeat every 30s so daemon knows we're alive
  heartbeatTimer = setInterval(() => sendRv({ type: 'heartbeat' }), 30_000)
  heartbeatTimer.unref()
}

/**
 * Stop the rendezvous server and clean up.
 */
export function stopRendezvousServer(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = undefined
  }
  client?.destroy()
  client = undefined
  server?.close()
  server = undefined
}

/**
 * Send a message to the daemon via the rendezvous connection.
 * Returns true if the message was sent, false if no client is connected.
 */
export function sendRv(msg: Record<string, unknown>): boolean {
  if (!client || client.destroyed) return false
  try {
    client.write(jsonStringify(msg) + '\n')
    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Message handling — official bg3
// ---------------------------------------------------------------------------

function handleMessage(line: string): void {
  let msg: Record<string, unknown>
  try {
    msg = jsonParse(line) as Record<string, unknown>
  } catch {
    return
  }
  if (!msg || typeof msg !== 'object') return
  if ('role' in msg) return // Ignore stray API messages

  switch (msg.type) {
    case 'shutdown':
      sendRv({ type: 'shutting-down' })
      // Graceful shutdown
      setTimeout(() => process.exit(0), 5000).unref()
      process.exit(0)
      break

    case 'repaint': {
      // Get the Ink instance and force a full redraw
      const ink = instances.get(process.stdout)
      if (ink?.forceRedraw) {
        ink.forceRedraw()
      } else {
        // Ink not ready yet — write a fallback message
        process.stdout.write(
          '\x1B[2J\x1B[H\n  \x1B[2mSession can\u2019t redraw right now \u2014 Ctrl+Z to detach\x1B[0m\n',
        )
      }
      sendRv({ type: 'repaint-done' })
      break
    }

    case 'attacher-caps':
      // Could update terminal capabilities here if needed
      break

    case 'reply':
      if (typeof msg.text === 'string') {
        // Enqueue the reply as stdin input
        // The REPL's prompt input will pick it up
        if (process.stdin.readable) {
          process.stdin.push(Buffer.from(msg.text + '\n'))
        }
      }
      break
  }
}
