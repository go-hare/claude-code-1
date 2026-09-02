/**
 * densable JIw / aAm / lAm / Z_r — artifact comment thread read (2.1.239).
 * densable Z_r: boot → content-host `index.html.json` → control-plane Y0m fallback.
 */
import { createHash } from 'crypto'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../analytics/growthbook.js'
import { frameControlPlaneHeaders, fetchFrameBoot } from './mint.js'
import { isValidArtifactSlug } from './arm.js'
import { un } from './store.js'

const THREAD_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/
const COMMENT_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/

export type ArtifactComment = {
  id: string
  account: string
  role?: string
  text: string
  createdAt?: string
  toClaudeAt?: string
  toClaudeAtDegraded?: boolean
  postedByArtifact?: boolean
}

export type ArtifactThread = {
  id: string
  comments: ArtifactComment[]
  createdAt?: string
  resolved?: boolean
  resolvedByClaude?: boolean
  claudeActivated?: boolean
  activatedAt?: string
  activatedAtDegraded?: boolean
  activatedBy?: string
  commentsDegraded?: boolean
  resolvedDegraded?: boolean
  carried?: boolean
  editCapable?: boolean
}

export type CommentsReadOk = {
  err: null
  threads: ArtifactThread[]
  threadsDegraded?: boolean
  threadsDropped?: boolean
}

