/**
 * Official SAo / RAo / AAo portable — task-notification for adopt resume failures.
 * Also Ebn portable base used by orphan SAf/EAf/vAf/Iqb (optional status/output-file).
 *
 * Official SAo(e,t,r=mi()): enqueue task-notification XML (failed) for taskId e
 * with summary t, targeted at agentId r (default main session).
 * RAo wraps agent "could not be resumed"; AAo wraps workflow with optional
 * manual Workflow({scriptPath, resumeFromRunId}) hint.
 */

import {
  OUTPUT_FILE_TAG,
  STATUS_TAG,
  SUMMARY_TAG,
  TASK_ID_TAG,
  TASK_NOTIFICATION_TAG,
  TOOL_USE_ID_TAG,
} from '../constants/xml.js'
import { asAgentId } from '../types/ids.js'
import { enqueuePendingNotification } from './messageQueueManager.js'

function escapeXmlText(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Official Ebn / SAo base — queue a task-notification with optional status and
 * output-file tags. When status is omitted (SAf restart path), no <status>
 * is written. SDK terminate emit only when status is a terminal string.
 */
export function notifyTaskNotification(opts: {
  taskId: string
  summary: string
  /** Official Ebn `t` — omit for SAf (restarted, still running). */
  status?: string
  outputFile?: string
  /**
   * Official Hqb/Dqb QO tool-use-id tag. Optional — agent SAf/EAf omit it.
   */
  toolUseId?: string
  /** Notify target agentId (default main session). */
  agentId?: string
  /**
   * When true (default if status set), also emitTaskTerminatedSdk.
   * SAf (no status) skips SDK terminate.
   */
  emitSdk?: boolean
}): string {
  const safeId = escapeXmlText(opts.taskId)
  const safeSummary = escapeXmlText(opts.summary)
  const toolUseLine =
    opts.toolUseId !== undefined && opts.toolUseId.length > 0
      ? `\n<${TOOL_USE_ID_TAG}>${escapeXmlText(opts.toolUseId)}</${TOOL_USE_ID_TAG}>`
      : ''
  const outputLine =
    opts.outputFile !== undefined && opts.outputFile.length > 0
      ? `\n<${OUTPUT_FILE_TAG}>${escapeXmlText(opts.outputFile)}</${OUTPUT_FILE_TAG}>`
      : ''
  const statusLine =
    opts.status !== undefined
      ? `\n<${STATUS_TAG}>${escapeXmlText(opts.status)}</${STATUS_TAG}>`
      : ''
  // Official order: task-id, tool-use-id (Hqb/Dqb), output-file, status, summary
  const message = `<${TASK_NOTIFICATION_TAG}>
<${TASK_ID_TAG}>${safeId}</${TASK_ID_TAG}>${toolUseLine}${outputLine}${statusLine}
<${SUMMARY_TAG}>${safeSummary}</${SUMMARY_TAG}>
</${TASK_NOTIFICATION_TAG}>`

  let targetAgentId = opts.agentId
  if (targetAgentId === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getSessionId } =
        require('../bootstrap/state.js') as typeof import('../bootstrap/state.js')
      targetAgentId = getSessionId()
    } catch {
      targetAgentId = undefined
    }
  }

  try {
    enqueuePendingNotification({
      value: message,
      mode: 'task-notification',
      agentId:
        targetAgentId !== undefined ? asAgentId(targetAgentId) : undefined,
      // Official SAo/Ebn uses priority "next".
      priority: 'next',
    })
  } catch {
    // best-effort — rehydrate must not throw on notify fail
  }

  const terminalSdk =
    opts.status === 'failed' ||
    opts.status === 'stopped' ||
    opts.status === 'completed'
  const shouldEmitSdk = opts.emitSdk !== undefined ? opts.emitSdk : terminalSdk
  if (shouldEmitSdk && terminalSdk && opts.status) {
    try {
      // Official lf — toolUseId/outputFile/summary on SDK task_notification.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { emitTaskTerminatedSdk } =
        require('./sdkEventQueue.js') as typeof import('./sdkEventQueue.js')
      emitTaskTerminatedSdk(
        opts.taskId,
        opts.status as 'failed' | 'stopped' | 'completed',
        {
          summary: opts.summary,
          toolUseId: opts.toolUseId,
          outputFile: opts.outputFile,
        },
      )
    } catch {
      // best-effort
    }
  }
  return message
}

/**
 * Official SAo — queue a failed task-notification for adopt resume failures.
 * Returns the message body for tests.
 */
export function notifyAdoptTaskFailed(
  taskId: string,
  summary: string,
  agentId?: string,
): string {
  return notifyTaskNotification({
    taskId,
    summary,
    status: 'failed',
    agentId,
  })
}

/** Official RAo — agent could not be resumed. */
export function notifyAdoptAgentFailed(
  entry: {
    agentId: string
    description?: string
    parentAgentId?: string
  },
  reason: string,
  opts?: { parentRegistered?: boolean },
): string {
  const desc = entry.description ?? entry.agentId
  const summary = `Background agent "${desc}" was checkpointed for the background fork but could not be resumed (${reason}).`
  // Official: notify parent if registered, else main session.
  const target =
    entry.parentAgentId !== undefined && opts?.parentRegistered
      ? entry.parentAgentId
      : undefined
  return notifyAdoptTaskFailed(entry.agentId, summary, target)
}

/**
 * Official Ul subset used in AAo hint (escapes & < > only — not quotes).
 * Paths with `'` would break the single-quoted hint; strip them portably.
 */
function ulLite(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/'/g, '')
}

/** Official AAo — workflow could not be resumed (+ optional manual resume hint). */
export function notifyAdoptWorkflowFailed(
  entry: {
    taskId: string
    description?: string
    scriptPath?: string
    workflowRunId?: string
  },
  reason: string,
): string {
  // Official Ul(description); fall back to taskId when description missing.
  const desc = entry.description ?? entry.taskId
  let hint = ''
  // Official: only when scriptPath is defined (post-i4d success path).
  if (entry.scriptPath !== undefined && entry.workflowRunId !== undefined) {
    const sp = ulLite(entry.scriptPath)
    const rid = ulLite(entry.workflowRunId)
    hint = ` To resume manually: Workflow({scriptPath: '${sp}', resumeFromRunId: '${rid}'}).`
  }
  const summary = `Background workflow "${desc}" was checkpointed for the background fork but could not be resumed (${reason}).${hint}`
  return notifyAdoptTaskFailed(entry.taskId, summary)
}
