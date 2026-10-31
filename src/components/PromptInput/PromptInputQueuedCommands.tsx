import { feature } from 'bun:bundle';
import * as React from 'react';
import { useMemo } from 'react';
import { Box, KeyboardShortcutHint, Text } from '@anthropic/ink';
import { useAppState } from 'src/state/AppState.js';
import { STATUS_TAG, SUMMARY_TAG, TASK_NOTIFICATION_TAG } from '../../constants/xml.js';
import { QueuedMessageProvider } from '../../context/QueuedMessageContext.js';
import { useCommandQueue } from '../../hooks/useCommandQueue.js';
import { useIdeConnectionStatus } from '../../hooks/useIdeConnectionStatus.js';
import { formatSendNowHint } from '../../keybindings/shortcutFormat.js';
import type { MCPServerConnection } from '../../services/mcp/types.js';
import type { QueuedCommand } from '../../types/textInputTypes.js';
import {
  canShowQueueSendNowHint,
  isQueuedCommandEditable,
  isQueuedCommandVisible,
} from '../../utils/messageQueueManager.js';
import { createUserMessage, EMPTY_LOOKUPS, normalizeMessages } from '../../utils/messages.js';
import { jsonParse } from '../../utils/slowOperations.js';
import { Message } from '../Message.js';

/** densable `Dx` — Uye / CA prefix (U+29C9 + space). */
export const QUEUED_IDE_SELECTION_PREFIX = '⧉ ';

function selectionFileBasename(filePath: string): string {
  const slash = filePath.lastIndexOf('/');
  const back = filePath.lastIndexOf('\\');
  const i = slash >= 0 ? slash : back;
  return filePath.slice(i + 1);
}

/**
 * densable `$5` — hide Uye for verified Slack human turns and non-human
 * origins (plugin / peer / channel / …). undefined / human / slack-ping show.
 */
export function shouldHideQueuedIdeSelectionPreview(cmd: QueuedCommand): boolean {
  if (cmd.verifiedSlackHumanTurn === true) return true;
  switch (cmd.origin?.kind) {
    case undefined:
    case 'human':
    case 'slack-ping':
      return false;
    default:
      return true;
  }
}

/**
 * densable `CA` — queue-row ideSelection preview. Diff source paints even
 * when IDE is not connected; file/line selections need status `"connected"`.
 */
export function formatQueuedIdeSelection(
  ideStatus: string | null | undefined,
  selection: QueuedCommand['ideSelection'] | undefined,
): string | null {
  if (!selection) return null;
  const isDiff = selection.source === 'diff';
  if (!isDiff && ideStatus !== 'connected') return null;
  if (selection.text && selection.lineCount > 0) {
    const from =
      isDiff && selection.filePath
        ? `from ${selectionFileBasename(selection.filePath)}`
        : isDiff
          ? 'from diff'
          : 'selected';
    return `${QUEUED_IDE_SELECTION_PREFIX}${selection.lineCount} ${selection.lineCount === 1 ? 'line' : 'lines'} ${from}`;
  }
  if (!isDiff && selection.filePath) {
    return `${QUEUED_IDE_SELECTION_PREFIX}In ${selectionFileBasename(selection.filePath)}`;
  }
  return null;
}

const EMPTY_SET = new Set<string>();

/**
 * Check if a command value is an idle notification that should be hidden.
 * Idle notifications are processed silently without showing to the user.
 */
function isIdleNotification(value: string): boolean {
  try {
    const parsed = jsonParse(value);
    return parsed?.type === 'idle_notification';
  } catch {
    return false;
  }
}

// Maximum number of task notification lines to show
const MAX_VISIBLE_NOTIFICATIONS = 3;

/**
 * Create a synthetic overflow notification message for capped task notifications.
 */
function createOverflowNotificationMessage(count: number): string {
  return `<${TASK_NOTIFICATION_TAG}>
<${SUMMARY_TAG}>+${count} more tasks completed</${SUMMARY_TAG}>
<${STATUS_TAG}>completed</${STATUS_TAG}>
</${TASK_NOTIFICATION_TAG}>`;
}

/**
 * Process queued commands to cap task notifications at MAX_VISIBLE_NOTIFICATIONS lines.
 * Other command types are always shown in full.
 * Idle notifications are filtered out entirely.
 */
function processQueuedCommands(queuedCommands: QueuedCommand[]): QueuedCommand[] {
  // Filter out idle notifications - they are processed silently
  const filteredCommands = queuedCommands.filter(
    cmd => typeof cmd.value !== 'string' || !isIdleNotification(cmd.value),
  );

  // Separate task notifications from other commands
  const taskNotifications = filteredCommands.filter(cmd => cmd.mode === 'task-notification');
  const otherCommands = filteredCommands.filter(cmd => cmd.mode !== 'task-notification');

  // If notifications fit within limit, return all commands as-is
  if (taskNotifications.length <= MAX_VISIBLE_NOTIFICATIONS) {
    return [...otherCommands, ...taskNotifications];
  }

  // Show first (MAX_VISIBLE_NOTIFICATIONS - 1) notifications, then a summary
  const visibleNotifications = taskNotifications.slice(0, MAX_VISIBLE_NOTIFICATIONS - 1);
  const overflowCount = taskNotifications.length - (MAX_VISIBLE_NOTIFICATIONS - 1);

  // Create synthetic overflow message
  const overflowCommand: QueuedCommand = {
    value: createOverflowNotificationMessage(overflowCount),
    mode: 'task-notification',
  };

  return [...otherCommands, ...visibleNotifications, overflowCommand];
}

