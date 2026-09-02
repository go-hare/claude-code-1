/**
 * PTY Host — subprocess that owns a pseudo-terminal for a bg session.
 *
 * Upstream equivalent: `HfO` (runPtyHost) in the official 2.1.153 binary.
 *
 * Architecture:
 *   Daemon spawns: claude --bg-pty-host <sock> <cols> <rows> -- <file> [args...]
 *   PTY Host:
 *     1. Creates a Bun.Terminal (conpty on Windows, forkpty on Unix)
 *     2. Spawns the target process inside the PTY
 *     3. Listens on <sock> for supervisor connections
 *     4. Protocol: 5-byte framed binary (4 BE length + 1 kind byte)
 *        - kind 0 = data frame (raw PTY bytes)
 *        - kind 1 = control frame (JSON)
 *     5. On connect: sends hello → ring buffer replay → live marker
 *     6. Bidirectional: supervisor writes data/ctrl frames, host broadcasts output
 */

import { createServer, type Server, type Socket } from 'net'
import { tryProcessCwd } from '../utils/cachePaths.js'
import { writeFileSync } from 'fs'
import { unlink } from 'fs/promises'

// ---------------------------------------------------------------------------
// Wire Protocol — official frame format
// Header: 4 bytes BE uint32 (payload length) + 1 byte (frame kind)
// ---------------------------------------------------------------------------

/** Data frame kind — raw PTY I/O bytes */
export const DATA_FRAME = 0
/** Control frame kind — JSON-encoded messages */
export const CTRL_FRAME = 1
/** Total header size in bytes */
export const HEADER_SIZE = 5
/** Maximum payload per frame (1 MB) */
export const MAX_FRAME_SIZE = 1_048_576
/** Ring buffer capacity (256 KB) — official EV_ */
export const RING_BUFFER_SIZE = 262_144
/** Max terminal dimension — official JqH */
export const MAX_TERM_DIM = 10_000

/** Encode a data frame (raw PTY output) */
export function encodeDataFrame(data: Buffer): Buffer {
  const frame = Buffer.allocUnsafe(HEADER_SIZE + data.length)
  frame.writeUInt32BE(data.length, 0)
  frame.writeUInt8(DATA_FRAME, 4)
  data.copy(frame, HEADER_SIZE)
  return frame
}

/** Encode a control frame (JSON message) */
export function encodeCtrlFrame(msg: Record<string, unknown>): Buffer {
  const payload = Buffer.from(JSON.stringify(msg), 'utf-8')
  const frame = Buffer.allocUnsafe(HEADER_SIZE + payload.length)
  frame.writeUInt32BE(payload.length, 0)
  frame.writeUInt8(CTRL_FRAME, 4)
  payload.copy(frame, HEADER_SIZE)
  return frame
}

// ---------------------------------------------------------------------------
// Frame Parser — official KL6
// ---------------------------------------------------------------------------

export interface DataFrame {
  kind: typeof DATA_FRAME
  payload: Buffer
}
export interface CtrlFrame {
  kind: typeof CTRL_FRAME
  ctrl: Record<string, unknown>
}
export type Frame = DataFrame | CtrlFrame

/**
 * Creates a streaming frame parser.
 * Buffers incoming data and emits complete frames.
 * Calls onError and stops on protocol violations.
 */
