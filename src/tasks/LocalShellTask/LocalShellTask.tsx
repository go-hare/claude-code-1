import { feature } from 'bun:bundle';
import { stat } from 'fs/promises';
import { getIsInteractive, getLastInteractionTime, getMainLoopBusy } from '../../bootstrap/state.js';
import {
  OUTPUT_FILE_TAG,
  STATUS_TAG,
  SUMMARY_TAG,
  TASK_ID_TAG,
  TASK_NOTIFICATION_TAG,
  TOOL_USE_ID_TAG,
} from '../../constants/xml.js';
import { logEvent } from '../../services/analytics/index.js';
import { abortSpeculation } from '../../services/PromptSuggestion/speculation.js';
import type { AppState } from '../../state/AppState.js';
import type { LocalShellSpawnInput, SetAppState, Task, TaskContext, TaskHandle } from '../../Task.js';
import { createTaskStateBase } from '../../Task.js';
import type { AgentId } from '../../types/ids.js';
import { registerCleanup } from '../../utils/cleanupRegistry.js';
import { tailFile } from '../../utils/fsOperations.js';
import { logError } from '../../utils/log.js';
import { enqueuePendingNotification } from '../../utils/messageQueueManager.js';
import type { ShellCommand } from '../../utils/ShellCommand.js';
import { evictTaskOutput, getTaskOutputPath } from '../../utils/task/diskOutput.js';
import {
  addKeepaliveReason,
  bashKeepaliveReason,
  monitorKeepaliveReason,
  registerTask,
  removeKeepaliveReason,
  updateTaskState,
} from '../../utils/task/framework.js';
import { escapeXml } from '../../utils/xml.js';
import { backgroundAgentTask, isLocalAgentTask } from '../LocalAgentTask/LocalAgentTask.js';
import { isMainSessionTask } from '../LocalMainSessionTask.js';
import { type BashTaskKind, isLocalShellTask, type LocalShellTaskState } from './guards.js';
import { killTask } from './killShellTasks.js';
import {
  hasActiveAgentishTasks,
  shouldReapOnMemoryPressure,
  shouldRegisterShellPressureReap,
} from './shellPressureReap.js';

/** Prefix that identifies a LocalShellTask summary to the UI collapse transform. */
export const BACKGROUND_BASH_SUMMARY_PREFIX = 'Background command ';

/**
 * densable ZV_ — default wall-clock cap for agent-scoped background shells (1h).
 * Main-session shells (agentId undefined) get no cap.
 */
export const DEFAULT_SUBAGENT_BG_SHELL_MAX_MS = 3_600_000;

/**
 * densable fkd(agentId) — resolve capMs for agent-scoped background shells.
 * - agentId undefined (main-thread FG→BG / Ctrl+B on main): no cap
 * - agent-scoped: CLAUDE_SUBAGENT_BG_SHELL_MAX_MS || 3600000
 */
