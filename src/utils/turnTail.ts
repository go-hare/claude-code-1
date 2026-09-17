/**
 * densable 2.1.246 #55 turn-tail.
 *
 *   ze @209362700   analyze last user/queued_command + referent assistant
 *   re @209362229   ze with degraded fallback
 *   sn @209362176   userDriven
 *   rn @209361992   strictHuman + We
 *   se / F / k / J / Ye / Xe / Qe / oe / ie / We / S / ne
 *
 * Host: workflow harness sMt @214733983 (`tsr` = re).
 */

import { logEvent } from 'src/services/analytics/index.js'
import {
  isCompanionOrToolUserMessage,
  isUserMessageWithPairedToolResultsOnly,
} from './messages.js'

export type TurnTailOrigin = {
  kind?: string
  subkind?: string
}

export type TurnTailMessage = {
  type?: string
  origin?: TurnTailOrigin
  isMeta?: boolean
  isCompactSummary?: boolean
  isApiErrorMessage?: boolean
  isVirtual?: boolean
  toolUseResult?: unknown
  sourceToolAssistantUUID?: unknown
  sourceToolUseID?: unknown
  turnCompanion?: unknown
  verifiedSlackHumanTurn?: boolean
  message?: {
    content?: unknown
    model?: string
    id?: unknown
  }
  attachment?: {
    type?: string
    origin?: TurnTailOrigin
    prompt?: unknown
    isMeta?: boolean
    verifiedSlackHumanTurn?: boolean
  }
}

export type TurnTailDecider = {
  index: number
  origin: TurnTailOrigin | undefined
  text: string | null
  userDriven: boolean
  strictHuman: boolean
  scheduledTrigger: boolean
}

export type TurnTailAnalysis = {
  decider: TurnTailDecider | null
  referentTail: string | undefined
  scheduledTrigger: boolean
}

/** densable leftover `O` @209366899. */
export const EMPTY_TURN_TAIL: TurnTailAnalysis = {
  decider: null,
  referentTail: undefined,
  scheduledTrigger: false,
}

/** densable leftover `S`. */
export function isHumanOrigin(origin: TurnTailOrigin | undefined): boolean {
  return origin?.kind === 'human'
}

/** densable leftover `ne`. */
export function isHumanOrAutoContinuationOrigin(
  origin: TurnTailOrigin | undefined,
): boolean {
  return origin?.kind === 'human' || origin?.kind === 'auto-continuation'
}

/** densable leftover `k`. */
export function isScheduledTriggerOrigin(
  origin: TurnTailOrigin | undefined,
): boolean {
  return (
    origin?.kind === 'task-notification' &&
    origin.subkind === 'scheduled-trigger'
  )
}

/** densable leftover `ie` @209364653. */
function isCompanionCompactOrToolUser(message: TurnTailMessage): boolean {
  return (
    isCompanionOrToolUserMessage(message) || message.isCompactSummary === true
  )
}

/** densable leftover `J`. */
function nonemptyText(value: string | null): string | null {
  return value !== null && value.trim() !== '' ? value : null
}

/** densable leftover `Ye` / `Xe` / `Qe`. */
function joinTextBlocks(
  content: unknown,
  joinEmptyAsNull: boolean,
): string | null {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return null
  const parts: string[] = []
  for (const block of content) {
    if (
      typeof block === 'object' &&
      block !== null &&
      (block as { type?: unknown }).type === 'text' &&
      typeof (block as { text?: unknown }).text === 'string'
    ) {
      parts.push((block as { text: string }).text)
    }
  }
  if (joinEmptyAsNull) {
    const joined = parts.join('\n')
    return joined.trim() !== '' ? joined : null
  }
  return parts.length > 0 ? parts.join('\n') : null
}

/** densable leftover `oe`. */
function isQueuedCommandUserVoice(attachment: {
  origin?: TurnTailOrigin
  isMeta?: boolean
}): boolean {
  return (
    isHumanOrigin(attachment.origin) ||
    (attachment.isMeta !== true &&
      isHumanOrAutoContinuationOrigin(attachment.origin))
  )
}

/** densable leftover `We` @209361992. */
export function isStrictHumanTurnMessage(message: TurnTailMessage): boolean {
  try {
    if (message.type === 'user') {
      return (
        isHumanOrigin(message.origin) &&
        message.toolUseResult === undefined &&
        message.isCompactSummary !== true &&
        message.verifiedSlackHumanTurn !== true
      )
    }
    return (
      message.type === 'attachment' &&
      message.attachment?.type === 'queued_command' &&
      isHumanOrigin(message.attachment.origin) &&
      message.attachment.verifiedSlackHumanTurn !== true
    )
  } catch {
    return false
  }
}

