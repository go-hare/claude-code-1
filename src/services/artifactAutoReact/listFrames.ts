/**
 * densable Fgl — list frames (2.1.239).
 * GET `/api/frame/frames?limit=…` via DL.get (o$i / boot family).
 */
import { artifactViewerUrlFor } from '../../utils/artifactUrl.js'
import { DL } from './frameDl.js'
import { frameControlPlaneHeaders } from './mint.js'

/** densable D1w / uem default list limit. */
export const ARTIFACT_LIST_DEFAULT_LIMIT = 50

export type ListedArtifactRow = {
  title: string
  url: string
  updatedAt?: string
  rel?: string
}

export type ListFramesResult =
  | { err: null; rows: ListedArtifactRow[]; truncated?: boolean }
  | { err: string; reason: string }

/**
 * densable Fgl portable — scope tip defaults to mine.
 */
export async function listArtifactFrames(input: {
  limit?: number
  scope?: 'mine' | 'shared' | 'all'
  signal?: AbortSignal
}): Promise<ListFramesResult> {
  const limit = Math.min(
    Math.max(1, input.limit ?? ARTIFACT_LIST_DEFAULT_LIMIT),
    200,
  )
  try {
    const res = await DL.get(`/api/frame/frames?limit=${limit}`, {
      signal: input.signal,
      timeoutMs: 15_000,
      headers: frameControlPlaneHeaders(),
    })
    if (!res.ok) {
      return {
        err:
          res.reason === 'no-auth'
            ? 'artifact listing unavailable: no-auth'
            : `artifact listing failed (${res.reason})`,
        reason: res.reason === 'no-auth' ? 'not_ok' : 'request_error',
      }
    }
    if (!res.fromFrame || res.status < 200 || res.status >= 300) {
      return {
        err: `artifact listing failed (HTTP ${res.status})`,
        reason: res.status >= 500 ? 'http_5xx' : 'http_4xx',
      }
    }
    const data = (res.data ?? {}) as {
      frames?: unknown
      artifacts?: unknown
      truncated?: unknown
    }
    const raw = Array.isArray(data.frames)
      ? data.frames
      : Array.isArray(data.artifacts)
        ? data.artifacts
        : []
    const rows: ListedArtifactRow[] = []
    for (const row of raw) {
      if (!row || typeof row !== 'object') continue
      const r = row as Record<string, unknown>
      const slug = typeof r.slug === 'string' ? r.slug : undefined
      const title =
        typeof r.title === 'string'
          ? r.title
          : typeof r.name === 'string'
            ? r.name
            : (slug ?? 'untitled')
      const urlField =
        typeof r.url === 'string'
          ? r.url
          : slug
            ? artifactViewerUrlFor({ slug, env: 'prod' })
            : undefined
      if (!urlField) continue
      rows.push({
        title,
        url: urlField,
        ...(typeof r.updatedAt === 'string'
          ? { updatedAt: r.updatedAt }
          : typeof r.updated_at === 'string'
            ? { updatedAt: r.updated_at }
            : {}),
        ...(typeof r.rel === 'string' ? { rel: r.rel } : {}),
      })
    }
    return {
      err: null,
      rows,
      ...(data.truncated === true ? { truncated: true } : {}),
    }
  } catch {
    if (input.signal?.aborted) {
      return { err: 'artifact listing failed: aborted', reason: 'aborted' }
    }
    return {
      err: 'artifact listing failed: network error',
      reason: 'request_error',
    }
  }
}
