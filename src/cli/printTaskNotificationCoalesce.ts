/**
 * densable 2.1.289 print/headless task-notification coalesce (SEA Kc / vh / Ch).
 * Semantic helpers only — invent-ban minify exports (Kc|Rl|vh|Ch|Fu|Th).
 */
import { getFeatureValue_CACHED_MAY_BE_STALE } from 'src/services/analytics/growthbook.js'
import { logEvent } from 'src/services/analytics/index.js'
import type { AgentId } from 'src/types/ids.js'
import type { QueuedCommand } from 'src/types/textInputTypes.js'
import { STATUS_TAG, TASK_NOTIFICATION_TAG } from 'src/constants/xml.js'
import { isHumanLikeOrigin } from 'src/utils/messages.js'
import { logForDebugging } from 'src/utils/debug.js'

/** densable Th = fwt — max held completion chars before refusing another hold. */
export const PRINT_TASK_NOTIFICATION_COALESCE_CHAR_BUDGET = 100_000

type TaskNotificationExtras = {
  taskDelivery?: unknown
  userResumeNotice?: boolean
  inheritedTurnAttributionKey?: string
}

const UUID_SHAPE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function asUuidKey(value: unknown): string | undefined {
  return typeof value === 'string' && UUID_SHAPE.test(value) ? value : undefined
}

/** densable `xbt` — raw turnAttributionKey, else Pbt(inherited) on notifications. */
export function printNotificationTurnAttributionKey(
  cmd: QueuedCommand,
): unknown {
  if (cmd.turnAttributionKey !== undefined) {
    return cmd.turnAttributionKey
  }
  if (cmd.mode === 'task-notification') {
    const extras = cmd as QueuedCommand & TaskNotificationExtras
    return asUuidKey(extras.inheritedTurnAttributionKey)
  }
  return undefined
}

export function isPrintTaskNotificationCoalesceEnabled(): boolean {
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_swirling_meteor', true)
}

/**
 * densable vh — can this queue entry participate in print task-notification
 * coalesce (hold shouldQuery for a follower notification turn)?
 */
export function isCoalescableTaskNotificationCommand(
  cmd: QueuedCommand,
): boolean {
  if (cmd.mode !== 'task-notification') return false
  if (cmd.taskId === undefined) return false
  // densable HP(origin): undefined / human-like origins only.
  if (!isHumanLikeOrigin(cmd.origin)) return false
  if (cmd.uuid !== undefined) return false
  const extras = cmd as QueuedCommand & TaskNotificationExtras
  if (extras.taskDelivery !== undefined) return false
  if (extras.userResumeNotice === true) return false
  if (cmd.stopHookActive === true) return false
  if (cmd.shouldQuery === false) return false
  if (typeof cmd.value !== 'string') return false

  const trimmed = cmd.value.trim()
  const open = `<${TASK_NOTIFICATION_TAG}>`
  const close = `</${TASK_NOTIFICATION_TAG}>`
  if (!trimmed.startsWith(open)) return false
  if (trimmed.indexOf(open, 1) !== -1) return false
  if (!trimmed.endsWith(close)) return false
  if (trimmed.indexOf(close) !== trimmed.length - close.length) return false
  // densable vh: zr(body, statusTag) !== null — parse a real status tag, not
  // a coincidental `<status>` substring.
  return extractFirstXmlTag(trimmed, STATUS_TAG) !== null
}

/**
 * densable zr — first balanced `<tag>…</tag>` inner text, or null.
 */
export function extractFirstXmlTag(
  haystack: string,
  tag: string,
): string | null {
  if (!haystack.trim() || !tag.trim()) return null
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pair = new RegExp(
    `<${escaped}(?:\\s+[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`,
    'gi',
  )
  const open = new RegExp(`<${escaped}(?:\\s+[^>]*?)?>`, 'gi')
  const close = new RegExp(`<\\/${escaped}>`, 'gi')
  let match: RegExpExecArray | null
  let searchFrom = 0
  while ((match = pair.exec(haystack)) !== null) {
    const inner = match[1]
    const before = haystack.slice(searchFrom, match.index)
    let depth = 0
    open.lastIndex = 0
    while (open.exec(before) !== null) depth++
    close.lastIndex = 0
    while (close.exec(before) !== null) depth--
    if (depth === 0 && inner != null) return inner
    searchFrom = match.index + match[0].length
  }
  return null
}

/**
 * densable Ch subset — same coalesce-relevant stamps + both vh-coalescable.
 */
