import { type CleanupUnregister, registerCleanup } from './cleanupRegistry.js'
import { logForDebugging } from './debug.js'
import { getBootstrapSessionHost } from './sessionHost.js'

/**
 * Sentinel written to stderr ahead of any diverted non-JSON line, so that
 * log scrapers and tests can grep for guard activity.
 */
export const STDOUT_GUARD_MARKER = '[stdout-guard]'

/**
 * Process-global refcounted stdout guard state.
 *
 * `process.stdout.write` is a single process-wide fd; wrapping it per-host
 * creates a nested wrapper chain that crashes on out-of-order teardown. We
 * instead track active hosts via a `WeakMap<object, GuardLeaseEntry>` paired
 * with a `Set<symbol>` of active lease tokens and a `FinalizationRegistry` so
 * we NEVER hold a strong root to `SessionHost`, wrap `process.stdout.write`
 * ONCE on `0 -> 1`, and restore the original write function ONLY on `1 -> 0`.
 */
type GuardLeaseEntry = {
  token: symbol
  unregister: CleanupUnregister | null
}

const activeGuardHosts = new WeakMap<object, GuardLeaseEntry>()
const activeGuardTokens = new Set<symbol>()
let rawOriginalWrite: typeof process.stdout.write | null = null
let boundOriginalWrite: typeof process.stdout.write | null = null
let lineBuffer = ''

const hostGuardFinalizer =
  typeof FinalizationRegistry === 'function'
    ? new FinalizationRegistry<symbol>(token => {
        releaseGuardToken(token, false)
      })
    : null

function isJsonLine(line: string): boolean {
  // Empty lines are tolerated in NDJSON streams — treat them as valid so a
  // trailing newline or a blank separator doesn't trip the guard.
  if (line.length === 0) {
    return true
  }
  try {
    JSON.parse(line)
    return true
  } catch {
    return false
  }
}

function releaseGuardToken(token: symbol, flushPartial: boolean): void {
  if (!activeGuardTokens.delete(token)) {
    return
  }

  // Keep the single process-global wrapper alive while any other host still
  // requires stream-json stdout protection.
  if (activeGuardTokens.size > 0) {
    return
  }

  if (flushPartial && lineBuffer.length > 0) {
    // Flush any partial line left in the buffer at shutdown. If it's a JSON
    // fragment it won't parse — divert it rather than drop it silently.
    if (boundOriginalWrite && isJsonLine(lineBuffer)) {
      boundOriginalWrite(lineBuffer + '\n')
    } else {
      process.stderr.write(`${STDOUT_GUARD_MARKER} ${lineBuffer}\n`)
    }
  }
  lineBuffer = ''

  if (rawOriginalWrite !== null) {
    process.stdout.write = rawOriginalWrite
    rawOriginalWrite = null
  }
  boundOriginalWrite = null
}

function uninstallGuardForHost(host: object, flushPartial: boolean): void {
  const entry = activeGuardHosts.get(host)
  if (!entry) {
    return
  }
  activeGuardHosts.delete(host)
  hostGuardFinalizer?.unregister(entry.token)
  entry.unregister?.()
  releaseGuardToken(entry.token, flushPartial)
}

/**
 * Install a runtime guard on process.stdout.write for --output-format=stream-json.
 *
 * SDK clients consuming stream-json parse stdout line-by-line as NDJSON. Any
 * stray write — a console.log from a dependency, a debug print that slipped
 * past review, a library banner — breaks the client's parser mid-stream with
 * no recovery path.
 *
 * This guard wraps process.stdout.write at the same layer the asciicast
 * recorder does (see asciicast.ts). Writes are buffered until a newline
 * arrives, then each complete line is JSON-parsed. Lines that parse are
 * forwarded to the real stdout; lines that don't are diverted to stderr
 * tagged with STDOUT_GUARD_MARKER so they remain visible without corrupting
 * the JSON stream.
 *
 * The blessed JSON path (structuredIO.write → writeToStdout → stdout.write)
 * always emits `ndjsonSafeStringify(msg) + '\n'`, so it passes straight
 * through. Only out-of-band writes are diverted.
 *
 * Installing twice on the same host is a no-op. Installing from multiple hosts
 * shares one refcounted process-global wrapper so out-of-order teardown never
 * corrupts `process.stdout.write`.
 */
export function installStreamJsonStdoutGuard(): void {
  const host = getBootstrapSessionHost()
  if (activeGuardHosts.has(host)) {
    return
  }

  if (activeGuardTokens.size === 0) {
    const savedRaw = process.stdout.write
    const savedBound = savedRaw.bind(
      process.stdout,
    ) as typeof process.stdout.write
    rawOriginalWrite = savedRaw
    boundOriginalWrite = savedBound

    process.stdout.write = function (
      chunk: string | Uint8Array,
      encodingOrCb?: BufferEncoding | ((err?: Error | null) => void),
      cb?: (err?: Error | null) => void,
    ): boolean {
      // If an external wrapper captured our guarded function and invokes it
      // after refcount reached 0, forward cleanly without crashing or diverting.
      if (activeGuardTokens.size === 0) {
        if (typeof encodingOrCb === 'function') {
          return savedBound(chunk, encodingOrCb)
        }
        if (encodingOrCb !== undefined) {
          return savedBound(chunk, encodingOrCb, cb)
        }
        return savedBound(chunk)
      }

      const text =
        typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8')

      lineBuffer += text
      let newlineIdx: number
      let wrote = true
      while ((newlineIdx = lineBuffer.indexOf('\n')) !== -1) {
        const line = lineBuffer.slice(0, newlineIdx)
        lineBuffer = lineBuffer.slice(newlineIdx + 1)
        if (isJsonLine(line)) {
          wrote = savedBound(line + '\n')
        } else {
          process.stderr.write(`${STDOUT_GUARD_MARKER} ${line}\n`)
          logForDebugging(
            `streamJsonStdoutGuard diverted non-JSON stdout line: ${line.slice(0, 200)}`,
          )
        }
      }

      // Fire the callback once buffering is done. We report success even when
      // a line was diverted — the caller's intent (emit text) was honored,
      // just on a different fd.
      const callback = typeof encodingOrCb === 'function' ? encodingOrCb : cb
      if (callback) {
        queueMicrotask(() => callback())
      }
      return wrote
    } as typeof process.stdout.write
  }

  const token = Symbol('stream-json-stdout-guard-host')
  const entry: GuardLeaseEntry = { token, unregister: null }
  activeGuardHosts.set(host, entry)
  activeGuardTokens.add(token)
  hostGuardFinalizer?.register(host, token, token)

  const hostRef = new WeakRef(host)
  const unregister = registerCleanup(async () => {
    const liveHost = hostRef.deref()
    if (liveHost !== undefined) {
      uninstallGuardForHost(liveHost, true)
    } else {
      releaseGuardToken(token, true)
    }
  })
  if (activeGuardHosts.get(host) === entry) {
    entry.unregister = unregister
  } else {
    unregister()
  }
}

/**
 * Testing-only reset. Releases the current host's guard ref and, if no other
 * host holds the guard, restores the real stdout.write and clears the line
 * buffer so subsequent tests start from a clean slate.
 */
export function _resetStreamJsonStdoutGuardForTesting(): void {
  uninstallGuardForHost(getBootstrapSessionHost(), false)
}
