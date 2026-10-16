/**
 * CoordinatorTaskPanel — Steerable list of background agents.
 *
 * Renders below the prompt input footer whenever local_agent tasks exist.
 * Visibility is driven by evictAfter: undefined (running/retained) shows
 * always; a timestamp shows until passed. Enter to view/steer, x to dismiss.
 */

import figures from 'figures';
import * as React from 'react';
import { BLACK_CIRCLE } from '../constants/figures.js';
import { useSubagentStatusLine } from '../hooks/useSubagentStatusLine.js';
import { Ansi, Box, Text, stringWidth } from '@anthropic/ink';
import { type AppState, useAppState, useSetAppState } from '../state/AppState.js';
import { enterTeammateView, exitTeammateView } from '../state/teammateViewHelpers.js';
import {
  isLocalAgentPanelActive,
  isLocalAgentTask,
  type LocalAgentTaskState,
} from '../tasks/LocalAgentTask/LocalAgentTask.js';
import { isInProcessTeammateTask } from '../tasks/InProcessTeammateTask/types.js';
import { formatDuration, formatNumber } from '../utils/format.js';
import {
  collapseIdlePanelRows,
  idleSummaryLabel,
  isIdleSummaryRow,
  isPanelListTask,
  type PanelAgentTask,
  type PanelListItem,
} from '../utils/panelIdleSummary.js';
import { evictTerminalTask } from '../utils/task/framework.js';
import { isTerminalStatus } from './tasks/taskStatusUtils.js';

/**
 * densable UQ + cAb residual — panel-managed tasks currently visible.
 * Presence in AppState.tasks IS visibility — the 1s tick in
 * CoordinatorTaskPanel evicts tasks past their evictAfter deadline. The
 * evictAfter !== 0 check handles immediate dismiss (x key) without making
 * the filter time-dependent. Shared by panel render, useCoordinatorTaskCount,
 * and index resolvers so the math can't drift.
 *
 * densable UQ = local_agent (non-main) OR in_process_teammate.
 */
export function getVisibleAgentTasks(tasks: AppState['tasks']): PanelAgentTask[] {
  return Object.values(tasks)
    .filter((t): t is PanelAgentTask => isPanelListTask(t))
    .sort((a, b) => a.startTime - b.startTime);
}

/**
 * densable G7 empty-decoration filter: when a task has decoration.content === "",
 * hide the panel row (status-line command explicitly blanked the agent).
 * Missing decoration (undefined) keeps the row visible with default body.
 */
export function filterTasksByDecorationContent(
  tasks: PanelAgentTask[],
  decorations: AppState['taskDecorations'] | undefined,
): PanelAgentTask[] {
  if (!decorations) return tasks;
  return tasks.filter(t => decorations[t.id]?.content !== '');
}

/** densable G7 base: visible panel tasks with empty decoration content removed. */
export function getPanelVisibleAgentTasks(
  tasks: AppState['tasks'],
  decorations?: AppState['taskDecorations'],
): PanelAgentTask[] {
  return filterTasksByDecorationContent(getVisibleAgentTasks(tasks), decorations);
}

/**
 * densable G7 full panel list: decoration filter + optional idle_summary collapse
 * when idleTeammatesExpanded is false (cIa=3).
 */
export function getPanelListItems(
  tasks: AppState['tasks'],
  decorations?: AppState['taskDecorations'],
  opts?: {
    idleTeammatesExpanded?: boolean;
    viewingAgentTaskId?: string;
  },
): PanelListItem[] {
  const base = getPanelVisibleAgentTasks(tasks, decorations);
  return collapseIdlePanelRows(base, opts?.idleTeammatesExpanded ?? false, opts?.viewingAgentTaskId);
}

