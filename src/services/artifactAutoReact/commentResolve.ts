/**
 * densable hAm — resolve comment thread (2.1.239).
 * POST `/api/frame/comments/:slug/:threadId/resolve` via DL.post (o$i).
 * Tries session-resolve first, then resolve (densable portable).
 */
import { isValidArtifactSlug } from './arm.js'
import { DL } from './frameDl.js'
import { frameControlPlaneHeaders } from './mint.js'

const THREAD_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type ResolveCommentResult =
  | { kind: 'ok' }
  | { kind: 'not_activated' }
  | { kind: 'not_authorized' }
  | { kind: 'summon_foreign' }
  | { kind: 'error'; message: string; reason?: string }

async function postResolve(
  pathSuffix: 'resolve' | 'session-resolve',
  slug: string,
  threadId: string,
  signal?: AbortSignal,
): Promise<{ status: number; data: unknown; fromFrame: boolean; ok: boolean }> {
  const path = `/api/frame/comments/${encodeURIComponent(slug)}/${encodeURIComponent(threadId)}/${pathSuffix}`
  // densable: sEe → postRelayOnly for resolve; tip uses DL.post (falls back)
  const res =
    pathSuffix === 'resolve'
      ? await DL.post(
          path,
          { resolved: true },
          {
            signal,
            timeoutMs: 15_000,
            headers: frameControlPlaneHeaders(),
          },
        )
      : await DL.post(
          path,
          { resolved: true },
          {
            signal,
            timeoutMs: 15_000,
            headers: frameControlPlaneHeaders(),
          },
        )
  if (!res.ok) {
    return {
      status: res.status ?? 0,
      data: undefined,
      fromFrame: false,
      ok: false,
    }
  }
  return {
    status: res.status,
    data: res.data,
    fromFrame: res.fromFrame,
    ok: true,
  }
}

/**
 * densable hAm portable.
 */
export async function resolveArtifactCommentThread(input: {
  slug: string
  threadId: string
  signal?: AbortSignal
}): Promise<ResolveCommentResult> {
  if (!isValidArtifactSlug(input.slug) || !THREAD_ID_RE.test(input.threadId)) {
    return {
      kind: 'error',
      message: 'invalid slug or thread id',
      reason: 'input',
    }
  }
  try {
    let res = await postResolve(
      'session-resolve',
      input.slug,
      input.threadId,
      input.signal,
    )
    if (res.status === 404 || res.status === 403 || !res.ok) {
      res = await postResolve(
        'resolve',
        input.slug,
        input.threadId,
        input.signal,
      )
    }
    if (res.status === 403) {
      const body =
        typeof res.data === 'string'
          ? res.data
          : res.data !== undefined
            ? JSON.stringify(res.data)
            : ''
      if (/not_activated|not activated/i.test(body)) {
        return { kind: 'not_activated' }
      }
      if (/not_authorized|forbidden/i.test(body)) {
        return { kind: 'not_authorized' }
      }
      return { kind: 'not_authorized' }
    }
    if (!res.ok || !res.fromFrame || res.status < 200 || res.status >= 300) {
      return {
        kind: 'error',
        message: `thread resolve failed (HTTP ${res.status})`,
        reason: 'http',
      }
    }
    return { kind: 'ok' }
  } catch {
    if (input.signal?.aborted) {
      return { kind: 'error', message: 'aborted', reason: 'aborted' }
    }
    return {
      kind: 'error',
      message: 'thread resolve failed (network error)',
      reason: 'request_error',
    }
  }
}
