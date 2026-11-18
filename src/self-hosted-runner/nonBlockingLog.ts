import { fstatSync, writeSync as fsWriteSync } from 'fs'

/** SEA `Cn = 262144` — 256 KiB per-stream ring buffer cap (#804). */
export const RUNNER_LOG_RING_MAX_BYTES = 262_144
const WRITE_CHUNK_BYTES = 65_536
const INITIAL_RETRY_MS = 50
const MAX_RETRY_MS = 2000
const CLOSE_DRAIN_MS = 2000
const WORKER_STALL_MS = 5000

const GONE_ERRNO_CODES = new Set([
  'EPIPE',
  'EBADF',
  'ENXIO',
  'EIO',
  'ESHUTDOWN',
])

const WORKER_ERRNOS = [
  'EAGAIN',
  'EINTR',
  'EPIPE',
  'EBADF',
  'ENXIO',
  'EIO',
  'ESHUTDOWN',
  'EINVAL',
] as const

const WORKER_SCRIPT = `
const fs = require('fs');
self.onmessage = (ev) => {
  const data = ev.data;
  if (data && typeof data.fd === 'number' && data.shared) {
    self._fd = data.fd;
    self._shared = data.shared;
    self._errnos = data.errnos || [];
    return;
  }
  const buf = data;
  const shared = self._shared;
  let written = 0;
  let errIdx = 0;
  try {
    Atomics.store(shared, 3, 1);
    written = fs.writeSync(self._fd, buf, 0, buf.byteLength);
  } catch (e) {
    const code = e && e.code ? String(e.code) : '';
    const idx = self._errnos.indexOf(code);
    errIdx = idx >= 0 ? idx + 1 : 1;
  } finally {
    Atomics.store(shared, 3, 0);
    Atomics.store(shared, 1, written);
    Atomics.store(shared, 2, errIdx);
    Atomics.store(shared, 0, 2);
    Atomics.notify(shared, 0);
    self.postMessage(1);
  }
};
`

export type ThreadWriter = {
  write: (buf: Buffer, offset: number) => number
  wait?: (ms: number) => void
}

export type NonBlockingLogIo = {
  sameFile: (fd1: number, fd2: number) => boolean
  canWriteDirectly: (fd: number) => boolean
  writeSync: (fd: number, buf: Buffer, offset: number) => number
  writeOnAThread: (fd: number, onDone: () => void) => ThreadWriter | undefined
  sleep: (ms: number) => void
}

export type NonBlockingLogClock = {
  monotonicNow: () => number
  setTimeout: (
    fn: () => void,
    ms: number,
    opts?: { unref?: boolean },
  ) => () => void
}

export type RunnerLogWriterStats = {
  queuedBytes: number
  droppedLines: number
  failedLines: Record<string, number>
}

export type RunnerNonBlockingLogWriter = {
  write: (stream: 'stdout' | 'stderr', line: string) => void
  stats: () => RunnerLogWriterStats
  close: () => void
}

function getErrCode(err: unknown): string | undefined {
  if (err !== null && typeof err === 'object' && 'code' in err) {
    const c = (err as { code?: unknown }).code
    return typeof c === 'string' ? c : undefined
  }
  return undefined
}

function countLines(buf: Buffer): number {
  let n = 0
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 10) n++
  }
  return Math.max(1, n)
}

