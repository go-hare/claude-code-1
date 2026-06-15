/**
 * BgWorker — manages a single background session's lifecycle.
 *
 * Upstream equivalent: class `zF` in the official 2.1.153 binary.
 *
 * Responsibilities:
 *   - Connects to PTY host socket via wirePty (frame protocol)
 *   - Manages attacher connections (FleetView attach)
 *   - Tracks DEC mode state for terminal restore on detach
 *   - Provides resizeForRepaint for triggering Ink redraws
 *   - Manages rendezvous socket for daemon ↔ CLI communication
 *   - Handles worker lifecycle: spawn → running → retiring → retired
 *   - Roster serialization for supervisor persistence
 *   - Adopt / claim / unverified static constructors
 */

import { Socket } from 'net'
import { join, resolve, dirname } from 'path'
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  accessSync,
  unlinkSync,
} from 'fs'
import {
  mkdir,
  unlink,
  readFile,
  writeFile,
  readdir,
  lstat,
  access,
} from 'fs/promises'
import { randomBytes } from 'crypto'
import { getClaudeConfigHomeDir } from '../utils/envUtils.js'
import { isInBundledMode } from '../utils/bundledMode.js'
import {
  encodeDataFrame,
  encodeCtrlFrame,
  createFrameParser,
  DATA_FRAME,
  CTRL_FRAME,
  MAX_FRAME_SIZE,
  RING_BUFFER_SIZE,
  type Frame,
} from './ptyHost.js'
import {
  type BgJobState,
  readBgJobState,
  writeBgJobState,
  getJobDirPath,
  isTerminalState,
} from './jobState.js'

// ---------------------------------------------------------------------------
// Constants — official values from 2.1.153
// ---------------------------------------------------------------------------

/** Max data frame payload for writes to PTY (official: W__ - 1) */
const MAX_WRITE_PAYLOAD = MAX_FRAME_SIZE - 1

/** Connect retry backoff schedule (ms) — official B64 */
const CONNECT_BACKOFFS = [50, 100, 250, 500, 1000, 2000]

/** Max connect attempts before declaring host dead — official U64 */
const MAX_CONNECT_ATTEMPTS = 30

/** Reconnect attempts after unexpected disconnect — official KfO */
const RECONNECT_ATTEMPTS = 4

/** Drain timeout for slow PTY socket (ms) — official OfO */
const DRAIN_TIMEOUT_MS = 10_000

/** Backpressure limit (8 × MAX_FRAME_SIZE) — official F64 */
const BACKPRESSURE_LIMIT = 8 * MAX_FRAME_SIZE

/** Backpressure kill timeout (ms) — official TfO */
const BACKPRESSURE_KILL_MS = 50

/** Fast crash threshold (ms) — official a64 */
const FAST_CRASH_MS = 5_000

/** Max respawn attempts — official o64 */
const MAX_RESPAWN_ATTEMPTS = 20

/** Respawn backoff delay (ms) — official $fO */
const RESPAWN_BACKOFF_MS = 10_000

/** Ring buffer max string length — official EV_ (reused from ptyHost) */
const RING_MAX_BYTES = RING_BUFFER_SIZE

/** preInitErrorTail max chars — official s64 */
const PRE_INIT_ERROR_TAIL_MAX = 200

/** cappedDispatch max string length — official t64 */
const CAPPED_DISPATCH_MAX_STR = 4096

/** Protocol version — official P5 */
export const PROTO_VERSION = 1

/** Min protocol version — official CV_ */
export const MIN_PROTO_VERSION = 1

/** Recent adopt grace (ms) — official AfO */
const RECENT_ADOPT_GRACE_MS = 120_000

/** Default retire grace (ms) — official Z3q */
export const RETIRE_GRACE_MS = 60_000

/** Retire grace for non-low-mem (ms) — official WmO */
export const RETIRE_GRACE_LONG_MS = 3_600_000

/** Tick interval (ms) — official G3q */
export const TICK_INTERVAL_MS = 60_000

/** PID poll interval (ms) — official cqq */
const PID_POLL_INTERVAL_MS = 5_000

/** Stalled threshold (ms) — official YfO */
const STALLED_THRESHOLD_MS = 120_000

/** RV max connect attempts — official l64 */
const RV_MAX_CONNECT_ATTEMPTS = 30

/** RV connect backoffs (ms) — official c64 */
const RV_CONNECT_BACKOFFS = [100, 250, 500, 1000, 2000]

/** Empty idle grace (ms) — official wfO */
const EMPTY_IDLE_GRACE_MS = 300_000

/** Exec tracker detail max length — official Eh6 */
const EXEC_DETAIL_MAX = 120

/** Exec tracker tick interval (ms) — official m64 */
const EXEC_TICK_MS = 2_000

/** Detach sequence — official dSH */
const DETACH_SEQ = '\x1B_cc-daemon-detach\x1B\\'

/** Detach message prefix — official Hr8 */
const DETACH_MSG_PREFIX = '\x1B_cc-detach-msg;'

/** String Terminator — official FLK */
const ST = '\x1B\\'

/** Focus-in sequence — official iLH */
const FOCUS_IN = '\x1B[I'

/** Focus-out sequence — official rLH */
const FOCUS_OUT = '\x1B[O'

// ---------------------------------------------------------------------------
// Signal (simple event emitter) — official C7
// ---------------------------------------------------------------------------

export interface Signal<T extends unknown[] = []> {
  subscribe(fn: (...args: T) => void): () => void
  emit(...args: T): void
  clear(): void
}

export function createSignal<T extends unknown[] = []>(): Signal<T> {
  const listeners = new Set<(...args: T) => void>()
  return {
    subscribe(fn) {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    },
    emit(...args) {
      for (const fn of listeners) {
        fn(...args)
      }
    },
    clear() {
      listeners.clear()
    },
  }
}

// ---------------------------------------------------------------------------
// DEC Mode Tracker — official fy_
// ---------------------------------------------------------------------------

const TRACKED_DEC_MODES = new Set([
  1, 7, 25, 1000, 1002, 1003, 1004, 1006, 1049, 2004,
])

// biome-ignore lint/suspicious/noControlCharactersInRegex: terminal escape parsing
const DEC_MODE_RE = /\x1b\[?(\d+(?:;\d+)*)(h|l)/g

export interface DecModeTracker {
  feed(data: string, onSet?: (mode: number) => void): boolean
  snapshot(): number[]
  seed(modes: number[]): void
}

export function createDecModeTracker(): DecModeTracker {
  const active = new Set<number>()
  let partial = ''

  return {
    feed(data: string, onSet?: (mode: number) => void): boolean {
      const combined = partial ? partial + data : data
      DEC_MODE_RE.lastIndex = 0
      let match: RegExpExecArray | null
      let lastEnd = 0
      let changed = false
      while ((match = DEC_MODE_RE.exec(combined)) !== null) {
        const isSet = match[2] === 'h'
        for (const modeStr of match[1]!.split(';')) {
          const mode = Number(modeStr)
          if (TRACKED_DEC_MODES.has(mode) && active.has(mode) !== isSet) {
            if (isSet) {
              active.add(mode)
              onSet?.(mode)
            } else active.delete(mode)
            changed = true
          }
        }
        lastEnd = match.index + match[0].length
      }
      const tail = combined.slice(Math.max(lastEnd, combined.length - 20))
      partial = tail.includes('\x1b')
        ? tail.slice(tail.lastIndexOf('\x1b'))
        : ''
      return changed
    },
    snapshot() {
      return [...active].sort((a, b) => a - b)
    },
    seed(modes: number[]) {
      active.clear()
      for (const m of modes) {
        if (TRACKED_DEC_MODES.has(m)) active.add(m)
      }
    },
  }
}

// ---------------------------------------------------------------------------
// PTY Connection — official Ch6
// ---------------------------------------------------------------------------

export interface PtyConnection {
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

export function connectToPtyHost(
  sockPath: string,
  pid: number,
  procStart: string | undefined,
  short: string,
  childProc?: { exited: Promise<number>; signalCode?: string | null },
): PtyConnection {
  const onData = createSignal<[string]>()
  const onExit = createSignal<[{ exitCode: number; signal?: string }]>()

  let socket: Socket | undefined
  let replPid = 0
  let replVersion: string | undefined
  let disposed = false
  let exited = false
  let connectAttempts = 0
  let reconnectCount = 0
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let drainTimer: ReturnType<typeof setTimeout> | undefined
  let pressureTimer: ReturnType<typeof setTimeout> | undefined
  let isLive = false
  let resumeFn: (() => void) | undefined
  const pendingWrites: Buffer[] = []
  let pendingBytes = 0

  const { StringDecoder } =
    require('string_decoder') as typeof import('string_decoder')
  const decoder = new StringDecoder('utf8')

  function writeFrame(frame: Buffer): boolean {
    if (socket) {
      if (socket.destroyed) return false
      if (!socket.write(frame)) {
        if (!drainTimer) {
          drainTimer = setTimeout(() => {
            drainTimer = undefined
            socket?.destroy()
          }, DRAIN_TIMEOUT_MS)
          drainTimer.unref()
        }
        if (!pressureTimer && socket.writableLength > BACKPRESSURE_LIMIT) {
          pressureTimer = setTimeout(() => {
            if (pressureTimer) {
              pressureTimer = undefined
              if (
                socket &&
                !socket.destroyed &&
                socket.writableLength > BACKPRESSURE_LIMIT
              ) {
                clearDrainTimers()
                socket.destroy()
              }
            }
          }, BACKPRESSURE_KILL_MS)
          pressureTimer.unref()
        }
        return true
      }
      return true
    }
    if (pendingBytes < 2 * MAX_FRAME_SIZE) {
      pendingWrites.push(frame)
      pendingBytes += frame.length
    }
    return false
  }

  function clearDrainTimers(): void {
    if (drainTimer) {
      clearTimeout(drainTimer)
      drainTimer = undefined
    }
    if (pressureTimer) {
      clearTimeout(pressureTimer)
      pressureTimer = undefined
    }
  }

  function handleDeath(code: number, signal?: string): void {
    if (exited) return
    exited = true
    disposed = true
    if (retryTimer) {
      clearTimeout(retryTimer)
      retryTimer = undefined
    }
    clearDrainTimers()
    socket?.destroy()
    socket = undefined
    const trailing = decoder.end()
    if (trailing) onData.emit(trailing)
    onExit.emit({ exitCode: code, signal })
  }

  function handleFrame(frame: Frame): void {
    if (frame.kind === DATA_FRAME) {
      onData.emit(decoder.write(frame.payload))
    } else if (frame.kind === CTRL_FRAME) {
      const ctrl = frame.ctrl
      if (ctrl.t === 'hello') {
        replPid = (ctrl.replPid as number) || 0
        replVersion = ctrl.version as string | undefined
      } else if (ctrl.t === 'live') {
        if (isLive) {
          decoder.end()
        }
        isLive = true
        resumeFn?.()
      } else if (ctrl.t === 'exit') {
        handleDeath(ctrl.code as number, ctrl.signal as string | undefined)
      }
    }
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

    sock.on('error', () => {
      scheduleRetry()
    })
    sock.once('close', () => {
      if (socket === sock) socket = undefined
      clearDrainTimers()
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
      sock.on('drain', clearDrainTimers)

      for (const frame of pendingWrites.splice(0)) {
        writeFrame(frame)
      }
      pendingBytes = 0

      const parse = createFrameParser(handleFrame, () => {
        sock.destroy()
      })
      sock.on('data', parse)
    })
    sock.connect(sockPath)
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
    retryTimer.unref()
  }

  // If we have a child process handle, listen for its exit
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
      const sent = writeFrame(encodeCtrlFrame({ t: 'kill', sig }))
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
              } catch {
                handleDeath(-1)
              }
            }
          }
        }, 5000).unref()
      }
      void sent
    },
    dispose() {
      if (disposed) return
      disposed = true
      if (retryTimer) {
        clearTimeout(retryTimer)
        retryTimer = undefined
      }
      clearDrainTimers()
      socket?.destroy()
      socket = undefined
    },
    onData: fn => ({ dispose: onData.subscribe(fn) }),
    onExit: fn => ({ dispose: onExit.subscribe(fn) }),
  }
}

