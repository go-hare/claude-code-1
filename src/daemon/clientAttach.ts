/**
 * Client-side Attach — connects to daemon and streams a bg session's terminal.
 *
 * Upstream equivalent: `pl` function in the official 2.1.153 binary.
 *
 * Protocol:
 *   1. Connect to daemon control socket
 *   2. Send: {"proto":1,"op":"attach","short":"...","cols":N,"rows":N,"attachId":"uuid",...}\n
 *   3. Receive ack: {"ok":true,"op":"attach","decModes":[...],"via":"...","tempo":"...","state":"..."}\n
 *   4. After ack: raw bidirectional stream (PTY output ← → keyboard input)
 *   5. Detach keys: Ctrl+Z = detach, Ctrl+B = escape prefix (Ctrl+B,d also detaches)
 *   6. Output scanning: detect \x1B_cc-daemon-detach\x1B\\ for daemon-initiated detach
 */

import { connect, type Socket } from 'net'
import { randomUUID } from 'crypto'
import { getControlSocketPath } from './controlSocket.js'
import { createDecModeTracker } from './bgWorker.js'
import { jsonStringify, jsonParse } from '../utils/slowOperations.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Protocol version */
const PROTO_VERSION = 1

/** Ctrl+B — escape prefix byte */
const CTRL_B = 0x02
/** Ctrl+Z — primary detach byte */
const CTRL_Z = 0x1a
/** 'd' — secondary detach after Ctrl+B */
const CHAR_D = 100

/** Focus In report: CSI I — filter from input (terminal sends on window focus) */
const FOCUS_IN = Buffer.from('\x1B[I', 'ascii')
/** Focus Out report: CSI O — filter from input */
const FOCUS_OUT = Buffer.from('\x1B[O', 'ascii')

/** Kitty protocol Ctrl+Z: CSI 122;5u */
const KITTY_CTRL_Z = Buffer.from('\x1B[122;5u', 'ascii')
/** Kitty protocol Ctrl+B: CSI 98;5u */
const KITTY_CTRL_B = Buffer.from('\x1B[98;5u', 'ascii')
/** Xterm protocol Ctrl+Z: CSI 27;5;122~ */
const XTERM_CTRL_Z = Buffer.from('\x1B[27;5;122~', 'ascii')
/** Xterm protocol Ctrl+B: CSI 27;5;98~ */
const XTERM_CTRL_B = Buffer.from('\x1B[27;5;98~', 'ascii')

/** Detach sequence to scan for in output */
const DETACH_SEQ = Buffer.from('\x1B_cc-daemon-detach\x1B\\', 'ascii')
/** Plain-text detach marker — ConPTY on Windows strips APC wrappers (\x1B_ and \x1B\\) */
const DETACH_SEQ_PLAIN = Buffer.from('cc-daemon-detach', 'ascii')
/** Detach message prefix */
const DETACH_MSG_PREFIX = '\x1B_cc-detach-msg;'
/** Plain-text detach message prefix (Windows ConPTY strips APC) */
const DETACH_MSG_PREFIX_PLAIN = 'cc-detach-msg;'
/** String Terminator */
const ST = '\x1B\\'

/** Show cursor sequence — filtered on Windows to prevent flicker (official: Wh) */
const SHOW_CURSOR_SEQ = Buffer.from('\x1B[?25h', 'ascii')
/** Hide cursor sequence — sent on Windows after ack (official: op) */
const HIDE_CURSOR = '\x1B[?25l'

/** Ack timeout (10 seconds) */
const ACK_TIMEOUT_MS = 10_000

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AttachOutcome = 'detached' | 'disconnected' | 'error'

export interface AttachResult {
  outcome: AttachOutcome
  msg?: string
}

export interface AttachOptions {
  stdin?: NodeJS.ReadableStream & {
    setRawMode?(mode: boolean): void
    ref?(): void
    resume?(): void
    pause?(): void
  }
  stdout?: NodeJS.WritableStream & {
    columns?: number
    rows?: number
    on?(event: string, fn: () => void): void
    removeListener?(event: string, fn: () => void): void
  }
  /** If true, we're already in alt screen (FleetView handed it off) */
  alreadyInAlt?: boolean
  /** If true, hold the screen content on disconnect (don't clear) */
  holdScreenOnDisconnect?: boolean
  /** If true, tell daemon we're holding a frame (suppress "waiting" message) */
  holdingFrame?: boolean
}

// ---------------------------------------------------------------------------
// Terminal escape helpers
// ---------------------------------------------------------------------------

/** Enter alt screen + clear + reset scroll region */
function enterAltScreen(): string {
  return '\x1B[?1049h\x1B[2J\x1B[H\x1B[r'
}

