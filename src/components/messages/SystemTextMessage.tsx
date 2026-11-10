// biome-ignore-all assist/source/organizeImports: ANT-ONLY import markers must not be reordered
import { Box, Link, Text, type TextProps } from '@anthropic/ink';
import { FilePathLink } from '../FilePathLink.js';
import { feature } from 'bun:bundle';
import * as React from 'react';
import { useState } from 'react';
import { BLACK_CIRCLE, REFERENCE_MARK, TEARDROP_ASTERISK } from '../../constants/figures.js';
import figures from 'figures';
import { basename } from 'path';
import { MessageResponse } from '../MessageResponse.js';

import { openPath } from '../../utils/browser.js';
/* eslint-disable @typescript-eslint/no-require-imports */
const teamMemSaved = feature('TEAMMEM') ? (require('./teamMemSaved.js') as typeof import('./teamMemSaved.js')) : null;
/* eslint-enable @typescript-eslint/no-require-imports */
import { turnCompletionVerbFromUuid } from '../../constants/turnCompletionVerbs.js';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import { isMainThreadQueuedCommand } from '../../bootstrap/state.js';
import { isTerminalTaskStatus } from '../../Task.js';
import type {
  SystemMessage,
  SystemStopHookSummaryMessage,
  SystemBridgeStatusMessage,
  SystemTurnDurationMessage,
  SystemThinkingMessage,
  SystemMemorySavedMessage,
} from '../../types/message.js';
import type { QueuedCommand } from '../../types/textInputTypes.js';
import { formatDuration, formatNumber } from '../../utils/format.js';
import { getCommandQueue } from '../../utils/messageQueueManager.js';
import { formatTurnDoneAt } from '../../utils/timeFormat.js';
import { getGlobalConfig } from '../../utils/config.js';
import { useAppStateMaybeOutsideOfProvider } from '../../state/AppState.js';
import { getPillLabel } from '../../tasks/pillLabel.js';
import { isBackgroundTask, type TaskState } from '../../tasks/types.js';
import { CtrlOToExpand } from '../CtrlOToExpand.js';
import { useSelectedMessageBg } from '../messageActions.js';

/**
 * densable 2.1.289 xCe (@207711830): count local_agent with isBackgrounded
 * that are running or isTerminal && !notified, local_workflow that are
 * running or isTerminal && !notified, plus queued task-notification items.
 */
export function countPendingTurnDurationWork({
  tasks,
  queuedCommands = [],
}: {
  tasks: Record<string, TaskState>;
  queuedCommands?: readonly QueuedCommand[];
}): {
  pendingAgents: number;
  pendingWorkflows: number;
} {
  const pendingAgents = new Set<string>();
  const pendingWorkflows = new Set<string>();
  const addTask = (task: TaskState): void => {
    if (task.type === 'local_agent' && task.isBackgrounded) {
      pendingAgents.add(task.id);
    } else if (task.type === 'local_workflow') {
      pendingWorkflows.add(task.id);
    }
  };
  for (const task of Object.values(tasks)) {
    if (task.status === 'running' || (isTerminalTaskStatus(task.status) && !task.notified)) {
      addTask(task);
    }
  }
  for (const cmd of queuedCommands) {
    if (cmd.mode !== 'task-notification' || !isMainThreadQueuedCommand(cmd) || cmd.taskId === undefined) {
      continue;
    }
    const task = tasks[cmd.taskId];
    if (task) {
      addTask(task);
    }
  }
  return {
    pendingAgents: pendingAgents.size,
    pendingWorkflows: pendingWorkflows.size,
  };
}

/**
 * densable 2.1.289 Umr (@207712030): resolve turn_duration fields and
 * backgroundWaitStartTime across background agent/workflow waits.
 */
