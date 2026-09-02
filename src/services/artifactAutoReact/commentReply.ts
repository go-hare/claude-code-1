/**
 * densable comment reply POST — DL.post /api/frame/comments/:slug/:threadId (2.1.239).
 * Gold: gold-frame-comments-api-6 — goes through o$i (relay when sEe).
 */
import { isValidArtifactSlug } from './arm.js'
import { DL } from './frameDl.js'
import { frameControlPlaneHeaders } from './mint.js'

const THREAD_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/

export type PostCommentReplyResult =
  | { kind: 'ok'; commentId?: string }
  | { kind: 'error'; message: string; reason?: string }

/**
 * densable DL.post `/api/frame/comments/${slug}/${threadId}` { text }.
 */
export async function postArtifactCommentReply(input: {
  slug: string
  threadId: string
  text: string
  signal?: AbortSignal
  answersSummon?: boolean
  continuesReplyId?: string
}): Promise<PostCommentReplyResult> {
  if (!isValidArtifactSlug(input.slug) || !THREAD_ID_RE.test(input.threadId)) {
    return {
      kind: 'error',
      message: 'invalid slug or thread id',
      reason: 'input',
    }
  }
  const text = input.text.trim()
  if (!text) {
    return { kind: 'error', message: 'empty reply', reason: 'input' }
  }
  const path = `/api/frame/comments/${encodeURIComponent(input.slug)}/${encodeURIComponent(input.threadId)}`
  try {
    const res = await DL.post(
      path,
      {
        text,
        ...(input.answersSummon === true ? { answers_summon: true } : {}),
        ...(input.continuesReplyId !== undefined
          ? { continues_reply_id: input.continuesReplyId }
          : {}),
      },
      {
        signal: input.signal,
        timeoutMs: 30_000,
        headers: frameControlPlaneHeaders(),
      },
    )
    if (!res.ok) {
      return {
        kind: 'error',
        message:
          res.reason === 'no-auth'
            ? 'no-auth'
            : `comment reply failed (${res.reason})`,
        reason: res.reason === 'no-auth' ? 'no_auth' : 'http',
      }
    }
    if (!res.fromFrame) {
      return {
        kind: 'error',
        message: `comment reply failed (relay HTTP ${res.status})`,
        reason: 'http',
      }
    }
    if (res.status < 200 || res.status >= 300) {
      return {
        kind: 'error',
        message: `comment reply failed (HTTP ${res.status})`,
        reason: 'http',
      }
    }
    let commentId: string | undefined
    if (res.data && typeof res.data === 'object') {
      const id = (res.data as { id?: unknown }).id
      if (typeof id === 'string') commentId = id
    }
    return { kind: 'ok', ...(commentId !== undefined ? { commentId } : {}) }
  } catch {
    if (input.signal?.aborted) {
      return { kind: 'error', message: 'aborted', reason: 'aborted' }
    }
    return {
      kind: 'error',
      message: 'comment reply failed (network error)',
      reason: 'network',
    }
  }
}
