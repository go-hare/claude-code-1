/**
 * WorkflowDetailDialog — live monitor for local_workflow background tasks.
 * Aligned to 2.1.289 Kze (@208301600): frameless split-pane layout with
 * phases -> agents -> agent detail card drill-down, j/k card scroll, and
 * f status filter.
 */

import figures from 'figures';
import React, { useMemo, useState } from 'react';
import type { CommandResultDisplay } from 'src/commands.js';
import type { DeepImmutable } from 'src/types/utils.js';
import {
  Box,
  Dialog,
  type KeyboardEvent,
  stringWidth,
  Text,
  type Theme,
  useAnimationFrame,
  useIsInsideModal,
  useModalOrTerminalSize,
  useTerminalSize,
} from '@anthropic/ink';
import { useRegisterOverlay } from '../../context/overlayContext.js';
import { useKeybindings } from '../../keybindings/useKeybinding.js';
import type { LocalWorkflowTaskState } from '../../tasks/LocalWorkflowTask/LocalWorkflowTask.js';
import type { SdkWorkflowAgentProgress, SdkWorkflowProgress } from '../../types/workflowProgress.js';
import { formatDuration, truncateToWidth } from '../../utils/format.js';
import { plural } from '../../utils/stringUtils.js';
import { truncateToWidthNoEllipsis } from '../../utils/truncate.js';
import { agentDisplayStatus, type FoldedPhase, foldWorkflowPhases, isAgentLive } from '../../workflow/foldProgress.js';
import { formatTaskModelEffort } from './BackgroundTask.js';

type DrillLevel = 'phases' | 'agents' | 'agent';

const STATUS_FILTERS = ['all', 'running', 'queued', 'failed', 'done', 'skipped', 'blocked', 'interrupted'] as const;
type AgentStatusFilter = (typeof STATUS_FILTERS)[number];

type AgentStatus = Exclude<AgentStatusFilter, 'all'>;

const STATUS_LABELS: Record<AgentStatus, string> = {
  queued: 'Queued',
  running: 'Running',
  done: 'Completed',
  failed: 'Failed',
  skipped: 'Skipped',
  blocked: 'Blocked',
  interrupted: 'Stopped',
};

const BOX_CHARS = {
  topLeft: '╭',
  topRight: '╮',
  bottomLeft: '╰',
  bottomRight: '╯',
  horizontal: '─',
  vertical: '│',
  teeDown: '┬',
  teeUp: '┴',
} as const;

const PROMPT_COLLAPSED_LINES = 2;
const OUTCOME_COLLAPSED_LINES = 20;

type Props = {
  task: DeepImmutable<LocalWorkflowTaskState>;
  onBack?: () => void;
  onDone?: (result?: string, options?: { display?: CommandResultDisplay }) => void;
  onKill?: () => void;
  onSkipAgent?: (agentId: string) => void;
  onRetryAgent?: (agentId: string) => void;
  onPause?: () => void;
  initialPhaseIndex?: number;
  /** Reserve reply rows when not in a modal. */
  promptVisibleBelow?: boolean;
};

export type VisibleWindow = {
  from: number;
  to: number;
  above: number;
  below: number;
};

/** Focus-centered slice so overflowing lists do not clip the header. */
export function computeVisibleWindow(focus: number, total: number, visible: number): VisibleWindow {
  if (total <= visible) {
    return { from: 0, to: total, above: 0, below: 0 };
  }
  const half = Math.floor(visible / 2);
  const from = Math.max(0, Math.min(focus - half, total - visible));
  const to = from + visible;
  return { from, to, above: from, below: total - to };
}

/** `↑ 2–5 of 12 ↓` (en-dash). */
export function formatVisibleWindowHint(win: VisibleWindow, total: number): string {
  const up = win.from > 0 ? figures.arrowUp : ' ';
  const down = win.to < total ? figures.arrowDown : ' ';
  return `${up} ${win.from + 1}–${win.to} of ${total} ${down}`;
}

/**
 * Stacked-mode list budgets for narrow viewports.
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

/** Keep meta intact when possible; shrink label into the remaining width. */
export function fitAgentColumns(label: string, meta: string, width: number): { label: string; meta: string } {
  if (width <= 0) return { label: '', meta: '' };
  const metaW = stringWidth(meta);
  if (!meta) {
    return { label: truncateToWidthNoEllipsis(label, width), meta: '' };
  }
  if (metaW >= width) {
    return { label: '', meta: truncateToWidthNoEllipsis(meta, width) };
  }
  const gap = 1;
  const labelBudget = Math.max(0, width - metaW - gap);
  return {
    label: truncateToWidthNoEllipsis(label, labelBudget),
    meta,
  };
}

function clamp(n: number, lo: number, hi: number): number {
  if (hi < lo) return lo;
  return Math.max(lo, Math.min(hi, n));
}

function formatTokens(n: number | undefined): string | null {
  if (n == null || n <= 0) return null;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(n);
}

function resolveAgentStatus(agent: SdkWorkflowAgentProgress, running: boolean): AgentStatus {
  const base = agentDisplayStatus(agent, running);
  if (base === 'failed' && 'blocked' in agent && (agent as Record<string, unknown>).blocked === true) {
    return 'blocked';
  }
  return base;
}

function statusGlyph(status: AgentStatus): { glyph: string; color: keyof Theme } {
  switch (status) {
    case 'done':
      return { glyph: figures.tick, color: 'success' };
    case 'failed':
      return { glyph: figures.cross, color: 'error' };
    case 'skipped':
      return { glyph: figures.cross, color: 'subtle' };
    case 'blocked':
      return { glyph: figures.cross, color: 'permission' };
    case 'queued':
    case 'interrupted':
      return { glyph: '○', color: 'subtle' };
    case 'running':
      return { glyph: '⏺', color: 'subtle' };
  }
}

type Seg = {
  text: string;
  color?: keyof Theme;
  dimColor?: boolean;
  bold?: boolean;
};

function fitSegments(segs: Seg[], width: number): { segs: Seg[]; pad: number } {
  let used = 0;
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i]!;
    const w = stringWidth(seg.text);
    if (used + w > width) {
      const rem = width - used;
      const clipped = rem > 0 ? truncateToWidth(seg.text, rem) : '';
      const out = segs.slice(0, i);
      if (clipped) out.push({ ...seg, text: clipped });
      return { segs: out, pad: Math.max(0, rem - stringWidth(clipped)) };
    }
    used += w;
  }
  return { segs, pad: Math.max(0, width - used) };
}

function SegRow({ segs, width }: { segs: Seg[]; width: number }): React.ReactNode {
  const { segs: fitted, pad } = fitSegments(segs, width);
  return (
    <>
      {fitted.map((s, idx) => (
        <Text key={idx} color={s.color} dimColor={s.dimColor} bold={s.bold ?? false}>
          {s.text}
        </Text>
      ))}
      {' '.repeat(pad)}
    </>
  );
}

