/**
 * densable 2.1.289 Monitor stream pump — gold `Qhe` / `QCr` / `w1n` / `j6` / `B`.
 *
 * Stream events are statusless task-notifications whose summary is
 * `Monitor event: "<description>"` and whose body is `<event>…</event>`.
 * UserAgentNotificationMessage `Rp` paints the compact row from that shape.
 */
import { feature } from 'bun:bundle'
import { isClaudeCodeHintLine } from './claudeCodeHints.js'
import { formatDuration } from './format.js'
import { notifyTaskNotification } from './adoptFailNotify.js'
import { plural } from './stringUtils.js'

/** densable `pnt` */
export const MONITOR_EVENT_LABEL = 'Monitor event:'
/** densable `Avt` */
export const MONITOR_EVENT_SUMMARY_PREFIX = `${MONITOR_EVENT_LABEL} "`

/** densable `Xhe` */
export const MONITOR_STREAM_TOKEN_CAPACITY = 10
/** densable `Jhe` */
export const MONITOR_STREAM_REFILL_MS = 2000
/** densable `A` — per-line cap before `...(truncated)` */
export const MONITOR_STREAM_LINE_MAX = 500
/** densable `O` — per-batch cap */
export const MONITOR_STREAM_BATCH_MAX = 3000
/** densable `ae` — newline debounce */
export const MONITOR_STREAM_DEBOUNCE_MS = 200
/** densable `U` — rolling buffer */
export const MONITOR_STREAM_BUFFER_MAX = 1_048_576
/** densable `ie` — suppress window before kill */
export const MONITOR_STREAM_KILL_AFTER_MS = 30_000

const PUSH_NOTIFICATION_HINT =
  "\nIf this event is something the user would act on now, send a PushNotification. Routine or benign output doesn't need one."

export type TokenBucket = {
  tryConsume: () => boolean
  tokens: () => number
  msUntilToken: () => number
}

/** densable `Qhe` */
export function createTokenBucket(
  capacity: number,
  refillMs: number,
  now: () => number = Date.now,
): TokenBucket {
  let tokens = capacity
  let origin = now()
  function refill(): void {
    const t = now()
    const added = Math.floor((t - origin) / refillMs)
    if (added > 0) {
      tokens = Math.min(capacity, tokens + added)
      origin += added * refillMs
    }
  }
  return {
    tryConsume(): boolean {
      refill()
      if (tokens > 0) {
        tokens--
        return true
      }
      return false
    },
    tokens(): number {
      refill()
      return tokens
    },
    msUntilToken(): number {
      refill()
      if (tokens > 0) return 0
      return Math.max(0, origin + refillMs - now())
    },
  }
}

export type LineDebounceSchedule = (flush: () => void) => () => void

function defaultSchedule(flush: () => void): () => void {
  const timer = setTimeout(flush, MONITOR_STREAM_DEBOUNCE_MS)
  return () => clearTimeout(timer)
}

export type LineDebouncer = {
  onData: (chunk: string) => void
  flush: (includePartial?: boolean) => void
  drain: () => string | undefined
}

/** densable `QCr` */
export function createLineDebouncer(
  onFlush: (batch: string) => void,
  schedule: LineDebounceSchedule = defaultSchedule,
): LineDebouncer {
  let buf = ''
  let lines: string[] = []
  let cancel: (() => void) | null = null

  function take(includePartial: boolean): string | undefined {
    if (cancel) {
      cancel()
      cancel = null
    }
    if (includePartial && buf.trim() && !isClaudeCodeHintLine(buf.trim())) {
      let line = buf.trim()
      if (line.length > MONITOR_STREAM_LINE_MAX) {
        line = `${line.slice(0, MONITOR_STREAM_LINE_MAX)}...(truncated)`
      }
      lines.push(line)
      buf = ''
    }
    if (lines.length === 0) return undefined
    let batch = lines.join('\n')
    if (batch.length > MONITOR_STREAM_BATCH_MAX) {
      batch = `${batch.slice(0, MONITOR_STREAM_BATCH_MAX)}\n...(truncated)`
    }
    lines = []
    return batch
  }

  function flush(includePartial?: boolean): void {
    const batch = take(includePartial === true)
    if (batch !== undefined) onFlush(batch)
  }

  function onData(chunk: string): void {
    buf += chunk
    if (buf.length > MONITOR_STREAM_BUFFER_MAX) {
      buf = buf.slice(-MONITOR_STREAM_BUFFER_MAX)
    }
    let nl = buf.indexOf('\n')
    while (nl !== -1) {
      let line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!isClaudeCodeHintLine(line) && line) {
        if (line.length > MONITOR_STREAM_LINE_MAX) {
          line = `${line.slice(0, MONITOR_STREAM_LINE_MAX)}...(truncated)`
        }
        lines.push(line)
      }
      nl = buf.indexOf('\n')
    }
    if (lines.length > 0 && !cancel) {
      let ran = false
      const scheduled = schedule(() => {
        ran = true
        cancel = null
        flush()
      })
      // Sync schedules (tests) flush before we can store the canceler.
      if (!ran) cancel = scheduled
    }
  }

  return { onData, flush, drain: () => take(true) }
}