export function resolveSubagentBgShellCapMs(agentId: AgentId | undefined): number | undefined {
  if (agentId === undefined) return undefined;
  const raw = process.env.CLAUDE_SUBAGENT_BG_SHELL_MAX_MS;
  if (raw !== undefined && raw !== '') {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_SUBAGENT_BG_SHELL_MAX_MS;
}

const STALL_CHECK_INTERVAL_MS = 5_000;
const STALL_THRESHOLD_MS = 45_000;
const STALL_TAIL_BYTES = 1024;

// Last-line patterns that suggest a command is blocked waiting for keyboard
// input. Used to gate the stall notification — we stay silent on commands that
// are merely slow (git log -S, long builds) and only notify when the tail
// looks like an interactive prompt the model can act on. See CC-1175.
const PROMPT_PATTERNS = [
  /\(y\/n\)/i, // (Y/n), (y/N)
  /\[y\/n\]/i, // [Y/n], [y/N]
  /\(yes\/no\)/i,
  /\b(?:Do you|Would you|Shall I|Are you sure|Ready to)\b.*\? *$/i, // directed questions
  /Press (any key|Enter)/i,
  /Continue\?/i,
  /Overwrite\?/i,
];

export function looksLikePrompt(tail: string): boolean {
  const lastLine = tail.trimEnd().split('\n').pop() ?? '';
  return PROMPT_PATTERNS.some(p => p.test(lastLine));
}

// Output-side analog of peekForStdinData (utils/process.ts): fire a one-shot
// notification if output stops growing and the tail looks like a prompt.
function startStallWatchdog(
  taskId: string,
  description: string,
  kind: BashTaskKind | undefined,
  toolUseId?: string,
  agentId?: AgentId,
): () => void {
  if (kind === 'monitor') return () => {};
  const outputPath = getTaskOutputPath(taskId);
  let lastSize = 0;
  let lastGrowth = Date.now();
  let cancelled = false;

  const timer = setInterval(() => {
    void stat(outputPath).then(
      s => {
        if (s.size > lastSize) {
          lastSize = s.size;
          lastGrowth = Date.now();
          return;
        }
        if (Date.now() - lastGrowth < STALL_THRESHOLD_MS) return;
        void tailFile(outputPath, STALL_TAIL_BYTES).then(
          ({ content }) => {
            if (cancelled) return;
            if (!looksLikePrompt(content)) {
              // Not a prompt — keep watching. Reset so the next check is
              // 45s out instead of re-reading the tail on every tick.
              lastGrowth = Date.now();
              return;
            }
            // Latch before the async-boundary-visible side effects so an
            // overlapping tick's callback sees cancelled=true and bails.
            cancelled = true;
            clearInterval(timer);
            const toolUseIdLine = toolUseId ? `\n<${TOOL_USE_ID_TAG}>${toolUseId}</${TOOL_USE_ID_TAG}>` : '';
            const summary = `${BACKGROUND_BASH_SUMMARY_PREFIX}"${description}" appears to be waiting for interactive input`;
            // No <status> tag — print.ts treats <status> as a terminal
            // signal and an unknown value falls through to 'completed',
            // falsely closing the task for SDK consumers. Statusless
            // notifications are skipped by the SDK emitter (progress ping).
            const message = `<${TASK_NOTIFICATION_TAG}>
<${TASK_ID_TAG}>${taskId}</${TASK_ID_TAG}>${toolUseIdLine}
<${OUTPUT_FILE_TAG}>${outputPath}</${OUTPUT_FILE_TAG}>
<${SUMMARY_TAG}>${escapeXml(summary)}</${SUMMARY_TAG}>
</${TASK_NOTIFICATION_TAG}>
Last output:
${content.trimEnd()}

The command is likely blocked on an interactive prompt. Kill this task and re-run with piped input (e.g., \`echo y | command\`) or a non-interactive flag if one exists.`;
            enqueuePendingNotification({
              value: message,
              mode: 'task-notification',
              priority: 'next',
              agentId,
            });
          },
          () => {},
        );
      },
      () => {}, // File may not exist yet
    );
  }, STALL_CHECK_INTERVAL_MS);
  timer.unref();

  return () => {
    cancelled = true;
    clearInterval(timer);
  };
}

/**
 * densable Ovu / monitor Gge portable: Gge(agentId, bash|monitor:id).
 * Returns dispose that tB's the same reason (bXi releaseBgCap / result.settle).
 * densable Ovu always calls Gge (no-op when agentId undefined); !pn is only for
 * agent/workflow child holds. Main-thread shells omit agentId → no panel owner.
 */
function attachShellKeepalive(
  taskId: string,
  agentId: AgentId | undefined,
  kind: BashTaskKind | undefined,
  setAppState: SetAppState,
): () => void {
  if (!agentId) {
    return () => {};
  }
  const reason = kind === 'monitor' ? monitorKeepaliveReason(taskId) : bashKeepaliveReason(taskId);
  addKeepaliveReason(agentId, reason, setAppState);
  return () => {
    removeKeepaliveReason(agentId, reason, setAppState);
  };
}

/**
 * Official $xu — register memoryPressure listener for main-thread bg shells.
 * Returns dispose (off listener). No-op when gated off.
 */
function installShellPressureReap(
  taskId: string,
  description: string,
  getAppState: () => AppState,
  setAppState: SetAppState,
  toolUseId?: string,
  kind?: BashTaskKind,
  agentId?: AgentId,
): () => void {
  if (
    !shouldRegisterShellPressureReap({
      agentId,
      kind,
      isInteractive: getIsInteractive(),
    })
  ) {
    return () => {};
  }

  type MemoryPressureProcess = NodeJS.Process & {
    on(event: 'memoryPressure', listener: () => void): NodeJS.Process;
    off(event: 'memoryPressure', listener: () => void): NodeJS.Process;
  };
  const proc = process as MemoryPressureProcess;

  const onPressure = (): void => {
    const task = getAppState().tasks[taskId];
    if (
      !shouldReapOnMemoryPressure({
        status: task?.status,
        notified: task?.notified,
        lastInteractionTime: getLastInteractionTime(),
        mainLoopBusy: getMainLoopBusy(),
        hasActiveAgentTasks: hasActiveAgentishTasks(getAppState().tasks),
      })
    ) {
      return;
    }
    logEvent('task_local_shell_pressure_reap', {});
    // Official F9r then t5e — notify first, then kill.
    enqueueShellNotification(taskId, description, 'killed', undefined, setAppState, toolUseId, kind ?? 'bash', agentId);
    killTask(taskId, setAppState);
  };

  proc.on('memoryPressure', onPressure);
  return () => {
    proc.off('memoryPressure', onPressure);
  };
}

function enqueueShellNotification(
  taskId: string,
  description: string,
  status: 'completed' | 'failed' | 'killed',
  exitCode: number | undefined,
  setAppState: SetAppState,
  toolUseId?: string,
  kind: BashTaskKind = 'bash',
  agentId?: AgentId,
): void {
  // Atomically check and set notified flag to prevent duplicate notifications.
  // If the task was already marked as notified (e.g., by TaskStopTool), skip
  // enqueueing to avoid sending redundant messages to the model.
  let shouldEnqueue = false;
  updateTaskState(taskId, setAppState, task => {
    if (task.notified) {
      return task;
    }
    shouldEnqueue = true;
    return { ...task, notified: true };
  });

  if (!shouldEnqueue) {
    return;
  }

  // Abort any active speculation — background task state changed, so speculated
  // results may reference stale task output. The prompt suggestion text is
  // preserved; only the pre-computed response is discarded.
  abortSpeculation(setAppState);

  let summary: string;
  if (feature('MONITOR_TOOL') && kind === 'monitor') {
    // Monitor is streaming-only (post-#22764) — the script exiting means
    // the stream ended, not "condition met". Distinct from the bash prefix
    // so Monitor completions don't fold into the "N background commands
    // completed" collapse.
    switch (status) {
      case 'completed':
        summary = `Monitor "${description}" stream ended`;
        break;
      case 'failed':
        summary = `Monitor "${description}" script failed${exitCode !== undefined ? ` (exit ${exitCode})` : ''}`;
        break;
      case 'killed':
        summary = `Monitor "${description}" stopped`;
        break;
    }
  } else {
    switch (status) {
      case 'completed':
        summary = `${BACKGROUND_BASH_SUMMARY_PREFIX}"${description}" completed${exitCode !== undefined ? ` (exit code ${exitCode})` : ''}`;
        break;
      case 'failed':
        summary = `${BACKGROUND_BASH_SUMMARY_PREFIX}"${description}" failed${exitCode !== undefined ? ` with exit code ${exitCode}` : ''}`;
        break;
      case 'killed':
        summary = `${BACKGROUND_BASH_SUMMARY_PREFIX}"${description}" was stopped`;
        break;
    }
  }

  const outputPath = getTaskOutputPath(taskId);
  const toolUseIdLine = toolUseId ? `\n<${TOOL_USE_ID_TAG}>${toolUseId}</${TOOL_USE_ID_TAG}>` : '';
  const message = `<${TASK_NOTIFICATION_TAG}>
<${TASK_ID_TAG}>${taskId}</${TASK_ID_TAG}>${toolUseIdLine}
<${OUTPUT_FILE_TAG}>${outputPath}</${OUTPUT_FILE_TAG}>
<${STATUS_TAG}>${status}</${STATUS_TAG}>
<${SUMMARY_TAG}>${escapeXml(summary)}</${SUMMARY_TAG}>
</${TASK_NOTIFICATION_TAG}>`;

  enqueuePendingNotification({
    value: message,
    mode: 'task-notification',
    priority: feature('MONITOR_TOOL') ? 'next' : 'later',
    agentId,
  });

  // densable Ovu dual bookend: XML for model + once-gated SDK task_notification
  // so Host Tasks (Jp) closes without waiting for print→ask drain alone.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { emitTaskTerminatedSdk } =
      require('../../utils/sdkEventQueue.js') as typeof import('../../utils/sdkEventQueue.js');
    emitTaskTerminatedSdk(taskId, status === 'killed' ? 'stopped' : status, {
      toolUseId,
      summary,
      outputFile: outputPath,
    });
  } catch {
    // best-effort
  }
}

