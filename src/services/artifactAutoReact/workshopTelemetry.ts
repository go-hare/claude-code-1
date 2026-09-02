/**
 * densable Ixm / hxl / Rxm / Txm / Cxm / workshopTelemetry (2.1.239).
 * Gold: Ixm read-side; hxl publish-side; Cxm sets invokeT0 at tool invoke.
 */
import {
  logEvent,
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
} from '../analytics/index.js'
import { isValidArtifactSlug } from './arm.js'
import { un } from './store.js'

/** densable Yhl ver shape for workshop telemetry. */
const WORKSHOP_VER_RE = /^\d{1,12}-[0-9a-f]{1,32}$/

export type WorkshopDeliverables = {
  n: number
  pr: number
  artifact: number
  other: number
}

export type WorkshopTelemetryState = {
  startedSeen: string[]
  completedSeen: string[]
  startedPublishes: Record<string, number>
  /** densable session publish-seen for Yr (first publish). */
  publishedSeen: string[]
  invokeT0: number | null
}

export function createWorkshopTelemetryState(): WorkshopTelemetryState {
  return {
    startedSeen: [],
    completedSeen: [],
    startedPublishes: {},
    publishedSeen: [],
    invokeT0: null,
  }
}

/** densable mgr portable — conforming slug or nonconforming marker. */
export function workshopTelemetrySlug(slug: string): string {
  return isValidArtifactSlug(slug) ? slug : 'nonconforming'
}

/** densable Yhl portable. */
export function workshopTelemetryVer(ver: string): string {
  return WORKSHOP_VER_RE.test(ver) ? ver : 'nonconforming'
}

/** densable Rxm */
export function markWorkshopStartedSeen(
  state: WorkshopTelemetryState,
  slug: string,
): WorkshopTelemetryState {
  if (state.startedSeen.includes(slug)) return state
  return { ...state, startedSeen: [...state.startedSeen, slug] }
}

/** densable Txm */
export function markWorkshopCompletedSeen(
  state: WorkshopTelemetryState,
  slug: string,
): WorkshopTelemetryState {
  if (state.completedSeen.includes(slug)) return state
  return { ...state, completedSeen: [...state.completedSeen, slug] }
}

/** densable Cxm — stamp invokeT0 at workshop/publish entry (overwrite). */
export function markWorkshopInvokeT0(): void {
  un().workshopTelemetry = {
    ...un().workshopTelemetry,
    invokeT0: performance.now(),
  }
}

/** Stamp invokeT0 only when unset — tip live-edit / publish entry. */
export function markWorkshopInvokeT0Once(): void {
  if (un().workshopTelemetry.invokeT0 !== null) return
  markWorkshopInvokeT0()
}

/** densable Yr — first publish of slug in this session. */
export function isFirstWorkshopPublish(slug: string): boolean {
  return !un().workshopTelemetry.publishedSeen.includes(slug)
}

export function markWorkshopPublishedSeen(slug: string): void {
  const cur = un().workshopTelemetry
  if (cur.publishedSeen.includes(slug)) return
  un().workshopTelemetry = {
    ...cur,
    publishedSeen: [...cur.publishedSeen, slug],
  }
}

/**
 * densable Ixm — workshop_turn (+ workshop_build_started on first started).
 */
export function Ixm(
  slug: string,
  ver: string,
  state: string,
  decisionsTotal: number,
  decisionsResolved: number,
): void {
  const slugMeta = workshopTelemetrySlug(
    slug,
  ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
  const verMeta = workshopTelemetryVer(
    ver,
  ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
  const stateMeta =
    state as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
  logEvent('workshop_turn', {
    artifact_slug: slugMeta,
    artifact_version: verMeta,
    decisions_total: decisionsTotal,
    decisions_resolved: decisionsResolved,
    state: stateMeta,
  })
  if (state !== 'started') return
  const cur = un().workshopTelemetry
  const already = cur.startedSeen.includes(slug)
  un().workshopTelemetry = markWorkshopStartedSeen(cur, slug)
  if (!already) {
    logEvent('workshop_build_started', {
      artifact_slug: slugMeta,
    })
  }
}

/**
 * densable hxl — publish-side workshop telemetry.
 * Clears invokeT0; may emit workshop_first_page / build_started / build_completed.
 */
export function hxl(
  slug: string,
  ver: string,
  state: string,
  deliverables: WorkshopDeliverables,
  isFirstPublish: boolean,
): void {
  const slugMeta = workshopTelemetrySlug(
    slug,
  ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
  const verMeta = workshopTelemetryVer(
    ver,
  ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
  const stateMeta =
    state as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS

  const prev = un().workshopTelemetry
  let next: WorkshopTelemetryState = prev
  if (next.invokeT0 !== null) {
    next = { ...next, invokeT0: null }
  }
  if (state === 'started') {
    next = markWorkshopStartedSeen(next, slug)
  }
  if (deliverables.n > 0) {
    next = markWorkshopCompletedSeen(next, slug)
  } else if (state === 'started' && !next.completedSeen.includes(slug)) {
    const d = (next.startedPublishes[slug] ?? 0) + 1
    next = {
      ...next,
      startedPublishes: { ...next.startedPublishes, [slug]: d },
    }
    if (d >= 2) next = markWorkshopCompletedSeen(next, slug)
  }
  un().workshopTelemetry = next

  if (prev.invokeT0 !== null && isFirstPublish) {
    logEvent('workshop_first_page', {
      invoke_to_publish_ms: Math.round(performance.now() - prev.invokeT0),
      first_publish_state: stateMeta,
    })
  }
  if (!prev.startedSeen.includes(slug) && next.startedSeen.includes(slug)) {
    logEvent('workshop_build_started', {
      artifact_slug: slugMeta,
    })
  }
  if (!prev.completedSeen.includes(slug) && next.completedSeen.includes(slug)) {
    const source = (
      deliverables.n > 0 ? 'structural' : 'post_kickoff_republish'
    ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
    logEvent('workshop_build_completed', {
      artifact_slug: slugMeta,
      artifact_version: verMeta,
      source,
      deliverables_n: deliverables.n,
      deliverables_pr: deliverables.pr,
      deliverables_artifact: deliverables.artifact,
      deliverables_other: deliverables.other,
    })
  }
}

/** Detect densable workshop island presence for publish-side te fallback. */
export function htmlLooksLikeWorkshop(html: string): boolean {
  return /id\s*=\s*["']?ws-decisions["']?/i.test(html)
}
