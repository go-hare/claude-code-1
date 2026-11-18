import * as React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Box, Text } from '@anthropic/ink';
import { getSessionId } from '../../bootstrap/state.js';
import { useCommandQueue } from '../../hooks/useCommandQueue.js';
import { logEvent } from '../../services/analytics/index.js';
import {
  isInProcessTeammateTask,
  type InProcessTeammateTaskState,
  type PendingTeammateUserMessage,
} from '../../tasks/InProcessTeammateTask/types.js';
import type { TaskState } from '../../tasks/types.js';
import type { Message as MessageType, NormalizedUserMessage } from '../../types/message.js';
import type { QueuedCommand } from '../../types/textInputTypes.js';
import { asAgentId } from '../../types/ids.js';
import { createUserMessage, EMPTY_LOOKUPS, normalizeMessages } from '../../utils/messages.js';
import { Message } from '../Message.js';

const EMPTY_SET = new Set<string>();
const EMPTY_PENDING: ReadonlyArray<PendingTeammateUserMessage> = [];

/**
 * Official 2.1.309 `CA` (#1132): returns true for human-typed prompt/bash queue
 * items (already shown in the prompt queue preview), false for messages from
 * other agents, sessions, plugins, or channels that should appear under
 * "Waiting to be delivered" in ctrl+o transcript mode.
 */
export function isHumanPromptQueueItem(cmd: QueuedCommand): boolean {
  const isPromptOrBash = cmd.mode === 'prompt' || cmd.mode === 'bash';
  const originKind = cmd.origin?.kind;
  const isHumanOrigin = originKind === undefined || originKind === 'human' || originKind === 'slack-ping';
  return isPromptOrBash && !cmd.isMeta && isHumanOrigin && cmd.verifiedSlackHumanTurn !== true;
}

export function retainWaitingRowsWhileLoading<T>(
  prev: { rows: T[]; transcriptLength: number },
  nextRows: T[],
  transcriptLength: number,
  isLoading: boolean,
): { rows: T[]; transcriptLength: number } {
  const nextSet = new Set(nextRows);
  const merged = [
    ...(isLoading && prev.transcriptLength === transcriptLength ? prev.rows.filter(row => !nextSet.has(row)) : []),
    ...nextRows,
  ];
  if (
    prev.transcriptLength === transcriptLength &&
    merged.length === prev.rows.length &&
    merged.every((row, i) => row === prev.rows[i])
  ) {
    return prev;
  }
  return { rows: merged, transcriptLength };
}

function getMessageDeliveryIds(msg: MessageType): string[] {
  const raw = (msg as { deliveryId?: unknown }).deliveryId;
  if (typeof raw === 'string') return [raw];
  if (Array.isArray(raw)) return raw.filter((id): id is string => typeof id === 'string');
  return [];
}

function queuedCommandToNormalizedUserMessages(
  cmd: QueuedCommand,
  cache: WeakMap<QueuedCommand, NormalizedUserMessage[]>,
): NormalizedUserMessage[] {
  const cached = cache.get(cmd);
  if (cached !== undefined) return cached;
  const content = typeof cmd.value === 'string' ? cmd.value : '';
  const userMsg = createUserMessage({
    content,
    origin: cmd.origin,
    isMeta: cmd.isMeta ? true : undefined,
  });
  const normalized = normalizeMessages([userMsg]).filter((m): m is NormalizedUserMessage => m.type === 'user');
  cache.set(cmd, normalized);
  return normalized;
}

export function selectWaitingTranscriptMessages(input: {
  queuedCommands: readonly QueuedCommand[];
  pendingTaskMessages: ReadonlyArray<PendingTeammateUserMessage>;
  targetAgentId: string;
  transcriptMessages: readonly MessageType[];
  pendingToQueuedCache: WeakMap<PendingTeammateUserMessage, QueuedCommand>;
  normalizedCache: WeakMap<QueuedCommand, NormalizedUserMessage[]>;
}): NormalizedUserMessage[] {
  const {
    queuedCommands,
    pendingTaskMessages,
    targetAgentId,
    transcriptMessages,
    pendingToQueuedCache,
    normalizedCache,
  } = input;
  const fromPending = pendingTaskMessages.map(pm => {
    const existing = pendingToQueuedCache.get(pm);
    if (existing !== undefined) return existing;
    const cmd: QueuedCommand = {
      value: pm.message,
      mode: 'prompt',
      agentId: asAgentId(targetAgentId),
      origin: pm.origin,
    };
    pendingToQueuedCache.set(pm, cmd);
    return cmd;
  });

  const matching = [...queuedCommands, ...fromPending].filter(
    cmd => (cmd.agentId ?? getSessionId()) === targetAgentId && !isHumanPromptQueueItem(cmd),
  );

  const deliveredIds = matching.some(cmd => cmd.deliveryId !== undefined)
    ? new Set(transcriptMessages.flatMap(getMessageDeliveryIds))
    : EMPTY_SET;

  const undelivered = matching.filter(cmd => !(typeof cmd.deliveryId === 'string' && deliveredIds.has(cmd.deliveryId)));

  return undelivered.flatMap(cmd => queuedCommandToNormalizedUserMessages(cmd, normalizedCache));
}

export function WaitingTranscriptMessages({
  task,
  messages,
  isLoading,
}: {
  task: TaskState | undefined;
  messages: readonly MessageType[];
  isLoading: boolean;
}): React.ReactNode {
  const queuedCommands = useCommandQueue();
  const [normalizedCache] = useState(() => new WeakMap<QueuedCommand, NormalizedUserMessage[]>());
  const [pendingToQueuedCache] = useState(() => new WeakMap<PendingTeammateUserMessage, QueuedCommand>());

  const pendingTaskMessages =
    task !== undefined && isInProcessTeammateTask(task) ? task.pendingUserMessages : EMPTY_PENDING;
  const targetAgentId =
    task === undefined ? getSessionId() : isInProcessTeammateTask(task) ? task.identity.agentId : task.id;

  const currentRows = useMemo(
    () =>
      selectWaitingTranscriptMessages({
        queuedCommands,
        pendingTaskMessages,
        targetAgentId,
        transcriptMessages: messages,
        pendingToQueuedCache,
        normalizedCache,
      }),
    [queuedCommands, pendingTaskMessages, targetAgentId, messages, pendingToQueuedCache, normalizedCache],
  );

  const [retained, setRetained] = useState<{ rows: NormalizedUserMessage[]; transcriptLength: number }>({
    rows: currentRows,
    transcriptLength: messages.length,
  });

  const nextRetained = retainWaitingRowsWhileLoading(retained, currentRows, messages.length, isLoading);
  if (nextRetained !== retained) {
    setRetained(nextRetained);
  }

  const hasRows = nextRetained.rows.length > 0;
  useEffect(() => {
    if (hasRows) {
      logEvent('transcript_waiting_messages', {});
    }
  }, [hasRows]);

  if (!hasRows) return null;

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text dimColor>Waiting to be delivered</Text>
      {nextRetained.rows.map((msg, idx) => (
        <Message
          key={msg.uuid}
          message={msg}
          lookups={EMPTY_LOOKUPS}
          addMargin={idx > 0}
          tools={[]}
          commands={[]}
          verbose={true}
          inProgressToolUseIDs={EMPTY_SET}
          progressMessagesForMessage={[]}
          shouldAnimate={false}
          shouldShowDot={false}
          isTranscriptMode={true}
          isStatic={true}
        />
      ))}
    </Box>
  );
}