function FramedSingleRow({ segs, contentWidth }: { segs: Seg[]; contentWidth: number }): React.ReactNode {
  return (
    <Text wrap="truncate-end">
      <Text color="text"> {BOX_CHARS.vertical} </Text>
      <SegRow segs={segs} width={contentWidth} />
      <Text color="text"> {BOX_CHARS.vertical}</Text>
    </Text>
  );
}

function FramedSplitRow({
  left,
  right,
  leftWidth,
  rightWidth,
}: {
  left: Seg[];
  right: Seg[];
  leftWidth: number;
  rightWidth: number;
}): React.ReactNode {
  return (
    <Text wrap="truncate-end">
      <Text color="text"> {BOX_CHARS.vertical} </Text>
      <SegRow segs={left} width={leftWidth} />
      <Text color="text"> {BOX_CHARS.vertical} </Text>
      <SegRow segs={right} width={rightWidth} />
      <Text color="text"> {BOX_CHARS.vertical}</Text>
    </Text>
  );
}

function buildBorderSpan(spanWidth: number, title?: string, tag?: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let used = 0;
  if (title) {
    const labelText = ` ${truncateToWidth(title, Math.max(1, spanWidth - 2))} `;
    used += stringWidth(labelText);
    nodes.push(
      <Text key="label" color="text">
        {labelText}
      </Text>,
    );
  }
  const tagText = tag ? ` ${truncateToWidth(tag, Math.max(0, spanWidth - used - 2))} ` : '';
  const dashCount = Math.max(0, spanWidth - used - stringWidth(tagText));
  nodes.push(
    <Text key="dash" color="text">
      {BOX_CHARS.horizontal.repeat(dashCount)}
    </Text>,
  );
  if (tagText) {
    nodes.push(
      <Text key="tag" dimColor>
        {tagText}
      </Text>,
    );
  }
  return nodes;
}

function SplitBorder({
  pos,
  leftWidth,
  rightWidth,
  leftTitle,
  rightTitle,
  leftTag,
  rightTag,
}: {
  pos: 'top' | 'bottom';
  leftWidth: number;
  rightWidth: number;
  leftTitle?: string;
  rightTitle?: string;
  leftTag?: string;
  rightTag?: string;
}): React.ReactNode {
  const leftCorner = pos === 'top' ? BOX_CHARS.topLeft : BOX_CHARS.bottomLeft;
  const midTee = pos === 'top' ? BOX_CHARS.teeDown : BOX_CHARS.teeUp;
  const rightCorner = pos === 'top' ? BOX_CHARS.topRight : BOX_CHARS.bottomRight;
  return (
    <Text wrap="truncate-end">
      <Text color="text"> {leftCorner}</Text>
      {buildBorderSpan(leftWidth + 2, leftTitle, leftTag)}
      <Text color="text">{midTee}</Text>
      {buildBorderSpan(rightWidth + 2, rightTitle, rightTag)}
      <Text color="text">{rightCorner}</Text>
    </Text>
  );
}

function agentCountLabel(count: number, filterLabel: string | undefined): string {
  return filterLabel ? `showing ${count} ${filterLabel}` : `${count} ${plural(count, 'agent')}`;
}

function emptyAgentsLabel(phase: FoldedPhase, filterLabel: string | undefined): string {
  if (phase.status === 'not-started') return 'Not started yet';
  return filterLabel ? `No ${filterLabel} agents` : 'No agents';
}

function wrapPlainTextLines(text: string, width: number): string[] {
  const w = Math.max(1, width);
  const out: string[] = [];
  for (const rawLine of text.split('\n')) {
    if (rawLine === '') {
      out.push('');
      continue;
    }
    let rest = rawLine;
    while (stringWidth(rest) > w) {
      const chunk = truncateToWidthNoEllipsis(rest, w);
      if (!chunk) break;
      out.push(chunk);
      rest = rest.slice(chunk.length);
    }
    out.push(rest);
  }
  return out;
}

function appendCollapsibleSection(opts: {
  lines: Seg[][];
  title: string;
  body: Seg[][];
  collapsedLines: number;
  expanded: boolean;
  width: number;
}): number {
  const { lines, title, body, collapsedLines, expanded, width } = opts;
  const overflow = body.length - collapsedLines;
  const hiddenCount = overflow >= 2 ? overflow : 0;
  const header: Seg[] = [{ text: title, bold: true, dimColor: true }];
  if (hiddenCount > 0) {
    header.push({
      text: truncateToWidth(
        ` · ${body.length} lines${expanded ? '' : ' · enter expand'}`,
        Math.max(0, width - stringWidth(title)),
      ),
      dimColor: true,
    });
  }
  lines.push(header);
  const shown = expanded || hiddenCount === 0 ? body : body.slice(0, collapsedLines);
  for (const row of shown) lines.push(row);
  if (!expanded && hiddenCount > 0) {
    lines.push([
      {
        text: truncateToWidth(`  … ${hiddenCount} more ${plural(hiddenCount, 'line')}`, width),
        dimColor: true,
      },
    ]);
  }
  return hiddenCount;
}

