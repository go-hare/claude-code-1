/**
 * densable xGl / CNy-portable / awh / lwh — frameLive merge + child re-arm (2.1.239).
 * Source: gold-xGl-239 / gold-CNy-239 / gold-awh-239 / gold-adopt-rearm-tail-239.
 */
import type { SetAppState } from '../../Task.js'
import { artifactViewerUrlFor } from '../../utils/artifactUrl.js'
import { mI } from './gates.js'
import { armCommentMonitorIntent } from './intent.js'
import { seedUnattendedFromFrameLive, UNATTENDED_REPLY_CAP } from './reply.js'
import { setBootingWiredArm } from './supervisors.js'
import { un } from './store.js'

/** densable h9 — merge-cap telemetry threshold. */
export const FRAME_LIVE_MERGE_CAP = 5
/** densable jNt = 3 * h9 — max frameLive entries kept / re-armed. */
export const FRAME_LIVE_ENTRY_CAP = FRAME_LIVE_MERGE_CAP * 3

export type FrameLiveEntry = {
  slug: string
  writtenAtMs?: number
  title?: string
  stale?: boolean
  unattendedReplies?: number
  holder?: string
}

type MergeBucket = {
  entries: ReadonlyArray<FrameLiveEntry>
  fallbackBasis: number
}

/**
 * densable xGl — merge frameLive arrays by slug; sum unattended; newest wins;
 * sort desc writtenAtMs; slice to jNt.
 */
export function mergeFrameLiveEntries(
  buckets: ReadonlyArray<MergeBucket>,
): FrameLiveEntry[] {
  const t = new Map<string, FrameLiveEntry>()
  for (const r of buckets) {
    for (const n of r.entries) {
      const o: FrameLiveEntry = {
        ...n,
        writtenAtMs: n.writtenAtMs ?? r.fallbackBasis,
      }
      const i = t.get(n.slug)
      const s = Math.min(
        (i?.unattendedReplies ?? 0) + (n.unattendedReplies ?? 0),
        UNATTENDED_REPLY_CAP,
      )
      const a =
        i === undefined || (o.writtenAtMs ?? 0) > (i.writtenAtMs ?? 0) ? o : i
      t.set(n.slug, s > 0 ? { ...a, unattendedReplies: s } : a)
    }
  }
  return [...t.values()]
    .sort((r, n) => (n.writtenAtMs ?? 0) - (r.writtenAtMs ?? 0))
    .slice(0, FRAME_LIVE_ENTRY_CAP)
}

/** densable awh — park unresumed frameLive for a jobDir. */
export function parkUnresumedFrameLive(
  jobDir: string,
  entries: ReadonlyArray<FrameLiveEntry>,
  owner: string,
): void {
  const n = un()
  const o = n.unresumedFrameLive.get(jobDir)
  if (entries.length === 0 || (o !== undefined && o.owner !== owner)) return
  n.unresumedFrameLive.set(jobDir, { entries: [...entries], owner })
}

/** densable lwh — release one slug from unresumed park. */
export function releaseUnresumedFrameLive(
  jobDir: string,
  slug: string,
  owner: string,
): void {
  const n = un()
  const o = n.unresumedFrameLive.get(jobDir)
  if (o === undefined || o.owner !== owner) return
  const i = o.entries.filter(s => s.slug !== slug)
  if (i.length > 0) n.unresumedFrameLive.set(jobDir, { entries: i, owner })
  else n.unresumedFrameLive.delete(jobDir)
}

export type RearmSkipReason =
  | 'stale_handoff'
  | 'watch_cap'
  | 'excluded'
  | 'already'
  | 'disabled'

export type RearmCarriedResult = {
  rearmed: string[]
  skipped: Array<{ slug: string; reason: RearmSkipReason }>
  seededUnattended: number
  willRearm: boolean
}

export type RearmCarriedOpts = {
  setAppState: SetAppState
  /** densable N3 = mI() when gate open; omit → call mI(). */
  autoReactEnabled?: boolean
  excludeSlug?: string
  jobDir?: string
  owner?: string
  /** densable armedVia stamp. */
  armedVia?: string
  onCarriedSkip?: (slug: string, reason: RearmSkipReason) => void
  onCarriedArmed?: (slug: string, taskId: string) => void
  /** Force offline register without mint/WS (bg claim without OAuth). */
  forceLocalArmWithoutSocket?: boolean
}

