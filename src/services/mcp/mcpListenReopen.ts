/**
 * densable 2.1.233 #6 — subscriptions/listen re-open / park controller (npS / opS).
 *
 * Gold constants (SEA):
 *   Q3r = [1000, 2000, 4000]  backoff before each re-open attempt
 *   YdS = 10000   reset attempt index if previous listen lived this long
 *   XdS = 5000    redeploy grace after graceful close
 *   JdS = 3600000 trailing window for park counting (1h)
 *   ZdS = 5       windowMax default reopens before park
 *   QdS = 21600000 park delay default (6h)
 *   epS = 5000    park sleep chunk
 *
 * Product intent: when a fixed-timeout proxy kills held listen streams, do not
 * spin forever — park after windowMax reopens in the trailing hour (GB
 * tengu_mcp_listen_reopen_park, default true) with optional
 * tengu_mcp_listen_reopen_park_tuning {windowMax, parkDelayMinutes}.
 *
 * Driver attaches when Client has listen (MCP v2 / densable modern era). On
 * legacy-era connections getProtocolEra()!=='modern' and no autoOpenedSubscription
 * → hNf no-ops (list_changed still uses unsolicited notifications).
 */

import { createHash } from 'crypto'
import { z } from 'zod/v4'
import { getFeatureValue_CACHED_MAY_BE_STALE } from 'src/services/analytics/growthbook.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import { logForDebugging } from 'src/utils/debug.js'
import { errorMessage } from 'src/utils/errors.js'
import { sleep } from 'src/utils/sleep.js'

/**
 * densable `wce`/`hu` — sha256 hex slice(0,12) of server name for analytics.
 * Not invent: SEA `function hu(e){return createHash("sha256").update(e).digest("hex").slice(0,12)}`.
 */
export function hashMcpServerKey(serverName: string): string {
  return createHash('sha256').update(serverName).digest('hex').slice(0, 12)
}

