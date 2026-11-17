/**
 * densable cvl / Ygw / Kgw — notice coalesce → task-notification (2.1.239).
 * Source: gold-cvl-239 / gold-Ygw-239.
 */
import { randomUUID, type UUID } from 'crypto'
import { getMainThreadAgentId } from '../../bootstrap/state.js'
import {
  SUMMARY_TAG,
  TASK_NOTIFICATION_TAG,
  TASK_TYPE_TAG,
} from '../../constants/xml.js'
import { enqueuePendingNotification } from '../../utils/messageQueueManager.js'
import { escapeXml } from '../../utils/xml.js'
import {
  type ArtifactAutoReactStore,
  type NoticeCoalesceEntry,
  type NoticeCoalesceFamily,
  un,
} from './store.js'

/** densable Vgw / qgw / xam */
export const COALESCE_SETTLE_MS = 15_000
export const COALESCE_MAX_SETTLE_MS = 60_000
export const COALESCE_DETAIL_CAP = 20
const LANE_NOTICE_SLUGS_CAP = 256

const laneNoticeSlugsByStore = new WeakMap<
  ArtifactAutoReactStore,
  Map<string, string>
>()
const ownGestureEpochByEntry = new WeakMap<NoticeCoalesceEntry, number>()

function getLaneNoticeSlugsMap(): Map<string, string> {
  const store = un()
  let map = laneNoticeSlugsByStore.get(store)
  if (!map) {
    map = new Map()
    laneNoticeSlugsByStore.set(store, map)
  }
  return map
}

/** densable `inn(uuid, slug)` @194264601 — record own-gesture notice UUID → slug. */
export function recordLaneNoticeSlug(
  uuid: UUID = randomUUID(),
  slug?: string,
): UUID {
  if (slug !== undefined) {
    const map = getLaneNoticeSlugsMap()
    map.set(uuid, slug)
    if (map.size > LANE_NOTICE_SLUGS_CAP) {
      const oldest = map.keys().next().value
      if (oldest !== undefined) map.delete(oldest)
    }
  }
  return uuid
}

/** densable `tAo(uuid)` @194264672 — look up own-gesture slug for a notice UUID. */
export function getLaneNoticeSlug(uuid: string): string | undefined {
  return getLaneNoticeSlugsMap().get(uuid)
}

export type CoalesceQueue = {
  enqueuePendingNotification: typeof enqueuePendingNotification
}

function coalesceKey(family: NoticeCoalesceFamily, slug: string): string {
  return `${family}\n${slug}`
}

/** densable `J` / `ptn` / `ftn` / `C` @194270630 — summary line. */
export function formatCoalesceSummary(
  family: NoticeCoalesceFamily,
  artifactName: string,
  count = 1,
  suppressedPrior = false,
): string {
  const name = artifactName || 'artifact'
  if (family === 'auto-replied') {
    return count <= 1
      ? `Auto-replied to comment thread on Artifact: ${name}`
      : `Auto-replied to ${count} comment threads on Artifact: ${name}`
  }
  if (family === 'auto-edited') {
    return count <= 1
      ? `Auto-edited Artifact: ${name} in response to a comment thread`
      : `Auto-edited Artifact: ${name} in response to ${count} comment threads`
  }
  if (family === 'artifact-changed') {
    return count <= 1 && !suppressedPrior
      ? `Artifact changed: ${name}`
      : `Artifact changed ${count}${suppressedPrior ? '+' : ''} times: ${name}`
  }
  if (count <= 1) return `New comments on ${name}`
  return `${count} comment updates on ${name}`
}

/** densable Zi — task-notification XML for artifact families (no system-reminder / no <body>). */
export function formatArtifactTaskNotification(input: {
  taskType: 'artifact-auto-react' | 'artifact-changed'
  summary: string
  body: string
}): string {
  const trimmedBody = input.body.replace(/^\n+/, '').trimEnd()
  const bodyBlock = trimmedBody ? `\n${escapeXml(trimmedBody)}` : ''
  return `<${TASK_NOTIFICATION_TAG}>
<${TASK_TYPE_TAG}>${escapeXml(input.taskType)}</${TASK_TYPE_TAG}>
<${SUMMARY_TAG}>${escapeXml(input.summary)}</${SUMMARY_TAG}>${bodyBlock}
</${TASK_NOTIFICATION_TAG}>`
}