function buildAgentDetailLines(opts: {
  agent: SdkWorkflowAgentProgress;
  status: AgentStatus;
  expanded: boolean;
  width: number;
  nowMs: number;
}): { lines: Seg[][]; expandable: boolean } {
  const { agent, status, expanded, width, nowMs } = opts;
  const lines: Seg[][] = [];
  const bodyWidth = Math.max(8, width - 2);
  const { glyph, color } = statusGlyph(status);

  const metaParts: string[] = [];
  if (agent.model) {
    metaParts.push(formatTaskModelEffort(agent.model, undefined) ?? agent.model);
  }
  if (agent.agentType) metaParts.push(agent.agentType);
  if (agent.isolation) metaParts.push(agent.isolation);
  if (agent.cached) metaParts.push('from resume journal');

  const statusHeadWidth = stringWidth(glyph) + 1 + stringWidth(STATUS_LABELS[status]);
  const metaSuffix =
    metaParts.length > 0 ? truncateToWidth(` · ${metaParts.join(' · ')}`, Math.max(0, width - statusHeadWidth)) : '';
  lines.push([
    { text: glyph, color },
    { text: ' ' },
    { text: STATUS_LABELS[status], color, bold: true },
    ...(metaSuffix ? [{ text: metaSuffix, dimColor: true }] : []),
  ]);

  const statsParts: string[] = [];
  const tok = formatTokens(agent.tokens);
  if (tok) statsParts.push(`${tok} tok`);
  if (agent.toolCalls != null && agent.toolCalls > 0) {
    statsParts.push(`${agent.toolCalls} ${plural(agent.toolCalls, 'tool call')}`);
  }
  if (agent.durationMs != null) statsParts.push(formatDuration(agent.durationMs));
  if (status === 'queued' && agent.queuedAt != null) {
    statsParts.push(`waiting ${formatDuration(Math.max(0, nowMs - agent.queuedAt))}`);
  }
  if (status === 'running' && agent.lastProgressAt != null) {
    const idleSec = Math.floor((nowMs - agent.lastProgressAt) / 1000);
    if (idleSec >= 30) statsParts.push(`idle ${formatDuration(idleSec * 1000)}`);
  }
  if (statsParts.length > 0) {
    lines.push([{ text: truncateToWidth(statsParts.join(' · '), width), dimColor: true }]);
  }
  lines.push([{ text: '' }]);

  const promptRaw = agent.promptPreview ?? '';
  const promptBody: Seg[][] = promptRaw
    ? wrapPlainTextLines(promptRaw, bodyWidth).map(l => [{ text: `  ${l}`, dimColor: true }])
    : [
        [
          {
            text: `  ${
              status === 'queued'
                ? 'Available once the agent starts.'
                : status === 'running'
                  ? 'Not available yet (agent still running).'
                  : 'Transcript not available.'
            }`,
            dimColor: true,
          },
        ],
      ];
  const promptHidden = appendCollapsibleSection({
    lines,
    title: 'Prompt',
    body: promptBody,
    collapsedLines: PROMPT_COLLAPSED_LINES,
    expanded,
    width,
  });
  lines.push([{ text: '' }]);

  if (status !== 'queued') {
    lines.push([{ text: 'Activity', bold: true, dimColor: true }]);
    if (agent.lastToolName) {
      lines.push([{ text: truncateToWidth(`  ${agent.lastToolName}`, width), dimColor: true }]);
    } else {
      lines.push([
        {
          text: `  ${status === 'running' ? 'No tool calls yet.' : 'No tool calls.'}`,
          dimColor: true,
        },
      ]);
    }
    lines.push([{ text: '' }]);
  }

  const outcomeBody: Seg[][] = [];
  switch (status) {
    case 'queued':
      outcomeBody.push([{ text: '  Waiting for an agent slot.', dimColor: true }]);
      break;
    case 'running':
      outcomeBody.push([{ text: '  Still running…', dimColor: true }]);
      break;
    case 'interrupted':
      outcomeBody.push([{ text: '  The workflow stopped before this agent finished.', dimColor: true }]);
      break;
    case 'skipped':
      outcomeBody.push([{ text: '  Skipped by user.', dimColor: true }]);
      break;
    case 'blocked':
    case 'failed':
      for (const l of wrapPlainTextLines(agent.error ?? 'failed', bodyWidth)) {
        outcomeBody.push([{ text: `  ${l}`, color: 'error' }]);
      }
      break;
    case 'done': {
      const finalText = agent.resultPreview ?? '';
      if (!finalText) {
        outcomeBody.push([{ text: '  (empty)', dimColor: true }]);
      } else {
        for (const l of wrapPlainTextLines(finalText, bodyWidth)) {
          outcomeBody.push([{ text: `  ${l}` }]);
        }
      }
      break;
    }
  }
  const outcomeHidden = appendCollapsibleSection({
    lines,
    title: 'Outcome',
    body: outcomeBody,
    collapsedLines: OUTCOME_COLLAPSED_LINES,
    expanded,
    width,
  });

  return {
    lines,
    expandable: promptHidden > 0 || outcomeHidden > 0,
  };
}

function buildPhaseSegs(
  phase: FoldedPhase,
  index: number,
  selectedPhaseIdx: number,
  level: DrillLevel,
  width: number,
): Seg[] {
  const isSelected = index === selectedPhaseIdx;
  const isDone = phase.status === 'done';
  const isFailed = phase.status === 'failed';
  const mark = isDone ? figures.tick : isFailed ? figures.cross : String(index + 1);
  const markColor: keyof Theme = isSelected ? 'permission' : isDone ? 'success' : isFailed ? 'error' : 'subtle';
  const countStr = phase.totalCount > 0 ? `${phase.doneCount}/${phase.totalCount}` : '';
  const pointer = level === 'phases' && isSelected ? `${figures.pointer} ` : '  ';
  const prefixW = stringWidth(pointer) + stringWidth(mark) + 1;
  const countW = countStr ? 1 + stringWidth(countStr) : 0;
  const titleFit = truncateToWidth(phase.title, Math.max(1, width - prefixW - countW));
  const pad = Math.max(0, width - prefixW - stringWidth(titleFit) - countW);
  const dim = !isSelected && phase.status === 'not-started';
  const segs: Seg[] = [
    { text: pointer, color: isSelected ? 'permission' : undefined },
    { text: mark, color: markColor },
    { text: ' ' },
    { text: titleFit, color: isSelected ? 'permission' : undefined, dimColor: dim },
    { text: ' '.repeat(pad) },
  ];
  if (countStr) {
    segs.push({ text: ' ' }, { text: countStr, color: isSelected ? 'permission' : 'subtle' });
  }
  return segs;
}

function buildAgentStatsSegs(
  agent: SdkWorkflowAgentProgress,
  width: number,
  selected: boolean,
  running: boolean,
  nowMs: number,
): Seg[] {
  if (width <= 0) return [];
  const status = resolveAgentStatus(agent, running);
  const model = agent.model ? (formatTaskModelEffort(agent.model, undefined) ?? agent.model) : '';
  const statsParts: string[] = [];
  if (agent.isolation) statsParts.push(agent.isolation);
  const tok = formatTokens(agent.tokens);
  if (tok) statsParts.push(`${tok} tok`);
  if (status === 'running' && agent.lastProgressAt != null) {
    const idleSec = Math.floor((nowMs - agent.lastProgressAt) / 1000);
    if (idleSec >= 30) statsParts.push(`idle ${formatDuration(idleSec * 1000)}`);
  }
  if (status === 'queued') statsParts.push('queued');
  if (status === 'interrupted') statsParts.push('stopped');
  if (status === 'skipped') statsParts.push('skipped');
  if (status === 'blocked') statsParts.push('blocked');
  if (status === 'failed') statsParts.push('failed');
  const durMs =
    agent.durationMs ??
    (status === 'running' && agent.startedAt != null ? Math.max(0, nowMs - agent.startedAt) : undefined);
  const timeStr = durMs != null ? formatDuration(durMs) : '';
  const color: keyof Theme | undefined = selected ? 'permission' : undefined;
  const dimColor = !selected;

  const timeCell = timeStr ? truncateToWidth(timeStr, width).padStart(Math.min(6, width)) : '';
  const leftBudget = timeCell ? width - stringWidth(timeCell) - 1 : width;
  let m = model;
  let st = statsParts.join(' · ');
  const sepLen = (a: string, b: string) => (a && b ? 3 : 0);
  if (stringWidth(m) + sepLen(m, st) + stringWidth(st) > leftBudget) {
    st = truncateToWidth(st, Math.max(0, leftBudget - stringWidth(m) - sepLen(m, st)));
    if (stringWidth(m) + sepLen(m, st) + stringWidth(st) > leftBudget) {
      m = truncateToWidth(m, Math.max(0, leftBudget - stringWidth(st) - sepLen(m, st)));
    }
  }
  const sep = m && st ? ' · ' : '';
  const pad = Math.max(0, width - stringWidth(m) - stringWidth(sep) - stringWidth(st) - stringWidth(timeCell));
  return [
    { text: m, color, dimColor },
    { text: sep, color, dimColor },
    { text: st, color, dimColor },
    { text: ' '.repeat(pad) },
    { text: timeCell, color, dimColor },
  ];
}

