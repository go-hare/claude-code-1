/**
 * densable WorkflowDetailDialog (fv_ / oSn) — host live monitor for local_workflow.
 * Data source: task.workflowProgress (tm8), NOT WorkflowService progress store.
 *
 * densable 2.1.239 #35: computeVisibleWindow (mYe) + tTe hint keep the header
 * visible when the phase/agent lists overflow a mid-turn / modal reply slot.
 * Do not invent official oSn extras (agent drill-down, status filter, g6t).
 */

import figures from 'figures';
import React, { useMemo, useState } from 'react';
import type { DeepImmutable } from 'src/types/utils.js';
import {
  Box,
  Text,
  type KeyboardEvent,
  useAnimationFrame,
  useIsInsideModal,
  useModalOrTerminalSize,
  useTerminalSize,
} from '@anthropic/ink';
import type { Theme } from '@anthropic/ink';
import type { LocalWorkflowTaskState } from '../../tasks/LocalWorkflowTask/LocalWorkflowTask.js';
import type { SdkWorkflowAgentProgress } from '../../types/workflowProgress.js';
import { agentDisplayStatus, foldWorkflowPhases, isAgentLive, type FoldedPhase } from '../../workflow/foldProgress.js';
import { Byline } from '../design-system/Byline.js';
import { Dialog } from '../design-system/Dialog.js';
import { KeyboardShortcutHint } from '../design-system/KeyboardShortcutHint.js';

type FocusCol = 'phases' | 'agents';

type Props = {
  task: DeepImmutable<LocalWorkflowTaskState>;
  onBack?: () => void;
  onDone?: () => void;
  onKill?: () => void;
  onSkipAgent?: (agentId: string) => void;
  onRetryAgent?: (agentId: string) => void;
  onPause?: () => void;
  initialPhaseIndex?: number;
  /** densable oSn promptVisibleBelow — reserve reply rows when not in a modal. */
  promptVisibleBelow?: boolean;
};

export type VisibleWindow = {
  from: number;
  to: number;
  above: number;
  below: number;
};

/** densable mYe — focus-centered slice so overflowing lists do not clip the header. */
export function computeVisibleWindow(focus: number, total: number, visible: number): VisibleWindow {
  if (total <= visible) {
    return { from: 0, to: total, above: 0, below: 0 };
  }
  const half = Math.floor(visible / 2);
  const from = Math.max(0, Math.min(focus - half, total - visible));
  const to = from + visible;
  return { from, to, above: from, below: total - to };
}

/** densable tTe — `↑ 2–5 of 12 ↓` (en-dash). */
export function formatVisibleWindowHint(win: VisibleWindow, total: number): string {
  const up = win.from > 0 ? figures.arrowUp : ' ';
  const down = win.to < total ? figures.arrowDown : ' ';
  return `${up} ${win.from + 1}\u2013${win.to} of ${total} ${down}`;
}

/**
 * densable oSn list budgets: `pr` / `Mt` / `vt` / `Gt`.
 * `availableRows` is gfs().availableRows (modal rows, or rows-9 when
 * promptVisibleBelow, min Drg=12).
 */
export function workflowDetailListBudgets(
  availableRows: number,
  phaseCount: number,
): { tight: boolean; phaseViewport: number; agentViewport: number } {
  const tight = availableRows < 18;
  const usable = availableRows - (tight ? 8 : 11);
  const phaseCap = Math.max(1, usable - 3);
  const phasesOverflow = phaseCount > phaseCap;
  const phaseViewport = phasesOverflow ? Math.max(1, phaseCap - 1) : phaseCount;
  const agentViewport = Math.max(1, usable - phaseViewport - (phasesOverflow ? 1 : 0));
  return { tight, phaseViewport, agentViewport };
}

function clamp(n: number, lo: number, hi: number): number {
  if (hi < lo) return lo;
  return Math.max(lo, Math.min(hi, n));
}

function formatDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m < 60) return `${m}m ${r}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function formatTokens(n: number | undefined): string | null {
  if (n == null || n <= 0) return null;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(n);
}

function phaseMark(status: FoldedPhase['status']): {
  mark: string;
  color: keyof Theme | undefined;
} {
  switch (status) {
    case 'done':
      return { mark: '✓', color: 'success' };
    case 'failed':
      return { mark: '✗', color: 'error' };
    case 'running':
      return { mark: '●', color: 'claude' };
    default:
      return { mark: '○', color: 'subtle' };
  }
}

function agentMeta(agent: SdkWorkflowAgentProgress, running: boolean): string {
  const st = agentDisplayStatus(agent, running);
  const parts: string[] = [];
  if (agent.model) parts.push(agent.model);
  const tok = formatTokens(agent.tokens);
  if (tok) parts.push(`${tok} tok`);
  if (agent.toolCalls != null && agent.toolCalls > 0) {
    parts.push(`${agent.toolCalls} tool`);
  }
  if (st === 'skipped') parts.push('skipped');
  if (st === 'failed' && agent.error) parts.push(agent.error.slice(0, 40));
  if (st === 'interrupted') parts.push('stopped');
  return parts.join(' · ');
}

function agentMark(
  agent: SdkWorkflowAgentProgress,
  running: boolean,
  spinner: string,
): { mark: string; color: keyof Theme | undefined } {
  const st = agentDisplayStatus(agent, running);
  switch (st) {
    case 'done':
      return { mark: '✓', color: 'success' };
    case 'failed':
      return { mark: '✗', color: 'error' };
    case 'skipped':
      return { mark: '–', color: 'subtle' };
    case 'running':
      return { mark: spinner, color: 'claude' };
    case 'queued':
      return { mark: '…', color: 'subtle' };
    default:
      return { mark: '·', color: 'subtle' };
  }
}

/**
 * densable-shaped workflow detail: left phases, right agents, x/r skip-retry.
 */
export function WorkflowDetailDialog({
  task,
  onBack,
  onDone,
  onKill,
  onSkipAgent,
  onRetryAgent,
  onPause,
  initialPhaseIndex,
  promptVisibleBelow = false,
}: Props): React.ReactNode {
  const running = task.status === 'running';
  const terminalSize = useTerminalSize();
  const modalSize = useModalOrTerminalSize(terminalSize);
  const insideModal = useIsInsideModal();
  // densable gfs: modal rows as-is; else promptVisibleBelow → max(Drg=12, rows-Two=9).
  const availableRows = insideModal
    ? modalSize.rows
    : promptVisibleBelow
      ? Math.max(12, modalSize.rows - 9)
      : modalSize.rows;
  const panelWidth = Math.max(24, terminalSize.columns - 6);
  const { phases, finishedAgents, totalAgents } = useMemo(
    () =>
      foldWorkflowPhases(
        // DeepImmutable strips mutability; fold only reads.
        task.workflowProgress as unknown as import('../../types/workflowProgress.js').SdkWorkflowProgress[],
        // densable B03: meta.phases skeleton from run_started (task.declaredPhases).
        task.declaredPhases ?? null,
        task.agentCount ?? 0,
      ),
    [task.workflowProgress, task.declaredPhases, task.agentCount],
  );

  const [focus, setFocus] = useState<FocusCol>('phases');
  const [phaseIdx, setPhaseIdx] = useState(() => clamp(initialPhaseIndex ?? 0, 0, Math.max(0, phases.length - 1)));
  const [agentIdx, setAgentIdx] = useState(0);

  const safePhase = clamp(phaseIdx, 0, Math.max(0, phases.length - 1));
  const phase = phases[safePhase];
  const agents = phase?.agents ?? [];
  const safeAgent = clamp(agentIdx, 0, Math.max(0, agents.length - 1));
  const selectedAgent = agents[safeAgent];
  const { tight, phaseViewport, agentViewport } = workflowDetailListBudgets(availableRows, phases.length);
  const phaseWin = computeVisibleWindow(safePhase, phases.length, phaseViewport);
  const agentWin = computeVisibleWindow(safeAgent, agents.length, agentViewport);
  const phaseHint = phases.length > phaseViewport ? formatVisibleWindowHint(phaseWin, phases.length) : null;
  const agentHint = agents.length > agentViewport ? formatVisibleWindowHint(agentWin, agents.length) : null;
  const minHeight = Math.max(tight ? 8 : 12, Math.min(availableRows - 1, modalSize.rows - 6));
  const maxHeight = Math.max(tight ? 8 : 11, availableRows - 1);

  const [clockRef, now] = useAnimationFrame(running ? 1000 : null);
  const elapsed = Math.max(0, (task.endTime ?? now) - task.startTime);
  const spinnerFrames = ['·', '✢', '✱', '✶', '✻', '✽'];
  const spinner = spinnerFrames[Math.floor(now / 120) % spinnerFrames.length]!;

  // finishedAgents = done + error so failed agents still advance the fraction.
  const stats = `${finishedAgents}/${totalAgents} agents · ${formatDuration(elapsed)}${
    task.status === 'completed'
      ? ' · done'
      : task.status === 'killed'
        ? ' · stopped'
        : task.status === 'paused'
          ? ' · paused'
          : task.status === 'failed'
            ? ' · failed'
            : ''
  }`;

  const liveSelected = selectedAgent != null && isAgentLive(selectedAgent) && running;

  const goBack = (): void => {
    if (onBack) onBack();
    else onDone?.();
  };

  const handleKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'left') {
      e.preventDefault();
      if (focus === 'agents') setFocus('phases');
      else goBack();
      return;
    }
    if (e.key === 'right') {
      e.preventDefault();
      if (focus === 'phases' && agents.length > 0) {
        setFocus('agents');
        setAgentIdx(0);
      }
      return;
    }
    if (e.key === 'up') {
      e.preventDefault();
      if (focus === 'phases') {
        setPhaseIdx(i => clamp(i - 1, 0, phases.length - 1));
        setAgentIdx(0);
      } else {
        setAgentIdx(i => clamp(i - 1, 0, agents.length - 1));
      }
      return;
    }
    if (e.key === 'down') {
      e.preventDefault();
      if (focus === 'phases') {
        setPhaseIdx(i => clamp(i + 1, 0, phases.length - 1));
        setAgentIdx(0);
      } else {
        setAgentIdx(i => clamp(i + 1, 0, agents.length - 1));
      }
      return;
    }
    // densable: x on live agent → skip (prefer) else kill agent path; on phases → kill workflow
    if (e.key === 'x') {
      e.preventDefault();
      if (focus === 'agents' && liveSelected && selectedAgent) {
        const id = String(selectedAgent.index);
        if (onSkipAgent) onSkipAgent(id);
        return;
      }
      if (focus === 'phases' && running && onKill) {
        onKill();
      }
      return;
    }
    // densable r = retry live agent
    if (e.key === 'r') {
      if (liveSelected && selectedAgent && onRetryAgent) {
        e.preventDefault();
        onRetryAgent(String(selectedAgent.index));
      }
      return;
    }
    // densable p = pause when running
    if (e.key === 'p' && running && onPause) {
      e.preventDefault();
      onPause();
    }
  };

  const title = task.workflowName || task.description || 'workflow';

  return (
    <Box
      ref={clockRef}
      flexDirection="column"
      tabIndex={0}
      autoFocus
      borderStyle="round"
      onKeyDown={handleKeyDown}
      width={panelWidth}
      minHeight={minHeight}
      maxHeight={maxHeight}
      overflowY="hidden"
    >
      <Dialog
        title={title}
        subtitle={
          <Text dimColor>
            {stats}
            {task.summary ? ` · ${task.summary}` : ''}
          </Text>
        }
        onCancel={goBack}
        inputGuide={() => (
          <Byline>
            {onBack && <KeyboardShortcutHint shortcut="←" action="back" />}
            <KeyboardShortcutHint shortcut="Esc" action="close" />
            <KeyboardShortcutHint shortcut="↑↓" action="move" />
            <KeyboardShortcutHint shortcut="←→" action="focus" />
            {liveSelected && onSkipAgent && <KeyboardShortcutHint shortcut="x" action="skip" />}
            {liveSelected && onRetryAgent && <KeyboardShortcutHint shortcut="r" action="retry" />}
            {focus === 'phases' && running && onKill && <KeyboardShortcutHint shortcut="x" action="stop" />}
            {running && onPause && <KeyboardShortcutHint shortcut="p" action="pause" />}
          </Byline>
        )}
      >
        {task.status === 'failed' && task.error ? (
          <Box marginBottom={1}>
            <Text color="error">失败原因：{task.error}</Text>
          </Box>
        ) : null}

        {phases.length === 0 ? (
          <Text color="subtle">
            {running ? 'Waiting for phase/agent progress…' : 'No progress recorded for this workflow.'}
          </Text>
        ) : (
          <Box flexDirection="row" gap={1}>
            <Box width="30%" flexDirection="column">
              <Text bold color={focus === 'phases' ? 'claude' : 'subtle'}>
                Phases
              </Text>
              {phases.slice(phaseWin.from, phaseWin.to).map((p, visibleIdx) => {
                const i = phaseWin.from + visibleIdx;
                const selected = i === safePhase && focus === 'phases';
                const { mark, color } = phaseMark(p.status);
                return (
                  <Box key={`${p.phaseIndex}:${p.title}`} backgroundColor={selected ? 'selectionBg' : undefined}>
                    <Text color={color as keyof Theme}>{mark}</Text>
                    <Text>
                      {' '}
                      {p.title}
                      {p.totalCount > 0 ? ` ${p.doneCount}/${p.totalCount}` : ''}
                    </Text>
                  </Box>
                );
              })}
              {phaseHint ? (
                <Text dimColor wrap="truncate-end">
                  {'  '}
                  {phaseHint}
                </Text>
              ) : null}
            </Box>
            <Text color="subtle">│</Text>
            <Box flexGrow={1} flexDirection="column">
              <Text bold color={focus === 'agents' ? 'claude' : 'subtle'}>
                {phase?.title ?? 'Agents'} · {agents.length}
              </Text>
              {agents.length === 0 ? (
                <Text color="subtle">(no agents in this phase)</Text>
              ) : (
                <>
                  {agents.slice(agentWin.from, agentWin.to).map((a, visibleIdx) => {
                    const i = agentWin.from + visibleIdx;
                    const selected = i === safeAgent && focus === 'agents';
                    const { mark, color } = agentMark(a, running, spinner);
                    const label = (a.label ?? `agent-${a.index}`).slice(0, 28);
                    return (
                      <Box
                        key={a.index}
                        backgroundColor={selected ? 'selectionBg' : undefined}
                        justifyContent="space-between"
                      >
                        <Box>
                          <Text color={color as keyof Theme}>{mark}</Text>
                          <Text> {label}</Text>
                        </Box>
                        <Text color="subtle">{agentMeta(a, running)}</Text>
                      </Box>
                    );
                  })}
                  {agentHint ? (
                    <Text dimColor wrap="truncate-end">
                      {'  '}
                      {agentHint}
                    </Text>
                  ) : null}
                </>
              )}
            </Box>
          </Box>
        )}

        {task.totalTokens > 0 || task.totalToolCalls > 0 ? (
          <Box marginTop={1}>
            <Text color="subtle">
              totals: {formatTokens(task.totalTokens) ?? 0} tok · {task.totalToolCalls} tools · v{task.progressVersion}
            </Text>
          </Box>
        ) : null}
      </Dialog>
    </Box>
  );
}
