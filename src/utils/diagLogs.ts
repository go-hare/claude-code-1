/**
 * Official diagnostics file writer — class g / c() / Y / Qbt @179233000.
 * Leftover: host-owned pendingWrite bag via WeakOwnerCache; Qbt = flushDiagLogs.
 */
import { appendFile, mkdir } from 'fs/promises'
import { dirname } from 'path'
import { registerCleanup } from './cleanupRegistry.js'
import { getBootstrapSessionHost } from './sessionRoot.js'
import { jsonStringify } from './slowOperations.js'

type DiagnosticLogLevel = 'debug' | 'info' | 'warn' | 'error'

type DiagnosticLogEntry = {
  timestamp: string
  level: DiagnosticLogLevel
  event: string
  data: Record<string, unknown>
}

class WeakOwnerCache<T> {
  #e: () => T
  #t = new WeakMap<object, T>()
  constructor(e: () => T) {
    this.#e = e
  }
  of(e: object): T {
    const t = this.#t.get(e)
    if (t !== undefined) return t
    const o = this.#e()
    this.#t.set(e, o)
    return o
  }
}

async function appendDiagLine(path: string, line: string): Promise<void> {
  try {
    await appendFile(path, line)
  } catch {
    await mkdir(dirname(path), { recursive: true }).catch(noop)
    await appendFile(path, line)
  }
}

function noop(): void {}

/**
 * Official g @179232900 — leftover DiagLogWriter (never mint class g).
 * pendingWrite chain + Et(() => this.flush()) on first append.
 */
class DiagLogWriter {
  pendingWrite: Promise<void> = Promise.resolve()
  cleanupRegistered = false
  append(path: string, line: string): void {
    this.pendingWrite = this.pendingWrite
      .then(() => appendDiagLine(path, line))
      .catch(noop)
    if (!this.cleanupRegistered) {
      this.cleanupRegistered = true
      registerCleanup(() => this.flush())
    }
  }
  flush(): Promise<void> {
    return this.pendingWrite
  }
}

/** Official f = new K(() => new g); c() = f.of(z().host) */
const diagLogOwners = new WeakOwnerCache(() => new DiagLogWriter())

function diagLogWriter(): DiagLogWriter {
  return diagLogOwners.of(getBootstrapSessionHost())
}

/** Official m() — CLAUDE_CODE_DIAGNOSTICS_FILE */
function getDiagnosticLogFile(): string | undefined {
  return process.env.CLAUDE_CODE_DIAGNOSTICS_FILE
}

function formatDiagLine(
  level: DiagnosticLogLevel,
  event: string,
  data: Record<string, unknown>,
): string {
  const entry: DiagnosticLogEntry = {
    timestamp: new Date().toISOString(),
    level,
    event,
    data,
  }
  return jsonStringify(entry) + '\n'
}

function resolveDiagData(
  data?: Record<string, unknown> | (() => Record<string, unknown>),
): Record<string, unknown> {
  try {
    const resolved = typeof data === 'function' ? data() : data
    return resolved ?? {}
  } catch {
    return { diagnostics_payload_failed: true }
  }
}

/**
 * Logs diagnostic information to a logfile. This information is sent
 * via the environment manager to session-ingress to monitor issues from
 * within the container.
 *
 * *Important* - this function MUST NOT be called with any PII, including
 * file paths, project names, repo names, prompts, etc.
 *
 * Official Y(n,t,i) — leftover logForDiagnosticsNoPII.
 */
export function logForDiagnosticsNoPII(
  level: DiagnosticLogLevel,
  event: string,
  data?: Record<string, unknown> | (() => Record<string, unknown>),
): void {
  const logFile = getDiagnosticLogFile()
  if (!logFile) {
    return
  }

  let line: string
  try {
    line = formatDiagLine(level, event, resolveDiagData(data))
  } catch {
    line = formatDiagLine(level, event, { diagnostics_payload_failed: true })
  }
  diagLogWriter().append(logFile, line)
}

/**
 * Official Qbt — c().flush(). Used by leftover `_G` g() diag flush.
 */
export function flushDiagLogs(): Promise<void> {
  return diagLogWriter().flush()
}

/**
 * Wraps an async function with diagnostic timing logs.
 * Logs `{event}_started` before execution and `{event}_completed` after with duration_ms.
 *
 * Official TOe — leftover withDiagnosticsTiming.
 */
export async function withDiagnosticsTiming<T>(
  event: string,
  fn: () => Promise<T>,
  getData?: (result: T) => Record<string, unknown>,
): Promise<T> {
  const startTime = Date.now()
  logForDiagnosticsNoPII('info', `${event}_started`)

  try {
    const result = await fn()
    const additionalData = getData ? getData(result) : {}
    logForDiagnosticsNoPII('info', `${event}_completed`, {
      duration_ms: Date.now() - startTime,
      ...additionalData,
    })
    return result
  } catch (error) {
    logForDiagnosticsNoPII('error', `${event}_failed`, {
      duration_ms: Date.now() - startTime,
    })
    throw error
  }
}