function computeAgentLabelWidth(agents: readonly SdkWorkflowAgentProgress[], availWidth: number): number {
  const cap = Math.min(
    40,
    Math.max(22, availWidth - 30),
    Math.max(4, Math.min(availWidth, Math.max(12, availWidth - 7))),
  );
  const longest = agents.reduce((acc, a) => Math.max(acc, stringWidth(a.label ?? `agent-${a.index}`)), 0);
  return Math.min(Math.max(12, longest), cap);
}

function buildAgentRowSegs(
  agent: SdkWorkflowAgentProgress,
  idx: number,
  selectedAgentIdx: number,
  level: DrillLevel,
  rightWidth: number,
  labelWidth: number,
  running: boolean,
  nowMs: number,
): Seg[] {
  const selected = level === 'agents' && idx === selectedAgentIdx;
  const status = resolveAgentStatus(agent, running);
  const { glyph, color } = statusGlyph(status);
  const rawLabel = agent.label ?? `agent-${agent.index}`;
  const labelFit = truncateToWidth(rawLabel, labelWidth);
  const labelPad = ' '.repeat(Math.max(0, labelWidth - stringWidth(labelFit)));
  const statsWidth = Math.max(0, rightWidth - (labelWidth + 4));
  const isLive = agent.state === 'start' || agent.state === 'progress';
  return [
    { text: selected ? figures.pointer : ' ', color: 'permission' },
    { text: glyph, color },
    { text: ' ' },
    { text: `${labelFit}${labelPad}`, color: selected ? 'permission' : undefined, dimColor: !selected && isLive },
    { text: ' ' },
    ...buildAgentStatsSegs(agent, statsWidth, selected, running, nowMs),
  ];
}