/** Exit alt screen */
function exitAltScreen(): string {
  return '\x1B[?1049l'
}

/** CSI ? <mode> h — set DEC private mode */
function decSet(mode: number): string {
  return `\x1B[?${mode}h`
}

/** CSI ? <mode> l — reset DEC private mode */
function decReset(mode: number): string {
  return `\x1B[?${mode}l`
}

/** Erase display */
const ERASE_DISPLAY = '\x1B[2J'
/** Cursor home */
const CURSOR_HOME = '\x1B[H'

/** Check if a buffer contains a sequence starting at offset */
function bufferMatchesAt(buf: Buffer, offset: number, seq: Buffer): boolean {
  if (offset + seq.length > buf.length) return false
  for (let i = 0; i < seq.length; i++) {
    if (buf[offset + i] !== seq[i]) return false
  }
  return true
}

/** Find how many bytes at the end of `buf` are a prefix of `seq` */
function trailingPrefixLength(buf: Buffer, seq: Buffer): number {
  const maxCheck = Math.min(buf.length, seq.length - 1)
  for (let len = maxCheck; len > 0; len--) {
    const tail = buf.subarray(buf.length - len)
    if (seq.subarray(0, len).equals(tail)) return len
  }
  return 0
}

// ---------------------------------------------------------------------------
// Main attach function
// ---------------------------------------------------------------------------

/**
 * Attach to a background session via the daemon control socket.
 *
 * Returns a promise that resolves when the session is detached, disconnected, or errors.
 * The caller (FleetView) should handle terminal state before/after calling this.
 */