export function resolveTurnDurationWithBackgroundWait({
  tasks,
  queuedCommands = [],
  turnDurationMs,
  turnStartTime,
  now,
  backgroundWaitStartTime,
}: {
  tasks: Record<string, TaskState>;
  queuedCommands?: readonly QueuedCommand[];
  turnDurationMs: number;
  turnStartTime: number;
  now: number;
  backgroundWaitStartTime: number | null;
}): {
  durationMs: number;
  pendingBackgroundAgentCount: number | undefined;
  pendingWorkflowCount: number | undefined;
  backgroundWaitStartTime: number | null;
} {
  const { pendingAgents, pendingWorkflows } = countPendingTurnDurationWork({
    tasks,
    queuedCommands,
  });
  if (pendingAgents > 0 || pendingWorkflows > 0) {
    return {
      durationMs: turnDurationMs,
      pendingBackgroundAgentCount: pendingAgents > 0 ? pendingAgents : undefined,
      pendingWorkflowCount: pendingWorkflows > 0 ? pendingWorkflows : undefined,
      backgroundWaitStartTime: backgroundWaitStartTime ?? turnStartTime,
    };
  }
  return {
    durationMs: backgroundWaitStartTime !== null ? now - backgroundWaitStartTime : turnDurationMs,
    pendingBackgroundAgentCount: undefined,
    pendingWorkflowCount: undefined,
    backgroundWaitStartTime: null,
  };
}

type Props = {
  message: SystemMessage;
  addMargin: boolean;
  verbose: boolean;
  isTranscriptMode?: boolean;
};

export function SystemTextMessage({ message, addMargin, verbose, isTranscriptMode }: Props): React.ReactNode {
  const bg = useSelectedMessageBg();
  const maxProseWidth = useAppStateMaybeOutsideOfProvider(s => s.settings.maxProseWidth);
  // Turn duration messages are always shown in grey
  if (message.subtype === 'turn_duration') {
    return <TurnDurationMessage message={message} addMargin={addMargin} />;
  }

  if (message.subtype === 'memory_saved') {
    // densable Pg: file rows only when verbose || transcript (h||!!M).
    return <MemorySavedMessage message={message} addMargin={addMargin} verbose={verbose || !!isTranscriptMode} />;
  }

  if (message.subtype === 'away_summary') {
    return (
      <Box flexDirection="row" marginTop={addMargin ? 1 : 0} backgroundColor={bg} width="100%">
        <Box minWidth={2}>
          <Text dimColor aria-hidden>
            {REFERENCE_MARK}
          </Text>
        </Box>
        <Box maxWidth={maxProseWidth}>
          <Text>
            <Text dimColor bold>
              recap:{' '}
            </Text>
            <Text dimColor italic>
              {String(message.content ?? '')}
            </Text>
          </Text>
        </Box>
      </Box>
    );
  }

  // Agents killed confirmation
  if (message.subtype === 'agents_killed') {
    return (
      <Box flexDirection="row" marginTop={addMargin ? 1 : 0} backgroundColor={bg} width="100%">
        <Box minWidth={2}>
          <Text aria-hidden color="error">
            {BLACK_CIRCLE}
          </Text>
        </Box>
        <Text dimColor>All background agents stopped</Text>
      </Box>
    );
  }

  // Thinking messages are subtle, like turn duration (ant-only)
  if (message.subtype === 'thinking') {
    if (process.env.USER_TYPE === 'ant') {
      return <ThinkingMessage message={message} addMargin={addMargin} />;
    }
    return null;
  }

  const subtype = message.subtype as string;
  if (subtype === 'model_refusal_no_fallback') {
    return null;
  }

  if (subtype === 'model_refusal_fallback') {
    const scope = (message as { scope?: string }).scope;
    return (
      <Box flexDirection="column" marginTop={addMargin ? 1 : 0} backgroundColor={bg} width="100%">
        <Box flexDirection="row" width="100%">
          <Box minWidth={2}>
            <Text aria-label="warning:" color="warning">
              {BLACK_CIRCLE}
            </Text>
          </Box>
          <Text color="warning" bold wrap="wrap">
            {String(message.content ?? '')}
          </Text>
        </Box>
        {scope !== 'local' && (
          <Text dimColor>
            <Text aria-hidden>{'  ⎿  '}</Text>
            Tip: You can configure model switch behavior in /config
          </Text>
        )}
      </Box>
    );
  }

  if (subtype === 'model_fallback') {
    const trigger = (message as { trigger?: string }).trigger;
    const isBold = trigger === 'model_not_found' || trigger === 'permission_denied';
    return (
      <Box flexDirection="row" marginTop={addMargin ? 1 : 0} backgroundColor={bg} width="100%">
        <Box minWidth={2}>
          <Text aria-label="warning:" color="warning">
            {BLACK_CIRCLE}
          </Text>
        </Box>
        <Text color="warning" bold={isBold} wrap="wrap">
          {String(message.content ?? '')}
        </Text>
      </Box>
    );
  }

  if (message.subtype === 'bridge_status') {
    return <BridgeStatusMessage message={message} addMargin={addMargin} />;
  }

  if (message.subtype === 'scheduled_task_fire') {
    return (
      <Box marginTop={addMargin ? 1 : 0} backgroundColor={bg} width="100%">
        <Text dimColor>
          <Text aria-hidden>{TEARDROP_ASTERISK} </Text>
          {String(message.content ?? '')}
        </Text>
      </Box>
    );
  }

  if (message.subtype === 'permission_retry') {
    const commands = (message.commands ?? []) as string[];
    const content = String(message.content ?? '');
    if (commands.length === 0 && !content) {
      return null;
    }
    return (
      <Box marginTop={addMargin ? 1 : 0} backgroundColor={bg} width="100%">
        <Text aria-hidden dimColor>
          {TEARDROP_ASTERISK}{' '}
        </Text>
        {commands.length > 0 ? (
          <>
            <Text>Allowed </Text>
            <Text bold>{commands.join(', ')}</Text>
          </>
        ) : (
          <Text>{content}</Text>
        )}
      </Box>
    );
  }

  // Stop hook summaries should always be visible
  const isStopHookSummary = message.subtype === 'stop_hook_summary';

  if (!isStopHookSummary && !verbose && message.level === 'info') {
    return null;
  }

  if (message.subtype === 'api_error') {
    return null;
  }

  if (message.subtype === 'stop_hook_summary') {
    return (
      <StopHookSummaryMessage
        message={message as SystemStopHookSummaryMessage}
        addMargin={addMargin}
        verbose={verbose}
        isTranscriptMode={isTranscriptMode}
      />
    );
  }

  const content = message.content;
  // In case the event doesn't have a content
  // validation, so content can be undefined at runtime despite the types.
  if (typeof content !== 'string') {
    return null;
  }
  const level = message.level as string;
  return (
    <Box flexDirection="row" width="100%">
      <SystemTextMessageInner
        content={content}
        addMargin={addMargin}
        dot={level !== 'info'}
        color={level === 'warning' ? 'warning' : level === 'notice' ? 'inactive' : undefined}
        dimColor={level === 'info'}
      />
    </Box>
  );
}

