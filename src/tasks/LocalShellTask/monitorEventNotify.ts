/**
 * densable Aio / Nre portable — rate-limited Monitor event notifications.
 *
 * densable 2.1.211 (`/tmp/claude-211/extracted-js/main_bundle.js`):
 *   - nns: line-buffer + debounce flush → event batches
 *   - ons: token-bucket (rns=10, wio=2000ms)
 *   - Aio: onData sink; suppress + kill on sustained flood (O9g=30s)
 *   - Nre: cf({mode:"task-notification", priority:"next", agentId:n?.agentId})
 *           summary `Monitor event: "…"` + `<event>…</event>`
 *           (main AL leaves agentId undefined — never mi())
 *
 * Local-only residual (no monitor_ws / cloud fleet). Wired from MonitorTool via
 * `exec(..., { onStdout })` so stdout is pipe-mode and events stream live.
 */

import {
  SUMMARY_TAG,
  TASK_ID_TAG,
  TASK_NOTIFICATION_TAG,
} from '../../constants/xml.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js'
import type { AgentId } from '../../types/ids.js'
import { getGlobalConfig } from '../../utils/config.js'
import { enqueuePendingNotification } from '../../utils/messageQueueManager.js'
import { escapeXml } from '../../utils/xml.js'

/** densable rns — token bucket capacity. */
export const MONITOR_EVENT_BUCKET_CAPACITY = 10
/** densable wio — ms per refilled token. */
export const MONITOR_EVENT_REFILL_MS = 2000
/** densable O9g — sustained-suppression window before auto-kill (ms). */
export const MONITOR_EVENT_KILL_WINDOW_MS = 30_000
/** densable Cio — max chars per event line. */
export const MONITOR_EVENT_MAX_LINE_CHARS = 500
/** densable YFu — max chars per flushed batch. */
export const MONITOR_EVENT_MAX_BATCH_CHARS = 3000
/** densable L9g — debounce flush delay (ms). */
export const MONITOR_EVENT_FLUSH_DEBOUNCE_MS = 200
/** densable JFu — rolling onData buffer cap (bytes/chars). */
export const MONITOR_EVENT_BUFFER_CAP = 1_048_576

export type MonitorEventNotifyOpts = {
  isHousekeeping?: boolean
  agentId?: AgentId
}

/**
 * densable rrt — optional PushNotification hint on non-housekeeping events.
 * `JCe() && xc("agentPushNotifEnabled", false).value`
 * Local: GrowthBook `tengu_kairos_push_notifications` + config agentPushNotifEnabled.
 */
export function shouldHintPushNotificationOnMonitorEvent(): boolean {
  if (
    !getFeatureValue_CACHED_MAY_BE_STALE(
      'tengu_kairos_push_notifications',
      false,
    )
  ) {
    return false
  }
  return getGlobalConfig().agentPushNotifEnabled === true
}

/**
 * densable ons — token bucket with floor-refill every `refillMs`.
 */
export function createTokenBucket(
  capacity: number,
  refillMs: number,
  now: () => number = Date.now,
): { tryConsume: () => boolean } {
  let tokens = capacity
  let last = now()
  function refill(): void {
    const t = now()
    const gained = Math.floor((t - last) / refillMs)
    if (gained > 0) {
      tokens = Math.min(capacity, tokens + gained)
      last += gained * refillMs
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
  }
}

/**
 * densable nns — accumulate stdout chunks into trimmed lines, debounce-flush
 * batches to `onBatch`.
 */
export function createLineBatcher(
  onBatch: (batch: string) => void,
  schedule: (cb: () => void) => () => void = cb => {
    const id = setTimeout(cb, MONITOR_EVENT_FLUSH_DEBOUNCE_MS)
    return () => clearTimeout(id)
  },
): {
  onData: (chunk: string) => void
  flush: (includePartial?: boolean) => void
} {
  let buf = ''
  let lines: string[] = []
  let cancel: (() => void) | null = null

  function flush(includePartial = false): void {
    if (cancel) {
      cancel()
      cancel = null
    }
    if (includePartial && buf.trim()) {
      let line = buf.trim()
      if (line.length > MONITOR_EVENT_MAX_LINE_CHARS) {
        line = line.slice(0, MONITOR_EVENT_MAX_LINE_CHARS) + '...(truncated)'
      }
      lines.push(line)
      buf = ''
    }
    if (lines.length === 0) return
    let batch = lines.join('\n')
    if (batch.length > MONITOR_EVENT_MAX_BATCH_CHARS) {
      batch = batch.slice(0, MONITOR_EVENT_MAX_BATCH_CHARS) + '\n...(truncated)'
    }
    lines = []
    onBatch(batch)
  }

  function onData(chunk: string): void {
    buf += chunk
    if (buf.length > MONITOR_EVENT_BUFFER_CAP) {
      buf = buf.slice(-MONITOR_EVENT_BUFFER_CAP)
    }
    let nl: number
    while ((nl = buf.indexOf('\n')) !== -1) {
      let line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line) continue
      if (line.length > MONITOR_EVENT_MAX_LINE_CHARS) {
        line = line.slice(0, MONITOR_EVENT_MAX_LINE_CHARS) + '...(truncated)'
      }
      lines.push(line)
    }
    if (lines.length > 0 && !cancel) {
      cancel = schedule(() => flush(false))
    }
  }

  return { onData, flush }
}

