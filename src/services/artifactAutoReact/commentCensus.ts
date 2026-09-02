/**
 * densable jso / lTm / n1w / r1w / t1w / Y_r — comment census + status prose (2.1.239).
 * Official CLI has no Ink panel; the visible surface is Artifact status tool text.
 */
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../analytics/growthbook.js'
import {
  commentLane,
  type ArtifactThread,
  readArtifactComments,
} from './commentRead.js'
import {
  getCommentCensus,
  getCommentCensusGeneration,
  M3i,
} from './supervisors.js'
import { outstandingSummons, parseCommentTimestamp } from './summon.js'
import { plural } from '../../utils/stringUtils.js'

/** densable D3i */
export const COMMENT_CENSUS_CAP = 999
/** densable MHw — 2min grace before sinceMs second-floor. */
export const COMMENT_CENSUS_GRACE_MS = 120_000
/** densable ZRm */
export const COMMENT_CENSUS_STATUS_TIMEOUT_MS = 3000

export type CommentCensusStatusFields = {
  unread_plain_comments?: number
  summons_awaiting_reply?: number
  comments_uncounted?: boolean
  comments_partially_counted?: boolean
}

/**
 * densable Y_r — `CLAUDE_CODE_ARTIFACT_COMMENTS ?? tengu_teal_corbel`.
 * Gates status census fields + t1w refresh. Not Gso (sorrel_trellis / AUTOREACT).
 */
export function isArtifactCommentsStatusEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = env.CLAUDE_CODE_ARTIFACT_COMMENTS
  if (raw !== undefined) {
    return raw === '1' || raw === 'true' || raw === 'TRUE'
  }
  return (
    getFeatureValue_CACHED_MAY_BE_STALE(
      'tengu_teal_corbel',
      false as boolean,
    ) === true
  )
}

/**
 * densable jso — recount unread plain / awaiting summons into the census row.
 */
export function recountCommentCensus(
  slug: string,
  threads: ArtifactThread[],
  generation: number | undefined,
  threadsDropped = false,
): void {
  const row = getCommentCensus(slug)
  if (row === undefined) return
  let plain = 0
  let awaiting = 0
  let partial = threadsDropped
  const cutoff = Math.floor(row.sinceMs / 1000) * 1000 - COMMENT_CENSUS_GRACE_MS
  for (const thread of threads) {
    if (
      thread.commentsDegraded === true ||
      thread.resolvedDegraded === true ||
      thread.comments.some(
        c =>
          commentLane(c) === 'unknown' ||
          (commentLane(c) === 'human' &&
            parseCommentTimestamp(c.createdAt) === null),
      )
    ) {
      partial = true
    }
    const outstandingIds = new Set(outstandingSummons(thread).map(c => c.id))
    for (const comment of thread.comments) {
      if (commentLane(comment) !== 'human') continue
      if ((parseCommentTimestamp(comment.createdAt) ?? -1) < cutoff) continue
      if (row.readIds !== null && row.readIds.has(comment.id)) continue
      if (parseCommentTimestamp(comment.toClaudeAt) !== null) {
        if (outstandingIds.has(comment.id)) awaiting++
      } else if (
        comment.toClaudeAtDegraded === true ||
        comment.toClaudeAt !== undefined
      ) {
        partial = true
      } else {
        plain++
      }
    }
  }
  row.plain = Math.min(plain, COMMENT_CENSUS_CAP)
  row.awaiting = Math.min(awaiting, COMMENT_CENSUS_CAP)
  row.partial = partial
  if (generation === row.generation) row.dirty = false
}

/**
 * densable lTm — mark shown comments read, then recount.
 */
export function markCommentsReadForCensus(
  slug: string,
  readThreads: ArtifactThread[],
  recountThreads: ArtifactThread[],
  threadsDropped = false,
): void {
  if (getCommentCensus(slug) === undefined) M3i(slug)
  const row = getCommentCensus(slug)
  if (row === undefined) return
  const ids = row.readIds ?? new Set<string>()
  for (const thread of readThreads) {
    for (const comment of thread.comments) ids.add(comment.id)
  }
  row.readIds = ids
  recountCommentCensus(slug, recountThreads, row.generation, threadsDropped)
}

/** densable n1w */
export function commentCensusStatusFields(
  slug: string,
): CommentCensusStatusFields {
  const row = getCommentCensus(slug)
  if (row === undefined) return {}
  if (row.dirty) return { comments_uncounted: true }
  return {
    ...(row.plain > 0 ? { unread_plain_comments: row.plain } : {}),
    ...(row.awaiting > 0 ? { summons_awaiting_reply: row.awaiting } : {}),
    ...(row.partial ? { comments_partially_counted: true } : {}),
  }
}

/** densable r1w — clause appended to a status watch row. */
export function formatCommentCensusStatusClause(
  fields: CommentCensusStatusFields,
): string {
  if (fields.comments_uncounted === true) {
    return '; its comment count is not refreshed yet \u2014 action "comments" shows them'
  }
  const clamp = (n: unknown): number =>
    typeof n === 'number' && Number.isInteger(n) && n > 0
      ? Math.min(n, COMMENT_CENSUS_CAP)
      : 0
  const plain = clamp(fields.unread_plain_comments)
  const awaiting = clamp(fields.summons_awaiting_reply)
  const partial = fields.comments_partially_counted === true
  if (plain === 0 && awaiting === 0) {
    return partial
      ? '; some of its comments could not be counted \u2014 action "comments" shows them'
      : ''
  }
  const atLeast = partial ? 'at least ' : ''
  const parts = [
    plain > 0
      ? `${atLeast}${plain} plain ${plural(plain, 'comment')} (not sent to Claude) you have not read`
      : '',
    awaiting > 0
      ? `${atLeast}${awaiting} sent to Claude still awaiting a reply`
      : '',
  ].filter(p => p !== '')
  return `; ${parts.join(' and ')} on this Artifact${
    partial ? ' (some comments could not be counted)' : ''
  } \u2014 action "comments" shows them`
}

/** densable t1w — refresh dirty connected slugs via Z_r before status. */
export async function refreshDirtyCommentCensuses(
  slugs: string[],
  signal: AbortSignal,
): Promise<void> {
  const dirty = slugs.filter(s => getCommentCensus(s)?.dirty === true)
  if (dirty.length === 0) return
  const combined = AbortSignal.any([
    signal,
    AbortSignal.timeout(COMMENT_CENSUS_STATUS_TIMEOUT_MS),
  ])
  await Promise.all(
    dirty.map(async slug => {
      const generation = getCommentCensusGeneration(slug)
      try {
        const read = await readArtifactComments(slug, combined, {
          controlPlaneReadBeforeBoot:
            getFeatureValue_CACHED_MAY_BE_STALE(
              'tengu_slate_lantern_ember',
              false as boolean,
            ) === true,
        })
        if (read.err === null && read.threadsDegraded !== true) {
          recountCommentCensus(
            slug,
            read.threads,
            generation,
            read.threadsDropped === true,
          )
        }
      } catch {
        /* official swallows */
      }
    }),
  )
}