export const LocalShellTask: Task = {
  name: 'LocalShellTask',
  type: 'local_bash',
  async kill(taskId, setAppState) {
    killTask(taskId, setAppState);
  },
};

export async function spawnShellTask(
  input: LocalShellSpawnInput & { shellCommand: ShellCommand },
  context: TaskContext,
): Promise<TaskHandle> {
  const { command, description, shellCommand, toolUseId, agentId, kind } = input;
  const { setAppState, getAppState } = context;

  // TaskOutput owns the data — use its taskId so disk writes are consistent
  const { taskOutput } = shellCommand;
  const taskId = taskOutput.taskId;

  const unregisterCleanup = registerCleanup(async () => {
    killTask(taskId, setAppState);
  });

  const taskState: LocalShellTaskState = {
    ...createTaskStateBase(taskId, 'local_bash', description, toolUseId),
    type: 'local_bash',
    status: 'running',
    command,
    completionStatusSentInAttachment: false,
    shellCommand,
    unregisterCleanup,
    lastReportedTotalLines: 0,
    isBackgrounded: true,
    agentId,
    kind,
  };

  registerTask(taskState, setAppState);

  // densable Ovu: Gge(agentId, bash|monitor:id) after register; dispose = tB
  const releaseShellKeepalive = attachShellKeepalive(taskId, agentId, kind, setAppState);

  // Official $xu — main-thread bg shells only (not monitor / not agent-scoped)
  const disposePressureReap = installShellPressureReap(
    taskId,
    description,
    getAppState,
    setAppState,
    toolUseId,
    kind,
    agentId,
  );

  // Data flows through TaskOutput automatically — no stream listeners needed.
  // Just transition to backgrounded state so the process keeps running.
  // densable Ppt: background(u, { capMs: kind !== 'monitor' ? fkd(agentId) : void 0 })
  shellCommand.background(taskId, {
    capMs: kind !== 'monitor' ? resolveSubagentBgShellCapMs(agentId) : undefined,
  });

  const cancelStallWatchdog = startStallWatchdog(taskId, description, kind, toolUseId, agentId);

  void shellCommand.result.then(async result => {
    cancelStallWatchdog();
    disposePressureReap();
    await flushAndCleanup(shellCommand);
    let wasKilled = false;

    updateTaskState<LocalShellTaskState>(taskId, setAppState, task => {
      if (task.status === 'killed') {
        wasKilled = true;
        return task;
      }

      return {
        ...task,
        status: result.code === 0 ? 'completed' : 'failed',
        result: { code: result.code, interrupted: result.interrupted },
        shellCommand: null,
        unregisterCleanup: undefined,
        endTime: Date.now(),
      };
    });

    enqueueShellNotification(
      taskId,
      description,
      wasKilled ? 'killed' : result.code === 0 ? 'completed' : 'failed',
      result.code,
      setAppState,
      toolUseId,
      kind,
      agentId,
    );

    // densable bXi: l?.() releaseBgCap after notify (tB bash|monitor:id)
    releaseShellKeepalive();

    void evictTaskOutput(taskId);
  });

  return {
    taskId,
    cleanup: () => {
      unregisterCleanup();
    },
  };
}