function isAgentPushNotifEnabled(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { resolveUserIntentSetting } =
      require('./config.js') as typeof import('./config.js')
    return (
      resolveUserIntentSetting('agentPushNotifEnabled', false).value === true
    )
  } catch {
    return false
  }
}

/** densable `Soe` — GB `tengu_kairos_push_notifications`. */
function isKairosPushNotificationsGb(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getFeatureValue_CACHED_MAY_BE_STALE } =
      require('../services/analytics/growthbook.js') as typeof import('../services/analytics/growthbook.js')
    return (
      getFeatureValue_CACHED_MAY_BE_STALE(
        'tengu_kairos_push_notifications',
        false,
      ) === true
    )
  } catch {
    return false
  }
}

/** densable `hbe` = Soe() && agentPushNotifEnabled. */
function isMonitorPushHintEnabled(): boolean {
  return isKairosPushNotificationsGb() && isAgentPushNotifEnabled()
}

/** densable `o` — unbounded remote cap / non-print bounded cap. */
const MONITOR_TIMEOUT_CAP_MS = 1_800_000
/** densable `r` — print/diskless bounded cap. */
const MONITOR_TIMEOUT_PRINT_CAP_MS = 600_000

/** densable `wBe` — sge()||Nt() ? r : o. */
export function monitorBoundedTimeoutCap(): number {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getIsRemoteMode, getIsNonInteractiveSession } =
      require('../bootstrap/state.js') as typeof import('../bootstrap/state.js')
    if (getIsRemoteMode() || getIsNonInteractiveSession()) {
      return MONITOR_TIMEOUT_PRINT_CAP_MS
    }
  } catch {
    // optional
  }
  return MONITOR_TIMEOUT_CAP_MS
}

/**
 * densable `b6o` — when bounded, clamp timeout and force persistent false.
 * Remote unbounded: persistent false, timeout o or min(timeout, o).
 */
export function clampMonitorSpawn(
  input: { timeout_ms?: number; persistent?: boolean },
  bounded: boolean,
): { timeout_ms: number; persistent: boolean } {
  const timeout = input.timeout_ms ?? 300_000
  if (bounded) {
    return {
      timeout_ms: Math.min(timeout, monitorBoundedTimeoutCap()),
      persistent: false,
    }
  }
  const persistent = input.persistent === true
  if (process.env.CLAUDE_CODE_REMOTE) {
    return {
      timeout_ms: persistent
        ? MONITOR_TIMEOUT_CAP_MS
        : Math.min(timeout, MONITOR_TIMEOUT_CAP_MS),
      persistent: false,
    }
  }
  return { timeout_ms: timeout, persistent }
}

/** densable `RQ` — Nt() || tengu_breezy_crescent default true. */
export function isMonitorTimeoutBounded(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getIsRemoteMode } =
      require('../bootstrap/state.js') as typeof import('../bootstrap/state.js')
    if (getIsRemoteMode()) return true
  } catch {
    // optional
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getFeatureValue_CACHED_MAY_BE_STALE } =
      require('../services/analytics/growthbook.js') as typeof import('../services/analytics/growthbook.js')
    return (
      getFeatureValue_CACHED_MAY_BE_STALE('tengu_breezy_crescent', true) !==
      false
    )
  } catch {
    return true
  }
}

/** densable `B(e, t=!1)` — `<event>` plus optional PushNotification hint. */
export function monitorEventBody(
  event: string,
  isHousekeeping = false,
): { event: string; eventHint?: string } {
  const hint =
    !isHousekeeping &&
    (feature('KAIROS_PUSH_NOTIFICATION') ? isMonitorPushHintEnabled() : false)
      ? PUSH_NOTIFICATION_HINT
      : undefined
  return hint !== undefined ? { event, eventHint: hint } : { event }
}

