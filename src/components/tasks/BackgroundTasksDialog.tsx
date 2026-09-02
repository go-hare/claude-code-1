import { feature } from 'bun:bundle';
import figures from 'figures';
import React, { type ReactNode, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { getIsInteractive } from 'src/bootstrap/state.js';
import { isCoordinatorMode } from 'src/coordinator/coordinatorMode.js';
import { useTerminalSize } from 'src/hooks/useTerminalSize.js';
import { useAppState, useSetAppState } from 'src/state/AppState.js';
import { enterTeammateView, exitTeammateView } from 'src/state/teammateViewHelpers.js';
import type { ToolUseContext } from 'src/Tool.js';
import { AutoModeScanTask, type AutoModeScanTaskState } from 'src/tasks/AutoModeScanTask/AutoModeScanTask.js';
import { DreamTask, type DreamTaskState } from 'src/tasks/DreamTask/DreamTask.js';
import { InProcessTeammateTask } from 'src/tasks/InProcessTeammateTask/InProcessTeammateTask.js';
import type { InProcessTeammateTaskState } from 'src/tasks/InProcessTeammateTask/types.js';
import type { LocalAgentTaskState } from 'src/tasks/LocalAgentTask/LocalAgentTask.js';
import {
  isPanelAgentTask,
  killDescendantAgents,
  LocalAgentTask,
  markAgentStoppedByUser,
} from 'src/tasks/LocalAgentTask/LocalAgentTask.js';
import type { LocalShellTaskState } from 'src/tasks/LocalShellTask/guards.js';
import { LocalShellTask } from 'src/tasks/LocalShellTask/LocalShellTask.js';
// Type import is erased at build time — safe even though module is ant-gated.
import type { LocalWorkflowTaskState } from 'src/tasks/LocalWorkflowTask/LocalWorkflowTask.js';
import type { MonitorMcpTaskState } from 'src/tasks/MonitorMcpTask/MonitorMcpTask.js';
import { killMonitorWs, type MonitorWsTaskState } from 'src/tasks/MonitorWsTask/MonitorWsTask.js';
import { RemoteAgentTask, type RemoteAgentTaskState } from 'src/tasks/RemoteAgentTask/RemoteAgentTask.js';
import { isBackgroundTask, type TaskState } from 'src/tasks/types.js';
import type { DeepImmutable } from 'src/types/utils.js';
import { intersperse } from 'src/utils/array.js';
import { TEAM_LEAD_NAME } from 'src/utils/swarm/constants.js';
import { IDLE_WINDOW_KEEPALIVE_REASON } from 'src/utils/task/framework.js';
import { stopUltraplan } from '../../commands/ultraplan.js';
import type { CommandResultDisplay } from '../../commands.js';
import { useRegisterOverlay } from '../../context/overlayContext.js';
import type { ExitState } from '../../hooks/useExitOnCtrlCDWithKeybindings.js';
import { type KeyboardEvent, Box, Text } from '@anthropic/ink';
import { useKeybindings } from '../../keybindings/useKeybinding.js';
import { useShortcutDisplay } from '../../keybindings/useShortcutDisplay.js';
import { count } from '../../utils/array.js';
import { Byline, Dialog, KeyboardShortcutHint } from '@anthropic/ink';
import { AsyncAgentDetailDialog } from './AsyncAgentDetailDialog.js';
import { BackgroundTask as BackgroundTaskComponent } from './BackgroundTask.js';
import { AutoModeScanDetailDialog } from './AutoModeScanDetailDialog.js';
import { DreamDetailDialog } from './DreamDetailDialog.js';
import { InProcessTeammateDetailDialog } from './InProcessTeammateDetailDialog.js';
import { RemoteSessionDetailDialog } from './RemoteSessionDetailDialog.js';
import { ShellDetailDialog } from './ShellDetailDialog.js';

type ViewState = { mode: 'list' } | { mode: 'detail'; itemId: string };

type Props = {
  onDone: (result?: string, options?: { display?: CommandResultDisplay }) => void;
  toolUseContext: ToolUseContext;
  initialDetailTaskId?: string;
  /** densable xCs onBack — detail ← prefers this over auto-dismiss. */
  onBack?: () => void;
  /** densable xCs promptVisibleBelow — passed through to WorkflowDetailDialog. */
  promptVisibleBelow?: boolean;
};

/**
 * densable t5c — Enter / auto-open may open a detail host.
 * Official excludes mcp_task (no local type) and monitor_ws (list + x only).
 */
export function canOpenBackgroundTaskDetail(type: string): boolean {
  return type !== 'mcp_task' && type !== 'monitor_ws';
}

/**
 * densable Zqg — completed local_agent that is not quietly parked.
 * Auto-open skips these; Enter on the list row foregrounds instead of detail.
 */
export function isCompletedUnparkedLocalAgent(task: {
  type?: string;
  status?: string;
  quietlyParked?: boolean;
}): boolean {
  return task.type === 'local_agent' && task.status === 'completed' && task.quietlyParked !== true;
}

/** densable kCs — list row whose task is Zqg. */
export function isCompletedAgentListItem(item: {
  type: string;
  task?: { type?: string; status?: string; quietlyParked?: boolean };
}): boolean {
  return item.type === 'local_agent' && item.task !== undefined && isCompletedUnparkedLocalAgent(item.task);
}

/**
 * densable r5c — rows shown in xCs.
 * Completed local_agent uses the official parked-idle filter; everything else is bO.
 */
export function isBackgroundTasksDialogRow(task: TaskState): boolean {
  if (task.type === 'local_agent' && task.status === 'completed') {
    return (
      isPanelAgentTask(task) &&
      task.isBackgrounded === true &&
      task.isObserver !== true &&
      task.evictAfter !== 0 &&
      [...(task.keepaliveReasons ?? [])].every(reason => reason === IDLE_WINDOW_KEEPALIVE_REASON)
    );
  }
  return isBackgroundTask(task);
}

/**
 * densable sK — x can stop a completed local_agent that still holds keepalive.
 * Official: type+completed + keepaliveReasons Set size>0 + !jn() (interactive).
 */
export function isStoppableCompletedKeepaliveAgent(task: {
  type?: string;
  status?: string;
  keepaliveReasons?: unknown;
}): boolean {
  return (
    task.type === 'local_agent' &&
    task.status === 'completed' &&
    'keepaliveReasons' in task &&
    task.keepaliveReasons instanceof Set &&
    task.keepaliveReasons.size > 0 &&
    getIsInteractive()
  );
}

type ListItem =
  | {
      id: string;
      type: 'local_bash';
      label: string;
      status: string;
      task: DeepImmutable<LocalShellTaskState>;
    }
  | {
      id: string;
      type: 'remote_agent';
      label: string;
      status: string;
      task: DeepImmutable<RemoteAgentTaskState>;
    }
  | {
      id: string;
      type: 'local_agent';
      label: string;
      status: string;
      task: DeepImmutable<LocalAgentTaskState>;
    }
  | {
      id: string;
      type: 'in_process_teammate';
      label: string;
      status: string;
      task: DeepImmutable<InProcessTeammateTaskState>;
    }
  | {
      id: string;
      type: 'local_workflow';
      label: string;
      status: string;
      task: DeepImmutable<LocalWorkflowTaskState>;
    }
  | {
      id: string;
      type: 'monitor_mcp';
      label: string;
      status: string;
      task: DeepImmutable<MonitorMcpTaskState>;
    }
  | {
      id: string;
      type: 'monitor_ws';
      label: string;
      status: string;
      task: DeepImmutable<MonitorWsTaskState>;
    }
  | {
      id: string;
      type: 'dream';
      label: string;
      status: string;
      task: DeepImmutable<DreamTaskState>;
    }
  | {
      id: string;
      type: 'auto_mode_scan';
      label: string;
      status: string;
      task: DeepImmutable<AutoModeScanTaskState>;
    }
  | {
      id: string;
      type: 'leader';
      label: string;
      status: 'running';
    };

// WORKFLOW_SCRIPTS is ant-only (build_flags.yaml). Static imports would leak
// ~1.3K lines into external builds. Gate with feature() + require so the
// bundler can dead-code-eliminate the branch.
/* eslint-disable @typescript-eslint/no-require-imports */
// densable: Tasks detail uses WorkflowDetailDialog (fv_) over task.workflowProgress.
const workflowTaskModule = feature('WORKFLOW_SCRIPTS')
  ? (require('src/tasks/LocalWorkflowTask/LocalWorkflowTask.js') as typeof import('src/tasks/LocalWorkflowTask/LocalWorkflowTask.js'))
  : null;
const killWorkflowTask = workflowTaskModule?.killWorkflowTask ?? null;
const skipWorkflowAgent = workflowTaskModule?.skipWorkflowAgent ?? null;
const retryWorkflowAgent = workflowTaskModule?.retryWorkflowAgent ?? null;
const pauseWorkflowTask = workflowTaskModule?.pauseWorkflowTask ?? null;
const WorkflowDetailDialog = feature('WORKFLOW_SCRIPTS')
  ? (require('./WorkflowDetailDialog.js') as typeof import('./WorkflowDetailDialog.js')).WorkflowDetailDialog
  : null;
// Relative path, not `src/...` path-mapping — Bun's DCE can statically
// resolve + eliminate `./` requires, but path-mapped strings stay opaque
// and survive as dead literals in the bundle. Matches tasks.ts pattern.
const monitorMcpModule = feature('MONITOR_TOOL')
  ? (require('../../tasks/MonitorMcpTask/MonitorMcpTask.js') as typeof import('../../tasks/MonitorMcpTask/MonitorMcpTask.js'))
  : null;
const killMonitorMcp = monitorMcpModule?.killMonitorMcp ?? null;
const MonitorMcpDetailDialog = feature('MONITOR_TOOL')
  ? (require('./MonitorMcpDetailDialog.js') as typeof import('./MonitorMcpDetailDialog.js')).MonitorMcpDetailDialog
  : null;
/* eslint-enable @typescript-eslint/no-require-imports */

// Helper to get filtered background tasks (excludes foregrounded local_agent)
function getSelectableBackgroundTasks(
  tasks: Record<string, TaskState> | undefined,
  foregroundedTaskId: string | undefined,
): TaskState[] {
  const backgroundTasks = Object.values(tasks ?? {}).filter(isBackgroundTasksDialogRow);
  return backgroundTasks.filter(task => !(task.type === 'local_agent' && task.id === foregroundedTaskId));
}

export function BackgroundTasksDialog({
  onDone,
  toolUseContext,
  initialDetailTaskId,
  onBack,
  promptVisibleBelow = false,
}: Props): React.ReactNode {
  const tasks = useAppState(s => s.tasks);
  const foregroundedTaskId = useAppState(s => s.foregroundedTaskId);
  const showSpinnerTree = useAppState(s => s.expandedView) === 'teammates';
  const setAppState = useSetAppState();
  const killAgentsShortcut = useShortcutDisplay('chat:killAgents', 'Chat', 'ctrl+x ctrl+k');
  const typedTasks = tasks as Record<string, TaskState> | undefined;

  // Track if we skipped list view on mount (for back button behavior)
  const skippedListOnMount = useRef(false);

  // Compute initial view state - skip list if caller provided a specific task,
  // or if there's exactly one task
  const [viewState, setViewState] = useState<ViewState>(() => {
    if (initialDetailTaskId) {
      skippedListOnMount.current = true;
      return { mode: 'detail', itemId: initialDetailTaskId };
    }
    const allItems = getSelectableBackgroundTasks(typedTasks, foregroundedTaskId);
    const only = allItems.length === 1 ? allItems[0] : undefined;
    // densable xCs: se && t5c(se.type) && !(local_agent && Zqg(se))
    if (
      only &&
      canOpenBackgroundTaskDetail(only.type) &&
      !(only.type === 'local_agent' && isCompletedUnparkedLocalAgent(only))
    ) {
      skippedListOnMount.current = true;
      return { mode: 'detail', itemId: only.id };
    }
    return { mode: 'list' };
  });
  const [selectedIndex, setSelectedIndex] = useState<number>(0);

  // Register as modal overlay so parent Chat keybindings (up/down for history)
  // are deactivated while this dialog is open
  useRegisterOverlay('background-tasks-dialog');

  // Memoize the sorted and categorized items together to ensure stable references
  const {
    bashTasks,
    remoteSessions,
    agentTasks,
    completedAgentTasks,
    teammateTasks,
    workflowTasks,
    mcpMonitors,
    dreamTasks,
    autoModeScanTasks,
    allSelectableItems,
  } = useMemo(() => {
    // densable r5c — running/pending bO plus parked-idle completed local_agent
    const backgroundTasks = Object.values(typedTasks ?? {}).filter(isBackgroundTasksDialogRow);
    const allItems = backgroundTasks.map(toListItem);
    const sorted = allItems.sort((a, b) => {
      const aStatus = a.status;
      const bStatus = b.status;
      if (aStatus === 'running' && bStatus !== 'running') return -1;
      if (aStatus !== 'running' && bStatus === 'running') return 1;
      const aTime = 'task' in a ? a.task.startTime : 0;
      const bTime = 'task' in b ? b.task.startTime : 0;
      return bTime - aTime;
    });
    const bash = sorted.filter(item => item.type === 'local_bash');
    const remote = sorted.filter(item => item.type === 'remote_agent');
    // Exclude foregrounded task - it's being viewed in the main UI, not a background task
    const agents = sorted.filter(item => item.type === 'local_agent' && item.id !== foregroundedTaskId);
    const agent = agents.filter(item => !isCompletedAgentListItem(item));
    const completed = agents.filter(isCompletedAgentListItem);
    const workflows = sorted.filter(item => item.type === 'local_workflow');
    const monitorMcp = sorted.filter(item => item.type === 'monitor_mcp' || item.type === 'monitor_ws');
    const dreamTasks = sorted.filter(item => item.type === 'dream');
    const autoModeScanTasks = sorted.filter(item => item.type === 'auto_mode_scan');
    // In spinner-tree mode, exclude teammates from the dialog (they appear in the tree)
    const teammates = showSpinnerTree ? [] : sorted.filter(item => item.type === 'in_process_teammate');
    // Add leader entry when there are teammates, so users can foreground back to leader
    const leaderItem: ListItem[] =
      teammates.length > 0
        ? [
            {
              id: '__leader__',
              type: 'leader',
              label: `@${TEAM_LEAD_NAME}`,
              status: 'running',
            },
          ]
        : [];
    return {
      bashTasks: bash,
      remoteSessions: remote,
      agentTasks: agent,
      completedAgentTasks: completed,
      workflowTasks: workflows,
      mcpMonitors: monitorMcp,
      dreamTasks,
      autoModeScanTasks,
      teammateTasks: [...leaderItem, ...teammates],
      // densable xCs I: leader → teammates → bash → monitors → remote →
      // agents → completed → workflows → dream → auto_mode_scan
      allSelectableItems: [
        ...leaderItem,
        ...teammates,
        ...bash,
        ...monitorMcp,
        ...remote,
        ...agent,
        ...completed,
        ...workflows,
        ...dreamTasks,
        ...autoModeScanTasks,
      ],
    };
  }, [typedTasks, foregroundedTaskId, showSpinnerTree]);

  const currentSelection = allSelectableItems[selectedIndex] ?? null;
  const prevSelectableIdsRef = useRef<string[]>([]);
  const ignoreNextKillRef = useRef(false);

  // densable xCs: keep the cursor on the same id when the list mutates; the
  // following x is ignored so a shifted row is not killed by accident.
  useEffect(() => {
    const ids = allSelectableItems.map(item => item.id);
    const prev = prevSelectableIdsRef.current;
    prevSelectableIdsRef.current = ids;
    if (prev.length === 0) return;
    const prevId = prev[selectedIndex];
    if (prevId !== undefined && ids[selectedIndex] === prevId) return;
    if (prevId !== undefined) {
      const next = ids.indexOf(prevId);
      if (next !== -1) {
        setSelectedIndex(next);
        return;
      }
    }
    setSelectedIndex(Math.max(0, Math.min(selectedIndex, Math.max(ids.length - 1, 0))));
    ignoreNextKillRef.current = true;
  }, [allSelectableItems, selectedIndex]);

  // Use configurable keybindings for standard navigation and confirm/cancel.
  // confirm:no is handled by Dialog's onCancel prop.
  useKeybindings(
    {
      'confirm:previous': () => {
        ignoreNextKillRef.current = false;
        setSelectedIndex(prev => Math.max(0, prev - 1));
      },
      'confirm:next': () => {
        ignoreNextKillRef.current = false;
        setSelectedIndex(prev => Math.min(allSelectableItems.length - 1, prev + 1));
      },
      'confirm:yes': () => {
        const current = allSelectableItems[selectedIndex];
        if (current) {
          if (current.type === 'leader') {
            exitTeammateView(setAppState);
            onDone('Viewing leader', { display: 'system' });
          } else if (isCompletedAgentListItem(current)) {
            // densable kCs → pje: completed parked agent is foregrounded, not detailed
            enterTeammateView(current.id, setAppState);
            onDone('Viewing agent', { display: 'system' });
          } else if (canOpenBackgroundTaskDetail(current.type)) {
            setViewState({ mode: 'detail', itemId: current.id });
          }
        }
      },
    },
    { context: 'Confirmation', isActive: viewState.mode === 'list' },
  );

  // Component-specific shortcuts (x=stop, f=foreground, right=zoom) shown in UI.
  // These are task-type and status dependent, not standard dialog keybindings.
  const handleKeyDown = (e: KeyboardEvent) => {
    // Only handle input when in list mode
    if (viewState.mode !== 'list') return;

    if (e.key === 'left') {
      e.preventDefault();
      onDone('Background dialog dismissed', { display: 'skip' });
      return;
    }

    // Compute current selection at the time of the key press
    const currentSelection = allSelectableItems[selectedIndex];
    if (!currentSelection) return; // everything below requires a selection

    if (e.key === 'x' && !e.ctrl && !e.meta) {
      e.preventDefault();
      if (ignoreNextKillRef.current) {
        ignoreNextKillRef.current = false;
        return;
      }
      if (currentSelection.type === 'local_bash' && currentSelection.status === 'running') {
        void killShellTask(currentSelection.id);
      } else if (
        currentSelection.type === 'local_agent' &&
        (currentSelection.status === 'running' || isStoppableCompletedKeepaliveAgent(currentSelection.task))
      ) {
        void killAgentTask(currentSelection.id);
      } else if (currentSelection.type === 'in_process_teammate' && currentSelection.status === 'running') {
        void killTeammateTask(currentSelection.id);
      } else if (currentSelection.type === 'local_workflow' && currentSelection.status === 'running') {
        // densable: service.kill aborts run binding + agents (no-op if unbound);
        // always also task-kill (idempotent) so list selection terminates.
        const runId = currentSelection.task.workflowRunId ?? currentSelection.id;
        try {
          const { getWorkflowService } =
            require('../../workflow/service.js') as typeof import('../../workflow/service.js');
          getWorkflowService().kill(runId);
        } catch {
          /* service unavailable */
        }
        if (killWorkflowTask) {
          killWorkflowTask(currentSelection.id, setAppState);
        }
      } else if (currentSelection.type === 'monitor_mcp' && currentSelection.status === 'running' && killMonitorMcp) {
        killMonitorMcp(currentSelection.id, setAppState);
      } else if (currentSelection.type === 'monitor_ws' && currentSelection.status === 'running') {
        // densable xCs: oF(id, registry, {userStop, taskStop})
        killMonitorWs(currentSelection.id, setAppState);
      } else if (currentSelection.type === 'dream' && currentSelection.status === 'running') {
        void killDreamTask(currentSelection.id);
      } else if (currentSelection.type === 'auto_mode_scan' && currentSelection.status === 'running') {
        void killAutoModeScanTask(currentSelection.id);
      } else if (currentSelection.type === 'remote_agent' && currentSelection.status === 'running') {
        if (currentSelection.task.isUltraplan) {
          void stopUltraplan(currentSelection.id, currentSelection.task.sessionId, setAppState);
        } else {
          void killRemoteAgentTask(currentSelection.id);
        }
      }
    }

    if (e.key === 'f' && !e.ctrl && !e.meta) {
      if (currentSelection.type === 'in_process_teammate' && currentSelection.status === 'running') {
        e.preventDefault();
        enterTeammateView(currentSelection.id, setAppState);
        onDone('Viewing teammate', { display: 'system' });
      } else if (
        currentSelection.type === 'local_agent' &&
        isPanelAgentTask(currentSelection.task) &&
        !isCompletedAgentListItem(currentSelection)
      ) {
        // densable xCs f: DW(task) && !kCs
        e.preventDefault();
        enterTeammateView(currentSelection.id, setAppState);
        onDone('Viewing agent', { display: 'system' });
      } else if (currentSelection.type === 'leader') {
        e.preventDefault();
        exitTeammateView(setAppState);
        onDone('Viewing leader', { display: 'system' });
      }
    }
  };

  async function killShellTask(taskId: string): Promise<void> {
    await LocalShellTask.kill(taskId, setAppState);
  }

  async function killAgentTask(taskId: string): Promise<void> {
    // densable ySr: if isObserver → H1e (Fjr+kill); else hAe + XV + gtf
    const snapshot = toolUseContext.getAppState().tasks?.[taskId] as LocalAgentTaskState | undefined;
    if (snapshot?.type === 'local_agent' && snapshot.isObserver) {
      // densable ySr OH: H1e with source=user (Fjr + kill)
      try {
        const { stopTask } = await import('src/tasks/stopTask.js');
        await stopTask(taskId, {
          getAppState: toolUseContext.getAppState,
          setAppState,
          source: 'user',
          killedBy: 'user',
        });
      } catch {
        /* best-effort panel kill */
      }
      return;
    }
    if (snapshot?.type === 'local_agent') {
      markAgentStoppedByUser(taskId, setAppState);
    }
    await LocalAgentTask.kill(taskId, setAppState);
    if (snapshot?.type === 'local_agent') {
      killDescendantAgents(
        { id: taskId, agentId: snapshot.agentId ?? taskId },
        toolUseContext.getAppState,
        setAppState,
        { source: 'user', killedBy: 'user' },
      );
    }
  }

  async function killTeammateTask(taskId: string): Promise<void> {
    await InProcessTeammateTask.kill(taskId, setAppState);
  }

  async function killDreamTask(taskId: string): Promise<void> {
    await DreamTask.kill(taskId, setAppState);
  }

  async function killAutoModeScanTask(taskId: string): Promise<void> {
    await AutoModeScanTask.kill(taskId, setAppState);
  }

  async function killRemoteAgentTask(taskId: string): Promise<void> {
    await RemoteAgentTask.kill(taskId, setAppState);
  }

  // Wrap onDone in useEffectEvent to get a stable reference that always calls
  // the current onDone callback without causing the effect to re-fire.
  const onDoneEvent = useEffectEvent(onDone);

  useEffect(() => {
    if (viewState.mode !== 'list') {
      const task = (typedTasks ?? {})[viewState.itemId];
      // Workflow tasks get a grace: their detail view stays open through
      // completion so the user sees the final state before eviction.
      if (!task || (task.type !== 'local_workflow' && !isBackgroundTasksDialogRow(task))) {
        // Task was removed or is no longer a background task (e.g. killed).
        // If we skipped the list on mount, close the dialog entirely.
        if (skippedListOnMount.current) {
          // Defer to next tick: calling onDone synchronously unmounts this
          // component while it's still inside useEffect, causing React to
          // detect a hooks count mismatch ("Rendered fewer hooks than expected").
          queueMicrotask(() => {
            onDoneEvent('Background dialog dismissed', {
              display: 'skip',
            });
          });
        } else {
          setViewState({ mode: 'list' });
        }
      }
    }
  }, [viewState, typedTasks, onDoneEvent]);

  // Helper to go back to list view (or close dialog if we skipped list on
  // mount AND there's still only ≤1 item). Checking current count prevents
  // the stale-state trap: if you opened with 1 task (auto-skipped to detail),
  // then a second task started, 'back' should show the list — not close.
  const goBackToList = () => {
    // densable xCs U: onBack → else skip-on-mount && ≤1 → dismiss → else list
    if (onBack) {
      onBack();
    } else if (skippedListOnMount.current && allSelectableItems.length <= 1) {
      onDone('Background dialog dismissed', { display: 'skip' });
    } else {
      skippedListOnMount.current = false;
      setViewState({ mode: 'list' });
    }
  };

  // If an item is selected, show the appropriate view
  if (viewState.mode !== 'list' && typedTasks) {
    const task = typedTasks[viewState.itemId];
    if (!task) {
      return null;
    }

    // Detail mode - show appropriate detail dialog
    switch (task.type) {
      case 'local_bash':
        return (
          <ShellDetailDialog
            shell={task}
            onDone={onDone}
            onKillShell={() => void killShellTask(task.id)}
            onBack={goBackToList}
            key={`shell-${task.id}`}
          />
        );
      case 'local_agent':
        return (
          <AsyncAgentDetailDialog
            agent={task}
            onDone={onDone}
            onKillAgent={() => void killAgentTask(task.id)}
            onForeground={
              isPanelAgentTask(task)
                ? () => {
                    enterTeammateView(task.id, setAppState);
                    onDone('Viewing agent', { display: 'system' });
                  }
                : undefined
            }
            onBack={goBackToList}
            key={`agent-${task.id}`}
          />
        );
      case 'remote_agent':
        return (
          <RemoteSessionDetailDialog
            session={task}
            onDone={onDone}
            toolUseContext={toolUseContext}
            onBack={goBackToList}
            onKill={
              task.status !== 'running'
                ? undefined
                : task.isUltraplan
                  ? () => void stopUltraplan(task.id, task.sessionId, setAppState)
                  : () => void killRemoteAgentTask(task.id)
            }
            key={`session-${task.id}`}
          />
        );
      case 'in_process_teammate':
        return (
          <InProcessTeammateDetailDialog
            teammate={task}
            onDone={onDone}
            onKill={task.status === 'running' ? () => void killTeammateTask(task.id) : undefined}
            onBack={goBackToList}
            onForeground={
              task.status === 'running'
                ? () => {
                    enterTeammateView(task.id, setAppState);
                    onDone('Viewing teammate', { display: 'system' });
                  }
                : undefined
            }
            key={`teammate-${task.id}`}
          />
        );
      case 'local_workflow': {
        // densable: WorkflowDetailDialog (fv_) — phases/agents from task.workflowProgress.
        if (!WorkflowDetailDialog) return null;
        const onKill =
          task.status === 'running'
            ? () => {
                const runId = task.workflowRunId ?? task.id;
                // service.kill aborts run binding + agents; no-ops if unbound.
                // Always fall through to task kill (idempotent) so UI/task state terminate.
                try {
                  const { getWorkflowService } =
                    require('../../workflow/service.js') as typeof import('../../workflow/service.js');
                  getWorkflowService().kill(runId);
                } catch {
                  /* service unavailable */
                }
                killWorkflowTask?.(task.id, setAppState);
              }
            : undefined;
        const onSkip =
          task.status === 'running'
            ? (agentId: string) => {
                // Prefer densable yqK path via service (abort in-flight controller);
                // fall back to pendingAgentAction when run binding is gone.
                const n = Number(agentId);
                const runId = task.workflowRunId ?? task.id;
                if (Number.isFinite(n)) {
                  try {
                    const { getWorkflowService } =
                      require('../../workflow/service.js') as typeof import('../../workflow/service.js');
                    if (getWorkflowService().skipAgent(runId, n)) return;
                  } catch {
                    /* service unavailable */
                  }
                }
                skipWorkflowAgent?.(task.id, agentId as import('src/types/ids.js').AgentId, setAppState);
              }
            : undefined;
        const onRetry =
          task.status === 'running'
            ? (agentId: string) => {
                const n = Number(agentId);
                const runId = task.workflowRunId ?? task.id;
                if (Number.isFinite(n)) {
                  try {
                    const { getWorkflowService } =
                      require('../../workflow/service.js') as typeof import('../../workflow/service.js');
                    if (getWorkflowService().retryAgent(runId, n)) return;
                  } catch {
                    /* service unavailable */
                  }
                }
                retryWorkflowAgent?.(task.id, agentId as import('src/types/ids.js').AgentId, setAppState);
              }
            : undefined;
        const onPause =
          task.status === 'running' && pauseWorkflowTask
            ? () => {
                pauseWorkflowTask(task.id, setAppState);
              }
            : undefined;
        return (
          <WorkflowDetailDialog
            key={`workflow-${task.id}`}
            task={task}
            onBack={goBackToList}
            onKill={onKill}
            onSkipAgent={onSkip}
            onRetryAgent={onRetry}
            onPause={onPause}
            promptVisibleBelow={promptVisibleBelow}
          />
        );
      }
      case 'monitor_mcp':
        if (!MonitorMcpDetailDialog) return null;
        return (
          <MonitorMcpDetailDialog
            task={task}
            onKill={
              task.status === 'running' && killMonitorMcp ? () => killMonitorMcp(task.id, setAppState) : undefined
            }
            onBack={goBackToList}
            key={`monitor-mcp-${task.id}`}
          />
        );
      case 'monitor_ws':
        // densable xCs has no monitor_ws detail case — fall through to list.
        break;
      case 'auto_mode_scan':
        return (
          <AutoModeScanDetailDialog
            task={task}
            onDone={() =>
              onDone('Background dialog dismissed', {
                display: 'skip',
              })
            }
            onBack={goBackToList}
            onKill={task.status === 'running' ? () => void killAutoModeScanTask(task.id) : undefined}
            key={`auto-mode-scan-${task.id}`}
          />
        );
      case 'dream':
        return (
          <DreamDetailDialog
            task={task}
            onDone={() =>
              onDone('Background dialog dismissed', {
                display: 'skip',
              })
            }
            onBack={goBackToList}
            onKill={task.status === 'running' ? () => void killDreamTask(task.id) : undefined}
            key={`dream-${task.id}`}
          />
        );
    }
  }

  const runningBashCount = count(bashTasks, _ => _.status === 'running');
  const runningAgentCount =
    count(remoteSessions, _ => _.status === 'running' || _.status === 'pending') +
    count(agentTasks, _ => _.status === 'running');
  const runningTeammateCount = count(teammateTasks, _ => _.status === 'running');
  const subtitle = intersperse(
    [
      ...(runningTeammateCount > 0
        ? [
            <Text key="teammates">
              {runningTeammateCount} {runningTeammateCount !== 1 ? 'agents' : 'agent'}
            </Text>,
          ]
        : []),
      ...(runningBashCount > 0
        ? [
            <Text key="shells">
              {runningBashCount} {runningBashCount !== 1 ? 'active shells' : 'active shell'}
            </Text>,
          ]
        : []),
      ...(runningAgentCount > 0
        ? [
            <Text key="agents">
              {runningAgentCount} {runningAgentCount !== 1 ? 'active agents' : 'active agent'}
            </Text>,
          ]
        : []),
    ],
    index => <Text key={`separator-${index}`}> · </Text>,
  );

  const actions = [
    <KeyboardShortcutHint key="upDown" shortcut="↑/↓" action="select" />,
    ...(!currentSelection || canOpenBackgroundTaskDetail(currentSelection.type)
      ? [<KeyboardShortcutHint key="enter" shortcut="Enter" action="view" />]
      : []),
    ...((currentSelection?.type === 'in_process_teammate' && currentSelection.status === 'running') ||
    (currentSelection?.type === 'local_agent' &&
      isPanelAgentTask(currentSelection.task) &&
      !isCompletedAgentListItem(currentSelection))
      ? [<KeyboardShortcutHint key="foreground" shortcut="f" action="foreground" />]
      : []),
    ...(((currentSelection?.type === 'local_bash' ||
      currentSelection?.type === 'local_agent' ||
      currentSelection?.type === 'in_process_teammate' ||
      currentSelection?.type === 'local_workflow' ||
      currentSelection?.type === 'monitor_mcp' ||
      currentSelection?.type === 'monitor_ws' ||
      currentSelection?.type === 'dream' ||
      currentSelection?.type === 'auto_mode_scan' ||
      currentSelection?.type === 'remote_agent') &&
      currentSelection.status === 'running') ||
    (currentSelection?.type === 'local_agent' && isStoppableCompletedKeepaliveAgent(currentSelection.task))
      ? [
          <KeyboardShortcutHint key="kill" shortcut="x" action="stop" />,
          // densable Z: running local_agent count > 1; hint only when selected is local_agent
          ...(currentSelection.type === 'local_agent' && count(agentTasks, t => t.status === 'running') > 1
            ? [<KeyboardShortcutHint key="kill-all" shortcut={killAgentsShortcut} action="stop all agents" />]
            : []),
        ]
      : []),
    <KeyboardShortcutHint key="esc" shortcut="←/Esc" action="close" />,
  ];

  const handleCancel = () => onDone('Background dialog dismissed', { display: 'skip' });

  function renderInputGuide(exitState: ExitState): React.ReactNode {
    if (exitState.pending) {
      return <Text>Press {exitState.keyName} again to exit</Text>;
    }
    return <Byline>{actions}</Byline>;
  }

  return (
    <Box flexDirection="column" tabIndex={0} autoFocus onKeyDown={handleKeyDown}>
      <Dialog
        title="Background"
        subtitle={<>{subtitle}</>}
        onCancel={handleCancel}
        color="background"
        inputGuide={renderInputGuide}
      >
        {allSelectableItems.length === 0 ? (
          <Text dimColor>No tasks currently running</Text>
        ) : (
          <Box flexDirection="column">
            {teammateTasks.length > 0 && (
              <Box flexDirection="column">
                {(bashTasks.length > 0 ||
                  remoteSessions.length > 0 ||
                  agentTasks.length > 0 ||
                  completedAgentTasks.length > 0) && (
                  <Text dimColor>
                    <Text bold>{'  '}Agents</Text> ({count(teammateTasks, i => i.type !== 'leader')})
                  </Text>
                )}
                <Box flexDirection="column">
                  <TeammateTaskGroups teammateTasks={teammateTasks} currentSelectionId={currentSelection?.id} />
                </Box>
              </Box>
            )}

            {bashTasks.length > 0 && (
              <Box flexDirection="column" marginTop={teammateTasks.length > 0 ? 1 : 0}>
                {(teammateTasks.length > 0 ||
                  remoteSessions.length > 0 ||
                  agentTasks.length > 0 ||
                  completedAgentTasks.length > 0) && (
                  <Text dimColor>
                    <Text bold>{'  '}Shells</Text> ({bashTasks.length})
                  </Text>
                )}
                <Box flexDirection="column">
                  {bashTasks.map(item => (
                    <Item key={item.id} item={item} isSelected={item.id === currentSelection?.id} />
                  ))}
                </Box>
              </Box>
            )}

            {mcpMonitors.length > 0 && (
              <Box flexDirection="column" marginTop={teammateTasks.length > 0 || bashTasks.length > 0 ? 1 : 0}>
                <Text dimColor>
                  <Text bold>{'  '}Monitors</Text> ({mcpMonitors.length})
                </Text>
                <Box flexDirection="column">
                  {mcpMonitors.map(item => (
                    <Item key={item.id} item={item} isSelected={item.id === currentSelection?.id} />
                  ))}
                </Box>
              </Box>
            )}

            {remoteSessions.length > 0 && (
              <Box
                flexDirection="column"
                marginTop={teammateTasks.length > 0 || bashTasks.length > 0 || mcpMonitors.length > 0 ? 1 : 0}
              >
                <Text dimColor>
                  <Text bold>{'  '}Cloud agents</Text> ({remoteSessions.length})
                </Text>
                <Box flexDirection="column">
                  {remoteSessions.map(item => (
                    <Item key={item.id} item={item} isSelected={item.id === currentSelection?.id} />
                  ))}
                </Box>
              </Box>
            )}

            {agentTasks.length > 0 && (
              <Box
                flexDirection="column"
                marginTop={
                  teammateTasks.length > 0 ||
                  bashTasks.length > 0 ||
                  mcpMonitors.length > 0 ||
                  remoteSessions.length > 0
                    ? 1
                    : 0
                }
              >
                <Text dimColor>
                  <Text bold>{'  '}Local agents</Text> ({agentTasks.length})
                </Text>
                <Box flexDirection="column">
                  {agentTasks.map(item => (
                    <Item key={item.id} item={item} isSelected={item.id === currentSelection?.id} />
                  ))}
                </Box>
              </Box>
            )}

            {completedAgentTasks.length > 0 && (
              <Box
                flexDirection="column"
                marginTop={
                  teammateTasks.length > 0 ||
                  bashTasks.length > 0 ||
                  mcpMonitors.length > 0 ||
                  remoteSessions.length > 0 ||
                  agentTasks.length > 0
                    ? 1
                    : 0
                }
              >
                <Text dimColor>
                  <Text bold>{'  '}Completed</Text> ({completedAgentTasks.length})
                </Text>
                <Box flexDirection="column">
                  {completedAgentTasks.map(item => (
                    <Item key={item.id} item={item} isSelected={item.id === currentSelection?.id} />
                  ))}
                </Box>
              </Box>
            )}

            {workflowTasks.length > 0 && (
              <Box
                flexDirection="column"
                marginTop={
                  teammateTasks.length > 0 ||
                  bashTasks.length > 0 ||
                  mcpMonitors.length > 0 ||
                  remoteSessions.length > 0 ||
                  agentTasks.length > 0 ||
                  completedAgentTasks.length > 0
                    ? 1
                    : 0
                }
              >
                <Text dimColor>
                  <Text bold>{'  '}Dynamic workflows</Text> ({workflowTasks.length})
                </Text>
                <Box flexDirection="column">
                  {workflowTasks.map(item => (
                    <Item key={item.id} item={item} isSelected={item.id === currentSelection?.id} />
                  ))}
                </Box>
              </Box>
            )}

            {dreamTasks.length > 0 && (
              <Box
                flexDirection="column"
                marginTop={
                  teammateTasks.length > 0 ||
                  bashTasks.length > 0 ||
                  mcpMonitors.length > 0 ||
                  remoteSessions.length > 0 ||
                  agentTasks.length > 0 ||
                  completedAgentTasks.length > 0 ||
                  workflowTasks.length > 0
                    ? 1
                    : 0
                }
              >
                <Box flexDirection="column">
                  {dreamTasks.map(item => (
                    <Item key={item.id} item={item} isSelected={item.id === currentSelection?.id} />
                  ))}
                </Box>
              </Box>
            )}

            {autoModeScanTasks.length > 0 && (
              <Box
                flexDirection="column"
                marginTop={
                  teammateTasks.length > 0 ||
                  bashTasks.length > 0 ||
                  mcpMonitors.length > 0 ||
                  remoteSessions.length > 0 ||
                  agentTasks.length > 0 ||
                  completedAgentTasks.length > 0 ||
                  workflowTasks.length > 0 ||
                  dreamTasks.length > 0
                    ? 1
                    : 0
                }
              >
                <Box flexDirection="column">
                  {autoModeScanTasks.map(item => (
                    <Item key={item.id} item={item} isSelected={item.id === currentSelection?.id} />
                  ))}
                </Box>
              </Box>
            )}
          </Box>
        )}
      </Dialog>
    </Box>
  );
}

function toListItem(task: TaskState): ListItem {
  switch (task.type) {
    case 'local_bash':
      return {
        id: task.id,
        type: 'local_bash',
        label: task.kind === 'monitor' ? task.description : task.command,
        status: task.status,
        task,
      };
    case 'remote_agent':
      return {
        id: task.id,
        type: 'remote_agent',
        label: task.title,
        status: task.status,
        task,
      };
    case 'local_agent':
      return {
        id: task.id,
        type: 'local_agent',
        label: task.description,
        status: task.status,
        task,
      };
    case 'in_process_teammate':
      return {
        id: task.id,
        type: 'in_process_teammate',
        label: `@${task.identity.agentName}`,
        status: task.status,
        task,
      };
    case 'local_workflow':
      return {
        id: task.id,
        type: 'local_workflow',
        label: task.summary ?? task.description,
        status: task.status,
        task,
      };
    case 'monitor_mcp':
      return {
        id: task.id,
        type: 'monitor_mcp',
        label: task.description,
        status: task.status,
        task,
      };
    case 'monitor_ws':
      return {
        id: task.id,
        type: 'monitor_ws',
        label: task.description,
        status: task.status,
        task,
      };
    case 'dream':
      return {
        id: task.id,
        type: 'dream',
        label: task.description,
        status: task.status,
        task,
      };
    case 'auto_mode_scan':
      return {
        id: task.id,
        type: 'auto_mode_scan',
        label: task.description,
        status: task.status,
        task,
      };
  }
}

function Item({ item, isSelected }: { item: ListItem; isSelected: boolean }): ReactNode {
  const { columns } = useTerminalSize();
  // Dialog border (2) + padding (2) + pointer prefix (2) + name/status overhead (~20)
  const maxActivityWidth = Math.max(30, columns - 26);
  // In coordinator mode, use grey pointer instead of blue
  const useGreyPointer = isCoordinatorMode();

  return (
    <Box flexDirection="row">
      <Text dimColor={useGreyPointer && isSelected}>{isSelected ? figures.pointer + ' ' : '  '}</Text>
      <Text color={isSelected && !useGreyPointer ? 'suggestion' : undefined}>
        {item.type === 'leader' ? (
          <Text>@{TEAM_LEAD_NAME}</Text>
        ) : (
          <BackgroundTaskComponent task={item.task} maxActivityWidth={maxActivityWidth} />
        )}
      </Text>
    </Box>
  );
}

function TeammateTaskGroups({
  teammateTasks,
  currentSelectionId,
}: {
  teammateTasks: ListItem[];
  currentSelectionId: string | undefined;
}): ReactNode {
  // Separate leader from teammates, group teammates by team
  const leaderItems = teammateTasks.filter(i => i.type === 'leader');
  const teammateItems = teammateTasks.filter(i => i.type === 'in_process_teammate');
  const teams = new Map<string, typeof teammateItems>();
  for (const item of teammateItems) {
    const teamName = item.task.identity.teamName;
    const group = teams.get(teamName);
    if (group) {
      group.push(item);
    } else {
      teams.set(teamName, [item]);
    }
  }
  const teamEntries = [...teams.entries()];
  return (
    <>
      {teamEntries.map(([teamName, items]) => {
        const memberCount = items.length + leaderItems.length;
        return (
          <Box key={teamName} flexDirection="column">
            <Text dimColor>
              {'  '}Team: {teamName} ({memberCount})
            </Text>
            {/* Render leader first within each team */}
            {leaderItems.map(item => (
              <Item key={`${item.id}-${teamName}`} item={item} isSelected={item.id === currentSelectionId} />
            ))}
            {items.map(item => (
              <Item key={item.id} item={item} isSelected={item.id === currentSelectionId} />
            ))}
          </Box>
        );
      })}
    </>
  );
}