export type CommentsReadErr = {
  err: string
  unavailable?: boolean
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : null
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

/**
 * densable JIw portable — structural parse of comments payload.
 */
export function parseFrameCommentsPayload(data: unknown): {
  threads: ArtifactThread[]
  threadsDegraded?: boolean
  threadsDropped?: boolean
} | null {
  const root = asRecord(data)
  if (!root) return null
  const rawThreads = root.threads
  if (rawThreads === 'degraded') {
    return { threads: [], threadsDegraded: true }
  }
  if (!Array.isArray(rawThreads)) return { threads: [] }

  const threads: ArtifactThread[] = []
  let droppedThreads = 0
  let droppedComments = 0
  const seenThread = new Set<string>()

  for (const raw of rawThreads) {
    const t = asRecord(raw)
    if (!t) {
      droppedThreads++
      continue
    }
    const id = str(t.id)
    if (!id || !THREAD_ID_RE.test(id) || seenThread.has(id)) {
      droppedThreads++
      continue
    }
    seenThread.add(id)
    const comments: ArtifactComment[] = []
    const seenC = new Set<string>()
    const rawComments = t.comments
    const commentsDegraded = rawComments === 'degraded'
    if (Array.isArray(rawComments)) {
      for (const rc of rawComments) {
        const c = asRecord(rc)
        if (!c) {
          droppedComments++
          continue
        }
        const cid = str(c.id)
        if (!cid || !COMMENT_ID_RE.test(cid) || seenC.has(cid)) {
          droppedComments++
          continue
        }
        seenC.add(cid)
        const author = asRecord(c.author) ?? {}
        const toClaude = c.to_claude_at
        comments.push({
          id: cid,
          account: str(author.account) ?? '',
          ...(str(author.role) ? { role: str(author.role) } : {}),
          text: str(c.text) ?? '',
          ...(str(c.created_at) ? { createdAt: str(c.created_at) } : {}),
          ...(typeof toClaude === 'string' &&
          toClaude !== '' &&
          toClaude !== 'degraded'
            ? { toClaudeAt: toClaude }
            : {}),
          ...(toClaude === 'degraded' ? { toClaudeAtDegraded: true } : {}),
          ...(c.source === 'artifact' || c.posted_by_artifact === true
            ? { postedByArtifact: true }
            : {}),
        })
      }
    }
    const activated = t.claude_activated_at
    threads.push({
      id,
      comments,
      ...(str(t.created_at) ? { createdAt: str(t.created_at) } : {}),
      ...(t.resolved_at !== undefined && t.resolved_at !== null
        ? { resolved: true }
        : {}),
      ...(t.resolved_by === 'claude' || t.resolved_by_claude === true
        ? { resolvedByClaude: true }
        : {}),
      claudeActivated:
        typeof activated === 'string' &&
        activated !== '' &&
        activated !== 'degraded',
      ...(typeof activated === 'string' &&
      activated !== '' &&
      activated !== 'degraded'
        ? { activatedAt: activated }
        : {}),
      ...(activated === 'degraded' ? { activatedAtDegraded: true } : {}),
      ...(str(t.claude_activated_by)
        ? { activatedBy: str(t.claude_activated_by) }
        : {}),
      ...(commentsDegraded ||
      (Array.isArray(rawComments) && droppedComments > 0)
        ? { commentsDegraded: true }
        : {}),
      ...(t.carried === true ? { carried: true } : {}),
      ...(t.claude_capability === true || t.edit_capable === true
        ? { editCapable: true }
        : {}),
    })
  }

  return {
    threads,
    ...(droppedThreads > 0 ? { threadsDropped: true } : {}),
  }
}

function frameEnv(env?: string): string {
  return env === 'staging' ? 'staging' : 'prod'
}

/** densable content-host URL for comments JSON. */
export function contentHostCommentsUrl(
  slug: string,
  ver: string,
  assetToken: string,
  env: string = 'prod',
): string {
  const host = `${slug}.frame.${env === 'staging' ? 'staging.' : ''}claudeusercontent.com`
  return `https://${host}/_f/${encodeURIComponent(ver)}/index.html.json?__frame_t=${encodeURIComponent(assetToken)}`
}

/**
 * densable lAm / Y0m — GET /api/frame/comments/:slug (control plane via DL.get).
 */
export async function readArtifactCommentsControlPlane(
  slug: string,
  signal: AbortSignal,
  env?: string,
): Promise<CommentsReadOk | CommentsReadErr> {
  if (!isValidArtifactSlug(slug)) {
    return { err: 'invalid slug' }
  }
  const { DL } = await import('./frameDl.js')
  try {
    const res = await DL.get(
      `/api/frame/comments/${encodeURIComponent(slug)}`,
      {
        signal,
        timeoutMs: 15_000,
        headers: frameControlPlaneHeaders(),
      },
    )
    if (!res.ok) {
      if (env !== undefined) un().contentHostEgressDenied.delete(frameEnv(env))
      return {
        err:
          res.reason === 'no-auth'
            ? 'comments read unavailable: no-auth'
            : 'comments fetch failed (network error)',
      }
    }
    if (!res.fromFrame || res.status < 200 || res.status >= 300) {
      if (env !== undefined) un().contentHostEgressDenied.delete(frameEnv(env))
      return {
        err: 'comments are not available on this artifact right now',
        unavailable: true,
      }
    }
    const parsed = parseFrameCommentsPayload(res.data)
    if (parsed === null) {
      if (env !== undefined) un().contentHostEgressDenied.delete(frameEnv(env))
      return { err: 'comments fetch failed (unexpected response)' }
    }
    return {
      err: null,
      threads: parsed.threads,
      ...(parsed.threadsDegraded ? { threadsDegraded: true } : {}),
      ...(parsed.threadsDropped ? { threadsDropped: true } : {}),
    }
  } catch {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    if (env !== undefined) un().contentHostEgressDenied.delete(frameEnv(env))
    return { err: 'comments fetch failed (network error)' }
  }
}

function aAmFromResponse(
  status: number,
  data: unknown,
): CommentsReadOk | CommentsReadErr {
  if (status < 200 || status >= 300) {
    return {
      err: 'comments are not available on this artifact right now',
      unavailable: true,
    }
  }
  const parsed = parseFrameCommentsPayload(data)
  if (parsed === null) {
    return { err: 'comments fetch failed (unexpected response)' }
  }
  return {
    err: null,
    threads: parsed.threads,
    ...(parsed.threadsDegraded ? { threadsDegraded: true } : {}),
    ...(parsed.threadsDropped ? { threadsDropped: true } : {}),
  }
}

/**
 * densable Z_r — content-host index.html.json first, control-plane fallback.
 */
export async function readArtifactComments(
  slug: string,
  signal: AbortSignal,
  opts: { env?: string; controlPlaneReadBeforeBoot?: boolean } = {},
): Promise<CommentsReadOk | CommentsReadErr> {
  if (!isValidArtifactSlug(slug)) {
    return { err: 'invalid slug' }
  }
  const env = frameEnv(opts.env)
  const onyxOpen =
    getFeatureValue_CACHED_MAY_BE_STALE(
      'tengu_onyx_sluice',
      false as boolean,
    ) === true

  let earlyCp: CommentsReadOk | CommentsReadErr | undefined
  if (opts.controlPlaneReadBeforeBoot === true && onyxOpen) {
    earlyCp = await readArtifactCommentsControlPlane(slug, signal, env)
    if (earlyCp.err === null) return earlyCp
  }

  const boot = await fetchFrameBoot(slug, signal)
  if (boot.err !== null) {
    // densable returns boot err; tip falls back to control-plane so comment
    // monitors still work when content-host boot is unavailable.
    return (
      earlyCp ?? (await readArtifactCommentsControlPlane(slug, signal, env))
    )
  }
  if (boot.assetToken === undefined) {
    return (
      earlyCp ?? {
        err: 'comments are not readable on a public artifact serve',
      }
    )
  }

  if (un().contentHostEgressDenied.has(env)) {
    if (earlyCp !== undefined) {
      un().contentHostEgressDenied.delete(env)
      return earlyCp
    }
    return readArtifactCommentsControlPlane(slug, signal, env)
  }

  if (earlyCp === undefined && onyxOpen) {
    earlyCp = await readArtifactCommentsControlPlane(slug, signal, env)
    if (earlyCp.err === null) return earlyCp
  }

  const contentUrl = contentHostCommentsUrl(
    slug,
    boot.ver,
    boot.assetToken,
    env,
  )

  const fallbackOnEgress = async (): Promise<
    CommentsReadOk | CommentsReadErr
  > => {
    if (earlyCp !== undefined) return earlyCp
    un().contentHostEgressDenied.add(env)
    return readArtifactCommentsControlPlane(slug, signal, env)
  }

  let res: Response
  try {
    res = await fetch(contentUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal,
      redirect: 'manual',
    })
  } catch {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    return fallbackOnEgress()
  }

  // densable FIe-ish: treat block / network-policy statuses as egress deny
  if (res.status === 0 || res.status === 403 || res.type === 'opaqueredirect') {
    return fallbackOnEgress()
  }

  let data: unknown
  try {
    data = await res.json()
  } catch {
    return earlyCp ?? { err: 'comments fetch failed (unexpected response)' }
  }
  return aAmFromResponse(res.status, data)
}

