/**
 * densable nxm / dbr / hxm durable subscribe path (2.1.239 portable).
 * Source: gold-nxm-239 / gold-mxm-239 / gold-dbr-unwatch-239.
 *
 * Requires CLAUDE_CODE_REMOTE + setWatchUrlDeps({ callTool }) + OAuth for
 * /api/frame/subscribe. Local interactive sessions use Cji WS instead.
 */
import { publishDurableRegistry } from './durable.js'
import { DL } from './frameDl.js'
import { frameControlPlaneHeaders } from './mint.js'
import { Lge } from './gates.js'
import { isValidArtifactSlug } from './arm.js'
import { un } from './store.js'
import {
  classifyWatchUrlWithhold,
  isNoOriginatorMessage,
  isTriggerLimitMessage,
  isValidWebhookFireUrl,
  mintWatchUrl,
  parseWatchUrlMint,
  releaseOrphanTriggers,
  unwatchUrl,
} from './watchUrl.js'

export type DurableSubscribeOutcome =
  | {
      outcome: 'subscribed'
      triggerId: string
      since: string
      events: string[]
      downgraded?: boolean
      relayed?: boolean
    }
  | { outcome: 'skipped'; reason: string }
  | {
      outcome: 'failed'
      reason: string
      status?: number
      kept?: boolean
      latched?: boolean
      serverMessage?: string
      relayed?: boolean
    }

const EVENTS_WITH_COMMENT = ['published', 'comment'] as const
const EVENTS_PUBLISHED_ONLY = ['published'] as const

/** densable gxm — DL.post subscribe (o$i). */
async function postFrameSubscribe(
  slug: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<{
  ok: boolean
  status?: number
  fromFrame: boolean
  relayed?: boolean
}> {
  try {
    const res = await DL.post(
      `/api/frame/subscribe/${encodeURIComponent(slug)}`,
      body,
      {
        signal,
        timeoutMs: 15_000,
        headers: frameControlPlaneHeaders(),
      },
    )
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        fromFrame: false,
        relayed: res.route === 'relay',
      }
    }
    return {
      ok: res.fromFrame && res.status >= 200 && res.status < 300,
      status: res.status,
      fromFrame: res.fromFrame,
      relayed: res.route === 'relay',
    }
  } catch {
    return { ok: false, fromFrame: false }
  }
}

/**
 * densable nxm — mint watch_url trigger + POST frame subscribe.
 */
export async function durableSubscribe(
  slug: string,
  opts: {
    signal?: AbortSignal
    detachedFromUser?: boolean
    previous?: { triggerId: string; unreleased?: string[] }
  } = {},
): Promise<DurableSubscribeOutcome> {
  if (!isValidArtifactSlug(slug)) {
    return { outcome: 'failed', reason: 'invalid_slug' }
  }
  if (un().durable.stopLatches.isStopped(slug)) {
    return { outcome: 'skipped', reason: 'stop_latched' }
  }
  if (!process.env.CLAUDE_CODE_REMOTE) {
    return { outcome: 'failed', reason: 'not_remote' }
  }

  const withheld = un().durable.watchUrlWithheld
  if (withheld) return { outcome: 'skipped', reason: withheld }

  await releaseOrphanTriggers()

  const minted = await mintWatchUrl()
  if (!minted || minted.isError) {
    const text = minted?.text ?? ''
    if (minted && isTriggerLimitMessage(text)) {
      return { outcome: 'failed', reason: 'trigger_limit', serverMessage: text }
    }
    if (minted && isNoOriginatorMessage(text)) {
      un().durable.originatorRefused = true
      return { outcome: 'failed', reason: 'no_originator', serverMessage: text }
    }
    const withhold = minted ? classifyWatchUrlWithhold(text) : null
    if (withhold) {
      un().durable.watchUrlWithheld = withhold
      return { outcome: 'skipped', reason: withhold }
    }
    return {
      outcome: 'failed',
      reason: 'mint_failed',
      serverMessage: text || undefined,
    }
  }

  const parsed = parseWatchUrlMint(minted.text)
  if (!parsed || !isValidWebhookFireUrl(parsed.url, parsed.triggerId)) {
    if (parsed) await unwatchUrl(parsed.triggerId)
    return { outcome: 'failed', reason: 'mint_failed' }
  }

  if (opts.signal?.aborted) {
    const released = await unwatchUrl(parsed.triggerId)
    return {
      outcome: 'failed',
      reason: released ? 'aborted' : 'watch_trigger_release_failed',
    }
  }

  let events: string[] = Lge()
    ? [...EVENTS_WITH_COMMENT]
    : [...EVENTS_PUBLISHED_ONLY]
  let downgraded = false
  let sub = await postFrameSubscribe(
    slug,
    {
      url: parsed.url,
      sealed_secret: parsed.sealedSecret,
      events,
    },
    opts.signal,
  )
  if (sub.ok && sub.status === 400 && events.includes('comment')) {
    events = [...EVENTS_PUBLISHED_ONLY]
    downgraded = true
    sub = await postFrameSubscribe(
      slug,
      {
        url: parsed.url,
        sealed_secret: parsed.sealedSecret,
        events,
      },
      opts.signal,
    )
  }

  if (
    !sub.ok ||
    !(sub.status !== undefined && sub.status >= 200 && sub.status < 300)
  ) {
    const released = await unwatchUrl(parsed.triggerId)
    if (opts.signal?.aborted) {
      return {
        outcome: 'failed',
        reason: released ? 'aborted' : 'watch_trigger_release_failed',
      }
    }
    return {
      outcome: 'failed',
      reason: 'subscribe_failed',
      status: sub.status,
    }
  }

  un().durable.originatorRefused = false
  un().durable.watchUrlWithheld = null
  un().durable.watchUrlGranted = true
  const since = new Date().toISOString()
  un().durable.rows.set(slug, {
    slug,
    triggerId: parsed.triggerId,
    since,
    events,
  })
  publishDurableRegistry()

  const prev = opts.previous
  if (prev) {
    const old = [prev.triggerId, ...(prev.unreleased ?? [])].filter(
      id => id !== parsed.triggerId,
    )
    await Promise.all(old.map(id => unwatchUrl(id)))
  }

  return {
    outcome: 'subscribed',
    triggerId: parsed.triggerId,
    since,
    events,
    ...(downgraded ? { downgraded: true } : {}),
  }
}

/**
 * After durable restore on remote — refresh each row via nxm.
 */
export async function refreshRestoredDurableWatches(
  signal?: AbortSignal,
): Promise<void> {
  if (!process.env.CLAUDE_CODE_REMOTE) return
  const rows = [...un().durable.rows.values()]
  for (const row of rows) {
    if (un().durable.stopLatches.isStopped(row.slug)) continue
    await durableSubscribe(row.slug, {
      signal,
      previous: { triggerId: row.triggerId, unreleased: row.unreleased },
    })
  }
}
