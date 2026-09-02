/**
 * densable supervisors.set / Dso / Y4n / EHw / RDw (2.1.239).
 */
import { mI } from './gates.js'
import {
  type AutoReactWiring,
  type CommentCensusEntry,
  type Supervisor,
  un,
} from './store.js'

export type RegisterSupervisorInput = {
  slug: string
  url?: string
  getKnownVer?: unknown
  ownPublishes?: unknown
  context?: unknown
  explicit?: boolean
  armedVia?: string
  carriedVer?: unknown
  autoReactWiring?: AutoReactWiring
  machineArm?: boolean
}

/** densable Y4n */
export function Y4n(e: Supervisor): void {
  e.stopped = true
  try {
    e.abort.abort()
  } catch {
    /* ignore */
  }
  if (e.timer !== undefined) {
    clearTimeout(e.timer)
    e.timer = undefined
  }
  delete e.lease
  delete e.renewable
}

/** densable EHw */
export function EHw(slugs: Iterable<string>): void {
  const t = un().live
  for (const r of slugs) {
    if (t.inFlightSubscribes.has(r) && !t.supervisors.has(r)) {
      t.retiredInFlightArms.add(r)
      t.bootingWiredArms.delete(r)
      t.inFlightWiredIntent.delete(r)
    }
  }
}

/** densable Dso */
export function Dso(slugs: Iterable<string>): void {
  const t = un().live
  for (const r of slugs) {
    const n = t.supervisors.get(r)
    if (n !== undefined) {
      Y4n(n)
      t.supervisors.delete(r)
    }
  }
  EHw(slugs)
}

/** densable o0t */
function o0t(): Map<string, CommentCensusEntry> {
  return un().live.commentCensus
}

/** densable M3i — stamp/refresh comment census for a watched slug. */
export function M3i(slug: string, watchedSince: number = Date.now()): void {
  const prev = o0t().get(slug)
  o0t().set(slug, {
    readIds: prev?.readIds ?? null,
    sinceMs: prev?.sinceMs ?? watchedSince,
    dirty: prev !== undefined,
    generation: (prev?.generation ?? 0) + 1,
    plain: prev?.plain ?? 0,
    awaiting: prev?.awaiting ?? 0,
    partial: prev?.partial ?? false,
  })
}

/** densable aTm */
export function markCommentCensusDirty(slug: string): void {
  const row = o0t().get(slug)
  if (row !== undefined) {
    row.dirty = true
    row.generation++
  }
}

/** densable Bso */
export function getCommentCensusGeneration(slug: string): number | undefined {
  return o0t().get(slug)?.generation
}

/** densable Fkl */
export function getCommentCensus(slug: string): CommentCensusEntry | undefined {
  return o0t().get(slug)
}

/** densable cTm */
export function clearCommentCensus(slug: string): void {
  o0t().delete(slug)
}

/**
 * densable supervisors register (upsert).
 * Ensures mI() so enabledMemo tracks opt-in+availability.
 */
export function registerSupervisor(input: RegisterSupervisorInput): Supervisor {
  mI()
  const e = un().live
  const existing = e.supervisors.get(input.slug)
  if (existing && !existing.stopped) {
    if (input.carriedVer !== undefined) existing.carriedVer = input.carriedVer
    if (!input.machineArm) {
      existing.lastActivityAt = Date.now()
      if (existing.timer !== undefined) {
        clearTimeout(existing.timer)
        existing.timer = undefined
      }
      existing.stalledSince = undefined
      existing.lastStalledAt = undefined
      if (input.armedVia === 'publish') existing.armedVia = 'publish'
    }
    existing.explicit = existing.explicit || Boolean(input.explicit)
    if (input.autoReactWiring !== undefined) {
      existing.autoReactWiring = input.autoReactWiring
    }
    return existing
  }
  const n: Supervisor = {
    slug: input.slug,
    url: input.url,
    getKnownVer: input.getKnownVer,
    ownPublishes: input.ownPublishes,
    context: input.context,
    abort: new AbortController(),
    explicit: Boolean(input.explicit),
    stopped: false,
    watchedSince: Date.now(),
    lastActivityAt: Date.now(),
    armedVia: input.armedVia,
    consecutiveFailures: 0,
    ...(input.carriedVer !== undefined ? { carriedVer: input.carriedVer } : {}),
    ...(input.autoReactWiring !== undefined
      ? { autoReactWiring: input.autoReactWiring }
      : {}),
  }
  e.supervisors.set(input.slug, n)
  M3i(input.slug, n.watchedSince)
  return n
}

/** densable RDw */
export function bindSupervisorTaskId(
  supervisor: Supervisor,
  slug: string,
  taskId: string,
): void {
  const e = un().live
  if (e.supervisors.get(slug) === supervisor) supervisor.taskId = taskId
}

/** densable bootingWiredArms upsert for wtn path. */
export function setBootingWiredArm(
  slug: string,
  arm: {
    scanGeneration?: number
    freshPublish?: boolean
    stopGeneration?: number
    title?: string
  },
): void {
  const live = un().live
  const wakes = un().wakes
  live.bootingWiredArms.set(slug, {
    scanGeneration: arm.scanGeneration ?? wakes.scanGeneration,
    freshPublish: arm.freshPublish,
    stopGeneration: arm.stopGeneration,
    title: arm.title,
  })
}
