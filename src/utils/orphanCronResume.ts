/**
 * Official Pqb portable — resurrect session-scoped (non-durable) CronCreate
 * tasks from the prior process transcript on resume.
 *
 * Official wvr order: Rqb → Pqb → kqb → Hqb → Dqb.
 * Durable crons live on disk (scheduled_tasks.json) and are reloaded by the
 * scheduler; only session-memory crons need transcript resurrection.
 */

import {
  DEFAULT_CRON_JITTER_CONFIG,
  oneShotJitteredNextCronRunMs,
  type CronJitterConfig,
} from './cronTasks.js'

const CRON_CREATE_NAMES = new Set(['CronCreate'])
const CRON_DELETE_NAMES = new Set(['CronDelete'])

export type OrphanCronCall = {
  toolUseId: string
  input: { cron?: unknown; prompt?: unknown }
  createdAt: number
}

export type OrphanCronResult = {
  id?: unknown
  durable?: unknown
  recurring?: unknown
}

export type ScannedSessionCrons = {
  calls: OrphanCronCall[]
  results: Map<string, OrphanCronResult>
  deletedCronIds: Set<string>
}

type ScanMsg = {
  type?: string
  timestamp?: string
  message?: { content?: unknown }
  toolUseResult?: unknown
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Official Rqb cron-subset — collect CronCreate calls + results + CronDelete ids.
 */
export function scanSessionCronsFromMessages(
  messages: readonly ScanMsg[],
): ScannedSessionCrons {
  const calls: OrphanCronCall[] = []
  const results = new Map<string, OrphanCronResult>()
  const deletedCronIds = new Set<string>()

  for (const d of messages) {
    if (d.type === 'assistant') {
      const content = d.message?.content
      if (!Array.isArray(content)) continue
      const createdAt = Date.parse(d.timestamp ?? '')
      const ts = Number.isFinite(createdAt) ? createdAt : Date.now()
      for (const m of content) {
        if (!isRecord(m) || m.type !== 'tool_use') continue
        const name = typeof m.name === 'string' ? m.name : ''
        const id = typeof m.id === 'string' ? m.id : ''
        const input = isRecord(m.input) ? m.input : {}
        if (id && CRON_CREATE_NAMES.has(name)) {
          calls.push({ toolUseId: id, input, createdAt: ts })
        } else if (
          CRON_DELETE_NAMES.has(name) &&
          typeof input.id === 'string'
        ) {
          deletedCronIds.add(input.id)
        }
      }
      continue
    }

    if (d.type === 'user') {
      const f = d.toolUseResult
      if (!isRecord(f)) continue
      const content = d.message?.content
      if (!Array.isArray(content)) continue
      for (const g of content) {
        if (!isRecord(g) || g.type !== 'tool_result') continue
        if (g.is_error) continue
        const tuid = typeof g.tool_use_id === 'string' ? g.tool_use_id : ''
        if (tuid) results.set(tuid, f as OrphanCronResult)
      }
    }
  }

  return { calls, results, deletedCronIds }
}

/**
 * Official Pqb portable — push surviving session crons into bootstrap state.
 * Returns number resurrected.
 */
export function resurrectSessionCronsFromScan(
  scan: ScannedSessionCrons,
  opts?: {
    nowMs?: number
    /** Official c6 / resolveKairosCronEnabled. Default true. */
    cronEnabled?: boolean
    jitterConfig?: CronJitterConfig
    /**
     * Inject live session cron ids (default: getSessionCronTasks).
     */
    getLiveCronIds?: () => ReadonlySet<string> | readonly string[]
    addSessionCron?: (task: {
      id: string
      cron: string
      prompt: string
      createdAt: number
      recurring?: boolean
    }) => void
    setScheduledTasksEnabled?: (enabled: boolean) => void
  },
): { resurrected: number; skipped: number } {
  if (opts?.cronEnabled === false) {
    return { resurrected: 0, skipped: 0 }
  }
  // Official c6 default: !DISABLE_CRON && GB true
  if (opts?.cronEnabled === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { resolveKairosCronEnabled } =
        require('./residualFinalEnvGates.js') as typeof import('./residualFinalEnvGates.js')
      if (!resolveKairosCronEnabled()) {
        return { resurrected: 0, skipped: 0 }
      }
    } catch {
      /* default allow */
    }
  }

  const now = opts?.nowMs ?? Date.now()
  // Official Pqb: o=trt() (getCronJitterConfig / tengu_kairos_cron_config).
  // Injected jitterConfig wins (tests); else live GB with DEFAULT fallback.
  let cfg: CronJitterConfig = DEFAULT_CRON_JITTER_CONFIG
  if (opts?.jitterConfig) {
    cfg = opts.jitterConfig
  } else {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getCronJitterConfig } =
        require('./cronJitterConfig.js') as typeof import('./cronJitterConfig.js')
      cfg = getCronJitterConfig()
    } catch {
      cfg = DEFAULT_CRON_JITTER_CONFIG
    }
  }

  let live: Set<string>
  if (opts?.getLiveCronIds) {
    const raw = opts.getLiveCronIds()
    live = raw instanceof Set ? new Set(raw) : new Set(raw)
  } else {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getSessionCronTasks } =
        require('../bootstrap/state.js') as typeof import('../bootstrap/state.js')
      live = new Set(getSessionCronTasks().map(t => t.id))
    } catch {
      live = new Set()
    }
  }

  const add =
    opts?.addSessionCron ??
    ((task: {
      id: string
      cron: string
      prompt: string
      createdAt: number
      recurring?: boolean
    }) => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { addSessionCronTask } =
        require('../bootstrap/state.js') as typeof import('../bootstrap/state.js')
      addSessionCronTask(task)
    })

  const enable =
    opts?.setScheduledTasksEnabled ??
    ((enabled: boolean) => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { setScheduledTasksEnabled } =
          require('../bootstrap/state.js') as typeof import('../bootstrap/state.js')
        setScheduledTasksEnabled(enabled)
      } catch {
        /* ignore */
      }
    })

  let resurrected = 0
  let skipped = 0
  for (const call of scan.calls) {
    const result = scan.results.get(call.toolUseId)
    if (!result || typeof result.id !== 'string') {
      skipped++
      continue
    }
    // Official: durable===true stays on disk — skip session resurrect
    if (result.durable === true) {
      skipped++
      continue
    }
    if (scan.deletedCronIds.has(result.id) || live.has(result.id)) {
      skipped++
      continue
    }
    const cron = call.input.cron
    const prompt = call.input.prompt
    if (typeof cron !== 'string' || typeof prompt !== 'string') {
      skipped++
      continue
    }
    // Official: recurring !== false (undefined defaults recurring)
    const recurring = result.recurring !== false
    if (recurring) {
      if (
        cfg.recurringMaxAgeMs !== 0 &&
        now - call.createdAt >= cfg.recurringMaxAgeMs
      ) {
        skipped++
        continue
      }
    } else {
      // Official Zzn one-shot next with jitter; skip if past
      const next = oneShotJitteredNextCronRunMs(
        cron,
        call.createdAt,
        result.id,
        cfg,
      )
      if (next === null || next < now) {
        skipped++
        continue
      }
    }
    add({
      id: result.id,
      cron,
      prompt,
      createdAt: call.createdAt,
      ...(recurring ? { recurring: true } : {}),
    })
    live.add(result.id)
    resurrected++
  }
  if (resurrected > 0) {
    enable(true)
  }
  return { resurrected, skipped }
}