function buildCompactAgentLeftSegs(
  agent: SdkWorkflowAgentProgress,
  idx: number,
  selectedAgentIdx: number,
  leftWidth: number,
  running: boolean,
): Seg[] {
  const selected = idx === selectedAgentIdx;
  const { glyph, color } = statusGlyph(resolveAgentStatus(agent, running));
  const rawLabel = agent.label ?? `agent-${agent.index}`;
  const labelFit = truncateToWidth(rawLabel, Math.max(1, leftWidth - 4));
  const isLive = agent.state === 'start' || agent.state === 'progress';
  return [
    { text: selected ? `${figures.pointer} ` : '  ', color: 'permission' },
    { text: glyph, color },
    { text: ' ' },
    { text: labelFit, color: selected ? 'permission' : undefined, dimColor: !selected && isLive },
  ];
}

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
  useRegisterOverlay('workflow-detail-dialog');

  const running = task.status === 'running';
  const terminalSize = useTerminalSize();
  const modalSize = useModalOrTerminalSize(terminalSize);
  const insideModal = useIsInsideModal();

  const availableRows = insideModal
    ? modalSize.rows
    : promptVisibleBelow
      ? Math.max(12, modalSize.rows - 9)
      : modalSize.rows;
  const gfsWidth = Math.max(24, terminalSize.columns - 6);
  const contentWidth = Math.max(12, gfsWidth - 6);

  const { phases, doneAgents, totalAgents } = useMemo(
    () =>
      foldWorkflowPhases(
        task.workflowProgress as unknown as SdkWorkflowProgress[],
        task.declaredPhases ?? null,
        task.agentCount ?? 0,
      ),
    [task.workflowProgress, task.declaredPhases, task.agentCount],
  );

  const [level, setLevel] = useState<DrillLevel>(() => (initialPhaseIndex !== undefined ? 'agents' : 'phases'));
  const [phaseIdx, setPhaseIdx] = useState(() => clamp(initialPhaseIndex ?? 0, 0, Math.max(0, phases.length - 1)));
  const [agentIdx, setAgentIdx] = useState(0);
  const [statusFilter, setStatusFilter] = useState<AgentStatusFilter>('all');
  const [cardState, setCardState] = useState<{ scroll: number; expanded: boolean }>({ scroll: 0, expanded: false });

  const [clockRef, now] = useAnimationFrame(running ? 1000 : null);
  const elapsed = Math.max(0, (task.endTime ?? now) - task.startTime);

  const safePhase = clamp(phaseIdx, 0, Math.max(0, phases.length - 1));
  const rawPhase = phases[safePhase];
  const filteredPhase: FoldedPhase | undefined = useMemo(() => {
    if (!rawPhase || statusFilter === 'all' || level === 'phases') return rawPhase;
    return {
      ...rawPhase,
      agents: rawPhase.agents.filter(a => resolveAgentStatus(a, running) === statusFilter),
    };
  }, [rawPhase, statusFilter, level, running]);

  const agents = filteredPhase?.agents ?? [];
  const safeAgent = clamp(agentIdx, 0, Math.max(0, agents.length - 1));
  const selectedAgent = level !== 'phases' ? agents[safeAgent] : undefined;
  const selectedStatus = selectedAgent ? resolveAgentStatus(selectedAgent, running) : undefined;

  const resetCard = (): void => {
    setCardState({ scroll: 0, expanded: false });
  };

  const stepPhase = (delta: number): void => {
    setPhaseIdx(i => clamp(clamp(i, 0, phases.length - 1) + delta, 0, phases.length - 1));
    setAgentIdx(0);
    resetCard();
  };

  const stepAgent = (delta: number): void => {
    if (!filteredPhase) return;
    setAgentIdx(i => clamp(clamp(i, 0, filteredPhase.agents.length - 1) + delta, 0, filteredPhase.agents.length - 1));
    resetCard();
  };

  const stepSelection = (delta: number): void => {
    if (level === 'phases') stepPhase(delta);
    else stepAgent(delta);
  };

  const goBackOneLevel = (): void => {
    if (level === 'agent') {
      setLevel('agents');
      return;
    }
    if (level === 'agents') {
      setLevel('phases');
      return;
    }
    if (onBack) onBack();
    else onDone?.();
  };

  const cycleFilter = (): void => {
    if (!rawPhase) return;
    const present = new Set(rawPhase.agents.map(a => resolveAgentStatus(a, running)));
    setStatusFilter(current => {
      let idx = STATUS_FILTERS.indexOf(current);
      for (let step = 0; step < STATUS_FILTERS.length; step++) {
        idx = (idx + 1) % STATUS_FILTERS.length;
        const candidate = STATUS_FILTERS[idx]!;
        if (candidate === 'all' || present.has(candidate)) {
          return candidate;
        }
      }
      return 'all';
    });
    setAgentIdx(0);
    resetCard();
  };

  useKeybindings(
    {
      'confirm:previous': () => stepSelection(-1),
      'confirm:next': () => stepSelection(1),
    },
    { context: 'Confirmation' },
  );

  // Split-pane geometry (Kze @208301600)
  const splitInnerTotal = gfsWidth - 9;
  const agentListDesiredLeft = filteredPhase
    ? Math.max(14, ...filteredPhase.agents.map(a => 4 + stringWidth(a.label ?? `agent-${a.index}`)))
    : 14;
  const agentDetailLeftWidth = Math.max(12, Math.min(30, agentListDesiredLeft, splitInnerTotal - 30));
  const agentDetailRightWidth = splitInnerTotal - agentDetailLeftWidth;
  const splitAgentDetail = level === 'agent' && phases.length > 0 && gfsWidth >= 64 && agentDetailRightWidth >= 30;
  const detailCardWidth = splitAgentDetail ? agentDetailRightWidth : contentWidth;

  const detailCard = useMemo(() => {
    if (level !== 'agent' || !selectedAgent || !selectedStatus) {
      return { lines: [] as Seg[][], expandable: false };
    }
    return buildAgentDetailLines({
      agent: selectedAgent,
      status: selectedStatus,
      expanded: cardState.expanded,
      width: detailCardWidth,
      nowMs: now,
    });
  }, [level, selectedAgent, selectedStatus, cardState.expanded, detailCardWidth, now]);

  const { tight, phaseViewport, agentViewport } = workflowDetailListBudgets(availableRows, phases.length);
  const splitViewport = Math.max(1, availableRows - (tight ? 7 : 8));
  const singleCardViewport = Math.max(3, availableRows - (tight ? 8 : 9));
  const activeDetailViewport = splitAgentDetail ? splitViewport : singleCardViewport;
  const maxCardScroll = Math.max(0, detailCard.lines.length - activeDetailViewport);
  const clampedCardScroll = clamp(cardState.scroll, 0, maxCardScroll);

  const phasesDesiredLeft = Math.max(
    14,
    ...phases.map((p, idx) => {
      const mark = p.status === 'done' ? figures.tick : p.status === 'failed' ? figures.cross : String(idx + 1);
      const frac = p.totalCount > 0 ? `${p.doneCount}/${p.totalCount}` : '';
      return 2 + stringWidth(mark) + 1 + stringWidth(p.title) + (frac ? 1 + stringWidth(frac) : 0);
    }),
  );
  const splitPhasesLeftWidth = Math.max(12, Math.min(34, phasesDesiredLeft, splitInnerTotal - 24));
  const splitPhasesRightWidth = splitInnerTotal - splitPhasesLeftWidth;
  const splitPhasesAgents = level !== 'agent' && phases.length > 0 && gfsWidth >= 64 && splitPhasesRightWidth >= 20;

  const liveSelected =
    selectedAgent != null && (isAgentLive(selectedAgent) || selectedAgent.state === 'progress') && running;
  const canStopAgent = liveSelected && (Boolean(onSkipAgent) || Boolean(onKill));
  const canRetryAgent = liveSelected && Boolean(onRetryAgent);
  const canStopWorkflow = running && Boolean(onKill) && level === 'phases';
  const canPauseWorkflow = running && Boolean(onPause);

  const handleKeyDown = (e: KeyboardEvent): void => {
    if (e.ctrl || e.meta) return;

    if (e.key === 'j') {
      e.preventDefault();
      if (level === 'agent') {
        setCardState(s => ({ ...s, scroll: Math.min(maxCardScroll, s.scroll + 1) }));
      } else {
        stepSelection(1);
      }
      return;
    }
    if (e.key === 'k') {
      e.preventDefault();
      if (level === 'agent') {
        setCardState(s => ({ ...s, scroll: Math.max(0, s.scroll - 1) }));
      } else {
        stepSelection(-1);
      }
      return;
    }
    if (e.key === 'return' || e.key === 'right') {
      e.preventDefault();
      if (level === 'phases') {
        if (rawPhase && rawPhase.agents.length > 0) {
          setAgentIdx(0);
          setStatusFilter('all');
          setLevel('agents');
        }
      } else if (level === 'agents') {
        if (!selectedAgent || !rawPhase) return;
        if (statusFilter !== 'all') {
          setStatusFilter('all');
          setAgentIdx(Math.max(0, rawPhase.agents.indexOf(selectedAgent)));
        }
        resetCard();
        setLevel('agent');
      } else if (e.key === 'return' && detailCard.expandable) {
        setCardState(s => ({ ...s, expanded: !s.expanded }));
      }
      return;
    }
    if (e.key === 'left') {
      e.preventDefault();
      goBackOneLevel();
      return;
    }
    if (e.key === ' ') {
      e.preventDefault();
      if (onDone) onDone('Background dialog dismissed', { display: 'skip' });
      else onBack?.();
      return;
    }
    if (e.key === 'f' && level === 'agents') {
      e.preventDefault();
      cycleFilter();
      return;
    }
    if (e.key === 'x') {
      if (canStopAgent && selectedAgent) {
        e.preventDefault();
        const id = selectedAgent.agentId ?? String(selectedAgent.index);
        if (onSkipAgent) onSkipAgent(id);
        else onKill?.();
        return;
      }
      if (canStopWorkflow) {
        e.preventDefault();
        onKill?.();
      }
      return;
    }
    if (e.key === 'r' && canRetryAgent && selectedAgent) {
      e.preventDefault();
      onRetryAgent?.(selectedAgent.agentId ?? String(selectedAgent.index));
      return;
    }
    if (e.key === 'p' && canPauseWorkflow) {
      e.preventDefault();
      onPause?.();
    }
  };

  const statusSuffix =
    task.status === 'completed'
      ? ' · done'
      : task.status === 'killed'
        ? ' · stopped'
        : task.status === 'paused'
          ? ' · paused'
          : task.status === 'failed'
            ? ' · failed'
            : '';
  const workflowName = task.workflowName || task.summary || task.description || 'workflow';
  const subtext = task.description || task.summary || '';
  const statsText = `${doneAgents}/${totalAgents} ${plural(totalAgents, 'agent')} · ${formatDuration(elapsed)}${statusSuffix}`;

  const filterLabel =
    statusFilter !== 'all' && level !== 'phases' ? STATUS_LABELS[statusFilter].toLowerCase() : undefined;

  const hints: string[] = [];
  if (level === 'agent') {
    hints.push(`${figures.arrowUp}${figures.arrowDown} agent`);
    if (detailCard.lines.length > activeDetailViewport) hints.push('j/k scroll');
    if (detailCard.expandable) hints.push(`enter ${cardState.expanded ? 'collapse' : 'expand'}`);
  } else if (phases.length > 0) {
    hints.push(`${figures.arrowUp}${figures.arrowDown} select`);
  }
  if (canStopAgent) hints.push('x stop');
  if (canStopWorkflow) hints.push('x stop workflow');
  if (canRetryAgent) hints.push('r restart');
  if (canPauseWorkflow) hints.push('p pause');
  if (level === 'agents' && phases.length > 0) {
    hints.push(filterLabel ? `f filter: ${filterLabel}` : 'f filter');
  }
  hints.push('esc back');
  const hintLine = hints.join(' · ');

  const minHeight = Math.max(tight ? 8 : 12, Math.min(availableRows - 1, modalSize.rows - 6));
  const maxHeight = Math.max(tight ? 8 : 11, availableRows - 1);

  return (
    <Box ref={clockRef} flexDirection="column" tabIndex={0} autoFocus onKeyDown={handleKeyDown}>
      <Dialog title={null} hideBorder hideInputGuide onCancel={goBackOneLevel} color="text">
        <Box flexDirection="column" width={gfsWidth} minHeight={minHeight} maxHeight={maxHeight} overflowY="hidden">
          {task.status === 'failed' && task.error ? (
            <Box marginBottom={1}>
              <Text color="error">Error: {task.error}</Text>
            </Box>
          ) : null}

          {phases.length === 0 ? (
            <>
              <Text dimColor>No agents yet.</Text>
              <Box flexGrow={1} />
            </>
          ) : (
            <>
              <WorkflowHeader
                name={workflowName}
                subtext={subtext}
                stats={statsText}
                width={gfsWidth}
                insideModal={insideModal}
              />
              {!tight && <Box height={1} />}

              {level === 'agent' && selectedAgent && filteredPhase ? (
                splitAgentDetail ? (
                  <SplitAgentDetailView
                    phase={filteredPhase}
                    clampedAgent={safeAgent}
                    agentLabel={selectedAgent.label ?? `agent-${selectedAgent.index}`}
                    detailLines={detailCard.lines}
                    cardScroll={clampedCardScroll}
                    leftWidth={agentDetailLeftWidth}
                    rightWidth={agentDetailRightWidth}
                    viewport={splitViewport}
                    workflowActive={running}
                    filterLabel={filterLabel}
                  />
                ) : (
                  <SingleAgentDetailCard
                    agentLabel={selectedAgent.label ?? `agent-${selectedAgent.index}`}
                    position={`${safeAgent + 1}/${filteredPhase.agents.length}`}
                    detailLines={detailCard.lines}
                    cardScroll={clampedCardScroll}
                    contentWidth={contentWidth}
                    viewport={singleCardViewport}
                  />
                )
              ) : splitPhasesAgents && filteredPhase ? (
                <SplitPhasesAgentsView
                  phases={phases}
                  selectedPhase={filteredPhase}
                  clampedPhase={safePhase}
                  clampedAgent={safeAgent}
                  level={level}
                  leftWidth={splitPhasesLeftWidth}
                  rightWidth={splitPhasesRightWidth}
                  viewport={splitViewport}
                  workflowActive={running}
                  filterLabel={filterLabel}
                  nowMs={now}
                />
              ) : (
                <StackedPhasesAgentsView
                  phases={phases}
                  selectedPhase={filteredPhase}
                  clampedPhase={safePhase}
                  clampedAgent={safeAgent}
                  level={level}
                  contentWidth={contentWidth}
                  phaseViewport={phaseViewport}
                  agentViewport={agentViewport}
                  tight={tight}
                  workflowActive={running}
                  filterLabel={filterLabel}
                  nowMs={now}
                />
              )}
              <Box flexGrow={1} />
            </>
          )}

          <Text dimColor italic wrap="truncate-end">
            {' '}
            {hintLine}
          </Text>
        </Box>
      </Dialog>
    </Box>
  );
}

