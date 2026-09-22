/**
 * densable 2.1.248 #16 — leftover host for official `class gc` prStatuses.
 *
 * Official roster is `class gc` `#t=Fh()` (`gold-248-16-gc-full.txt`).
 * Leftover AgentView.refresh is `gc.load` + `attachView`/`#x`. This module
 * is the prStatuses field: `#x` load, `#E` persist, `load()` href
 * fetch/prune (`V$n` + `G$n`). `Fh()` / `rp` / `Xw` stay on leftover
 * AgentView state + list (do not invent a second store/UI).
 *
 * GOLD: `#x` @192131709 · `#E` @192134546 · `Yu` @192120820 · `Li` @192124642
 *       `se` @178364304 · `Wo`/`KC` @178361263 · `V$n` @184556749
 */

import { getTerminalFocusState } from '@anthropic/ink'
import { getLastInteractionTime } from '../../bootstrap/state.js'
import type { SessionEntry } from '../../cli/bg/engine.js'
import {
  loadPrStatusCache,
  persistPrStatusCache,
  type PrStatusCacheEntry,
  type PrStatusCacheStorage,
} from '../../utils/prStatusCache.js'
import {
  fetchPrStatusBatch,
  fetchPrStatusByUrl,
  type PrStatusBatchResult,
} from '../../utils/prStatusPoller.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js'

export type PrStatusMap = Map<string, PrStatusCacheEntry | null>

export type JobChildrenSource = {
  children?: ReadonlyArray<{ href?: string; kind?: string }> | null
}

export type PrStatusRosterDeps = {
  now?: () => number
  focused?: () => boolean
  lastInteraction?: () => number
  fetchByUrl?: (url: string) => Promise<PrStatusCacheEntry | null>
  fetchBatch?: (hrefs: readonly string[]) => Promise<PrStatusBatchResult>
  /** Official `R("tengu_fleetview_pr_batch", !0)`. */
  useBatch?: boolean
  storage?: PrStatusCacheStorage | null
}

/** Official `Yu(i,d)` @192120820. `i` = ZZ focused; `d` = now - Zg(). */
export function fleetPrFetchIntervalMs(
  focused: boolean,
  idleMs: number,
): number {
  if (focused) {
    if (idleMs < 30_000) return 15_000
    if (idleMs < 300_000) return 60_000
    return 180_000
  }
  if (idleMs < 30_000) return 60_000
  if (idleMs < 600_000) return 300_000
  if (idleMs < 3_600_000) return 900_000
  return 1_800_000
}

/** Official `ZZ()` — leftover `getTerminalFocusState() !== 'blurred'`. */
export function isFleetTerminalFocused(): boolean {
  return getTerminalFocusState() !== 'blurred'
}

/** Official `Li(i,d)` @192124642 — drop keys not in the live set. */
export function pruneMapToKeys<V>(
  map: Map<string, V>,
  keys: Set<string>,
): Map<string, V> {
  let copy: Map<string, V> | undefined
  for (const key of map.keys()) {
    if (!keys.has(key)) (copy ??= new Map(map)).delete(key)
  }
  return copy ?? map
}

/** Official `se(n)` @178364304. */
export function uniqueHrefs(hrefs: Iterable<string>): string[] {
  return [...new Set(hrefs)]
}

/**
 * Official `KC` @178361263 — imported with `m7`/`Ro` into the fleet chunk.
 * `Wo` drops children whose href has control chars.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: official KC @178361263
export const CHILD_HREF_CONTROL_RE = /[\x00-\x1F\x7F-\x9F]/

/** Official `Wo(i)` @192124739 */
export function fleetJobChildren(
  children: JobChildrenSource['children'],
): Array<{ href: string; kind?: string }> {
  return (children ?? []).filter(
    (child): child is { href: string; kind?: string } =>
      typeof child.href === 'string' &&
      child.href !== '' &&
      !CHILD_HREF_CONTROL_RE.test(child.href),
  )
}

/**
 * Official `se(Wo(children).filter(kind!=="frame").map(href))`.
 */
export function collectJobPrHrefs(
  jobs: ReadonlyArray<JobChildrenSource>,
): string[] {
  return uniqueHrefs(
    jobs.flatMap(job =>
      fleetJobChildren(job.children)
        .filter(child => child.kind !== 'frame')
        .map(child => child.href),
    ),
  )
}

