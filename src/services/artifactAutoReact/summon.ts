/**
 * densable X_r / q_r / zTm / jkl / _Tm / Ukl / Bkl — summon + visible handoff (2.1.239).
 */
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../analytics/growthbook.js'
import {
  commentLane,
  type ArtifactComment,
  type ArtifactThread,
} from './commentRead.js'
import { un } from './store.js'

/** densable gPw — summon freshness window (10m). */
export const SUMMON_FRESH_MS = 600_000
/** densable LHw — visible-handoff grace wait. */
export const VISIBLE_HANDOFF_GRACE_MS = 5_000
/** densable NHw — poll slice while waiting for desktop claim. */
export const VISIBLE_HANDOFF_POLL_MS = 100

/** densable P4u — desktop-family entrypoints that own visible handoff. */
const DESKTOP_ENTRYPOINTS = new Set([
  'claude-desktop',
  'claude-desktop-3p',
  'local-agent',
])

/** densable wN portable. */
export function parseCommentTimestamp(
  v: string | undefined | null,
): number | null {
  if (v == null || typeof v !== 'string' || v === '') return null
  const t = Date.parse(v)
  return Number.isFinite(t) ? t : null
}

/** densable hTm — ISO-Z stamp usable as summon claim key. */
export function isIsoZTimestamp(v: string | null | undefined): boolean {
  return (
    typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(v)
  )
}

/** densable Bkl */
export function summonClaimKey(
  slug: string,
  threadId: string,
  toClaudeAt: string,
): string {
  return `${slug.toLowerCase()}:${threadId.toLowerCase()}:${toClaudeAt}`
}

/** densable zHw */
export function hasSummonClaim(
  slug: string,
  threadId: string,
  toClaudeAt: string,
): boolean {
  return un().summonSeeds.claims.has(summonClaimKey(slug, threadId, toClaudeAt))
}

/** Test/desktop host — plant a claim for visible_handoff. */
export function claimSummonSeed(
  slug: string,
  threadId: string,
  toClaudeAt: string,
): void {
  un().summonSeeds.claims.add(summonClaimKey(slug, threadId, toClaudeAt))
}

/** densable Ukl */
export function allSummonsClaimed(
  slug: string,
  threadId: string,
  toClaudeAts: string[],
): boolean {
  return (
    toClaudeAts.length > 0 &&
    toClaudeAts.every(at => hasSummonClaim(slug, threadId, at))
  )
}

/**
 * densable jkl — if all claimed, consume claims and return true (stand down).
 */
export function consumeVisibleHandoffClaims(
  slug: string,
  threadId: string,
  toClaudeAts: string[],
): boolean {
  if (!allSummonsClaimed(slug, threadId, toClaudeAts)) return false
  const claims = un().summonSeeds.claims
  for (const at of toClaudeAts) {
    claims.delete(summonClaimKey(slug, threadId, at))
  }
  return true
}

/** densable _Tm — wait up to grace for desktop claims. */
export async function waitForVisibleHandoffClaims(
  slug: string,
  threadId: string,
  toClaudeAts: string[],
  signal: AbortSignal,
): Promise<boolean> {
  const grace = un().summonSeeds.graceMsOverride ?? VISIBLE_HANDOFF_GRACE_MS
  const deadline = Date.now() + grace
  while (Date.now() < deadline) {
    if (signal.aborted) return false
    if (allSummonsClaimed(slug, threadId, toClaudeAts)) return true
    const slice = Math.min(
      VISIBLE_HANDOFF_POLL_MS,
      Math.max(1, deadline - Date.now()),
    )
    await new Promise<void>(resolve => {
      const t = setTimeout(resolve, slice)
      const onAbort = () => {
        clearTimeout(t)
        resolve()
      }
      if (signal.aborted) {
        onAbort()
        return
      }
      signal.addEventListener('abort', onAbort, { once: true })
    })
  }
  return allSummonsClaimed(slug, threadId, toClaudeAts)
}

/** densable cU — desktop-family entrypoint. */
export function isDesktopEntrypoint(): boolean {
  const e = process.env.CLAUDE_CODE_ENTRYPOINT
  return e !== undefined && DESKTOP_ENTRYPOINTS.has(e)
}

/** densable fPw — tengu_madrone_spindle (default on). */
export function isVisibleHandoffGateOpen(): boolean {
  const v = getFeatureValue_CACHED_MAY_BE_STALE(
    'tengu_madrone_spindle',
    true as boolean,
  )
  return v !== false
}

/** densable zTm — summon still fresh vs now. */
export function isSummonFresh(
  comment: ArtifactComment,
  nowMs: number,
): boolean {
  const t = parseCommentTimestamp(comment.toClaudeAt)
  return t !== null && Math.abs(nowMs - t) <= SUMMON_FRESH_MS
}

/**
 * densable q_r — any human toClaudeAt strictly after reference createdAt.
 */
export function summonAfterReference(
  humans: ArtifactComment[],
  reference: { createdAt?: string },
): boolean {
  const ref = parseCommentTimestamp(reference.createdAt)
  if (ref === null) return false
  return humans.some(h => {
    const at = parseCommentTimestamp(h.toClaudeAt)
    return at !== null && at > ref
  })
}

/**
 * densable X_r — outstanding human summons (toClaudeAt) after last agent reply.
 */
export function outstandingSummons(thread: ArtifactThread): ArtifactComment[] {
  if (thread.commentsDegraded === true) return []
  if (thread.comments.some(c => commentLane(c) === 'unknown')) return []
  const lastAgentIdx = thread.comments.findLastIndex(
    c => commentLane(c) === 'agent',
  )
  const lastAgent =
    lastAgentIdx >= 0 ? thread.comments[lastAgentIdx] : undefined
  const resolution = thread.resolved
    ? {
        id: 'resolution-gesture',
        account: '',
        text: '',
        createdAt: undefined as string | undefined,
      }
    : undefined
  return thread.comments.filter((c, i) => {
    if (commentLane(c) !== 'human') return false
    if (parseCommentTimestamp(c.toClaudeAt) === null) return false
    if (
      lastAgent !== undefined &&
      !(i > lastAgentIdx || summonAfterReference([c], lastAgent))
    ) {
      return false
    }
    if (resolution !== undefined && !summonAfterReference([c], resolution)) {
      return false
    }
    return true
  })
}
