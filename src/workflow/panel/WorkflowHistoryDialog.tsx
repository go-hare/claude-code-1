/**
 * densable /workflows (GsK) — browse dynamic workflow history (running + completed).
 * Data: AppState local_workflow tasks (+ optional disk snapshots via service).
 * Live phase/agent monitor is Tasks → WorkflowDetailDialog, not this screen.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text, type KeyboardEvent, useAnimationFrame } from '@anthropic/ink';
import type { Theme } from '@anthropic/ink';
import { useAppState, useSetAppState } from '../../state/AppState.js';
import type { LocalWorkflowTaskState } from '../../tasks/LocalWorkflowTask/LocalWorkflowTask.js';
import { isLocalWorkflowTask } from '../../tasks/LocalWorkflowTask/LocalWorkflowTask.js';
import { Byline } from '../../components/design-system/Byline.js';
import { Dialog } from '../../components/design-system/Dialog.js';
import { KeyboardShortcutHint } from '../../components/design-system/KeyboardShortcutHint.js';
import { useKeybindings } from '../../keybindings/useKeybinding.js';
import { getWorkflowService } from '../service.js';
import type { RunProgress } from '../progress/store.js';

export type HistoryItem = {
  taskId: string;
  workflowName: string;
  status: LocalWorkflowTaskState['status'] | RunProgress['status'];
  startTime: number;
  endTime?: number;
  agentCount: number;
  totalTokens: number;
  summary?: string;
  /** true when row comes from AppState task (live); false = disk hydrate only */
  live: boolean;
  scriptPath?: string;
  workflowRunId?: string;
};

function formatDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function formatTokens(n: number): string | null {
  if (n <= 0) return null;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(n);
}

function statusGlyph(status: HistoryItem['status']): {
  mark: string;
  color: keyof Theme | undefined;
} {
  switch (status) {
    case 'completed':
      return { mark: '✓', color: 'success' };
    case 'failed':
    case 'killed':
      return { mark: '✗', color: 'error' };
    case 'paused':
      return { mark: '❚❚', color: 'warning' };
    default:
      return { mark: '↻', color: 'claude' };
  }
}

function taskToItem(t: LocalWorkflowTaskState): HistoryItem {
  return {
    taskId: t.id,
    workflowName: t.workflowName || t.description || 'workflow',
    status: t.status,
    startTime: t.startTime,
    endTime: t.endTime,
    agentCount: t.agentCount ?? 0,
    totalTokens: t.totalTokens ?? 0,
    summary: t.summary,
    live: true,
    scriptPath: t.workflowFile || undefined,
    workflowRunId: t.workflowRunId,
  };
}

function runToItem(r: RunProgress): HistoryItem {
  let totalTokens = 0;
  for (const a of r.agents) totalTokens += a.tokenCount ?? 0;
  return {
    taskId: r.runId,
    workflowName: r.workflowName || 'workflow',
    status: r.status,
    startTime: r.startedAt,
    endTime: r.status === 'running' ? undefined : r.updatedAt,
    agentCount: r.agentCount,
    totalTokens,
    summary: r.description,
    live: false,
    scriptPath: r.scriptPath,
    workflowRunId: r.runId,
  };
}

type Mode = { mode: 'list' } | { mode: 'detail'; itemId: string };

/**
 * densable GsK — history list for /workflows.
 */