export function prReviewStateFromEntry(
  entry: PrStatusCacheEntry | null | undefined,
): SessionEntry['prReviewState'] | undefined {
  if (!entry || entry.state === 'MERGED' || entry.state === 'CLOSED') {
    return undefined
  }
  if (entry.state === 'DRAFT') return 'draft'
  if (entry.review === 'APPROVED') return 'approved'
  if (entry.review === 'CHANGES_REQUESTED') return 'changes_requested'
  return 'pending'
}

function defaultDeps(): Required<
  Pick<
    PrStatusRosterDeps,
    | 'now'
    | 'focused'
    | 'lastInteraction'
    | 'fetchByUrl'
    | 'fetchBatch'
    | 'useBatch'
  >
> & { storage?: PrStatusCacheStorage | null } {
  return {
    now: () => Date.now(),
    focused: isFleetTerminalFocused,
    lastInteraction: getLastInteractionTime,
    fetchByUrl: fetchPrStatusByUrl,
    fetchBatch: fetchPrStatusBatch,
    useBatch: getFeatureValue_CACHED_MAY_BE_STALE(
      'tengu_fleetview_pr_batch',
      true,
    ),
  }
}

export function createPrStatusRoster(deps: PrStatusRosterDeps = {}): {
  readonly prStatuses: PrStatusMap
  /** Official `#E` */
  apply(updater: (current: PrStatusMap) => PrStatusMap): void
  /** Official `#x` cache arm */
  loadOnAttach(): Promise<void>
  /** Official `resetPrFetchGate` — `#y=0` */
  resetPrFetchGate(): void
  /**
   * Official `load()` PR slice: skip MERGED/CLOSED, `V$n`/`G$n` write,
   * `Li` prune. Leftover refresh awaits so AgentView can read the Map
   * this pass (official fire-and-forgets because `#p` emits).
   */
  refreshFromJobs(jobs: ReadonlyArray<JobChildrenSource>): Promise<void>
} {
  const resolved = { ...defaultDeps(), ...deps }
  let prStatuses: PrStatusMap = new Map()
  let lastFetchAt = 0

  function apply(updater: (current: PrStatusMap) => PrStatusMap): void {
    const prev = prStatuses
    const next = updater(prev)
    if (Object.is(next, prev)) return
    prStatuses = next
    void persistPrStatusCache(next, resolved.storage)
  }

  return {
    get prStatuses() {
      return prStatuses
    },
    apply,
    async loadOnAttach() {
      if (prStatuses.size !== 0) return
      const loaded = await loadPrStatusCache(resolved.storage)
      if (loaded.size) {
        apply(current =>
          current.size ? new Map([...loaded, ...current]) : loaded,
        )
      }
    },
    resetPrFetchGate() {
      lastFetchAt = 0
    },
    async refreshFromJobs(jobs) {
      const hrefs = collectJobPrHrefs(jobs)
      const now = resolved.now()
      const needed = hrefs.filter(href => {
        const state = prStatuses.get(href)?.state
        return state !== 'MERGED' && state !== 'CLOSED'
      })
      const interval = fleetPrFetchIntervalMs(
        resolved.focused(),
        now - resolved.lastInteraction(),
      )
      if (needed.length > 0 && now - lastFetchAt >= interval) {
        lastFetchAt = now
        let fetched: PrStatusMap
        if (resolved.useBatch) {
          const batch = await resolved.fetchBatch(needed)
          fetched = batch.statuses
          await Promise.all(
            batch.unbatched.map(async href => {
              fetched.set(href, await resolved.fetchByUrl(href))
            }),
          )
        } else {
          fetched = new Map(
            await Promise.all(
              needed.map(async href => {
                const entry = await resolved.fetchByUrl(href)
                return [href, entry] as const
              }),
            ),
          )
        }
        apply(current => {
          let changed = false
          for (const [href, entry] of fetched) {
            const prev = current.get(href)
            if (
              prev?.state !== entry?.state ||
              prev?.title !== entry?.title ||
              prev?.review !== entry?.review ||
              prev?.checks.passed !== entry?.checks.passed ||
              prev?.checks.failed !== entry?.checks.failed ||
              prev?.checks.pending !== entry?.checks.pending ||
              prev?.additions !== entry?.additions ||
              prev?.deletions !== entry?.deletions
            ) {
              changed = true
              break
            }
          }
          if (!changed) return current
          const next = new Map(current)
          for (const [href, entry] of fetched) {
            if (entry !== null || !current.has(href)) next.set(href, entry)
          }
          return next
        })
      }
      apply(current => pruneMapToKeys(current, new Set(hrefs)))
    },
  }
}

/** Process-lifetime leftover analog of official `ensureFleetRoster` / `gc`. */
export const fleetPrStatuses = createPrStatusRoster()
