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

import { randomBytes, timingSafeEqual } from 'crypto'
import { createServer, Socket, type Server } from 'net'
import { tryProcessCwd } from '../utils/cachePaths.js'
import { mkdirSync, writeFileSync } from 'fs'
import { appendFile, mkdir, readFile, unlink } from 'fs/promises'
import { dirname, join } from 'path'
import { StringDecoder } from 'string_decoder'

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
/** Default silent unauthenticated peer disconnect timeout — official le = 5000 */
export const DEFAULT_SILENT_PEER_TIMEOUT_MS = 5_000
/** Default attacher ping/pong heartbeat interval — official 60s */
export const DEFAULT_PTY_HEARTBEAT_MS = 60_000
/** Missed pongs before destroying an unresponsive attacher — official 3 */
export const MAX_MISSED_PONGS = 3
/** Default orphan watchdog check interval — official 2000ms */
export const DEFAULT_PTY_ORPHAN_CHECK_MS = 2_000
/** Consecutive orphaned ticks before killing child — official 30 (60s at 2s/tick) */
export const ORPHAN_WATCHDOG_TICKS = 30
/** Exec-mode exit tail cap (4 KB) — official 4096 */
export const EXEC_EXIT_TAIL_MAX_BYTES = 4096

/**
 * Official `QB(provided, expected)` (`chunk@285083897.js @890`):
 * Constant-time token verification using `crypto.timingSafeEqual`.
 */
