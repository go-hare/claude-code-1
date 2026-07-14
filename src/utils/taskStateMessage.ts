import { randomUUID } from 'crypto'
import type { SDKMessage } from 'src/entrypoints/agentSdkTypes.js'
import type { Task } from './tasks.js'

export type TaskStateItem = Pick<
  Task,
  | 'id'
  | 'subject'
  | 'description'
  | 'activeForm'
  | 'status'
  | 'owner'
  | 'blocks'
  | 'blockedBy'
>

export type TaskStateMessage = SDKMessage & {
  type: 'task_state'
  uuid: string
  task_list_id: string
  tasks: TaskStateItem[]
}

export type TaskStateSnapshot = Pick<TaskStateMessage, 'task_list_id' | 'tasks'>

function toTaskStateItem(task: Task): TaskStateItem {
  return {
    id: task.id,
    subject: task.subject,
    description: task.description,
    activeForm: task.activeForm,
    status: task.status,
    owner: task.owner,
    blocks: [...task.blocks],
    blockedBy: [...task.blockedBy],
  }
}

function compareTaskStateItems(a: TaskStateItem, b: TaskStateItem): number {
  return a.id.localeCompare(b.id)
}

export function buildTaskStateSnapshot(
  taskListId: string,
  tasks: Task[],
): TaskStateSnapshot {
  return {
    task_list_id: taskListId,
    tasks: tasks
      .filter(task => !task.metadata?._internal)
      .map(toTaskStateItem)
      .sort(compareTaskStateItems),
  }
}

export function getTaskStateSnapshotKey(
  taskListId: string,
  tasks: Task[],
): string {
  return JSON.stringify(buildTaskStateSnapshot(taskListId, tasks))
}

/**
 * Official 2.1.207 intent: after reconnect / credential refresh the remote
 * client can lose ephemeral task status even when the local snapshot key and
 * handle identity are unchanged. `force` bypasses dedupe so the full list is
 * re-published on the wire.
 */
export function shouldPublishTaskState(opts: {
  snapshotKey: string
  handle: unknown
  lastSnapshotKey: string | null
  lastHandle: unknown
  force?: boolean
}): boolean {
  if (opts.force) return true
  return !(
    opts.snapshotKey === opts.lastSnapshotKey && opts.handle === opts.lastHandle
  )
}

export function buildTaskStateMessage(
  taskListId: string,
  tasks: Task[],
): TaskStateMessage {
  const snapshot = buildTaskStateSnapshot(taskListId, tasks)
  return {
    type: 'task_state',
    uuid: randomUUID(),
    ...snapshot,
  }
}