function WorkflowHeader({
  name,
  subtext,
  stats,
  width,
  insideModal,
}: {
  name: string;
  subtext: string;
  stats: string;
  width: number;
  insideModal: boolean;
}): React.ReactNode {
  return (
    <Box flexDirection="column">
      {!insideModal && (
        <Text color="text" wrap="truncate-end">
          {BOX_CHARS.horizontal.repeat(Math.max(1, width))}
        </Text>
      )}
      <Text bold color="permission" wrap="truncate-end">
        {' '}
        {name}
      </Text>
      <Box width={width} overflow="hidden">
        <Box flexGrow={1} flexShrink={1} overflow="hidden">
          <Text dimColor wrap="truncate-end">
            {' '}
            {subtext}
          </Text>
        </Box>
        {stats ? (
          <Box flexShrink={0}>
            <Text dimColor>{stats} </Text>
          </Box>
        ) : null}
      </Box>
    </Box>
  );
}

function SplitPhasesAgentsView({
  phases,
  selectedPhase,
  clampedPhase,
  clampedAgent,
  level,
  leftWidth,
  rightWidth,
  viewport,
  workflowActive,
  filterLabel,
  nowMs,
}: {
  phases: FoldedPhase[];
  selectedPhase: FoldedPhase;
  clampedPhase: number;
  clampedAgent: number;
  level: DrillLevel;
  leftWidth: number;
  rightWidth: number;
  viewport: number;
  workflowActive: boolean;
  filterLabel: string | undefined;
  nowMs: number;
}): React.ReactNode {
  const agents = selectedPhase.agents;
  const phaseWin = computeVisibleWindow(clampedPhase, phases.length, viewport);
  const agentWin = computeVisibleWindow(clampedAgent, agents.length, viewport);
  const labelWidth = computeAgentLabelWidth(agents, rightWidth - 4);
  const rows: React.ReactNode[] = [];

  for (let r = 0; r < viewport; r++) {
    const pIdx = phaseWin.from + r;
    const aIdx = agentWin.from + r;
    const leftSegs = pIdx < phaseWin.to ? buildPhaseSegs(phases[pIdx]!, pIdx, clampedPhase, level, leftWidth) : [];
    let rightSegs: Seg[];
    if (aIdx < agentWin.to) {
      rightSegs = buildAgentRowSegs(
        agents[aIdx]!,
        aIdx,
        clampedAgent,
        level,
        rightWidth,
        labelWidth,
        workflowActive,
        nowMs,
      );
    } else if (agents.length === 0 && r === 0) {
      rightSegs = [{ text: emptyAgentsLabel(selectedPhase, filterLabel), dimColor: true }];
    } else {
      rightSegs = [];
    }
    rows.push(
      <FramedSplitRow key={r} left={leftSegs} right={rightSegs} leftWidth={leftWidth} rightWidth={rightWidth} />,
    );
  }

  const rightTitle = `${selectedPhase.title} · ${agentCountLabel(agents.length, filterLabel)}`;
  const leftTag = phases.length > viewport ? formatVisibleWindowHint(phaseWin, phases.length) : undefined;
  const rightTag = agents.length > viewport ? formatVisibleWindowHint(agentWin, agents.length) : undefined;

  return (
    <Box flexDirection="column">
      <SplitBorder pos="top" leftWidth={leftWidth} rightWidth={rightWidth} leftTitle="Phases" rightTitle={rightTitle} />
      {rows}
      <SplitBorder pos="bottom" leftWidth={leftWidth} rightWidth={rightWidth} leftTag={leftTag} rightTag={rightTag} />
    </Box>
  );
}

