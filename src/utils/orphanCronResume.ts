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