function StopHookSummaryMessage({
  message,
  addMargin,
  verbose,
  isTranscriptMode,
}: {
  message: SystemStopHookSummaryMessage;
  addMargin: boolean;
  verbose: boolean;
  isTranscriptMode?: boolean;
}): React.ReactNode {
  const bg = useSelectedMessageBg();
  const { hookCount, hookInfos } = message;
  const hookErrors = (message.hookErrors ?? []) as string[];
  const hookAdditionalContext = (message as { hookAdditionalContext?: string[] }).hookAdditionalContext ?? [];
  const preventedContinuation = message.preventedContinuation as boolean | undefined;
  const stopReason = message.stopReason as string | undefined;
  const { columns } = useTerminalSize();

  // Only show summary if there are errors, additional context, continuation was prevented, or a hookLabel is present
  if (hookErrors.length === 0 && hookAdditionalContext.length === 0 && !preventedContinuation && !message.hookLabel) {
    return null;
  }

  // Non-stop hooks (e.g. PreToolUse) render as a child line without bullet
  if (message.hookLabel) {
    return (
      <Box flexDirection="column" width="100%">
        <Text dimColor>
          <Text aria-hidden>{'  ⎿  '}</Text>Ran {hookCount} {message.hookLabel} {hookCount === 1 ? 'hook' : 'hooks'}
        </Text>
        {isTranscriptMode &&
          hookInfos.map((info, idx) => (
            <Text key={`cmd-${idx}`} dimColor>
              <Text aria-hidden>{'     ⎿ '}</Text>
              {info.command === 'prompt' ? `prompt: ${info.promptText || ''}` : info.command}
            </Text>
          ))}
      </Box>
    );
  }

  return (
    <Box flexDirection="row" marginTop={addMargin ? 1 : 0} backgroundColor={bg} width="100%">
      <Box minWidth={2}>
        <Text aria-hidden>{BLACK_CIRCLE}</Text>
      </Box>
      <Box flexDirection="column" width={columns - 10}>
        <Text>
          Ran <Text bold>{hookCount}</Text> {message.hookLabel ?? 'stop'} {hookCount === 1 ? 'hook' : 'hooks'}
          {!verbose && hookInfos.length > 0 && (
            <>
              {' '}
              <CtrlOToExpand />
            </>
          )}
        </Text>
        {verbose &&
          hookInfos.length > 0 &&
          hookInfos.map((info, idx) => (
            <Text key={`cmd-${idx}`} dimColor>
              <Text aria-hidden>⎿ &nbsp;</Text>
              {info.command === 'prompt' ? `prompt: ${info.promptText || ''}` : info.command}
            </Text>
          ))}
        {preventedContinuation && stopReason && (
          <Text>
            <Text aria-hidden dimColor>
              ⎿ &nbsp;
            </Text>
            {stopReason}
          </Text>
        )}
        {hookErrors.length > 0 &&
          hookErrors.map((err, idx) => (
            <Text key={idx}>
              <Text aria-hidden dimColor>
                ⎿ &nbsp;
              </Text>
              {message.hookLabel ?? 'Stop'} hook error: {err}
            </Text>
          ))}
        {hookAdditionalContext.length > 0 &&
          hookAdditionalContext.map((ctx, idx) => (
            <Text key={`ctx-${idx}`}>
              <Text aria-hidden dimColor>
                ⎿ &nbsp;
              </Text>
              Stop hook feedback: {ctx}
            </Text>
          ))}
      </Box>
    </Box>
  );
}

