/**
 * densable `mbo` — wrap `process.stdout.write` with a non-blocking fd so a
 * stalled terminal does not block the event loop. `queuePacedFrame` holds the
 * next paint while `queuedBytes() > STDOUT_BACKLOG_BYTES`.
 *
 * Install is gated by densable `gbo`: envOverride ?? (isAnt || remoteFlag()).
 * Public builds pass isAnt=false. remoteFlag is gold
 * `k("tengu_event_loop_stall", !1)===!0`.
 */

import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  openSync,
  writeSync,
} from 'fs'
import { createRequire } from 'node:module'
import { logForDebugging } from '../utils/debug.js'
import { STDOUT_BACKLOG_BYTES } from './constants.js'

const MAX_QUEUE_BYTES = 4 * 1024 * 1024
const MAX_RETRY_MS = 25
const SGR_RESET = Buffer.from('\x1b[0m')

export type StdoutBackpressureEpisode = {
  durationMs: number
  peakQueuedBytes: number
  droppedBytes: number
  endedBy: 'drain' | 'flush'
}

export type NonBlockingStdoutHandle = {
  flush: () => void
  restore: () => void
  isActive: () => boolean
  queuedBytes: () => number
}

type ProbeResult =
  | { fd: number; reason?: undefined; errno?: undefined }
  | { fd?: undefined; reason: string; errno?: string }

type Slot = {
  fd: number
  originalWrite: typeof process.stdout.write
  installedWrite: typeof process.stdout.write | undefined
  queue: Buffer[]
  queuedBytes: number
  dropping: boolean
  timer: ReturnType<typeof setTimeout> | undefined
  retryMs: number
  episode: {
    startedMs: number
    peakQueuedBytes: number
    droppedBytes: number
  }
  onEpisodeEnd: (episode: StdoutBackpressureEpisode) => void
  onExit: () => void
}

const slots = new WeakMap<NodeJS.WriteStream, Slot>()
const skippedReasons = new Set<string>()

/**
 * densable `k("tengu_event_loop_stall", !1)===!0`.
 * Tests may pin the getter; production calls GrowthBook with default false.
 */
let getEventLoopStallFlagOverride: (() => boolean) | undefined

function kEventLoopStall(): boolean {
  if (getEventLoopStallFlagOverride) return getEventLoopStallFlagOverride()
  try {
    const require = createRequire(import.meta.url)
    const { getFeatureValue_CACHED_MAY_BE_STALE } =
      require('../../../../../src/services/analytics/growthbook.ts') as typeof import('../../../../../src/services/analytics/growthbook.ts')
    return (
      getFeatureValue_CACHED_MAY_BE_STALE<boolean>(
        'tengu_event_loop_stall',
        false,
      ) === true
    )
  } catch {
    return false
  }
}

export function bindNonBlockingStdoutRemoteFlag(getFlag: () => boolean): void {
  getEventLoopStallFlagOverride = getFlag
}

export function resetNonBlockingStdoutRemoteFlagForTests(): void {
  getEventLoopStallFlagOverride = undefined
}

function errnoName(err: unknown): string | undefined {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code?: unknown }).code
    if (typeof code === 'string') return code
  }
  return undefined
}

function ttynameFd1(): string | undefined {
  if (process.platform !== 'darwin') return undefined
  try {
    // bun:ffi — gold `ttyname_r(1, buf, 256)` via libSystem.
    const require = createRequire(import.meta.url)
    const ffi = require('bun:ffi') as {
      dlopen: (
        path: string,
        symbols: Record<string, { args: string[]; returns: string }>,
      ) => {
        symbols: {
          ttyname_r: (fd: number, buf: Uint8Array, len: number) => number
        }
        close: () => void
      }
    }
    const lib = ffi.dlopen('/usr/lib/libSystem.B.dylib', {
      ttyname_r: { args: ['i32', 'ptr', 'u64'], returns: 'i32' },
    })
    try {
      const buf = new Uint8Array(256)
      if (lib.symbols.ttyname_r(1, buf, buf.length) !== 0) return undefined
      const end = buf.indexOf(0)
      return new TextDecoder().decode(
        buf.subarray(0, end < 0 ? buf.length : end),
      )
    } finally {
      lib.close()
    }
  } catch {
    return undefined
  }
}

