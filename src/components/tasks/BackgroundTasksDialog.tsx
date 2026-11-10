import { feature } from 'bun:bundle';
import React, { type ReactNode, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { getIsInteractive } from 'src/bootstrap/state.js';
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
import { Box, Byline, Dialog, KeyboardShortcutHint, type KeyboardEvent, Text } from '@anthropic/ink';
import type { CommandResultDisplay } from '../../commands.js';
import { stopUltraplan } from '../../commands/ultraplan.js';
import { useRegisterOverlay } from '../../context/overlayContext.js';
import type { ExitState } from '../../hooks/useExitOnCtrlCDWithKeybindings.js';
import { useShortcutDisplay } from '../../keybindings/useShortcutDisplay.js';
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js';
import type { AppState } from '../../state/AppStateStore.js';
import { count } from '../../utils/array.js';
import { truncateToWidth } from '../../utils/format.js';
import { toInkColor } from '../../utils/ink.js';
import { enqueuePendingNotification } from '../../utils/messageQueueManager.js';
import { isScreenReaderModeEnabled } from '../../utils/screenReaderGate.js';
import { ConfirmSelect } from '../ConfirmSelect.js';
import { Select } from '../CustomSelect/select.js';
import { ItemList } from '../ItemList.js';
import { AsyncAgentDetailDialog } from './AsyncAgentDetailDialog.js';
import { AutoModeScanDetailDialog } from './AutoModeScanDetailDialog.js';
import { getBackgroundTaskItemPresentation } from './BackgroundTask.js';
import { DreamDetailDialog } from './DreamDetailDialog.js';
import { InProcessTeammateDetailDialog } from './InProcessTeammateDetailDialog.js';
import { RemoteSessionDetailDialog } from './RemoteSessionDetailDialog.js';
import { RemoteSessionProgress } from './RemoteSessionProgress.js';
import { ShellDetailDialog } from './ShellDetailDialog.js';
import { describeTeammateActivity } from './taskStatusUtils.js';

type ViewState =
  | { mode: 'list' }
  | { mode: 'actions'; itemId: string }
  | { mode: 'detail'; itemId: string }
  | { mode: 'confirmStopReview'; itemId: string };

type TaskAction = 'view' | 'foreground' | 'stop';

const ACTION_LABELS: Record<TaskAction, string> = {
  view: 'View',
  foreground: 'Foreground',
  stop: 'Stop',
};

const ACTIONS_HEADING_RESERVE = 16;

type Props = {
  onDone: (result?: string, options?: { display?: CommandResultDisplay }) => void;
  toolUseContext: ToolUseContext;
  initialDetailTaskId?: string;
  /** densable xCs onBack — detail ← prefers this over auto-dismiss. */
  onBack?: () => void;
  /** densable xCs promptVisibleBelow — passed through to WorkflowDetailDialog. */
  promptVisibleBelow?: boolean;
};

const SYSTEM_TASKS_LABEL = 'System tasks';

/**
 * densable wF — Enter / auto-open may open a detail host.
 * Official excludes mcp_task (no local type), monitor_ws (list + x only), and
 * the folded self_managed_tasks row.
 */
export function canOpenBackgroundTaskDetail(type: string): boolean {
  return type !== 'mcp_task' && type !== 'monitor_ws' && type !== 'self_managed_tasks';
}

/**
 * densable dSe — ambient self-managed monitor_ws task folded under System tasks.
 */
export function isSelfManagedBackgroundTask(task: TaskState): boolean {
  return task.type === 'monitor_ws' && task.ambient === true && task.frameLive?.explicit !== true;
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
    }
  | {
      id: string;
      type: 'self_managed_tasks';
      label: string;
      status: 'running';
      size: number;
      firstTaskId: string;
    };

// WORKFLOW_SCRIPTS is ant-only (build_flags.yaml). Static imports would leak
// ~1.3K lines into external builds. Gate with feature() + require so the
// bundler can dead-code-eliminate the branch.
/* eslint-disable @typescript-eslint/no-require-imports */
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

async function stopRemoteReview(
  taskId: string,
  source: 'task_list' | 'task_detail',
  setAppState: (f: (prev: AppState) => AppState) => void,
): Promise<void> {
  await RemoteAgentTask.kill(taskId, setAppState);
  logEvent('tengu_review_remote_stopped', {
    source: source as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  });
  enqueuePendingNotification({
    value:
      'Ultrareview stopped. Run /ultrareview to start a new review, which uses one of your free ultrareviews or bills as usage credits.',
    mode: 'task-notification',
  });
  enqueuePendingNotification({
    value:
      'The user stopped the ultrareview session above. Do not respond to the stop notification — wait for their next message.',
    mode: 'task-notification',
    isMeta: true,
  });
}

function ConfirmStopReviewDialog({ onStop, onBack }: { onStop: () => void; onBack: () => void }): React.ReactNode {
  const handledRef = useRef(false);
  const handleChoice = (choice: 'stop' | 'back') => {
    if (handledRef.current) return;
    handledRef.current = true;
    if (choice === 'stop') onStop();
    else onBack();
  };
  return (
    <Dialog
      title="Stop ultrareview?"
      onCancel={onBack}
      color="background"
      inputGuide={
        <Byline>
          <KeyboardShortcutHint shortcut="Enter" action="select" />
          <KeyboardShortcutHint shortcut="Esc" action="go back" />
        </Byline>
      }
    >
      <Box flexDirection="column" gap={1}>
        <Text dimColor>
          This archives the cloud session and stops local tracking. The review will not complete and any findings so far
          are discarded.
        </Text>
        <ConfirmSelect
          confirmLabel="Stop ultrareview"
          cancelLabel="Back"
          cancelFirst
          focus="cancel"
          hideIndexes
          onConfirm={() => handleChoice('stop')}
          onCancel={() => handleChoice('back')}
        />
      </Box>
    </Dialog>
  );
}

// Helper to get filtered background tasks (excludes self-managed ambient monitors)
function getSelectableBackgroundTasks(tasks: Record<string, TaskState> | undefined): TaskState[] {
  return Object.values(tasks ?? {}).filter(
    task => isBackgroundTasksDialogRow(task) && !isSelfManagedBackgroundTask(task),
  );
}

export function BackgroundTasksDialog({
  onDone,
  toolUseContext,
  initialDetailTaskId,
  onBack,
  promptVisibleBelow = false,
}: Props): React.ReactNode {
  const tasks = useAppState(s => s.tasks);
  const setAppState = useSetAppState();
  const { rows: termRows, columns: termColumns } = useTerminalSize();
  const screenReader = isScreenReaderModeEnabled();
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
    const allItems = getSelectableBackgroundTasks(typedTasks);
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

  const [showSystemTasks, setShowSystemTasks] = useState(false);

  // densable 247: live index ref so same-tick focus + select/keydown reads latest item.
  const [selectedIndex, setSelectedIndexState] = useState<number>(0);
  const selectedIndexLive = useRef(0);
  const selectedIdRef = useRef<string | undefined>(undefined);
  const setSelectedIndex = (action: React.SetStateAction<number>): void => {
    const next = typeof action === 'function' ? action(selectedIndexLive.current) : action;
    selectedIndexLive.current = next;
    setSelectedIndexState(next);
  };

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
    teams,
    workflowTasks,
    mcpMonitors,
    dreamTasks,
    autoModeScanTasks,
    selfManagedTasks,
    rows,
    allSelectableItems,
  } = useMemo(() => {
    // densable r5c — running/pending bO plus parked-idle completed local_agent
    const backgroundTasks = Object.values(typedTasks ?? {}).filter(isBackgroundTasksDialogRow);
    const selfManagedIds = new Set(backgroundTasks.filter(isSelfManagedBackgroundTask).map(t => t.id));
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
    const visibleItems = sorted.filter(item => !selfManagedIds.has(item.id));
    const rawSelfManaged = sorted.filter(item => selfManagedIds.has(item.id));
    const firstSelfManaged = rawSelfManaged[0];
    const selfManaged: ListItem[] =
      showSystemTasks || firstSelfManaged === undefined
        ? rawSelfManaged
        : [
            {
              id: '__self_managed_tasks__',
              type: 'self_managed_tasks',
              label: SYSTEM_TASKS_LABEL,
              status: 'running',
              size: rawSelfManaged.length,
              firstTaskId: firstSelfManaged.id,
            },
          ];

    const bash = visibleItems.filter(item => item.type === 'local_bash');
    const remote = visibleItems.filter(item => item.type === 'remote_agent');
    const agents = visibleItems.filter(item => item.type === 'local_agent');
    const agent = agents.filter(item => !isCompletedAgentListItem(item));
    const completed = agents.filter(isCompletedAgentListItem);
    const workflows = visibleItems.filter(item => item.type === 'local_workflow');
    const monitorMcp = visibleItems.filter(item => item.type === 'monitor_mcp' || item.type === 'monitor_ws');
    const dream = visibleItems.filter(item => item.type === 'dream');
    const autoModeScan = visibleItems.filter(item => item.type === 'auto_mode_scan');

    const teamMap = new Map<string, Extract<ListItem, { type: 'in_process_teammate' }>[]>();
    for (const item of visibleItems) {
      if (item.type !== 'in_process_teammate') continue;
      const group = teamMap.get(item.task.identity.teamName);
      if (group) group.push(item);
      else teamMap.set(item.task.identity.teamName, [item]);
    }
    const teammates = [...teamMap.values()].flat();
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
    const teamEntries = [...teamMap.entries()];
    const listRows: ListItem[] = [
      ...teamEntries.flatMap(([, members]) => [...leaderItem, ...members]),
      ...bash,
      ...monitorMcp,
      ...remote,
      ...agent,
      ...completed,
      ...workflows,
      ...dream,
      ...autoModeScan,
      ...selfManaged,
    ];
    const selectableItems: ListItem[] = [
      ...leaderItem,
      ...teammates,
      ...bash,
      ...monitorMcp,
      ...remote,
      ...agent,
      ...completed,
      ...workflows,
      ...dream,
      ...autoModeScan,
      ...selfManaged,
    ];
    return {
      bashTasks: bash,
      remoteSessions: remote,
      agentTasks: agent,
      completedAgentTasks: completed,
      workflowTasks: workflows,
      mcpMonitors: monitorMcp,
      dreamTasks: dream,
      autoModeScanTasks: autoModeScan,
      selfManagedTasks: selfManaged,
      teammateTasks: [...leaderItem, ...teammates],
      teams: teamEntries,
      rows: listRows,
      allSelectableItems: selectableItems,
    };
  }, [typedTasks, showSystemTasks]);

  const currentSelection =
    (selectedIdRef.current ? allSelectableItems.find(i => i.id === selectedIdRef.current) : undefined) ??
    rows[selectedIndex] ??
    allSelectableItems[selectedIndex] ??
    null;

  const prevRowsRef = useRef<ListItem[] | null>(null);
  const ignoreNextKillRef = useRef(false);
  const optionToRowIndexRef = useRef<Map<number, number>>(new Map());

  // densable sAt: keep the cursor on the same id when the list mutates; the
  // following x is ignored if the focused row vanished so a shifted row is not
  // killed by accident.
  useEffect(() => {
    if (prevRowsRef.current === null) {
      prevRowsRef.current = rows;
      selectedIdRef.current = rows[0]?.id;
      return;
    }
    prevRowsRef.current = rows;
    const prevId = selectedIdRef.current;
    if (prevId !== undefined) {
      const nextIdx = rows.findIndex(r => r.id === prevId);
      if (nextIdx !== -1) {
        if (nextIdx !== selectedIndexLive.current) {
          setSelectedIndex(nextIdx);
        }
        return;
      }
      ignoreNextKillRef.current = true;
    }
    const clamped = Math.max(0, Math.min(selectedIndexLive.current, Math.max(rows.length - 1, 0)));
    selectedIdRef.current = rows[clamped]?.id;
    setSelectedIndex(clamped);
  }, [rows]);

  const handleRowFocus = (rawIndex: number): void => {
    const index = optionToRowIndexRef.current.get(rawIndex) ?? rawIndex;
    const nextId = rows[index]?.id;
    const prevId = selectedIdRef.current;
    const rowsChanged = prevRowsRef.current !== rows;
    selectedIdRef.current = nextId;
    prevRowsRef.current = rows;
    if (!rowsChanged) {
      ignoreNextKillRef.current = false;
    } else if (prevId !== undefined && prevId !== nextId) {
      ignoreNextKillRef.current = !rows.some(r => r.id === prevId);
    }
    setSelectedIndex(index);
  };

  const openItem = (current: ListItem): void => {
    if (current.type === 'self_managed_tasks') {
      selectedIdRef.current = current.firstTaskId;
      setShowSystemTasks(true);
    } else if (current.type === 'leader') {
      exitTeammateView(setAppState);
      onDone('Viewing leader', { display: 'system' });
    } else if (isCompletedAgentListItem(current)) {
      // densable kCs → pje: completed unparked agent is foregrounded, not detailed
      enterTeammateView(current.id, setAppState);
      onDone('Viewing agent', { display: 'system' });
    } else if (canOpenBackgroundTaskDetail(current.type)) {
      setViewState({ mode: 'detail', itemId: current.id });
    }
  };

  const foregroundItem = (currentSelection: ListItem): boolean => {
    if (currentSelection.type === 'in_process_teammate' && currentSelection.status === 'running') {
      enterTeammateView(currentSelection.id, setAppState);
      onDone('Viewing teammate', { display: 'system' });
      return true;
    }
    if (
      currentSelection.type === 'local_agent' &&
      isPanelAgentTask(currentSelection.task) &&
      !isCompletedAgentListItem(currentSelection)
    ) {
      enterTeammateView(currentSelection.id, setAppState);
      onDone('Viewing agent', { display: 'system' });
      return true;
    }
    if (currentSelection.type === 'leader') {
      exitTeammateView(setAppState);
      onDone('Viewing leader', { display: 'system' });
      return true;
    }
    return false;
  };

  const stopItem = (currentSelection: ListItem): void => {
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
      } else if (currentSelection.task.isRemoteReview) {
        setViewState({ mode: 'confirmStopReview', itemId: currentSelection.id });
      } else {
        void killRemoteAgentTask(currentSelection.id);
      }
    }
  };

  const handleRowSelect = (rawIndex: number): void => {
    const index = optionToRowIndexRef.current.get(rawIndex) ?? rawIndex;
    setSelectedIndex(index);
    const current = rows[index] ?? allSelectableItems[selectedIndexLive.current];
    if (!current) return;
    if (!screenReader || current.type === 'self_managed_tasks') {
      openItem(current);
      return;
    }
    if (getActionsForItem(current).length > 0) {
      setViewState({ mode: 'actions', itemId: current.id });
    }
  };

  const handleActionSelect = (action: TaskAction, item: ListItem): void => {
    setViewState({ mode: 'list' });
    switch (action) {
      case 'view':
        openItem(item);
        return;
      case 'foreground':
        foregroundItem(item);
        return;
      case 'stop':
        stopItem(item);
        return;
    }
  };

  // Component-specific shortcuts (x=stop, f=foreground) shown in UI.
  // Note: left arrow no longer dismisses the list dialog in 2.1.289 (Esc only).
  const handleKeyDown = (e: KeyboardEvent) => {
    if (viewState.mode !== 'list') return;

    const currentSelection = rows[selectedIndexLive.current] ?? allSelectableItems[selectedIndexLive.current];
    if (!currentSelection) return;

    if (e.key === 'x' && !e.ctrl && !e.meta) {
      e.preventDefault();
      if (ignoreNextKillRef.current) {
        ignoreNextKillRef.current = false;
        return;
      }
      stopItem(currentSelection);
    }

    if (e.key === 'f' && !e.ctrl && !e.meta) {
      if (foregroundItem(currentSelection)) {
        e.preventDefault();
      }
    }
  };

  async function killShellTask(taskId: string): Promise<void> {
    await LocalShellTask.kill(taskId, setAppState);
  }

  async function killAgentTask(taskId: string): Promise<void> {
    const snapshot = toolUseContext.getAppState().tasks?.[taskId] as LocalAgentTaskState | undefined;
    if (snapshot?.type === 'local_agent' && snapshot.isObserver) {
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

  const onDoneEvent = useEffectEvent(onDone);

  useEffect(() => {
    if (viewState.mode === 'actions') {
      if (!allSelectableItems.some(item => item.id === viewState.itemId)) {
        setViewState({ mode: 'list' });
      }
      return;
    }
    if (viewState.mode !== 'list') {
      const task = (typedTasks ?? {})[viewState.itemId];
      if (!task || (task.type !== 'local_workflow' && !isBackgroundTasksDialogRow(task))) {
        if (skippedListOnMount.current) {
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
  }, [viewState, typedTasks, allSelectableItems, onDoneEvent]);

  const goBackToList = () => {
    if (onBack) {
      onBack();
    } else if (skippedListOnMount.current && allSelectableItems.length <= 1) {
      onDone('Background dialog dismissed', { display: 'skip' });
    } else {
      skippedListOnMount.current = false;
      setViewState({ mode: 'list' });
    }
  };

  const hasMultipleRunningLocalAgents = count(agentTasks, t => t.status === 'running') > 1;

  // If an item is selected, show the appropriate view
  if (viewState.mode !== 'list' && viewState.mode !== 'actions' && typedTasks) {
    const task = typedTasks[viewState.itemId];
    if (!task) {
      return null;
    }

    if (viewState.mode === 'confirmStopReview') {
      return (
        <ConfirmStopReviewDialog
          onStop={() => {
            void stopRemoteReview(viewState.itemId, 'task_list', setAppState);
            setViewState({ mode: 'list' });
          }}
          onBack={() => setViewState({ mode: 'list' })}
        />
      );
    }

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
            killAllAgentsShortcut={hasMultipleRunningLocalAgents ? killAgentsShortcut : undefined}
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
                  : task.isRemoteReview
                    ? () => void stopRemoteReview(task.id, 'task_detail', setAppState)
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
        if (!WorkflowDetailDialog) return null;
        const onKill =
          task.status === 'running'
            ? () => {
                const runId = task.workflowRunId ?? task.id;
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
            onDone={onDone}
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
    ...(screenReader
      ? []
      : [
          <KeyboardShortcutHint key="upDown" shortcut="↑/↓" action="select" />,
          ...(!currentSelection || canOpenBackgroundTaskDetail(currentSelection.type)
            ? [<KeyboardShortcutHint key="enter" shortcut="Enter" action="view" />]
            : []),
          ...(currentSelection?.type === 'self_managed_tasks'
            ? [<KeyboardShortcutHint key="show" shortcut="Enter" action="show" />]
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
            ? [<KeyboardShortcutHint key="kill" shortcut="x" action="stop" />]
            : []),
        ]),
    ...(currentSelection?.type === 'local_agent' &&
    canStopItem(currentSelection) &&
    hasMultipleRunningLocalAgents &&
    killAgentsShortcut
      ? [<KeyboardShortcutHint key="kill-all" shortcut={killAgentsShortcut} action="stop all agents" />]
      : []),
    <KeyboardShortcutHint key="esc" shortcut="Esc" action={viewState.mode === 'actions' ? 'go back' : 'close'} />,
  ];

  const handleCancel = () => {
    if (viewState.mode === 'actions') {
      setViewState({ mode: 'list' });
      return;
    }
    onDone('Background dialog dismissed', { display: 'skip' });
  };

  function renderInputGuide(exitState: ExitState): React.ReactNode {
    if (exitState.pending) {
      return <Text>Press {exitState.keyName} again to exit</Text>;
    }
    return <Byline>{actions}</Byline>;
  }

  const sections = useMemo(
    () =>
      [
        {
          key: 'agents',
          items: teammateTasks,
          heading:
            bashTasks.length > 0 ||
            remoteSessions.length > 0 ||
            agentTasks.length > 0 ||
            completedAgentTasks.length > 0 ? (
              <Text dimColor>
                <Text bold>{'  '}Agents</Text> ({count(teammateTasks, i => i.type !== 'leader')})
              </Text>
            ) : null,
        },
        {
          key: 'shells',
          items: bashTasks,
          heading:
            teammateTasks.length > 0 ||
            remoteSessions.length > 0 ||
            agentTasks.length > 0 ||
            completedAgentTasks.length > 0 ? (
              <Text dimColor>
                <Text bold>{'  '}Shells</Text> ({bashTasks.length})
              </Text>
            ) : null,
        },
        {
          key: 'monitors',
          items: mcpMonitors,
          heading: (
            <Text dimColor>
              <Text bold>{'  '}Monitors</Text> ({mcpMonitors.length})
            </Text>
          ),
        },
        {
          key: 'cloud-agents',
          items: remoteSessions,
          heading: (
            <Text dimColor>
              <Text bold>{'  '}Cloud agents</Text> ({remoteSessions.length})
            </Text>
          ),
        },
        {
          key: 'local-agents',
          items: agentTasks,
          heading: (
            <Text dimColor>
              <Text bold>{'  '}Local agents</Text> ({agentTasks.length})
            </Text>
          ),
        },
        {
          key: 'completed',
          items: completedAgentTasks,
          heading: (
            <Text dimColor>
              <Text bold>{'  '}Completed</Text> ({completedAgentTasks.length})
            </Text>
          ),
        },
        {
          key: 'workflows',
          items: workflowTasks,
          heading: (
            <Text dimColor>
              <Text bold>{'  '}Dynamic workflows</Text> ({workflowTasks.length})
            </Text>
          ),
        },
        { key: 'dream', items: dreamTasks, heading: null },
        { key: 'auto-mode-scan', items: autoModeScanTasks, heading: null },
        {
          key: 'self-managed',
          items: selfManagedTasks,
          heading: showSystemTasks ? (
            <Text dimColor>
              <Text bold>
                {'  '}
                {SYSTEM_TASKS_LABEL}
              </Text>{' '}
              ({selfManagedTasks.length})
            </Text>
          ) : null,
        },
      ].filter(section => section.items.length > 0),
    [
      teammateTasks,
      bashTasks,
      mcpMonitors,
      remoteSessions,
      agentTasks,
      completedAgentTasks,
      workflowTasks,
      dreamTasks,
      autoModeScanTasks,
      selfManagedTasks,
      showSystemTasks,
    ],
  );

  const { itemListOptions, optionToRowIndex, rowToOptionIndex } = useMemo(() => {
    const options: Array<{
      label: ReactNode;
      value: string;
      icon?: ReactNode;
      facts?: readonly string[];
      heading?: boolean;
    }> = [];
    const optToRow = new Map<number, number>();
    const rowToOpt = new Map<number, number>();
    const leader = teammateTasks.find(i => i.type === 'leader');
    let rowIdx = 0;

    sections.forEach((section, sectionIdx) => {
      if (sectionIdx > 0) {
        options.push({
          heading: true,
          value: `${section.key}-gap`,
          label: '',
        });
      }
      if (section.heading) {
        options.push({
          heading: true,
          value: `${section.key}-heading`,
          label: section.heading,
        });
      }
      if (section.key === 'agents') {
        for (const [teamName, members] of teams) {
          options.push({
            heading: true,
            value: `${teamName}-team`,
            label: `Team: ${teamName} (${members.length + (leader ? 1 : 0)})`,
          });
          if (leader) {
            const optIdx = options.length;
            optToRow.set(optIdx, rowIdx);
            rowToOpt.set(rowIdx, optIdx);
            rowIdx++;
            options.push(buildItemListOption(leader, `${leader.id}-${teamName}`));
          }
          for (const member of members) {
            const optIdx = options.length;
            optToRow.set(optIdx, rowIdx);
            rowToOpt.set(rowIdx, optIdx);
            rowIdx++;
            options.push(buildItemListOption(member, member.id));
          }
        }
      } else {
        for (const item of section.items) {
          const optIdx = options.length;
          optToRow.set(optIdx, rowIdx);
          rowToOpt.set(rowIdx, optIdx);
          rowIdx++;
          options.push(buildItemListOption(item, item.id));
        }
      }
    });

    return { itemListOptions: options, optionToRowIndex: optToRow, rowToOptionIndex: rowToOpt };
  }, [sections, teammateTasks, teams]);

  optionToRowIndexRef.current = optionToRowIndex;

  const defaultFocusIndex = useMemo(() => {
    const rowIdx = (() => {
      if (selectedIdRef.current) {
        const found = rows.findIndex(r => r.id === selectedIdRef.current);
        if (found !== -1) return found;
      }
      return Math.min(selectedIndex, Math.max(0, rows.length - 1));
    })();
    return rowToOptionIndex.get(rowIdx) ?? rowIdx;
  }, [rows, selectedIndex, rowToOptionIndex]);

  const visibleOptionCount = Math.min(itemListOptions.length, Math.max(7, Math.floor(termRows / 2)));
  const actionsItem =
    viewState.mode === 'actions' ? allSelectableItems.find(item => item.id === viewState.itemId) : undefined;

  return (
    <Box flexDirection="column" tabIndex={0} autoFocus onKeyDown={handleKeyDown}>
      <Dialog
        title="Background"
        subtitle={<>{subtitle}</>}
        onCancel={handleCancel}
        color="background"
        inputGuide={renderInputGuide}
      >
        {actionsItem ? (
          <>
            <Text bold wrap="truncate-end">
              Actions for{' '}
              {truncateToWidth(getItemActionLabel(actionsItem), Math.max(1, termColumns - ACTIONS_HEADING_RESERVE))}
            </Text>
            <Select
              options={getActionsForItem(actionsItem).map(action => ({
                label: ACTION_LABELS[action],
                value: action,
              }))}
              onChange={action => handleActionSelect(action as TaskAction, actionsItem)}
            />
          </>
        ) : allSelectableItems.length === 0 ? (
          <Text dimColor>No tasks currently running</Text>
        ) : (
          <Box flexDirection="column">
            <ItemList
              options={itemListOptions}
              defaultFocusIndex={defaultFocusIndex}
              visibleOptionCount={visibleOptionCount}
              onFocus={handleRowFocus}
              onSelect={handleRowSelect}
            />
          </Box>
        )}
      </Dialog>
    </Box>
  );
}

function canForegroundItem(item: ListItem): boolean {
  return (
    (item.type === 'in_process_teammate' && item.status === 'running') ||
    (item.type === 'local_agent' && isPanelAgentTask(item.task) && !isCompletedAgentListItem(item))
  );
}

function canStopItem(item: ListItem): boolean {
  if (item.type === 'local_agent' && isStoppableCompletedKeepaliveAgent(item.task)) {
    return true;
  }
  return (
    item.status === 'running' &&
    (item.type === 'local_bash' ||
      item.type === 'local_agent' ||
      item.type === 'in_process_teammate' ||
      item.type === 'local_workflow' ||
      item.type === 'monitor_mcp' ||
      item.type === 'monitor_ws' ||
      item.type === 'dream' ||
      item.type === 'auto_mode_scan' ||
      item.type === 'remote_agent')
  );
}

export function getActionsForItem(item: ListItem): TaskAction[] {
  return [
    ...(canOpenBackgroundTaskDetail(item.type) ? (['view'] as const) : []),
    ...(canForegroundItem(item) ? (['foreground'] as const) : []),
    ...(canStopItem(item) ? (['stop'] as const) : []),
  ];
}

function getItemActionLabel(item: ListItem): string {
  if (item.type === 'leader' || item.type === 'self_managed_tasks') {
    return item.label;
  }
  return getBackgroundTaskItemPresentation(item.task)?.label ?? item.label;
}

function buildItemListOption(
  item: ListItem,
  valueKey: string,
): {
  label: ReactNode;
  value: string;
  icon?: ReactNode;
  facts?: readonly string[];
} {
  if (item.type === 'self_managed_tasks') {
    return {
      value: valueKey,
      label: (
        <Text>
          {item.label}
          <Text dimColor>{` · ${item.size} hidden`}</Text>
        </Text>
      ),
    };
  }
  if (item.type === 'leader') {
    return {
      value: valueKey,
      label: `@${TEAM_LEAD_NAME}`,
    };
  }
  const presentation = getBackgroundTaskItemPresentation(item.task);
  if (presentation) {
    return {
      value: valueKey,
      label: presentation.label,
      icon: presentation.icon,
      facts: presentation.facts,
    };
  }
  if (item.type === 'remote_agent') {
    return {
      value: valueKey,
      label: (
        <Text>
          <RemoteSessionProgress session={item.task} />
        </Text>
      ),
    };
  }
  if (item.type === 'in_process_teammate') {
    return {
      value: valueKey,
      label: (
        <Text wrap="truncate-end">
          <Text color={toInkColor(item.task.identity.color)}>@{item.task.identity.agentName}</Text>
          <Text dimColor>: {describeTeammateActivity(item.task)}</Text>
        </Text>
      ),
    };
  }
  return {
    value: valueKey,
    label: item.label,
  };
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