function SplitAgentDetailView({
  phase,
  clampedAgent,
  agentLabel,
  detailLines,
  cardScroll,
  leftWidth,
  rightWidth,
  viewport,
  workflowActive,
  filterLabel,
}: {
  phase: FoldedPhase;
  clampedAgent: number;
  agentLabel: string;
  detailLines: Seg[][];
  cardScroll: number;
  leftWidth: number;
  rightWidth: number;
  viewport: number;
  workflowActive: boolean;
  filterLabel: string | undefined;
}): React.ReactNode {
  const agents = phase.agents;
  const agentWin = computeVisibleWindow(clampedAgent, agents.length, viewport);
  const detailEnd = Math.min(detailLines.length, cardScroll + viewport);
  const rows: React.ReactNode[] = [];

  for (let r = 0; r < viewport; r++) {
    const aIdx = agentWin.from + r;
    const leftSegs =
      aIdx < agentWin.to ? buildCompactAgentLeftSegs(agents[aIdx]!, aIdx, clampedAgent, leftWidth, workflowActive) : [];
    const dIdx = cardScroll + r;
    const rightSegs = dIdx < detailEnd ? (detailLines[dIdx] ?? []) : [];
    rows.push(
      <FramedSplitRow key={r} left={leftSegs} right={rightSegs} leftWidth={leftWidth} rightWidth={rightWidth} />,
    );
  }

  const leftTitle = `${phase.title} · ${agentCountLabel(agents.length, filterLabel)}`;
  const leftTag = agents.length > viewport ? formatVisibleWindowHint(agentWin, agents.length) : undefined;
  const rightTag =
    detailLines.length > viewport
      ? formatVisibleWindowHint(
          { from: cardScroll, to: detailEnd, above: cardScroll, below: detailLines.length - detailEnd },
          detailLines.length,
        )
      : undefined;

  return (
    <Box flexDirection="column">
      <SplitBorder
        pos="top"
        leftWidth={leftWidth}
        rightWidth={rightWidth}
        leftTitle={leftTitle}
        rightTitle={agentLabel}
      />
      {rows}
      <SplitBorder pos="bottom" leftWidth={leftWidth} rightWidth={rightWidth} leftTag={leftTag} rightTag={rightTag} />
    </Box>
  );
}

function SingleAgentDetailCard({
  agentLabel,
  position,
  detailLines,
  cardScroll,
  contentWidth,
  viewport,
}: {
  agentLabel: string;
  position: string;
  detailLines: Seg[][];
  cardScroll: number;
  contentWidth: number;
  viewport: number;
}): React.ReactNode {
  const dashFull = BOX_CHARS.horizontal.repeat(contentWidth + 2);
  const detailEnd = Math.min(detailLines.length, cardScroll + viewport);
  const posSuffix = ` · ${position}`;
  const labelFit = truncateToWidth(agentLabel, Math.max(1, contentWidth - stringWidth(posSuffix)));

  const rows: React.ReactNode[] = [
    <FramedSingleRow
      key="title"
      contentWidth={contentWidth}
      segs={[
        { text: labelFit, color: 'permission', bold: true },
        { text: posSuffix, dimColor: true },
      ]}
    />,
  ];

  for (let i = cardScroll; i < detailEnd; i++) {
    rows.push(<FramedSingleRow key={`l-${i}`} contentWidth={contentWidth} segs={detailLines[i] ?? []} />);
  }
  for (let p = detailEnd - cardScroll; p < viewport; p++) {
    rows.push(<FramedSingleRow key={`pad-${p}`} contentWidth={contentWidth} segs={[{ text: '' }]} />);
  }

  const bottomTag =
    detailLines.length > viewport
      ? ` ${formatVisibleWindowHint(
          { from: cardScroll, to: detailEnd, above: cardScroll, below: detailLines.length - detailEnd },
          detailLines.length,
        )} `
      : '';
  const bottomDash = BOX_CHARS.horizontal.repeat(Math.max(0, contentWidth + 2 - stringWidth(bottomTag)));

  return (
    <Box flexDirection="column">
      <Text color="text" wrap="truncate-end">
        {' '}
        {BOX_CHARS.topLeft}
        {dashFull}
        {BOX_CHARS.topRight}
      </Text>
      {rows}
      {bottomTag ? (
        <Text wrap="truncate-end">
          <Text color="text">
            {' '}
            {BOX_CHARS.bottomLeft}
            {bottomDash}
          </Text>
          <Text dimColor>{bottomTag}</Text>
          <Text color="text">{BOX_CHARS.bottomRight}</Text>
        </Text>
      ) : (
        <Text color="text" wrap="truncate-end">
          {' '}
          {BOX_CHARS.bottomLeft}
          {dashFull}
          {BOX_CHARS.bottomRight}
        </Text>
      )}
    </Box>
  );
}

