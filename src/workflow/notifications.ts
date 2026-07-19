/**
 * Bridge for workflow status-change notifications.
 *
 * The engine emits events via progressEmitter.emit({ type: 'run_done', ... }),
 * and the progress/store reducer records the status into RunProgress. But the
 * old implementation had no code bridging status transitions to the host
 * notification mechanism — the "notifies automatically on completion" promise
 * in WorkflowTool's return text went unfulfilled.
 *
 * This module subscribes to WorkflowService.subscribe, watches status transitions
 * from running → completed/failed/killed, and emits a host notification via the
 * injected notifier callback (defaults to enqueuePendingNotification task-notification mode).
 */
import {
  STATUS_TAG,
  SUMMARY_TAG,
  TASK_ID_TAG,
  TASK_NOTIFICATION_TAG,
  TASK_TYPE_TAG,
} from '../constants/xml.js'
import type { AgentId } from '../types/ids.js'
import { asAgentId } from '../types/ids.js'
import { enqueuePendingNotification } from '../utils/messageQueueManager.js'
import type { RunProgress } from './progress/store.js'
import type { WorkflowService } from './service.js'

const WORKFLOW_TASK_TYPE = 'local_workflow'

/**
 * Official Hao/Jeo queue meta for a workflow run.
 * - taskId: LocalWorkflowTask panel id (reason is `workflow:${taskId}`)
 * - agentId: owner local_agent id (Jeo matches cmd.agentId === owner)
 * runId may differ from taskId on resumeFromRunId — always stamp panel taskId.
 */
export type WorkflowNotifyMeta = {
  taskId: string
  agentId?: string
}

/** runId → panel taskId + owner for Jeo undrained-notification keep. */
const workflowNotifyMetaByRunId = new Map<string, WorkflowNotifyMeta>()

/** Register at taskRegistrar.register; cleared after terminal enqueue. */
export function registerWorkflowNotifyMeta(
  runId: string,
  meta: WorkflowNotifyMeta,
): void {
  workflowNotifyMetaByRunId.set(runId, meta)
}

export function clearWorkflowNotifyMeta(runId: string): void {
  workflowNotifyMetaByRunId.delete(runId)
}

export function getWorkflowNotifyMeta(
  runId: string,
): WorkflowNotifyMeta | undefined {
  return workflowNotifyMetaByRunId.get(runId)
}

/** Notifier abstraction (lets tests inject a spy). */
export type WorkflowNotifier = (
  message: string,
  runId?: string,
  meta?: WorkflowNotifyMeta,
) => void

const TERMINAL_STATUSES: ReadonlySet<RunProgress['status']> = new Set([
  'completed',
  'failed',
  'killed',
])

/** Default notifier: uses the host message queue's task-notification mode. */
const defaultNotifier: WorkflowNotifier = (message, runId, meta) => {
  const resolved = meta ?? (runId ? workflowNotifyMetaByRunId.get(runId) : undefined)
  const taskId = resolved?.taskId ?? runId
  const owner = resolved?.agentId
  const agentId: AgentId | undefined = owner ? asAgentId(owner) : undefined
  enqueuePendingNotification({
    value: message,
    mode: 'task-notification',
    // Official Jeo: taskId = child panel id, agentId = owner (Hao/BRt stamp).
    ...(taskId ? { taskId } : {}),
    ...(agentId ? { agentId } : {}),
  })
  if (runId) clearWorkflowNotifyMeta(runId)
}

export function installWorkflowNotifications(
  service: WorkflowService,
  notify: WorkflowNotifier = defaultNotifier,
): () => void {
  const prevStatus = new Map<string, RunProgress['status'] | undefined>()

  const unsubscribe = service.subscribe(() => {
    const runs = service.listRuns()
    for (const run of runs) {
      const prev = prevStatus.get(run.runId)
      // First time seeing this run: just record the current status without notifying
      // (avoids treating existing historical runs as new notifications on install)
      if (prev === undefined) {
        prevStatus.set(run.runId, run.status)
        continue
      }
      // Status changed + entered terminal state → emit notification
      if (prev !== run.status && TERMINAL_STATUSES.has(run.status)) {
        const meta = workflowNotifyMetaByRunId.get(run.runId)
        notify(
          buildMessage(run, meta?.taskId),
          run.runId,
          meta,
        )
      }
      prevStatus.set(run.runId, run.status)
    }
  })

  return () => {
    unsubscribe()
    prevStatus.clear()
  }
}

/**
 * Build host notification XML. Prefer panel LocalWorkflowTask id when known
 * (resume runId may differ); fall back to runId for historical / unbound runs.
 */
function buildMessage(run: RunProgress, panelTaskId?: string): string {
  const statusText =
    run.status === 'completed'
      ? 'completed successfully'
      : run.status === 'failed'
        ? 'failed'
        : 'was stopped'
  const errorSuffix =
    run.status === 'failed' && run.error ? `: ${run.error}` : ''
  const summary = `Workflow "${run.workflowName}" ${statusText}${errorSuffix}`
  const taskIdForXml = panelTaskId ?? run.runId

  return `<${TASK_NOTIFICATION_TAG}>
<${TASK_ID_TAG}>${taskIdForXml}</${TASK_ID_TAG}>
<${TASK_TYPE_TAG}>${WORKFLOW_TASK_TYPE}</${TASK_TYPE_TAG}>
<${STATUS_TAG}>${run.status}</${STATUS_TAG}>
<${SUMMARY_TAG}>${summary}</${SUMMARY_TAG}>
</${TASK_NOTIFICATION_TAG}>`
}
