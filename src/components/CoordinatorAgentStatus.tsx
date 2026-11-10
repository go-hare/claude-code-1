/**
 * CoordinatorTaskPanel — Steerable list of background agents.
 *
 * Renders below the prompt input footer whenever local_agent tasks exist.
 * Visibility is driven by evictAfter: undefined (running/retained) shows
 * always; a timestamp shows until passed. Enter to view/steer, x to dismiss.
 */

import figures from 'figures';
import * as React from 'react';
import { BLACK_CIRCLE, DOWN_ARROW, UP_ARROW } from '../constants/figures.js';
import { useSubagentStatusLine } from '../hooks/useSubagentStatusLine.js';
import { Ansi, Box, ProgressBar, Text, stringWidth, useTerminalSize } from '@anthropic/ink';
import { type AppState, useAppState, useSetAppState } from '../state/AppState.js';
import { enterTeammateView, exitTeammateView } from '../state/teammateViewHelpers.js';
import {
  isLocalAgentPanelActive,
  isLocalAgentTask,
  isPanelAgentTask,
  type LocalAgentTaskState,
} from '../tasks/LocalAgentTask/LocalAgentTask.js';
import type { LocalWorkflowTaskState } from '../tasks/LocalWorkflowTask/LocalWorkflowTask.js';
import { isInProcessTeammateTask } from '../tasks/InProcessTeammateTask/types.js';
import type { SdkWorkflowProgress } from '../types/workflowProgress.js';
import { formatDuration, formatNumber } from '../utils/format.js';
import {
  collapseIdlePanelRows,
  idleSummaryLabel,
  isIdleSummaryRow,
  isPanelListTask,
  isPanelManagedTask,
  isParkedIdleWindowSubagent,
  nearestNonParkedPanelAncestorId,
  type PanelAgentTask,
  type PanelListItem,
  viewingPanelAncestorIds,
} from '../utils/panelIdleSummary.js';
import { evictTerminalTask } from '../utils/task/framework.js';
import { isTerminalStatus } from './tasks/taskStatusUtils.js';

const PANEL_WINDOW_SIZE = 5;
const PANEL_PADDING_RIGHT = 2;
const PANEL_NAME_MIN = 4;
const PANEL_NAME_MAX = 28;
const TREE_BRANCH = '├';
const TREE_LAST = '└';

function getPanelTaskAgentId(task: PanelAgentTask): string {
  return isInProcessTeammateTask(task) ? task.identity.agentId : (task.agentId ?? task.id);
}

/**
 * densable Ght — visible panel tasks in parent-child DFS tree order.
 * Filters out dismissed (evictAfter === 0) and parked idle-window subagents
 * unless they are on the viewed ancestor chain, and only expands children
 * of the currently viewed task / its parent.
 */
export function getVisibleAgentTasks(tasks: AppState['tasks'], viewingAgentTaskId?: string): PanelAgentTask[] {
  const viewed = viewingAgentTaskId ? tasks[viewingAgentTaskId] : undefined;
  const viewedAgentId = isPanelAgentTask(viewed) ? (viewed.agentId ?? viewed.id) : undefined;
  const viewedParentId = isPanelAgentTask(viewed) ? nearestNonParkedPanelAncestorId(tasks, viewed) : undefined;
  const ancestors = viewingPanelAncestorIds(tasks, viewingAgentTaskId);
  const filtered = Object.values(tasks).filter(
    (t): t is PanelAgentTask =>
      isPanelManagedTask(t) &&
      (t.evictAfter !== 0 || ancestors.has(t.id)) &&
      (!isParkedIdleWindowSubagent(t) || ancestors.has(t.id)) &&
      (nearestNonParkedPanelAncestorId(tasks, t) === viewedAgentId ||
        nearestNonParkedPanelAncestorId(tasks, t) === viewedParentId ||
        ancestors.has(t.id)),
  );
  const visibleIds = new Set(filtered.map(t => t.id));
  const childrenByParent = new Map<string | undefined, PanelAgentTask[]>();
  for (const t of filtered) {
    const parentId = nearestNonParkedPanelAncestorId(tasks, t);
    const key = parentId !== undefined && visibleIds.has(parentId) ? parentId : undefined;
    const list = childrenByParent.get(key);
    if (list) list.push(t);
    else childrenByParent.set(key, [t]);
  }
  for (const list of childrenByParent.values()) {
    list.sort((a, b) => a.startTime - b.startTime);
  }
  const ordered: PanelAgentTask[] = [];
  function visit(parentId: string | undefined): void {
    for (const child of childrenByParent.get(parentId) ?? []) {
      ordered.push(child);
      visit(child.id);
    }
  }
  visit(undefined);
  return ordered;
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
  viewingAgentTaskId?: string,
): PanelAgentTask[] {
  return filterTasksByDecorationContent(getVisibleAgentTasks(tasks, viewingAgentTaskId), decorations);
}