function probeFd(): ProbeResult {
  if (!process.stdout.isTTY) return { reason: 'not_a_tty' }
  let path: string
  switch (process.platform) {
    case 'linux':
      path = '/proc/self/fd/1'
      break
    case 'darwin': {
      const name = ttynameFd1()
      if (name === undefined) return { reason: 'ttyname_unavailable' }
      path = name
      break
    }
    default:
      return { reason: 'unsupported_platform' }
  }
  let fd: number
  try {
    const noctty =
      'O_NOCTTY' in fsConstants ? (fsConstants.O_NOCTTY as number) : 0
    fd = openSync(path, fsConstants.O_WRONLY | fsConstants.O_NONBLOCK | noctty)
  } catch (err) {
    return { reason: 'open_failed', errno: errnoName(err) }
  }
  let failed: ProbeResult = { reason: 'not_same_tty' }
  try {
    const opened = fstatSync(fd)
    const stdoutStat = fstatSync(1)
    if (opened.rdev === stdoutStat.rdev && opened.ino === stdoutStat.ino) {
      return { fd }
    }
  } catch (err) {
    failed = { reason: 'fstat_failed', errno: errnoName(err) }
  }
  try {
    closeSync(fd)
  } catch {
    // ignore
  }
  return failed
}

/**
 * densable `gbo({envOverride, isAnt, remoteFlag})` — `e??(n||o())`.
 * Truthy env strings count as override-on; unset/undefined falls through.
 * Empty string is kept by `??` and is falsy in boolean context.
 */
export function shouldEnableNonBlockingStdout({
  envOverride,
  isAnt,
  remoteFlag,
}: {
  envOverride: string | undefined
  isAnt: boolean
  remoteFlag: () => boolean
}): string | boolean | undefined {
  return envOverride ?? (isAnt || remoteFlag())
}

/**
 * densable ctor `gbo({envOverride: CLAUDE_CODE_NONBLOCKING_STDOUT, isAnt:!1,
 * remoteFlag: () => k("tengu_event_loop_stall", !1)===!0})`.
 */
export function shouldInstallNonBlockingStdout(): boolean {
  return Boolean(
    shouldEnableNonBlockingStdout({
      envOverride: process.env.CLAUDE_CODE_NONBLOCKING_STDOUT,
      isAnt: false,
      remoteFlag: () => kEventLoopStall() === true,
    }),
  )
}

/** densable `fZt`. */
export function isNonBlockingStdoutInstalled(): boolean {
  return slots.get(process.stdout)?.installedWrite !== undefined
}

/** densable `gZt` — flush the installed stdout wrap; no-op if unset. */
export function flushNonBlockingStdout(): void {
  const slot = slots.get(process.stdout)
  if (slot?.installedWrite !== undefined) flushSlot(slot)
}

function writeNonblock(fd: number, buf: Buffer): number {
  try {
    return writeSync(fd, buf)
  } catch (err) {
    const code = errnoName(err)
    if (code === 'EAGAIN' || code === 'EWOULDBLOCK' || code === 'EINTR') {
      return 0
    }
    throw err
  }
}

function enqueue(slot: Slot, buf: Buffer): void {
  slot.queue.push(buf)
  slot.queuedBytes += buf.length
  if (slot.queuedBytes > slot.episode.peakQueuedBytes) {
    slot.episode.peakQueuedBytes = slot.queuedBytes
  }
}

function armRetry(slot: Slot, progressed: boolean): void {
  slot.retryMs = progressed
    ? 0
    : Math.min(Math.max(1, slot.retryMs * 2), MAX_RETRY_MS)
  slot.timer = setTimeout(drainQueue, slot.retryMs, slot)
  slot.timer.unref?.()
}

function finishEpisode(slot: Slot, endedBy: 'drain' | 'flush'): void {
  slot.dropping = false
  slot.retryMs = 0
  try {
    slot.onEpisodeEnd({
      durationMs: Math.round(performance.now() - slot.episode.startedMs),
      peakQueuedBytes: slot.episode.peakQueuedBytes,
      droppedBytes: slot.episode.droppedBytes,
      endedBy,
    })
  } catch {
    // never throw from the episode callback
  }
}

function drainQueue(slot: Slot): void {
  slot.timer = undefined
  let progressed = false
  try {
    while (slot.queue.length > 0) {
      if (progressed && slot.queue.length > 1) {
        slot.queue = [Buffer.concat(slot.queue, slot.queuedBytes)]
      }
      const head = slot.queue[0]!
      const written = writeNonblock(slot.fd, head)
      if (written === 0) {
        armRetry(slot, progressed)
        return
      }
      progressed = true
      slot.queuedBytes -= written
      if (written < head.length) slot.queue[0] = head.subarray(written)
      else slot.queue.shift()
    }
  } catch (err) {
    abandon(slot, err)
    return
  }
  finishEpisode(slot, 'drain')
}