/**
 * Register a foreground task that could be backgrounded later.
 * Called when a bash command has been running long enough to show the BackgroundHint.
 * @returns taskId for the registered task
 */
export function registerForeground(
  input: LocalShellSpawnInput & { shellCommand: ShellCommand },
  setAppState: SetAppState,
  toolUseId?: string,
): string {
  const { command, description, shellCommand, agentId } = input;

  const taskId = shellCommand.taskOutput.taskId;

  const unregisterCleanup = registerCleanup(async () => {
    killTask(taskId, setAppState);
  });

  const taskState: LocalShellTaskState = {
    ...createTaskStateBase(taskId, 'local_bash', description, toolUseId),
    type: 'local_bash',
    status: 'running',
    command,
    completionStatusSentInAttachment: false,
    shellCommand,
    unregisterCleanup,
    lastReportedTotalLines: 0,
    isBackgrounded: false, // Not yet backgrounded - running in foreground
    agentId,
  };

  registerTask(taskState, setAppState);
  return taskId;
}

/**
 * Background a specific foreground shell task.
 * @returns true if backgrounded successfully, false otherwise
 */
export function backgroundTask(taskId: string, getAppState: () => AppState, setAppState: SetAppState): boolean {
  // Step 1: Get the task and shell command from current state
  const state = getAppState();
  const task = state.tasks[taskId];
  if (!isLocalShellTask(task) || task.isBackgrounded || !task.shellCommand) {
    return false;
  }

  const shellCommand = task.shellCommand;
  const description = task.description;
  const { toolUseId, kind, agentId } = task;

  // Transition to backgrounded — TaskOutput continues receiving data automatically
  // densable Tsn: background(e, { capMs: fkd(agentId) }) — Ctrl+B same cap as spawn
  if (
    !shellCommand.background(taskId, {
      capMs: resolveSubagentBgShellCapMs(agentId),
    })
  ) {
    return false;
  }

  let didBackground = false;
  setAppState(prev => {
    const prevTask = prev.tasks[taskId];
    if (!isLocalShellTask(prevTask) || prevTask.isBackgrounded) {
      return prev;
    }
    didBackground = true;
    return {
      ...prev,
      tasks: {
        ...prev.tasks,
        [taskId]: { ...prevTask, isBackgrounded: true },
      },
    };
  });
  // Official 2.1 task_updated only when state actually flipped (setAppState
  // path bypasses updateTaskState).
  if (didBackground) {
    try {
      const { emitTaskUpdatedSdk } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('src/utils/sdkEventQueue.js') as typeof import('src/utils/sdkEventQueue.js');
      emitTaskUpdatedSdk(taskId, { is_backgrounded: true });
    } catch {
      // optional
    }
  }

  const cancelStallWatchdog = startStallWatchdog(taskId, description, kind, toolUseId, agentId);

  // densable Ovu on mid-bg: Gge only once the shell is backgrounded
  const releaseShellKeepalive = attachShellKeepalive(taskId, agentId, kind, setAppState);

  // Set up result handler
  void shellCommand.result.then(async result => {
    cancelStallWatchdog();
    await flushAndCleanup(shellCommand);
    let wasKilled = false;
    let cleanupFn: (() => void) | undefined;

    updateTaskState<LocalShellTaskState>(taskId, setAppState, t => {
      if (t.status === 'killed') {
        wasKilled = true;
        return t;
      }

      // Capture cleanup function to call outside of updater
      cleanupFn = t.unregisterCleanup;

      return {
        ...t,
        status: result.code === 0 ? 'completed' : 'failed',
        result: { code: result.code, interrupted: result.interrupted },
        shellCommand: null,
        unregisterCleanup: undefined,
        endTime: Date.now(),
      };
    });

    // Call cleanup outside of the state updater (avoid side effects in updater)
    cleanupFn?.();

    if (wasKilled) {
      enqueueShellNotification(taskId, description, 'killed', result.code, setAppState, toolUseId, kind, agentId);
    } else {
      const finalStatus = result.code === 0 ? 'completed' : 'failed';
      enqueueShellNotification(taskId, description, finalStatus, result.code, setAppState, toolUseId, kind, agentId);
    }

    releaseShellKeepalive();
    void evictTaskOutput(taskId);
  });

  // Official densable NZ6 returns true after shell.background succeeds; if
  // AppState was already backgrounded (race), still true — shell left FG.
  // Prefer reporting actual state flip for Host background_tasks response.
  return didBackground;
}