/**
 * densable G7 / $c full panel list: decoration filter + optional idle_summary collapse
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
  const base = getPanelVisibleAgentTasks(tasks, decorations, opts?.viewingAgentTaskId);
  return collapseIdlePanelRows(base, opts?.idleTeammatesExpanded ?? false, opts?.viewingAgentTaskId);
}

function getTaskTreeDepth(tasks: AppState['tasks'], task: PanelAgentTask): number {
  let depth = 0;
  const seen = new Set<string>();
  let parentId = nearestNonParkedPanelAncestorId(tasks, task);
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    depth++;
    const parent = tasks[parentId];
    parentId = isPanelAgentTask(parent) ? nearestNonParkedPanelAncestorId(tasks, parent) : undefined;
  }
  return depth;
}

function getTaskDescendantCount(tasks: AppState['tasks'], agentId: string): number {
  let count = 0;
  for (const t of Object.values(tasks)) {
    if (!isPanelAgentTask(t) || t.evictAfter === 0 || isParkedIdleWindowSubagent(t)) continue;
    let parentId = nearestNonParkedPanelAncestorId(tasks, t);
    const seen = new Set<string>();
    while (parentId && !seen.has(parentId)) {
      if (parentId === agentId) {
        count++;
        break;
      }
      seen.add(parentId);
      const parent = tasks[parentId];
      parentId = isPanelAgentTask(parent) ? nearestNonParkedPanelAncestorId(tasks, parent) : undefined;
    }
  }
  return count;
}

function formatDescendantSuffix(count: number): string {
  return count > 0 ? ` (+${count})` : '';
}

function computePanelWindow(
  focusIndex: number,
  totalCount: number,
  windowSize: number,
): {
  windowStart: number;
  windowEnd: number;
  moreAbove: number;
  moreBelow: number;
} {
  const windowStart = Math.max(0, Math.min(focusIndex - windowSize + 1, Math.max(0, totalCount - windowSize)));
  const windowEnd = Math.min(windowStart + windowSize, totalCount);
  return {
    windowStart,
    windowEnd,
    moreAbove: windowStart,
    moreBelow: totalCount - windowEnd,
  };
}

function isLocalWorkflowTask(value: unknown): value is LocalWorkflowTaskState {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    (value as { type: string }).type === 'local_workflow'
  );
}

function getVisibleWorkflowTasks(tasks: AppState['tasks']): LocalWorkflowTaskState[] {
  const out: LocalWorkflowTaskState[] = [];
  for (const t of Object.values(tasks)) {
    if (!isLocalWorkflowTask(t)) continue;
    const evictAfter = (t as LocalWorkflowTaskState & { evictAfter?: number }).evictAfter;
    if (t.status === 'running' || (isTerminalStatus(t.status) && (evictAfter !== undefined || !t.notified))) {
      out.push(t);
    }
  }
  out.sort((a, b) => a.startTime - b.startTime);
  return out;
}

function countWorkflowAgents(
  progress: readonly SdkWorkflowProgress[],
  agentCountHint = 0,
): {
  done: number;
  failedCount: number;
  running: boolean;
  total: number;
  started: number;
  complete: boolean;
} {
  let seen = 0;
  let done = 0;
  let failedCount = 0;
  let started = 0;
  let running = false;
  for (const item of progress) {
    if (item.type !== 'workflow_agent') continue;
    seen++;
    if (item.state === 'done') {
      done++;
      started++;
    } else if (item.state === 'error') {
      failedCount++;
      started++;
    } else if (item.state === 'start' || item.state === 'progress') {
      running = true;
      if (item.startedAt !== undefined || item.queuedAt === undefined || (item.tokens ?? 0) > 0) {
        started++;
      }
    }
  }
  const total = Math.max(agentCountHint, seen);
  const complete = !running && seen > 0 && done + failedCount >= total;
  return { done, failedCount, running, total, started, complete };
}

function getTerminalBulletColor(status: string): 'success' | 'error' | undefined {
  switch (status) {
    case 'completed':
      return 'success';
    case 'failed':
    case 'killed':
      return 'error';
    default:
      return undefined;
  }
}

export function CoordinatorTaskPanel({ showWorkflows = false }: { showWorkflows?: boolean } = {}): React.ReactNode {
  const tasks = useAppState(s => s.tasks);
  const viewingAgentTaskId = useAppState(s => s.viewingAgentTaskId);
  const agentNameRegistry = useAppState(s => s.agentNameRegistry);
  const taskDecorations = useAppState(s => s.taskDecorations ?? {});
  const coordinatorTaskIndex = useAppState(s => s.coordinatorTaskIndex);
  const tasksSelected = useAppState(s => s.footerSelection === 'tasks');
  const selectedIndex = tasksSelected ? coordinatorTaskIndex : undefined;
  const setAppState = useSetAppState();
  const { columns } = useTerminalSize();

  // densable wHa — poll subagentStatusLine → taskDecorations.
  useSubagentStatusLine();

  const idleTeammatesExpanded = useAppState(s => s.idleTeammatesExpanded ?? false);
  const visibleTasks = getPanelListItems(tasks, taskDecorations, {
    idleTeammatesExpanded,
    viewingAgentTaskId,
  });
  const hasTasks = Object.values(tasks).some(isPanelListTask);
  const workflowTasks = React.useMemo(
    () => (showWorkflows ? getVisibleWorkflowTasks(tasks) : []),
    [showWorkflows, tasks],
  );
  const hasWorkflows = workflowTasks.length > 0;

  const workflowItems = React.useMemo(
    () =>
      workflowTasks.map(wf => {
        const counts = countWorkflowAgents(wf.workflowProgress, wf.agentCount);
        const bulletColor: 'success' | 'error' | 'warning' | undefined = isTerminalStatus(wf.status)
          ? getTerminalBulletColor(wf.status)
          : counts.failedCount > 0
            ? 'error'
            : undefined;
        return {
          workflow: wf,
          row: {
            name: panelOneLine(wf.workflowName ?? wf.summary ?? wf.description ?? 'Dynamic workflow'),
            bulletColor,
            doneAgents: counts.done,
            totalAgents: counts.total,
            totalTokens: wf.totalTokens,
            clock: wf,
          },
        };
      }),
    [workflowTasks],
  );

  // 1s tick: re-render for elapsed time + evict tasks past their deadline.
  // The eviction deletes from prev.tasks, which makes useCoordinatorTaskCount
  // (and other consumers) see the updated count without their own tick.
  const tasksRef = React.useRef(tasks);
  tasksRef.current = tasks;
  const [, setTick] = React.useState(0);
  React.useEffect(() => {
    if (!hasTasks && !hasWorkflows) return;
    const interval = setInterval(
      (tasksRef, setAppState, setTick) => {
        const now = Date.now();
        for (const t of Object.values(tasksRef.current)) {
          if (isLocalWorkflowTask(t)) {
            const evictAfter = (t as LocalWorkflowTaskState & { evictAfter?: number }).evictAfter;
            if (t.status !== 'running' && (evictAfter ?? Infinity) <= now) {
              evictTerminalTask(t.id, setAppState);
            }
            continue;
          }
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
  }, [hasTasks, hasWorkflows, setAppState]);

  const nameByAgentId = React.useMemo(() => {
    const inv = new Map<string, string>();
    for (const [n, id] of agentNameRegistry) inv.set(id, panelOneLine(n));
    return inv;
  }, [agentNameRegistry]);

  const isViewingPanelTask = viewingAgentTaskId !== undefined && isPanelManagedTask(tasks[viewingAgentTaskId]);
  if (visibleTasks.length === 0 && !hasWorkflows && !isViewingPanelTask) {
    return null;
  }

  const rawIndex = selectedIndex ?? 0;
  const focusIndex = Math.max(
    0,
    Math.min(
      rawIndex >= 1 ? rawIndex - 1 : visibleTasks.findIndex(row => row.id === viewingAgentTaskId),
      Math.max(0, visibleTasks.length - 1),
    ),
  );
  const { windowStart, windowEnd, moreAbove, moreBelow } = computePanelWindow(
    focusIndex,
    visibleTasks.length,
    PANEL_WINDOW_SIZE,
  );

  const viewedAncestors = viewingPanelAncestorIds(tasks, viewingAgentTaskId);
  const descendantCounts = visibleTasks.map(row =>
    isIdleSummaryRow(row) || viewedAncestors.has(row.id) ? 0 : getTaskDescendantCount(tasks, getPanelTaskAgentId(row)),
  );
  const depths = visibleTasks.map(row => (isIdleSummaryRow(row) ? 0 : getTaskTreeDepth(tasks, row)));

  // densable Wq Os/es: name column 4–28, status column = max `elapsed · tokens`.
  const now = Date.now();
  const labelWidth = Math.min(
    PANEL_NAME_MAX,
    Math.max(
      PANEL_NAME_MIN,
      ...visibleTasks.map((row, idx) =>
        !isIdleSummaryRow(row) && taskDecorations[row.id]?.content === undefined
          ? 2 * depths[idx]! +
            stringWidth(panelAgentName(row, nameByAgentId) ?? '') +
            stringWidth(formatDescendantSuffix(descendantCounts[idx]!))
          : 0,
      ),
      ...workflowItems.map(item => stringWidth(item.row.name)),
    ),
  );
  const statusPartsList = visibleTasks.map(row => (isIdleSummaryRow(row) ? undefined : getAgentStatusParts(row, now)));
  const statusWidth = Math.max(
    0,
    ...statusPartsList.map((parts, idx) =>
      parts !== undefined && taskDecorations[visibleTasks[idx]!.id]?.content === undefined
        ? statusPartsWidth(parts)
        : 0,
    ),
  );

  return (
    <Box flexDirection="column" marginTop={1} paddingRight={PANEL_PADDING_RIGHT}>
      {(visibleTasks.length > 0 || isViewingPanelTask) && (
        <MainLine
          isSelected={selectedIndex === 0}
          isViewed={viewingAgentTaskId === undefined}
          labelWidth={labelWidth}
          moreAbove={moreAbove}
          onClick={() => exitTeammateView(setAppState)}
        />
      )}
      {visibleTasks.slice(windowStart, windowEnd).map((row, i) => {
        const globalIdx = windowStart + i;
        if (isIdleSummaryRow(row)) {
          return (
            <IdleSummaryLine
              key={row.id}
              count={row.taskIds.length}
              isSelected={selectedIndex === globalIdx + 1}
              onClick={() =>
                setAppState(prev => (prev.idleTeammatesExpanded ? prev : { ...prev, idleTeammatesExpanded: true }))
              }
            />
          );
        }
        const depth = depths[globalIdx]!;
        const parentId = nearestNonParkedPanelAncestorId(tasks, row);
        const parentInWindow = parentId !== undefined && visibleTasks.findIndex(r => r.id === parentId) >= windowStart;
        let treeConnector: string | undefined;
        if (depth > 0 && parentInWindow) {
          const hasFollowingSibling = visibleTasks
            .slice(globalIdx + 1)
            .some(r => !isIdleSummaryRow(r) && nearestNonParkedPanelAncestorId(tasks, r) === parentId);
          treeConnector = '  '.repeat(depth - 1) + (hasFollowingSibling ? TREE_BRANCH : TREE_LAST) + ' ';
        }
        return (
          <AgentLine
            key={row.id}
            task={row}
            name={panelAgentName(row, nameByAgentId)}
            decoration={taskDecorations[row.id]}
            labelWidth={labelWidth}
            statusWidth={statusWidth}
            statusParts={statusPartsList[globalIdx]}
            treeConnector={treeConnector}
            descendantSuffix={formatDescendantSuffix(descendantCounts[globalIdx]!)}
            isSelected={selectedIndex === globalIdx + 1}
            isViewed={viewingAgentTaskId === row.id}
            onClick={() => enterTeammateView(row.id, setAppState)}
          />
        );
      })}
      {visibleTasks.length > PANEL_WINDOW_SIZE && (
        <Box justifyContent="flex-start">
          <Text dimColor>{moreBelow > 0 ? `  ${DOWN_ARROW} ${moreBelow} more` : ' '}</Text>
        </Box>
      )}
      {workflowItems.map(({ workflow, row }) => (
        <WorkflowLine
          key={workflow.id}
          row={row}
          prefixWidth={prefixWidth()}
          labelWidth={labelWidth}
          rowWidth={columns - PANEL_PADDING_RIGHT}
        />
      ))}
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
    const isViewingPanelTask = viewingAgentTaskId !== undefined && isPanelManagedTask(tasks[viewingAgentTaskId]);
    return count > 0 || isViewingPanelTask ? count + 1 : 0;
  }, [tasks, taskDecorations, idleTeammatesExpanded, viewingAgentTaskId]);
}

/** densable SZ / _rf — collapsed idle agents summary row. */
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
      <Box width={prefixWidth()} flexShrink={0}>
        <Text dimColor={dim}>{prefix}</Text>
        <Text dimColor={dim}>{figures.circle} </Text>
      </Box>
      <Text dimColor={dim} wrap="truncate">
        {idleSummaryLabel(count)}
      </Text>
    </Box>
  );
}