export function CoordinatorTaskPanel(): React.ReactNode {
  const tasks = useAppState(s => s.tasks);
  const viewingAgentTaskId = useAppState(s => s.viewingAgentTaskId);
  const agentNameRegistry = useAppState(s => s.agentNameRegistry);
  const taskDecorations = useAppState(s => s.taskDecorations ?? {});
  const coordinatorTaskIndex = useAppState(s => s.coordinatorTaskIndex);
  const tasksSelected = useAppState(s => s.footerSelection === 'tasks');
  const selectedIndex = tasksSelected ? coordinatorTaskIndex : undefined;
  const setAppState = useSetAppState();

  // densable wHa — poll subagentStatusLine → taskDecorations.
  useSubagentStatusLine();

  const idleTeammatesExpanded = useAppState(s => s.idleTeammatesExpanded ?? false);
  const visibleTasks = getPanelListItems(tasks, taskDecorations, {
    idleTeammatesExpanded,
    viewingAgentTaskId,
  });
  const hasTasks = Object.values(tasks).some(isPanelListTask);

  // 1s tick: re-render for elapsed time + evict tasks past their deadline.
  // The eviction deletes from prev.tasks, which makes useCoordinatorTaskCount
  // (and other consumers) see the updated count without their own tick.
  const tasksRef = React.useRef(tasks);
  tasksRef.current = tasks;
  const [, setTick] = React.useState(0);
  React.useEffect(() => {
    if (!hasTasks) return;
    const interval = setInterval(
      (tasksRef, setAppState, setTick) => {
        const now = Date.now();
        for (const t of Object.values(tasksRef.current)) {
          if (isPanelListTask(t) && (t.evictAfter ?? Infinity) <= now) {
            evictTerminalTask(t.id, setAppState);
          }
        }
        setTick((prev: number) => prev + 1);
      },
      1000,
      tasksRef,
      setAppState,
      setTick,
    );
    return () => clearInterval(interval);
  }, [hasTasks, setAppState]);
  const nameByAgentId = React.useMemo(() => {
    const inv = new Map<string, string>();
    for (const [n, id] of agentNameRegistry) inv.set(id, n);
    return inv;
  }, [agentNameRegistry]);

  if (visibleTasks.length === 0) {
    return null;
  }

  // densable Wq Os/es: name column 4–28, status column = max `elapsed · tokens`.
  const namedRows = visibleTasks.filter(
    (row): row is PanelAgentTask => !isIdleSummaryRow(row) && taskDecorations[row.id]?.content === undefined,
  );
  const now = Date.now();
  const labelWidth = Math.min(
    PANEL_NAME_MAX,
    Math.max(PANEL_NAME_MIN, ...namedRows.map(row => stringWidth(panelAgentName(row, nameByAgentId) ?? '')), 0),
  );
  const statusWidth = Math.max(0, ...namedRows.map(row => statusPartsWidth(getAgentStatusParts(row, now))));

  return (
    <Box flexDirection="column" marginTop={1}>
      <MainLine
        isSelected={selectedIndex === 0}
        isViewed={viewingAgentTaskId === undefined}
        labelWidth={labelWidth}
        onClick={() => exitTeammateView(setAppState)}
      />
      {visibleTasks.map((row, i) =>
        isIdleSummaryRow(row) ? (
          <IdleSummaryLine
            key={row.id}
            count={row.taskIds.length}
            isSelected={selectedIndex === i + 1}
            onClick={() =>
              setAppState(prev => (prev.idleTeammatesExpanded ? prev : { ...prev, idleTeammatesExpanded: true }))
            }
          />
        ) : (
          <AgentLine
            key={row.id}
            task={row}
            name={panelAgentName(row, nameByAgentId)}
            decoration={taskDecorations[row.id]}
            labelWidth={labelWidth}
            statusWidth={statusWidth}
            isSelected={selectedIndex === i + 1}
            isViewed={viewingAgentTaskId === row.id}
            onClick={() => enterTeammateView(row.id, setAppState)}
          />
        ),
      )}
    </Box>
  );
}

/**
 * Returns the number of visible coordinator tasks (for selection bounds).
 * The panel's 1s tick evicts expired tasks from prev.tasks, so this count
 * stays accurate without needing its own tick.
 */