export function canCoalesceTaskNotificationWithFollower(
  head: QueuedCommand,
  next: QueuedCommand,
): boolean {
  return (
    next.priority === head.priority &&
    next.workload === head.workload &&
    !!next.isMeta === !!head.isMeta &&
    !!next.skipAttachments === !!head.skipAttachments &&
    next.wakeupSource === head.wakeupSource &&
    next.ccrTurnId === head.ccrTurnId &&
    printNotificationTurnAttributionKey(next) ===
      printNotificationTurnAttributionKey(head) &&
    isCoalescableTaskNotificationCommand(head) &&
    isCoalescableTaskNotificationCommand(next)
  )
}

export type HoldQueryForFollowerOpts = {
  deferredHuman: boolean
  admits: (next: QueuedCommand) => boolean
  isDoomBoundary?: (head: QueuedCommand, next: QueuedCommand) => boolean
}

/**
 * densable holdsQueryForFollower — whether head should hold its model query
 * because a coalescable follower is next.
 */
export function shouldHoldQueryForTaskNotificationFollower(
  head: QueuedCommand,
  nextMain: QueuedCommand | undefined,
  opts: HoldQueryForFollowerOpts,
): boolean {
  if (opts.deferredHuman) return false
  if (nextMain === undefined) return false
  if (!canCoalesceTaskNotificationWithFollower(head, nextMain)) return false
  if (!opts.admits(nextMain)) return false
  const doom = opts.isDoomBoundary ?? (() => false)
  if (doom(head, nextMain)) return false
  return true
}

export type PrintTaskNotificationCoalesceState = {
  heldCompletionChars: number
  heldCompletionWorkload: string | undefined
  noteTurnEnded: (args: {
    aborted: boolean
    command: QueuedCommand
    numTurns: number
    result: string
  }) => void
  maybeStampHold: (
    cmd: QueuedCommand,
    opts: {
      endSessionRequested: boolean
      coalesceEnabled: boolean
      holdsFollower: boolean
    },
  ) => QueuedCommand
  maybeOwedPrompt: (opts: {
    endSessionRequested: boolean
    aborted: boolean
    peekMainDefined: boolean
    mainAgentId: AgentId
  }) => QueuedCommand | undefined
}

/**
 * densable Kc hold/owed state for print drain — accumulate held notification
 * chars, stamp shouldQuery:false when a follower is waiting, and emit a
 * synthetic empty prompt when the queue empties with an owed call.
 */
export function createPrintTaskNotificationCoalesceState(): PrintTaskNotificationCoalesceState {
  let heldCompletionChars = 0
  let heldCompletionWorkload: string | undefined

  return {
    get heldCompletionChars() {
      return heldCompletionChars
    },
    get heldCompletionWorkload() {
      return heldCompletionWorkload
    },
    noteTurnEnded({ aborted, command, numTurns, result }) {
      if (aborted || numTurns > 0) {
        if (!aborted && heldCompletionChars > 0) {
          logEvent('print_task_notification_coalesce', {})
        }
        heldCompletionChars = 0
        heldCompletionWorkload = undefined
        return
      }
      if (
        command.queryHeldForNextTurn === true &&
        typeof command.value === 'string' &&
        result === ''
      ) {
        heldCompletionChars += command.value.length
        heldCompletionWorkload = command.workload
      }
    },
    maybeStampHold(
      cmd,
      { endSessionRequested, coalesceEnabled, holdsFollower },
    ) {
      if (
        cmd.mode === 'task-notification' &&
        typeof cmd.value === 'string' &&
        !endSessionRequested &&
        heldCompletionChars + cmd.value.length <=
          PRINT_TASK_NOTIFICATION_COALESCE_CHAR_BUDGET &&
        coalesceEnabled &&
        holdsFollower
      ) {
        return {
          ...cmd,
          shouldQuery: false,
          queryHeldForNextTurn: true,
          stampThreadState: undefined,
        }
      }
      return cmd
    },
    maybeOwedPrompt({
      endSessionRequested,
      aborted,
      peekMainDefined,
      mainAgentId,
    }) {
      if (heldCompletionChars === 0 || endSessionRequested || peekMainDefined) {
        return undefined
      }
      if (aborted) {
        heldCompletionChars = 0
        heldCompletionWorkload = undefined
        return undefined
      }
      logEvent('print_task_notification_coalesce', {})
      logForDebugging('print_task_notification_coalesce owed_call_dispatched')
      const owed: QueuedCommand = {
        value: [],
        mode: 'prompt',
        agentId: mainAgentId,
        isMeta: true,
        skipSubmissionHooks: true,
        workload: heldCompletionWorkload,
      }
      heldCompletionChars = 0
      heldCompletionWorkload = undefined
      return owed
    },
  }
}
