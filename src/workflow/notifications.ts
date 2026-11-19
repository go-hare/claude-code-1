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
import { escapeXml } from '../utils/xml.js'
import type { RunProgress } from './progress/store.js'
import type { WorkflowService } from './service.js'

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
  const cacheSummary = formatWorkflowResumeCacheSummary(run)
  const cacheSuffix = cacheSummary ? ` (${cacheSummary})` : ''
  switch (run.status) {
    case 'completed':
      return {
        status: 'completed',
        summary: `Dynamic workflow "${name}" completed${cacheSuffix}`,
      }
    case 'failed':
      return {
        status: 'failed',
        summary: `Dynamic workflow "${name}" failed: ${run.error || 'Unknown error'}${cacheSuffix}`,
      }
    case 'killed':
      return {
        status: 'stopped',
        summary: `Dynamic workflow "${name}" was stopped${cacheSuffix}`,
      }
    default:
      return {
        status: 'stopped',
        summary: `Dynamic workflow "${name}" ended${cacheSuffix}`,
      }
  }
}

/**
 * Official 2.1.326 #121 (@305225121): Summarize how many cached agent results
 * were reused on workflow resume and where reuse stopped, instead of claiming
 * every finished agent will be reused after a call failed.
 */
export function formatWorkflowResumeCacheSummary(
  run: Pick<
    RunProgress,
    'resumeReusedCount' | 'resumeStoppedAt' | 'agents' | 'status'
  >,
): string | undefined {
  const reused = run.resumeReusedCount
  const stoppedAt = run.resumeStoppedAt
  if (reused === undefined && stoppedAt === undefined) {
    return undefined
  }
  const count = reused ?? 0
  const noun = count === 1 ? 'cached agent result' : 'cached agent results'
  if (stoppedAt) {
    const target = stoppedAt.label ? `"${stoppedAt.label}"` : 'the next call'
    const why = stoppedAt.reason ? ` (${stoppedAt.reason})` : ''
    return `Resume cache: reused ${count} ${noun}; reuse stopped at ${target}${why} — that call and every later one run again.`
  }
  return `Resume cache: reused ${count} ${noun}.`
}

/**
 * densable MP6 + Official 2.1.326 #121 (@305225121): Recovery block for
 * failed/killed runs when scriptPath is known. Explains accurate cache-reuse
 * boundaries (up to the first failed or changed call) rather than promising
 * every finished agent will be reused.
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
  const cacheSummary = formatWorkflowResumeCacheSummary(run)
  const reuseClause =
    'agent() calls replay from cache up to the first one that failed or no longer matches (edited, added, removed, or in a different call order); that call and every later one run again. A call a usage limit refused usually runs again without ending reuse: finished calls after it still come from cache.'
  const base = `To resume after editing the script, call: Workflow({scriptPath: '${run.scriptPath}', resumeFromRunId: '${run.runId}'${argsPart}}) — ${reuseClause}`
  return cacheSummary ? `${cacheSummary}\n${base}` : base
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
  enqueue?: (msg: string) => void,
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
      const xml = buildNotificationXml({
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
      })
      if (enqueue !== undefined) {
        enqueue(xml)
      } else {
        enqueuePendingNotification(
          {
            value: xml,
            mode: 'task-notification',
            priority: 'next',
            skipAttachments: true,
            taskId: run.runId,
            usage: {
              totalTokens,
              toolUses,
              durationMs,
            },
          },
          { turnAttribution: 'inherit' },
        )
      }

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
