/**
 * InProcessTeammateTask - Manages in-process teammate lifecycle
 *
 * This component implements the Task interface for in-process teammates.
 * Unlike LocalAgentTask (background agents), in-process teammates:
 * 1. Run in the same Node.js process using AsyncLocalStorage for isolation
 * 2. Have team-aware identity (agentName@teamName)
 * 3. Support plan mode approval flow
 * 4. Can be idle (waiting for work) or active (processing)
 */

import { isTerminalTaskStatus, type SetAppState, type Task, type TaskStateBase } from '../../Task.js';
import type { Message, MessageOrigin } from '../../types/message.js';
import { logForDebugging } from '../../utils/debug.js';
import { createUserMessage } from '../../utils/messages.js';
import { killInProcessTeammate } from '../../utils/swarm/spawnInProcess.js';
import { updateTaskState } from '../../utils/task/framework.js';
import { applyMessageToInProgressToolUseIDs, EMPTY_TASK_TRANSCRIPT } from '../../utils/taskRegistry.js';
import type { InProcessTeammateTaskState, PendingTeammateUserMessage } from './types.js';
import { appendCappedMessage, isInProcessTeammateTask } from './types.js';

/**
 * InProcessTeammateTask - Handles in-process teammate execution.
 */
export const InProcessTeammateTask: Task = {
  name: 'InProcessTeammateTask',
  type: 'in_process_teammate',
  async kill(taskId, registry) {
    killInProcessTeammate(taskId, registry);
  },
};

/**
 * Request shutdown for a teammate.
 */
export function requestTeammateShutdown(taskId: string, setAppState: SetAppState): void {
  updateTaskState<InProcessTeammateTaskState>(taskId, setAppState, task => {
    if (task.status !== 'running' || task.shutdownRequested) {
      return task;
    }

    return {
      ...task,
      shutdownRequested: true,
    };
  });
}

/**
 * Official 2.1.331 `OYr` (@342598625): append a message to a teammate's
 * conversation history in both `AppState.transcripts[taskId]` and legacy
 * `task.messages` (capped).
 */
export function appendTeammateMessage(taskId: string, message: Message, setAppState: SetAppState): void {
  setAppState(prev => {
    const task = prev.tasks[taskId];
    if (!task || !isInProcessTeammateTask(task) || task.status !== 'running') {
      return prev;
    }
    const currentTr = prev.transcripts?.[taskId] ?? EMPTY_TASK_TRANSCRIPT;
    const nextTrMessages = appendCappedMessage(currentTr.messages, message);
    const toolPatch = applyMessageToInProgressToolUseIDs(currentTr.inProgressToolUseIDs, message);
    return {
      ...prev,
      tasks: {
        ...prev.tasks,
        [taskId]: {
          ...task,
          messages: appendCappedMessage(task.messages, message),
        },
      },
      transcripts: {
        ...prev.transcripts,
        [taskId]: {
          ...currentTr,
          messages: nextTrMessages,
          ...toolPatch,
        },
      },
    };
  });
}

/**
 * Official 2.1.331 `ren` (@342598966): inject a user message to a teammate's
 * pending queue and mirror it immediately onto both `AppState.transcripts[taskId]`
 * and legacy `task.messages`.
 */
export function injectUserMessageToTeammate(
  taskId: string,
  message: string,
  options:
    | {
        autonomyRunId?: string;
        autonomyRootDir?: string;
        origin?: MessageOrigin;
      }
    | undefined,
  setAppState: SetAppState,
): boolean {
  let injected = false;
  setAppState(prev => {
    const task = prev.tasks[taskId];
    if (!task || !isInProcessTeammateTask(task)) {
      return prev;
    }
    // Allow message injection when teammate is running or idle (waiting for input)
    // Only reject if teammate is in a terminal state
    if (isTerminalTaskStatus(task.status)) {
      logForDebugging(`Dropping message for teammate task ${taskId}: task status is "${task.status}"`);
      return prev;
    }

    injected = true;

    const pendingMessage: PendingTeammateUserMessage = { message };
    if (options?.autonomyRunId !== undefined) {
      pendingMessage.autonomyRunId = options.autonomyRunId;
    }
    if (options?.autonomyRootDir !== undefined) {
      pendingMessage.autonomyRootDir = options.autonomyRootDir;
    }
    if (options?.origin !== undefined) {
      pendingMessage.origin = options.origin;
    }

    const userMessageArgs: Parameters<typeof createUserMessage>[0] = {
      content: message,
    };
    if (options?.origin !== undefined) {
      userMessageArgs.origin = options.origin;
    }
    const userMessage = createUserMessage(userMessageArgs);
    const currentTr = prev.transcripts?.[taskId] ?? EMPTY_TASK_TRANSCRIPT;

    return {
      ...prev,
      tasks: {
        ...prev.tasks,
        [taskId]: {
          ...task,
          pendingUserMessages: [...task.pendingUserMessages, pendingMessage],
          messages: appendCappedMessage(task.messages, userMessage),
        },
      },
      transcripts: {
        ...prev.transcripts,
        [taskId]: {
          ...currentTr,
          messages: appendCappedMessage(currentTr.messages, userMessage),
        },
      },
    };
  });
  return injected;
}

/**
 * Get teammate task by agent ID from AppState.
 * Prefers running tasks over killed/completed ones in case multiple tasks
 * with the same agentId exist.
 * Returns undefined if not found.
 */
export function findTeammateTaskByAgentId(
  agentId: string,
  tasks: Record<string, TaskStateBase>,
): InProcessTeammateTaskState | undefined {
  let fallback: InProcessTeammateTaskState | undefined;
  for (const task of Object.values(tasks)) {
    if (isInProcessTeammateTask(task) && task.identity.agentId === agentId) {
      // Prefer running tasks in case old killed tasks still exist in AppState
      // alongside new running ones with the same agentId
      if (task.status === 'running') {
        return task;
      }
      // Keep first match as fallback in case no running task exists
      if (!fallback) {
        fallback = task;
      }
    }
  }
  return fallback;
}

/**
 * Get all in-process teammate tasks from AppState.
 */
export function getAllInProcessTeammateTasks(tasks: Record<string, TaskStateBase>): InProcessTeammateTaskState[] {
  return Object.values(tasks).filter(isInProcessTeammateTask);
}

/**
 * Get running in-process teammates sorted alphabetically by agentName.
 * Shared between TeammateSpinnerTree display, PromptInput footer selector,
 * and useBackgroundTaskNavigation — selectedIPAgentIndex maps into this
 * array, so all three must agree on sort order.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional ASCII-range check for mYe comparator
const ASCII_NAME_RE = /^[\x00-\x7f]*$/;

function compareAsciiFirst(a: string, b: string): number {
  const aAscii = ASCII_NAME_RE.test(a);
  if (aAscii !== ASCII_NAME_RE.test(b)) return aAscii ? -1 : 1;
  if (aAscii) return a.localeCompare(b);
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

export function getRunningTeammatesSorted(tasks: Record<string, TaskStateBase>): InProcessTeammateTaskState[] {
  return getAllInProcessTeammateTasks(tasks)
    .filter(t => t.status === 'running')
    .sort((a, b) => compareAsciiFirst(a.identity.agentName, b.identity.agentName));
}