/** densable Tg — `  ` + bullet + space. */
function prefixWidth(): number {
  return 2 + Math.max(stringWidth(figures.circle), stringWidth(BLACK_CIRCLE)) + 1;
}

/**
 * densable `Tr` — strip C0/C1 (`qee=/[\x00-\x08\x0E-\x1F\x7F-\x9F]/g`) then
 * collapse whitespace (`/\s+/g` → `" "` + trim). yZ description is
 * `Tr(progress.summary??"")||Tr(description)` so a multiline agent
 * summary (`**PASS**\nGold …`) stays one truncated row, not a wrap
 * that hangs past the name column. Walk char codes instead of a
 * control-char regex literal (biome `noControlCharactersInRegex`).
 */
function panelOneLine(text: string | undefined): string {
  if (!text) return '';
  let stripped = '';
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c <= 8 || (c >= 14 && c <= 31) || (c >= 127 && c <= 159)) continue;
    stripped += text[i]!;
  }
  return stripped.replace(/\s+/g, ' ').trim();
}

function panelAgentName(task: PanelAgentTask, nameByAgentId: Map<string, string>): string | undefined {
  // densable Fq = Tr(in_process_teammate ? identity.agentName : agentType)
  if (isInProcessTeammateTask(task)) return panelOneLine(task.identity.agentName) || undefined;
  return panelOneLine(nameByAgentId.get(task.id) ?? task.agentType) || undefined;
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
  moreAbove = 0,
  onClick,
}: {
  isSelected?: boolean;
  isViewed?: boolean;
  labelWidth: number;
  moreAbove?: number;
  onClick: () => void;
}): React.ReactNode {
  const [hover, setHover] = React.useState(false);
  const prefix = isSelected || hover ? figures.pointer + ' ' : '  ';
  const bullet = isViewed ? BLACK_CIRCLE : figures.circle;
  const moreAboveText = moreAbove > 0 ? `${UP_ARROW} ${moreAbove} more` : '';
  const dim = !isSelected && !isViewed && !hover;
  return (
    <Box
      justifyContent="space-between"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <Box width={prefixWidth() + labelWidth} flexShrink={0}>
        <Text dimColor={dim} bold={isViewed}>
          {prefix}
          {bullet} main
        </Text>
      </Box>
      {moreAboveText ? <Text dimColor>{moreAboveText}</Text> : null}
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
  statusParts?: AgentStatusParts;
  treeConnector?: string;
  descendantSuffix?: string;
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
  statusParts,
  treeConnector,
  descendantSuffix,
  isSelected,
  isViewed,
  onClick,
}: AgentLineProps): React.ReactNode {
  const [hover, setHover] = React.useState(false);
  const { elapsed, tokenText, queuedText, queuedCount } = statusParts ?? getAgentStatusParts(task, Date.now());
  // densable yZ: Tr(v.progress?.summary??"")||Tr(v.description)
  const displayDescription = panelOneLine(task.progress?.summary ?? '') || panelOneLine(task.description);
  const highlighted = isSelected || hover;
  const prefix = highlighted ? figures.pointer + ' ' : '  ';
  const bullet = isViewed ? BLACK_CIRCLE : figures.circle;
  const isPanelActive = isInProcessTeammateTask(task) ? !isTerminalStatus(task.status) : isLocalAgentPanelActive(task);
  const bulletColor: 'success' | 'error' | undefined = isPanelActive ? undefined : getTerminalBulletColor(task.status);
  const dim = !highlighted && !isViewed;
  const displayName = name ?? (isLocalAgentTask(task) ? panelOneLine(task.agentType) : undefined);
  const statusText = [elapsed, tokenText].filter(Boolean).join(' · ');

  const connectorWidth = treeConnector ? stringWidth(treeConnector) : 0;
  const gutterWidth = prefixWidth() + connectorWidth;
  const adjustedLabelWidth = Math.max(0, labelWidth - connectorWidth);

  const gutterContent = (
    <>
      <Text dimColor={dim} bold={isViewed}>
        {prefix}
      </Text>
      {treeConnector !== undefined && <Text dimColor={dim}>{treeConnector}</Text>}
      <Text color={bulletColor} dimColor={!bulletColor && dim} bold={isViewed}>
        {bullet}{' '}
      </Text>
    </>
  );

  // densable yrf: when decoration.content is set, replace name+desc+status with Ansi content.
  if (decoration?.content !== undefined) {
    const gutter = (
      <Box width={gutterWidth} flexShrink={0}>
        {gutterContent}
      </Box>
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
        {gutter}
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
    <Box width={gutterWidth} flexShrink={0}>
      {gutterContent}
    </Box>
  );
  const nameBox = (
    <Box width={adjustedLabelWidth} flexShrink={0}>
      <Text bold={isViewed} dimColor={!displayName && dim} wrap="truncate">
        {displayName ?? ''}
        {descendantSuffix ? <Text dimColor>{descendantSuffix}</Text> : null}
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

type WorkflowRowData = {
  name: string;
  bulletColor: 'success' | 'error' | 'warning' | undefined;
  doneAgents: number;
  totalAgents: number;
  totalTokens: number;
  clock: LocalWorkflowTaskState;
};

/** densable wq — workflow row in CoordinatorTaskPanel when showWorkflows is enabled. */
function WorkflowLine({
  row,
  prefixWidth: pWidth,
  labelWidth,
  rowWidth,
  isSelected,
  onClick,
}: {
  row: WorkflowRowData;
  prefixWidth: number;
  labelWidth: number;
  rowWidth: number;
  isSelected?: boolean;
  onClick?: () => void;
}): React.ReactNode {
  const [hover, setHover] = React.useState(false);
  const highlighted = Boolean(isSelected || hover);
  const dim = !highlighted;
  const now = Date.now();
  const elapsedMs = Math.max(
    0,
    (isTerminalStatus(row.clock.status) ? (row.clock.endTime ?? now) : now) - row.clock.startTime,
  );
  const elapsed = formatDuration(elapsedMs);
  const agentsText = row.totalAgents > 0 ? `${row.doneAgents}/${row.totalAgents}` : undefined;
  const tokensText = row.totalTokens > 0 ? `${figures.arrowDown} ${formatNumber(row.totalTokens)} tokens` : undefined;
  const segments = [agentsText, elapsed, tokensText].filter((s): s is string => s !== undefined);
  const ratio = row.totalAgents > 0 ? row.doneAgents / row.totalAgents : 0;
  const barWidth = Math.max(0, Math.min(12, rowWidth - pWidth - labelWidth - 20));

  return (
    <Box onClick={onClick} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <Box width={pWidth} flexShrink={0}>
        <Text dimColor={dim}>{highlighted ? `${figures.pointer} ` : '  '}</Text>
        <Text color={row.bulletColor} dimColor={!row.bulletColor && dim}>
          {figures.circle}{' '}
        </Text>
      </Box>
      <Box width={labelWidth} flexShrink={0}>
        <Text dimColor={dim} wrap="truncate">
          {row.name}
        </Text>
      </Box>
      <Box flexGrow={1} width={0} paddingLeft={2}>
        <Text wrap="truncate-end">
          {barWidth > 0 && <ProgressBar ratio={ratio} width={barWidth} />}
          {barWidth > 0 && segments.length > 0 ? '  ' : ''}
          {segments.map((seg, idx) => (
            <Text key={idx} dimColor={dim}>
              {idx > 0 ? ' · ' : ''}
              {seg}
            </Text>
          ))}
        </Text>
      </Box>
    </Box>
  );
}
