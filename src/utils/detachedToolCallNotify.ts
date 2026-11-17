/**
 * densable `qie` — enqueue detached tool_call task-notification (gVn envelope).
 */
import { getMainThreadAgentId } from '../bootstrap/state.js'
import {
  STATUS_TAG,
  SUMMARY_TAG,
  TASK_NOTIFICATION_TAG,
  TASK_TYPE_TAG,
  TOOL_USE_ID_TAG,
} from '../constants/xml.js'
import { enqueuePendingNotification } from './messageQueueManager.js'
import { escapeXml } from './xml.js'

/** densable `lOt` = `fwt - 2000` (notification cap 1e5). */
export const DETACH_RESULT_CAP = 98_000

const TRUNCATED_SUFFIX = '\u2026 [truncated]'

function sliceSurrogateSafe(text: string, maxUnits: number): string {
  if (text.length <= maxUnits) return text
  let end = maxUnits
  if (end > 0) {
    const code = text.charCodeAt(end - 1)
    if (code >= 0xd800 && code <= 0xdbff) end--
  }
  return text.slice(0, end)
}

/**
 * densable `MEe` — escape XML and clip surrogate-safely so the post-escape
 * string is `<= cap` (`98_000`).
 */
export function escapeDetachedResultBody(
  text: string,
  cap: number = DETACH_RESULT_CAP,
): string {
  const escaped = escapeXml(text)
  if (escaped.length <= cap) return escaped
  const escapedSuffix = escapeXml(TRUNCATED_SUFFIX)
  let maxUnits = Math.max(0, Math.min(text.length, cap - escapedSuffix.length))
  while (maxUnits > 0) {
    const candidate = sliceSurrogateSafe(text, maxUnits)
    const escapedCandidate = escapeXml(candidate)
    if (escapedCandidate.length + escapedSuffix.length <= cap) {
      return `${escapedCandidate}${escapedSuffix}`
    }
    maxUnits = Math.floor(maxUnits * 0.9)
  }
  return escapedSuffix.slice(0, cap)
}

/** densable `FPt` — immediate tool_result while the call keeps running. */
export function stillRunningDetachText(
  toolName: string,
  isOnScreen: boolean,
): string {
  return `[Still running. The user sent a message while this call loads, and that message follows so you can answer it now. This ${toolName} call was not interrupted. Its result will be delivered to you on its own, in a later <${TASK_NOTIFICATION_TAG}> carrying this tool_use_id. Do not repeat the call, and do not wait, sleep or poll for it. You cannot stop it either, so never say you cancelled or dropped it.${isOnScreen ? " On the user's screen this call simply still shows as in progress: nothing there says it was moved, backgrounded or detached, so do not describe it that way." : ''} If they ask, it is still loading.]`
}

export function enqueueDetachedToolCallResult(opts: {
  toolName: string
  toolUseId: string
  status: 'completed' | 'failed' | 'stopped'
  text: string
  isOnScreen: boolean
  passive?: boolean
}): 'delivered' | 'degraded' | 'dropped' {
  const onScreen =
    opts.status === 'completed'
      ? opts.isOnScreen
        ? "On the user's screen it just landed in that call's own row, like any tool result. "
        : ''
      : opts.isOnScreen
        ? "On the user's screen that call's own row shows how it ended, like any tool error or interrupted call. "
        : ''
  const summary =
    opts.status === 'completed'
      ? `The ${opts.toolName} call finished; its result follows. ${onScreen}Carry on from it as if the tool had just returned: do not announce a notification or a background task. If the user has since said they no longer need this result, do not answer the old request again: correct anything you got wrong in one or two lines, or say nothing new.`
      : `The ${opts.toolName} call ended without a result; what happened follows. ${onScreen}Carry on as if the tool had just returned it: do not announce a notification or a background task.`
  const xmlStatus = opts.status === 'completed' ? 'completed' : 'failed'
  const escapedBody = escapeDetachedResultBody(opts.text, DETACH_RESULT_CAP)
  const agentId = getMainThreadAgentId()
  try {
    enqueuePendingNotification(
      {
        value: `<${TASK_NOTIFICATION_TAG}>
<${TOOL_USE_ID_TAG}>${escapeXml(opts.toolUseId)}</${TOOL_USE_ID_TAG}>
<${TASK_TYPE_TAG}>tool_call</${TASK_TYPE_TAG}>
<${STATUS_TAG}>${xmlStatus}</${STATUS_TAG}>
<${SUMMARY_TAG}>${escapeXml(summary)}</${SUMMARY_TAG}>
<result>
${escapedBody}
</result>
</${TASK_NOTIFICATION_TAG}>`,
        mode: 'task-notification',
        agentId,
        skipAttachments: true,
        priority: 'next',
        ...(opts.passive === true ? { passive: true } : {}),
      },
      { turnAttribution: 'inherit' },
    )
    return 'delivered'
  } catch {
    try {
      enqueuePendingNotification(
        {
          value: `<${TASK_NOTIFICATION_TAG}>
<${TOOL_USE_ID_TAG}>${escapeXml(opts.toolUseId)}</${TOOL_USE_ID_TAG}>
<${TASK_TYPE_TAG}>tool_call</${TASK_TYPE_TAG}>
<${STATUS_TAG}>${xmlStatus}</${STATUS_TAG}>
<${SUMMARY_TAG}>${escapeXml(`${summary} The result could not be rendered.`)}</${SUMMARY_TAG}>
</${TASK_NOTIFICATION_TAG}>`,
          mode: 'task-notification',
          agentId,
          skipAttachments: true,
          priority: 'next',
          ...(opts.passive === true ? { passive: true } : {}),
        },
        { turnAttribution: 'inherit' },
      )
      return 'degraded'
    } catch {
      return 'dropped'
    }
  }
}