/** densable `j6` */
export function notifyMonitorStreamEvent(
  description: string,
  event: string,
  taskId: string | undefined,
  opts?: {
    isHousekeeping?: boolean
    agentId?: string
    /** densable vIt j6 `turnAttribution:"none"`; default inherit. */
    turnAttribution?: 'inherit' | 'none'
  },
): string {
  const body = monitorEventBody(event, opts?.isHousekeeping === true)
  return notifyTaskNotification({
    taskId,
    summary: `${MONITOR_EVENT_SUMMARY_PREFIX}${description}"`,
    event: body.event,
    eventHint: body.eventHint,
    agentId: opts?.agentId,
    // gold j6 omits shouldQuery (model turn). Adopt path keeps false.
    shouldQuery: 'omit',
    ...(opts?.turnAttribution === 'none'
      ? {}
      : { turnAttribution: 'inherit' as const }),
  })
}

/** densable `se` */
export function monitorSuppressedEvent(count: number): string {
  return `[${count} events suppressed — output rate too high. Consider using TaskStop to restart this monitor with a more selective filter.]`
}

/** densable unbounded `s` when `!RQ()`. */
export const MONITOR_TIMEOUT_SHORT = '[Monitor timed out — re-arm if needed.]'

/**
 * densable `nXn` / Official 2.1.326 #258 (`I5o` @293457017):
 * When a watch expires with 0 events and its command wrote to stderr, tell
 * Claude so and name the file holding the output.
 */
export function monitorExpiredEvent(
  timeoutMs: number,
  eventCount: number,
  bounded: boolean = isMonitorTimeoutBounded(),
  stderrOutputFile?: string,
): string {
  const stderrHint =
    eventCount === 0 && stderrOutputFile
      ? `Its command wrote to stderr, which isn't delivered as events and may mean it failed: see \`${stderrOutputFile}\`. `
      : ''
  if (!bounded) {
    if (stderrHint) {
      return `[Monitor timed out with no events delivered. ${stderrHint}Re-arm if needed.]`
    }
    return MONITOR_TIMEOUT_SHORT
  }
  const dur = formatDuration(timeoutMs, { hideTrailingZeros: true })
  if (eventCount === 0) {
    return `[Monitor expired after ${dur} with no events delivered. ${stderrHint}Re-arm it if you still need the watch — and widen the filter if silence was unexpected.]`
  }
  return `[Monitor expired after ${dur} with ${eventCount} ${plural(eventCount, 'event')} delivered. Re-arm it if you still need the watch.]`
}

/** densable Amn `terminalNotification` / YVe return. */
export type MonitorTerminalNotification = {
  taskId: string
  toolUseId?: string
  agentId?: string
  status: string
  summary: string
  outputFile?: string
  stopCause?: 'memory_pressure' | 'deadline'
  snapshot?: unknown
}

export type MonitorExitSettlement =
  | { terminalNotification?: MonitorTerminalNotification }
  | Promise<{ terminalNotification?: MonitorTerminalNotification }>
  | {
      settled: Promise<{
        terminalNotification?: MonitorTerminalNotification
      }>
    }

export type MonitorStreamPump = {
  onData: (chunk: string) => void
  flush: (includePartial?: boolean) => void
  isClosed: () => boolean
  eventCount: () => number
  reportExit: (
    settled?: MonitorExitSettlement,
    extraBody?: string,
  ) => Promise<void>
  flushAndClose: () => void
  dropAndClose: () => void
}

export type MonitorStreamPumpOpts = {
  description: string
  agentId?: string
  taskRef: { id?: string }
  killTask: () => boolean
  /** Re-check ownership at delivery, including batches queued before stop. */
  isStopped?: () => boolean
  now?: () => number
  bucket?: { capacity: number; refillMs: number }
  schedule?: LineDebounceSchedule
}

const MONITOR_STREAM_SUPPRESSED_SAMPLE_MAX_LINES = 5

