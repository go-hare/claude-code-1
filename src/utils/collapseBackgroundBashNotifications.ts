import {
  STATUS_TAG,
  SUMMARY_TAG,
  TASK_NOTIFICATION_TAG,
} from '../constants/xml.js'
import { BACKGROUND_BASH_SUMMARY_PREFIX } from '../tasks/LocalShellTask/LocalShellTask.js'
import type {
  NormalizedUserMessage,
  RenderableMessage,
} from '../types/message.js'
import { registerBriefBashNotificationCount } from './focusTranscript.js'
import { isFullscreenEnvEnabled } from './fullscreen.js'
import { extractTag } from './messages.js'

/** densable `ePn` — RemoteAgentTask completion summaries. */
export const REMOTE_TASK_SUMMARY_PREFIX = 'Remote task "'

export type TaskNotificationCollapseKind = 'bash' | 'remote'

function collapseKindFromSummary(
  summary: string | null,
): TaskNotificationCollapseKind | null {
  // densable Vbr: reject empty summary or nested `<` tags inside <summary>.
  if (!summary || summary.includes('<')) return null
  if (summary.startsWith(BACKGROUND_BASH_SUMMARY_PREFIX)) return 'bash'
  // densable vfn: Dve bash, ePn remote. Monitor stream events have no <status>
  // and never match; Monitor "…" stream ended uses a different prefix.
  if (summary.startsWith(REMOTE_TASK_SUMMARY_PREFIX)) return 'remote'
  return null
}

function extractStrictTaskNotificationEnvelope(text: string): string | null {
  const trimmed = text.trimStart()
  if (!trimmed.startsWith(`<${TASK_NOTIFICATION_TAG}`)) return null
  const closeTag = `</${TASK_NOTIFICATION_TAG}>`
  const closeIdx = trimmed.indexOf(closeTag)
  if (closeIdx === -1) return null
  const block = trimmed.slice(0, closeIdx + closeTag.length)
  if (trimmed.slice(block.length).trim() !== '') return null
  return block
}

function isCompletedCollapsibleNotification(
  msg: RenderableMessage,
): msg is NormalizedUserMessage {
  return completedTaskNotificationKind(msg) !== null
}

function completedTaskNotificationKind(
  msg: RenderableMessage,
): TaskNotificationCollapseKind | null {
  if (msg.type !== 'user') return null
  if (msg.origin && msg.origin.kind !== 'task-notification') return null
  const content0 = Array.isArray(msg.message.content)
    ? msg.message.content[0]
    : undefined
  if (!content0 || typeof content0 === 'string' || content0?.type !== 'text') {
    return null
  }
  const envelope = extractStrictTaskNotificationEnvelope(content0.text)
  if (envelope === null) return null
  // Only collapse successful completions — failed/killed stay visible individually.
  if (extractTag(envelope, STATUS_TAG) !== 'completed') return null
  return collapseKindFromSummary(extractTag(envelope, SUMMARY_TAG))
}

/**
 * densable `mMr` — collapse consecutive completed-background-bash *or* remote-task
 * task-notifications into a single synthetic count row. Failed/killed tasks
 * and agent/workflow/monitor notifications are left alone. Monitor stream
 * events (enqueueStreamEvent) have no <status> tag and never match.
 *
 * Pass-through in verbose mode so ctrl+O shows each completion.
 */
export function collapseBackgroundBashNotifications(
  messages: RenderableMessage[],
  verbose: boolean,
): RenderableMessage[] {
  if (!isFullscreenEnvEnabled()) return messages
  if (verbose) return messages

  const result: RenderableMessage[] = []
  let i = 0

  while (i < messages.length) {
    const msg = messages[i]!
    if (isCompletedCollapsibleNotification(msg)) {
      const kind = completedTaskNotificationKind(msg)
      if (kind === null) {
        result.push(msg)
        i++
        continue
      }
      let count = 0
      while (
        i < messages.length &&
        completedTaskNotificationKind(messages[i]!) === kind
      ) {
        count++
        i++
      }
      if (count === 1) {
        result.push(msg)
      } else {
        // Synthesize a task-notification that UserAgentNotificationMessage
        // already knows how to render — no new renderer needed.
        // Bash multi-count is registered so focus transcript folds N rows.
        const summary =
          kind === 'bash'
            ? `${count} background commands completed`
            : `${count} remote tasks completed`
        const synthetic: NormalizedUserMessage = {
          ...msg,
          message: {
            role: 'user',
            content: [
              {
                type: 'text' as const,
                text: `<${TASK_NOTIFICATION_TAG}><${STATUS_TAG}>completed</${STATUS_TAG}><${SUMMARY_TAG}>${summary}</${SUMMARY_TAG}></${TASK_NOTIFICATION_TAG}>`,
              },
            ],
          },
        }
        if (kind === 'bash') {
          registerBriefBashNotificationCount(synthetic, count)
        }
        result.push(synthetic)
      }
    } else {
      result.push(msg)
      i++
    }
  }

  return result
}