/**
 * Scan messages + resurrect session crons (Pqb one-shot helper).
 */
export function runOrphanCronResumePass(
  messages: readonly ScanMsg[],
  opts?: Parameters<typeof resurrectSessionCronsFromScan>[1],
): {
  scanned: number
  resurrected: number
  skipped: number
} {
  const scan = scanSessionCronsFromMessages(messages)
  const r = resurrectSessionCronsFromScan(scan, opts)
  return {
    scanned: scan.calls.length,
    resurrected: r.resurrected,
    skipped: r.skipped,
  }
}

// ── Official #213: pending /loop ScheduleWakeup persistence & resume (Vwi/aAn/Oi) ──

import { readFile, rm, writeFile } from 'fs/promises'
import { join } from 'path'

export const PENDING_WAKEUP_FILENAME = '.pending-wakeup'
const PENDING_WAKEUP_MAX_BYTES = 1024

export type PendingWakeupRecord = {
  toolUseId: string
  scheduledFor: number
  chainStartedAt: number
}

export type PendingWakeupCall = {
  toolUseId: string
  createdAt: number
  input: { prompt?: unknown; reason?: unknown }
}

export type PendingWakeupResult = {
  stopped?: unknown
  scheduledFor?: unknown
  plugin?: unknown
}

export async function readPendingWakeup(
  sessionDir: string,
): Promise<PendingWakeupRecord | null> {
  try {
    const raw = await readFile(
      join(sessionDir, PENDING_WAKEUP_FILENAME),
      'utf8',
    )
    if (!raw || Buffer.byteLength(raw, 'utf8') > PENDING_WAKEUP_MAX_BYTES) {
      return null
    }
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (
      typeof parsed.toolUseId !== 'string' ||
      parsed.toolUseId.length < 1 ||
      parsed.toolUseId.length > 256 ||
      typeof parsed.scheduledFor !== 'number' ||
      !Number.isInteger(parsed.scheduledFor) ||
      parsed.scheduledFor <= 0 ||
      typeof parsed.chainStartedAt !== 'number' ||
      !Number.isInteger(parsed.chainStartedAt) ||
      parsed.chainStartedAt < 0
    ) {
      return null
    }
    return {
      toolUseId: parsed.toolUseId,
      scheduledFor: parsed.scheduledFor,
      chainStartedAt: parsed.chainStartedAt,
    }
  } catch {
    return null
  }
}

