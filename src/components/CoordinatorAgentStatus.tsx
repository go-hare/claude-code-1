/**
 * CoordinatorTaskPanel — Steerable list of background agents.
 *
 * Renders below the prompt input footer whenever local_agent tasks exist.
 * Visibility is driven by evictAfter: undefined (running/retained) shows
 * always; a timestamp shows until passed. Enter to view/steer, x to dismiss.
 */

import figures from 'figures';
import * as React from 'react';
import { BLACK_CIRCLE, PAUSE_ICON, PLAY_ICON } from '../constants/figures.js';
import { useSubagentStatusLine } from '../hooks/useSubagentStatusLine.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import { Ansi, Box, Text, stringWidth, wrapText } from '@anthropic/ink';
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

  return (
    <Box flexDirection="column" marginTop={1}>
      <MainLine
        isSelected={selectedIndex === 0}
        isViewed={viewingAgentTaskId === undefined}
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
            name={isInProcessTeammateTask(row) ? row.identity.agentName : nameByAgentId.get(row.id)}
            decoration={taskDecorations[row.id]}
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
    if ((process.env.USER_TYPE as string) !== 'ant') return 0;
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

function MainLine({
  isSelected,
  isViewed,
  onClick,
}: {
  isSelected?: boolean;
  isViewed?: boolean;
  onClick: () => void;
}): React.ReactNode {
  const [hover, setHover] = React.useState(false);
  const prefix = isSelected || hover ? figures.pointer + ' ' : '  ';
  const bullet = isViewed ? BLACK_CIRCLE : figures.circle;
  return (
    <Box onClick={onClick} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <Text dimColor={!isSelected && !isViewed && !hover} bold={isViewed}>
        {prefix}
        {bullet} main
      </Text>
    </Box>
  );
}

type AgentLineProps = {
  task: PanelAgentTask;
  name?: string;
  /** densable taskDecorations[id] — custom status content replaces default row body. */
  decoration?: { content: string };
  isSelected?: boolean;
  isViewed?: boolean;
  onClick?: () => void;
};

function AgentLine({ task, name, decoration, isSelected, isViewed, onClick }: AgentLineProps): React.ReactNode {
  const { columns } = useTerminalSize();
  const [hover, setHover] = React.useState(false);
  const isTeammate = isInProcessTeammateTask(task);
  const isIdleTeammate = isTeammate && task.isIdle;
  // densable pAb: non-terminal local_agent isIdle → "waiting" (not "idle")
  const localAgent = !isTeammate && isLocalAgentTask(task) ? (task as LocalAgentTaskState) : null;
  const isAdopting = localAgent !== null && Boolean(localAgent.adoptResumePending || localAgent.resuming);
  // densable pAb: skip waiting while adopt/Aye placeholder is in flight.
  const isIdleLocalAgent = localAgent !== null && !isAdopting && Boolean(localAgent.isIdle);
  const isIdleRow = isIdleTeammate || isIdleLocalAgent;
  // densable wSr residual + product adopt placeholder: completed+keepalive /
  // resuming / adoptResumePending stay "active" (not tick-done).
  const isPanelActive = localAgent !== null ? isLocalAgentPanelActive(localAgent) : !isTerminalStatus(task.status);
  const isRunning = isPanelActive && !isIdleRow;
  const pausedMs = (task as LocalAgentTaskState).totalPausedMs ?? 0;
  const elapsedMs = Math.max(
    0,
    isRunning ? Date.now() - task.startTime - pausedMs : (task.endTime ?? task.startTime) - task.startTime - pausedMs,
  );

  // densable pAb: teammate isIdle → "idle"; local_agent isIdle → "waiting".
  // Product: adopt PSu→Aye gap / Aye CAS window → "resuming" (not completed tick).
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

  // Derive direction arrow from activity state, same logic as Spinner
  const lastActivity = task.progress?.lastActivity;
  const arrow = lastActivity ? figures.arrowDown : figures.arrowUp;

  const tokenText =
    !isIdleRow && tokenCount !== undefined && tokenCount > 0 ? ` · ${arrow} ${formatNumber(tokenCount)} tokens` : '';

  const queuedCount = isTeammate
    ? task.pendingUserMessages.length
    : (task as LocalAgentTaskState).pendingMessages.length;
  const queuedText = queuedCount > 0 ? ` · ${queuedCount} queued` : '';

  // Precedence: AI summary > static description (no tool-call activity noise)
  const displayDescription = task.progress?.summary || task.description;

  const highlighted = isSelected || hover;
  const prefix = highlighted ? figures.pointer + ' ' : '  ';
  const bullet = isViewed ? BLACK_CIRCLE : figures.circle;
  const dim = !highlighted && !isViewed;

  const sep = isRunning ? PLAY_ICON : PAUSE_ICON;
  // Name is the steering handle — kept out of truncation and undimmed so it
  // stays readable even when the row is inactive. Short by convention (the
  // Agent tool prompt asks for "one or two words, lowercase").
  const namePart = name ? `${name}: ` : '';
  const hintPart = isSelected && !isViewed ? ` · x to ${isRunning ? 'stop' : 'clear'}` : '';
  const suffixPart = ` ${sep} ${elapsed}${tokenText}${queuedText}${hintPart}`;
  const availableForDesc =
    columns - stringWidth(prefix) - stringWidth(`${bullet} `) - stringWidth(namePart) - stringWidth(suffixPart);
  const truncated = wrapText(displayDescription, Math.max(0, availableForDesc), 'truncate-end');

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

  const line = (
    <Text dimColor={dim} bold={isViewed}>
      {prefix}
      {bullet}{' '}
      {name && (
        <>
          <Text dimColor={false} bold>
            {name}
          </Text>
          {': '}
        </>
      )}
      {truncated} {sep} {elapsed}
      {tokenText}
      {queuedCount > 0 && <Text color="warning">{queuedText}</Text>}
      {hintPart && <Text dimColor>{hintPart}</Text>}
    </Text>
  );

  if (!onClick) return line;
  return (
    <Box onClick={onClick} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      {line}
    </Box>
  );
}