/**
 * Background ALL foreground tasks (bash commands and agents).
 * Called when user presses Ctrl+B to background all running tasks.
 */
/**
 * Check if there are any foreground tasks (bash or agent) that can be backgrounded.
 * Used to determine whether Ctrl+B should background existing tasks vs. background the session.
 */
export function hasForegroundTasks(state: AppState): boolean {
  return Object.values(state.tasks).some(task => {
    if (isLocalShellTask(task) && !task.isBackgrounded && task.shellCommand) {
      return true;
    }
    // Exclude main session tasks - they display in the main view, not as foreground tasks
    if (isLocalAgentTask(task) && !task.isBackgrounded && !isMainSessionTask(task)) {
      return true;
    }
    return false;
  });
}

export function backgroundAll(getAppState: () => AppState, setAppState: SetAppState): void {
  const state = getAppState();

  // Background all foreground bash tasks
  const foregroundBashTaskIds = Object.keys(state.tasks).filter(id => {
    const task = state.tasks[id];
    return isLocalShellTask(task) && !task.isBackgrounded && task.shellCommand;
  });
  for (const taskId of foregroundBashTaskIds) {
    backgroundTask(taskId, getAppState, setAppState);
  }

  // Background all foreground agent tasks (exclude main session — same
  // filter as hasForegroundTasks; Host background_tasks without tool_use_id).
  const foregroundAgentTaskIds = Object.keys(state.tasks).filter(id => {
    const task = state.tasks[id];
    return isLocalAgentTask(task) && !task.isBackgrounded && !isMainSessionTask(task);
  });
  for (const taskId of foregroundAgentTaskIds) {
    backgroundAgentTask(taskId, getAppState, setAppState);
  }
}

