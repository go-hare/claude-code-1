/**
 * densable 2.1.289 `XG` / `uDo` / `utt` / `jxn` / `Uxn` / `pDo`.
 *
 * Gold print engine ctor calls `uDo({messages,isProjectsSession,...})`.
 * `pDo` no-ops until that source is set AND `utt()` gates pass
 * (`tengu_projects_thread_state_stamp` default false).
 * Never export densable ids.
 */

import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js'

export type ProjectsThreadStateSource = {
  messages: () => readonly unknown[]
  isProjectsSession: () => boolean
  isThread: () => boolean
  isOverview: () => boolean
  ownerRowsWrittenAt: (carrier: unknown) => number | undefined
}

type HostSlot = { source: ProjectsThreadStateSource | undefined }

const host: HostSlot = { source: undefined }

const THREAD_STATE_STAMP_GATE = 'tengu_projects_thread_state_stamp'

/** densable `XG`. */
export function getProjectsThreadStateHost(): HostSlot {
  return host
}

/** densable `uDo`. */
export function setProjectsThreadStateSource(
  source: ProjectsThreadStateSource | undefined,
): void {
  host.source = source
}

/**
 * densable `utt` — source + GB default false + projects session.
 * Gold also `Ooe()&&eoe()==="full"` (projects view host); those stay
 * off until that host lands. GB default false matches gold `k(Nxn,!1)`.
 */
export function isProjectsThreadStateEnabled(): boolean {
  const source = host.source
  return (
    source !== undefined &&
    getFeatureValue_CACHED_MAY_BE_STALE(THREAD_STATE_STAMP_GATE, false) &&
    source.isProjectsSession()
  )
}

/** densable `Uxn`. */
export function formatThreadStateAge(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60000))
  if (minutes < 60) return `${minutes}m ago`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m ago`
}

type ThreadMessage = {
  type?: string
  timestamp?: string
  origin?: { kind?: string }
  attachment?: { type?: string; origin?: { kind?: string }; timestamp?: string }
  message?: { content?: unknown }
}

function userTimestampMs(
  message: ThreadMessage,
  ownerRowsWrittenAt: (carrier: unknown) => number | undefined,
): number | undefined {
  const carrier: ThreadMessage | undefined =
    message.type === 'user'
      ? message
      : message.type === 'attachment' &&
          message.attachment?.type === 'queued_command'
        ? message.attachment
        : undefined
  if (carrier === undefined) return undefined
  if (carrier.origin?.kind === 'human') {
    const stamped = carrier.type === 'user' ? undefined : carrier.timestamp
    return Date.parse(stamped ?? message.timestamp ?? '')
  }
  return ownerRowsWrittenAt(carrier)
}

/**
 * densable `jxn` — last human/owner row + assistant tool_use count after it.
 * Gold counts `tool_use.name===Sme` (projects reply tool). Local counts
 * any assistant `tool_use` after that row — same shape, no invented name.
 */
export function measureThreadState(
  messages: readonly unknown[],
  nowMs: number,
  ownerRowsWrittenAt: (carrier: unknown) => number | undefined = () =>
    undefined,
): { sinceUserMs: number; repliesSinceUser: number } | undefined {
  let lastIdx = -1
  let lastMs = Number.NEGATIVE_INFINITY
  for (const [index, raw] of messages.entries()) {
    const ms = userTimestampMs(raw as ThreadMessage, ownerRowsWrittenAt)
    if (ms !== undefined && Number.isFinite(ms) && ms >= lastMs) {
      lastIdx = index
      lastMs = ms
    }
  }
  if (lastIdx < 0) return undefined
  let replies = 0
  for (const [index, raw] of messages.entries()) {
    const message = raw as ThreadMessage
    if (
      message.type !== 'assistant' ||
      !Array.isArray(message.message?.content)
    ) {
      continue
    }
    const stamped = Date.parse(message.timestamp ?? '')
    if (Number.isFinite(stamped) ? stamped <= lastMs : index <= lastIdx) {
      continue
    }
    for (const block of message.message.content) {
      if (
        typeof block === 'object' &&
        block !== null &&
        (block as { type?: string }).type === 'tool_use'
      ) {
        replies++
      }
    }
  }
  return { sinceUserMs: nowMs - lastMs, repliesSinceUser: replies }
}

/**
 * densable `pDo`. No-ops without source / `utt()`.
 */
export function snapshotProjectsThreadState(
  nowMs = Date.now(),
): { sinceUser: string; repliesSinceUser: number } | undefined {
  try {
    const source = host.source
    if (source === undefined || !isProjectsThreadStateEnabled()) {
      return undefined
    }
    const measured = measureThreadState(
      source.messages(),
      nowMs,
      source.ownerRowsWrittenAt,
    )
    if (!measured) return undefined
    return {
      sinceUser: formatThreadStateAge(measured.sinceUserMs),
      repliesSinceUser: measured.repliesSinceUser,
    }
  } catch {
    return undefined
  }
}