export async function writePendingWakeup(
  sessionDir: string,
  record: PendingWakeupRecord | undefined,
): Promise<void> {
  const filePath = join(sessionDir, PENDING_WAKEUP_FILENAME)
  if (record === undefined) {
    await rm(filePath, { force: true }).catch(() => {})
    return
  }
  await writeFile(filePath, JSON.stringify(record), 'utf8')
}

export type ScannedPendingWakeups = {
  wakeupCalls: PendingWakeupCall[]
  wakeupCallsAtLastLoopFire: number
  results: Map<string, PendingWakeupResult>
}

const SCHEDULE_WAKEUP_NAMES = new Set(['ScheduleWakeup'])

/**
 * Official `wfe` wakeup-subset (`chunk@318694944.js`) — collect ScheduleWakeup
 * tool_use calls, tool_result payloads, and the index of the latest loop fire.
 */
export function scanPendingWakeupsFromMessages(
  messages: readonly (ScanMsg & { origin?: { kind?: unknown } })[],
): ScannedPendingWakeups {
  const wakeupCalls: PendingWakeupCall[] = []
  const results = new Map<string, PendingWakeupResult>()
  let wakeupCallsAtLastLoopFire = 0

  for (const d of messages) {
    if (d.origin?.kind === 'cron' || d.origin?.kind === 'loop') {
      wakeupCallsAtLastLoopFire = wakeupCalls.length
    }
    if (d.type === 'assistant') {
      const content = d.message?.content
      if (!Array.isArray(content)) continue
      const parsedTs = Date.parse(d.timestamp ?? '')
      const ts = Number.isFinite(parsedTs) ? parsedTs : Date.now()
      for (const m of content) {
        if (!isRecord(m) || m.type !== 'tool_use') continue
        const name = typeof m.name === 'string' ? m.name : ''
        const id = typeof m.id === 'string' ? m.id : ''
        const input = isRecord(m.input) ? m.input : {}
        if (id && SCHEDULE_WAKEUP_NAMES.has(name)) {
          wakeupCalls.push({ toolUseId: id, createdAt: ts, input })
        }
      }
      continue
    }

    if (d.type === 'user') {
      const f = d.toolUseResult
      if (!isRecord(f)) continue
      const content = d.message?.content
      if (!Array.isArray(content)) continue
      for (const g of content) {
        if (!isRecord(g) || g.type !== 'tool_result') continue
        if (g.is_error) continue
        const tuid = typeof g.tool_use_id === 'string' ? g.tool_use_id : ''
        if (tuid) results.set(tuid, f as PendingWakeupResult)
      }
    }
  }

  return { wakeupCalls, wakeupCallsAtLastLoopFire, results }
}

/**
 * Official `bca` (`chunk@303673735.js`) — re-arm a resurrected pending wakeup
 * into bootstrap session cron state when its scheduled time is still in the future.
 */
export function rearmResurrectedPendingWakeup(args: {
  scheduledFor: number
  prompt: string
  reason?: string
  chainStartedAt: number
  plugin?: string
}): boolean {
  const now = Date.now()
  if (args.scheduledFor <= now) return false
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const state =
      require('../bootstrap/state.js') as typeof import('../bootstrap/state.js')
    if (state.getSessionCronTasks().some(t => t.kind === 'loop')) {
      return false
    }
    const target = new Date(args.scheduledFor)
    const cron = `${target.getMinutes()} ${target.getHours()} * * *`
    const id = Math.floor(Math.random() * 0xffffffff)
      .toString(16)
      .padStart(8, '0')
    state.addSessionCronTask({
      id,
      cron,
      prompt: args.prompt,
      createdAt: Math.max(now, args.scheduledFor - 60_000),
      kind: 'loop',
      scheduledFor: args.scheduledFor,
      reason: args.reason,
      ...(args.plugin !== undefined ? { plugin: args.plugin } : {}),
    })
    state.setLoopChainStartedAt(args.prompt, {
      startedAt: Math.min(args.chainStartedAt, now),
      lastScheduledFor: args.scheduledFor,
    })
    state.setScheduledTasksEnabled(true)
    state.setLoopEnded(false)
    return true
  } catch {
    return false
  }
}