const defaultIo: NonBlockingLogIo = {
  sameFile(fd1, fd2) {
    try {
      const a = fstatSync(fd1)
      const b = fstatSync(fd2)
      return a.dev === b.dev && a.ino === b.ino && a.rdev === b.rdev
    } catch {
      return false
    }
  },
  canWriteDirectly(fd) {
    try {
      const st = fstatSync(fd)
      return st.isFile() || st.isCharacterDevice()
    } catch {
      return false
    }
  },
  writeSync(fd, buf, offset) {
    return fsWriteSync(fd, buf, offset, buf.length - offset)
  },
  writeOnAThread(fd, onDone) {
    // Shared states in shared[0]: 0 = idle, 1 = busy, 2 = done
    let worker: Worker | undefined
    const shared = new Int32Array(new SharedArrayBuffer(16))
    let postedAt: number | undefined
    let deferredErr: string | undefined
    try {
      const blobUrl = URL.createObjectURL(
        new Blob([WORKER_SCRIPT], { type: 'application/javascript' }),
      )
      worker = new Worker(blobUrl)
      ;(worker as unknown as { unref?: () => void }).unref?.()
      worker.onmessage = onDone
      worker.onerror = () => {
        worker = undefined
      }
      worker.postMessage({ fd, shared, errnos: [...WORKER_ERRNOS] })
    } catch {
      worker = undefined
    }
    const throwCode = (code: string): never => {
      throw Object.assign(new Error('the thread did not write the bytes'), {
        code,
      })
    }
    return {
      write(buf, offset) {
        if (deferredErr !== undefined) {
          const e = deferredErr
          deferredErr = undefined
          throwCode(e)
        }
        const state = Atomics.load(shared, 0)
        if (state === 2) {
          const written = Atomics.load(shared, 1)
          const errIdx = Atomics.load(shared, 2)
          Atomics.store(shared, 0, 0)
          if (errIdx > 0) {
            const code = WORKER_ERRNOS[errIdx - 1] ?? 'EIO'
            if (written === 0) throwCode(code)
            deferredErr = code
          }
          return written
        }
        if (
          state === 1 &&
          Atomics.load(shared, 3) === 0 &&
          postedAt !== undefined &&
          performance.now() - postedAt > WORKER_STALL_MS
        ) {
          void worker?.terminate()
          worker = undefined
          Atomics.store(shared, 0, 0)
        }
        if (worker === undefined) {
          throw Object.assign(new Error('the thread could not be started'), {
            code: 'NO_THREAD',
          })
        }
        if (state === 0) {
          Atomics.store(shared, 0, 1)
          postedAt = performance.now()
          const slice = Uint8Array.prototype.slice.call(
            buf,
            offset,
            offset + WRITE_CHUNK_BYTES,
          )
          worker.postMessage(slice)
        }
        throw Object.assign(new Error('the thread has the bytes'), {
          code: 'EINPROGRESS',
        })
      },
      wait(ms) {
        Atomics.wait(shared, 0, 1, ms)
      },
    }
  },
  sleep(ms) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
  },
}

const defaultClock: NonBlockingLogClock = {
  monotonicNow: () => performance.now(),
  setTimeout(fn, ms, opts) {
    const t = setTimeout(fn, ms)
    if (opts?.unref) t.unref?.()
    return () => clearTimeout(t)
  },
}

type QueuedChunk = {
  bytes: Buffer
  lines: number
}

type InFlightChunk = {
  bytes: Buffer
  offset: number
  lines: number
  announces: number
  notice?: string
}

type StreamState = {
  name: string
  fd: number
  write: (buf: Buffer, offset: number) => number
  waitForTheThread?: (ms: number) => void
  waiting: QueuedChunk[]
  waitingBytes: number
  head?: InFlightChunk
  gone: boolean
  unannounced: number
  unannouncedSinceMs?: number
  retryMs: number
  cancelRetry?: () => void
}

/**
 * SEA `vor` (#804): non-blocking runner/orchestrator log writer.
 * Keeps at most 256 KiB (`RUNNER_LOG_RING_MAX_BYTES`) of latest log lines per
 * stream, offloading slow pipe writes to a Worker thread so polls, `/healthz`,
 * and `SIGTERM` shutdown never freeze when stdout/stderr is unread.
 */