export function createFrameParser(
  onFrame: (frame: Frame) => void,
  onError?: (msg: string) => void,
): (chunk: Buffer) => void {
  let buf: Buffer<ArrayBuffer> = Buffer.alloc(0)
  let broken = false
  return (chunk: Buffer) => {
    if (broken) return
    buf = (
      buf.length === 0 ? chunk : Buffer.concat([buf, chunk])
    ) as Buffer<ArrayBuffer>
    while (buf.length >= HEADER_SIZE) {
      const payloadLen = buf.readUInt32BE(0)
      if (payloadLen > MAX_FRAME_SIZE) {
        broken = true
        onError?.(`frame too large (${payloadLen} > ${MAX_FRAME_SIZE})`)
        return
      }
      const totalLen = HEADER_SIZE + payloadLen
      if (buf.length < totalLen) return
      const kind = buf.readUInt8(4)
      const payload = buf.subarray(HEADER_SIZE, totalLen)
      buf = buf.subarray(totalLen)
      if (kind === DATA_FRAME) {
        onFrame({ kind: DATA_FRAME, payload: Buffer.from(payload) })
      } else if (kind === CTRL_FRAME) {
        let ctrl: Record<string, unknown>
        try {
          ctrl = JSON.parse(payload.toString('utf8')) as Record<string, unknown>
        } catch {
          broken = true
          onError?.('bad ctrl json')
          return
        }
        onFrame({ kind: CTRL_FRAME, ctrl })
      } else {
        broken = true
        onError?.(`unknown frame kind ${kind}`)
        return
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Ring Buffer — official E64
// ---------------------------------------------------------------------------

/**
 * Fixed-capacity ring buffer for PTY output.
 * Trims from head when over capacity, respecting UTF-8 boundaries.
 */
class RingBuffer {
  private _chunks: Buffer[] = []
  private totalBytes = 0
  private headIdx = 0

  push(data: Buffer): void {
    this._chunks.push(data)
    this.totalBytes += data.length
    while (
      this.totalBytes > RING_BUFFER_SIZE &&
      this._chunks.length - this.headIdx > 1
    ) {
      this.totalBytes -= this._chunks[this.headIdx]!.length
      this.headIdx++
      // Skip UTF-8 continuation bytes at new head
      for (let i = 0; i < 3; i++) {
        const head = this._chunks[this.headIdx]
        if (!head || head.length === 0) break
        let trim = 0
        while (
          trim + i < 3 &&
          trim < head.length &&
          (head[trim]! & 0xc0) === 0x80
        ) {
          trim++
        }
        if (trim > 0) {
          this._chunks[this.headIdx] = head.subarray(trim)
          this.totalBytes -= trim
        }
        if (
          this._chunks[this.headIdx]!.length > 0 ||
          this._chunks.length - this.headIdx === 1
        )
          break
        this.headIdx++
      }
    }
    if (this.headIdx >= this._chunks.length - this.headIdx) {
      this._chunks = this._chunks.slice(this.headIdx)
      this.headIdx = 0
    }
  }

  get chunks(): Buffer[] {
    return this._chunks.slice(this.headIdx)
  }
}

// ---------------------------------------------------------------------------
// PTY Host Entry Point — official HfO
// ---------------------------------------------------------------------------

/**
 * Run the PTY host process.
 * Called from cli.tsx when `--bg-pty-host` is detected in argv.
 */
export async function runPtyHost(args: string[]): Promise<void> {
  const dashDash = args.indexOf('--')
  const isSpare = dashDash >= 0 && args.includes('--bg-spare', dashDash + 1)

  if (dashDash < 3 || dashDash === args.length - 1) {
    writeError(
      args[0],
      'bad argv: --bg-pty-host <sock> <cols> <rows> -- <file> [args...]',
    )
    return
  }

  const sockPath = args[0]!
  const cols = Number(args[1]) || 200
  const rows = Number(args[2]) || 50
  const cliFile = args[dashDash + 1]!
  const cliArgs = args.slice(dashDash + 2)
  const isExecMode = process.env.CLAUDE_PTY_HOST_EXEC === '1'
  delete process.env.CLAUDE_PTY_HOST_EXEC

  process.on('uncaughtException', err =>
    writeError(sockPath, `uncaught: ${err?.stack ?? String(err)}`),
  )
  process.on('unhandledRejection', err =>
    writeError(
      sockPath,
      `unhandledRejection: ${(err as Error)?.stack ?? String(err)}`,
    ),
  )

  // Lower process priority on Unix (official: +5, capped at 19)
  if (process.platform !== 'win32') {
    try {
      const os = require('os') as typeof import('os')
      os.setPriority(0, Math.min(os.getPriority(0) + 5, 19))
    } catch {}
  }

  const ring = new RingBuffer()
  const attachers = new Set<Socket>()
  let exited = false
  let hadOutput = false
  let pendingSignal: string | null = null

  const MAX_WRITABLE = MAX_FRAME_SIZE // 1MB backpressure limit per socket

  function broadcast(frame: Buffer): void {
    for (const sock of attachers) {
      if (sock.destroyed) {
        attachers.delete(sock)
        continue
      }
      if (sock.writableLength > MAX_WRITABLE) {
        sock.destroy()
        attachers.delete(sock)
        continue
      }
      sock.write(frame)
    }
  }

  // Spawn target process inside PTY
  let terminal: InstanceType<typeof Bun.Terminal>
  let child: ReturnType<typeof Bun.spawn>
  try {
    terminal = new Bun.Terminal({
      cols,
      rows,
      data(_term: unknown, output: Uint8Array) {
        hadOutput = true
        const buf = Buffer.from(output)
        ring.push(buf)
        if (attachers.size) broadcast(encodeDataFrame(buf))
      },
    })
    child = Bun.spawn([cliFile, ...cliArgs], {
      cwd: tryProcessCwd(),
      env: { ...process.env, TERM: 'xterm-256color' },
      terminal,
      windowsHide: true,
      detached: false,
    })
  } catch (err) {
    writeError(sockPath, `spawn failed: ${String(err)}`)
    return
  }

  // Remove stale socket before listening
  await unlink(sockPath).catch(() => {})

  // Handle ctrl frames from supervisor
  function handleCtrl(msg: Record<string, unknown>): void {
    switch (msg.t) {
      case 'resize': {
        const c = Number(msg.cols)
        const r = Number(msg.rows)
        if (
          c > 0 &&
          c <= MAX_TERM_DIM &&
          r > 0 &&
          r <= MAX_TERM_DIM &&
          !exited
        ) {
          terminal.resize(c, r)
          if (process.platform !== 'win32') {
            try {
              process.kill(-process.pid, 'SIGWINCH')
            } catch {}
          }
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

  // Listen for supervisor connections on the PTY socket
  const server: Server = createServer((socket: Socket) => {
    socket.on('error', () => socket.destroy())
    socket.once('close', () => attachers.delete(socket))

    // Hello frame (official includes replPid + version string)
    socket.write(
      encodeCtrlFrame({
        t: 'hello',
        replPid: child.pid,
        version: MACRO.VERSION,
      }),
    )

    // Replay ring buffer
    for (const chunk of ring.chunks) {
      socket.write(encodeDataFrame(chunk))
    }

    // Live marker — end of replay
    socket.write(encodeCtrlFrame({ t: 'live' }))

    attachers.add(socket)

    if (exited) {
      socket.write(
        encodeCtrlFrame({ t: 'exit', code: exitCode, signal: exitSignal }),
      )
      socket.end()
      return
    }

    // Parse incoming frames from supervisor
    const parse = createFrameParser(
      frame => {
        if (frame.kind === DATA_FRAME) {
          if (!exited) {
            terminal.write(frame.payload)
            // In exec mode: detect SIGINT/SIGQUIT bytes and forward to process group
            if (isExecMode && process.platform !== 'win32') {
              const sig = frame.payload.includes(3)
                ? 'SIGINT'
                : frame.payload.includes(28)
                  ? 'SIGQUIT'
                  : null
              if (sig) {
                pendingSignal = sig
                try {
                  process.kill(-process.pid, sig)
                } catch {}
                setImmediate(() => {
                  pendingSignal = null
                })
              }
            }
          }
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

  // Forward signals to child process
  for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) {
    process.on(sig, () => {
      if (pendingSignal === sig) return
      try {
        child.kill(sig === 'SIGHUP' ? 'SIGTERM' : sig)
      } catch {}
    })
  }
  if (isExecMode && process.platform !== 'win32') {
    process.on('SIGQUIT', () => {
      if (pendingSignal === 'SIGQUIT') return
      try {
        child.kill('SIGQUIT')
      } catch {}
    })
  }

  // Wait for child to exit
  let exitCode = 0
  let exitSignal: string | undefined
  exitCode = await child.exited

  // Drain: wait for final output to flush (official: up to 20 × 5ms)
  for (let i = 0; i < 20; i++) {
    hadOutput = false
    await new Promise(r => setTimeout(r, 5))
    if (!hadOutput) break
  }

  exitSignal = child.signalCode ?? undefined
  exited = true
  terminal.close()

  // In exec mode: SIGHUP the process group
  if (isExecMode && process.platform !== 'win32') {
    pendingSignal = 'SIGHUP'
    try {
      process.kill(-process.pid, 'SIGHUP')
    } catch {}
  }

  // Broadcast exit frame
  broadcast(encodeCtrlFrame({ t: 'exit', code: exitCode, signal: exitSignal }))

  // Wait briefly for late attachers (official: 5s)
  if (attachers.size === 0) {
    await Promise.race([
      new Promise<void>(r => server.once('connection', () => r())),
      new Promise<void>(r => setTimeout(r, 5000).unref()),
    ])
  }

  // Tear down
  for (const sock of attachers) sock.end()
  await Promise.race([
    new Promise<void>(r => server.close(() => r())),
    new Promise<void>(r => setTimeout(r, 2000).unref()),
  ])
  if (process.platform !== 'win32') {
    await unlink(sockPath).catch(() => {})
  }
  process.exit(exitCode)
}

// ---------------------------------------------------------------------------
// Error breadcrumb — official iy_
// Writes a timestamped error to <sock>.err then exits
// ---------------------------------------------------------------------------

function writeError(sockPath: string | undefined, msg: string): void {
  if (sockPath) {
    try {
      const fs = require('fs') as typeof import('fs')
      const path = require('path') as typeof import('path')
      const errPath = sockPath + '.err'
      fs.mkdirSync(path.dirname(errPath), { recursive: true })
      fs.writeFileSync(errPath, `${new Date().toISOString()} ${msg}\n`)
    } catch {}
  }
  process.exit(1)
}