/**
 * densable CNy portable subset — re-arm carried frameLive as monitor_ws + intent.
 * Full SEA path also opens WS / MCP watch; tip registers task+supervisor so
 * Irs/h8e/left-arrow stay 1:1 after adopt claim.
 */
export function rearmCarriedFrameLive(
  carried: ReadonlyArray<FrameLiveEntry>,
  opts: RearmCarriedOpts,
): RearmCarriedResult {
  seedUnattendedFromFrameLive(carried, FRAME_LIVE_ENTRY_CAP)
  let seeded = 0
  for (const e of carried.slice(0, FRAME_LIVE_ENTRY_CAP)) {
    if (e.unattendedReplies) seeded += e.unattendedReplies
  }

  const enabled =
    opts.autoReactEnabled !== undefined ? opts.autoReactEnabled : mI()
  const rearmed: string[] = []
  const skipped: RearmCarriedResult['skipped'] = []
  const seen = new Set<string>()
  const cap =
    opts.excludeSlug === undefined
      ? FRAME_LIVE_MERGE_CAP
      : FRAME_LIVE_MERGE_CAP - 1
  const toArm: FrameLiveEntry[] = []

  for (const k of carried.slice(0, FRAME_LIVE_ENTRY_CAP)) {
    if (k.slug === opts.excludeSlug) {
      skipped.push({ slug: k.slug, reason: 'excluded' })
      opts.onCarriedSkip?.(k.slug, 'excluded')
      continue
    }
    if (k.stale === true) {
      skipped.push({ slug: k.slug, reason: 'stale_handoff' })
      opts.onCarriedSkip?.(k.slug, 'stale_handoff')
      continue
    }
    if (seen.has(k.slug)) {
      skipped.push({ slug: k.slug, reason: 'already' })
      continue
    }
    seen.add(k.slug)
    if (toArm.length >= cap) {
      skipped.push({ slug: k.slug, reason: 'watch_cap' })
      opts.onCarriedSkip?.(k.slug, 'watch_cap')
      continue
    }
    toArm.push(k)
  }

  if (!enabled) {
    if (opts.jobDir && opts.owner && toArm.length > 0) {
      parkUnresumedFrameLive(
        opts.jobDir,
        toArm.map(({ unattendedReplies: _u, ...rest }) => rest),
        opts.owner,
      )
    }
    for (const k of toArm) {
      skipped.push({ slug: k.slug, reason: 'disabled' })
      opts.onCarriedSkip?.(k.slug, 'disabled')
    }
    return {
      rearmed,
      skipped,
      seededUnattended: seeded,
      willRearm: false,
    }
  }

  const scanGeneration = un().wakes.scanGeneration
  // Lazy: avoid MonitorWsTask ↔ artifactAutoReact cycle
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { registerMonitorWsTask } =
    require('../../tasks/MonitorWsTask/MonitorWsTask.js') as typeof import('../../tasks/MonitorWsTask/MonitorWsTask.js')
  for (const k of toArm) {
    armCommentMonitorIntent(k.slug, { title: k.title })
    setBootingWiredArm(k.slug, {
      scanGeneration,
      title: k.title,
      freshPublish: false,
    })
    const taskId = registerMonitorWsTask(opts.setAppState, {
      description: k.title
        ? `Artifact comment monitor · ${k.title}`
        : `Artifact comment monitor · ${k.slug}`,
      slug: k.slug,
      title: k.title,
      armedVia: opts.armedVia ?? 'session_resume',
      autoReactArmed: true,
      autoReactWiring: { title: k.title ?? k.slug },
    })
    rearmed.push(k.slug)
    opts.onCarriedArmed?.(k.slug, taskId)
  }

  return {
    rearmed,
    skipped,
    seededUnattended: seeded,
    willRearm: rearmed.length > 0,
  }
}

/**
 * densable CNy via aGi/Lkm — async child re-arm with live-subscribe gates.
 * Uses localArmWithoutSocket when no mint deps (tip claim / offline 1:1).
 */