export function useCoordinatorTaskCount(): number {
  const tasks = useAppState(s => s.tasks);
  const taskDecorations = useAppState(s => s.taskDecorations ?? {});
  const idleTeammatesExpanded = useAppState(s => s.idleTeammatesExpanded ?? false);
  const viewingAgentTaskId = useAppState(s => s.viewingAgentTaskId);
  return React.useMemo(() => {
    // densable MIe — no USER_TYPE ant gate.
    const count = getPanelListItems(tasks, taskDecorations, {
      idleTeammatesExpanded,
      viewingAgentTaskId,
    }).length;
    return count > 0 ? count + 1 : 0;
  }, [tasks, taskDecorations, idleTeammatesExpanded, viewingAgentTaskId]);
}

/** densable _rf — collapsed idle agents summary row. */
function IdleSummaryLine({
  count,
  isSelected,
  onClick,
}: {
  count: number;
  isSelected?: boolean;
  onClick: () => void;
}): React.ReactNode {
  const [hover, setHover] = React.useState(false);
  const highlighted = isSelected || hover;
  const prefix = highlighted ? figures.pointer + ' ' : '  ';
  const dim = !highlighted;
  return (
    <Box onClick={onClick} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <Text dimColor={dim}>
        {prefix}
        {figures.circle} {idleSummaryLabel(count)}
      </Text>
    </Box>
  );
}

/** densable Tg — `  ` + bullet + space. */
function prefixWidth(): number {
  return 2 + Math.max(stringWidth(figures.circle), stringWidth(BLACK_CIRCLE)) + 1;
}

const PANEL_NAME_MIN = 4;
const PANEL_NAME_MAX = 28;

function panelAgentName(task: PanelAgentTask, nameByAgentId: Map<string, string>): string | undefined {
  if (isInProcessTeammateTask(task)) return task.identity.agentName;
  return nameByAgentId.get(task.id) ?? task.agentType;
}

type AgentStatusParts = {
  elapsed: string;
  tokenText: string;
  queuedText: string;
  queuedCount: number;
};

/** densable $Ae / yZ Pe — elapsed + tokens, no pause/play glyph. */
function getAgentStatusParts(task: PanelAgentTask, now: number): AgentStatusParts {
  const isTeammate = isInProcessTeammateTask(task);
  const isIdleTeammate = isTeammate && task.isIdle;
  const localAgent = !isTeammate && isLocalAgentTask(task) ? (task as LocalAgentTaskState) : null;
  const isAdopting = localAgent !== null && Boolean(localAgent.adoptResumePending || localAgent.resuming);
  const isIdleLocalAgent = localAgent !== null && !isAdopting && Boolean(localAgent.isIdle);
  const isIdleRow = isIdleTeammate || isIdleLocalAgent;
  const isPanelActive = localAgent !== null ? isLocalAgentPanelActive(localAgent) : !isTerminalStatus(task.status);
  const isRunning = isPanelActive && !isIdleRow;
  const pausedMs = (task as LocalAgentTaskState).totalPausedMs ?? 0;
  const elapsedMs = Math.max(
    0,
    isRunning ? now - task.startTime - pausedMs : (task.endTime ?? task.startTime) - task.startTime - pausedMs,
  );
  const elapsed = isAdopting
    ? 'resuming'
    : isIdleTeammate
      ? 'idle'
      : isIdleLocalAgent
        ? 'waiting'
        : isTeammate && task.awaitingPlanApproval && task.status === 'running'
          ? 'awaiting approval'
          : formatDuration(elapsedMs);
  const tokenCount = task.progress?.tokenCount;
  const lastActivity = task.progress?.lastActivity;
  const arrow = lastActivity ? figures.arrowDown : figures.arrowUp;
  const tokenText =
    !isIdleRow && tokenCount !== undefined && tokenCount > 0 ? `${arrow} ${formatNumber(tokenCount)} tokens` : '';
  const queuedCount = isTeammate
    ? task.pendingUserMessages.length
    : (task as LocalAgentTaskState).pendingMessages.length;
  const queuedText = queuedCount > 0 ? `${queuedCount} queued` : '';
  return { elapsed, tokenText, queuedText, queuedCount };
}