function SystemTextMessageInner({
  content,
  addMargin,
  dot,
  color,
  dimColor,
}: {
  content: string;
  addMargin: boolean;
  dot: boolean;
  color?: TextProps['color'];
  dimColor?: boolean;
}): React.ReactNode {
  const { columns } = useTerminalSize();
  const bg = useSelectedMessageBg();

  return (
    <Box flexDirection="row" marginTop={addMargin ? 1 : 0} backgroundColor={bg} width="100%">
      {dot && (
        <Box minWidth={2}>
          <Text aria-hidden color={color} dimColor={dimColor}>
            {BLACK_CIRCLE}
          </Text>
        </Box>
      )}
      <Box flexDirection="column" width={columns - 10}>
        <Text color={color} dimColor={dimColor} wrap="wrap">
          {content.trim()}
        </Text>
      </Box>
    </Box>
  );
}

function TurnDurationMessage({
  message,
  addMargin,
}: {
  message: SystemTurnDurationMessage;
  addMargin: boolean;
}): React.ReactNode {
  const bg = useSelectedMessageBg();
  // densable ig(uuid): hash-stable verb; remount must not reshuffle history.
  const uuid = typeof message.uuid === 'string' ? message.uuid : '';
  const verb = turnCompletionVerbFromUuid(uuid);
  const liveTasks = useAppStateMaybeOutsideOfProvider(s => s.tasks);
  // densable 2.1.289 vg (@207720380): check live pending status on mount via useState initializer.
  const [mountSnapshot] = useState(() => {
    const live = countPendingTurnDurationWork({
      tasks: liveTasks ?? {},
      queuedCommands: getCommandQueue(),
    });
    const rawTimestamp = message.timestamp;
    const timestampDate =
      typeof rawTimestamp === 'string' || typeof rawTimestamp === 'number'
        ? new Date(rawTimestamp)
        : rawTimestamp instanceof Date
          ? rawTimestamp
          : undefined;
    return {
      hasPendingAgents: liveTasks === null ? true : live.pendingAgents > 0,
      hasPendingWorkflows: liveTasks === null ? true : live.pendingWorkflows > 0,
      showTurnDuration: getGlobalConfig().showTurnDuration ?? true,
      doneAt:
        timestampDate !== undefined && !Number.isNaN(timestampDate.getTime()) ? formatTurnDoneAt(timestampDate) : '',
    };
  });
  const { hasPendingAgents, hasPendingWorkflows, showTurnDuration, doneAt } = mountSnapshot;
  const pending = message as unknown as { pendingBackgroundAgentCount?: unknown; pendingWorkflowCount?: unknown };
  const pendingAgents =
    hasPendingAgents && typeof pending.pendingBackgroundAgentCount === 'number'
      ? pending.pendingBackgroundAgentCount
      : 0;
  const pendingWorkflows =
    hasPendingWorkflows && typeof pending.pendingWorkflowCount === 'number' ? pending.pendingWorkflowCount : 0;
  const waitingForBg = pendingAgents > 0 || pendingWorkflows > 0;

  const duration = formatDuration(message.durationMs as number);
  const hasBudget = message.budgetLimit !== undefined;
  const budgetSuffix = (() => {
    if (!hasBudget) return '';
    const tokens = message.budgetTokens as number;
    const limit = message.budgetLimit as number;
    const usage =
      tokens >= limit
        ? `${formatNumber(tokens)} used (${formatNumber(limit)} min ${figures.tick})`
        : `${formatNumber(tokens)} / ${formatNumber(limit)} (${Math.round((tokens / limit) * 100)}%)`;
    const nudges =
      (message.budgetNudges as number) > 0
        ? ` \u00B7 ${message.budgetNudges as number} ${(message.budgetNudges as number) === 1 ? 'nudge' : 'nudges'}`
        : '';
    return `${showTurnDuration ? ' \u00B7 ' : ''}${usage}${nudges}`;
  })();

  // densable ySu stamps briefHiddenCount on turn_duration when focus view
  // collapses chrome — "N messages hidden (/focus to show)".
  const briefHiddenRaw = (message as unknown as { briefHiddenCount?: unknown }).briefHiddenCount;
  const briefHidden = typeof briefHiddenRaw === 'number' && Number.isFinite(briefHiddenRaw) ? briefHiddenRaw : 0;
  const briefHiddenSuffix =
    briefHidden > 0
      ? `${showTurnDuration || hasBudget ? ' \u00B7 ' : ''}${briefHidden} ${
          briefHidden === 1 ? 'message' : 'messages'
        } hidden (/focus to show)`
      : '';

  const pillLabel =
    useAppStateMaybeOutsideOfProvider(s => {
      const running = Object.values(s.tasks).filter(isBackgroundTask);
      return running.length > 0 ? getPillLabel(running) : null;
    }) ?? null;

  const hasCrunched = Boolean(showTurnDuration || hasBudget || briefHiddenSuffix);
  if (!hasCrunched) {
    return null;
  }

  const suppressRunningPill = Boolean(showTurnDuration && waitingForBg);
  return (
    <Box flexDirection="column" width="100%">
      <Box flexDirection="row" marginTop={addMargin ? 1 : 0} backgroundColor={bg} width="100%">
        <Box minWidth={2}>
          <Text aria-hidden dimColor>
            {TEARDROP_ASTERISK}
          </Text>
        </Box>
        <Text>
          {showTurnDuration &&
            (waitingForBg ? (
              <Text dimColor>
                Waiting for
                {pendingAgents > 0 && (
                  <>
                    {' '}
                    <Text bold dimColor>
                      {pendingAgents}
                    </Text>
                    {` background ${pendingAgents === 1 ? 'agent' : 'agents'}`}
                  </>
                )}
                {pendingAgents > 0 && pendingWorkflows > 0 && ' and'}
                {pendingWorkflows > 0 && (
                  <>
                    {' '}
                    <Text bold dimColor>
                      {pendingWorkflows}
                    </Text>
                    {` ${pendingWorkflows === 1 ? 'dynamic workflow' : 'dynamic workflows'}`}
                  </>
                )}{' '}
                to finish
              </Text>
            ) : (
              <Text dimColor>
                {showTurnDuration && `${verb} for ${duration}${doneAt ? ` \u00B7 done ${doneAt}` : ''}`}
              </Text>
            ))}
          {budgetSuffix && <Text dimColor>{budgetSuffix}</Text>}
          {briefHiddenSuffix && <Text dimColor>{briefHiddenSuffix}</Text>}
          {!suppressRunningPill && pillLabel && (
            <Text dimColor>{[' · ', pillLabel, ' still', ' running'].join('')}</Text>
          )}
        </Text>
      </Box>
    </Box>
  );
}

