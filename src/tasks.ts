import { feature } from 'bun:bundle'
import type { Task, TaskStateBase, TaskType } from './Task.js'
import { AutoModeScanTask } from './tasks/AutoModeScanTask/AutoModeScanTask.js'
import { DreamTask } from './tasks/DreamTask/DreamTask.js'
import { LocalAgentTask } from './tasks/LocalAgentTask/LocalAgentTask.js'
import { LocalShellTask } from './tasks/LocalShellTask/LocalShellTask.js'
import { RemoteAgentTask } from './tasks/RemoteAgentTask/RemoteAgentTask.js'
import { emitTaskTerminatedSdk } from './utils/sdkEventQueue.js'

/**
 * Official 2.1.331 `Ar = { kill: Ir }` in `N3e` (@325127100):
 * Minimal kill handler for `post_turn_memory` ambient tasks.
 */
const PostTurnMemoryTask: Task = {
  name: 'PostTurnMemoryTask',
  type: 'post_turn_memory',
  async kill(taskId, registry) {
    let killed = false
    registry.update(taskId, task => {
      if (task.status !== 'running') return task
      const abortable = task as TaskStateBase & {
        abortController?: AbortController
      }
      abortable.abortController?.abort()
      killed = true
      return {
        ...task,
        status: 'killed',
        endTime: Date.now(),
        notified: true,
        abortController: undefined,
      }
    })
    if (killed) {
      emitTaskTerminatedSdk(taskId, 'stopped', {
        skipTranscript: true,
        ambient: true,
      })
    }
  },
}

/**
 * Get all tasks.
 * Mirrors the pattern from tools.ts
 * Note: Resolves tasks lazily inside getAllTasks() to avoid circular ESM/CJS TDZ
 * issues when task implementations (e.g. McpTask, InProcessTeammateTask)
 * transitively import tasks.ts.
 */
export function getAllTasks(): Task[] {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const InProcessTeammateTask: Task =
    require('./tasks/InProcessTeammateTask/InProcessTeammateTask.js').InProcessTeammateTask
  const LocalWorkflowTask: Task | null = feature('WORKFLOW_SCRIPTS')
    ? require('./tasks/LocalWorkflowTask/LocalWorkflowTask.js')
        .LocalWorkflowTask
    : null
  const MonitorMcpTask: Task | null = feature('MONITOR_TOOL')
    ? require('./tasks/MonitorMcpTask/MonitorMcpTask.js').MonitorMcpTask
    : null
  const MonitorWsTask: Task =
    require('./tasks/MonitorWsTask/MonitorWsTask.js').MonitorWsTask
  const McpTask: Task = require('./tasks/McpTask/McpTask.js').McpTask
  /* eslint-enable @typescript-eslint/no-require-imports */

  const tasks: Task[] = [
    LocalShellTask,
    LocalAgentTask,
    RemoteAgentTask,
    InProcessTeammateTask,
    DreamTask,
    AutoModeScanTask,
    PostTurnMemoryTask,
    MonitorWsTask,
    McpTask,
  ]
  if (LocalWorkflowTask) tasks.push(LocalWorkflowTask)
  if (MonitorMcpTask) tasks.push(MonitorMcpTask)
  return tasks
}

/**
 * Get a task by its type.
 */
export function getTaskByType(type: TaskType): Task | undefined {
  return getAllTasks().find(t => t.type === type)
}
