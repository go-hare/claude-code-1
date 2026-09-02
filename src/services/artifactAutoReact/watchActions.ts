/**
 * densable Artifact watch / unwatch / status (2.1.239) — tip portable.
 * Gold: Okm≈armLiveSubscribe, bxm teardown≈oF+Dso, h6e≈supervisor+task rows.
 */
import {
  artifactViewerUrlFor,
  parseArtifactUrl,
} from '../../utils/artifactUrl.js'
import {
  armLiveSubscribe,
  describeArmSkipReason,
  type ArmOutcome,
  type WtArmInput,
} from './arm.js'
import { stopCommentMonitorIntent } from './intent.js'
import { oF } from './oF.js'
import { Dso } from './supervisors.js'
import {
  commentCensusStatusFields,
  formatCommentCensusStatusClause,
  isArtifactCommentsStatusEnabled,
  refreshDirtyCommentCensuses,
  type CommentCensusStatusFields,
} from './commentCensus.js'
import { un } from './store.js'

export type WatchActionResult = {
  watch: {
    url: string
    watching: boolean
    outcome: string
    reason?: string
    task_id?: string
    since?: string
    auto_reply?: boolean
    armed_via?: string
  }
}

export type UnwatchActionResult = {
  unwatch: { url: string; was_watching: boolean }
}

export type StatusWatchRow = {
  url: string
  task_id?: string
  since?: string
  explicit?: boolean
  connected?: boolean
  connecting?: boolean
  auto_reply?: boolean
  armed_via?: string
  rail?: string
  trigger_id?: string
  events?: string[]
  restored?: boolean
  stop_kind?: string
  unread_plain_comments?: number
  summons_awaiting_reply?: number
  comments_uncounted?: boolean
  comments_partially_counted?: boolean
}

function viewerUrl(slug: string): string {
  return artifactViewerUrlFor({ slug, env: 'prod' })
}

/**
 * densable Okm portable — explicit watch arm via tip aGi/_Wt.
 */
export async function callArtifactWatch(input: {
  url: string
  context: WtArmInput['context']
  setAppState: WtArmInput['setAppState']
  signal?: AbortSignal
  toolUseId?: string
}): Promise<{ data: WatchActionResult } | { error: string }> {
  const parsed = parseArtifactUrl(input.url)
  if (!parsed) {
    return { error: '`url` must be an artifact URL for action "watch"' }
  }
  const url = viewerUrl(parsed.slug)
  const latches = un().durable.stopLatches

  if (input.toolUseId) {
    const gen = latches.takeRelatchAsk(input.toolUseId, parsed.slug)
    if (gen !== undefined) {
      latches.clearByApprovedRewatch(parsed.slug, gen)
    }
  }

  if (latches.isStopped(parsed.slug)) {
    return {
      data: {
        watch: {
          url,
          watching: false,
          outcome: 'skipped',
          reason: 'stop_latched',
        },
      },
    }
  }

  const outcome: ArmOutcome = await armLiveSubscribe({
    slug: parsed.slug,
    url,
    context: input.context,
    setAppState: input.setAppState,
    signal: input.signal ?? input.context.abortController.signal,
    explicit: true,
    autoReactWiring: {
      commentVerbsInSchema: true,
      title: parsed.slug,
    },
  })

  if (outcome.outcome === 'armed' || outcome.outcome === 'already_watching') {
    const sup = un().live.supervisors.get(parsed.slug)
    const taskId =
      outcome.taskId !== undefined
        ? outcome.taskId
        : sup?.taskId
          ? String(sup.taskId)
          : undefined
    return {
      data: {
        watch: {
          url,
          watching: true,
          outcome: outcome.outcome,
          ...(taskId !== undefined ? { task_id: taskId } : {}),
          ...(sup?.autoReactWiring ? { auto_reply: true } : {}),
          armed_via: 'watch',
        },
      },
    }
  }

  void describeArmSkipReason(outcome.reason)
  return {
    data: {
      watch: {
        url,
        watching: false,
        outcome: outcome.outcome,
        ...(outcome.reason !== undefined ? { reason: outcome.reason } : {}),
      },
    },
  }
}

/**
 * densable unwatch portable — latch stop + tear down supervisor/socket.
 */
export async function callArtifactUnwatch(input: {
  url: string
  context: WtArmInput['context']
}): Promise<{ data: UnwatchActionResult } | { error: string }> {
  const parsed = parseArtifactUrl(input.url)
  if (!parsed) {
    return { error: '`url` must be an artifact URL for action "unwatch"' }
  }
  const url = viewerUrl(parsed.slug)
  const latches = un().durable.stopLatches
  const stopper = latches.recordStop(parsed.slug)

  const sup = un().live.supervisors.get(parsed.slug)
  const taskId = sup?.taskId
  let wasWatching = Boolean(sup && !sup.stopped)
  let teardown: unknown
  if (typeof taskId === 'string' && input.context.taskRegistry) {
    wasWatching = true
    teardown = oF(taskId, input.context.taskRegistry, {
      quiet: true,
      userStop: true,
    })
  }
  stopCommentMonitorIntent(parsed.slug)
  Dso([parsed.slug])
  stopper.settle({ wasWatching, teardown })

  return {
    data: {
      unwatch: { url, was_watching: wasWatching },
    },
  }
}

