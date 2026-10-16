/**
 * densable jAr @194348914 — comment-thread opening preview for ask copy.
 */
import { logForDebugging } from '../../utils/debug.js'
import type { ParsedArtifactUrl } from '../../utils/artifactUrl.js'
import {
  commentLane,
  readArtifactComments,
  THREAD_ID_RE,
  type ArtifactComment,
  type ArtifactThread,
} from './commentRead.js'
import {
  type CommentThreadPreview,
  type CommentThreadPreviewBy,
  un,
} from './store.js'

/** densable g @194348914 */
export const COMMENT_PREVIEW_EXCERPT_MAX = 120
/** densable C — jAr read timeout. */
export const COMMENT_PREVIEW_TIMEOUT_MS = 4000
/** densable T — commentTargets LRU cap. */
export const COMMENT_TARGET_CACHE_MAX = 32

export type ThreadPreviewContext = {
  abortController: AbortController
  toolUseId?: string
}

/** densable `_` @194348914 — cache key `${slug}/${threadId}`. */
export function commentThreadCacheKey(slug: string, threadId: string): string {
  return `${slug}/${threadId}`
}

/** densable e0t / A excerpt fold. */
export function commentPreviewExcerpt(
  text: string,
  max = COMMENT_PREVIEW_EXCERPT_MAX,
): string {
  const folded = text
    .replace(/[\n\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/"/g, "'")
    .trim()
  if (Array.from(folded).length <= max) return folded
  return `${[...folded].slice(0, max).join('')}\u2026`
}

function previewBy(
  comment: ArtifactComment,
  ownAccount?: string,
): CommentThreadPreviewBy {
  const lane = commentLane(comment)
  const own =
    ownAccount !== undefined &&
    comment.account.toLowerCase() === ownAccount.toLowerCase()
  if (comment.postedByArtifact === true || lane === 'unknown') {
    return 'unknown'
  }
  if (comment.role === 'assistant') {
    return own ? 'claude' : 'unknown'
  }
  if (lane === 'agent') return 'unknown'
  return own ? 'user' : 'viewer'
}

/**
 * densable E @194348914 — opening comment of `threadId` as ask-copy target.
 */
export function commentThreadOpeningTarget(
  threads: ArtifactThread[],
  threadId: string,
  opts?: { account?: string; access?: string },
): CommentThreadPreview | undefined {
  const thread = threads.find(t => t.id === threadId)
  const opening = thread?.comments[0]
  if (
    thread === undefined ||
    opening === undefined ||
    thread.commentsDegraded
  ) {
    return undefined
  }
  const excerpt = commentPreviewExcerpt(opening.text)
  if (excerpt === '') return undefined
  const by = previewBy(opening, opts?.account)
  return {
    display: {
      thread_id: threadId,
      by,
      excerpt,
      replies: thread.comments.length - 1,
      resolved: thread.resolved === true && thread.resolvedDegraded !== true,
    },
    ...(by === 'viewer' && opts?.access !== undefined
      ? { access: opts.access }
      : {}),
  }
}

function evictCommentTargets(): void {
  const cache = un().commentTargets
  while (cache.size > COMMENT_TARGET_CACHE_MAX) {
    const first = cache.keys().next().value
    if (first === undefined) break
    cache.delete(first)
  }
}

/**
 * densable jAr — fetch + cache the opening-comment preview for ask copy.
 */
export async function fetchCommentThreadPreview(
  parsed: ParsedArtifactUrl,
  threadId: string,
  ctx: ThreadPreviewContext,
): Promise<CommentThreadPreview | undefined> {
  if (!THREAD_ID_RE.test(threadId)) return undefined
  const key = commentThreadCacheKey(parsed.slug, threadId)
  const cache = un().commentTargets
  const epoch = un().accountEpoch
  const hit = cache.get(key)
  if (
    hit !== undefined &&
    ctx.toolUseId !== undefined &&
    hit.toolUseId === ctx.toolUseId
  ) {
    return hit.target
  }
  const timeout = AbortSignal.timeout(COMMENT_PREVIEW_TIMEOUT_MS)
  const signal = AbortSignal.any([ctx.abortController.signal, timeout])
  try {
    const read = await readArtifactComments(parsed.slug, signal, {
      env: parsed.env,
    })
    if (read.err !== null) {
      cache.delete(key)
      return undefined
    }
    const account = process.env.CLAUDE_ACCOUNT_UUID?.toLowerCase()
    const target = commentThreadOpeningTarget(read.threads, threadId, {
      ...(account !== undefined ? { account } : {}),
    })
    if (target === undefined) {
      logForDebugging(
        '[artifact] artifact_comment_consent_read no_opening_comment',
      )
      cache.delete(key)
      return undefined
    }
    if (un().accountEpoch !== epoch) return undefined
    cache.delete(key)
    cache.set(key, { target, toolUseId: ctx.toolUseId })
    evictCommentTargets()
    return target
  } catch (err) {
    if (ctx.abortController.signal.aborted) throw err
    logForDebugging('[artifact] artifact_comment_consent_read read_threw')
    return undefined
  }
}

function rolePossessive(access: string | undefined): string {
  switch (access) {
    case 'owner':
      return "the owner's"
    case 'editor':
      return "an editor's"
    case 'commenter':
      return "a commenter's"
    default:
      return "a viewer's"
  }
}

/** densable WAr — comment ask noun phrase. */
export function formatCommentTargetAsk(target: CommentThreadPreview): string {
  const excerpt = target.display.excerpt
  switch (target.display.by) {
    case 'user':
      return `your comment "${excerpt}"`
    case 'claude':
      return `Claude's comment "${excerpt}"`
    case 'viewer':
      return `${rolePossessive(target.access)} comment "${excerpt}"`
    case 'unknown':
      return `the comment "${excerpt}"`
  }
}

/** densable eAo — thread ask noun phrase. */
export function formatCommentThreadAsk(target: CommentThreadPreview): string {
  switch (target.display.by) {
    case 'user':
      return 'your comment thread'
    case 'claude':
      return "Claude's comment thread"
    case 'viewer':
      return `${rolePossessive(target.access)} comment thread`
    case 'unknown':
      return 'a comment thread'
  }
}

/** densable jAr alias for the other-agent permissions host. */
export const jAr = fetchCommentThreadPreview