export function WorkflowHistoryDialog({
  onDone,
  onOpenLiveDetail,
}: {
  onDone: (msg?: string) => void;
  /** When user Enter on a live task — open Tasks-style detail (caller may re-route). */
  onOpenLiveDetail?: (taskId: string) => void;
}): React.ReactNode {
  const tasks = useAppState(s => s.tasks);
  const setAppState = useSetAppState();
  const [diskRuns, setDiskRuns] = useState<RunProgress[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<Mode>({ mode: 'list' });
  const [selected, setSelected] = useState(0);
  const [clockRef, now] = useAnimationFrame(1000);

  useEffect(() => {
    let cancelled = false;
    const svc = getWorkflowService();
    void svc
      .loadPersistedRuns()
      .then(() => {
        if (!cancelled) {
          setDiskRuns(svc.listRuns());
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const items: HistoryItem[] = useMemo(() => {
    const live = Object.values(tasks ?? {})
      .filter(isLocalWorkflowTask)
      .map(taskToItem);
    const liveRunIds = new Set(live.map(t => t.workflowRunId ?? t.taskId).filter(Boolean));
    const fromDisk = diskRuns.filter(r => !liveRunIds.has(r.runId)).map(runToItem);
    return [...live, ...fromDisk].sort((a, b) => b.startTime - a.startTime);
  }, [tasks, diskRuns]);

  const runningCount = items.filter(i => i.status === 'running').length;
  const pausedCount = items.filter(i => i.status === 'paused').length;
  const failedCount = items.filter(i => i.status === 'failed' || i.status === 'killed').length;
  const completedCount = items.filter(i => i.status === 'completed').length;
  const safeSelected = items.length === 0 ? 0 : Math.min(selected, items.length - 1);
  const focused = items[safeSelected];
  // Pin detail by taskId so live/disk merge re-sort cannot retarget open row / kill.
  const detailItem = mode.mode === 'detail' ? (items.find(i => i.taskId === mode.itemId) ?? null) : null;

  // densable: single item → auto open detail once
  useEffect(() => {
    if (!loading && items.length === 1 && mode.mode === 'list') {
      setMode({ mode: 'detail', itemId: items[0]!.taskId });
    }
  }, [loading, items, mode.mode]);

  // Keep list selection index aligned with pinned detail id when items re-sort.
  useEffect(() => {
    if (mode.mode !== 'detail') return;
    const idx = items.findIndex(i => i.taskId === mode.itemId);
    if (idx >= 0 && idx !== selected) setSelected(idx);
  }, [items, mode, selected]);

  // If pinned row vanished (evicted), drop back to list.
  useEffect(() => {
    if (mode.mode === 'detail' && !items.some(i => i.taskId === mode.itemId)) {
      setMode({ mode: 'list' });
    }
  }, [items, mode]);

  const killItem = (item: HistoryItem | undefined): void => {
    if (!item || item.status !== 'running') return;
    // densable: service.kill aborts run binding + agents (no-op if unbound);
    // always also task-kill when live so AppState terminates.
    try {
      getWorkflowService().kill(item.workflowRunId ?? item.taskId);
    } catch {
      /* service unavailable */
    }
    if (item.live) {
      try {
        const { killWorkflowTask } =
          require('../../tasks/LocalWorkflowTask/LocalWorkflowTask.js') as typeof import('../../tasks/LocalWorkflowTask/LocalWorkflowTask.js');
        killWorkflowTask(item.taskId, setAppState);
      } catch {
        /* ignore */
      }
    }
  };

  // Match BackgroundTasksDialog: standard nav via keybindings (no DOM focus required).
  // confirm:no (Esc) is handled by Dialog onCancel.
  useKeybindings(
    {
      'confirm:previous': () => setSelected(i => Math.max(0, i - 1)),
      'confirm:next': () => setSelected(i => Math.min(Math.max(0, items.length - 1), i + 1)),
      'confirm:yes': () => {
        const item = items[items.length === 0 ? 0 : Math.min(selected, items.length - 1)];
        if (!item) return;
        if (item.live && onOpenLiveDetail) {
          onOpenLiveDetail(item.taskId);
          return;
        }
        setMode({ mode: 'detail', itemId: item.taskId });
      },
    },
    { context: 'Confirmation', isActive: mode.mode === 'list' && !loading },
  );

  const handleKeyDown = (e: KeyboardEvent): void => {
    if (mode.mode === 'detail') {
      if (e.key === 'left') {
        e.preventDefault();
        setMode({ mode: 'list' });
      } else if (e.key === 'x' && detailItem?.status === 'running' && detailItem.live) {
        e.preventDefault();
        killItem(detailItem);
      }
      return;
    }
    // Only live running rows have a task/binding to kill; disk "running" is stale.
    if (e.key === 'x' && focused?.status === 'running' && focused.live) {
      e.preventDefault();
      killItem(focused);
    }
  };

  if (mode.mode === 'detail' && detailItem) {
    const elapsed = Math.max(0, (detailItem.endTime ?? now) - detailItem.startTime);
    const tok = formatTokens(detailItem.totalTokens);
    return (
      <Box flexDirection="column" tabIndex={0} autoFocus borderStyle="round" onKeyDown={handleKeyDown}>
        <Dialog
          title={detailItem.workflowName}
          subtitle={
            <Text dimColor>
              {detailItem.status} · {formatDuration(elapsed)}
              {detailItem.agentCount > 0 ? ` · ${detailItem.agentCount} agents` : ''}
              {tok ? ` · ${tok} tok` : ''}
            </Text>
          }
          onCancel={() => setMode({ mode: 'list' })}
          inputGuide={() => (
            <Byline>
              <KeyboardShortcutHint shortcut="←" action="list" />
              <KeyboardShortcutHint shortcut="Esc" action="list" />
              {detailItem.status === 'running' && detailItem.live && (
                <KeyboardShortcutHint shortcut="x" action="stop" />
              )}
            </Byline>
          )}
        >
          {detailItem.summary ? <Text>{detailItem.summary}</Text> : null}
          {detailItem.scriptPath ? <Text color="subtle">script: {detailItem.scriptPath}</Text> : null}
          {detailItem.workflowRunId ? <Text color="subtle">runId: {detailItem.workflowRunId}</Text> : null}
          <Box marginTop={1}>
            <Text color="subtle">
              {detailItem.live
                ? 'Live progress: open this workflow from Shift+Down Tasks for phase/agent detail (densable WorkflowDetailDialog).'
                : 'Historical run (disk). Resume: Workflow({ resumeFromRunId, scriptPath }).'}
            </Text>
          </Box>
        </Dialog>
      </Box>
    );
  }

  return (
    <Box ref={clockRef} flexDirection="column" tabIndex={0} autoFocus borderStyle="round" onKeyDown={handleKeyDown}>
      <Dialog
        title="Dynamic workflows"
        subtitle={
          items.length === 0 ? undefined : (
            <Text dimColor>
              {[
                runningCount > 0 ? `${runningCount} running` : null,
                pausedCount > 0 ? `${pausedCount} paused` : null,
                failedCount > 0 ? `${failedCount} failed` : null,
                completedCount > 0 ? `${completedCount} completed` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          )
        }
        onCancel={() => onDone('Dynamic workflows dialog dismissed')}
        inputGuide={() => (
          <Byline>
            {items.length > 0 && <KeyboardShortcutHint shortcut="↑↓" action="select" />}
            {items.length > 0 && <KeyboardShortcutHint shortcut="enter" action="view" />}
            {focused?.status === 'running' && focused.live && <KeyboardShortcutHint shortcut="x" action="stop" />}
            <KeyboardShortcutHint shortcut="Esc" action="close" />
          </Byline>
        )}
      >
        {loading ? (
          <Text dimColor>Loading dynamic workflow history…</Text>
        ) : items.length === 0 ? (
          <Text>No dynamic workflows in this session.</Text>
        ) : (
          <Box flexDirection="column">
            {items.map((item, i) => {
              const sel = i === safeSelected;
              const { mark, color } = statusGlyph(item.status);
              const elapsed = Math.max(0, (item.endTime ?? now) - item.startTime);
              const meta = [
                item.agentCount > 0 ? `${item.agentCount} agent${item.agentCount === 1 ? '' : 's'}` : null,
                formatTokens(item.totalTokens) ? `${formatTokens(item.totalTokens)} tok` : null,
                formatDuration(elapsed),
              ]
                .filter(Boolean)
                .join(' · ');
              const name = item.workflowName.length > 50 ? `${item.workflowName.slice(0, 49)}…` : item.workflowName;
              return (
                <Box key={item.taskId} backgroundColor={sel ? 'selectionBg' : undefined}>
                  <Text color={sel ? 'suggestion' : undefined}>{sel ? '❯ ' : '  '}</Text>
                  <Text color={color as keyof Theme}>{mark}</Text>
                  <Text color={sel ? 'suggestion' : undefined}> {name}</Text>
                  {meta ? (
                    <Text dimColor>
                      {'  '}
                      {meta}
                    </Text>
                  ) : null}
                </Box>
              );
            })}
          </Box>
        )}
      </Dialog>
    </Box>
  );
}