function StackedPhasesAgentsView({
  phases,
  selectedPhase,
  clampedPhase,
  clampedAgent,
  level,
  contentWidth,
  phaseViewport,
  agentViewport,
  tight,
  workflowActive,
  filterLabel,
  nowMs,
}: {
  phases: FoldedPhase[];
  selectedPhase: FoldedPhase | undefined;
  clampedPhase: number;
  clampedAgent: number;
  level: DrillLevel;
  contentWidth: number;
  phaseViewport: number;
  agentViewport: number;
  tight: boolean;
  workflowActive: boolean;
  filterLabel: string | undefined;
  nowMs: number;
}): React.ReactNode {
  const phaseWin = computeVisibleWindow(clampedPhase, phases.length, phaseViewport);
  const phasesOverflow = phases.length > phaseViewport;
  const dashFull = BOX_CHARS.horizontal.repeat(contentWidth + 2);

  const agents = selectedPhase?.agents ?? [];
  const agentWin = computeVisibleWindow(clampedAgent, agents.length, agentViewport);
  const countStr = agentCountLabel(agents.length, filterLabel);

  const cardRows: React.ReactNode[] = [];
  if (selectedPhase) {
    if (tight) {
      const suffix = truncateToWidth(` · ${countStr}`, Math.max(1, contentWidth - 1));
      const titleFit = truncateToWidth(selectedPhase.title, Math.max(1, contentWidth - stringWidth(suffix)));
      cardRows.push(
        <FramedSingleRow
          key="title"
          contentWidth={contentWidth}
          segs={[
            { text: titleFit, color: 'permission', bold: true },
            { text: suffix, dimColor: true },
          ]}
        />,
      );
    } else {
      cardRows.push(
        <FramedSingleRow
          key="title"
          contentWidth={contentWidth}
          segs={[{ text: truncateToWidth(selectedPhase.title, contentWidth), color: 'permission', bold: true }]}
        />,
        <FramedSingleRow
          key="count"
          contentWidth={contentWidth}
          segs={[{ text: truncateToWidth(countStr, contentWidth), dimColor: true }]}
        />,
        <FramedSingleRow key="gap" contentWidth={contentWidth} segs={[{ text: '' }]} />,
      );
    }
    const headerCount = cardRows.length;
    if (agents.length === 0) {
      cardRows.push(
        <FramedSingleRow
          key="empty"
          contentWidth={contentWidth}
          segs={[{ text: emptyAgentsLabel(selectedPhase, filterLabel), dimColor: true }]}
        />,
      );
    } else {
      const labelWidth = computeAgentLabelWidth(agents, contentWidth - 5);
      for (let i = agentWin.from; i < agentWin.to; i++) {
        const a = agents[i]!;
        const selected = level === 'agents' && i === clampedAgent;
        const { glyph, color } = statusGlyph(resolveAgentStatus(a, workflowActive));
        const rawLabel = a.label ?? `agent-${a.index}`;
        const labelFit = truncateToWidth(rawLabel, labelWidth);
        const labelPad = ' '.repeat(Math.max(0, labelWidth - stringWidth(labelFit)));
        const statsW = Math.max(0, contentWidth - (labelWidth + 5));
        const isLive = a.state === 'start' || a.state === 'progress';
        cardRows.push(
          <FramedSingleRow
            key={`a-${i}`}
            contentWidth={contentWidth}
            segs={[
              { text: selected ? figures.pointer : ' ', color: 'permission' },
              { text: ' ' },
              { text: glyph, color },
              { text: ' ' },
              {
                text: `${labelFit}${labelPad}`,
                color: selected ? 'permission' : undefined,
                dimColor: !selected && isLive,
              },
              { text: ' ' },
              ...buildAgentStatsSegs(a, statsW, selected, workflowActive, nowMs),
            ]}
          />,
        );
      }
    }
    const bodyCount = cardRows.length - headerCount;
    for (let p = bodyCount; p < agentViewport; p++) {
      cardRows.push(<FramedSingleRow key={`pad-${p}`} contentWidth={contentWidth} segs={[{ text: '' }]} />);
    }
  }

  const agentBottomTag = agents.length > agentViewport ? ` ${formatVisibleWindowHint(agentWin, agents.length)} ` : '';
  const agentBottomDash = BOX_CHARS.horizontal.repeat(Math.max(0, contentWidth + 2 - stringWidth(agentBottomTag)));

  return (
    <>
      {phases.slice(phaseWin.from, phaseWin.to).map((p, idx) => {
        const absIdx = phaseWin.from + idx;
        const selected = absIdx === clampedPhase;
        const isDone = p.status === 'done';
        const isFailed = p.status === 'failed';
        const mark = isDone ? figures.tick : isFailed ? figures.cross : String(absIdx + 1);
        const markColor: keyof Theme = selected ? 'permission' : isDone ? 'success' : isFailed ? 'error' : 'subtle';
        const pointer = selected ? figures.pointer : ' ';
        const frac = p.totalCount > 0 ? `${p.doneCount}/${p.totalCount}` : '';
        const titleFit = truncateToWidth(p.title, Math.max(1, 17 - (stringWidth(pointer) + 1 + stringWidth(mark) + 1)));
        const pad = Math.max(0, 17 - stringWidth(`${pointer} ${mark} ${titleFit}`));
        return (
          <Box key={`${absIdx}-${p.title}`}>
            <Text wrap="truncate-end">
              <Text color={selected ? 'permission' : undefined}>{pointer}</Text> <Text color={markColor}>{mark}</Text>{' '}
              <Text
                color={selected ? 'permission' : isDone ? 'success' : isFailed ? 'error' : undefined}
                dimColor={!selected && !isDone && !isFailed}
              >
                {titleFit}
              </Text>
              {' '.repeat(pad)}
            </Text>
            <Text
              wrap="truncate-end"
              color={selected ? 'permission' : isDone ? 'success' : isFailed ? 'error' : undefined}
              dimColor={!selected && !isDone && !isFailed}
            >
              {frac}
            </Text>
          </Box>
        );
      })}
      {phasesOverflow && (
        <Text dimColor wrap="truncate-end">
          {'  '}
          {formatVisibleWindowHint(phaseWin, phases.length)}
        </Text>
      )}
      <Box flexGrow={1} />
      {selectedPhase ? (
        <Box flexDirection="column">
          <Text color="text" wrap="truncate-end">
            {' '}
            {BOX_CHARS.topLeft}
            {dashFull}
            {BOX_CHARS.topRight}
          </Text>
          {cardRows}
          {agentBottomTag ? (
            <Text wrap="truncate-end">
              <Text color="text">
                {' '}
                {BOX_CHARS.bottomLeft}
                {agentBottomDash}
              </Text>
              <Text dimColor>{agentBottomTag}</Text>
              <Text color="text">{BOX_CHARS.bottomRight}</Text>
            </Text>
          ) : (
            <Text color="text" wrap="truncate-end">
              {' '}
              {BOX_CHARS.bottomLeft}
              {dashFull}
              {BOX_CHARS.bottomRight}
            </Text>
          )}
        </Box>
      ) : null}
    </>
  );
}
