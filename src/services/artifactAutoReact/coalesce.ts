/**
 * densable cvl / Ygw / Kgw — notice coalesce → task-notification (2.1.239).
 * Source: gold-cvl-239 / gold-Ygw-239.
 */
import { randomUUID } from 'crypto'
import { getMainThreadAgentId } from '../../bootstrap/state.js'
import { enqueuePendingNotification } from '../../utils/messageQueueManager.js'
import { wrapInSystemReminder } from '../../utils/messages.js'
import { type NoticeCoalesceFamily, un } from './store.js'

/** densable Vgw / qgw / xam */
export const COALESCE_SETTLE_MS = 15_000
export const COALESCE_MAX_SETTLE_MS = 60_000
export const COALESCE_DETAIL_CAP = 20

export type CoalesceQueue = {
  enqueuePendingNotification: typeof enqueuePendingNotification
}

function coalesceKey(family: NoticeCoalesceFamily, slug: string): string {
  return `${family}\n${slug}`
}

/** densable Kgw — summary line. */
export function formatCoalesceSummary(
  family: NoticeCoalesceFamily,
  artifactName: string,
  count: number,
  suppressedPrior: boolean,
): string {
  const name = artifactName || 'artifact'
  if (family === 'artifact-changed') {
    return suppressedPrior
      ? `${name} was republished (earlier notices suppressed)`
      : `${name} was republished`
  }
  if (count <= 1) return `New comments on ${name}`
  return `${count} comment updates on ${name}`
}

/** densable uI portable — task-notification body for artifact families. */
export function formatArtifactTaskNotification(input: {
  taskType: 'artifact-auto-react' | 'artifact-changed'
  summary: string
  body: string
}): string {
  return wrapInSystemReminder(
    [
      `<task-notification>`,
      `<task-type>${input.taskType}</task-type>`,
      `<summary>${input.summary}</summary>`,
      `<body>`,
      input.body.trim(),
      `</body>`,
      `</task-notification>`,
    ].join('\n'),
  )
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
        } in this burst omitted — newest ${COALESCE_DETAIL_CAP} kept.)`
      : ''
  const body = `${entry.details.join('\n\n')}${omitted}`
  const taskType =
    entry.family === 'artifact-changed'
      ? 'artifact-changed'
      : 'artifact-auto-react'
  const source = taskType

  enqueuePendingNotification({
    uuid: randomUUID(),
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
  now?: number
  settleMs?: number
  maxSettleMs?: number
  queue?: CoalesceQueue
}

/**
 * densable cvl — coalesce notices then flush via Ygw.
 */
export function coalesceNotice(input: CoalesceNoticeInput): void {
  const now = input.now ?? Date.now()
  const settleMs = input.settleMs ?? COALESCE_SETTLE_MS
  const maxSettleMs = input.maxSettleMs ?? COALESCE_MAX_SETTLE_MS
  const map = un().noticeCoalesce
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
    map.set(key, entry)
  }
  entry.artifactName = input.artifactName
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