/** Official 2.1.331 `MQo` / densable `w1n` */
export function createMonitorStreamPump(
  opts: MonitorStreamPumpOpts,
): MonitorStreamPump {
  const now = opts.now ?? Date.now
  const { capacity, refillMs } = opts.bucket ?? {
    capacity: MONITOR_STREAM_TOKEN_CAPACITY,
    refillMs: MONITOR_STREAM_REFILL_MS,
  }
  const bucket = createTokenBucket(capacity, refillMs, now)
  let eventCount = 0
  let suppressed = 0
  let suppressedSample: string[] = []
  let firstSuppressedAt: number | undefined
  let lastAttemptAt = now()
  let closed = false

  function recordSuppressedSample(batch: string | undefined): void {
    if (!batch) return
    const lines = batch
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
    if (lines.length === 0) return
    suppressedSample.push(...lines)
    if (suppressedSample.length > MONITOR_STREAM_SUPPRESSED_SAMPLE_MAX_LINES) {
      suppressedSample.splice(
        0,
        suppressedSample.length - MONITOR_STREAM_SUPPRESSED_SAMPLE_MAX_LINES,
      )
    }
  }

  function tryAdmit(batch?: string): boolean {
    const currentNow = now()
    // Official 2.1.331 `MQo` (@324374224): reset `firstSuppressedAt` BEFORE
    // `tryConsume()` whenever the stream has been quiet for > 3×refillMs or
    // the token bucket has refilled to full capacity so a recovered burst
    // never latches and kills a healthy long-running monitor hours later.
    if (
      currentNow - lastAttemptAt > refillMs * 3 ||
      bucket.tokens() === capacity
    ) {
      firstSuppressedAt = undefined
    }
    lastAttemptAt = currentNow
    if (!bucket.tryConsume()) {
      recordSuppressedSample(batch)
      suppressed++
      if (firstSuppressedAt === undefined) firstSuppressedAt = currentNow
      return false
    }
    if (suppressed > 0) {
      const recoveryBody = [
        monitorSuppressedEvent(suppressed),
        ...suppressedSample,
      ].join('\n')
      notifyMonitorStreamEvent(
        opts.description,
        recoveryBody,
        opts.taskRef.id,
        {
          isHousekeeping: true,
          agentId: opts.agentId,
        },
      )
      suppressed = 0
      suppressedSample = []
    }
    eventCount++
    return true
  }

  function onBatch(batch: string): void {
    if (closed || opts.isStopped?.()) {
      closed = true
      return
    }
    if (tryAdmit(batch)) {
      notifyMonitorStreamEvent(opts.description, batch, opts.taskRef.id, {
        agentId: opts.agentId,
      })
      return
    }
    if (
      firstSuppressedAt !== undefined &&
      now() - firstSuppressedAt > MONITOR_STREAM_KILL_AFTER_MS
    ) {
      closed = true
      if (opts.killTask()) {
        const elapsedS = Math.round((now() - firstSuppressedAt) / 1000)
        notifyMonitorStreamEvent(
          opts.description,
          `[Monitor stopped — too much output (${suppressed} events suppressed over ${elapsedS}s). Restart with a more selective source.]`,
          opts.taskRef.id,
          { isHousekeeping: true, agentId: opts.agentId },
        )
      }
    }
  }

  const debouncer = createLineDebouncer(onBatch, opts.schedule)

  async function reportExit(
    settled?: MonitorExitSettlement,
    extraBody?: string,
  ): Promise<void> {
    if (opts.isStopped?.()) {
      debouncer.drain()
      closed = true
      return
    }
    const leftover = closed ? undefined : debouncer.drain()
    closed = true
    let terminal: MonitorTerminalNotification | undefined
    if (settled !== undefined) {
      try {
        const promise =
          typeof settled === 'object' &&
          settled !== null &&
          'settled' in settled
            ? settled.settled
            : settled
        const resolved = await promise
        terminal = resolved.terminalNotification
      } catch {
        terminal = undefined
      }
    }
    if (opts.isStopped?.()) return
    const admitted = leftover !== undefined && tryAdmit(leftover)
    if (terminal !== undefined) {
      const combined = [
        admitted ? leftover : undefined,
        extraBody,
        ...suppressedSample,
      ]
        .filter((part): part is string => part !== undefined && part !== '')
        .join('\n')
      suppressedSample = []
      const body =
        combined !== '' ? monitorEventBody(combined, false) : undefined
      let stopNote: string | undefined
      if (terminal.stopCause !== undefined) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { STOP_CAUSE_LONG } =
            require('./bashTaskDelivery.js') as typeof import('./bashTaskDelivery.js')
          stopNote = STOP_CAUSE_LONG[terminal.stopCause]
        } catch {
          stopNote = undefined
        }
      }
      notifyTaskNotification({
        taskId: terminal.taskId,
        toolUseId: terminal.toolUseId,
        agentId: terminal.agentId ?? opts.agentId,
        status: terminal.status,
        summary: terminal.summary,
        outputFile: terminal.outputFile,
        note: stopNote,
        event: body?.event,
        eventHint: body?.eventHint,
        taskDelivery: terminal.snapshot,
        shouldQuery: 'omit',
        turnAttribution: 'inherit',
        emitSdk: false,
      })
      return
    }
    if (admitted) {
      notifyMonitorStreamEvent(
        opts.description,
        leftover as string,
        opts.taskRef.id,
        {
          agentId: opts.agentId,
        },
      )
    }
  }

  return {
    onData: debouncer.onData,
    flush: includePartial => debouncer.flush(includePartial),
    isClosed: () => closed,
    eventCount: () => eventCount,
    reportExit,
    flushAndClose: () => {
      debouncer.flush(true)
      closed = true
    },
    dropAndClose: () => {
      debouncer.drain()
      closed = true
    },
  }
}