export function createNonBlockingRunnerLogWriter(
  opts: {
    io?: NonBlockingLogIo
    clock?: NonBlockingLogClock
    stamp?: (line: string) => string
    onOwnLine?: (line: string) => void
    maxRingBytes?: number
  } = {},
): RunnerNonBlockingLogWriter {
  const io = opts.io ?? defaultIo
  const clock = opts.clock ?? defaultClock
  const stamp = opts.stamp ?? (s => s)
  const maxRingBytes = opts.maxRingBytes ?? RUNNER_LOG_RING_MAX_BYTES

  const makeStream = (fd: number, name: string): StreamState => {
    const direct = io.canWriteDirectly(fd)
    const threaded = direct
      ? undefined
      : io.writeOnAThread(fd, () => pump(stream))
    const stream: StreamState = {
      name,
      fd,
      write:
        threaded?.write ?? ((buf, offset) => io.writeSync(fd, buf, offset)),
      waitForTheThread: threaded?.wait,
      waiting: [],
      waitingBytes: 0,
      gone: false,
      unannounced: 0,
      retryMs: INITIAL_RETRY_MS,
    }
    return stream
  }

  const same = io.sameFile(1, 2)
  const stdoutStream = makeStream(1, same ? 'stdout and stderr' : 'stdout')
  const stderrStream = same ? stdoutStream : makeStream(2, 'stderr')
  const streams = same ? [stdoutStream] : [stdoutStream, stderrStream]

  const failedLines: Record<string, number> = {}
  const reportedErrors = new Set<string>()
  let droppedTotal = 0
  let closed = false
  let exiting = false

  function recordDrop(s: StreamState, lines: number): void {
    s.unannouncedSinceMs ??= clock.monotonicNow()
    s.unannounced += lines
    droppedTotal += lines
  }

  function popBatch(s: StreamState): InFlightChunk | undefined {
    const first = s.waiting.shift()
    if (first === undefined) return undefined
    s.waitingBytes -= first.bytes.length
    if (s.waitForTheThread === undefined) {
      return {
        bytes: first.bytes,
        offset: 0,
        lines: first.lines,
        announces: 0,
      }
    }
    const parts = [first]
    let total = first.bytes.length
    while (
      s.waiting.length > 0 &&
      total + s.waiting[0]!.bytes.length <= WRITE_CHUNK_BYTES
    ) {
      const next = s.waiting.shift()!
      s.waitingBytes -= next.bytes.length
      total += next.bytes.length
      parts.push(next)
    }
    return {
      bytes:
        parts.length === 1
          ? first.bytes
          : Buffer.concat(
              parts.map(p => p.bytes),
              total,
            ),
      offset: 0,
      lines: parts.reduce((acc, p) => acc + p.lines, 0),
      announces: 0,
    }
  }

  function nextChunk(s: StreamState): InFlightChunk | undefined {
    if (s.unannounced > 0) {
      const count = s.unannounced
      s.unannounced = 0
      const secs = Math.max(
        1,
        Math.ceil((clock.monotonicNow() - (s.unannouncedSinceMs ?? 0)) / 1000),
      )
      const notice = stamp(
        `[runner:log] ${count === 1 ? '1 log line' : `${count} log lines`} to ${s.name} ${count === 1 ? 'was' : 'were'} dropped over ${secs} s: whatever reads ${s.name} was paused or too slow`,
      )
      const noticeChunk: InFlightChunk = {
        bytes: Buffer.from(`${notice}\n`),
        offset: 0,
        lines: 0,
        announces: count,
        notice,
      }
      const next = s.waitForTheThread === undefined ? undefined : popBatch(s)
      if (next === undefined) return noticeChunk
      return {
        bytes: Buffer.concat([noticeChunk.bytes, next.bytes]),
        offset: 0,
        lines: next.lines,
        announces: count,
        notice,
      }
    }
    return popBatch(s)
  }

  function onChunkWritten(s: StreamState, chunk: InFlightChunk): void {
    if (chunk.announces > 0) {
      opts.onOwnLine?.(chunk.notice ?? chunk.bytes.toString().trimEnd())
      if (s.unannounced === 0) s.unannouncedSinceMs = undefined
    }
    s.retryMs = INITIAL_RETRY_MS
  }

  function enqueue(s: StreamState, chunk: QueuedChunk): void {
    s.waiting.push(chunk)
    s.waitingBytes += chunk.bytes.length
    while (s.waitingBytes > maxRingBytes && s.waiting.length > 1) {
      const evicted = s.waiting.shift()!
      s.waitingBytes -= evicted.bytes.length
      recordDrop(s, evicted.lines)
    }
  }

  function emitOwnWarning(
    msg: string,
    streamName: 'stdout' | 'stderr' = 'stdout',
  ): void {
    const line = stamp(msg)
    opts.onOwnLine?.(line)
    if (!exiting) {
      writer.write(streamName, line)
    }
  }

  function fallbackFromThread(s: StreamState): void {
    s.write = (buf, offset) => io.writeSync(s.fd, buf, offset)
    s.waitForTheThread = undefined
    emitOwnWarning(
      `[runner:warn] The thread that writes this process's ${s.name} could not start, or it stopped, so this process writes there itself. If nothing reads ${s.name}, that can hold this process up. Make sure something reads it, such as the journal or a log file.`,
      s === stdoutStream ? 'stderr' : 'stdout',
    )
  }

  function handleWriteFailure(
    s: StreamState,
    chunk: InFlightChunk,
    code: string,
  ): void {
    const key = `${s.name} ${code}`
    const firstTime = !reportedErrors.has(key)
    reportedErrors.add(key)
    const remainingBytes =
      chunk.offset === 0 ? chunk.bytes : chunk.bytes.subarray(chunk.offset)
    const remainingLines =
      chunk.offset === 0 ? chunk.lines : countLines(remainingBytes)
    if (!GONE_ERRNO_CODES.has(code)) {
      failedLines[code] = (failedLines[code] ?? 0) + remainingLines
      if (firstTime) {
        emitOwnWarning(
          `[runner:warn] A write to this process's ${s.name} failed (${code}), so some log lines are missing there. This process keeps running. If this error happens again on ${s.name}, it will not be reported.`,
          s === stdoutStream ? 'stderr' : 'stdout',
        )
      }
      return
    }
    s.gone = true
    const rescue = [
      { bytes: remainingBytes, lines: remainingLines },
      ...s.waiting,
    ]
    s.waiting = []
    s.waitingBytes = 0
    s.unannounced = 0
    s.unannouncedSinceMs = undefined
    emitOwnWarning(
      `[runner:warn] Nobody can read this process's ${s.name} anymore (${code}), so nothing more is written there.${s === stdoutStream && !stderrStream.gone ? ' Status lines go to stderr from here on.' : ''}`,
    )
    if (s === stdoutStream && !stderrStream.gone) {
      for (const item of rescue) {
        if (item.lines > 0) enqueue(stderrStream, item)
      }
      pump(stderrStream)
    }
  }

  function flushStream(s: StreamState): void {
    while (!s.gone) {
      s.head ??= nextChunk(s)
      const chunk = s.head
      if (chunk === undefined) return
      let code = 'EAGAIN'
      try {
        const written = s.write(chunk.bytes, chunk.offset)
        chunk.offset += written
        if (written > 0) {
          if (chunk.offset >= chunk.bytes.length) {
            s.head = undefined
            onChunkWritten(s, chunk)
          }
          continue
        }
      } catch (err) {
        code = getErrCode(err) ?? 'unknown'
      }
      if (code === 'EINTR') continue
      if (code === 'NO_THREAD') {
        fallbackFromThread(s)
        continue
      }
      if (code !== 'EAGAIN' && code !== 'EINPROGRESS') {
        s.head = undefined
        handleWriteFailure(s, chunk, code)
        continue
      }
      if (code === 'EAGAIN' && chunk.offset === 0) {
        s.head = undefined
        s.unannounced += chunk.announces
        if (chunk.announces === 0) {
          s.waiting.unshift({ bytes: chunk.bytes, lines: chunk.lines })
          s.waitingBytes += chunk.bytes.length
        }
      }
      if (!closed && !exiting && s.cancelRetry === undefined) {
        s.cancelRetry = clock.setTimeout(
          () => {
            s.cancelRetry = undefined
            pump(s)
          },
          s.retryMs,
          { unref: true },
        )
        s.retryMs = Math.min(s.retryMs * 2, MAX_RETRY_MS)
      }
      return
    }
  }

  function pump(s: StreamState): void {
    if (!closed) flushStream(s)
  }

  function drainSync(budgetMs: number): void {
    const deadline = clock.monotonicNow() + budgetMs
    for (;;) {
      for (const s of streams) pump(s)
      const pending = streams.some(
        s => s.head !== undefined || s.waiting.length > 0,
      )
      const remaining = deadline - clock.monotonicNow()
      if (!pending || remaining <= 0) return
      const threaded = streams.find(
        s => s.head !== undefined && s.waitForTheThread !== undefined,
      )
      if (threaded?.waitForTheThread) {
        threaded.waitForTheThread(Math.min(remaining, MAX_RETRY_MS))
      } else {
        io.sleep(Math.min(remaining, INITIAL_RETRY_MS))
      }
    }
  }

  const onExit = (): void => {
    exiting = true
    drainSync(CLOSE_DRAIN_MS)
  }
  process.on('exit', onExit)

  const writer: RunnerNonBlockingLogWriter = {
    write(streamName, line) {
      const target = streamName === 'stdout' ? stdoutStream : stderrStream
      const dest = target.gone ? stderrStream : target
      if (closed || dest.gone) return
      enqueue(dest, { bytes: Buffer.from(`${line}\n`), lines: 1 })
      pump(dest)
    },
    stats() {
      return {
        queuedBytes: streams.reduce(
          (acc, s) =>
            acc +
            s.waitingBytes +
            (s.head ? s.head.bytes.length - s.head.offset : 0),
          0,
        ),
        droppedLines: droppedTotal,
        failedLines: { ...failedLines },
      }
    },
    close() {
      if (closed) return
      exiting = true
      drainSync(CLOSE_DRAIN_MS)
      closed = true
      process.off('exit', onExit)
      for (const s of streams) {
        s.cancelRetry?.()
      }
    },
  }

  return writer
}