// ---------------------------------------------------------------------------
// Rendezvous Connection — official i64
// Connects to the CLI's rendezvous socket for state/heartbeat/reply.
// ---------------------------------------------------------------------------

export interface RvConnection {
  send(msg: Record<string, unknown>): boolean
  close(): void
}

export function connectRendezvous(
  sockPath: string,
  onMessage: (msg: Record<string, unknown>) => void,
  onDisconnect: () => void,
  onReady?: () => void,
): RvConnection {
  let socket: Socket | undefined
  let closed = false
  let attempts = 0
  let gaveUp = false
  let retryTimer: ReturnType<typeof setTimeout> | undefined

  function connect(): void {
    if (closed) return
    const sock = new Socket()
    let connected = false

    sock.on('error', () => scheduleRetry())
    sock.once('close', () => {
      if (socket === sock) socket = undefined
      if (closed) return
      if (connected) onDisconnect()
      scheduleRetry()
    })
    sock.once('connect', () => {
      connected = true
      attempts = 0
      gaveUp = false
      socket = sock
      onReady?.()
      // Send hello
      sock.write(
        JSON.stringify({
          proto: PROTO_VERSION,
          role: 'supervisor',
          supervisorPid: process.pid,
        }) + '\n',
      )
      // Line-based message reader
      const { StringDecoder } =
        require('string_decoder') as typeof import('string_decoder')
      const dec = new StringDecoder('utf8')
      let buf = ''
      sock.on('data', (chunk: Buffer) => {
        buf += dec.write(chunk)
        let idx: number
        while ((idx = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, idx)
          buf = buf.slice(idx + 1)
          if (!line) continue
          try {
            const msg = JSON.parse(line) as Record<string, unknown>
            if (msg && typeof msg === 'object' && 'type' in msg) {
              onMessage(msg)
            }
          } catch {}
        }
        if (buf.length > 1_048_576) {
          sock.destroy()
        }
      })
    })
    sock.connect(sockPath)
  }

  function scheduleRetry(): void {
    if (closed || retryTimer || gaveUp) return
    if (attempts >= RV_MAX_CONNECT_ATTEMPTS) {
      gaveUp = true
      return
    }
    const delay =
      RV_CONNECT_BACKOFFS[Math.min(attempts, RV_CONNECT_BACKOFFS.length - 1)]!
    attempts++
    retryTimer = setTimeout(() => {
      retryTimer = undefined
      connect()
    }, delay)
    retryTimer.unref()
  }

  connect()

  return {
    send(msg: Record<string, unknown>): boolean {
      if (!socket || socket.destroyed) {
        if (attempts >= RV_MAX_CONNECT_ATTEMPTS) {
          attempts = 0
          gaveUp = false
          scheduleRetry()
        }
        return false
      }
      try {
        socket.write(JSON.stringify(msg) + '\n')
        return true
      } catch {
        return false
      }
    },
    close() {
      if (closed) return
      closed = true
      if (retryTimer) clearTimeout(retryTimer)
      socket?.destroy()
      socket = undefined
    },
  }
}

// ---------------------------------------------------------------------------
// Path helpers — official Os, u__, Wo8, x__, BU, OCH, Zo8, tV_, bOH
// ---------------------------------------------------------------------------

/** Daemon instance directory — official Os() = /tmp/cc-daemon-<uid>/<hash>/ */
let _instanceDir: string | undefined
export function getDaemonInstanceDir(): string {
  if (_instanceDir) return _instanceDir
  const crypto = require('crypto') as typeof import('crypto')
  const configDir = resolve(getClaudeConfigHomeDir())
  const hash = crypto
    .createHash('sha256')
    .update(configDir)
    .digest('hex')
    .slice(0, 8)
  const uid = process.getuid?.() ?? 0
  const tmpDir =
    process.env.TERMUX_VERSION && process.env.PREFIX
      ? join(process.env.PREFIX, 'tmp')
      : '/tmp'
  _instanceDir = join(tmpDir, `cc-daemon-${uid}`, hash)
  return _instanceDir
}

/** PTY socket directory — official u__() */
export function getPtyDir(): string {
  return join(getDaemonInstanceDir(), 'pty')
}

/** Rendezvous socket directory — official Wo8() */
export function getRvDir(): string {
  return join(getDaemonInstanceDir(), 'rv')
}

/** Spare pool directory — official Rl() */
export function getSpareDir(): string {
  return join(getDaemonInstanceDir(), 'spare')
}

/** Auth snapshot directory — official Zo8() */
export function getAuthDir(): string {
  return join(getDaemonInstanceDir(), 'auth')
}

/** Dispatch directory — official OCH() */
export function getDispatchDir(): string {
  return join(getClaudeConfigHomeDir(), 'daemon', 'dispatch')
}

/** Control socket path — official Ll() */
export function getControlSocketPath(): string {
  if (process.platform === 'win32') {
    return getNamedPipe('control')
  }
  return join(getDaemonInstanceDir(), 'control.sock')
}

/** PTY socket path for a given short ID — official BU() */
export function getPtySockPath(short: string): string {
  if (process.platform === 'win32') {
    return getNamedPipe(`pty-${short}`)
  }
  return join(getPtyDir(), `${short}.sock`)
}

/** Rendezvous socket path for a given short ID — official x__() */
export function getRendezvousSockPath(short: string): string {
  if (process.platform === 'win32') {
    return getNamedPipe(`rv-${short}`)
  }
  return join(getRvDir(), `${short}.sock`)
}

/** Error file path for a PTY socket — official IE() */
export function getPtyErrPath(sockPath: string): string {
  if (process.platform === 'win32') {
    const name = sockPath.split('\\').pop()!
    return join(getPtyDir(), `${name}.err`)
  }
  return `${sockPath}.err`
}

/** Dispatch file path — official tV_() */
export function getDispatchFilePath(short: string): string {
  return join(getAuthDir(), `${short}.json`)
}

/** Roster file path — official bOH() */
export function getRosterPath(): string {
  return join(getClaudeConfigHomeDir(), 'daemon', 'roster.json')
}

/** Daemon config directory — official KCH() */
export function getDaemonConfigDir(): string {
  return join(getClaudeConfigHomeDir(), 'daemon')
}

/** Windows named pipe helper — Bun 1.x has a 42-char path limit (Node.js doesn't) */
function getNamedPipe(name: string): string {
  const pipeKey = getPipeKey()
  return `\\\\.\\pipe\\ccd-${pipeKey}-${name}`
}

let _pipeKey: string | undefined
function getPipeKey(): string {
  if (_pipeKey) return _pipeKey
  const keyFile = join(getDaemonConfigDir(), 'pipe.key')
  try {
    _pipeKey = readFileSync(keyFile, 'utf8').trim()
    return _pipeKey
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
  }
  _pipeKey = randomBytes(8).toString('hex')
  mkdirSync(getDaemonConfigDir(), { recursive: true, mode: 0o700 })
  try {
    writeFileSync(keyFile, _pipeKey, { flag: 'wx', mode: 0o600 })
  } catch {
    // Race: another process wrote it first
    _pipeKey = readFileSync(keyFile, 'utf8').trim()
  }
  return _pipeKey
}

// ---------------------------------------------------------------------------
// Exec Tracker — official dqq
// Monitors exec-mode output to update job state with last line / tempo.
// ---------------------------------------------------------------------------

export interface ExecTracker {
  feed(data: string): void
  dispose(): void
  readonly lastLine: string
}

