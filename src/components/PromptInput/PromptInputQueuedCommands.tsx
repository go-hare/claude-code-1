import * as React from 'react';
import { useMemo } from 'react';
import { Box, formatShortcutString, KeyboardShortcutHint, stringWidth, Text } from '@anthropic/ink';
import { useAppState, useAppStateStore } from 'src/state/AppState.js';
import { isFullscreenEnvEnabled } from '../../utils/fullscreen.js';
import { sendQueuedNow } from '../../utils/foregroundToolCalls.js';
import { FePress } from '../CustomSelect/select.js';
import { STATUS_TAG, SUMMARY_TAG, TASK_NOTIFICATION_TAG } from '../../constants/xml.js';
import { QueuedMessageProvider } from '../../context/QueuedMessageContext.js';
import { useCommandQueue } from '../../hooks/useCommandQueue.js';
import { useIdeConnectionStatus } from '../../hooks/useIdeConnectionStatus.js';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
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
import { isTranscriptV2RowsEnabled } from '../messages/TranscriptV2Row.js';

/** densable `Dx` — Uye / CA prefix (U+29C9 + space). */
export const QUEUED_IDE_SELECTION_PREFIX = '⧉ ';

const LONE_SURROGATE_RE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
const ANSI_ESCAPE_RE =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: densable Y3t ANSI escape stripper
  /\x1b\[[\x30-\x3f]*[\x20-\x2f]*[\x40-\x7e]|\x1b[\]PX^_][^\x1b\x07]*(?:\x07|\x1b\\)/g;
const BIDI_OVERRIDE_RE = /[‪-‮⁦-⁩]/g;
const HIDDEN_CONTROL_RE =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: densable qee C0/C1 control stripper
  /[\x00-\x08\x0E-\x1F\x7F-\x9F]/g;

function stripAnsiIterated(input: string): string {
  let out = input;
  for (let pass = 0; pass < 4; pass++) {
    const next = out.replace(ANSI_ESCAPE_RE, '');
    if (next === out) break;
    out = next;
  }
  return out;
}