export type ResurrectPendingWakeupOutcome =
  | { kind: 'none' }
  | { kind: 'rearmed'; scheduledFor: number; prompt: string }
  | {
      kind: 'past_due_notified'
      toolUseId: string
      lateByMs: number
      summary: string
    }

/**
 * Official Oi — restore a pending /loop ScheduleWakeup after a background
 * session process restarts (e.g. after a crash).
 */
export async function resurrectPendingWakeupFromScan(opts: {
  sessionDir: string
  wakeupCalls: readonly PendingWakeupCall[]
  wakeupCallsAtLastLoopFire?: number
  results: ReadonlyMap<string, PendingWakeupResult>
  notifiedTaskIds: ReadonlySet<string>
  /** SEA Oi `BV() || jie() !== null` — skip past-due notice if a new loop is already active. */
  hasActiveLoop?: boolean
  cronEnabled?: boolean
  nowMs?: number
  maxDelaySeconds?: number
  recurringMaxAgeMs?: number
  rearmWakeup: (args: {
    scheduledFor: number
    prompt: string
    reason?: string
    chainStartedAt: number
    plugin?: string
  }) => void
  onPastDueNotification?: (notification: {
    toolUseId: string
    summary: string
    body: string
  }) => void
}): Promise<ResurrectPendingWakeupOutcome> {
  if (opts.cronEnabled === false) return { kind: 'none' }
  const pending = await readPendingWakeup(opts.sessionDir)
  if (pending === null) return { kind: 'none' }

  let idx = -1
  for (let i = opts.wakeupCalls.length - 1; i >= 0; i--) {
    if (opts.results.has(opts.wakeupCalls[i]!.toolUseId)) {
      idx = i
      break
    }
  }
  if (idx === -1) return { kind: 'none' }
  const call = opts.wakeupCalls[idx]!
  const res = opts.results.get(call.toolUseId)
  const prompt = call.input.prompt
  const reason = call.input.reason
  const now = opts.nowMs ?? Date.now()
  const maxDelayMs = (opts.maxDelaySeconds ?? 3600) * 2 * 1000

  if (
    !res ||
    call.toolUseId !== pending.toolUseId ||
    res.stopped === true ||
    res.scheduledFor !== pending.scheduledFor ||
    typeof prompt !== 'string' ||
    !(pending.scheduledFor - call.createdAt <= maxDelayMs)
  ) {
    return { kind: 'none' }
  }

  if (pending.scheduledFor <= now) {
    if (
      opts.notifiedTaskIds.has(call.toolUseId) ||
      (opts.wakeupCallsAtLastLoopFire ?? -1) > idx ||
      opts.hasActiveLoop === true
    ) {
      return { kind: 'none' }
    }
    const lateByMs = now - pending.scheduledFor
    const lateText =
      lateByMs < 60_000
        ? 'less than a minute'
        : `${Math.round(lateByMs / 60_000)}m`
    const summary = `This session restarted ${lateText} after its next /loop wakeup was due, so that wakeup will not fire. The loop stays stopped until Claude schedules it again: reply to continue it.`
    const body = `The wakeup scheduled by the ScheduleWakeup call this notification names was still pending when this session's process ended, and its fire time passed before a new process took the session over. It will not fire. A ScheduleWakeup call made since the new process started is not affected. Otherwise nothing wakes this session for the loop: call ScheduleWakeup again only if the loop is still wanted, and when the conversation does not make that clear, ask the user first.`
    opts.onPastDueNotification?.({ toolUseId: call.toolUseId, summary, body })
    return {
      kind: 'past_due_notified',
      toolUseId: call.toolUseId,
      lateByMs,
      summary,
    }
  }

  const maxAgeMs =
    opts.recurringMaxAgeMs ??
    DEFAULT_CRON_JITTER_CONFIG.recurringMaxAgeMs ??
    604_800_000
  const chainStartedAt =
    maxAgeMs > 0
      ? Math.max(pending.chainStartedAt, call.createdAt - maxAgeMs)
      : pending.chainStartedAt

  opts.rearmWakeup({
    scheduledFor: pending.scheduledFor,
    prompt,
    reason: typeof reason === 'string' ? reason : undefined,
    chainStartedAt,
    plugin: typeof res.plugin === 'string' ? res.plugin : undefined,
  })
  return {
    kind: 'rearmed',
    scheduledFor: pending.scheduledFor,
    prompt,
  }
}