/**
 * densable Nre — enqueue a Monitor event task-notification.
 * Does NOT stamp task.notified (mid-stream; terminal notify still via _Xi).
 */
export function enqueueMonitorEventNotification(
  description: string,
  event: string,
  taskId: string | undefined,
  opts?: MonitorEventNotifyOpts,
): void {
  const taskIdLine = taskId
    ? `\n<${TASK_ID_TAG}>${escapeXml(taskId)}</${TASK_ID_TAG}>`
    : ''
  const pushHint =
    !opts?.isHousekeeping && shouldHintPushNotificationOnMonitorEvent()
      ? `\nIf this event is something the user would act on now, send a PushNotification. Routine or benign output doesn't need one.`
      : ''
  const message = `<${TASK_NOTIFICATION_TAG}>${taskIdLine}
<${SUMMARY_TAG}>Monitor event: "${escapeXml(description)}"</${SUMMARY_TAG}>
<event>${escapeXml(event)}</event>${pushHint}
</${TASK_NOTIFICATION_TAG}>`

  // Official: agentId as-is — undefined routes to main-thread AL drain.
  enqueuePendingNotification({
    value: message,
    mode: 'task-notification',
    priority: 'next',
    agentId: opts?.agentId,
  })
}

export type MonitorEventSink = {
  onData: (chunk: string) => void
  isKilled: () => boolean
  finish: () => void
}

export type CreateMonitorEventSinkArgs = {
  description: string
  agentId?: AgentId
  /** Mutable; id filled after spawnShellTask returns. densable taskRef. */
  taskRef: { id?: string }
  killTask: () => void
  /** Injectable clock for tests. */
  now?: () => number
  /** Injectable scheduler for tests. */
  schedule?: (cb: () => void) => () => void
}

/**
 * densable Aio — rate-limited onData sink for Monitor streaming events.
 */
export function createMonitorEventSink(
  args: CreateMonitorEventSinkArgs,
): MonitorEventSink {
  const {
    description,
    agentId,
    taskRef,
    killTask,
    now = Date.now,
    schedule,
  } = args

  let suppressed = 0
  let windowStart: number | undefined
  let lastSuppressedAt: number | undefined
  let killed = false
  const bucket = createTokenBucket(
    MONITOR_EVENT_BUCKET_CAPACITY,
    MONITOR_EVENT_REFILL_MS,
    now,
  )

  const batcher = createLineBatcher(batch => {
    if (killed) return
    if (bucket.tryConsume()) {
      if (suppressed > 0) {
        enqueueMonitorEventNotification(
          description,
          `[${suppressed} events suppressed \u2014 output rate too high. Consider using TaskStop to restart this monitor with a more selective filter.]`,
          taskRef.id,
          { isHousekeeping: true, agentId },
        )
        suppressed = 0
        // densable: if last suppress was > wio*3 ago, reset flood window
        if (
          lastSuppressedAt !== undefined &&
          now() - lastSuppressedAt > MONITOR_EVENT_REFILL_MS * 3
        ) {
          windowStart = undefined
        }
      }
      enqueueMonitorEventNotification(description, batch, taskRef.id, {
        agentId,
      })
      return
    }
    suppressed++
    lastSuppressedAt = now()
    if (windowStart === undefined) windowStart = now()
    if (now() - windowStart > MONITOR_EVENT_KILL_WINDOW_MS) {
      killed = true
      enqueueMonitorEventNotification(
        description,
        `[Monitor stopped \u2014 too much output (${suppressed} events suppressed over ${Math.round((now() - windowStart) / 1000)}s). Restart with a more selective source.]`,
        taskRef.id,
        { isHousekeeping: true, agentId },
      )
      killTask()
    }
  }, schedule)

  return {
    onData: batcher.onData,
    isKilled: () => killed,
    finish: () => {
      batcher.flush(true)
      killed = true
    },
  }
}