/** densable status watch-list prose (no Ink panel; this is the official UI). */
export function formatArtifactWatchStatus(input: {
  watches: StatusWatchRow[]
  filter_url?: string
}): string {
  const { watches, filter_url } = input
  if (watches.length === 0) {
    return filter_url
      ? `No artifact watch on ${filter_url} in this session.`
      : 'No artifact watches in this session.'
  }
  const connected = watches.filter(
    w => w.rail !== 'durable_wake' && w.rail !== 'live_stopped',
  )
  const header = `${connected.length} artifact ${connected.length === 1 ? 'watch' : 'watches'} in this session:`
  const lines = watches.map(row => {
    const census = formatCommentCensusStatusClause(row)
    if (row.rail === 'durable_wake') {
      const events =
        Array.isArray(row.events) && row.events.includes('comment')
          ? 'publish and to-Claude comments'
          : 'publish'
      return `- ${row.url} \u2014 durable wake subscription (woken on ${events}; no live updates)${row.since ? `, since ${row.since}` : ''}${row.restored === true ? '; restored after this session restarted and not re-verified since (no action needed unless the user asks)' : ''}`
    }
    if (row.rail === 'live_stopped') {
      return `- ${row.url} \u2014 not connected${row.since ? `, watching since ${row.since}` : ''}${census}`
    }
    const link = row.connected
      ? row.connecting
        ? 'connecting (handshake not finished; nothing reaches it yet)'
        : 'connected'
      : 'reconnecting'
    return `- ${row.url} \u2014 ${link}${row.since ? `, since ${row.since}` : ''}${census}`
  })
  return `${header}\n${lines.join('\n')}`
}

/**
 * densable status portable — aggregate tip supervisors + durable rows (h6e + oxm).
 * When Y_r, await t1w then spread n1w onto connected rows.
 */
export async function callArtifactStatus(input: {
  url?: string
  signal?: AbortSignal
}): Promise<{
  data: { watches: StatusWatchRow[]; filter_url?: string }
}> {
  const filterSlug =
    typeof input.url === 'string'
      ? parseArtifactUrl(input.url)?.slug
      : undefined
  const censusOn = isArtifactCommentsStatusEnabled()

  if (censusOn) {
    const connectedSlugs: string[] = []
    for (const [slug, sup] of un().live.supervisors) {
      if (filterSlug !== undefined && slug !== filterSlug) continue
      if (!sup.stopped) connectedSlugs.push(slug)
    }
    await refreshDirtyCommentCensuses(
      connectedSlugs,
      input.signal ?? new AbortController().signal,
    )
  }

  const watches: StatusWatchRow[] = []
  for (const [slug, sup] of un().live.supervisors) {
    if (filterSlug !== undefined && slug !== filterSlug) continue
    const census: CommentCensusStatusFields = censusOn
      ? commentCensusStatusFields(slug)
      : {}
    if (sup.stopped) {
      watches.push({
        url: viewerUrl(slug),
        rail: 'live_stopped',
        auto_reply: Boolean(sup.autoReactWiring),
        stop_kind: 'stopped',
        explicit: sup.explicit,
        ...(sup.taskId ? { task_id: String(sup.taskId) } : {}),
        ...(sup.armedVia ? { armed_via: String(sup.armedVia) } : {}),
      })
      continue
    }
    watches.push({
      url: viewerUrl(slug),
      connected: true,
      auto_reply: Boolean(sup.autoReactWiring),
      explicit: sup.explicit,
      armed_via: sup.armedVia ? String(sup.armedVia) : 'watch',
      ...(sup.taskId ? { task_id: String(sup.taskId) } : {}),
      ...(sup.watchedSince
        ? { since: new Date(sup.watchedSince).toISOString() }
        : {}),
      ...census,
    })
  }

  for (const row of un().durable.rows.values()) {
    if (filterSlug !== undefined && row.slug !== filterSlug) continue
    if (
      watches.some(w => w.url.includes(row.slug) && w.rail !== 'durable_wake')
    )
      continue
    watches.push({
      url: viewerUrl(row.slug),
      rail: 'durable_wake',
      trigger_id: row.triggerId,
      since: row.since,
      events: [...row.events],
      ...(row.restored ? { restored: true } : {}),
    })
  }

  return {
    data: {
      watches,
      ...(filterSlug !== undefined
        ? { filter_url: viewerUrl(filterSlug) }
        : {}),
    },
  }
}
