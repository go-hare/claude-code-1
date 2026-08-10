/**
 * densable loop noop-fold UI (SEA 2.1.221 `UXm` / `sQT` / `aQT` / `sGf`).
 *
 * When Cfr (tengu_loop_noop_fold) is on and a kind:loop wakeup fires while
 * idle, fold the previous noop tick out of the terminal transcript instead of
 * appending another fire line.
 */

import { randomUUID } from 'crypto'
import type { Message } from '../types/message.js'
import { SCHEDULE_WAKEUP_TOOL_NAME } from '@claude-code/builtin-tools/tools/ScheduleWakeupTool/constants.js'
import { logEvent } from '../services/analytics/index.js'
import { createUserMessage } from './messages.js'
import { plural } from './stringUtils.js'

export type LoopFireFoldMeta = {
  cronKind?: 'loop'
  noOpStreak?: number
  streakStartedAt?: string
  foldedUuids?: string[]
}

type FoldNone = { kind: 'none' }
type FoldVeto = { kind: 'veto'; fireIdx: number; reason: string }
type FoldOk = {
  kind: 'fold'
  fireIdx: number
  priorStreak: number
  since: string
  toolUseCount: number
}
export type LoopNoopFoldDecision = FoldNone | FoldVeto | FoldOk

/** densable `d1l` — prior loop fire anchors. */
export function isLoopScheduledTaskFire(msg: Message): boolean {
  return (
    msg.type === 'system' &&
    msg.subtype === 'scheduled_task_fire' &&
    msg.cronKind === 'loop'
  )
}

/** densable `BXm` — system messages that block span scanning. */
export function isBlockingSystemMessage(msg: Message): boolean {
  if (msg.type !== 'system') return false
  return (
    msg.subtype === 'scheduled_task_fire' || msg.subtype === 'compact_boundary'
  )
}

/** densable `Dne` — user message is a tool_result payload. */
function isToolResultUserMessage(msg: Message): boolean {
  if (msg.type !== 'user') return false
  const content = msg.message?.content
  if (typeof content === 'string' || !Array.isArray(content)) return false
  return content.some(
    (b: { type?: string }) =>
      b !== null && typeof b === 'object' && b.type === 'tool_result',
  )
}

function formatCronFireTime(d: Date): string {
  return d
    .toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
    .replace(/,? at |, /, ' ')
    .replace(/ ([AP]M)/, (_, ampm: string) => ampm.toLowerCase())
}

/**
 * densable `sQT` — scan from last loop fire to end; fold only pure noop ticks.
 */
export function analyzeLoopNoopSpan(messages: Message[]): LoopNoopFoldDecision {
  const fireIdx = messages.findLastIndex(isLoopScheduledTaskFire)
  const fire = messages[fireIdx]
  if (fire === undefined || !isLoopScheduledTaskFire(fire)) {
    return { kind: 'none' }
  }

  // Scan backwards before anchor for blocking systems (compact etc.)
  for (let i = fireIdx - 1; i >= 0; i--) {
    const m = messages[i]!
    if (isLoopScheduledTaskFire(m)) break
    if (isBlockingSystemMessage(m)) {
      return {
        kind: 'veto',
        fireIdx,
        reason: 'blocking_system_before_anchor',
      }
    }
  }

  let modelReportedNoop: boolean | undefined
  const toolUseIds = new Set<string>()

  for (let i = fireIdx + 1; i < messages.length; i++) {
    const m = messages[i]!
    if (isBlockingSystemMessage(m)) {
      return { kind: 'veto', fireIdx, reason: 'blocking_system_in_span' }
    }
    if (m.type === 'assistant') {
      const content = m.message?.content
      if (!Array.isArray(content)) continue
      for (const block of content as Array<{
        type?: string
        id?: string
        name?: string
        input?: { noop?: boolean }
      }>) {
        if (block?.type !== 'tool_use') continue
        if (typeof block.id === 'string') toolUseIds.add(block.id)
        if (block.name === SCHEDULE_WAKEUP_TOOL_NAME) {
          modelReportedNoop = block.input?.noop === true
        }
      }
      continue
    }
    if (m.type === 'user') {
      const denial = m.toolDenialKind as string | undefined
      if (denial !== undefined) {
        return {
          kind: 'veto',
          fireIdx,
          reason:
            denial === 'interrupted' || denial === 'cancelled'
              ? 'tool_abort'
              : 'tool_denial',
        }
      }
      const content = m.message?.content
      if (typeof content !== 'string' && Array.isArray(content)) {
        for (const block of content as Array<{
          type?: string
          tool_use_id?: string
        }>) {
          if (
            block?.type === 'tool_result' &&
            typeof block.tool_use_id === 'string' &&
            !toolUseIds.has(block.tool_use_id)
          ) {
            return { kind: 'veto', fireIdx, reason: 'split_tool_pair' }
          }
        }
      }
      // densable: foreign user input (not tool_result, not meta later queue)
      if (!isToolResultUserMessage(m)) {
        const verifiedSlack = m.verifiedSlackHumanTurn === true
        const hasOrigin = m.origin !== undefined
        const queuePriority = m.queuePriority as string | undefined
        const isMeta = m.isMeta === true
        if (
          verifiedSlack ||
          hasOrigin ||
          (queuePriority !== 'later' && !isMeta)
        ) {
          return { kind: 'veto', fireIdx, reason: 'foreign_user_input' }
        }
      }
      continue
    }
    if (m.type === 'attachment') {
      const att = m.attachment as { type?: string } | undefined
      if (att?.type === 'queued_command') {
        return { kind: 'veto', fireIdx, reason: 'queued_command' }
      }
    }
  }

  if (modelReportedNoop !== true) {
    return { kind: 'veto', fireIdx, reason: 'model_reported_work' }
  }

  return {
    kind: 'fold',
    fireIdx,
    priorStreak: (fire.noOpStreak as number | undefined) ?? 0,
    since:
      (fire.streakStartedAt as string | undefined) ??
      (typeof fire.timestamp === 'string'
        ? fire.timestamp
        : new Date().toISOString()),
    toolUseCount: toolUseIds.size,
  }
}