/** densable leftover `F`. */
function logTurnTailDegraded(): void {
  try {
    logEvent('tengu_turn_tail_analysis_degraded', {})
  } catch {
    // official swallows
  }
}

/** densable leftover `se`. */
export function hasScheduledTriggerInTail(
  messages: readonly TurnTailMessage[],
): boolean {
  for (let t = messages.length - 1; t >= 0; t--) {
    try {
      const n = messages[t]
      if (n == null) continue
      if (n.type === 'attachment' && n.attachment?.type === 'queued_command') {
        if (isScheduledTriggerOrigin(n.attachment.origin)) return true
        if (isQueuedCommandUserVoice(n.attachment)) return false
        continue
      }
      if (n.type === 'user') {
        if (isCompanionCompactOrToolUser(n)) {
          if (isScheduledTriggerOrigin(n.origin)) return true
          continue
        }
        return isScheduledTriggerOrigin(n.origin)
      }
    } catch {}
  }
  return false
}

/** densable leftover `ze` @209362700. */
export function analyzeTurnTail(
  messages: readonly TurnTailMessage[],
): TurnTailAnalysis {
  let t: TurnTailDecider | null = null
  let n = -1
  let r = false
  const i = (): TurnTailAnalysis => ({
    ...EMPTY_TURN_TAIL,
    scheduledTrigger: r || hasScheduledTriggerInTail(messages),
  })
  for (let s = messages.length - 1; s >= 0; s--) {
    const d = messages[s]
    if (d == null) return i()
    try {
      if (d.type === 'attachment' && d.attachment?.type === 'queued_command') {
        if (isScheduledTriggerOrigin(d.attachment.origin)) r = true
        if (isQueuedCommandUserVoice(d.attachment)) {
          const A = d.attachment.origin
          t = {
            index: s,
            origin: A,
            text: nonemptyText(joinTextBlocks(d.attachment.prompt, false)),
            userDriven: true,
            strictHuman: isHumanOrigin(A),
            scheduledTrigger: isScheduledTriggerOrigin(A),
          }
          n = s
          break
        }
        continue
      }
      if (
        d.type !== 'user' ||
        isCompanionCompactOrToolUser(d) ||
        isUserMessageWithPairedToolResultsOnly(messages, s)
      ) {
        if (d.type === 'user' && isScheduledTriggerOrigin(d.origin)) r = true
        continue
      }
      const f = d.origin
      const b = d.isMeta === true && isHumanOrigin(f)
      t = {
        index: s,
        origin: f,
        text: nonemptyText(joinTextBlocks(d.message?.content, false)),
        userDriven:
          b || (d.isMeta !== true && isHumanOrAutoContinuationOrigin(f)),
        strictHuman: b || (d.isMeta !== true && isHumanOrigin(f)),
        scheduledTrigger: isScheduledTriggerOrigin(f),
      }
      n = s
      break
    } catch {
      logTurnTailDegraded()
      return i()
    }
  }
  if (t === null) {
    return { ...EMPTY_TURN_TAIL, scheduledTrigger: r }
  }
  const p = r || t.scheduledTrigger
  let u: string | undefined
  try {
    for (let s = n - 1; s >= 0; s--) {
      const d = messages[s]
      if (d == null) break
      if (d.type !== 'assistant') break
      if (d.isApiErrorMessage === true || d.isVirtual === true) continue
      const b = joinTextBlocks(d.message?.content, true)
      if (b !== null) {
        u = b
        break
      }
    }
  } catch {
    logTurnTailDegraded()
    u = undefined
  }
  return { decider: t, referentTail: u, scheduledTrigger: p }
}

/** densable leftover `re` / `tsr` / `M9b` @209362229. */
export function getTurnTail(
  messages: readonly TurnTailMessage[],
): TurnTailAnalysis {
  try {
    return analyzeTurnTail(messages)
  } catch {
    logTurnTailDegraded()
    return {
      ...EMPTY_TURN_TAIL,
      scheduledTrigger: hasScheduledTriggerInTail(messages),
    }
  }
}

/** densable leftover `sn` / `L9b` / `Nz`. */
export function isUserDrivenTurn(
  messages: readonly TurnTailMessage[],
): boolean {
  return getTurnTail(messages).decider?.userDriven === true
}

/** densable leftover `rn` / `J9b` / `MYe`. */
export function isStrictHumanTurnTail(
  messages: readonly TurnTailMessage[],
): boolean {
  const t = getTurnTail(messages).decider
  if (t == null || !t.strictHuman) return false
  const n = messages[t.index]
  return n !== undefined && isStrictHumanTurnMessage(n)
}