function MemorySavedMessage({
  message,
  addMargin,
  verbose,
}: {
  message: SystemMemorySavedMessage;
  addMargin: boolean;
  verbose: boolean;
}): React.ReactNode {
  const bg = useSelectedMessageBg();
  const writtenPaths = (message.writtenPaths ?? []) as string[];
  const team = feature('TEAMMEM') ? teamMemSaved!.teamMemSavedPart(message) : null;
  const privateCount = writtenPaths.length - (team?.count ?? 0);
  const parts = [
    privateCount > 0 ? `${privateCount} ${privateCount === 1 ? 'memory' : 'memories'}` : null,
    team?.segment as React.ReactNode,
  ].filter(Boolean);
  return (
    <Box flexDirection="column" marginTop={addMargin ? 1 : 0} backgroundColor={bg}>
      <Box flexDirection="row">
        <Box minWidth={2}>
          <Text dimColor aria-hidden>
            {BLACK_CIRCLE}
          </Text>
        </Box>
        <Text>
          {(message.verb as string) ?? 'Saved'} {parts.join(' \u00B7 ')}
        </Text>
      </Box>
      {verbose ? writtenPaths.map(p => <MemoryFileRow key={p} path={p} />) : null}
    </Box>
  );
}

function MemoryFileRow({ path }: { path: string }): React.ReactNode {
  const [hover, setHover] = useState(false);
  return (
    <MessageResponse>
      <Box onClick={() => void openPath(path)} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
        <Text dimColor={!hover} underline={hover}>
          <FilePathLink filePath={path}>{basename(path)}</FilePathLink>
        </Text>
      </Box>
    </MessageResponse>
  );
}