function spanDurationSeconds(messages: Message[], fireIdx: number): number {
  const start = messages[fireIdx]?.timestamp
  const end = messages.at(-1)?.timestamp
  if (typeof start !== 'string' || typeof end !== 'string') return 0
  return Math.round((Date.parse(end) - Date.parse(start)) / 1000)
}

/** densable `DCn` with optional fold meta. */
export function createLoopScheduledTaskFireMessage(
  content: string,
  meta?: LoopFireFoldMeta,
): Message {
  const msg: Message = {
    type: 'system',
    subtype: 'scheduled_task_fire',
    content,
    isMeta: false,
    timestamp: new Date().toISOString(),
    uuid: randomUUID(),
  }
  if (meta?.cronKind) msg.cronKind = meta.cronKind
  if (meta?.noOpStreak !== undefined && meta.noOpStreak > 0) {
    msg.noOpStreak = meta.noOpStreak
    msg.streakStartedAt = meta.streakStartedAt
  }
  if (meta?.foldedUuids && meta.foldedUuids.length > 0) {
    msg.foldedUuids = meta.foldedUuids
  }
  return msg
}

/** densable `aQT` — meta healthy-loop notice for the model. */
export function createLoopHealthyMetaMessage(streak: number): Message {
  return createUserMessage({
    content: `[${streak} prior /loop ${plural(streak, 'wakeup')} found nothing actionable; loop is healthy.]`,
    isMeta: true,
  })
}

/**
 * densable `UXm` — append a loop fire line, optionally folding the prior noop span.
 * @param idleAtFire densable `!isLoading` at fire time (only then attempt fold).
 */
export function appendLoopWakeupMessages(
  messages: Message[],
  idleAtFire: boolean,
): Message[] {
  const baseLabel = `Claude resuming /loop wakeup (${formatCronFireTime(new Date())})`
  const decision = idleAtFire
    ? analyzeLoopNoopSpan(messages)
    : ({ kind: 'none' } as const)

  if (decision.kind === 'veto') {
    logEvent(
      'loop_noop_fold' as never,
      {
        reason: decision.reason as never,
      } as never,
    )
  }

  if (decision.kind !== 'fold') {
    // Always stamp cronKind:'loop' so mid-stream / non-idle fires still
    // act as fold anchors for the next idle tick (review #2).
    return [
      ...messages,
      createLoopScheduledTaskFireMessage(baseLabel, { cronKind: 'loop' }),
    ]
  }

  const streak = decision.priorStreak + 1
  const sinceLabel = formatCronFireTime(new Date(decision.since))
  const foldedUuids = messages.slice(decision.fireIdx).map(m => String(m.uuid))
  logEvent(
    'loop_noop_fold' as never,
    {
      streak,
      span_len: foldedUuids.length,
      tool_uses: decision.toolUseCount,
      span_duration_s: spanDurationSeconds(messages, decision.fireIdx),
    } as never,
  )

  return [
    ...messages,
    createLoopScheduledTaskFireMessage(
      `${baseLabel} · ${streak} no-op ${plural(streak, 'tick')} since ${sinceLabel}`,
      {
        cronKind: 'loop',
        noOpStreak: streak,
        streakStartedAt: decision.since,
        foldedUuids,
      },
    ),
    createLoopHealthyMetaMessage(streak),
  ]
}

/**
 * densable `sGf` — drop messages whose uuid is listed in any fold's foldedUuids.
 */
export function filterFoldedLoopNoopMessages<
  T extends {
    uuid?: string
    type?: string
    subtype?: string
    foldedUuids?: string[]
  },
>(messages: T[]): T[] {
  let folded: Set<string> | undefined
  for (const m of messages) {
    if (
      m.type === 'system' &&
      m.subtype === 'scheduled_task_fire' &&
      m.foldedUuids !== undefined &&
      m.foldedUuids.length > 0
    ) {
      folded ??= new Set()
      for (const id of m.foldedUuids) folded.add(id)
    }
  }
  if (folded === undefined) return messages
  return messages.filter(m => !m.uuid || !folded!.has(String(m.uuid)))
}