export async function rearmCarriedFrameLiveViaAgi(
  carried: ReadonlyArray<FrameLiveEntry>,
  opts: RearmCarriedOpts & {
    publishContext?: 'interactive' | 'sdk' | 'bg_session'
    artifactUrlForSlug?: (slug: string) => string
  },
): Promise<RearmCarriedResult> {
  seedUnattendedFromFrameLive(carried, FRAME_LIVE_ENTRY_CAP)
  let seeded = 0
  for (const e of carried.slice(0, FRAME_LIVE_ENTRY_CAP)) {
    if (e.unattendedReplies) seeded += e.unattendedReplies
  }

  const enabled =
    opts.autoReactEnabled !== undefined ? opts.autoReactEnabled : mI()
  if (!enabled) {
    return rearmCarriedFrameLive(carried, opts)
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const arm = require('./arm.js') as typeof import('./arm.js')
  const hadDeps = arm.isArtifactLiveArmDepsInstalled()
  const prevDeps = { ...arm.getArtifactLiveArmDeps() }
  let usedTemporaryLocal = false
  if (!hadDeps || opts.forceLocalArmWithoutSocket === true) {
    arm.setArtifactLiveArmDeps({
      ...prevDeps,
      localArmWithoutSocket: true,
      ...(opts.forceLocalArmWithoutSocket === true
        ? { mintSubscription: undefined, openLiveSocket: undefined }
        : {}),
    })
    usedTemporaryLocal = true
  }
  const rearmed: string[] = []
  const skipped: RearmCarriedResult['skipped'] = []
  const seen = new Set<string>()
  const cap =
    opts.excludeSlug === undefined
      ? FRAME_LIVE_MERGE_CAP
      : FRAME_LIVE_MERGE_CAP - 1
  const urlOf =
    opts.artifactUrlForSlug ??
    ((slug: string) => artifactViewerUrlFor({ slug, env: 'prod' }))

  try {
    for (const k of carried.slice(0, FRAME_LIVE_ENTRY_CAP)) {
      if (k.slug === opts.excludeSlug) {
        skipped.push({ slug: k.slug, reason: 'excluded' })
        continue
      }
      if (k.stale === true) {
        skipped.push({ slug: k.slug, reason: 'stale_handoff' })
        opts.onCarriedSkip?.(k.slug, 'stale_handoff')
        continue
      }
      if (seen.has(k.slug)) continue
      seen.add(k.slug)
      if (rearmed.length >= cap) {
        skipped.push({ slug: k.slug, reason: 'watch_cap' })
        opts.onCarriedSkip?.(k.slug, 'watch_cap')
        continue
      }
      const outcome = await arm.aGi({
        slug: k.slug,
        url: urlOf(k.slug),
        publishContext: opts.publishContext ?? 'interactive',
        title: k.title,
        commentVerbsInSchema: true,
        tool: {},
        carriedPublishConsent: true,
        sessionResume: true,
        setAppState: opts.setAppState,
        context: {
          abortController: new AbortController(),
          artifactRegistries: { ownPublishes: new Map() },
        },
      })
      if (
        outcome.outcome === 'armed' ||
        outcome.outcome === 'already_watching'
      ) {
        const taskId =
          outcome.outcome === 'armed'
            ? outcome.taskId
            : (outcome.taskId ?? k.slug)
        rearmed.push(k.slug)
        opts.onCarriedArmed?.(k.slug, taskId)
      } else {
        skipped.push({ slug: k.slug, reason: 'disabled' })
        opts.onCarriedSkip?.(k.slug, 'disabled')
      }
    }
  } finally {
    if (usedTemporaryLocal) {
      arm.setArtifactLiveArmDeps(prevDeps)
    }
  }

  return {
    rearmed,
    skipped,
    seededUnattended: seeded,
    willRearm: rearmed.length > 0,
  }
}

/** Mark entries older than maxAgeMs as stale (adopt claim helper). */
export function markStaleFrameLive(
  entries: ReadonlyArray<FrameLiveEntry>,
  nowMs: number,
  maxAgeMs: number,
): FrameLiveEntry[] {
  return entries.map(e => {
    const written = e.writtenAtMs ?? 0
    if (written > 0 && nowMs - written > maxAgeMs) {
      return { ...e, stale: true }
    }
    return { ...e }
  })
}
