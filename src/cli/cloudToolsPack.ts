/**
 * densable 2.1.283 leftover gold `Pt` @202307875 + `Nn` @202307327 + `Ne`
 * factory wrap — tools feature pack without a WS/announce engine.
 *
 * Local policy/channel seams default `undefined` / `"session"` (do not invent
 * gold `uit()` / `nI()` fleet). Withdrawn reason via `servingOffReason()`.
 * Bound + `servedTools` defined reports `Nn(announceAt ?? {at:"pending"})`.
 */
import { logForDebugging } from 'src/utils/debug.js'

export type AnnounceAt =
  | { at: 'pending' }
  | { at: 'on' }
  | { at: 'withdrawn' }
  | { at: 'refused' }
  | { at: 'unverified' }
  | { at: 'revoked'; reason?: string }

export type CloudToolsPackSeams = {
  /** gold `uit()` — default undefined */
  servingPolicy?: () => unknown
  /** gold `nI()` — default false → channel `"session"` */
  bridgeOnly?: () => boolean
  /** gold `uW()` — withdrawn reason; default undefined */
  servingOffReason?: () => string | undefined
  /** gold announce cursor; default pending until a seam sets announce */
  announceAt?: AnnounceAt
}

export type CloudToolsAttachContext = {
  bound: boolean
  servedTools?: unknown
  servedToolsUnavailable?: string
}

export type ServingFacts = {
  state: 'off'
  reason?: string
  policy: unknown
  channel: 'session' | 'bridge_only'
}

export type ToolsFeatureOffReport = {
  state: 'off'
  reason: 'not_bound' | 'not_served'
  facts: { serving: ServingFacts }
}

export type AnnounceServingState =
  | { state: 'pending' }
  | { state: 'on' }
  | { state: 'off'; reason?: string }
  | { state: 'revoked'; reason?: string }

export type ToolsFeaturePack<TReport = unknown> = {
  feature: 'tools'
  report: () => TReport
}

/** gold `Pt` — tools not served over the session channel. */
export function toolsFeatureOff(
  reason?: string,
  seams: CloudToolsPackSeams = {},
): ToolsFeaturePack<ToolsFeatureOffReport> {
  logForDebugging(
    `[servedTools] not served over the session channel: ${reason ?? 'not_served'}`,
  )
  const report: ToolsFeatureOffReport = {
    state: 'off',
    reason: reason === 'not_bound' ? 'not_bound' : 'not_served',
    facts: {
      serving: {
        state: 'off',
        ...(reason !== undefined && { reason }),
        policy: seams.servingPolicy?.(),
        channel: seams.bridgeOnly?.() ? 'bridge_only' : 'session',
      },
    },
  }
  return { feature: 'tools', report: () => report }
}

/** gold `Nn` — map announce cursor to serving state. */
export function announceServingState(
  announce: AnnounceAt,
  seams: CloudToolsPackSeams = {},
): AnnounceServingState {
  switch (announce.at) {
    case 'pending':
      return { state: 'pending' }
    case 'on':
      return { state: 'on' }
    case 'withdrawn': {
      const offReason = seams.servingOffReason?.()
      return {
        state: 'off',
        ...(offReason !== undefined && { reason: offReason }),
      }
    }
    case 'refused':
      return { state: 'off', reason: 'announce_refused' }
    case 'unverified':
      return { state: 'off', reason: 'announce_unverified' }
    case 'revoked':
      return { state: 'revoked', reason: announce.reason }
  }
}

/**
 * leftover `Ne` @202305473 unique off reason — announce cursor not `on`.
 * Existing factory stays; gold `g.at==="withdrawn"?"serving_off":"not_announced"`.
 */
export function toolsAnnounceOffReason(
  announce: AnnounceAt,
): 'serving_off' | 'not_announced' {
  return announce.at === 'withdrawn' ? 'serving_off' : 'not_announced'
}

/**
 * gold `Ne` factory wrap. Same first two returns as gold (`!bound` /
 * `servedTools === undefined` → `Pt`). Does not open a serve channel.
 */
export function createCloudToolsPack(
  seams: CloudToolsPackSeams = {},
): (
  ctx: CloudToolsAttachContext,
) => ToolsFeaturePack<ToolsFeatureOffReport | AnnounceServingState> {
  return ctx => {
    if (!ctx.bound) return toolsFeatureOff('not_bound', seams)
    if (ctx.servedTools === undefined) {
      return toolsFeatureOff(ctx.servedToolsUnavailable, seams)
    }
    return {
      feature: 'tools',
      report: () =>
        announceServingState(seams.announceAt ?? { at: 'pending' }, seams),
    }
  }
}