function PromptInputQueuedCommandsImpl({
  abortController,
  mcpClients,
}: {
  abortController?: AbortController | null;
  mcpClients?: MCPServerConnection[];
}): React.ReactNode {
  const queuedCommands = useCommandQueue();
  const { status: ideStatus } = useIdeConnectionStatus(mcpClients);
  const queueEditIndex = useAppState(s => s.queueEditIndex);
  const viewingAgent = useAppState(s => !!s.viewingAgentTaskId);
  // Brief layout: dim queue items + skip the paddingX (brief messages
  // already indent themselves). Gate mirrors the brief-spinner/message
  // check elsewhere — no teammate-view override needed since this
  // component early-returns when viewing a teammate.
  const isBriefOnlyState = useAppState(s => s.isBriefOnly);
  const useBriefLayout = feature('KAIROS') || feature('KAIROS_BRIEF') ? isBriefOnlyState : false;

  // createUserMessage mints a fresh UUID per call; without memoization, streaming
  // re-renders defeat Message's areMessagePropsEqual (compares uuid) → flicker.
  // densable Vag: keep processedCommands so queueEditIndex (lJ index) maps to
  // the visible row via identity (indexOf), not display-list order.
  const prepared = useMemo(() => {
    if (queuedCommands.length === 0) return null;
    // task-notification is shown via useInboxNotification; most isMeta commands
    // (scheduled tasks, proactive ticks) are system-generated and hidden.
    // Channel messages are the exception — isMeta but shown so the keyboard
    // user sees what arrived.
    // densable Rkb/U4i — never pass as bare filter predicate (index would leak
    // into forcePeer). typeof-guard in U4i is belt; arrow is suspenders.
    const visibleCommands = queuedCommands.filter(cmd => isQueuedCommandVisible(cmd));
    if (visibleCommands.length === 0) return null;
    const processedCommands = processQueuedCommands(visibleCommands);
    return {
      messages: normalizeMessages(
        processedCommands.map(cmd => {
          let content = cmd.value;
          if (cmd.mode === 'bash' && typeof content === 'string') {
            content = `<bash-input>${content}</bash-input>`;
          }
          // [Image #N] placeholders are inline in the text value (inserted at
          // paste time), so the queue preview shows them without stub blocks.
          return createUserMessage({ content });
        }),
      ),
      processedCommands,
    };
  }, [queuedCommands]);

  // Don't show leader's queued commands when viewing any agent's transcript
  if (viewingAgent || prepared === null) {
    return null;
  }

  // densable Vag: YZw=Dln.filter(lJ)[MEc]; yho=processedCommands.indexOf(YZw)
  const selectedCmd =
    queueEditIndex === null ? undefined : queuedCommands.filter(isQueuedCommandEditable)[queueEditIndex];
  const highlightRow = selectedCmd ? prepared.processedCommands.indexOf(selectedCmd) : -1;
  const selecting = highlightRow !== -1;

  const sendNowChord = formatSendNowHint();
  const sendNowHint =
    sendNowChord !== '' && canShowQueueSendNowHint(queuedCommands, abortController) ? (
      <Box paddingLeft={2}>
        <Text dimColor>
          <KeyboardShortcutHint shortcut={sendNowChord} action="send now" format={{ keyCase: 'lower' }} />
        </Text>
      </Box>
    ) : null;

  return (
    <Box marginTop={1} flexDirection="column">
      {prepared.messages.map((message, i) => {
        const cmd = prepared.processedCommands[i];
        const nextCmd = prepared.processedCommands[i + 1];
        const preview =
          cmd?.ideSelection !== undefined && !shouldHideQueuedIdeSelectionPreview(cmd) && nextCmd !== cmd
            ? formatQueuedIdeSelection(ideStatus, cmd.ideSelection)
            : null;
        return (
          <QueuedMessageProvider
            key={i}
            isFirst={i === 0}
            useBriefLayout={useBriefLayout}
            selectionHighlight={selecting ? (i === highlightRow ? 'on' : 'off') : undefined}
          >
            <Message
              message={message}
              lookups={EMPTY_LOOKUPS}
              addMargin={false}
              tools={[]}
              commands={[]}
              verbose={false}
              inProgressToolUseIDs={EMPTY_SET}
              progressMessagesForMessage={[]}
              shouldAnimate={false}
              shouldShowDot={false}
              isTranscriptMode={false}
              isStatic={true}
            />
            {preview !== null ? (
              <Box paddingLeft={2}>
                <Text dimColor wrap="truncate-end">
                  <Text aria-hidden>{QUEUED_IDE_SELECTION_PREFIX}</Text>
                  {preview.slice(QUEUED_IDE_SELECTION_PREFIX.length)}
                </Text>
              </Box>
            ) : null}
          </QueuedMessageProvider>
        );
      })}
      {sendNowHint}
    </Box>
  );
}

export const PromptInputQueuedCommands = React.memo(PromptInputQueuedCommandsImpl);