export async function attachToSession(
  short: string,
  opts: AttachOptions = {},
): Promise<AttachResult> {
  const stdin = (opts.stdin ?? process.stdin) as NodeJS.ReadableStream & {
    setRawMode?(m: boolean): void
    ref?(): void
    resume?(): void
    pause?(): void
    isRaw?: boolean
    on(e: string, fn: (...args: unknown[]) => void): void
    removeListener(e: string, fn: (...args: unknown[]) => void): void
    once(e: string, fn: () => void): void
    read(): Buffer | null
  }
  const stdout = (opts.stdout ?? process.stdout) as NodeJS.WritableStream & {
    columns?: number
    rows?: number
    on?(e: string, fn: () => void): void
    removeListener?(e: string, fn: () => void): void
    write(data: string | Buffer): boolean
  }

  const cols = stdout.columns ?? 120
  const rows = stdout.rows ?? 30
  const attachId = randomUUID()
  const startTime = Date.now()

  const decModes = createDecModeTracker()
  let done = false
  let ackReceived = false
  let ackMs: number | undefined
  let via: string | undefined
  let tempo: string | undefined

  // Windows: filter show-cursor sequences from PTY output to prevent flicker
  const isWindows = process.platform === 'win32'
  let cursorFilterPending = Buffer.alloc(0)

  // Result promise
  let resolveResult: (result: AttachResult) => void
  const resultPromise = new Promise<AttachResult>(r => {
    resolveResult = r
  })

  function finish(outcome: AttachOutcome, msg?: string): void {
    if (done) return
    done = true

    // Restore terminal state
    if (ackReceived) {
      // Reset tracked DEC modes — but skip 1049 (alt screen) when alreadyInAlt,
      // because the caller owns the alt screen lifecycle
      let modes = decModes.snapshot()
      if (
        opts.alreadyInAlt ||
        (outcome === 'disconnected' && opts.holdScreenOnDisconnect)
      ) {
        modes = modes.filter(m => m !== 1049)
      }
      const restoreModes = modes.map(decReset).reverse().join('')
      const restore =
        opts.alreadyInAlt ||
        (outcome === 'disconnected' && opts.holdScreenOnDisconnect)
          ? '' // Stay in alt screen (caller will handle)
          : exitAltScreen()
      stdout.write(restoreModes + '\x1B[0m\x1B7\x1B[r\x1B8' + restore)
    }

    // Restore raw mode
    if (stdin.setRawMode && !wasRaw) {
      stdin.setRawMode(false)
    }

    // Remove listeners
    stdin.removeListener('data', onStdinData)
    stdin.removeListener('readable', onReadable)
    stdin.removeListener('end', onEnd)
    if (stdout.removeListener) stdout.removeListener('resize', onResize)
    if (stdout.removeListener) stdout.removeListener('resize', onResize)
    clearTimeout(resizeTimer)

    socket.destroy()
    resolveResult({ outcome, msg })
  }

  // --- Detach key state machine ---
  let escapeMode = false // After Ctrl+B, next byte is literal or detach

  function processInput(data: Buffer): void {
    if (done) return
    let writeStart = 0

    for (let i = 0; i < data.length; i++) {
      const byte = data[i]!

      if (escapeMode) {
        escapeMode = false
        // After Ctrl+B: 'd' = detach, anything else = send literally
        if (i > writeStart) socket.write(data.subarray(writeStart, i))
        if (byte === CHAR_D) return finish('detached')
        // Send the escaped byte literally (skip the Ctrl+B itself)
        socket.write(Buffer.from([byte]))
        writeStart = i + 1
        continue
      }

      // Check for detach keys
      if (
        byte === CTRL_Z ||
        bufferMatchesAt(data, i, KITTY_CTRL_Z) ||
        bufferMatchesAt(data, i, XTERM_CTRL_Z)
      ) {
        if (i > writeStart) socket.write(data.subarray(writeStart, i))
        return finish('detached')
      }

      // Filter focus in/out reports (terminal sends these on window focus change)
      if (bufferMatchesAt(data, i, FOCUS_IN)) {
        if (i > writeStart) socket.write(data.subarray(writeStart, i))
        i += FOCUS_IN.length - 1
        writeStart = i + 1
        continue
      }
      if (bufferMatchesAt(data, i, FOCUS_OUT)) {
        if (i > writeStart) socket.write(data.subarray(writeStart, i))
        i += FOCUS_OUT.length - 1
        writeStart = i + 1
        continue
      }

      // Check for escape prefix
      const escLen =
        byte === CTRL_B
          ? 1
          : bufferMatchesAt(data, i, KITTY_CTRL_B)
            ? KITTY_CTRL_B.length
            : bufferMatchesAt(data, i, XTERM_CTRL_B)
              ? XTERM_CTRL_B.length
              : 0
      if (escLen) {
        if (i > writeStart) socket.write(data.subarray(writeStart, i))
        i += escLen - 1
        writeStart = i + 1
        escapeMode = true
      }
    }

    // Write remaining bytes
    if (writeStart < data.length) {
      socket.write(data.subarray(writeStart))
    }
  }

  // --- Output processing ---
  let pendingDetach = Buffer.alloc(0) // Partial detach sequence at end of chunk

  /**
   * Windows: strip show-cursor (\x1B[?25h) sequences from PTY output.
   * Official: function s(t) — prevents cursor flicker on Windows Terminal.
   * Handles partial sequences spanning chunk boundaries.
   */
  function stripShowCursor(data: Buffer): Buffer {
    if (!isWindows) return data
    const hasPending = cursorFilterPending.length > 0
    const buf = hasPending ? Buffer.concat([cursorFilterPending, data]) : data
    if (hasPending) cursorFilterPending = Buffer.alloc(0)

    let idx = buf.indexOf(SHOW_CURSOR_SEQ)
    if (idx < 0) {
      // No full match — check for partial match at end
      const partial = trailingPrefixLength(buf, SHOW_CURSOR_SEQ)
      if (partial === 0) return buf
      cursorFilterPending = Buffer.from(buf.subarray(buf.length - partial))
      return buf.subarray(0, buf.length - partial)
    }

    // Strip all occurrences
    const parts: Buffer[] = []
    let start = 0
    while (idx >= 0) {
      if (idx > start) parts.push(buf.subarray(start, idx))
      start = idx + SHOW_CURSOR_SEQ.length
      idx = buf.indexOf(SHOW_CURSOR_SEQ, start)
    }
    const tail = buf.subarray(start)
    const partial = trailingPrefixLength(tail, SHOW_CURSOR_SEQ)
    if (partial > 0) {
      cursorFilterPending = Buffer.from(tail.subarray(tail.length - partial))
      if (tail.length > partial)
        parts.push(tail.subarray(0, tail.length - partial))
    } else if (tail.length > 0) {
      parts.push(tail)
    }
    if (parts.length === 0) return Buffer.alloc(0)
    if (parts.length === 1) return parts[0]!
    return Buffer.concat(parts)
  }

  function writeToStdout(data: Buffer): void {
    if (data.length === 0) return
    // Windows: strip show-cursor so WT/ConPTY don't re-expose the block
    // cursor mid-frame (official Wh filter on attach stream).
    const filtered = stripShowCursor(data)
    if (filtered.length === 0) return
    const text = filtered.toString('utf8')
    stdout.write(text)
    decModes.feed(text)
  }

  function processOutput(data: Buffer): void {
    // Check for detach sequence in output
    const combined =
      pendingDetach.length > 0 ? Buffer.concat([pendingDetach, data]) : data

    // Try full ESC-wrapped sequence first, then plain-text fallback (Windows ConPTY strips APC)
    let detachIdx = combined.indexOf(DETACH_SEQ)
    let usedPlain = false
    if (detachIdx < 0 && isWindows) {
      detachIdx = combined.indexOf(DETACH_SEQ_PLAIN)
      usedPlain = detachIdx >= 0
    }

    if (detachIdx >= 0) {
      const msg = extractDetachMsg(combined.subarray(0, detachIdx))
      // Don't write the detach-msg or detach sequence to terminal
      const beforeAll = combined.subarray(0, detachIdx)
      if (beforeAll.length > 0) {
        const msgPrefix = Buffer.from(
          usedPlain ? DETACH_MSG_PREFIX_PLAIN : DETACH_MSG_PREFIX,
          'ascii',
        )
        const apcStart = beforeAll.indexOf(msgPrefix)
        if (apcStart > 0) {
          writeToStdout(beforeAll.subarray(0, apcStart))
        } else if (apcStart < 0) {
          writeToStdout(beforeAll)
        }
      }
      pendingDetach = Buffer.alloc(0)
      return finish('detached', msg)
    }

    // Check for partial detach sequence at end
    const trailing = isWindows
      ? Math.max(
          trailingPrefixLength(combined, DETACH_SEQ),
          trailingPrefixLength(combined, DETACH_SEQ_PLAIN),
        )
      : trailingPrefixLength(combined, DETACH_SEQ)
    if (trailing > 0) {
      pendingDetach = Buffer.from(combined.subarray(combined.length - trailing))
      const toWrite = combined.subarray(0, combined.length - trailing)
      if (toWrite.length > 0) writeToStdout(toWrite)
    } else {
      pendingDetach = Buffer.alloc(0)
      writeToStdout(combined)
    }
  }

  function extractDetachMsg(data: Buffer): string | undefined {
    const str = data.toString('utf8')
    // Try ESC-wrapped prefix first, then plain-text (Windows)
    let prefixIdx = str.lastIndexOf(DETACH_MSG_PREFIX)
    let prefix = DETACH_MSG_PREFIX
    if (prefixIdx < 0) {
      prefixIdx = str.lastIndexOf(DETACH_MSG_PREFIX_PLAIN)
      prefix = DETACH_MSG_PREFIX_PLAIN
    }
    if (prefixIdx < 0) return undefined
    const msgStart = prefixIdx + prefix.length
    // Try ST first, then plain-text end markers
    let stIdx = str.indexOf(ST, msgStart)
    if (stIdx < 0) {
      // On Windows, ConPTY strips ST — look for the detach marker as end boundary
      const plainEnd = str.indexOf('cc-daemon-detach', msgStart)
      if (plainEnd >= 0) {
        // Message ends just before the detach marker (minus any separator like '.')
        const raw = str.slice(msgStart, plainEnd)
        return raw.replace(/\.?$/, '').trim() || undefined
      }
      return str.slice(msgStart).trim() || undefined
    }
    return str.slice(msgStart, stIdx)
  }

  // --- Resize handling ---
  let resizeTimer: ReturnType<typeof setTimeout> | undefined
  let lastSentCols = cols
  let lastSentRows = rows

  function onResize(): void {
    if (done) return
    const newCols = stdout.columns ?? cols
    const newRows = stdout.rows ?? rows
    clearTimeout(resizeTimer)
    resizeTimer = setTimeout(() => {
      if (done) return
      // If shrunk, clear screen first
      if (newCols < lastSentCols || newRows < lastSentRows) {
        stdout.write(ERASE_DISPLAY + CURSOR_HOME)
      }
      lastSentCols = newCols
      lastSentRows = newRows
      socket.write(
        jsonStringify({
          proto: PROTO_VERSION,
          op: 'resize',
          short,
          cols: newCols,
          rows: newRows,
          attachId,
        }) + '\n',
      )
    }, 50)
  }

  // --- Input listeners ---
  function onStdinData(chunk: Buffer | string): void {
    const data = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk
    processInput(data)
  }

  function onReadable(): void {
    let chunk: Buffer | null
    while ((chunk = stdin.read() as Buffer | null) !== null) {
      processInput(
        typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk,
      )
    }
  }

  function onEnd(): void {
    finish('detached')
  }

  // --- Connect to daemon ---
  const socketPath = getControlSocketPath()
  let socket: Socket
  try {
    socket = connect(socketPath)
  } catch (err) {
    return { outcome: 'error', msg: String(err) }
  }

  // Ack timeout
  socket.setTimeout(ACK_TIMEOUT_MS, () => {
    if (!ackReceived)
      finish('error', 'daemon did not respond — it may be stalled')
  })

  // Track raw mode state
  const wasRaw = 'isRaw' in stdin ? Boolean(stdin.isRaw) : false

  // --- Socket event handlers ---
  let ackBuffer = Buffer.alloc(0)

  socket.on('data', (chunk: Buffer) => {
    if (done) return

    if (ackReceived) {
      // After ack: raw PTY output
      processOutput(chunk)
      return
    }

    // Before ack: accumulate until we get the JSON ack line
    ackBuffer = Buffer.concat([ackBuffer, chunk])
    const nlIdx = ackBuffer.indexOf(10) // '\n'
    if (nlIdx < 0) return

    const ackLine = ackBuffer.subarray(0, nlIdx).toString('utf8')
    const remainder = ackBuffer.subarray(nlIdx + 1)
    ackBuffer = Buffer.alloc(0)

    let ack: Record<string, unknown>
    try {
      ack = jsonParse(ackLine) as Record<string, unknown>
    } catch (e) {
      return finish('error', `bad ack: ${String(e)}`)
    }

    if (!ack.ok) {
      return finish('error', `${ack.code ?? 'ERROR'}: ${ack.error}`)
    }

    // Ack received — transition to raw stream mode
    ackReceived = true
    socket.setTimeout(0)
    ackMs = Date.now() - startTime
    via = ack.via as string | undefined
    tempo = ack.tempo as string | undefined

    // Seed DEC modes from ack
    const ackModes = (ack.decModes as number[] | undefined) ?? []
    const modeSeq = ackModes.map(decSet).join('')
    decModes.feed(modeSeq)

    // Write initial screen setup
    // On Windows, hide cursor to prevent the visible block/bar cursor that
    // survives FleetView handoff + clear (official: b ? op : ''). Must apply
    // on both paths — agents view always attaches with alreadyInAlt:true.
    const hideCursor = isWindows ? HIDE_CURSOR : ''
    if (opts.alreadyInAlt) {
      // Already in alt screen (FleetView handed off) — set modes + clear for fresh repaint
      stdout.write('\x1B[2J\x1B[H' + modeSeq + hideCursor)
    } else {
      stdout.write(
        enterAltScreen() +
          modeSeq +
          hideCursor +
          '\n  \x1B[2mAttaching\u2026\x1B[0m\n',
      )
    }

    // Enable raw mode on stdin (official: EN(q,!0) then readable + resume/pause)
    if (stdin.ref) stdin.ref()
    if (stdin.setRawMode) stdin.setRawMode(true)
    if (stdout.on) stdout.on('resize', onResize)
    // Remove any stale readable listeners (Ink may leave one behind after unmount)
    stdin.removeAllListeners('readable')
    // Use readable + read() pattern (paused mode) — matches official
    stdin.on('readable', onReadable)
    if ('resume' in stdin && 'pause' in stdin) {
      ;(stdin as NodeJS.ReadStream).resume()
      ;(stdin as NodeJS.ReadStream).pause()
    }
    stdin.once('end', onEnd)

    // Process any data that came after the ack line
    if (remainder.length > 0) processOutput(remainder)
  })

  socket.on('error', (err: Error) => {
    finish('error', err.message)
  })

  socket.once('close', () => {
    if (!done)
      finish(ackReceived ? 'disconnected' : 'error', 'control socket closed')
  })

  // Send attach request once connected
  socket.once('connect', () => {
    const req = {
      proto: PROTO_VERSION,
      op: 'attach',
      short,
      cols,
      rows,
      attachId,
      caps: getTerminalCaps(),
      ...(opts.holdingFrame && { holdingFrame: true }),
    }
    socket.write(jsonStringify(req) + '\n')
  })

  return resultPromise
}

// ---------------------------------------------------------------------------
// Terminal capabilities — official QAO
// ---------------------------------------------------------------------------

function getTerminalCaps(): Record<string, unknown> {
  return {
    terminal: process.env.TERM ?? null,
    mux: process.env.TMUX
      ? 'tmux'
      : process.env.ZELLIJ != null
        ? 'zellij'
        : process.env.STY
          ? 'screen'
          : null,
    ssh: !!process.env.SSH_CONNECTION || !!process.env.SSH_CLIENT,
    wtSession: !!process.env.WT_SESSION,
    isVscodeTerm: process.env.TERM_PROGRAM === 'vscode',
    browser: process.env.BROWSER ?? null,
    editor: process.env.VISUAL?.trim() || process.env.EDITOR?.trim() || null,
  }
}
