/**
 * PTY Host — subprocess that provides a pseudo-terminal for bg sessions.
 *
 * Upstream equivalent: `tPf` (runPtyHost) in the official binary.
 *
 * Architecture:
 *   Daemon spawns: claude --bg-pty-host <sock> <cols> <rows> -- <file> [args...]
 *   PTY Host:
 *     1. Creates a Bun.Terminal (conpty on Windows, forkpty on Unix)
 *     2. Spawns the CLI inside the PTY via Bun.spawn({terminal})
 *     3. Listens on <sock> for attacher connections
 *     4. Forwards I/O between socket and PTY
 */

import { createServer, type Server, type Socket } from 'net'
import { writeFileSync } from 'fs'
import { unlink } from 'fs/promises'

// ---------------------------------------------------------------------------
// Wire Protocol (matches official)
// ---------------------------------------------------------------------------

const DATA_FRAME = 0x01
const CTRL_FRAME = 0x02
const HEADER_SIZE = 5 // 1 byte type + 4 bytes length

function encodeDataFrame(data: Buffer): Buffer {
  const header = Buffer.alloc(HEADER_SIZE)
  header[0] = DATA_FRAME
  header.writeUInt32LE(data.length, 1)
  return Buffer.concat([header, data])
}

function encodeCtrlFrame(msg: Record<string, unknown>): Buffer {
  const payload = Buffer.from(JSON.stringify(msg), 'utf-8')
  const header = Buffer.alloc(HEADER_SIZE)
  header[0] = CTRL_FRAME
  header.writeUInt32LE(payload.length, 1)
  return Buffer.concat([header, payload])
}

// ---------------------------------------------------------------------------
// Ring Buffer (output history for late attachers)
// ---------------------------------------------------------------------------

const RING_MAX_BYTES = 256 * 1024 // 256KB

class RingBuffer {
  private chunks: Buffer[] = []
  private totalBytes = 0
  private headIdx = 0

  push(data: Buffer): void {
    this.chunks.push(data)
    this.totalBytes += data.length
    while (
      this.totalBytes > RING_MAX_BYTES &&
      this.chunks.length - this.headIdx > 1
    ) {
      this.totalBytes -= this.chunks[this.headIdx]!.length
      this.headIdx++
    }
    if (this.headIdx >= this.chunks.length - this.headIdx) {
      this.chunks = this.chunks.slice(this.headIdx)
      this.headIdx = 0
    }
  }

  getChunks(): Buffer[] {
    return this.chunks.slice(this.headIdx)
  }
}

// ---------------------------------------------------------------------------
// Frame parser (attacher → PTY host)
// ---------------------------------------------------------------------------

interface DataFrame {
  kind: typeof DATA_FRAME
  payload: Buffer
}
interface CtrlFrame {
  kind: typeof CTRL_FRAME
  ctrl: Record<string, unknown>
}