function flushCoalesceKey(key: string): void {
  const map = un().noticeCoalesce
  const entry = map.get(key)
  if (entry === undefined) return
  map.delete(key)
  if (entry.timer !== undefined) clearTimeout(entry.timer)

  const summary = formatCoalesceSummary(
    entry.family,
    entry.artifactName,
    entry.count,
    entry.suppressedPrior > 0,
  )
  const omitted =
    entry.droppedDetails > 0
      ? `\n\n(${entry.droppedDetails} earlier ${
          entry.droppedDetails === 1 ? 'notice' : 'notices'
        } in this burst omitted \u2014 newest ${COALESCE_DETAIL_CAP} kept.)`
      : ''
  const body = `${entry.details.join('\n\n')}${omitted}`
  const taskType =
    entry.family === 'artifact-changed'
      ? 'artifact-changed'
      : 'artifact-auto-react'
  const source = taskType
  const enqueueFn =
    entry.queue?.enqueuePendingNotification ?? enqueuePendingNotification
  const ownGestureEpoch = ownGestureEpochByEntry.get(entry)

  enqueueFn({
    uuid:
      entry.family === 'artifact-changed'
        ? randomUUID()
        : recordLaneNoticeSlug(
            undefined,
            ownGestureEpoch === un().accountEpoch ? entry.slug : undefined,
          ),
    value: formatArtifactTaskNotification({
      taskType,
      summary,
      body: `\n${body}`,
    }),
    mode: 'task-notification',
    origin: {
      kind: 'task-notification',
      source,
      slug: entry.slug,
      displayName: entry.artifactName,
      coalesced: { family: entry.family, count: entry.count },
    },
    agentId: getMainThreadAgentId(),
  })
}

export type CoalesceNoticeInput = {
  slug: string
  family: NoticeCoalesceFamily
  artifactName: string
  detail: string
  mergeDetails: 'append' | 'latest'
  threadId?: string
  ownGesture?: boolean
  now?: number
  settleMs?: number
  maxSettleMs?: number
  settle?: {
    settleMs?: number
    maxSettleMs?: number
  }
  queue?: CoalesceQueue
}

/**
 * densable cvl — coalesce notices then flush via Ygw.
 */
export function coalesceNotice(input: CoalesceNoticeInput): void {
  const now = input.now ?? Date.now()
  const settleMs =
    input.settle?.settleMs ?? input.settleMs ?? COALESCE_SETTLE_MS
  const maxSettleMs =
    input.settle?.maxSettleMs ?? input.maxSettleMs ?? COALESCE_MAX_SETTLE_MS
  const store = un()
  const map = store.noticeCoalesce
  const accountEpoch = store.accountEpoch
  const key = coalesceKey(input.family, input.slug)
  let entry = map.get(key)
  if (entry === undefined) {
    entry = {
      slug: input.slug,
      family: input.family,
      artifactName: input.artifactName,
      mergeDetails: input.mergeDetails,
      count: 0,
      threadIds: new Set(),
      firstAt: now,
      details: [],
      droppedDetails: 0,
      suppressedPrior: 0,
    }
    if (input.ownGesture) {
      ownGestureEpochByEntry.set(entry, accountEpoch)
    }
    map.set(key, entry)
  } else if (
    !input.ownGesture ||
    ownGestureEpochByEntry.get(entry) !== accountEpoch
  ) {
    ownGestureEpochByEntry.delete(entry)
  }
  entry.artifactName = input.artifactName
  if (input.queue !== undefined) entry.queue = input.queue
  if (input.threadId !== undefined) entry.threadIds.add(input.threadId)
  entry.count =
    entry.threadIds.size > 0 ? entry.threadIds.size : entry.count + 1
  if (input.mergeDetails === 'latest' || entry.mergeDetails === 'latest') {
    entry.mergeDetails = 'latest'
    entry.details = [input.detail]
  } else {
    entry.details.push(input.detail)
    if (entry.details.length > COALESCE_DETAIL_CAP) {
      entry.details.shift()
      entry.droppedDetails++
    }
  }
  if (entry.timer !== undefined) clearTimeout(entry.timer)
  const deadline = entry.firstAt + maxSettleMs
  const delay = Math.max(0, Math.min(settleMs, deadline - now))
  const timer = setTimeout(flushCoalesceKey, delay, key)
  timer.unref?.()
  entry.timer = timer
}

/** densable Ram — mark suppressed prior for rate-limited ver bursts. */
export function markCoalesceSuppressed(
  slug: string,
  family: NoticeCoalesceFamily,
): void {
  const entry = un().noticeCoalesce.get(coalesceKey(family, slug))
  if (entry !== undefined) entry.suppressedPrior++
}

/** densable m6e portable — quoted title or URL fallback. */
export function formatArtifactDisplayName(
  title: string | undefined,
  url: string,
): string {
  const t = title?.trim()
  if (!t) return url
  return `"${t.replace(/"/g, "'")}"`
}

/** Test helper — flush all pending coalesce timers immediately. */
export function flushAllCoalesceForTests(): void {
  for (const key of [...un().noticeCoalesce.keys()]) flushCoalesceKey(key)
}