function ThinkingMessage({
  message,
  addMargin,
}: {
  message: SystemThinkingMessage;
  addMargin: boolean;
}): React.ReactNode {
  const bg = useSelectedMessageBg();
  return (
    <Box flexDirection="row" marginTop={addMargin ? 1 : 0} backgroundColor={bg} width="100%">
      <Box minWidth={2}>
        <Text dimColor>{TEARDROP_ASTERISK}</Text>
      </Box>
      <Text dimColor>{String(message.content ?? '')}</Text>
    </Box>
  );
}

function BridgeStatusMessage({
  message,
  addMargin,
}: {
  message: SystemBridgeStatusMessage;
  addMargin: boolean;
}): React.ReactNode {
  const bg = useSelectedMessageBg();
  const url = message.url as string;
  const isActive =
    useAppStateMaybeOutsideOfProvider(
      s => s.replBridgeConnected && !s.replBridgeOutboundOnly && s.replBridgeSessionUrl === url,
    ) ?? false;
  if (!isActive) {
    return null;
  }
  const upgradeNudge = message.upgradeNudge as string | undefined;
  return (
    <Box flexDirection="row" marginTop={addMargin ? 1 : 0} backgroundColor={bg} width={999}>
      <Box minWidth={2} />
      <Box flexDirection="column">
        <Text>
          /remote-control is active
          <Text dimColor>
            {' · Continue here, on your phone, or at '}
            <Link url={url}>{url}</Link>
          </Text>
        </Text>
        {upgradeNudge && (
          <Box flexDirection="row">
            <Text aria-hidden dimColor>
              {'⎿  '}
            </Text>
            <Text dimColor>{upgradeNudge}</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}