export function createExecTracker(jobDir: string): ExecTracker {
  let partial = ''
  let lastLine = ''
  let hasInput = true
  let lastInputAt = 0
  let lastHash = ''
  let disposed = false

  function sync(state: string, tempo: string): void {
    const detail = stripAnsi(lastLine).slice(0, EXEC_DETAIL_MAX)
    const hash = `${state}|${tempo}|${detail}`
    if (hash === lastHash) return
    lastHash = hash
    const current = readBgJobState(jobDir.split('/').pop()!)
    if (!current || disposed) return
    writeBgJobState(jobDir.split('/').pop()!, {
      ...current,
      state: state as BgJobState['state'],
      tempo: tempo as BgJobState['tempo'],
      detail,
      updatedAt: new Date().toISOString(),
    })
  }

  const timer = setInterval(() => {
    if (lastInputAt === 0) return
    if (Date.now() - lastInputAt < EXEC_TICK_MS) {
      sync('working', 'active')
    } else if (!hasInput && lastLine) {
      sync('blocked', 'blocked')
    } else {
      sync('working', 'idle')
    }
  }, EXEC_TICK_MS)
  timer.unref()

  return {
    feed(data: string) {
      // biome-ignore lint/suspicious/noControlCharactersInRegex: terminal bell char
      const clean = stripAnsi(data.replace(/\x07/g, '\x00'))
        .replace(/\r\n?/g, '\n')
        .replace(/\0+$/g, '')
        .replace(/\0/g, '\n')
      if (!clean) return
      lastInputAt = Date.now()
      partial += clean
      const lines = partial.split('\n')
      partial = lines.pop() ?? ''
      hasInput = partial === ''
      lastLine =
        partial.trim() || lines.findLast(l => l.trim())?.trim() || lastLine
      if (partial.length > EXEC_DETAIL_MAX * 2) {
        partial = partial.slice(-EXEC_DETAIL_MAX)
      }
      if (lastHash.startsWith('blocked|')) {
        sync('working', 'active')
      }
    },
    dispose() {
      disposed = true
      clearInterval(timer)
    },
    get lastLine() {
      return stripAnsi(lastLine).slice(0, EXEC_DETAIL_MAX)
    },
  }
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

/** Strip ANSI escape sequences — official D5 */
function stripAnsi(s: string): string {
  return s.replace(
    // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping terminal escapes
    /\x1b\[[0-9;]*[a-zA-Z]|\x1b\][^\x07]*\x07|\x1b[()][0-9A-B]|\x1b\[[0-9;]*m/g,
    '',
  )
}

/** Encode detach message — official MqH */
export function encodeDetachMsg(msg?: string): string {
  if (!msg) return DETACH_SEQ
  return DETACH_MSG_PREFIX + msg + ST + DETACH_SEQ
}

/** Check if a socket is alive by attempting connect — official Jy6 */
export function isSocketAlive(sockPath: string): Promise<boolean> {
  return new Promise(resolve => {
    let done = false
    const finish = (alive: boolean) => {
      if (done) return
      done = true
      resolve(alive)
    }
    const sock = new Socket()
    sock.unref()
    sock.setTimeout(250, () => {
      sock.destroy()
      finish(false)
    })
    sock.on('error', () => finish(false))
    sock.once('connect', () => {
      sock.destroy()
      finish(true)
    })
    sock.connect(sockPath)
  })
}

/** Kill a PTY host by connecting and sending kill frame — official aCH */
export function killPtyHost(sockPath: string): Promise<boolean> {
  return new Promise(resolve => {
    let done = false
    const finish = (killed: boolean) => {
      if (done) return
      done = true
      resolve(killed)
    }
    const sock = new Socket()
    sock.unref()
    sock.setTimeout(2000, () => {
      sock.destroy()
      finish(false)
    })
    sock.on('error', () => {
      unlink(sockPath).catch(() => {})
      unlink(getPtyErrPath(sockPath)).catch(() => {})
      finish(false)
    })
    sock.once('connect', () => {
      sock.resume()
      sock.write(encodeCtrlFrame({ t: 'kill', sig: 'SIGTERM' }))
      sock.end()
    })
    sock.once('close', () => finish(true))
    sock.connect(sockPath)
  })
}

/** Get process start time (for PID recycling detection) — official ey */
const procStartCache = new Map<
  number,
  { at: number; p: Promise<string | undefined> }
>()
const PROC_START_CACHE_TTL = 5000

export async function getProcessStartTime(
  pid: number,
  opts?: { skipCache?: boolean },
): Promise<string | undefined> {
  const now = Date.now()
  if (!opts?.skipCache) {
    const cached = procStartCache.get(pid)
    if (cached && now - cached.at < PROC_START_CACHE_TTL) return cached.p
  }
  const p = getProcessStartTimeRaw(pid)
  const entry = { at: now, p }
  procStartCache.set(pid, entry)
  const result = await p
  if (result === undefined && procStartCache.get(pid) === entry) {
    procStartCache.delete(pid)
  }
  return result
}

async function getProcessStartTimeRaw(
  pid: number,
): Promise<string | undefined> {
  try {
    const { execSync } =
      require('child_process') as typeof import('child_process')
    const out = execSync(`LC_ALL=C TZ=UTC ps -o lstart= -p ${pid}`, {
      timeout: 1000,
      encoding: 'utf8',
    })
    return out?.trim() || undefined
  } catch {
    return undefined
  }
}

/** Synchronous process start time — official VKH */
export function getProcessStartTimeSync(pid: number): string | undefined {
  try {
    const { execSync } =
      require('child_process') as typeof import('child_process')
    const out = execSync(`LC_ALL=C TZ=UTC ps -o lstart= -p ${pid}`, {
      timeout: 1000,
      encoding: 'utf8',
    })
    return out?.trim() || undefined
  } catch {
    return undefined
  }
}

/** Read exit cause file from job dir — official pp6 */
function readExitCause(jobDir: string): string | undefined {
  const causePath = join(jobDir, 'exit-cause')
  try {
    const cause = readFileSync(causePath, 'utf8')
    unlinkSync(causePath)
    return cause
  } catch {
    return undefined
  }
}

/** Check if process is alive */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Worker Phase State Machine — official phase types + jfO validator
// ---------------------------------------------------------------------------

export type WorkerPhase =
  | { kind: 'spawning' }
  | { kind: 'running' }
  | { kind: 'upgrading' }
  | { kind: 'retiring'; reason: 'reap' | 'grace' | 'stop' }
  | { kind: 'retired'; outcome: string }

function isValidTransition(from: WorkerPhase, to: WorkerPhase): boolean {
  if (from.kind === 'retired') return false
  switch (to.kind) {
    case 'spawning':
      return from.kind === 'upgrading' || from.kind === 'running'
    case 'running':
      return from.kind === 'spawning'
    case 'upgrading':
      return from.kind === 'running'
    case 'retiring':
      return true
    case 'retired':
      return true
  }
}

function phaseToString(phase: WorkerPhase): string {
  if (phase.kind === 'retiring') return `retiring:${phase.reason}`
  if (phase.kind === 'retired') return `retired:${phase.outcome}`
  return phase.kind
}

// ---------------------------------------------------------------------------
// Dispatch Request — the shape of a bg session dispatch
// ---------------------------------------------------------------------------

export interface DispatchRequest {
  short: string
  nonce?: string
  sessionId: string
  intent: string
  name?: string
  agent?: string
  routine?: string
  cwd: string
  respawnFlags: string[]
  source: string
  createdAt: number
  cols?: number
  rows?: number
  env?: Record<string, string>
  isolation?: 'worktree' | 'none'
  worktree?: { path: string }
  attachStallRespawns?: number
  seed?: { intent?: string; name?: string }
  reattachEnv?: Record<string, string>
  launch: {
    mode: 'prompt' | 'resume' | 'exec'
    sessionId?: string
    fork?: boolean
    flagArgs?: string[]
    args?: string[]
    cmd?: string
  }
}

// ---------------------------------------------------------------------------
// Worker Record — the public state exposed to subscribers/FleetView
// ---------------------------------------------------------------------------

export interface WorkerRecord {
  short: string
  nonce?: string
  sessionId: string
  pid: number
  attempt: number
  startedAt: number
  cwd: string
  backend: string
  tempo: string
  state: string
  detail: string
  intent: string
  name?: string
  agent?: string
  routine?: string
  worktreePath?: string
  cliVersion?: string
  source: string
  outcome?: string
  settledAt?: number
  messagingSock?: string
  legacy?: boolean
}

// ---------------------------------------------------------------------------
// Roster Entry — serialized to roster.json for adopt on restart
// ---------------------------------------------------------------------------

export interface RosterEntry {
  pid: number
  procStart?: string
  sessionId: string
  rendezvousSock: string
  ptySock?: string
  messagingSock?: string
  cliVersion?: string
  startedAt: number
  attempt: number
  cwd: string
  worktreePath?: string
  dispatch: DispatchRequest
  pendingRespawn?: 'upgrade'
  decModes?: number[]
}

export interface RosterFile {
  proto: number
  supervisorPid: number
  updatedAt: number
  workers: Record<string, RosterEntry>
  parseFailed?: boolean
}

// ---------------------------------------------------------------------------
// SpawnPty callback type — official nqq default
// ---------------------------------------------------------------------------

export type SpawnPtyFn = (
  cmd: string,
  args: string[],
  opts: {
    cols: number
    rows: number
    cwd: string
    env: Record<string, string | undefined>
    ptySock: string
    short: string
  },
) => PtyConnection

/** Default spawnPty using Bun.spawn + PTY host — official nqq */
export function createDefaultSpawnPty(): SpawnPtyFn {
  return (cmd, args, opts) => {
    const spawnArgs = buildPtyHostSpawnArgs(cmd, args, {
      cols: opts.cols,
      rows: opts.rows,
      ptySock: opts.ptySock,
      runtimeFlags: process.execArgv ?? [],
      bundled: isInBundledMode(),
    })

    const child = Bun.spawn(spawnArgs, {
      cwd: opts.cwd,
      env: opts.env,
      stdio: ['ignore', 'ignore', 'ignore'],
      detached: true,
      windowsHide: true,
    })
    child.unref()
    return connectToPtyHost(
      opts.ptySock,
      child.pid,
      undefined,
      opts.short,
      child,
    )
  }
}

export function buildPtyHostSpawnArgs(
  cmd: string,
  args: string[],
  opts: {
    cols: number
    rows: number
    ptySock: string
    runtimeFlags?: string[]
    bundled?: boolean
  },
): string[] {
  const runtimeFlags = opts.runtimeFlags ?? []
  const bundled = opts.bundled ?? isInBundledMode()
  const scriptPath = bundled ? undefined : args[0]
  const cliArgs = bundled ? args : args.slice(1)
  const scriptPrefix = scriptPath ? [scriptPath] : []

  return [
    cmd,
    ...runtimeFlags,
    ...scriptPrefix,
    '--bg-pty-host',
    opts.ptySock,
    String(opts.cols),
    String(opts.rows),
    '--',
    cmd,
    ...runtimeFlags,
    ...scriptPrefix,
    ...cliArgs,
  ]
}

/** Get the binary path for spawning — official WE */
export function getBinaryPath(opts?: { pinToCurrentBinary?: boolean }): {
  cmd: string
  prefixArgs: string[]
} {
  if (isInBundledMode()) {
    return { cmd: process.execPath, prefixArgs: [] }
  }
  const argv1 = process.argv[1]
  if (!argv1) return { cmd: process.execPath, prefixArgs: [] }
  return { cmd: process.execPath, prefixArgs: [argv1] }
}

// ---------------------------------------------------------------------------
// Worker Class — official zF
// ---------------------------------------------------------------------------

export class BgWorker {
  // --- Core identity ---
  dispatch: DispatchRequest
  private spawnPty: SpawnPtyFn | undefined
  private getAuthSnapshot: (() => Promise<string | undefined>) | undefined
  via: string
  record: WorkerRecord

  // --- Signals ---
  onStream = createSignal<[string]>()
  onState = createSignal<[Record<string, unknown>]>()
  onSettle = createSignal<[string]>()
  onRepaintDone = createSignal<[]>()

  // --- Attach ---
  attachers = new Map<string | object, AttacherEntry>()

  // --- PTY ---
  pty: PtyConnection | undefined
  procStart: string | undefined
  ptyCols = 200
  ptyRows = 50
  decModes: DecModeTracker = createDecModeTracker()
  private execTracker: ExecTracker | undefined
  execLastLine: string | undefined
  private offData: { dispose(): void } | undefined
  private offExit: { dispose(): void } | undefined

  // --- Ring buffer ---
  private ring: string[] = []
  private ringBytes = 0
  private ringSpawnMark = 0

  // --- Lifecycle ---
  attempt = 0
  private lastSpawnAt = 0
  private fastCrashStreak = 0
  private lastExitCause: string | undefined
  private backoffTimer: ReturnType<typeof setTimeout> | null = null
  private pidPoll: ReturnType<typeof setInterval> | null = null

  // --- Rendezvous ---
  private rv: RvConnection | undefined
  rvSockPath: string | undefined
  ptySockPath: string | undefined
  private unverifiedSock: string | undefined

  // --- Phase ---
  private phase: WorkerPhase = { kind: 'spawning' }
  private workerReady = false
  private resizeDeferred = false
  lastInputAt: number | undefined
  deleteJobDirOnSettle = false
  adoptedAt: number | undefined
  private lastRvHeartbeat: number | undefined
  private stalledLogged = false
  private lastCheckPidAt = Date.now()
  private replyChain = Promise.resolve()
  private killOutcome: string = 'killed'
  private pidPollTick = 0

  // --- Getters (official) ---
  get shouldDeleteJobDir(): boolean {
    return this.deleteJobDirOnSettle
  }
  get isKilling(): boolean {
    return this.phase.kind === 'retiring' && this.phase.reason === 'reap'
  }
  get isRetiring(): boolean {
    return this.phase.kind === 'retiring' && this.phase.reason === 'grace'
  }
  get isUnverified(): boolean {
    return this.unverifiedSock !== undefined
  }
  getPhase(): WorkerPhase {
    return this.phase
  }
  get isTransitioning(): boolean {
    return this.phase.kind !== 'running' || !this.pty || this.record.pid === 0
  }
  get isDetached(): boolean {
    return this.phase.kind === 'retiring' && this.phase.reason === 'stop'
  }

  // --- Phase transitions ---
  transitionTo(next: WorkerPhase): boolean {
    if (!isValidTransition(this.phase, next)) {
      console.warn(
        `[bg] illegal worker-phase transition ${phaseToString(this.phase)} → ${phaseToString(next)} for ${this.record.short}`,
      )
      return false
    }
    this.phase = next
    return true
  }

  // --- Constructor ---
  constructor(
    dispatch: DispatchRequest,
    spawnPty: SpawnPtyFn | undefined,
    getAuthSnapshot: (() => Promise<string | undefined>) | undefined,
    via: string,
    overrides?: Partial<WorkerRecord>,
  ) {
    this.dispatch = dispatch
    this.spawnPty = spawnPty
    this.getAuthSnapshot = getAuthSnapshot
    this.via = via
    this.record = {
      short: dispatch.short,
      nonce: dispatch.nonce,
      sessionId: dispatch.sessionId,
      pid: 0,
      attempt: 0,
      startedAt: Date.now(),
      cwd: dispatch.cwd,
      backend: 'daemon',
      tempo: 'active',
      state: 'starting',
      detail: '',
      intent: dispatch.seed?.intent ?? '',
      name: dispatch.seed?.name ?? dispatch.name,
      agent: dispatch.agent,
      routine: dispatch.routine,
      worktreePath: dispatch.worktree?.path,
      cliVersion: MACRO.VERSION,
      source: dispatch.source,
      ...overrides,
    }
    if (dispatch.cols) this.ptyCols = dispatch.cols
    if (dispatch.rows) this.ptyRows = dispatch.rows
  }

  // --- Static constructors ---

  static spawn(
    dispatch: DispatchRequest,
    spawnPty?: SpawnPtyFn,
    getAuthSnapshot?: () => Promise<string | undefined>,
    opts?: { afterUpgrade?: boolean },
  ): BgWorker {
    const w = new BgWorker(
      dispatch,
      spawnPty ?? createDefaultSpawnPty(),
      getAuthSnapshot,
      'cold',
    )
    if (opts?.afterUpgrade) {
      w.attempt = 1
      w.buildBridgeReattachEnvFromState().then(env => w.doSpawn(env))
      return w
    }
    w.doSpawn(dispatch.reattachEnv)
    return w
  }

  static claim(
    dispatch: DispatchRequest,
    spare: {
      pid: number
      ptySockPath: string
      spawnPty: SpawnPtyFn
      getAuthSnapshot?: () => Promise<string | undefined>
    },
  ): BgWorker {
    const w = new BgWorker(
      dispatch,
      spare.spawnPty,
      spare.getAuthSnapshot,
      'spare',
      {
        pid: spare.pid,
        attempt: 1,
        state: 'running',
        cliVersion: MACRO.VERSION,
      },
    )
    w.attempt = 1
    w.ptySockPath = spare.ptySockPath
    w.rvSockPath = getRendezvousSockPath(dispatch.short)
    w.wirePty(
      connectToPtyHost(spare.ptySockPath, spare.pid, undefined, dispatch.short),
    )
    w.resize(dispatch.cols ?? 200, dispatch.rows ?? 50)
    w.connectRv()
    getProcessStartTime(spare.pid, { skipCache: true }).then(start => {
      if (w.record.pid !== spare.pid || w.isDetached || w.record.outcome) return
      if (start) w.procStart = start
      w.patch({ pid: spare.pid })
    })
    return w
  }

  static async adopt(
    short: string,
    entry: RosterEntry,
    spawnPty: SpawnPtyFn,
    getAuthSnapshot?: () => Promise<string | undefined>,
  ): Promise<BgWorker | null> {
    // Check if PID is alive
    try {
      process.kill(entry.pid, 0)
    } catch (e: unknown) {
      const code = (e as NodeJS.ErrnoException).code
      if (code === 'ESRCH' || code === 'EPERM') return null
    }

    // Verify process hasn't been recycled
    const currentStart = await getProcessStartTime(entry.pid)
    if (currentStart && entry.procStart && currentStart !== entry.procStart)
      return null

    const w = new BgWorker(
      entry.dispatch,
      spawnPty,
      getAuthSnapshot,
      'adopted',
      {
        pid: entry.pid,
        attempt: entry.attempt,
        startedAt: entry.startedAt,
        messagingSock: entry.messagingSock,
        state: 'adopted',
        detail: 'adopted from previous supervisor',
        cliVersion: entry.cliVersion,
        ...(entry.ptySock ? {} : { legacy: true }),
      },
    )
    w.attempt = entry.attempt
    w.procStart = entry.procStart
    w.workerReady = true
    w.adoptedAt = Date.now()
    w.rvSockPath = entry.rendezvousSock
    w.ptySockPath = entry.ptySock

    if (entry.dispatch.launch.mode === 'exec') {
      w.execTracker = createExecTracker(getJobDirPath(entry.dispatch.short))
      w.workerReady = true
    }

    if (entry.ptySock) {
      w.wirePty(
        connectToPtyHost(
          entry.ptySock,
          entry.pid,
          w.procStart,
          entry.dispatch.short,
        ),
      )
      w.ptyCols = 0
      w.seedFocus(false)
    }

    if (entry.decModes) w.decModes.seed(entry.decModes)
    w.connectRv()

    if (entry.pendingRespawn === 'upgrade') {
      w.transitionTo({ kind: 'upgrading' })
      setTimeout(
        (worker: BgWorker) => {
          if (worker.phase.kind === 'upgrading' && !worker.record.outcome) {
            worker.sigtermWorker()
          }
        },
        5000,
        w,
      ).unref()
    }

    return w
  }

  static unverified(short: string, entry: RosterEntry): BgWorker {
    const w = new BgWorker(entry.dispatch, undefined, undefined, 'adopted', {
      pid: entry.pid,
      attempt: entry.attempt,
      startedAt: entry.startedAt,
      messagingSock: entry.messagingSock,
      state: 'adopted',
      detail: 'adopted (pid unverifiable; tracking via pty.sock)',
      cliVersion: entry.cliVersion,
    })
    w.attempt = entry.attempt
    w.procStart = entry.procStart
    w.rvSockPath = entry.rendezvousSock
    w.ptySockPath = entry.ptySock
    w.unverifiedSock = entry.ptySock
    w.lastInputAt = Date.now()
    w.pidPoll = setInterval(
      (worker: BgWorker) => {
        if (worker.record.outcome || !worker.unverifiedSock) return
        isSocketAlive(worker.unverifiedSock).then(alive => {
          if (
            alive ||
            worker.record.outcome ||
            worker.phase.kind !== 'spawning'
          )
            return
          worker.settle('crashed')
        })
      },
      PID_POLL_INTERVAL_MS,
      w,
    )
    w.pidPoll.unref()
    return w
  }

  // --- Public methods ---

  tail(n: number): string[] {
    return n > 0 ? this.ring.slice(-n) : []
  }

  ringSnapshot(): string[] {
    return this.ring
  }

  preInitErrorTail(): string | undefined {
    const raw = this.ring.slice(this.ringSpawnMark).join('')
    const clean = stripAnsi(raw).replace(/\s+/g, ' ').trim()
    if (!clean) return undefined
    return clean.length > PRE_INIT_ERROR_TAIL_MAX
      ? `…${clean.slice(-PRE_INIT_ERROR_TAIL_MAX)}`
      : clean
  }

  decModeSnapshot(): number[] {
    return this.decModes.snapshot()
  }

  write(data: string): void {
    this.lastInputAt = Date.now()
    this.pty?.write(data)
  }

  noteActivity(): void {
    this.lastInputAt = Date.now()
  }

  shiftGraceClocksForward(ms: number): void {
    if (ms <= 0) return
    if (this.adoptedAt !== undefined) this.adoptedAt += ms
    if (this.lastInputAt !== undefined) this.lastInputAt += ms
  }

  seedFocus(focused: boolean): void {
    if (this.dispatch.launch.mode === 'exec') return
    this.pty?.write(focused ? FOCUS_IN : FOCUS_OUT)
  }

  resize(cols: number, rows: number): void {
    this.ptyCols = cols
    this.ptyRows = rows
    if (
      process.platform === 'win32' &&
      !this.workerReady &&
      this.attachers.size === 0
    ) {
      this.resizeDeferred = true
      return
    }
    try {
      this.pty?.resize(cols, rows)
    } catch {}
  }

  signalPtyPgrp(): void {
    if (process.platform === 'win32' || !this.record.pid) return
    setTimeout(
      (pid: number) => {
        try {
          process.kill(-pid, 'SIGWINCH')
        } catch {}
      },
      15,
      this.record.pid,
    )
  }

  resizeForRepaint(cols: number, rows: number): () => void {
    if (cols !== this.ptyCols || rows !== this.ptyRows) {
      // Size changed — resize first, then do shrink trick to force full repaint
      this.resize(cols, rows)
      this.signalPtyPgrp()
      this.rv?.send({ type: 'repaint' })
      // Schedule shrink trick after initial resize settles
      const timer = setTimeout(() => {
        if (this.ptyCols !== cols || this.ptyRows !== rows) return
        const shrunk = Math.max(2, cols - 1)
        this.resize(shrunk, rows)
        this.signalPtyPgrp()
        setTimeout(
          (origC: number, origR: number, shrunkC: number) => {
            if (this.ptyCols === shrunkC && this.ptyRows === origR) {
              this.resize(origC, origR)
              this.signalPtyPgrp()
            }
          },
          30,
          cols,
          rows,
          shrunk,
        )
      }, 50)
      return () => {
        clearTimeout(timer)
      }
    }

    const rvSent = this.rv?.send({ type: 'repaint' }) === true
    let cancelRepaint = () => {}

    const timer = setTimeout(
      (c: number, r: number) => {
        cancelRepaint()
        if (this.ptyCols !== c || this.ptyRows !== r) return
        const shrunk = Math.max(2, c - 1)
        this.resize(shrunk, r)
        this.signalPtyPgrp()
        setTimeout(
          (origC: number, origR: number, shrunkC: number) => {
            if (this.ptyCols === shrunkC && this.ptyRows === origR) {
              this.resize(origC, origR)
              this.signalPtyPgrp()
            }
          },
          30,
          c,
          r,
          shrunk,
        )
      },
      rvSent ? 50 : 0,
      cols,
      rows,
    )

    if (rvSent) {
      cancelRepaint = this.onRepaintDone.subscribe(() => {
        cancelRepaint()
        clearTimeout(timer)
      })
    }

    return () => {
      cancelRepaint()
      clearTimeout(timer)
    }
  }

  rosterEntry(): RosterEntry {
    return {
      pid: this.record.pid,
      procStart: this.procStart,
      sessionId: this.record.sessionId,
      rendezvousSock:
        this.rvSockPath ?? getRendezvousSockPath(this.dispatch.short),
      ptySock: this.record.legacy
        ? undefined
        : (this.ptySockPath ?? getPtySockPath(this.dispatch.short)),
      messagingSock: this.record.messagingSock,
      cliVersion: this.record.cliVersion,
      startedAt: this.record.startedAt,
      attempt: this.attempt,
      cwd: this.dispatch.cwd,
      worktreePath: this.dispatch.worktree?.path,
      dispatch: this.cappedDispatch(),
      pendingRespawn: this.phase.kind === 'upgrading' ? 'upgrade' : undefined,
      decModes: this.decModes.snapshot(),
    }
  }

  cappedDispatch(): DispatchRequest {
    return JSON.parse(
      JSON.stringify(this.dispatch, (key, value) => {
        if (key === 'reattachEnv' || key === 'attachStallRespawns')
          return undefined
        if (
          typeof value === 'string' &&
          value.length > CAPPED_DISPATCH_MAX_STR
        ) {
          return value.slice(0, CAPPED_DISPATCH_MAX_STR)
        }
        return value
      }),
    )
  }

  async reply(text: string): Promise<boolean> {
    this.lastInputAt = Date.now()
    const jobDir = getJobDirPath(this.dispatch.short)
    const state = readBgJobState(this.dispatch.short)
    const tempo = state?.tempo ?? this.record.tempo

    if (tempo === 'blocked' && this.rv?.send({ type: 'reply', text })) {
      return true
    }

    if (this.pty) {
      const useBracketedPaste = this.dispatch.launch.mode !== 'exec'
      this.replyChain = this.replyChain.then(
        () =>
          new Promise<void>(resolve => {
            this.pty?.write(
              useBracketedPaste ? `\x1B[200~${text}\x1B[201~` : text,
            )
            setTimeout(
              (r: () => void) => {
                this.pty?.write('\r')
                r()
              },
              10,
              resolve,
            )
          }),
      )
      return true
    }

    return this.rv?.send({ type: 'reply', text }) ?? false
  }

  sendAttacherCaps(caps: Record<string, unknown> | null): boolean {
    return this.rv?.send({ type: 'attacher-caps', caps }) ?? false
  }

  // --- Lifecycle: kill / stop / shutdown ---

  shutdownWorker(): boolean {
    const sent = this.rv?.send({ type: 'shutdown' }) ?? false
    if (!sent) {
      this.sigtermWorker()
    } else {
      setTimeout(
        (w: BgWorker) => {
          const p = w.phase
          if (
            (p.kind === 'upgrading' ||
              (p.kind === 'retiring' && p.reason === 'grace')) &&
            !w.record.outcome
          ) {
            w.sigtermWorker()
          }
        },
        5000,
        this,
      ).unref()
    }
    return sent
  }

  sigtermWorker(): void {
    try {
      this.pty?.kill('SIGTERM')
    } catch {}
  }

  kill(
    sig: 'SIGTERM' | 'SIGKILL' = 'SIGTERM',
    outcome = 'killed',
    detail?: string,
  ): void {
    if (this.phase.kind === 'retired') return
    this.killOutcome = outcome
    if (detail) this.patch({ detail })
    this.transitionTo({ kind: 'retiring', reason: 'reap' })
    if (this.backoffTimer) {
      clearTimeout(this.backoffTimer)
      this.backoffTimer = null
    }

    if (this.unverifiedSock) {
      killPtyHost(this.unverifiedSock).finally(() =>
        this.settle(this.killOutcome),
      )
      return
    }

    if (this.pty) {
      try {
        this.pty.kill(sig)
      } catch {}
    } else if (this.record.pid && !this.pidRecycled()) {
      try {
        process.kill(-this.record.pid, sig)
      } catch {
        try {
          process.kill(this.record.pid, sig)
        } catch {}
      }
    }

    if (!this.pty) this.settle(this.killOutcome)
  }

  stop(): void {
    if (this.phase.kind === 'retiring' && this.phase.reason === 'reap') {
      this.settle(this.killOutcome)
    } else if (
      this.phase.kind === 'retiring' &&
      this.phase.reason === 'grace'
    ) {
      this.settle('done')
    } else if (this.phase.kind !== 'retired') {
      this.transitionTo({ kind: 'retiring', reason: 'stop' })
    }

    if (this.backoffTimer) {
      clearTimeout(this.backoffTimer)
      this.backoffTimer = null
    }
    this.clearLiveness()
    this.offData?.dispose()
    this.offExit?.dispose()
    this.execTracker?.dispose()
    this.execTracker = undefined
    this.pty?.dispose()
    this.pty = undefined
  }

  // --- Lifecycle: respawn / retire ---

  async respawnIfIdleStale(
    pinned?: Set<string>,
  ): Promise<{ respawned: boolean; reason?: string }> {
    if (this.dispatch.launch.mode === 'exec')
      return { respawned: false, reason: 'not-stale' }
    if (this.isTransitioning) return { respawned: false, reason: 'in-progress' }
    if (this.record.outcome) return { respawned: false, reason: 'no-state' }
    if (this.attachers.size > 0) return { respawned: false, reason: 'attached' }

    const state = readBgJobState(this.dispatch.short)
    if (
      this.isTransitioning ||
      this.record.outcome ||
      this.attachers.size > 0
    ) {
      return { respawned: false, reason: 'in-progress' }
    }
    if (!state) return { respawned: false, reason: 'no-state' }
    if (isTerminalState(state) && !pinned?.has(this.dispatch.short)) {
      return { respawned: false, reason: 'settled' }
    }
    if (!state.cliVersion || state.cliVersion === MACRO.VERSION) {
      return { respawned: false, reason: 'not-stale' }
    }
    if (!isTerminalState(state) && state.tempo !== 'idle') {
      return { respawned: false, reason: 'busy' }
    }

    if (!this.transitionTo({ kind: 'upgrading' })) {
      return { respawned: false, reason: 'in-progress' }
    }
    this.onState.emit({ pid: this.record.pid })
    this.shutdownWorker()
    return { respawned: true }
  }

  async retireIfSettled(
    graceMs: number,
    pinned?: Set<string>,
    bridgeGraceMs: number = graceMs,
  ): Promise<{ retired: boolean; reason?: string }> {
    if (this.isTransitioning) return { retired: false, reason: 'in-progress' }
    if (this.record.outcome) return { retired: false, reason: 'no-state' }
    if (this.attachers.size > 0) return { retired: false, reason: 'attached' }
    if (pinned?.has(this.dispatch.short))
      return { retired: false, reason: 'pinned' }
    if (this.adoptedAt && Date.now() - this.adoptedAt < RECENT_ADOPT_GRACE_MS) {
      return { retired: false, reason: 'recent-adopt' }
    }
    if (this.lastInputAt && Date.now() - this.lastInputAt < graceMs) {
      return { retired: false, reason: 'recent-input' }
    }

    const state = readBgJobState(this.dispatch.short)
    if (this.isTransitioning || this.attachers.size > 0) {
      return { retired: false, reason: 'in-progress' }
    }
    if (this.lastInputAt && Date.now() - this.lastInputAt < graceMs) {
      return { retired: false, reason: 'recent-input' }
    }

    if (!state) {
      // Spare session with no state — retire if old enough
      if (
        this.dispatch.source === 'spare' &&
        Date.now() - this.dispatch.createdAt > graceMs
      ) {
        if (!this.transitionTo({ kind: 'retiring', reason: 'grace' })) {
          return { retired: false, reason: 'in-progress' }
        }
        this.shutdownWorker()
        return { retired: true }
      }
      return { retired: false, reason: 'no-state' }
    }

    // Empty idle session (no name, no intent, blocked)
    if (
      this.dispatch.source !== 'shell' &&
      !state.name &&
      !state.intent &&
      !state.worktreePath &&
      state.template === 'bg' &&
      state.state === 'working' &&
      state.tempo === 'blocked'
    ) {
      const age = Date.now() - Date.parse(state.createdAt)
      if (age < EMPTY_IDLE_GRACE_MS)
        return { retired: false, reason: 'empty-idle-grace' }
      if (!this.transitionTo({ kind: 'retiring', reason: 'grace' })) {
        return { retired: false, reason: 'in-progress' }
      }
      this.deleteJobDirOnSettle = true
      this.shutdownWorker()
      return { retired: true }
    }

    if (!isTerminalState(state))
      return { retired: false, reason: 'not-settled' }
    if ((state.inFlight?.tasks ?? 1) > 0 || (state.inFlight?.queued ?? 1) > 0) {
      return { retired: false, reason: 'inflight' }
    }
    if (state.inFlight?.kinds.includes('session_cron')) {
      return { retired: false, reason: 'session-cron' }
    }
    if (state.routine) return { retired: false, reason: 'routine' }

    const effectiveGrace = state.bridgeSessionId
      ? Math.max(graceMs, bridgeGraceMs)
      : graceMs
    const elapsed = state.updatedAt
      ? Date.now() - Date.parse(state.updatedAt)
      : undefined
    if (!elapsed || elapsed < effectiveGrace)
      return { retired: false, reason: 'grace' }

    if (!this.transitionTo({ kind: 'retiring', reason: 'grace' })) {
      return { retired: false, reason: 'in-progress' }
    }
    this.shutdownWorker()
    return { retired: true }
  }

  // --- Spawn logic ---

  async doSpawn(reattachEnv?: Record<string, string>): Promise<void> {
    this.attempt++
    this.workerReady = false
    this.resizeDeferred = false
    this.ringSpawnMark = this.ring.length
    this.lastSpawnAt = Date.now()

    const dispatch = this.dispatch
    const jobDir = getJobDirPath(dispatch.short)
    await mkdir(jobDir, { recursive: true }).catch(() => {})

    // Write auth snapshot for the worker
    const authPath =
      dispatch.launch.mode === 'exec'
        ? undefined
        : await writeAuthSnapshot(dispatch.short, this.getAuthSnapshot)

    const resumeSessionId =
      dispatch.launch.mode === 'resume' ? dispatch.launch.sessionId : undefined
    let transcriptExists = false
    let sourceGone = false
    let sessionId = dispatch.sessionId
    let respawnFlags = dispatch.respawnFlags

    if (this.attempt > 1) {
      const state = readBgJobState(dispatch.short)
      sessionId = state?.resumeSessionId ?? dispatch.sessionId
      respawnFlags = state?.respawnFlags ?? dispatch.respawnFlags
      // Check if transcript exists for resume
      transcriptExists = await checkTranscriptExists(sessionId, dispatch.cwd)
      sourceGone =
        !transcriptExists &&
        resumeSessionId !== undefined &&
        !(await checkTranscriptExists(resumeSessionId, dispatch.cwd))
      if (!transcriptExists) {
        // Remove stale transcript
        const transcriptPath = await getTranscriptPath(sessionId, dispatch.cwd)
        if (transcriptPath) await unlink(transcriptPath).catch(() => {})
      }
    }

    if (
      this.phase.kind === 'retiring' ||
      this.phase.kind === 'retired' ||
      this.record.outcome
    )
      return
    if (sourceGone) {
      this.patch({
        state: 'crashed',
        detail: `source session ${resumeSessionId} not found`,
      })
      this.settle('crashed')
      return
    }

    if (!this.spawnPty) {
      this.patch({
        state: 'crashed',
        detail: 'Bun.Terminal unavailable (running under Node?)',
      })
      this.settle('crashed')
      return
    }

    // Build args and env
    const argv = buildWorkerArgs(
      dispatch,
      this.attempt,
      transcriptExists,
      sessionId,
      respawnFlags,
    )
    const env = buildWorkerEnv(
      dispatch,
      jobDir,
      authPath,
      this.rvSockPath ?? getRendezvousSockPath(dispatch.short),
    )
    if (this.attempt > 1 && transcriptExists) {
      env.CLAUDE_CODE_RESUME_INTERRUPTED_TURN = '1'
    }
    if (reattachEnv) Object.assign(env, reattachEnv)

    const cols = this.ptyCols || (dispatch.cols ?? 200)
    const rows = this.ptyRows || (dispatch.rows ?? 50)

    let ptyConn: PtyConnection
    try {
      const { cmd, prefixArgs } = getBinaryPath({ pinToCurrentBinary: true })
      ptyConn = this.spawnPty(cmd, [...prefixArgs, ...argv], {
        cols,
        rows,
        cwd: dispatch.cwd,
        env,
        ptySock: this.ptySockPath ?? getPtySockPath(dispatch.short),
        short: dispatch.short,
      })
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        const cwdExists = await access(dispatch.cwd)
          .then(() => true)
          .catch(() => false)
        if (this.record.outcome) return
        if (!cwdExists) {
          this.settleCwdGone('cold')
          return
        }
        const detail =
          dispatch.launch.mode === 'exec'
            ? `${dispatch.launch.cmd}: command not found`
            : 'daemon binary was deleted (upgrade in progress) — run your command again to use the new version'
        this.patch({ state: 'crashed', detail })
        const msg = `\r\n\x1B[2m[${detail}]\x1B[0m\r\n`
        this.pushRing(msg)
        this.onStream.emit(msg)
        this.settle('crashed')
        return
      }
      this.scheduleRespawn(String((err as Error).message ?? err))
      return
    }

    if (dispatch.launch.mode === 'exec') {
      this.execTracker?.dispose()
      this.execTracker = createExecTracker(jobDir)
      this.workerReady = true
    }

    this.wirePty(ptyConn)
    this.rv?.close()
    this.rv = undefined
    this.lastRvHeartbeat = undefined
    this.stalledLogged = false
    this.connectRv()
    this.patch({
      pid: ptyConn.pid,
      attempt: this.attempt,
      state: this.attempt > 1 ? 'resuming' : 'running',
      detail: '',
      cliVersion: MACRO.VERSION,
    })

    getProcessStartTime(ptyConn.pid, { skipCache: true }).then(start => {
      if (
        !start ||
        this.record.pid !== ptyConn.pid ||
        this.isDetached ||
        this.record.outcome
      )
        return
      this.procStart = start
      this.patch({ pid: ptyConn.pid })
    })
  }

  // --- Wire PTY connection ---

  wirePty(conn: PtyConnection): void {
    this.pty = conn
    this.transitionTo({ kind: 'running' })
    this.decModes = createDecModeTracker()

    conn.onResume?.(() => {
      this.rv?.send({ type: 'repaint' })
    })

    this.offData = conn.onData((data: string) => {
      if (this.decModes.feed(data) && this.record.pid) {
        this.onState.emit({ pid: this.record.pid })
      }
      this.execTracker?.feed(data)
      this.pushRing(
        data.includes(DETACH_SEQ) ? data.replaceAll(DETACH_SEQ, '') : data,
      )
      this.onStream.emit(data)
    })

    let exitHandled = false
    this.offExit = conn.onExit(({ exitCode, signal }) => {
      if (exitHandled) return
      exitHandled = true
      this.offData?.dispose()
      this.execLastLine = this.execTracker?.lastLine
      this.execTracker?.dispose()
      this.execTracker = undefined
      this.pty = undefined
      this.onExit(exitCode, signal)
    })
  }

  // --- Ring buffer ---

  private pushRing(data: string): void {
    this.ring.push(data)
    this.ringBytes += data.length
    if (this.ringBytes > RING_MAX_BYTES * 1.25 && this.ring.length > 1) {
      let trimIdx = 0
      let trimBytes = 0
      while (
        this.ringBytes - trimBytes > RING_MAX_BYTES &&
        trimIdx < this.ring.length - 1
      ) {
        trimBytes += this.ring[trimIdx]!.length
        trimIdx++
      }
      this.ring.splice(0, trimIdx)
      this.ringBytes -= trimBytes
      this.ringSpawnMark = Math.max(0, this.ringSpawnMark - trimIdx)
    }
  }

  // --- State patch ---

  patch(updates: Record<string, unknown>): void {
    Object.assign(this.record, updates)
    this.onState.emit(updates)
  }

  // --- Exit handler ---

  private onExit(code: number, signal?: string): void {
    if (this.isDetached) return
    if (this.phase.kind === 'retired') return

    const uptime = this.lastSpawnAt ? Date.now() - this.lastSpawnAt : undefined
    const isFastCrash =
      uptime !== undefined && uptime < FAST_CRASH_MS && code !== 0

    if (isFastCrash) this.fastCrashStreak++
    else this.fastCrashStreak = 0

    const tooManyFastCrashes = this.fastCrashStreak >= 3
    const preInitError = this.workerReady ? undefined : this.preInitErrorTail()
    const exitCause =
      code !== 0 ? readExitCause(getJobDirPath(this.dispatch.short)) : undefined
    const sameExitCause =
      isFastCrash && !!exitCause && exitCause === this.lastExitCause
    this.lastExitCause = isFastCrash ? exitCause : undefined

    const detail = preInitError
      ? ` — ${preInitError}`
      : exitCause
        ? ` — ${exitCause}`
        : ''
    const isExecInterrupt =
      this.dispatch.launch.mode === 'exec' &&
      (signal === 'SIGINT' || signal === 'SIGQUIT')

    let outcome: string | undefined

    if (this.phase.kind === 'retiring' && this.phase.reason === 'reap') {
      outcome = this.killOutcome
    } else if (
      this.phase.kind === 'retiring' &&
      this.phase.reason === 'grace'
    ) {
      outcome = 'done'
    } else if (this.phase.kind === 'upgrading') {
      outcome = undefined // Will respawn
    } else if (code === 0) {
      outcome = 'done'
    } else if (this.dispatch.launch.mode === 'exec') {
      outcome = isExecInterrupt ? 'killed' : 'crashed'
    } else if (
      (!this.workerReady && (this.attempt >= 2 || preInitError)) ||
      tooManyFastCrashes ||
      sameExitCause ||
      this.attempt >= MAX_RESPAWN_ATTEMPTS
    ) {
      outcome = 'crashed'
    }

    // Handle retiring phase
    if (this.phase.kind === 'retiring') {
      this.settle(this.phase.reason === 'reap' ? this.killOutcome : 'done')
      return
    }

    // Handle upgrading phase — respawn with fresh binary
    if (this.phase.kind === 'upgrading') {
      this.transitionTo({ kind: 'spawning' })
      this.attempt = 1
      this.fastCrashStreak = 0
      this.lastExitCause = undefined
      this.patch({ pid: 0, state: 'starting', detail: 'upgrading' })
      this.procStart = undefined
      this.buildBridgeReattachEnvFromState().then(env => this.doSpawn(env))
      return
    }

    // Clean exit
    if (code === 0) {
      if (this.dispatch.launch.mode === 'exec') {
        this.patch({ detail: this.execLastLine || '(no output)' })
      }
      this.settle('done')
      return
    }

    // Exec mode crash
    const exitDesc = signal ? `${signal} (${code})` : `exit ${code}`
    if (this.dispatch.launch.mode === 'exec') {
      const lastLine = this.execLastLine
      this.patch({
        state: isExecInterrupt ? 'stopped' : 'crashed',
        detail: lastLine ? `${exitDesc} — ${lastLine}` : `${exitDesc}${detail}`,
      })
      this.settle(isExecInterrupt ? 'killed' : 'crashed')
      return
    }

    // CWD gone check for spare sessions
    if (!this.workerReady && exitCause === 'spare_postclaim:ENOENT') {
      try {
        accessSync(this.dispatch.cwd)
      } catch {
        this.settleCwdGone('spare')
        return
      }
    }

    // Pre-init crash or too many attempts
    if (!this.workerReady && (this.attempt >= 2 || preInitError)) {
      this.patch({
        state: 'crashed',
        detail: `${exitDesc} before init${detail}`,
      })
      this.settle('crashed')
      return
    }

    // Fast crash loop
    if (tooManyFastCrashes || sameExitCause) {
      this.patch({
        state: 'crashed',
        detail: sameExitCause
          ? `${exitDesc} ×${this.attempt}${detail}`
          : `${exitDesc} within ${FAST_CRASH_MS / 1000}s of spawn ×${this.fastCrashStreak}${detail}`,
      })
      this.settle('crashed')
      return
    }

    // Schedule respawn
    this.scheduleRespawn(`${exitDesc}${detail}`)
  }

  // --- Settle helpers ---

  private settleCwdGone(via: string): void {
    const detail = `working directory no longer exists: ${this.dispatch.cwd}`
    this.patch({ state: 'crashed', detail })
    const msg = `\r\n\x1B[2m[${detail} — this job cannot be respawned]\x1B[0m\r\n`
    this.pushRing(msg)
    this.onStream.emit(msg)
    this.settle('crashed')
  }

  private async buildBridgeReattachEnvFromState(): Promise<
    Record<string, string> | undefined
  > {
    const state = readBgJobState(this.dispatch.short)
    if (!state) return undefined
    return buildBridgeReattachEnv(
      state.bridgeSessionId,
      state.bridgeSessionSeq,
      state.bridgeOutboundOnly,
    )
  }

  private scheduleRespawn(reason: string): void {
    if (this.attempt >= MAX_RESPAWN_ATTEMPTS) {
      this.patch({ state: 'crashed', detail: reason })
      this.settle('crashed')
      return
    }

    if (this.phase.kind === 'running') this.transitionTo({ kind: 'spawning' })
    this.patch({ pid: 0, state: 'crashed', detail: `${reason}; respawning` })
    this.procStart = undefined

    const msg = `\r\n\x1B[2m[worker crashed (${reason}) — respawning…]\x1B[0m\r\n`
    this.pushRing(msg)
    this.onStream.emit(msg)

    this.backoffTimer = setTimeout(() => {
      this.backoffTimer = null
      if (this.phase.kind !== 'retiring' && this.phase.kind !== 'retired') {
        this.doSpawn()
      }
    }, RESPAWN_BACKOFF_MS)
    this.backoffTimer.unref()
  }

  settle(outcome: string): void {
    if (this.record.outcome) return
    this.transitionTo({ kind: 'retired', outcome })
    this.clearLiveness()
    this.patch({ outcome, settledAt: Date.now(), tempo: 'idle' })
    this.onSettle.emit(outcome)
  }

  // --- Rendezvous + PID poll ---

  private connectRv(): void {
    if (this.rv || this.isDetached || this.record.outcome) return
    if (this.dispatch.launch.mode === 'exec') {
      this.startPidPoll()
      return
    }
    this.rv = connectRendezvous(
      this.rvSockPath ?? getRendezvousSockPath(this.dispatch.short),
      msg => {
        if (msg.type === 'heartbeat') {
          this.lastRvHeartbeat = Date.now()
        } else if (msg.type === 'done') {
          this.settle(msg.outcome as string)
        } else if (msg.type === 'state') {
          this.patch(msg.patch as Record<string, unknown>)
        } else if (msg.type === 'detach-request') {
          this.onStream.emit(encodeDetachMsg(msg.msg as string | undefined))
        } else if (msg.type === 'repaint-done') {
          this.onRepaintDone.emit()
        }
      },
      () => void this.checkPid(),
      () => {
        this.workerReady = true
        if (this.resizeDeferred) {
          this.resizeDeferred = false
          this.resize(this.ptyCols, this.ptyRows)
        }
        if (this.attachers.size > 0) {
          const last = [...this.attachers.values()].at(-1)!
          this.sendAttacherCaps(last.caps ?? null)
          // RV just connected and attacher is waiting — trigger repaint immediately
          this.rv?.send({ type: 'repaint' })
        } else {
          this.sendAttacherCaps(null)
        }
        // Inject initial prompt via RV reply (official: daemon sends reply after RV ready)
        if (this.attempt === 1 && this.dispatch.seed?.intent) {
          setTimeout(() => {
            if (this.record.outcome || this.isDetached) return
            this.rv?.send({ type: 'reply', text: this.dispatch.seed!.intent! })
          }, 500)
        }
      },
    )
    this.startPidPoll()
  }

  private startPidPoll(): void {
    if (this.pidPoll) return
    this.lastCheckPidAt = Date.now()
    this.pidPoll = setInterval(
      () => void this.checkPid(true),
      PID_POLL_INTERVAL_MS,
    )
    this.pidPoll.unref()
  }

  private pidRecycled(): boolean {
    if (!this.procStart || !this.record.pid) return false
    const current = getProcessStartTimeSync(this.record.pid)
    return current !== undefined && current !== this.procStart
  }

  private async pidRecycledAsync(): Promise<boolean> {
    if (!this.procStart || !this.record.pid) return false
    const current = await getProcessStartTime(this.record.pid)
    return current !== undefined && current !== this.procStart
  }

  private async checkPid(fromPoll = false): Promise<void> {
    if (this.record.outcome || !this.record.pid) return

    const elapsed = Date.now() - this.lastCheckPidAt
    this.lastCheckPidAt = Date.now()
    const wasSuspended = elapsed > PID_POLL_INTERVAL_MS * 3

    // If machine was suspended, reset heartbeat clock
    if (wasSuspended && this.lastRvHeartbeat !== undefined) {
      this.lastRvHeartbeat = Date.now()
    }

    // If no PTY connection, check if PID is alive
    if (!this.pty) {
      try {
        process.kill(this.record.pid, 0)
      } catch {
        this.settle(this.isKilling ? 'killed' : 'crashed')
        return
      }
    }

    // Stall detection
    const hb = this.lastRvHeartbeat
    if (
      !wasSuspended &&
      !this.stalledLogged &&
      hb !== undefined &&
      Date.now() - hb > STALLED_THRESHOLD_MS
    ) {
      const state = readBgJobState(this.dispatch.short)
      if (
        !this.stalledLogged &&
        (state?.tempo ?? this.record.tempo) === 'active'
      ) {
        this.stalledLogged = true
      }
    }

    // PID recycling check (only when no PTY, throttled)
    if (this.pty) return
    if (fromPoll && this.pidPollTick++ % 12 !== 0) return
    if (await this.pidRecycledAsync()) {
      if (this.record.outcome || this.pty) return
      this.settle(this.isKilling ? 'killed' : 'crashed')
    }
  }

  private clearLiveness(): void {
    if (this.pidPoll) {
      clearInterval(this.pidPoll)
      this.pidPoll = null
    }
    this.rv?.close()
    this.rv = undefined
    this.lastRvHeartbeat = undefined
    this.stalledLogged = false
  }
}

// ---------------------------------------------------------------------------
// Attacher Entry type (used by attach handler)
// ---------------------------------------------------------------------------

export interface AttacherEntry {
  cols: number
  rows: number
  caps?: Record<string, unknown>
  kick: () => void
  repaint?: () => void
}

// ---------------------------------------------------------------------------
// Build worker args — official e64
// ---------------------------------------------------------------------------

export function buildWorkerArgs(
  dispatch: DispatchRequest,
  attempt: number,
  transcriptExists: boolean,
  sessionId: string,
  respawnFlags: string[],
): string[] {
  if (dispatch.launch.mode === 'exec') return dispatch.launch.args ?? []
  if (attempt > 1 && transcriptExists)
    return ['--resume', sessionId, ...respawnFlags]
  if (dispatch.launch.mode === 'resume') {
    return [
      ...(dispatch.launch.fork
        ? ['--session-id', dispatch.sessionId, '--fork-session']
        : []),
      '--resume',
      dispatch.launch.sessionId!,
      ...(dispatch.launch.flagArgs ?? []),
    ]
  }
  return dispatch.launch.args ?? []
}

// ---------------------------------------------------------------------------
// Build worker env — official H84
// ---------------------------------------------------------------------------

const STRIP_ENV_KEYS = [
  'TERM_PROGRAM',
  'TERM_PROGRAM_VERSION',
  'ITERM_SESSION_ID',
  'ITERM_PROFILE',
  'TERMINAL_EMULATOR',
  'WT_SESSION',
  'WT_PROFILE_ID',
  'KONSOLE_DBUS_SESSION',
  'KONSOLE_DBUS_WINDOW',
  'ALACRITTY_LOG',
  'ALACRITTY_WINDOW_ID',
  'KITTY_PID',
  'KITTY_WINDOW_ID',
]

export function buildWorkerEnv(
  dispatch: DispatchRequest,
  jobDir: string,
  authPath: string | undefined,
  rvSockPath: string,
): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {
    ...process.env,
    ...(authPath && { CLAUDE_BG_AUTH_SNAPSHOT_PATH: authPath }),
    ...(process.platform === 'win32' && {
      CLAUDE_CODE_ALT_SCREEN_FULL_REPAINT: '1',
    }),
    ...dispatch.env,
    CLAUDE_CODE_SESSION_KIND: 'bg',
    CLAUDE_BG_BACKEND: 'daemon',
    CLAUDE_ENABLE_STREAM_WATCHDOG: '1',
    CLAUDE_BG_SOURCE: dispatch.source,
    CLAUDE_JOB_DIR: jobDir,
    CLAUDE_CODE_SESSION_NAME:
      dispatch.seed?.name || dispatch.seed?.intent || dispatch.short,
    CLAUDE_BG_RENDEZVOUS_SOCK: rvSockPath,
    FORCE_COLOR: '3',
    COLORTERM: 'truecolor',
    BROWSER: 'true',
  }

  if (process.env.CLAUDE_CONFIG_DIR)
    env.CLAUDE_CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR
  if (dispatch.isolation === 'worktree') env.CLAUDE_BG_ISOLATION = 'worktree'

  // Strip terminal-specific env vars unless dispatch explicitly sets them
  for (const key of STRIP_ENV_KEYS) {
    if (!dispatch.env?.[key]) delete env[key]
  }

  // If auth snapshot is provided, don't pass OAuth token directly
  if (authPath) delete env.CLAUDE_CODE_OAUTH_TOKEN

  // Exec mode: strip most CLAUDE_ vars
  if (dispatch.launch.mode === 'exec') {
    for (const key of Object.keys(env)) {
      if (
        (key.startsWith('CLAUDE_') &&
          key !== 'CLAUDE_JOB_DIR' &&
          key !== 'CLAUDE_CONFIG_DIR') ||
        key.startsWith('OTEL_')
      ) {
        delete env[key]
      }
    }
    delete env.BROWSER
    env.CLAUDE_PTY_HOST_EXEC = '1'
  }

  return env
}