/**
 * Official 2.1.x control `background_tasks` with tool_use_id (xPK densable).
 * Backgrounds the single foreground shell/agent task that originated from the
 * given tool_use block id.
 * @returns true if a matching task was backgrounded
 */
export function backgroundTaskByToolUseId(
  toolUseId: string,
  getAppState: () => AppState,
  setAppState: SetAppState,
): boolean {
  if (!toolUseId) {
    return false;
  }
  const state = getAppState();
  for (const [taskId, task] of Object.entries(state.tasks)) {
    if (task.toolUseId !== toolUseId) {
      continue;
    }
    if (isLocalShellTask(task) && !task.isBackgrounded && task.shellCommand) {
      return backgroundTask(taskId, getAppState, setAppState);
    }
    if (isLocalAgentTask(task) && !task.isBackgrounded && !isMainSessionTask(task)) {
      return backgroundAgentTask(taskId, getAppState, setAppState);
    }
    // Matched tool_use_id but not backgroundable (already bg / terminal / main).
    return false;
  }
  return false;
}

/**
 * Background an already-registered foreground task in-place.
 * Unlike spawn(), this does NOT re-register the task — it flips isBackgrounded
 * on the existing registration and sets up a completion handler.
 * Used when the auto-background timer fires after registerForeground() has
 * already registered the task (avoiding duplicate task_started SDK events
 * and leaked cleanup callbacks).
 */