function accept(slot: Slot, buf: Buffer): void {
  if (buf.length === 0) return
  if (slot.queue.length === 0) {
    let written: number
    try {
      written = writeNonblock(slot.fd, buf)
    } catch (err) {
      abandon(slot, err)
      process.stdout.write(buf)
      return
    }
    if (written === buf.length) return
    slot.episode = {
      startedMs: performance.now(),
      peakQueuedBytes: 0,
      droppedBytes: 0,
    }
    enqueue(slot, buf.subarray(written))
    armRetry(slot, written > 0)
    return
  }
  if (slot.dropping) {
    slot.episode.droppedBytes += buf.length
    return
  }
  if (slot.queuedBytes + buf.length > MAX_QUEUE_BYTES) {
    slot.episode.droppedBytes += slot.queuedBytes + buf.length
    slot.queue = []
    slot.queuedBytes = 0
    slot.dropping = true
    logForDebugging(
      `nonBlockingStdout: terminal stopped reading; dropped ${slot.episode.droppedBytes} queued bytes, will repaint when it resumes`,
      { level: 'warn' },
    )
    enqueue(slot, SGR_RESET)
    return
  }
  enqueue(slot, buf)
}

function flushSlot(slot: Slot): void {
  if (slot.timer !== undefined) {
    clearTimeout(slot.timer)
    slot.timer = undefined
  }
  if (slot.queue.length === 0) return
  const pending = slot.queue
  slot.queue = []
  slot.queuedBytes = 0
  try {
    for (const buf of pending) {
      slot.originalWrite.call(process.stdout, buf)
    }
  } catch (err) {
    abandon(slot, err)
    return
  }
  finishEpisode(slot, 'flush')
}

function restoreSlot(slot: Slot): void {
  if (slot.installedWrite === undefined) return
  if (process.stdout.write === slot.installedWrite) {
    process.stdout.write = slot.originalWrite
  }
  slot.installedWrite = undefined
  slots.delete(process.stdout)
  process.off('exit', slot.onExit)
  try {
    closeSync(slot.fd)
  } catch {
    // ignore
  }
  flushSlot(slot)
}

function abandon(slot: Slot, err: unknown): void {
  logForDebugging(`nonBlockingStdout: uninstalling (${err})`)
  const leftover = slot.queue
  const leftoverBytes = slot.queuedBytes
  slot.queue = []
  slot.queuedBytes = 0
  slot.episode.droppedBytes += leftoverBytes
  try {
    for (const buf of leftover) {
      slot.originalWrite.call(process.stdout, buf)
    }
  } catch {
    // still failed — droppedBytes already counts the leftover
  }
  if (leftoverBytes > 0) finishEpisode(slot, 'flush')
  restoreSlot(slot)
}

function wrap(slot: Slot): NonBlockingStdoutHandle {
  return {
    flush: () => flushSlot(slot),
    restore: () => restoreSlot(slot),
    isActive: () => slot.installedWrite !== undefined,
    queuedBytes: () => slot.queuedBytes,
  }
}

/**
 * densable `mbo(onEpisodeEnd)`. Returns null when the fd probe fails.
 */
export function installNonBlockingStdout(
  onEpisodeEnd: (episode: StdoutBackpressureEpisode) => void,
): NonBlockingStdoutHandle | null {
  const existing = slots.get(process.stdout)
  if (existing?.installedWrite !== undefined) {
    existing.onEpisodeEnd = onEpisodeEnd
    return wrap(existing)
  }
  const probed = probeFd()
  if (probed.fd === undefined) {
    logForDebugging(
      `nonBlockingStdout: not installed (${probed.reason}${probed.errno ? `, ${probed.errno}` : ''})`,
    )
    logForDebugging('tengu_nonblocking_stdout', {
      result: 'skipped',
      reason: probed.reason,
    })
    if (!skippedReasons.has(probed.reason)) skippedReasons.add(probed.reason)
    return null
  }
  const slot: Slot = {
    fd: probed.fd,
    originalWrite: process.stdout.write.bind(process.stdout),
    installedWrite: undefined,
    queue: [],
    queuedBytes: 0,
    dropping: false,
    timer: undefined,
    retryMs: 0,
    episode: { startedMs: 0, peakQueuedBytes: 0, droppedBytes: 0 },
    onEpisodeEnd,
    onExit: () => restoreSlot(slot),
  }
  const installed: typeof process.stdout.write = ((chunk, encoding, cb) => {
    const enc = typeof encoding === 'string' ? encoding : undefined
    const done = typeof encoding === 'function' ? encoding : cb
    if (slot.installedWrite === undefined) {
      return slot.originalWrite.call(
        process.stdout,
        chunk,
        enc as BufferEncoding,
        done,
      )
    }
    const buf =
      typeof chunk === 'string'
        ? Buffer.from(chunk, enc as BufferEncoding | undefined)
        : Buffer.from(chunk as Uint8Array)
    accept(slot, buf)
    done?.()
    return true
  }) as typeof process.stdout.write
  slot.installedWrite = installed
  process.stdout.write = installed
  slots.set(process.stdout, slot)
  process.on('exit', slot.onExit)
  logForDebugging('nonBlockingStdout: active')
  logForDebugging('tengu_nonblocking_stdout', { result: 'installed' })
  return wrap(slot)
}

/** Test helper — gold `bSo` is 16384. */
export function stdoutBacklogThreshold(): number {
  return STDOUT_BACKLOG_BYTES
}