function createFrameParser(
  onFrame: (frame: DataFrame | CtrlFrame) => void,
  onError?: (msg: string) => void,
): (chunk: Buffer<ArrayBuffer>) => void {
  let buf: Buffer<ArrayBuffer> = Buffer.alloc(0)
  return (chunk: Buffer<ArrayBuffer>) => {
    buf = buf.length
      ? (Buffer.concat([buf, chunk]) as Buffer<ArrayBuffer>)
      : chunk
    while (buf.length >= HEADER_SIZE) {
      const type = buf[0]
      const len = buf.readUInt32LE(1)
      if (buf.length < HEADER_SIZE + len) break
      const payload = buf.subarray(HEADER_SIZE, HEADER_SIZE + len)
      buf = buf.subarray(HEADER_SIZE + len)
      if (type === DATA_FRAME) {
        onFrame({ kind: DATA_FRAME, payload })
      } else if (type === CTRL_FRAME) {
        try {
          const ctrl = JSON.parse(payload.toString()) as Record<string, unknown>
          onFrame({ kind: CTRL_FRAME, ctrl })
        } catch {
          onError?.('invalid ctrl frame')
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// PTY Host Entry Point
// ---------------------------------------------------------------------------

/**
 * Run the PTY host. Called from cli.tsx when `--bg-pty-host` is detected.
 */
export async function runPtyHost(args: string[]): Promise<void> {
  const dashDash = args.indexOf('--')
  if (dashDash < 3 || dashDash === args.length - 1) {
    writeError(
      args[0],
      'bad argv: --bg-pty-host <sock> <cols> <rows> -- [cli-args...]',
    )
    process.exit(1)
    return
  }

  const sockPath = args[0]!
  const cols = Number(args[1]) || 200
  const rows = Number(args[2]) || 50
  const cliArgs = args.slice(dashDash + 1)

  // Build CLI launch spec (PTY host re-execs the same binary with the CLI args)
  const { buildCliLaunch } = await import('../utils/cliLaunch.js')
  const launch = buildCliLaunch(cliArgs)

  process.on('uncaughtException', err =>
    writeError(sockPath, `uncaught: ${err?.stack ?? String(err)}`),
  )
  process.on('unhandledRejection', err =>
    writeError(
      sockPath,
      `unhandledRejection: ${(err as Error)?.stack ?? String(err)}`,
    ),
  )

  const ring = new RingBuffer()
  const attachers = new Set<Socket>()
  let exited = false

  function broadcast(frame: Buffer): void {
    for (const sock of attachers) {
      if (sock.destroyed) {
        attachers.delete(sock)
        continue
      }
      sock.write(frame)
    }
  }

  // Spawn CLI inside PTY
  let terminal: InstanceType<typeof Bun.Terminal>
  let child: ReturnType<typeof Bun.spawn>
  try {
    terminal = new Bun.Terminal({
      cols,
      rows,
      data(_term: unknown, output: Uint8Array) {
        const buf = Buffer.from(output)
        ring.push(buf)
        if (attachers.size) broadcast(encodeDataFrame(buf))
      },
    })
    child = Bun.spawn([launch.execPath, ...launch.args], {
      cwd: process.cwd(),
      env: { ...launch.env, TERM: 'xterm-256color' },
      terminal,
      windowsHide: true,
      detached: false,
    })
  } catch (err) {
    writeError(sockPath, `spawn failed: ${String(err)}`)
    process.exit(1)
    return
  }

  // Clean up stale socket
  await unlink(sockPath).catch(() => {})

  // Listen for attacher connections
  const server: Server = createServer((socket: Socket) => {
    socket.on('error', () => socket.destroy())
    socket.once('close', () => attachers.delete(socket))

    // Send hello
    socket.write(
      encodeCtrlFrame({ t: 'hello', replPid: child.pid, version: 1 }),
    )

    // Send ring buffer history
    for (const chunk of ring.getChunks()) {
      socket.write(encodeDataFrame(chunk))
    }

    // Send live marker
    socket.write(encodeCtrlFrame({ t: 'live' }))

    attachers.add(socket)

    if (exited) {
      socket.write(
        encodeCtrlFrame({ t: 'exit', code: exitCode, signal: exitSignal }),
      )
      socket.end()
      return
    }

    // Parse incoming frames from attacher
    const parse = createFrameParser(
      frame => {
        if (frame.kind === DATA_FRAME) {
          terminal.write(frame.payload)
        } else if (frame.kind === CTRL_FRAME) {
          handleCtrl(frame.ctrl)
        }
      },
      () => socket.destroy(),
    )
    socket.on('data', parse)
  })

  server.on('error', (err: Error) => {
    try {
      child.kill('SIGTERM')
    } catch {}
    writeError(sockPath, `server error: ${err.message}`)
  })

  server.listen(sockPath)
  server.unref()

  function handleCtrl(msg: Record<string, unknown>): void {
    switch (msg.t) {
      case 'resize': {
        const c = Number(msg.cols)
        const r = Number(msg.rows)
        if (c > 0 && c <= 500 && r > 0 && r <= 500 && !exited) {
          terminal.resize(c, r)
        }
        break
      }
      case 'kill': {
        const sig = msg.sig === 'SIGKILL' ? 'SIGKILL' : 'SIGTERM'
        try {
          child.kill(sig)
        } catch {}
        if (sig === 'SIGTERM') {
          setTimeout(() => {
            if (!exited)
              try {
                child.kill('SIGKILL')
              } catch {}
          }, 5000).unref()
        }
        break
      }
    }
  }

  // Handle signals
  for (const sig of ['SIGTERM', 'SIGINT'] as const) {
    process.on(sig, () => {
      try {
        child.kill(sig)
      } catch {}
    })
  }

  // Wait for child exit
  let exitCode = 0
  let exitSignal: string | undefined
  exitCode = await child.exited
  exitSignal = child.signalCode ?? undefined
  exited = true
  terminal.close()

  // Broadcast exit to all attachers
  broadcast(encodeCtrlFrame({ t: 'exit', code: exitCode, signal: exitSignal }))

  // Keep socket alive so late attachers can still see the ring buffer.
  // Without a long-running daemon, the PTY host itself must stay up.
  // Wait up to 5 minutes for an attacher, then exit.
  const LINGER_MS = 5 * 60 * 1000
  if (attachers.size === 0) {
    await Promise.race([
      new Promise<void>(resolve =>
        server.once('connection', sock => {
          // Once someone connects, wait for them to disconnect before exiting
          sock.once('close', () => {
            // Give a brief window for re-attach
            setTimeout(() => {
              if (attachers.size === 0) resolve()
            }, 5000).unref()
          })
        }),
      ),
      new Promise<void>(resolve => setTimeout(resolve, LINGER_MS).unref()),
    ])
  } else {
    // Wait for all current attachers to disconnect
    await new Promise<void>(resolve => {
      const check = () => {
        if (attachers.size === 0) resolve()
      }
      for (const sock of attachers) sock.once('close', check)
      setTimeout(resolve, LINGER_MS).unref()
    })
  }

  for (const sock of attachers) sock.end()
  await Promise.race([
    new Promise<void>(resolve => server.close(() => resolve())),
    new Promise<void>(resolve => setTimeout(resolve, 2000).unref()),
  ])

  if (process.platform !== 'win32') {
    await unlink(sockPath).catch(() => {})
  }

  process.exit(exitCode)
}

// ---------------------------------------------------------------------------
// Error breadcrumb
// ---------------------------------------------------------------------------

function writeError(sockPath: string | undefined, msg: string): void {
  if (!sockPath) {
    process.stderr.write(msg + '\n')
    return
  }
  const errPath = sockPath.replace(/\//g, '\\') + '.err'
  try {
    const { mkdirSync } = require('fs') as typeof import('fs')
    const { dirname } = require('path') as typeof import('path')
    mkdirSync(dirname(errPath), { recursive: true })
    writeFileSync(errPath, `${new Date().toISOString()} ${msg}\n`)
  } catch {
    process.stderr.write(msg + '\n')
  }
  process.exit(1)
}