// ---------------------------------------------------------------------------
// Bridge reattach env — official VjH
// ---------------------------------------------------------------------------

function buildBridgeReattachEnv(
  sessionId?: string,
  seq?: number,
  outboundOnly?: boolean,
): Record<string, string> | undefined {
  if (!sessionId) return undefined
  const env: Record<string, string> = {
    CLAUDE_BRIDGE_REATTACH_SESSION: sessionId,
  }
  if (seq !== undefined && seq > 0) env.CLAUDE_BRIDGE_REATTACH_SEQ = String(seq)
  if (outboundOnly !== false) env.CLAUDE_BRIDGE_REATTACH_OUTBOUND_ONLY = '1'
  return env
}

// ---------------------------------------------------------------------------
// Auth snapshot — official iqq
// ---------------------------------------------------------------------------

async function writeAuthSnapshot(
  short: string,
  getAuth?: () => Promise<string | undefined>,
): Promise<string | undefined> {
  if (!getAuth) return undefined
  const token = await getAuth()
  if (!token) return undefined
  const dir = getAuthDir()
  await mkdir(dir, { recursive: true, mode: 0o700 }).catch(() => {})
  const path = join(dir, `${short}.json`)
  await writeFile(path, token, { mode: 0o600 })
  return path
}

// ---------------------------------------------------------------------------
// Transcript helpers
// ---------------------------------------------------------------------------