/**
 * densable BPw — digest of unread-facing thread/comment shape.
 */
export function digestCommentThreads(
  threads: ArtifactThread[],
  ownReplyIdsByThread: Map<string, Set<string>>,
): string | null {
  const hash = createHash('sha256')
  const sorted = [...threads].sort((a, b) => (a.id < b.id ? -1 : 1))
  for (const t of sorted) {
    if (t.commentsDegraded) return null
    const own = ownReplyIdsByThread.get(t.id)
    if (own && (own as Set<string> & { incomplete?: boolean }).incomplete) {
      return null
    }
    const resolved = t.resolved && t.resolvedByClaude !== true
    hash.update(
      `${t.id}|${resolved ? (t.activatedAt ?? 'r') : ''}|${t.activatedAt ?? ''}|`,
    )
    for (const c of [...t.comments].sort((a, b) => (a.id < b.id ? -1 : 1))) {
      if (own?.has(c.id)) continue
      if (c.toClaudeAtDegraded) return null
      hash.update(`${c.id}@${c.toClaudeAt ?? ''}|`)
    }
    hash.update('\n')
  }
  return hash.digest('hex')
}

/** densable DP portable — comment lane. */
export function commentLane(c: ArtifactComment): 'human' | 'agent' | 'unknown' {
  if (c.postedByArtifact) return 'agent'
  const role = (c.role ?? '').toLowerCase()
  if (role === 'assistant' || role === 'agent' || role === 'claude') {
    return 'agent'
  }
  if (role === 'unknown' || role === '') {
    // empty role with account → treat as human; bare empty → unknown
    return c.account ? 'human' : 'unknown'
  }
  if (role === 'human' || role === 'user' || role === 'member') return 'human'
  return 'unknown'
}