function statusPartsWidth(parts: AgentStatusParts): number {
  return stringWidth([parts.elapsed, parts.tokenText, parts.queuedText].filter(Boolean).join(' · '));
}

function MainLine({
  isSelected,
  isViewed,
  labelWidth,
  onClick,
}: {
  isSelected?: boolean;
  isViewed?: boolean;
  labelWidth: number;
  onClick: () => void;
}): React.ReactNode {
  const [hover, setHover] = React.useState(false);
  const prefix = isSelected || hover ? figures.pointer + ' ' : '  ';
  const bullet = isViewed ? BLACK_CIRCLE : figures.circle;
  const dim = !isSelected && !isViewed && !hover;
  return (
    <Box onClick={onClick} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <Box width={prefixWidth() + labelWidth} flexShrink={0}>
        <Text dimColor={dim} bold={isViewed}>
          {prefix}
          {bullet} main
        </Text>
      </Box>
    </Box>
  );
}

type AgentLineProps = {
  task: PanelAgentTask;
  name?: string;
  /** densable taskDecorations[id] — custom status content replaces default row body. */
  decoration?: { content: string };
  labelWidth: number;
  statusWidth: number;
  isSelected?: boolean;
  isViewed?: boolean;
  onClick?: () => void;
};

function AgentLine({
  task,
  name,
  decoration,
  labelWidth,
  statusWidth,
  isSelected,
  isViewed,
  onClick,
}: AgentLineProps): React.ReactNode {
  const [hover, setHover] = React.useState(false);
  const { elapsed, tokenText, queuedText, queuedCount } = getAgentStatusParts(task, Date.now());
  const displayDescription = task.progress?.summary || task.description;
  const highlighted = isSelected || hover;
  const prefix = highlighted ? figures.pointer + ' ' : '  ';
  const bullet = isViewed ? BLACK_CIRCLE : figures.circle;
  const dim = !highlighted && !isViewed;
  const displayName = name ?? (isLocalAgentTask(task) ? task.agentType : undefined);
  const statusText = [elapsed, tokenText].filter(Boolean).join(' · ');

  // densable yrf: when decoration.content is set, replace name+desc+status with Ansi content.
  if (decoration?.content !== undefined) {
    const gutter = (
      <Text dimColor={dim} bold={isViewed}>
        {prefix}
        {bullet}{' '}
      </Text>
    );
    const body = (
      <Box flexGrow={1} width={0}>
        <Text dimColor={dim} bold={isViewed} wrap="truncate">
          <Ansi>{decoration.content}</Ansi>
        </Text>
      </Box>
    );
    const row = (
      <Box>
        <Box flexShrink={0}>{gutter}</Box>
        {body}
      </Box>
    );
    if (!onClick) return row;
    return (
      <Box onClick={onClick} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
        {row}
      </Box>
    );
  }

  const gutter = (
    <Box width={prefixWidth()} flexShrink={0}>
      <Text dimColor={dim} bold={isViewed}>
        {prefix}
        {bullet}{' '}
      </Text>
    </Box>
  );
  const nameBox = (
    <Box width={labelWidth} flexShrink={0}>
      <Text bold={isViewed} dimColor={!displayName && dim} wrap="truncate">
        {displayName ?? ''}
      </Text>
    </Box>
  );
  const descBox = (
    <Box flexGrow={1} width={0} paddingLeft={2}>
      <Text dimColor={dim} bold={isViewed} wrap="truncate">
        {displayDescription}
      </Text>
    </Box>
  );
  const statusBox = (
    <Box minWidth={statusWidth} flexShrink={0} marginLeft={1} justifyContent="flex-end">
      <Text dimColor={dim} bold={isViewed}>
        {statusText}
        {queuedCount > 0 ? (
          <Text color="warning">
            {statusText ? ' · ' : ''}
            {queuedText}
          </Text>
        ) : null}
      </Text>
    </Box>
  );

  const row = (
    <Box>
      {gutter}
      {nameBox}
      {descBox}
      {statusBox}
    </Box>
  );

  if (!onClick) return row;
  return (
    <Box onClick={onClick} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      {row}
    </Box>
  );
}