function listenReopenAnalytics(
  serverName: string,
  fields: {
    outcome: string
    attempts: number
    trigger: string
  },
): void {
  logEvent('tengu_mcp_listen_reopen', {
    mcpServerKeyHash: hashMcpServerKey(
      serverName,
    ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    outcome:
      fields.outcome as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    attempts: fields.attempts,
    trigger:
      fields.trigger as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
}

/** densable Q3r */
export const MCP_LISTEN_REOPEN_BACKOFF_MS = [1000, 2000, 4000] as const
/** densable YdS — healthy listen lifetime resets delay index */
export const MCP_LISTEN_HEALTHY_MS = 10_000
/** densable XdS — graceful redeploy grace */
export const MCP_LISTEN_GRACEFUL_REDEPLOY_MS = 5_000
/** densable JdS — park trailing window */
export const MCP_LISTEN_PARK_WINDOW_MS = 3_600_000
/** densable ZdS */
export const MCP_LISTEN_PARK_WINDOW_MAX_DEFAULT = 5
/** densable QdS */
export const MCP_LISTEN_PARK_DELAY_MS_DEFAULT = 21_600_000
/** densable epS */
export const MCP_LISTEN_PARK_SLEEP_CHUNK_MS = 5_000

const parkTuningSchema = z.object({
  windowMax: z.number().int().min(1).max(100).optional(),
  parkDelayMinutes: z.number().min(1).max(1440).optional(),
})

export type McpListenCloseCause = 'local' | 'remote' | 'graceful'

export type McpListenParkTuning = {
  windowMax: number
  parkDelayMs: number
}

export function resolveMcpListenParkTuning(
  gbValue: unknown = getFeatureValue_CACHED_MAY_BE_STALE(
    'tengu_mcp_listen_reopen_park_tuning',
    null,
  ),
): McpListenParkTuning {
  const parsed = parkTuningSchema.safeParse(gbValue)
  const data = parsed.success ? parsed.data : {}
  return {
    windowMax: data.windowMax ?? MCP_LISTEN_PARK_WINDOW_MAX_DEFAULT,
    parkDelayMs:
      data.parkDelayMinutes !== undefined
        ? Math.round(data.parkDelayMinutes * 60_000)
        : MCP_LISTEN_PARK_DELAY_MS_DEFAULT,
  }
}

export function isMcpListenReopenParkEnabled(): boolean {
  return (
    getFeatureValue_CACHED_MAY_BE_STALE(
      'tengu_mcp_listen_reopen_park',
      true,
    ) === true
  )
}

/**
 * densable park gate: enough reopens in trailing window AND delay budget left.
 */
export function shouldParkMcpListenReopen(args: {
  reopenTimestampsMs: number[]
  delayIndex: number
  nowMs?: number
  tuning?: McpListenParkTuning
  parkEnabled?: boolean
}): boolean {
  const now = args.nowMs ?? Date.now()
  const tuning = args.tuning ?? resolveMcpListenParkTuning()
  const parkEnabled = args.parkEnabled ?? isMcpListenReopenParkEnabled()
  if (!parkEnabled) return false
  if (args.delayIndex >= MCP_LISTEN_REOPEN_BACKOFF_MS.length) return false
  const recent = args.reopenTimestampsMs.filter(
    t => now - t < MCP_LISTEN_PARK_WINDOW_MS,
  )
  return recent.length >= tuning.windowMax
}

/** densable jittered park end: now + parkDelay * (0.8 + random*0.4) */
export function computeMcpListenParkUntilMs(
  parkDelayMs: number,
  nowMs: number = Date.now(),
  random: () => number = Math.random,
): number {
  return nowMs + Math.round(parkDelayMs * (0.8 + random() * 0.4))
}

/**
 * densable: if previous listen lived >= YdS, reset delay index to 0.
 */
export function resetDelayIndexIfHealthy(
  listenLivedMs: number,
  delayIndex: number,
): number {
  return listenLivedMs >= MCP_LISTEN_HEALTHY_MS ? 0 : delayIndex
}

export function nextMcpListenReopenBackoffMs(delayIndex: number): number {
  return MCP_LISTEN_REOPEN_BACKOFF_MS[
    Math.min(delayIndex, MCP_LISTEN_REOPEN_BACKOFF_MS.length - 1)
  ]!
}

export type McpListenLike = {
  closed: Promise<McpListenCloseCause>
}

export type McpListenCapableClient = {
  transport?: unknown
  getServerCapabilities?: () =>
    | {
        tools?: { listChanged?: boolean }
        prompts?: { listChanged?: boolean }
        resources?: { listChanged?: boolean }
      }
    | undefined
  getProtocolEra?: () => string | undefined
  autoOpenedSubscription?: McpListenLike
  listen?: (
    filter: Record<string, boolean>,
    opts?: { timeout?: number },
  ) => Promise<McpListenLike>
}

function buildListChangedFilter(
  caps: ReturnType<
    NonNullable<McpListenCapableClient['getServerCapabilities']>
  >,
): Record<string, boolean> | undefined {
  if (!caps) return undefined
  const filter: Record<string, boolean> = {
    ...(caps.tools?.listChanged ? { toolsListChanged: true } : {}),
    ...(caps.prompts?.listChanged ? { promptsListChanged: true } : {}),
    ...(caps.resources?.listChanged ? { resourcesListChanged: true } : {}),
  }
  return Object.keys(filter).length > 0 ? filter : undefined
}

/**
 * densable LVa / xVa / rpS — per-server list refetch handlers invoked after a
 * successful listen re-open for honored filter bits.
 */
export type McpListenListKind = 'tools' | 'prompts' | 'resources'

const postReopenHandlers = new Map<
  string,
  Partial<Record<McpListenListKind, () => void | Promise<void>>>
>()

/** densable LVa */
export function registerMcpListenPostReopenHandler(
  serverName: string,
  kind: McpListenListKind,
  handler: () => void | Promise<void>,
): void {
  const entry = postReopenHandlers.get(serverName) ?? {}
  entry[kind] = handler
  postReopenHandlers.set(serverName, entry)
}

export function clearMcpListenPostReopenHandlers(serverName: string): void {
  postReopenHandlers.delete(serverName)
}

/** densable rpS */
export function invokeMcpListenPostReopenRefetch(
  serverName: string,
  filter: Record<string, boolean>,
): void {
  const entry = postReopenHandlers.get(serverName)
  if (entry === undefined) return
  const pairs: Array<[string, McpListenListKind]> = [
    ['toolsListChanged', 'tools'],
    ['promptsListChanged', 'prompts'],
    ['resourcesListChanged', 'resources'],
  ]
  for (const [bit, kind] of pairs) {
    const handler = filter[bit] ? entry[kind] : undefined
    if (handler === undefined) continue
    void Promise.resolve()
      .then(() => handler())
      .catch(err => {
        logForDebugging(
          `[${serverName}] post-reopen list refetch failed: ${errorMessage(err)}`,
        )
      })
  }
}

/**
 * densable opS — try re-open listen with backoff budget.
 * Returns undefined when no listChanged caps, transport gone, or budget exhausted.
 */
export async function tryReopenMcpListen(args: {
  client: McpListenCapableClient
  serverName: string
  delayIndex: number
  trigger: 'connect' | McpListenCloseCause | string
  timeoutMs?: number
  sleepFn?: (ms: number) => Promise<void>
}): Promise<
  | {
      subscription: McpListenLike
      delayIndex: number
      filter: Record<string, boolean>
    }
  | undefined
> {
  const sleepFn = args.sleepFn ?? sleep
  const filter = buildListChangedFilter(args.client.getServerCapabilities?.())
  if (!filter) return undefined
  if (typeof args.client.listen !== 'function') return undefined

  for (let a = args.delayIndex; a < MCP_LISTEN_REOPEN_BACKOFF_MS.length; a++) {
    if (args.client.transport === undefined) return undefined
    const wait = MCP_LISTEN_REOPEN_BACKOFF_MS[a] ?? 0
    if (wait > 0) await sleepFn(wait)
    if (args.client.transport === undefined) return undefined
    try {
      const subscription = await args.client.listen!(filter, {
        timeout: args.timeoutMs,
      })
      const msg =
        args.trigger === 'connect'
          ? `Opened subscriptions/listen stream from zero (connect-time listen never established; attempt ${a + 1})`
          : `Re-opened subscriptions/listen stream (attempt ${a + 1})`
      logForDebugging(`[${args.serverName}] ${msg}`)
      listenReopenAnalytics(args.serverName, {
        outcome: args.trigger === 'connect' ? 'opened_from_zero' : 'reopened',
        attempts: a + 1,
        trigger: String(args.trigger),
      })
      return { subscription, delayIndex: a, filter }
    } catch (err) {
      logForDebugging(
        `[${args.serverName}] subscriptions/listen re-open attempt ${a + 1} failed: ${errorMessage(err)}`,
      )
    }
  }

  if (args.client.transport === undefined) return undefined
  const attempts = Math.max(
    0,
    MCP_LISTEN_REOPEN_BACKOFF_MS.length - args.delayIndex,
  )
  listenReopenAnalytics(args.serverName, {
    outcome: attempts === 0 ? 'budget_exhausted' : 'gave_up',
    attempts,
    trigger: String(args.trigger),
  })
  return undefined
}

/**
 * densable hNf/npS — attach re-open watcher after connect.
 * No-ops when client has no listen / no modern era / no listChanged.
 */
export function attachMcpListenReopenWatcher(
  client: McpListenCapableClient,
  serverName: string,
  opts?: {
    timeoutMs?: number
    sleepFn?: (ms: number) => Promise<void>
    nowFn?: () => number
    randomFn?: () => number
  },
): void {
  const auto = client.autoOpenedSubscription
  if (auto === undefined && client.getProtocolEra?.() !== 'modern') {
    return
  }
  if (auto === undefined) {
    logForDebugging(
      `[${serverName}] no auto-opened subscriptions/listen on a modern connection; running the listen open through the reopen machinery (no-op if the server advertises no listChanged capability)`,
    )
  }
  void runMcpListenReopenLoop(client, serverName, auto, opts).catch(err => {
    logForDebugging(
      `[${serverName}] subscriptions/listen re-open watcher stopped: ${errorMessage(err)}`,
    )
  })
}

/** densable npS loop body (exported for tests with injectable sleep/now). */
export async function runMcpListenReopenLoop(
  client: McpListenCapableClient,
  serverName: string,
  initial: McpListenLike | undefined,
  opts?: {
    timeoutMs?: number
    sleepFn?: (ms: number) => Promise<void>
    nowFn?: () => number
    randomFn?: () => number
  },
): Promise<void> {
  const sleepFn = opts?.sleepFn ?? sleep
  const nowFn = opts?.nowFn ?? Date.now
  const randomFn = opts?.randomFn ?? Math.random

  let current = initial
  let delayIndex = 0
  let reopenTimes: number[] = []
  let trigger: string = initial === undefined ? 'connect' : 'remote'

  for (;;) {
    if (current !== undefined) {
      const started = nowFn()
      const cause = await current.closed
      if (cause === 'local') return
      if (client.transport === undefined) return

      const lived = nowFn() - started
      delayIndex = resetDelayIndexIfHealthy(lived, delayIndex)
      trigger = cause
      const now = nowFn()
      reopenTimes = reopenTimes.filter(t => now - t < MCP_LISTEN_PARK_WINDOW_MS)
      const tuning = resolveMcpListenParkTuning()

      if (
        shouldParkMcpListenReopen({
          reopenTimestampsMs: reopenTimes,
          delayIndex,
          nowMs: now,
          tuning,
        })
      ) {
        logForDebugging(
          `[${serverName}] subscriptions/listen reopened ${reopenTimes.length} times in the trailing window (the server keeps killing held streams); parking re-listen`,
        )
        listenReopenAnalytics(serverName, {
          outcome: 'parked',
          attempts: reopenTimes.length,
          trigger: String(trigger),
        })
        const until = computeMcpListenParkUntilMs(
          tuning.parkDelayMs,
          nowFn(),
          randomFn,
        )
        while (nowFn() < until) {
          await sleepFn(
            Math.min(MCP_LISTEN_PARK_SLEEP_CHUNK_MS, until - nowFn()),
          )
          if (client.transport === undefined) return
          if (!isMcpListenReopenParkEnabled()) break
        }
        delayIndex = 0
      } else if (cause === 'graceful') {
        if (delayIndex >= MCP_LISTEN_REOPEN_BACKOFF_MS.length) {
          logForDebugging(
            `[${serverName}] subscriptions/listen keeps closing gracefully; giving up on re-listen`,
          )
        } else {
          logForDebugging(
            `[${serverName}] subscriptions/listen closed gracefully (server shutdown); re-listening after the redeploy grace window`,
          )
          await sleepFn(MCP_LISTEN_GRACEFUL_REDEPLOY_MS)
          if (client.transport === undefined) return
        }
      } else {
        logForDebugging(
          delayIndex >= MCP_LISTEN_REOPEN_BACKOFF_MS.length
            ? `[${serverName}] subscriptions/listen stream keeps dropping; giving up on re-listen`
            : `[${serverName}] subscriptions/listen stream dropped (remote); attempting to re-listen`,
        )
      }
    }

    const reopened = await tryReopenMcpListen({
      client,
      serverName,
      delayIndex,
      trigger,
      timeoutMs: opts?.timeoutMs,
      sleepFn,
    })
    if (reopened === undefined) return
    // densable rpS — refetch lists for honored filter bits after re-open
    invokeMcpListenPostReopenRefetch(serverName, reopened.filter)
    reopenTimes.push(nowFn())
    current = reopened.subscription
    delayIndex = reopened.delayIndex + 1
  }
}