export function verifyPtyAuthToken(
  provided: unknown,
  expected: string | undefined,
): boolean {
  if (typeof provided !== 'string' || !expected || provided.length === 0) {
    return false
  }
  const a = Buffer.from(provided, 'utf8')
  const b = Buffer.from(expected, 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/** Mint a 128-bit hex token for `CLAUDE_BG_PTY_AUTH`. */
export function mintPtyAuthToken(): string {
  return randomBytes(16).toString('hex')
}

export type SocketTokensFile = {
  ptyAuth?: string
  rvAuth?: string
  claimAuth?: string
}

/**
 * Official `nin(path)` (`chunk@285083897.js @828`):
 * Read optional per-socket auth tokens JSON file (`CLAUDE_BG_SOCKET_TOKENS_PATH`).
 */
export async function readSocketTokensFile(
  tokensPath: string,
): Promise<SocketTokensFile | undefined> {
  try {
    const parsed: unknown = JSON.parse(await readFile(tokensPath, 'utf8'))
    if (parsed === null || typeof parsed !== 'object') return undefined
    const rec = parsed as Record<string, unknown>
    const out: SocketTokensFile = {}
    if (typeof rec.rvAuth === 'string') out.rvAuth = rec.rvAuth
    if (typeof rec.ptyAuth === 'string') out.ptyAuth = rec.ptyAuth
    if (typeof rec.claimAuth === 'string') out.claimAuth = rec.claimAuth
    return out
  } catch {
    return undefined
  }
}

/**
 * Official `The(sockPath)` (`chunk@290252422.js @7051`):
 * Sidecar path for exec-mode 4KB exit tail JSON (`{ code, signal, tail }`).
 */
export function getExecExitFilePath(sockPath: string): string {
  if (process.platform === 'win32') {
    const leaf = sockPath.split('\\').pop() ?? 'pty'
    return join(dirname(sockPath), `${leaf}.exec-exit`)
  }
  return `${sockPath}.exec-exit`
}

/**
 * Official 2.1.328 (`chunk@308385766.js @6550`):
 * Slice the last 4KB of ring output on a valid UTF-8 boundary and write
 * `{ code, signal, tail }` JSON with mode 0o600.
 */
export function writeExecExitTailFile(
  exitFilePath: string,
  chunks: readonly Buffer[],
  code: number,
  signal?: string,
): void {
  const combined = Buffer.concat(chunks)
  const slice = combined.subarray(-EXEC_EXIT_TAIL_MAX_BYTES)
  let offset = 0
  while (
    offset < 3 &&
    offset < slice.length &&
    (slice[offset]! & 0xc0) === 0x80
  ) {
    offset++
  }
  const tail = slice.subarray(offset).toString('utf8')
  mkdirSync(dirname(exitFilePath), { recursive: true })
  writeFileSync(
    exitFilePath,
    JSON.stringify({ code, ...(signal !== undefined ? { signal } : {}), tail }),
    { mode: 0o600 },
  )
}

function parsePositiveIntEnv(raw: string | undefined): number | undefined {
  if (!raw) return undefined
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

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
// PTY Host Socket Server Engine — Official HfO (`chunk@308385766.js @2035-7000`)
// Exported for both `runPtyHost` and deterministic unit/socket tests.
// ---------------------------------------------------------------------------

export interface PtyHostServerOptions {
  sockPath: string
  replPid: number
  version?: string
  ptyAuthToken?: string
  admitSilentPeers?: boolean
  silentPeerTimeoutMs?: number
  heartbeatMs?: number
  maxMissedPongs?: number
  orphanCheckMs?: number
  orphanMaxTicks?: number
  enableWatchdogs?: boolean
  originalPpid?: number
  getPpid?: () => number
  isExecMode?: boolean
  exitFile?: string
  onWrite: (payload: Buffer) => void
  onResize?: (cols: number, rows: number) => void
  onKill?: (sig: 'SIGTERM' | 'SIGKILL') => void
  onOrphanKill?: () => void
  onBreadcrumb?: (msg: string) => void
  onServerError?: (err: Error) => void
}

export interface PtyHostServerHandle {
  server: Server
  attachers: Set<Socket>
  pushOutput(chunk: Buffer): void
  markExited(code: number, signal?: string): void
  waitForLateAttacher(timeoutMs?: number): Promise<void>
  close(): Promise<void>
}

function safeSocketWrite(sock: Socket, frame: Buffer): void {
  if (!sock.destroyed) {
    sock.write(frame)
  }
}

export async function startPtyHostServer(
  opts: PtyHostServerOptions,
): Promise<PtyHostServerHandle> {
  const {
    sockPath,
    replPid,
    ptyAuthToken,
    isExecMode = false,
    onWrite,
    onResize,
    onKill,
    onOrphanKill,
    onBreadcrumb,
    onServerError,
  } = opts
  const version =
    opts.version ?? (typeof MACRO !== 'undefined' ? MACRO.VERSION : '0.0.0')
  const admitSilentPeers =
    opts.admitSilentPeers ?? (ptyAuthToken === undefined || ptyAuthToken === '')
  const silentPeerTimeoutMs =
    opts.silentPeerTimeoutMs ?? DEFAULT_SILENT_PEER_TIMEOUT_MS
  const heartbeatMs = opts.heartbeatMs ?? DEFAULT_PTY_HEARTBEAT_MS
  const maxMissedPongs = opts.maxMissedPongs ?? MAX_MISSED_PONGS
  const orphanCheckMs = opts.orphanCheckMs ?? DEFAULT_PTY_ORPHAN_CHECK_MS
  const orphanMaxTicks = opts.orphanMaxTicks ?? ORPHAN_WATCHDOG_TICKS
  const enableWatchdogs = opts.enableWatchdogs ?? process.platform !== 'win32'
  const originalPpid = opts.originalPpid ?? process.ppid
  const getPpid = opts.getPpid ?? (() => process.ppid)
  const exitFile =
    opts.exitFile ?? (isExecMode ? getExecExitFilePath(sockPath) : undefined)

  const ring = new RingBuffer()
  const attachers = new Set<Socket>()
  const heartbeatState = new WeakMap<
    Socket,
    { armed: boolean; missed: number }
  >()
  const authenticatedSockets = new WeakSet<Socket>()
  const authRequiredSent = new WeakSet<Socket>()

  let exited = false
  let exitCode = 0
  let exitSignal: string | undefined
  let orphanTicks = 0
  let resolveLateAttacher: (() => void) | undefined

  const MAX_WRITABLE = MAX_FRAME_SIZE

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

  function sendAuthRequiredOnce(socket: Socket): void {
    if (!authRequiredSent.has(socket)) {
      authRequiredSent.add(socket)
      safeSocketWrite(socket, encodeCtrlFrame({ t: 'auth-required' }))
    }
  }

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
          onResize?.(c, r)
        }
        break
      }
      case 'kill': {
        const sig = msg.sig === 'SIGKILL' ? 'SIGKILL' : 'SIGTERM'
        onKill?.(sig)
        break
      }
    }
  }

  await unlink(sockPath).catch(() => {})

  const server: Server = createServer((socket: Socket) => {
    socket.on('error', () => socket.destroy())
    socket.once('close', () => attachers.delete(socket))

    let admitted = false
    let admittedAfterExit = false

    function admitSocket(): void {
      if (admitted || socket.destroyed) return
      admitted = true
      admittedAfterExit = exited
      socket.setTimeout(0)

      // Hello frame (official includes replPid + version string)
      safeSocketWrite(
        socket,
        encodeCtrlFrame({
          t: 'hello',
          replPid,
          version,
        }),
      )

      // Replay ring buffer
      for (const chunk of ring.chunks) {
        safeSocketWrite(socket, encodeDataFrame(chunk))
      }

      // Live marker — end of replay
      safeSocketWrite(socket, encodeCtrlFrame({ t: 'live' }))

      attachers.add(socket)
      orphanTicks = 0
      heartbeatState.set(socket, { armed: false, missed: 0 })
      safeSocketWrite(socket, encodeCtrlFrame({ t: 'ping' }))

      if (exited) {
        safeSocketWrite(
          socket,
          encodeCtrlFrame({ t: 'exit', code: exitCode, signal: exitSignal }),
        )
        socket.end()
        resolveLateAttacher?.()
      }
    }

    if (admitSilentPeers && !ptyAuthToken) {
      admitSocket()
      if (exited) return
    } else {
      socket.setTimeout(silentPeerTimeoutMs, () => {
        if (!admitted) socket.destroy()
      })
    }

    const parse = createFrameParser(
      frame => {
        // When ptyAuthToken is configured, require valid `{ t: 'auth', token }`
        // verified via timingSafeEqual BEFORE sending ring buffer or accepting
        // DATA_FRAME writes / control commands.
        if (ptyAuthToken) {
          if (frame.kind === CTRL_FRAME && frame.ctrl.t === 'auth') {
            if (verifyPtyAuthToken(frame.ctrl.token, ptyAuthToken)) {
              authenticatedSockets.add(socket)
              admitSocket()
            } else {
              sendAuthRequiredOnce(socket)
            }
            return
          }
          if (!authenticatedSockets.has(socket)) {
            if (frame.kind === DATA_FRAME) {
              sendAuthRequiredOnce(socket)
            } else if (frame.kind === CTRL_FRAME && frame.ctrl.t !== 'pong') {
              sendAuthRequiredOnce(socket)
            }
            return
          }
        } else if (!admitted) {
          admitSocket()
        }

        if (admittedAfterExit) return

        if (frame.kind === DATA_FRAME) {
          if (!exited) {
            onWrite(frame.payload)
          }
        } else if (frame.kind === CTRL_FRAME) {
          if (frame.ctrl.t === 'pong') {
            const st = heartbeatState.get(socket)
            if (st) {
              st.armed = true
              st.missed = 0
            }
          } else if (frame.ctrl.t === 'auth') {
            if (verifyPtyAuthToken(frame.ctrl.token, ptyAuthToken)) {
              authenticatedSockets.add(socket)
            }
          } else {
            handleCtrl(frame.ctrl)
          }
        }
      },
      () => socket.destroy(),
    )
    socket.on('data', parse)
  })

  server.on('error', (err: Error) => {
    onServerError?.(err)
  })

  await new Promise<void>((resolve, reject) => {
    const onErr = (err: Error) => {
      server.off('listening', onListen)
      reject(err)
    }
    const onListen = () => {
      server.off('error', onErr)
      resolve()
    }
    server.once('error', onErr)
    server.once('listening', onListen)
    server.listen(sockPath)
  })
  server.unref()

  // Official 2.1.328 (`chunk@308385766.js @5800-6300`):
  // 1. 60s ping/pong attacher heartbeat (3 missed pongs → destroy socket)
  // 2. 60s orphan watchdog (30 ticks × 2000ms when ppid !== originalPpid && attachers.size === 0)
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined
  let orphanTimer: ReturnType<typeof setInterval> | undefined

  if (enableWatchdogs) {
    heartbeatTimer = setInterval(() => {
      if (exited) return
      for (const sock of attachers) {
        const st = heartbeatState.get(sock)
        if (!st?.armed) continue
        st.missed++
        if (st.missed >= maxMissedPongs) {
          sock.destroy()
          attachers.delete(sock)
        } else {
          safeSocketWrite(sock, encodeCtrlFrame({ t: 'ping' }))
        }
      }
    }, heartbeatMs)
    heartbeatTimer.unref?.()

    orphanTimer = setInterval(() => {
      if (exited) return
      const currentPpid = getPpid()
      if (currentPpid === originalPpid || attachers.size > 0) {
        orphanTicks = 0
        return
      }
      if (++orphanTicks < orphanMaxTicks) return
      if (orphanTimer) {
        clearInterval(orphanTimer)
        orphanTimer = undefined
      }
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer)
        heartbeatTimer = undefined
      }
      onBreadcrumb?.(
        `orphan watchdog: ppid ${originalPpid}\u2192${currentPpid}, no client for ${orphanMaxTicks * orphanCheckMs}ms`,
      )
      onOrphanKill?.()
    }, orphanCheckMs)
    orphanTimer.unref?.()
  }

  function clearWatchdogs(): void {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer)
      heartbeatTimer = undefined
    }
    if (orphanTimer) {
      clearInterval(orphanTimer)
      orphanTimer = undefined
    }
  }

  return {
    server,
    attachers,
    pushOutput(chunk: Buffer) {
      ring.push(chunk)
      if (attachers.size > 0) {
        broadcast(encodeDataFrame(chunk))
      }
    },
    markExited(code: number, signal?: string) {
      if (exited) return
      exited = true
      exitCode = code
      exitSignal = signal
      clearWatchdogs()
      if (exitFile) {
        try {
          writeExecExitTailFile(exitFile, ring.chunks, exitCode, exitSignal)
        } catch {
          // best-effort sidecar write
        }
      }
      broadcast(
        encodeCtrlFrame({ t: 'exit', code: exitCode, signal: exitSignal }),
      )
    },
    async waitForLateAttacher(timeoutMs = 5_000) {
      if (attachers.size > 0) return
      await Promise.race([
        new Promise<void>(resolve => {
          resolveLateAttacher = resolve
          server.once('connection', () => {
            if (!ptyAuthToken) resolve()
          })
        }),
        new Promise<void>(resolve => {
          setTimeout(resolve, timeoutMs).unref?.()
        }),
      ])
    },
    async close() {
      clearWatchdogs()
      for (const sock of attachers) sock.end()
      await Promise.race([
        new Promise<void>(resolve => server.close(() => resolve())),
        new Promise<void>(resolve => {
          setTimeout(resolve, 2_000).unref?.()
        }),
      ])
      if (process.platform !== 'win32') {
        await unlink(sockPath).catch(() => {})
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Authenticated PTY Host Client — Official `chunk@302131078.js @8967-9900`
// Used by `bgManager.ts` so spawned PTY hosts authenticate with `{ t: 'auth' }`
// and respond to `{ t: 'ping' }` heartbeats with `{ t: 'pong' }`.
// ---------------------------------------------------------------------------

export interface AuthenticatedPtyConnection {
  pid: number
  replPid(): number
  replVersion(): string | undefined
  onResume(fn: () => void): void
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(sig: 'SIGTERM' | 'SIGKILL' | 'SIGQUIT'): void
  dispose(): void
  onData(fn: (data: string) => void): { dispose(): void }
  onExit(fn: (info: { exitCode: number; signal?: string }) => void): {
    dispose(): void
  }
}

export function connectAuthenticatedPtyHost(
  sockPath: string,
  pid: number,
  ptyAuthToken: string | undefined,
  childProc?: { exited: Promise<number>; signalCode?: string | null },
  onAuthRejected?: () => void,
): AuthenticatedPtyConnection {
  const dataListeners = new Set<(data: string) => void>()
  const exitListeners = new Set<
    (info: { exitCode: number; signal?: string }) => void
  >()

  let socket: Socket | undefined
  let replPid = 0
  let replVersion: string | undefined
  let disposed = false
  let exited = false
  let connectAttempts = 0
  let reconnectCount = 0
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let isLive = false
  let resumeFn: (() => void) | undefined
  const pendingWrites: Buffer[] = []
  let pendingBytes = 0

  const decoder = new StringDecoder('utf8')
  const CONNECT_BACKOFFS = [50, 100, 250, 500, 1000, 2000]
  const MAX_CONNECT_ATTEMPTS = 30
  const RECONNECT_ATTEMPTS = 4
  const MAX_WRITE_PAYLOAD = MAX_FRAME_SIZE - 1

  function writeFrame(frame: Buffer): boolean {
    if (socket && !socket.destroyed) {
      socket.write(frame)
      return true
    }
    if (pendingBytes < 2 * MAX_FRAME_SIZE) {
      pendingWrites.push(frame)
      pendingBytes += frame.length
    }
    return false
  }

  function handleDeath(code: number, signal?: string): void {
    if (exited) return
    exited = true
    disposed = true
    if (retryTimer) {
      clearTimeout(retryTimer)
      retryTimer = undefined
    }
    socket?.destroy()
    socket = undefined
    const trailing = decoder.end()
    if (trailing) {
      for (const fn of dataListeners) fn(trailing)
    }
    for (const fn of exitListeners) fn({ exitCode: code, signal })
  }

  function handleFrame(frame: Frame): void {
    if (frame.kind === DATA_FRAME) {
      const text = decoder.write(frame.payload)
      if (text) {
        for (const fn of dataListeners) fn(text)
      }
    } else if (frame.kind === CTRL_FRAME) {
      const ctrl = frame.ctrl
      if (ctrl.t === 'hello') {
        replPid = (ctrl.replPid as number) || 0
        replVersion = ctrl.version as string | undefined
      } else if (ctrl.t === 'live') {
        if (isLive) decoder.end()
        isLive = true
        resumeFn?.()
      } else if (ctrl.t === 'ping') {
        writeFrame(encodeCtrlFrame({ t: 'pong' }))
      } else if (ctrl.t === 'auth-required') {
        onAuthRejected?.()
      } else if (ctrl.t === 'exit') {
        handleDeath(ctrl.code as number, ctrl.signal as string | undefined)
      }
    }
  }

  function scheduleRetry(): void {
    if (disposed || retryTimer) return
    const delay =
      CONNECT_BACKOFFS[Math.min(connectAttempts, CONNECT_BACKOFFS.length - 1)]!
    connectAttempts++
    retryTimer = setTimeout(() => {
      retryTimer = undefined
      tryConnect()
    }, delay)
    retryTimer.unref?.()
  }

  function tryConnect(): void {
    if (disposed || retryTimer) return
    try {
      process.kill(pid, 0)
    } catch {
      handleDeath(-1)
      return
    }
    if (reconnectCount > 0 && --reconnectCount === 0) {
      handleDeath(-1)
      return
    }
    if (connectAttempts >= MAX_CONNECT_ATTEMPTS) {
      handleDeath(-1)
      return
    }

    const sock = new Socket()
    let connected = false

    sock.on('error', () => scheduleRetry())
    sock.once('close', () => {
      if (socket === sock) socket = undefined
      if (disposed) return
      if (connected && !exited) {
        try {
          process.kill(pid, 0)
        } catch {
          handleDeath(-1)
          return
        }
        reconnectCount = RECONNECT_ATTEMPTS
        connectAttempts = 0
        scheduleRetry()
        return
      }
      scheduleRetry()
    })
    sock.once('connect', () => {
      connected = true
      connectAttempts = 0
      reconnectCount = 0
      socket = sock

      // Official `chunk@302131078.js @9867`: authenticate first and send initial pong
      if (ptyAuthToken) {
        writeFrame(encodeCtrlFrame({ t: 'auth', token: ptyAuthToken }))
      }
      writeFrame(encodeCtrlFrame({ t: 'pong' }))

      for (const frame of pendingWrites.splice(0)) {
        writeFrame(frame)
      }
      pendingBytes = 0

      const parse = createFrameParser(handleFrame, () => sock.destroy())
      sock.on('data', parse)
    })
    sock.connect(sockPath)
  }

  if (childProc) {
    childProc.exited.then(code => {
      if (!exited) handleDeath(code, childProc.signalCode ?? undefined)
    })
  }

  tryConnect()

  return {
    pid,
    replPid: () => replPid,
    replVersion: () => replVersion,
    onResume: fn => {
      resumeFn = fn
    },
    write(data: string) {
      if (exited) return
      const buf = Buffer.from(data, 'utf8')
      for (let i = 0; i < buf.length; i += MAX_WRITE_PAYLOAD) {
        writeFrame(encodeDataFrame(buf.subarray(i, i + MAX_WRITE_PAYLOAD)))
      }
    },
    resize(cols: number, rows: number) {
      writeFrame(encodeCtrlFrame({ t: 'resize', cols, rows }))
    },
    kill(sig: 'SIGTERM' | 'SIGKILL' | 'SIGQUIT') {
      writeFrame(encodeCtrlFrame({ t: 'kill', sig }))
      try {
        process.kill(-pid, sig)
      } catch {
        try {
          process.kill(pid, sig)
        } catch {
          handleDeath(-1)
        }
      }
      if (sig === 'SIGTERM' && !exited) {
        setTimeout(() => {
          if (!exited) {
            try {
              process.kill(-pid, 'SIGKILL')
            } catch {
              try {
                process.kill(pid, 'SIGKILL')
              } catch {}
            }
          }
        }, 5_000).unref?.()
      }
    },
    dispose() {
      if (disposed) return
      disposed = true
      if (retryTimer) {
        clearTimeout(retryTimer)
        retryTimer = undefined
      }
      socket?.destroy()
      socket = undefined
    },
    onData: fn => {
      dataListeners.add(fn)
      return {
        dispose: () => {
          dataListeners.delete(fn)
        },
      }
    },
    onExit: fn => {
      exitListeners.add(fn)
      return {
        dispose: () => {
          exitListeners.delete(fn)
        },
      }
    },
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

  // Official 2.1.328 (`chunk@308385766.js @2567-2850`):
  // Read & scrub per-socket PTY auth token from env or CLAUDE_BG_SOCKET_TOKENS_PATH.
  let ptyAuthToken = process.env.CLAUDE_BG_PTY_AUTH
  delete process.env.CLAUDE_BG_PTY_AUTH
  const tokensPath = process.env.CLAUDE_BG_SOCKET_TOKENS_PATH
  if (tokensPath) {
    const tokens = await readSocketTokensFile(tokensPath)
    if (tokens?.ptyAuth) {
      ptyAuthToken = tokens.ptyAuth
    } else if (!ptyAuthToken) {
      await appendBreadcrumb(
        sockPath,
        'tokens-file unreadable; DATA gate fail-open',
      )
    }
    if (isExecMode) {
      delete process.env.CLAUDE_BG_SOCKET_TOKENS_PATH
      await unlink(tokensPath).catch(() => {})
    }
  }
  const explicitAdmitSilent =
    process.env.CLAUDE_BG_SOCK_ADMIT_SILENT_PEERS === '1'
  if (isExecMode) {
    delete process.env.CLAUDE_BG_SOCK_ADMIT_SILENT_PEERS
  }
  const admitSilentPeers = explicitAdmitSilent || (!ptyAuthToken && !tokensPath)
  const silentPeerTimeoutMs =
    parsePositiveIntEnv(process.env.CLAUDE_BG_SILENT_PEER_TIMEOUT_MS) ??
    DEFAULT_SILENT_PEER_TIMEOUT_MS
  const heartbeatMs =
    parsePositiveIntEnv(process.env.CLAUDE_PTY_HEARTBEAT_MS) ??
    DEFAULT_PTY_HEARTBEAT_MS
  const orphanCheckMs =
    parsePositiveIntEnv(process.env.CLAUDE_PTY_ORPHAN_CHECK_MS) ??
    DEFAULT_PTY_ORPHAN_CHECK_MS
  const exitFile =
    process.env.CLAUDE_PTY_EXIT_FILE ||
    (isExecMode ? getExecExitFilePath(sockPath) : undefined)
  delete process.env.CLAUDE_PTY_EXIT_FILE

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

  let exited = false
  let hadOutput = false
  let pendingSignal: string | null = null
  let hostServer: PtyHostServerHandle | undefined
  const earlyChunks: Buffer[] = []

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
        if (hostServer) {
          hostServer.pushOutput(buf)
        } else {
          earlyChunks.push(buf)
        }
      },
    })
    child = Bun.spawn([cliFile, ...cliArgs], {
      cwd: tryProcessCwd(),
      env: { ...process.env, TERM: 'xterm-256color' },
      terminal,
      windowsHide: true,
      detached: false,
      ...(isSpare ? { argv0: 'claude bg-spare' } : {}),
    })
  } catch (err) {
    writeError(sockPath, `spawn failed: ${String(err)}`)
    return
  }

  const killChildWithFallback = (sig: 'SIGTERM' | 'SIGKILL'): void => {
    try {
      child.kill(sig)
    } catch {}
    if (sig === 'SIGTERM') {
      setTimeout(() => {
        if (!exited) {
          try {
            child.kill('SIGKILL')
          } catch {}
        }
      }, 5_000).unref?.()
    }
  }

  try {
    hostServer = await startPtyHostServer({
      sockPath,
      replPid: child.pid,
      version: typeof MACRO !== 'undefined' ? MACRO.VERSION : undefined,
      ptyAuthToken,
      admitSilentPeers,
      silentPeerTimeoutMs,
      heartbeatMs,
      orphanCheckMs,
      isExecMode,
      exitFile,
      onWrite: payload => {
        if (exited) return
        terminal.write(payload)
        // In exec mode: detect SIGINT/SIGQUIT bytes and forward to process group
        if (isExecMode && process.platform !== 'win32') {
          const sig = payload.includes(3)
            ? 'SIGINT'
            : payload.includes(28)
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
      },
      onResize: (c, r) => {
        terminal.resize(c, r)
        if (process.platform !== 'win32') {
          try {
            process.kill(-process.pid, 'SIGWINCH')
          } catch {}
          try {
            child.kill('SIGWINCH')
          } catch {}
        }
      },
      onKill: killChildWithFallback,
      onOrphanKill: () => killChildWithFallback('SIGTERM'),
      onBreadcrumb: msg => {
        void appendBreadcrumb(sockPath, msg)
      },
      onServerError: err => {
        try {
          child.kill('SIGTERM')
        } catch {}
        writeError(sockPath, `server error: ${err.message}`)
      },
    })
    for (const chunk of earlyChunks.splice(0)) {
      hostServer.pushOutput(chunk)
    }
  } catch (err) {
    try {
      child.kill('SIGTERM')
    } catch {}
    writeError(sockPath, `server listen failed: ${String(err)}`)
    return
  }

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
  const exitCode = await child.exited

  // Drain: wait for final output to flush (official: up to 20 × 5ms, 2 consecutive quiet ticks)
  let quietTicks = 0
  for (let i = 0; i < 20; i++) {
    hadOutput = false
    await new Promise(r => setTimeout(r, 5))
    if (hadOutput) quietTicks = 0
    else if (++quietTicks >= 2) break
  }

  const exitSignal = child.signalCode ?? undefined
  exited = true
  terminal.close()

  // In exec mode: SIGHUP the process group
  if (isExecMode && process.platform !== 'win32') {
    pendingSignal = 'SIGHUP'
    try {
      process.kill(-process.pid, 'SIGHUP')
    } catch {}
  }

  // Write exec exit-tail sidecar & broadcast exit frame
  hostServer.markExited(exitCode, exitSignal)

  // Wait briefly for late attachers (official: 5s)
  await hostServer.waitForLateAttacher(5_000)

  // Tear down
  await hostServer.close()
  process.exit(exitCode)
}

async function appendBreadcrumb(sockPath: string, msg: string): Promise<void> {
  try {
    const errPath = `${sockPath}.err`
    await mkdir(dirname(errPath), { recursive: true })
    await appendFile(errPath, `${new Date().toISOString()} ${msg}\n`)
  } catch {
    // best-effort breadcrumb
  }
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
