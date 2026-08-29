/**
 * densable Dag / Nfc / lhs / hy0 — auto_mode_scan background task.
 * Gold: gold-wide-Dag.txt · gold-function_lhs_-0.txt
 *
 * Gold lhs calls Xg(taskId, status, {skipTranscript:!0}) after a running →
 * completed|failed transition. Tip has no Xg; the product equivalent is
 * enqueuePendingNotification with a task-notification XML. skipTranscript
 * is already stamped on the task state — QueuedCommand has no such field.
 */
import type { SetAppState, Task, TaskStateBase } from '../../Task.js'
import { createTaskStateBase, generateTaskId } from '../../Task.js'
import {
  OUTPUT_FILE_TAG,
  STATUS_TAG,
  SUMMARY_TAG,
  TASK_ID_TAG,
  TASK_NOTIFICATION_TAG,
  TASK_TYPE_TAG,
} from '../../constants/xml.js'
import { enqueuePendingNotification } from '../../utils/messageQueueManager.js'
import { registerTask, updateTaskState } from '../../utils/task/framework.js'
import { getTaskOutputPath } from '../../utils/task/diskOutput.js'

export type AutoModeScanTaskState = TaskStateBase & {
  type: 'auto_mode_scan'
  /** densable skipTranscript:!0 */
  skipTranscript: true
  gathersFromGitHubOrg: boolean
  abortController?: AbortController
}

export function isAutoModeScanTask(
  task: unknown,
): task is AutoModeScanTaskState {
  return (
    typeof task === 'object' &&
    task !== null &&
    'type' in task &&
    (task as { type: unknown }).type === 'auto_mode_scan'
  )
}

/** densable Nfc — any running auto_mode_scan */
export function findRunningAutoModeScan(
  tasks: Record<string, { type?: string; status?: string }>,
): AutoModeScanTaskState | undefined {
  for (const task of Object.values(tasks)) {
    if (isAutoModeScanTask(task) && task.status === 'running') {
      return task
    }
  }
  return undefined
}

/** densable Dag */
export function registerAutoModeScanTask(
  setAppState: SetAppState,
  opts: {
    abortController: AbortController
    gathersFromGitHubOrg: boolean
  },
): string {
  const id = generateTaskId('auto_mode_scan')
  const task: AutoModeScanTaskState = {
    ...createTaskStateBase(
      id,
      'auto_mode_scan',
      'scanning for auto-mode setup',
    ),
    type: 'auto_mode_scan',
    status: 'running',
    skipTranscript: true,
    gathersFromGitHubOrg: opts.gathersFromGitHubOrg,
    abortController: opts.abortController,
  }
  registerTask(task, setAppState)
  return id
}

/** densable lhs — only transitions running → completed|failed, then Xg-equivalent */
export function finishAutoModeScanTask(
  taskId: string,
  setAppState: SetAppState,
  status: 'completed' | 'failed',
): boolean {
  let transitioned = false
  updateTaskState<AutoModeScanTaskState>(taskId, setAppState, task => {
    if (task.status !== 'running') return task
    transitioned = true
    return {
      ...task,
      status,
      endTime: Date.now(),
      notified: true,
      abortController: undefined,
    }
  })
  if (transitioned) {
    const statusText =
      status === 'completed' ? 'completed successfully' : 'failed'
    const outputPath = getTaskOutputPath(taskId)
    const message = `<${TASK_NOTIFICATION_TAG}>
<${TASK_ID_TAG}>${taskId}</${TASK_ID_TAG}>
<${TASK_TYPE_TAG}>auto_mode_scan</${TASK_TYPE_TAG}>
<${OUTPUT_FILE_TAG}>${outputPath}</${OUTPUT_FILE_TAG}>
<${STATUS_TAG}>${status}</${STATUS_TAG}>
<${SUMMARY_TAG}>Task "scanning for auto-mode setup" ${statusText}</${SUMMARY_TAG}>
</${TASK_NOTIFICATION_TAG}>`
    enqueuePendingNotification({ value: message, mode: 'task-notification' })
  }
  return transitioned
}

export const AutoModeScanTask: Task = {
  name: 'AutoModeScanTask',
  type: 'auto_mode_scan',

  async kill(taskId, setAppState) {
    updateTaskState<AutoModeScanTaskState>(taskId, setAppState, task => {
      if (task.status !== 'running') return task
      task.abortController?.abort()
      return {
        ...task,
        status: 'killed',
        endTime: Date.now(),
        notified: true,
        abortController: undefined,
      }
    })
  },
}