export function backgroundExistingForegroundTask(
  taskId: string,
  shellCommand: ShellCommand,
  description: string,
  setAppState: SetAppState,
  toolUseId?: string,
  getAppState?: () => AppState,
): boolean {
  // Peek agentId before background so densable fkd cap can arm on auto-bg too.
  let agentId: AgentId | undefined;
  if (getAppState) {
    const peek = getAppState().tasks[taskId];
    if (isLocalShellTask(peek)) {
      agentId = peek.agentId;
    }
  }

  if (
    !shellCommand.background(taskId, {
      capMs: resolveSubagentBgShellCapMs(agentId),
    })
  ) {
    return false;
  }

  let didBackground = false;
  setAppState(prev => {
    const prevTask = prev.tasks[taskId];
    if (!isLocalShellTask(prevTask) || prevTask.isBackgrounded) {
      return prev;
    }
    agentId = prevTask.agentId;
    didBackground = true;
    return {
      ...prev,
      tasks: {
        ...prev.tasks,
        [taskId]: { ...prevTask, isBackgrounded: true },
      },
    };
  });
  // Official 2.1 task_updated only when state actually flipped.
  if (didBackground) {
    try {
      const { emitTaskUpdatedSdk } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('src/utils/sdkEventQueue.js') as typeof import('src/utils/sdkEventQueue.js');
      emitTaskUpdatedSdk(taskId, { is_backgrounded: true });
    } catch {
      // optional
    }
  }

  const cancelStallWatchdog = startStallWatchdog(taskId, description, undefined, toolUseId, agentId);

  // Official YJn → $xu: pressure reap on auto-backgrounded foreground tasks
  const disposePressureReap =
    getAppState !== undefined
      ? installShellPressureReap(taskId, description, getAppState, setAppState, toolUseId, undefined, agentId)
      : () => {};

  // densable Ovu on auto-bg: Gge(agentId, bash:id) once backgrounded
  const releaseShellKeepalive = attachShellKeepalive(taskId, agentId, undefined, setAppState);

  // Set up result handler (mirrors backgroundTask's handler)
  void shellCommand.result.then(async result => {
    cancelStallWatchdog();
    disposePressureReap();
    await flushAndCleanup(shellCommand);
    let wasKilled = false;
    let cleanupFn: (() => void) | undefined;

    updateTaskState<LocalShellTaskState>(taskId, setAppState, t => {
      if (t.status === 'killed') {
        wasKilled = true;
        return t;
      }
      cleanupFn = t.unregisterCleanup;
      return {
        ...t,
        status: result.code === 0 ? 'completed' : 'failed',
        result: { code: result.code, interrupted: result.interrupted },
        shellCommand: null,
        unregisterCleanup: undefined,
        endTime: Date.now(),
      };
    });

    cleanupFn?.();

    const finalStatus = wasKilled ? 'killed' : result.code === 0 ? 'completed' : 'failed';
    enqueueShellNotification(taskId, description, finalStatus, result.code, setAppState, toolUseId, undefined, agentId);

    releaseShellKeepalive();
    void evictTaskOutput(taskId);
  });

  return didBackground;
}

/**
 * Mark a task as notified to suppress a pending enqueueShellNotification.
 * Used when backgrounding raced with completion — the tool result already
 * carries the full output, so the <task_notification> would be redundant.
 */
export function markTaskNotified(taskId: string, setAppState: SetAppState): void {
  updateTaskState(taskId, setAppState, t => (t.notified ? t : { ...t, notified: true }));
}

/**
 * Unregister a foreground task when the command completes without being backgrounded.
 */
export function unregisterForeground(taskId: string, setAppState: SetAppState): void {
  let cleanupFn: (() => void) | undefined;

  setAppState(prev => {
    const task = prev.tasks[taskId];
    // Only remove if it's a foreground task (not backgrounded)
    if (!isLocalShellTask(task) || task.isBackgrounded) {
      return prev;
    }

    // Capture cleanup function to call outside of updater
    cleanupFn = task.unregisterCleanup;

    const { [taskId]: removed, ...rest } = prev.tasks;
    return { ...prev, tasks: rest };
  });

  // Call cleanup outside of the state updater (avoid side effects in updater)
  cleanupFn?.();
}

async function flushAndCleanup(shellCommand: ShellCommand): Promise<void> {
  try {
    await shellCommand.taskOutput.flush();
    shellCommand.cleanup();
  } catch (error) {
    logError(error);
  }
}
