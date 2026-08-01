// Listens to WorkflowService state changes and, when a run transitions from
// running → terminal, injects a <task-notification> so the main agent knows
// the workflow finished (mirrors LocalAgentTask / LocalShellTask).
// densable MP6: include usage (agent_count / total_tokens / tool_uses / duration_ms)
// and recovery hint when scriptPath + workflowRunId are available.
//
// Why not put this in the tool's finally block: the tool returns immediately
// after launch; the run finishes asynchronously in the background. The service
// is the only place that sees the full lifecycle.

import {
  OUTPUT_FILE_TAG,
  STATUS_TAG,
  SUMMARY_TAG,
  TASK_ID_TAG,
  TASK_NOTIFICATION_TAG,
  TOOL_USE_ID_TAG,
} from '../constants/xml.js'
import { getTaskOutputPath } from '../utils/task/diskOutput.js'
import { enqueuePendingNotification } from '../utils/messageQueueManager.js'
import type { RunProgress } from './progress/store.js'
import type { WorkflowService } from './service.js'

function escapeXml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function buildNotificationXml(opts: {
  taskId: string
  toolUseId?: string
  status: 'completed' | 'failed' | 'stopped'
  summary: string
  agentCount: number
  totalTokens: number
  toolUses: number
  durationMs: number
  recovery?: string
  resultPreview?: string
  failures?: string
}): string {
  const toolUse =
    opts.toolUseId !== undefined
      ? `\n<${TOOL_USE_ID_TAG}>${escapeXml(opts.toolUseId)}</${TOOL_USE_ID_TAG}>`
      : ''
  const recovery = opts.recovery
    ? `\n<recovery>${escapeXml(opts.recovery)}</recovery>`
    : ''
  const result =
    opts.resultPreview !== undefined
      ? `\n<result>${escapeXml(opts.resultPreview)}</result>`
      : ''
  const failures = opts.failures
    ? `\n<failures>${escapeXml(opts.failures)}</failures>`
    : ''
  const usage = `\n<usage><agent_count>${opts.agentCount}</agent_count><total_tokens>${opts.totalTokens}</total_tokens><tool_uses>${opts.toolUses}</tool_uses><duration_ms>${opts.durationMs}</duration_ms></usage>`
  return `<${TASK_NOTIFICATION_TAG}>
<${TASK_ID_TAG}>${escapeXml(opts.taskId)}</${TASK_ID_TAG}>${toolUse}
<${OUTPUT_FILE_TAG}>${escapeXml(getTaskOutputPath(opts.taskId))}</${OUTPUT_FILE_TAG}>
<${STATUS_TAG}>${opts.status}</${STATUS_TAG}>
<${SUMMARY_TAG}>${escapeXml(opts.summary)}</${SUMMARY_TAG}>${recovery}${result}${failures}${usage}
</${TASK_NOTIFICATION_TAG}>`
}

function summarizeTerminal(run: RunProgress): {
  status: 'completed' | 'failed' | 'stopped'
  summary: string
} {
  // densable MP6 wording: completed without "successfully"; failed includes error.
  const name = run.workflowName || 'workflow'
  switch (run.status) {
    case 'completed':
      return {
        status: 'completed',
        summary: `Dynamic workflow "${name}" completed`,
      }
    case 'failed':
      return {
        status: 'failed',
        summary: `Dynamic workflow "${name}" failed: ${run.error || 'Unknown error'}`,
      }
    case 'killed':
      return {
        status: 'stopped',
        summary: `Dynamic workflow "${name}" was stopped`,
      }
    default:
      return {
        status: 'stopped',
        summary: `Dynamic workflow "${name}" ended`,
      }
  }
}

/**
 * densable MP6 recovery block for failed/killed runs when scriptPath is known.
 * `To resume after editing the script, call: Workflow({scriptPath: '...', resumeFromRunId: '...'})`
 */
export function buildRecoveryHint(run: RunProgress): string | undefined {
  if (run.status !== 'failed' && run.status !== 'killed') return undefined
  if (!run.scriptPath) return undefined
  let argsPart = ''
  if (run.args !== undefined) {
    try {
      argsPart = `, args: ${JSON.stringify(run.args)}`
    } catch {
      argsPart = ''
    }
  }
  return `To resume after editing the script, call: Workflow({scriptPath: '${run.scriptPath}', resumeFromRunId: '${run.runId}'${argsPart}})`
}

function resultPreview(run: RunProgress): string | undefined {
  if (run.status !== 'completed' || run.returnValue === undefined) {
    return undefined
  }
  try {
    const raw =
      typeof run.returnValue === 'string'
        ? run.returnValue
        : JSON.stringify(run.returnValue)
    if (raw.length <= 8000) return raw
    return `${raw.slice(0, 8000)}\n... (truncated ${raw.length - 8000} chars)`
  } catch {
    return undefined
  }
}

/**
 * Subscribes to the service; when a known run goes from running to a terminal
 * state, enqueues a task-notification (priority: next).
 * Returns an unsubscribe function.
 *
 * Note: the first snapshot is only used to seed the previous-status map so we
 * do not notify for historical runs that are already terminal at install time.
 */
export function installWorkflowNotifications(
  service: WorkflowService,
  enqueue: (msg: string) => void = msg =>
    enqueuePendingNotification({ value: msg, mode: 'task-notification' }),
): () => void {
  const prevStatus = new Map<string, RunProgress['status']>()

  // Seed: record current status without notifying
  for (const r of service.listRuns()) {
    prevStatus.set(r.runId, r.status)
  }

  return service.subscribe(() => {
    for (const run of service.listRuns()) {
      const prev = prevStatus.get(run.runId)
      prevStatus.set(run.runId, run.status)
      // Only notify on a transition from running → terminal
      if (prev !== 'running') continue
      if (
        run.status !== 'completed' &&
        run.status !== 'failed' &&
        run.status !== 'killed'
      ) {
        continue
      }
      const { status, summary } = summarizeTerminal(run)
      const durationMs = Math.max(0, run.updatedAt - run.startedAt)
      // Token/tool totals from progress store agents (mirrors task.total*).
      let totalTokens = 0
      let toolUses = 0
      for (const a of run.agents) {
        totalTokens += a.tokenCount ?? 0
        toolUses += a.toolCount ?? 0
      }
      enqueue(
        buildNotificationXml({
          taskId: run.runId,
          status,
          summary,
          agentCount: run.agentCount,
          totalTokens,
          toolUses,
          durationMs,
          recovery: buildRecoveryHint(run),
          resultPreview: resultPreview(run),
          failures: run.error,
        }),
      )

      // densable Host contract (same as Agent BRt / Shell Ovu): XML still feeds
      // the model via print.ts; dual-emit once-gated SDK task_notification so
      // Jp Tasks / Htr settle without waiting solely on XML→SDK conversion.
      // task_id = run.runId matches registerTask / task_started for local_workflow.
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { emitTaskTerminatedSdk } =
          require('../utils/sdkEventQueue.js') as typeof import('../utils/sdkEventQueue.js')
        emitTaskTerminatedSdk(run.runId, status, {
          summary,
          outputFile: getTaskOutputPath(run.runId),
          usage: {
            total_tokens: totalTokens,
            tool_uses: toolUses,
            duration_ms: durationMs,
          },
        })
      } catch {
        // best-effort — never block workflow completion on SDK bookend
      }
    }
  })
}
