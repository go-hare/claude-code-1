// Union of all concrete task state types
// Use this for components that need to work with any task type

import type { TaskStateBase } from '../Task.js'
import type { AutoModeScanTaskState } from './AutoModeScanTask/AutoModeScanTask.js'
import type { DreamTaskState } from './DreamTask/DreamTask.js'
import type { InProcessTeammateTaskState } from './InProcessTeammateTask/types.js'
import type { LocalAgentTaskState } from './LocalAgentTask/LocalAgentTask.js'
import type { LocalShellTaskState } from './LocalShellTask/guards.js'
import type { LocalWorkflowTaskState } from './LocalWorkflowTask/LocalWorkflowTask.js'
import type { McpTaskState } from './McpTask/McpTask.js'
import type { MonitorMcpTaskState } from './MonitorMcpTask/MonitorMcpTask.js'
import type { MonitorWsTaskState } from './MonitorWsTask/MonitorWsTask.js'
import type { RemoteAgentTaskState } from './RemoteAgentTask/RemoteAgentTask.js'

/** Official 2.1.328 (`chunk@292558663.js @1219`): background local memory import task. */
export type LocalMemoryImportTaskState = TaskStateBase & {
  type: 'local_memory_import'
  skipTranscript?: boolean
  abortController?: AbortController
}

/** Official 2.1.328 (`chunk@305771189.js @3912`): ambient post-turn memory extraction task. */
export type PostTurnMemoryTaskState = TaskStateBase & {
  type: 'post_turn_memory'
  skipTranscript?: boolean
  abortController?: AbortController
}

export type AmbientMemoryTaskState =
  | LocalMemoryImportTaskState
  | PostTurnMemoryTaskState

export type TaskState =
  | LocalShellTaskState
  | LocalAgentTaskState
  | RemoteAgentTaskState
  | InProcessTeammateTaskState
  | LocalWorkflowTaskState
  | MonitorMcpTaskState
  | McpTaskState
  | MonitorWsTaskState
  | DreamTaskState
  | AutoModeScanTaskState

/** Full task state union including ambient memory tasks (local_memory_import, post_turn_memory). */
export type AnyTaskState = TaskState | AmbientMemoryTaskState

// Task types that can appear in the background tasks indicator
export type BackgroundTaskState =
  | LocalShellTaskState
  | LocalAgentTaskState
  | RemoteAgentTaskState
  | InProcessTeammateTaskState
  | LocalWorkflowTaskState
  | MonitorMcpTaskState
  | McpTaskState
  | MonitorWsTaskState
  | DreamTaskState
  | AutoModeScanTaskState

/**
 * Check if a task should be shown in the background tasks indicator.
 * A task is considered a background task if:
 * 1. It is not an ambient memory task (local_memory_import / post_turn_memory)
 * 2. It is running or pending
 * 3. It has been explicitly backgrounded (not a foreground task)
 */
export function isBackgroundTask(
  task: AnyTaskState,
): task is BackgroundTaskState {
  if (task.type === 'local_memory_import' || task.type === 'post_turn_memory') {
    return false
  }
  if (task.status !== 'running' && task.status !== 'pending') {
    return false
  }
  // Foreground tasks (isBackgrounded === false) are not yet "background tasks"
  if ('isBackgrounded' in task && task.isBackgrounded === false) {
    return false
  }
  return true
}