function selectionFileBasename(filePath: string): string {
  const slash = filePath.lastIndexOf('/');
  const back = filePath.lastIndexOf('\\');
  const i = slash >= 0 ? slash : back;
  const raw = filePath.slice(i + 1);
  return stripAnsiIterated(raw.replace(LONE_SURROGATE_RE, ''))
    .replace(BIDI_OVERRIDE_RE, '')
    .replace(HIDDEN_CONTROL_RE, '')
    .replace(/\s+/g, ' ')
    .trim();
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

const QUEUED_HINT_PREFIX = '  ⎿  ';

/**
 * Official 2.1.328 `wVe` (@319875771): show the `  ⎿  Queued · ` prefix only
 * when the full line fits within `terminalColumns`; otherwise fall back to
 * `paddingLeft={2}` so the send-now shortcut hint is not clipped.
 */
export function resolveQueuedSendNowLayout(
  sendNowChord: string,
  terminalColumns: number,
  prefix = QUEUED_HINT_PREFIX,
): { hintText: string; showQueuedPrefix: boolean; paddingLeft: number } {
  const hintText =
    sendNowChord === ''
      ? 'click to send now'
      : `${formatShortcutString(sendNowChord, { keyCase: 'lower' })} to send now`;
  const showQueuedPrefix = stringWidth(`${prefix}Queued · ${hintText}`) <= terminalColumns;
  return {
    hintText,
    showQueuedPrefix,
    paddingLeft: showQueuedPrefix ? 0 : 2,
  };
}

export function buildSendNowHintLabel(sendNowChord: string): React.ReactNode {
  return sendNowChord === '' ? (
    'click to send now'
  ) : (
    <KeyboardShortcutHint shortcut={sendNowChord} action="send now" format={{ keyCase: 'lower' }} />
  );
}

/** #135 (2.1.326, official sVe/Gt): minimum visible rows per capped queued message. */
const MIN_QUEUED_PREVIEW_ROWS = 3;

/**
 * #135 (2.1.326): compute max height per queued message in the classic renderer
 * so a long queued prompt cannot fill the terminal, hide Claude's streaming
 * reply, or erase scrollback.
 */
export function computeClassicQueuedMaxRows(terminalRows: number, queuedCount: number): number {
  const budget = Math.max(MIN_QUEUED_PREVIEW_ROWS, Math.floor(terminalRows / 3));
  if (queuedCount <= 1) return budget;
  return Math.max(MIN_QUEUED_PREVIEW_ROWS, Math.floor(budget / queuedCount));
}

function PromptInputQueuedCommandsImpl({
  abortController,
  mcpClients,
  onSendNow,
}: {
  abortController?: AbortController | null;
  mcpClients?: MCPServerConnection[];
  onSendNow?: () => boolean;
}): React.ReactNode {
  const store = useAppStateStore();
  const { rows: terminalRows, columns: terminalColumns } = useTerminalSize();
  const queuedCommands = useCommandQueue();
  const { status: ideStatus } = useIdeConnectionStatus(mcpClients);
  const queueEditIndex = useAppState(s => s.queueEditIndex);
  const viewingAgent = useAppState(s => !!s.viewingAgentTaskId);
  const verbose = useAppState(s => s.verbose);
  // Official 2.1.328 `lKt` (`qx(verbose)`): system-line flag passed via `CTo`.
  const noticeSystemLines = !verbose && isTranscriptV2RowsEnabled();

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
          return createUserMessage({ content, origin: cmd.origin });
        }),
      ),
      processedCommands,
    };
  }, [queuedCommands]);

  const handleSendNowClick = React.useCallback(() => {
    if (onSendNow) {
      return onSendNow();
    }
    return sendQueuedNow(store.getState, store.setState, {
      interruptForSubmit: () => {
        abortController?.abort();
        return true;
      },
    });
  }, [onSendNow, store, abortController]);

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
  const isFullscreen = isFullscreenEnvEnabled();
  const canSendNow = canShowQueueSendNowHint(queuedCommands, abortController);
  // Official 2.1.328 `wVe` (@319875771): prefix with `  ⎿  Queued · ` when it
  // fits in `terminalColumns`, otherwise drop the prefix with `paddingLeft={2}`
  // so the send-now shortcut hint is never clipped on narrow terminals.
  const {
    hintText,
    showQueuedPrefix,
    paddingLeft: sendNowPaddingLeft,
  } = resolveQueuedSendNowLayout(sendNowChord, terminalColumns);
  const sendNowHint =
    canSendNow && (sendNowChord !== '' || isFullscreen) ? (
      <Box flexDirection="row" paddingLeft={sendNowPaddingLeft} height={1} overflow="hidden">
        {showQueuedPrefix && (
          <Text dimColor>
            <Text aria-hidden>{QUEUED_HINT_PREFIX}</Text>
            {'Queued · '}
          </Text>
        )}
        {isFullscreen ? (
          <FePress onPress={handleSendNowClick}>{hintText}</FePress>
        ) : (
          <Text dimColor>{buildSendNowHintLabel(sendNowChord)}</Text>
        )}
      </Box>
    ) : null;

  const classicMaxRows = !isFullscreen
    ? computeClassicQueuedMaxRows(terminalRows, prepared.messages.length)
    : undefined;

  return (
    <Box flexDirection="column">
      {prepared.messages.map((message, i) => {
        const cmd = prepared.processedCommands[i];
        const nextCmd = prepared.processedCommands[i + 1];
        const preview =
          cmd?.ideSelection !== undefined && !shouldHideQueuedIdeSelectionPreview(cmd) && nextCmd !== cmd
            ? formatQueuedIdeSelection(ideStatus, cmd.ideSelection)
            : null;
        // #135 (2.1.326): in classic renderer, cap long queued prompt height so
        // it never hides Claude's streaming reply or erases scrollback.
        const rawText = typeof cmd?.value === 'string' ? cmd.value : '';
        const estCols = Math.max(20, terminalColumns - 4);
        const estLines =
          classicMaxRows !== undefined && cmd?.mode === 'prompt' && rawText.length > 0
            ? rawText.split('\n').reduce((acc, line) => acc + Math.max(1, Math.ceil(line.length / estCols)), 0)
            : 0;
        const hiddenQueuedLines =
          classicMaxRows !== undefined && estLines > classicMaxRows ? estLines - (classicMaxRows - 1) : 0;
        const msgEl = (
          <Message
            message={message}
            lookups={EMPTY_LOOKUPS}
            addMargin={i === 0 || (cmd !== undefined && isQueuedCommandEditable(cmd))}
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
        );
        return (
          <QueuedMessageProvider
            key={i}
            noticeSystemLines={noticeSystemLines}
            selectionHighlight={selecting ? (i === highlightRow ? 'on' : 'off') : undefined}
          >
            {classicMaxRows !== undefined && cmd?.mode === 'prompt' ? (
              <>
                <Box
                  flexDirection="column"
                  maxHeight={hiddenQueuedLines > 0 ? Math.max(1, classicMaxRows - 1) : classicMaxRows}
                  overflowY="hidden"
                >
                  {msgEl}
                </Box>
                {hiddenQueuedLines > 0 ? (
                  <Box paddingLeft={2}>
                    <Text dimColor>
                      … +{hiddenQueuedLines} {hiddenQueuedLines === 1 ? 'line' : 'lines'}
                    </Text>
                  </Box>
                ) : null}
              </>
            ) : (
              msgEl
            )}
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
