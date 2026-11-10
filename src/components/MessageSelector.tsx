import type { ContentBlockParam, TextBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';
import { randomUUID, type UUID } from 'crypto';
import figures from 'figures';
import * as React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js';
import { useAppState } from 'src/state/AppState.js';
import {
  type DiffStats,
  fileHistoryCanRestore,
  fileHistoryEnabled,
  fileHistoryGetDiffStats,
  formatRewindSkippedLinksMessage,
} from 'src/utils/fileHistory.js';
import { logError } from 'src/utils/log.js';
import {
  Box,
  Byline,
  type ClickEvent,
  Dialog,
  KeyboardShortcutHint,
  ListItem,
  Text,
  useIsInsideModal,
  useModalOrTerminalSize,
  type WheelEvent,
} from '@anthropic/ink';
import { useKeybindings } from '../keybindings/useKeybinding.js';
import type { Message, PartialCompactDirection, UserMessage } from '../types/message.js';
import { stripDisplayTags } from '../utils/displayTags.js';
import { isFullscreenEnvEnabled } from '../utils/fullscreen.js';
import {
  createUserMessage,
  extractTag,
  isEmptyMessageText,
  isSyntheticMessage,
  isToolUseResultMessage,
} from '../utils/messages.js';
import { FePress, type OptionWithDescription, Select } from './CustomSelect/select.js';
import { Spinner } from './Spinner.js';

function isTextBlock(block: ContentBlockParam): block is TextBlockParam {
  return block.type === 'text';
}

import * as path from 'path';
import { useTerminalSize } from 'src/hooks/useTerminalSize.js';
import type { FileEditOutput } from '@claude-code/builtin-tools/tools/FileEditTool/types.js';
import type { Output as FileWriteToolOutput } from '@claude-code/builtin-tools/tools/FileWriteTool/FileWriteTool.js';
import {
  BASH_STDERR_TAG,
  BASH_STDOUT_TAG,
  COMMAND_MESSAGE_TAG,
  LOCAL_COMMAND_STDERR_TAG,
  LOCAL_COMMAND_STDOUT_TAG,
  TASK_NOTIFICATION_TAG,
  TEAMMATE_MESSAGE_TAG,
  TICK_TAG,
} from '../constants/xml.js';
import { count } from '../utils/array.js';
import { formatRelativeTimeAgo, truncate } from '../utils/format.js';
import type { Theme } from '../utils/theme.js';
type RestoreOption = 'both' | 'conversation' | 'code' | 'summarize' | 'summarize_up_to' | 'nevermind';

function isSummarizeOption(option: RestoreOption | null): option is 'summarize' | 'summarize_up_to' {
  return option === 'summarize' || option === 'summarize_up_to';
}

type Props = {
  messages: Message[];
  onPreRestore: () => void;
  onRestoreMessage: (message: UserMessage) => Promise<void>;
  /**
   * densable: may return `{ skippedLinks }` so partial link-safety skips
   * surface TYn copy without treating the restore as a hard failure.
   */
  onRestoreCode: (message: UserMessage) => Promise<{ skippedLinks?: number } | undefined>;
  onSummarize?: (message: UserMessage, feedback?: string, direction?: PartialCompactDirection) => Promise<void>;
  onClose: () => void;
  /** Skip pick-list, land on confirm. Caller ran skip-check first. Esc closes fully (no back-to-list). */
  preselectedMessage?: UserMessage;
  onResumePreviousSession?: () => void;
  parentSessionId?: string;
  confirmDescription?: string;
};

export function MessageSelector({
  messages,
  onPreRestore,
  onRestoreMessage,
  onRestoreCode,
  onSummarize,
  onClose,
  preselectedMessage,
  onResumePreviousSession,
  parentSessionId,
  confirmDescription,
}: Props): React.ReactNode {
  const fileHistory = useAppState(s => s.fileHistory);
  const [error, setError] = useState<string | undefined>(undefined);
  const isFileHistoryEnabled = fileHistoryEnabled();
  const terminalSize = useTerminalSize();
  const insideModal = useIsInsideModal();
  const { rows: modalOrTermRows } = useModalOrTerminalSize(terminalSize);
  const availableRows = insideModal
    ? modalOrTermRows
    : isFullscreenEnvEnabled()
      ? Math.floor(terminalSize.rows / 2)
      : terminalSize.rows;
  const itemRows = isFileHistoryEnabled ? 3 : 2;
  const visibleMessages = Math.max(2, Math.floor((availableRows - 12) / itemRows));

  // Add current prompt (and optional pre-clear session entry) as virtual messages
  const currentUUID = useMemo(randomUUID, []);
  const preClearUUID = useMemo(randomUUID, []);
  const hasPreviousSession = !!onResumePreviousSession;
  const messageOptions = useMemo(
    () => [
      ...(hasPreviousSession
        ? [
            {
              ...createUserMessage({ content: '' }),
              uuid: preClearUUID,
            } as UserMessage,
          ]
        : []),
      ...messages.filter(selectableUserMessagesFilter),
      {
        ...createUserMessage({
          content: '',
        }),
        uuid: currentUUID,
      } as UserMessage,
    ],
    [messages, currentUUID, preClearUUID, hasPreviousSession],
  );
  const [selectedIndex, setSelectedIndex] = useState(messageOptions.length - 1);
  const maxWindowStart = Math.max(0, messageOptions.length - visibleMessages);
  const [windowStart, setWindowStart] = useState(() => Math.max(0, messageOptions.length - visibleMessages));
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const firstVisibleIndex = Math.min(windowStart, maxWindowStart);

  const hasMessagesToSelect = messageOptions.length > 1;

  const [messageToRestore, setMessageToRestore] = useState<UserMessage | undefined>(preselectedMessage);
  const [confirmOpenedAt, setConfirmOpenedAt] = useState(() => new Date());
  const [diffStatsForRestore, setDiffStatsForRestore] = useState<DiffStats | undefined>(undefined);

  useEffect(() => {
    if (!preselectedMessage || !isFileHistoryEnabled) return;
    let cancelled = false;
    void fileHistoryGetDiffStats(fileHistory, preselectedMessage.uuid).then(stats => {
      if (!cancelled) setDiffStatsForRestore(stats);
    });
    return () => {
      cancelled = true;
    };
  }, [preselectedMessage, isFileHistoryEnabled, fileHistory]);

  const [isRestoring, setIsRestoring] = useState(false);
  const [restoringOption, setRestoringOption] = useState<RestoreOption | null>(null);
  const [selectedRestoreOption, setSelectedRestoreOption] = useState<RestoreOption>('both');
  // Per-option feedback state; Select's internal inputValues Map persists
  // per-option text independently, so sharing one variable would desync.
  const [summarizeFromFeedback, setSummarizeFromFeedback] = useState('');
  const [summarizeUpToFeedback, setSummarizeUpToFeedback] = useState('');

  // Generate options with summarize as input type for inline context
  function getRestoreOptions(canRestoreCode: boolean): OptionWithDescription<RestoreOption>[] {
    const baseOptions: OptionWithDescription<RestoreOption>[] = canRestoreCode
      ? [
          { value: 'both', label: 'Restore code and conversation' },
          { value: 'conversation', label: 'Restore conversation' },
          { value: 'code', label: 'Restore code' },
        ]
      : [{ value: 'conversation', label: 'Restore conversation' }];

    const summarizeInputProps = {
      type: 'input' as const,
      placeholder: 'add context (optional)',
      initialValue: '',
      allowEmptySubmitToCancel: true,
      screenReaderEmptySubmit: true,
      showLabelWithValue: true,
      labelValueSeparator: ': ',
    };
    if (onSummarize) {
      baseOptions.push({
        value: 'summarize',
        label: 'Summarize from here',
        ...summarizeInputProps,
        onChange: setSummarizeFromFeedback,
      });
      baseOptions.push({
        value: 'summarize_up_to',
        label: 'Summarize up to here',
        ...summarizeInputProps,
        onChange: setSummarizeUpToFeedback,
      });
    }

    baseOptions.push({ value: 'nevermind', label: 'Never mind' });
    return baseOptions;
  }

  // Log when selector is opened
  useEffect(() => {
    logEvent('tengu_message_selector_opened', {});
  }, []);

  // Helper to restore conversation without confirmation
  async function restoreConversationDirectly(message: UserMessage) {
    onPreRestore();
    setIsRestoring(true);
    try {
      await onRestoreMessage(message);
      setIsRestoring(false);
      onClose();
    } catch (error) {
      logError(error as Error);
      setIsRestoring(false);
      setError(`Failed to restore the conversation:\n${error}`);
    }
  }

  async function handleSelect(message: UserMessage) {
    if (message.uuid === preClearUUID) {
      onPreRestore();
      onClose();
      onResumePreviousSession?.();
      return;
    }

    const index = messages.indexOf(message);
    const indexFromEnd = messages.length - 1 - index;

    logEvent('tengu_message_selector_selected', {
      index_from_end: indexFromEnd,
      message_type: message.type as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      is_current_prompt: false,
    });

    // Do nothing if the message is not found
    if (!messages.includes(message)) {
      onClose();
      return;
    }

    if (!isFileHistoryEnabled) {
      if (confirmDescription === undefined) {
        await restoreConversationDirectly(message);
        return;
      }
      setConfirmOpenedAt(new Date());
      setMessageToRestore(message);
      return;
    }

    const diffStats = await fileHistoryGetDiffStats(fileHistory, message.uuid);
    setConfirmOpenedAt(new Date());
    setMessageToRestore(message);
    setDiffStatsForRestore(diffStats);
  }

  async function onSelectRestoreOption(option: RestoreOption) {
    logEvent('tengu_message_selector_restore_option_selected', {
      option: option as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    });
    if (!messageToRestore) {
      setError('Message not found.');
      return;
    }
    if (option === 'nevermind') {
      if (preselectedMessage) onClose();
      else setMessageToRestore(undefined);
      return;
    }

    if (isSummarizeOption(option) && onSummarize) {
      onPreRestore();
      setIsRestoring(true);
      setRestoringOption(option);
      setError(undefined);
      try {
        const direction = option === 'summarize_up_to' ? 'up_to' : 'from';
        const feedback = (direction === 'up_to' ? summarizeUpToFeedback : summarizeFromFeedback).trim() || undefined;
        await onSummarize(messageToRestore, feedback, direction);
        setIsRestoring(false);
        setRestoringOption(null);
        setMessageToRestore(undefined);
        onClose();
      } catch (error) {
        logError(error as Error);
        setIsRestoring(false);
        setRestoringOption(null);
        setMessageToRestore(undefined);
        setError(`Failed to summarize:\n${error}`);
      }
      return;
    }

    onPreRestore();
    setIsRestoring(true);
    setError(undefined);

    let codeError: Error | null = null;
    let conversationError: Error | null = null;
    // densable De — skippedLinks from onRestoreCode (TYn partial UX)
    let skippedLinks = 0;

    if (option === 'code' || option === 'both') {
      try {
        const restoreResult = await onRestoreCode(messageToRestore);
        skippedLinks = restoreResult?.skippedLinks ?? 0;
      } catch (error) {
        codeError = error as Error;
        logError(codeError);
      }
    }

    if (option === 'conversation' || option === 'both') {
      try {
        await onRestoreMessage(messageToRestore);
      } catch (error) {
        conversationError = error as Error;
        logError(conversationError);
      }
    }

    setIsRestoring(false);
    setMessageToRestore(undefined);

    // densable Ge — partial restore warning (still success path for code)
    const skippedLinksMessage = skippedLinks > 0 ? formatRewindSkippedLinksMessage(skippedLinks) : undefined;

    // densable order: both fail → code fail → conversation fail and/or Ge → close
    if (conversationError && codeError) {
      setError(`Failed to restore the conversation and code:\n${conversationError}\n${codeError}`);
    } else if (codeError) {
      setError(`Failed to restore the code:\n${codeError}`);
    } else if (conversationError || skippedLinksMessage) {
      setError(
        [
          conversationError ? `Failed to restore the conversation:\n${conversationError}` : undefined,
          skippedLinksMessage,
        ]
          .filter(Boolean)
          .join('\n\n'),
      );
    } else {
      // Success - close the selector
      onClose();
    }
  }

  const handleEscape = useCallback(() => {
    if (messageToRestore && !preselectedMessage) {
      // Go back to message list instead of closing entirely
      setMessageToRestore(undefined);
      return;
    }
    logEvent('tengu_message_selector_cancelled', {});
    onClose();
  }, [onClose, messageToRestore, preselectedMessage]);

  const moveSelectionTo = useCallback(
    (nextIndex: number) => {
      const clamped = Math.max(0, Math.min(messageOptions.length - 1, nextIndex));
      setSelectedIndex(clamped);
      setWindowStart(prev => {
        const start = Math.min(prev, maxWindowStart);
        if (clamped < start) return clamped;
        if (clamped >= start + visibleMessages) return Math.min(maxWindowStart, clamped - visibleMessages + 1);
        return start;
      });
    },
    [messageOptions.length, maxWindowStart, visibleMessages],
  );

  const moveUp = useCallback(() => moveSelectionTo(selectedIndex - 1), [moveSelectionTo, selectedIndex]);
  const moveDown = useCallback(() => moveSelectionTo(selectedIndex + 1), [moveSelectionTo, selectedIndex]);
  const jumpToTop = useCallback(() => moveSelectionTo(0), [moveSelectionTo]);
  const jumpToBottom = useCallback(
    () => moveSelectionTo(messageOptions.length - 1),
    [moveSelectionTo, messageOptions.length],
  );
  const handleSelectCurrent = useCallback(() => {
    const selected = messageOptions[selectedIndex];
    if (selected) {
      void handleSelect(selected);
    }
  }, [messageOptions, selectedIndex, handleSelect]);

  const handleWheel = useCallback(
    (event: WheelEvent) => {
      if (isRestoring || event.deltaY === 0 || maxWindowStart === 0) return;
      const delta = event.deltaY > 0 ? 1 : -1;
      setWindowStart(prev => {
        const base = Math.min(prev, maxWindowStart);
        const next = Math.max(0, Math.min(maxWindowStart, base + delta));
        setSelectedIndex(cur => Math.max(next, Math.min(next + visibleMessages - 1, cur)));
        return next;
      });
      event.stopImmediatePropagation();
    },
    [isRestoring, maxWindowStart, visibleMessages],
  );

  // Message selector navigation keybindings
  useKeybindings(
    {
      'messageSelector:up': moveUp,
      'messageSelector:down': moveDown,
      'messageSelector:top': jumpToTop,
      'messageSelector:bottom': jumpToBottom,
      'messageSelector:select': handleSelectCurrent,
    },
    {
      context: 'MessageSelector',
      isActive: !isRestoring && !error && !messageToRestore && hasMessagesToSelect,
    },
  );

  const [fileHistoryMetadata, setFileHistoryMetadata] = useState<Record<number, DiffStats | undefined>>({});

  useEffect(() => {
    async function loadFileHistoryMetadata() {
      if (!isFileHistoryEnabled) {
        return;
      }
      // Load file snapshot metadata
      void Promise.all(
        messageOptions.map(async (userMessage, itemIndex) => {
          if (userMessage.uuid !== currentUUID && userMessage.uuid !== preClearUUID) {
            const canRestore = fileHistoryCanRestore(fileHistory, userMessage.uuid);

            const nextUserMessage = messageOptions.at(itemIndex + 1);
            const diffStats = canRestore
              ? computeDiffStatsBetweenMessages(
                  messages,
                  userMessage.uuid,
                  nextUserMessage?.uuid !== currentUUID ? nextUserMessage?.uuid : undefined,
                )
              : undefined;

            if (diffStats !== undefined) {
              setFileHistoryMetadata(prev => ({
                ...prev,
                [itemIndex]: diffStats,
              }));
            } else {
              setFileHistoryMetadata(prev => ({
                ...prev,
                [itemIndex]: undefined,
              }));
            }
          }
        }),
      );
    }
    void loadFileHistoryMetadata();
  }, [messageOptions, messages, currentUUID, preClearUUID, fileHistory, isFileHistoryEnabled]);

  const canRestoreCode =
    isFileHistoryEnabled && diffStatsForRestore?.filesChanged && diffStatsForRestore.filesChanged.length > 0;
  const showPickList = !error && !messageToRestore && !preselectedMessage && hasMessagesToSelect;
  const visibleSlice = messageOptions.slice(firstVisibleIndex, firstVisibleIndex + visibleMessages);
  const moreAbove = firstVisibleIndex;
  const moreBelow = Math.max(0, messageOptions.length - (firstVisibleIndex + visibleSlice.length));

  return (
    <Dialog
      title="Rewind"
      color="suggestion"
      onCancel={handleEscape}
      isCancelActive={!messageToRestore || !hasMessagesToSelect}
      hideInputGuide={!!messageToRestore && hasMessagesToSelect}
      inputGuide={
        <Byline>
          {!error && hasMessagesToSelect && <KeyboardShortcutHint shortcut="enter" action="continue" />}
          <KeyboardShortcutHint shortcut="esc" action="cancel" />
        </Byline>
      }
    >
      {error && <Text color="error">Error: {error}</Text>}
      {!hasMessagesToSelect && <Text dimColor>Nothing to rewind to yet.</Text>}
      {!error && messageToRestore && hasMessagesToSelect && (
        <>
          <Text>
            Confirm you want to restore {!diffStatsForRestore && 'the conversation '}to the point before you sent this
            message:
          </Text>
          <Box
            flexDirection="column"
            paddingLeft={1}
            borderStyle="single"
            borderRight={false}
            borderTop={false}
            borderBottom={false}
            borderLeft={true}
            borderLeftDimColor
          >
            <UserMessageOption userMessage={messageToRestore} color="text" isCurrent={false} />
            <Text dimColor>
              (
              {formatRelativeTimeAgo(new Date(messageToRestore.timestamp as string | number | Date), {
                now: confirmOpenedAt,
              })}
              )
            </Text>
          </Box>
          {confirmDescription !== undefined && !isSummarizeOption(selectedRestoreOption) ? (
            <Text dimColor>
              {selectedRestoreOption === 'nevermind' ? 'The conversation will be unchanged.' : confirmDescription}
            </Text>
          ) : (
            <RestoreOptionDescription
              selectedRestoreOption={selectedRestoreOption}
              canRestoreCode={!!canRestoreCode}
              diffStatsForRestore={diffStatsForRestore}
            />
          )}
          {isRestoring && isSummarizeOption(restoringOption) ? (
            <Box flexDirection="row" gap={1}>
              <Spinner />
              <Text>Summarizing…</Text>
            </Box>
          ) : (
            <Select
              isDisabled={isRestoring}
              options={getRestoreOptions(!!canRestoreCode)}
              defaultFocusValue={canRestoreCode ? 'both' : 'conversation'}
              onFocus={value => setSelectedRestoreOption(value as RestoreOption)}
              onChange={value => onSelectRestoreOption(value as RestoreOption)}
              onCancel={() => (preselectedMessage ? onClose() : setMessageToRestore(undefined))}
            />
          )}
          {canRestoreCode && (
            <Box marginBottom={1}>
              <Text dimColor>{figures.warning} Rewinding does not affect files edited manually or via bash.</Text>
            </Box>
          )}
        </>
      )}
      {showPickList && (
        <>
          {isFileHistoryEnabled ? (
            <Text>Restore the code and/or conversation to the point before…</Text>
          ) : (
            <Text>Restore and fork the conversation to the point before…</Text>
          )}
          <Box width="100%" flexDirection="column" onWheel={maxWindowStart > 0 ? handleWheel : undefined}>
            {moreAbove > 0 && (
              <Box paddingLeft={1}>
                <FePress paddingX={1} repeat onPress={isRestoring ? undefined : jumpToTop}>
                  {`${figures.arrowUp} ${moreAbove} more`}
                </FePress>
              </Box>
            )}
            {visibleSlice.map((msg, visibleOptionIndex) => {
              const optionIndex = firstVisibleIndex + visibleOptionIndex;
              const isSelected = optionIndex === selectedIndex;
              const isCurrent = msg.uuid === currentUUID;
              const isPreClear = msg.uuid === preClearUUID;

              const metadataLoaded = isFileHistoryEnabled && optionIndex in fileHistoryMetadata;
              const metadata = fileHistoryMetadata[optionIndex];
              const numFilesChanged = metadata?.filesChanged && metadata.filesChanged.length;

              return (
                <Box key={msg.uuid} height={itemRows} overflow="hidden" width="100%" flexDirection="column">
                  <ListItem
                    isFocused={!isRestoring && isSelected}
                    styled={false}
                    hovered={!isRestoring && !isSelected && hoveredIndex === optionIndex}
                    onMouseEnter={() => setHoveredIndex(optionIndex)}
                    onMouseLeave={() => setHoveredIndex(prev => (prev === optionIndex ? null : prev))}
                    onClick={(event: ClickEvent) => {
                      if (isRestoring) return;
                      moveSelectionTo(optionIndex);
                      void handleSelect(msg);
                      event.stopImmediatePropagation();
                    }}
                  >
                    <Box flexDirection="column">
                      <Box flexShrink={1} height={1} overflow="hidden">
                        {isPreClear ? (
                          <Box width="100%">
                            <Text color={isSelected ? 'suggestion' : undefined}>
                              /resume {parentSessionId} (previous session)
                            </Text>
                          </Box>
                        ) : (
                          <UserMessageOption
                            userMessage={msg}
                            color={isSelected ? 'suggestion' : undefined}
                            isCurrent={isCurrent}
                            paddingRight={10}
                          />
                        )}
                      </Box>
                      {metadataLoaded && (
                        <Box height={1} flexDirection="row">
                          {metadata ? (
                            <Text dimColor={!isSelected} color="inactive">
                              {numFilesChanged ? (
                                <>
                                  {numFilesChanged === 1 && metadata.filesChanged![0]
                                    ? `${path.basename(metadata.filesChanged![0])} `
                                    : `${numFilesChanged} files changed `}
                                  <DiffStatsText diffStats={metadata} />
                                </>
                              ) : (
                                <>No code changes</>
                              )}
                            </Text>
                          ) : (
                            <Text dimColor color="warning">
                              {figures.warning} No code restore
                            </Text>
                          )}
                        </Box>
                      )}
                    </Box>
                  </ListItem>
                </Box>
              );
            })}
            {moreBelow > 0 && (
              <Box paddingLeft={1}>
                <FePress paddingX={1} repeat onPress={isRestoring ? undefined : jumpToBottom}>
                  {`${figures.arrowDown} ${moreBelow} more`}
                </FePress>
              </Box>
            )}
          </Box>
        </>
      )}
    </Dialog>
  );
}

function getRestoreOptionConversationText(option: RestoreOption): string {
  switch (option) {
    case 'summarize':
      return 'Messages after this point will be summarized.';
    case 'summarize_up_to':
      return 'Preceding messages will be summarized. This and subsequent messages will remain unchanged — you will stay at the end of the conversation.';
    case 'both':
    case 'conversation':
      return 'The conversation will be forked.';
    case 'code':
    case 'nevermind':
      return 'The conversation will be unchanged.';
  }
}

function RestoreOptionDescription({
  selectedRestoreOption,
  canRestoreCode,
  diffStatsForRestore,
}: {
  selectedRestoreOption: RestoreOption;
  canRestoreCode: boolean;
  diffStatsForRestore: DiffStats | undefined;
}): React.ReactNode {
  const showCodeRestore = canRestoreCode && (selectedRestoreOption === 'both' || selectedRestoreOption === 'code');

  return (
    <Box flexDirection="column">
      <Text dimColor>{getRestoreOptionConversationText(selectedRestoreOption)}</Text>
      {!isSummarizeOption(selectedRestoreOption) &&
        (showCodeRestore ? (
          <RestoreCodeConfirmation diffStatsForRestore={diffStatsForRestore} />
        ) : (
          <Text dimColor>The code will be unchanged.</Text>
        ))}
    </Box>
  );
}

function RestoreCodeConfirmation({
  diffStatsForRestore,
}: {
  diffStatsForRestore: DiffStats | undefined;
}): React.ReactNode {
  if (diffStatsForRestore === undefined) {
    return undefined;
  }
  if (!diffStatsForRestore.filesChanged || !diffStatsForRestore.filesChanged[0]) {
    return <Text dimColor>The code has not changed (nothing will be restored).</Text>;
  }

  const numFilesChanged = diffStatsForRestore.filesChanged.length;

  let fileLabel = '';
  if (numFilesChanged === 1) {
    fileLabel = path.basename(diffStatsForRestore.filesChanged[0] || '');
  } else if (numFilesChanged === 2) {
    const file1 = path.basename(diffStatsForRestore.filesChanged[0] || '');
    const file2 = path.basename(diffStatsForRestore.filesChanged[1] || '');
    fileLabel = `${file1} and ${file2}`;
  } else {
    const file1 = path.basename(diffStatsForRestore.filesChanged[0] || '');
    fileLabel = `${file1} and ${diffStatsForRestore.filesChanged.length - 1} other files`;
  }

  return (
    <>
      <Text dimColor>
        The code will be restored <DiffStatsText diffStats={diffStatsForRestore} /> in {fileLabel}.
      </Text>
    </>
  );
}

function DiffStatsText({ diffStats }: { diffStats: DiffStats | undefined }): React.ReactNode {
  if (!diffStats || !diffStats.filesChanged) {
    return undefined;
  }
  const { insertions, deletions } = diffStats;
  if (insertions === 0 && deletions === 0) {
    return null;
  }
  return (
    <Text>
      {insertions > 0 && <Text color="diffAddedWord">+{insertions}</Text>}
      {insertions > 0 && deletions > 0 && ' '}
      {deletions > 0 && <Text color="diffRemovedWord">-{deletions}</Text>}
    </Text>
  );
}

function UserMessageOption({
  userMessage,
  color,
  dimColor,
  isCurrent,
  paddingRight,
}: {
  userMessage: UserMessage;
  color?: keyof Theme;
  dimColor?: boolean;
  isCurrent: boolean;
  paddingRight?: number;
}): React.ReactNode {
  const { columns } = useTerminalSize();
  if (isCurrent) {
    return (
      <Box width="100%">
        <Text italic color={color} dimColor={dimColor}>
          (current)
        </Text>
      </Box>
    );
  }

  const content = userMessage.message!.content;
  const lastBlock = typeof content === 'string' ? null : content![content!.length - 1];
  const rawMessageText =
    typeof content === 'string'
      ? content.trim()
      : lastBlock && isTextBlock(lastBlock)
        ? lastBlock.text.trim()
        : '(no prompt)';

  // Strip display-unfriendly tags (like <ide_opened_file>) before showing in the list
  const messageText = stripDisplayTags(rawMessageText);

  if (isEmptyMessageText(messageText)) {
    return (
      <Box flexDirection="row" width="100%">
        <Text italic color={color} dimColor={dimColor}>
          ((empty message))
        </Text>
      </Box>
    );
  }

  // Bash inputs
  if (messageText.includes('<bash-input>')) {
    const input = extractTag(messageText, 'bash-input');
    if (input) {
      return (
        <Box flexDirection="row" width="100%">
          <Text color="bashBorder">!</Text>
          <Text color={color} dimColor={dimColor}>
            {' '}
            {input}
          </Text>
        </Box>
      );
    }
  }

  // Skills and slash commands
  if (messageText.includes(`<${COMMAND_MESSAGE_TAG}>`)) {
    const commandMessage = extractTag(messageText, COMMAND_MESSAGE_TAG);
    const args = extractTag(messageText, 'command-args');
    const isSkillFormat = extractTag(messageText, 'skill-format') === 'true';
    if (commandMessage) {
      if (isSkillFormat) {
        // Skills: Display as "Skill(name)"
        return (
          <Box flexDirection="row" width="100%">
            <Text color={color} dimColor={dimColor}>
              Skill({commandMessage})
            </Text>
          </Box>
        );
      } else {
        // Slash commands: Add "/" prefix and include args
        const commandText = `/${commandMessage}${args ? ` ${args}` : ''}`;
        return (
          <Box flexDirection="row" width="100%">
            <Text color={color} dimColor={dimColor}>
              {commandText}
            </Text>
          </Box>
        );
      }
    }
  }

  // User prompts
  return (
    <Box flexDirection="row" width="100%">
      <Text color={color} dimColor={dimColor}>
        {paddingRight
          ? truncate(messageText, columns - paddingRight, true)
          : messageText.slice(0, 500).split('\n').slice(0, 4).join('\n')}
      </Text>
    </Box>
  );
}

/**
 * Computes the diff stats for all the file edits in-between two messages.
 */
function computeDiffStatsBetweenMessages(
  messages: Message[],
  fromMessageId: UUID,
  toMessageId: UUID | undefined,
): DiffStats | undefined {
  const startIndex = messages.findIndex(msg => msg.uuid === fromMessageId);
  if (startIndex === -1) {
    return undefined;
  }

  let endIndex = toMessageId ? messages.findIndex(msg => msg.uuid === toMessageId) : messages.length;
  if (endIndex === -1) {
    endIndex = messages.length;
  }

  const filesChanged: string[] = [];
  let insertions = 0;
  let deletions = 0;

  for (let i = startIndex + 1; i < endIndex; i++) {
    const msg = messages[i];
    if (!msg || !isToolUseResultMessage(msg)) {
      continue;
    }

    const result = msg.toolUseResult as FileEditOutput | FileWriteToolOutput;
    if (!result || !result.filePath || !result.structuredPatch) {
      continue;
    }

    if (!filesChanged.includes(result.filePath)) {
      filesChanged.push(result.filePath);
    }

    try {
      if ('type' in result && result.type === 'create') {
        insertions += result.content.split(/\r?\n/).length;
      } else {
        for (const hunk of result.structuredPatch) {
          const additions = count(hunk.lines, line => line.startsWith('+'));
          const removals = count(hunk.lines, line => line.startsWith('-'));

          insertions += additions;
          deletions += removals;
        }
      }
    } catch {}
  }

  return {
    filesChanged,
    insertions,
    deletions,
  };
}

export function selectableUserMessagesFilter(message: Message): message is UserMessage {
  if (message.type !== 'user') {
    return false;
  }
  if (Array.isArray(message.message!.content) && message.message!.content[0]?.type === 'tool_result') {
    return false;
  }
  if (isSyntheticMessage(message)) {
    return false;
  }
  if (message.isMeta) {
    return false;
  }
  if (message.isCompactSummary || message.isVisibleInTranscriptOnly) {
    return false;
  }

  const content = message.message!.content;
  const lastBlock = typeof content === 'string' ? null : content![content!.length - 1];
  const messageText =
    typeof content === 'string' ? content.trim() : lastBlock && isTextBlock(lastBlock) ? lastBlock.text.trim() : '';

  // Filter out non-user-authored messages (command outputs, task notifications, ticks).
  if (
    messageText.indexOf(`<${LOCAL_COMMAND_STDOUT_TAG}>`) !== -1 ||
    messageText.indexOf(`<${LOCAL_COMMAND_STDERR_TAG}>`) !== -1 ||
    messageText.indexOf(`<${BASH_STDOUT_TAG}>`) !== -1 ||
    messageText.indexOf(`<${BASH_STDERR_TAG}>`) !== -1 ||
    messageText.indexOf(`<${TASK_NOTIFICATION_TAG}>`) !== -1 ||
    messageText.indexOf(`<${TICK_TAG}>`) !== -1 ||
    messageText.indexOf(`<${TEAMMATE_MESSAGE_TAG}`) !== -1
  ) {
    return false;
  }
  return true;
}

/**
 * Checks if all messages after the given index are synthetic (interruptions, cancels, etc.)
 * or non-meaningful content. Returns true if there's nothing meaningful to confirm -
 * for example, if the user hit enter then immediately cancelled.
 */
export function messagesAfterAreOnlySynthetic(messages: Message[], fromIndex: number): boolean {
  for (let i = fromIndex + 1; i < messages.length; i++) {
    const msg = messages[i];
    if (!msg) continue;

    // Skip known non-meaningful message types
    if (isSyntheticMessage(msg)) continue;
    if (isToolUseResultMessage(msg)) continue;
    if (msg.type === 'progress') continue;
    if (msg.type === 'system') continue;
    if (msg.type === 'attachment') continue;
    if (msg.type === 'user' && msg.isMeta) continue;

    // Assistant with actual content = meaningful
    if (msg.type === 'assistant') {
      const content = msg.message!.content;
      if (Array.isArray(content)) {
        const hasMeaningfulContent = content.some(
          block => (block.type === 'text' && block.text.trim()) || block.type === 'tool_use',
        );
        if (hasMeaningfulContent) return false;
      }
      continue;
    }

    // User messages that aren't synthetic or meta = meaningful
    if (msg.type === 'user') {
      return false;
    }

    // Other types (e.g., tombstone) are non-meaningful, continue
  }
  return true;
}