async function checkTranscriptExists(
  sessionId: string,
  cwd: string,
): Promise<boolean> {
  const path = await getTranscriptPath(sessionId, cwd)
  if (!path) return false
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function getTranscriptPath(
  sessionId: string,
  cwd: string,
): Promise<string | undefined> {
  try {
    const projectsDir = join(getClaudeConfigHomeDir(), 'projects')
    const dirs = await readdir(projectsDir)
    for (const d of dirs) {
      const candidate = join(projectsDir, d, `${sessionId}.jsonl`)
      try {
        await access(candidate)
        return candidate
      } catch {}
    }
  } catch {}
  return undefined
}

// ---------------------------------------------------------------------------
// Roster read/write — official UU / p__
// ---------------------------------------------------------------------------

export function createEmptyRoster(): RosterFile {
  return {
    proto: PROTO_VERSION,
    supervisorPid: process.pid,
    updatedAt: Date.now(),
    workers: {},
  }
}

export async function readRoster(opts?: {
  silent?: boolean
}): Promise<RosterFile> {
  const rosterPath = getRosterPath()
  let raw: string
  try {
    raw = await readFile(rosterPath, 'utf8')
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT')
      return createEmptyRoster()
    if (!opts?.silent) console.error('[bg] roster read error:', e)
    return { ...createEmptyRoster(), parseFailed: true }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    if (!opts?.silent) console.error('[bg] roster.json parse failed:', e)
    return { ...createEmptyRoster(), parseFailed: true }
  }

  // Basic validation
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !('workers' in (parsed as Record<string, unknown>))
  ) {
    if (!opts?.silent) console.error('[bg] roster.json invalid structure')
    return { ...createEmptyRoster(), parseFailed: true }
  }

  return parsed as RosterFile
}

let rosterWriteChain = Promise.resolve()

export async function updateRoster(
  fn: (roster: RosterFile) => RosterFile | undefined,
): Promise<void> {
  const op = rosterWriteChain.then(async () => {
    const roster = await readRoster()
    const result = fn(roster) ?? roster
    result.supervisorPid = process.pid
    result.updatedAt = Date.now()
    const rosterPath = getRosterPath()
    mkdirSync(dirname(rosterPath), { recursive: true })
    writeFileSync(rosterPath, JSON.stringify(result))
  })
  rosterWriteChain = op.catch(() => {})
  return op
}
