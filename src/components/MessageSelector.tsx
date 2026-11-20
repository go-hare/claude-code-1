import type { ContentBlockParam, TextBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';
import { randomUUID, type UUID } from 'crypto';
import figures from 'figures';
import * as React from 'react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js';
import { useAppState } from 'src/state/AppState.js';
import {
  type DiffStats,
  type FileHistoryState,
  fileHistoryCanRestore,
  fileHistoryEnabled,
  fileHistoryGetDiffStats,
  formatRewindFailedPathsMessage,
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
   * densable: may return `{ skippedLinks, skippedPaths, failedPaths }` so
   * partial link-safety skips and per-file restore failures (#396) surface
   * warnings without silently closing `/rewind`.
   */
  onRestoreCode: (
    message: UserMessage,
  ) => Promise<{ skippedLinks?: number; skippedPaths?: string[]; failedPaths?: string[] } | undefined>;
  onSummarize?: (
    message: UserMessage,
    feedback?: string,
    direction?: PartialCompactDirection,
    signal?: AbortSignal,
  ) => Promise<void>;
  onClose: () => void;
  /** Skip pick-list, land on confirm. Caller ran skip-check first. Esc closes fully (no back-to-list). */
  preselectedMessage?: UserMessage;
  onResumePreviousSession?: () => void;
  parentSessionId?: string;
  extraEntry?: { label: string; onSelect: () => void };
  confirmDescription?: (message: UserMessage) => string | undefined;
  restoreWait?: { message: string; onStopWaiting: () => void };
  pickListNote?: string;
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
  extraEntry,
  confirmDescription,
  restoreWait,
  pickListNote,
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
      ? Math.max(Math.floor(terminalSize.rows * 0.65), Math.min(terminalSize.rows - 4, 18))
      : terminalSize.rows;
  const itemRows = isFileHistoryEnabled ? 3 : 2;
  // Official 2.1.326 #38: accurate header budget so fullscreen /rewind shows >1 past prompt.
  const extraHeaderRows = 8 + (pickListNote ? 2 : 0) + (error ? 3 : 0);
  const visibleMessages = Math.max(3, Math.floor((availableRows - extraHeaderRows) / itemRows));
  const maxConfirmPreviewLines = Math.max(1, Math.min(3, availableRows - 16));

  // Add current prompt (and optional pre-clear session entry / extraEntry) as virtual messages
  const currentUUID = useMemo(randomUUID, []);
  const preClearUUID = useMemo(randomUUID, []);
  const hasPreviousSession = !!onResumePreviousSession;
  const extraEntryUUID = useMemo(randomUUID, []);
  const hasExtraEntry = extraEntry !== undefined;
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
      ...(hasExtraEntry
        ? [
            {
              ...createUserMessage({ content: '' }),
              uuid: extraEntryUUID,
            } as UserMessage,
          ]
        : []),
      {
        ...createUserMessage({
          content: '',
        }),
        uuid: currentUUID,
      } as UserMessage,
    ],
    [messages, currentUUID, preClearUUID, hasPreviousSession, extraEntryUUID, hasExtraEntry],
  );
  const [selectedIndex, setSelectedIndex] = useState(messageOptions.length - 1);
  const maxWindowStart = Math.max(0, messageOptions.length - visibleMessages);
  const [windowStart, setWindowStart] = useState(() => Math.max(0, messageOptions.length - visibleMessages));
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const firstVisibleIndex = Math.min(windowStart, maxWindowStart);

  const hasMessagesToSelect = messageOptions.length > 1;

  const [messageToRestore, setMessageToRestore] = useState<UserMessage | undefined>(preselectedMessage);
  const [confirmDesc, setConfirmDesc] = useState<string | undefined>(() =>
    preselectedMessage === undefined ? undefined : confirmDescription?.(preselectedMessage),
  );
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
  const summarizeAbortRef = useRef<AbortController | null>(null);
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
    setError(undefined);
    if (message.uuid === preClearUUID) {
      onPreRestore();
      onClose();
      onResumePreviousSession?.();
      return;
    }
    if (message.uuid === extraEntryUUID) {
      onClose();
      extraEntry?.onSelect();
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
      setConfirmDesc(confirmDescription(message));
      setMessageToRestore(message);
      return;
    }

    const diffStats = await fileHistoryGetDiffStats(fileHistory, message.uuid);
    setConfirmOpenedAt(new Date());
    setConfirmDesc(confirmDescription?.(message));
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
      const controller = new AbortController();
      summarizeAbortRef.current = controller;
      try {
        const direction = option === 'summarize_up_to' ? 'up_to' : 'from';
        const feedback = (direction === 'up_to' ? summarizeUpToFeedback : summarizeFromFeedback).trim() || undefined;
        await onSummarize(messageToRestore, feedback, direction, controller.signal);
        if (controller.signal.aborted) {
          return;
        }
        setIsRestoring(false);
        setRestoringOption(null);
        setMessageToRestore(undefined);
        onClose();
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        logError(error as Error);
        setIsRestoring(false);
        setRestoringOption(null);
        setMessageToRestore(undefined);
        setError(`Failed to summarize:\n${error}`);
      } finally {
        if (summarizeAbortRef.current === controller) {
          summarizeAbortRef.current = null;
        }
      }
      return;
    }

    onPreRestore();
    setIsRestoring(true);
    setError(undefined);

    let codeError: Error | null = null;
    let conversationError: Error | null = null;
    // densable De — skippedLinks, skippedPaths & failedPaths (#396) from onRestoreCode
    let skippedLinks = 0;
    let skippedPaths: string[] = [];
    let failedPaths: string[] = [];

    if (option === 'code' || option === 'both') {
      try {
        const restoreResult = await onRestoreCode(messageToRestore);
        skippedLinks = restoreResult?.skippedLinks ?? 0;
        skippedPaths = restoreResult?.skippedPaths ?? [];
        failedPaths = restoreResult?.failedPaths ?? [];
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

    // Official 2.1.327 (#396): report per-file restore failures instead of closing silently.
    const failedPathsMessage = failedPaths.length > 0 ? formatRewindFailedPathsMessage(failedPaths) : undefined;
    // densable Ge — partial restore warning (still success path for code)
    const skippedLinksMessage =
      skippedLinks > 0 ? formatRewindSkippedLinksMessage(skippedLinks, skippedPaths) : undefined;

    // densable order: both fail → code fail → conversation fail and/or failedPaths/skippedLinks → close
    if (conversationError && codeError) {
      setError(`Failed to restore the conversation and code:\n${conversationError}\n${codeError}`);
    } else if (codeError) {
      setError(`Failed to restore the code:\n${codeError}`);
    } else if (conversationError || failedPathsMessage || skippedLinksMessage) {
      setError(
        [
          conversationError ? `Failed to restore the conversation:\n${conversationError}` : undefined,
          failedPathsMessage,
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

  const isSummarizing = isRestoring && isSummarizeOption(restoringOption);

  const handleEscape = useCallback(() => {
    // Official 2.1.326 #38: pressing Esc while summarizing aborts and exits cleanly.
    if (isSummarizing) {
      summarizeAbortRef.current?.abort();
      summarizeAbortRef.current = null;
      setIsRestoring(false);
      setRestoringOption(null);
      setMessageToRestore(undefined);
      logEvent('tengu_message_selector_cancelled', {});
      onClose();
      return;
    }
    if (isRestoring && restoreWait) {
      restoreWait.onStopWaiting();
      return;
    }
    if (messageToRestore && !preselectedMessage) {
      // Go back to message list instead of closing entirely
      setMessageToRestore(undefined);
      return;
    }
    logEvent('tengu_message_selector_cancelled', {});
    onClose();
  }, [isSummarizing, isRestoring, restoreWait, onClose, messageToRestore, preselectedMessage]);

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
    if (!isFileHistoryEnabled || preselectedMessage) {
      return;
    }
    const controller = new AbortController();

    void loadRewindDiffStatsWithBudget({
      messageOptions,
      messages,
      fileHistory,
      currentUUID,
      preClearUUID,
      extraEntryUUID,
      signal: controller.signal,
      onPartialUpdate: partial => {
        if (!controller.signal.aborted) {
          setFileHistoryMetadata(partial);
        }
      },
    })
      .then(finalMetadata => {
        if (!controller.signal.aborted) {
          setFileHistoryMetadata(finalMetadata);
        }
      })
      .catch(logError);
    return () => {
      controller.abort();
    };
  }, [
    messageOptions,
    messages,
    currentUUID,
    preClearUUID,
    extraEntryUUID,
    fileHistory,
    isFileHistoryEnabled,
    preselectedMessage,
  ]);

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
      isCancelActive={!messageToRestore || !hasMessagesToSelect || isSummarizing || Boolean(isRestoring && restoreWait)}
      hideInputGuide={!!messageToRestore && hasMessagesToSelect && !isSummarizing && !(isRestoring && restoreWait)}
      inputGuide={
        <Byline>
          {!error && hasMessagesToSelect && <KeyboardShortcutHint shortcut="enter" action="continue" />}
          <KeyboardShortcutHint shortcut="esc" action="cancel" />
        </Byline>
      }
    >
      {error && <Text color="error">Error: {error}</Text>}
      {!hasMessagesToSelect && (
        <>
          <Text dimColor>{pickListNote === undefined ? 'Nothing to rewind to yet.' : 'Nothing to rewind to.'}</Text>
          {pickListNote !== undefined && <Text dimColor>{pickListNote}</Text>}
        </>
      )}
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
            <UserMessageOption
              userMessage={messageToRestore}
              color="text"
              isCurrent={false}
              maxLines={maxConfirmPreviewLines}
            />
            <Text dimColor>
              (
              {formatRelativeTimeAgo(new Date(messageToRestore.timestamp as string | number | Date), {
                now: confirmOpenedAt,
              })}
              )
            </Text>
          </Box>
          {confirmDescription !== undefined &&
          messageToRestore !== undefined &&
          !isSummarizeOption(selectedRestoreOption) ? (
            <Text dimColor>
              {selectedRestoreOption === 'nevermind' ? 'The conversation will be unchanged.' : confirmDesc}
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
              <Text>
                Summarizing… <Text dimColor>(Esc to cancel)</Text>
              </Text>
            </Box>
          ) : isRestoring && restoreWait !== undefined ? (
            <Box flexDirection="row" gap={1}>
              <Spinner />
              <Text>{restoreWait.message}</Text>
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
              <Text dimColor>
                {figures.warning} Restored files go back whole, losing later changes by anyone. Bash changes to other
                files are not undone.
              </Text>
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
          {pickListNote !== undefined && <Text dimColor>{pickListNote}</Text>}
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
              const isExtraEntry = msg.uuid === extraEntryUUID;

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
                        ) : isExtraEntry && extraEntry ? (
                          <Box width="100%">
                            <Text color={isSelected ? 'suggestion' : undefined}>{extraEntry.label}</Text>
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
                                  {metadata.hasUncheckedFiles && ', other files not checked'}
                                </>
                              ) : metadata.hasUncheckedFiles ? (
                                <>Code changes unknown</>
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

export function getRestoreOptionConversationText(option: RestoreOption): string {
  switch (option) {
    case 'summarize':
      return 'Messages after this point will be summarized.';
    case 'summarize_up_to':
      return 'Preceding messages will be summarized. This and subsequent messages will remain unchanged — you will stay at the end of the conversation.';
    case 'both':
    case 'conversation':
      return 'The conversation goes back to before this message.';
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
    if (diffStatsForRestore.hasUncheckedFiles) {
      return <Text dimColor>Code changes unknown — files changed by shell commands cannot be restored.</Text>;
    }
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

const UserMessageOption = memo(function UserMessageOption({
  userMessage,
  color,
  dimColor,
  isCurrent,
  paddingRight,
  maxLines,
}: {
  userMessage: UserMessage;
  color?: keyof Theme;
  dimColor?: boolean;
  isCurrent: boolean;
  paddingRight?: number;
  maxLines?: number;
}): React.ReactNode {
  const { columns } = useTerminalSize();
  // Strip display-unfriendly tags (like <ide_opened_file>) before showing in the list, memoized per userMessage
  const messageText = useMemo(() => {
    const content = userMessage.message!.content;
    const lastBlock = typeof content === 'string' ? null : content![content!.length - 1];
    const rawMessageText =
      typeof content === 'string'
        ? content.trim()
        : lastBlock && isTextBlock(lastBlock)
          ? lastBlock.text.trim()
          : '(no prompt)';
    return stripDisplayTags(rawMessageText);
  }, [userMessage]);

  // Official 2.1.326 #38: cap confirm preview lines & width so long prompts never push the warning off-screen.
  const renderedPromptText = useMemo(() => {
    if (paddingRight) {
      return truncate(messageText, columns - paddingRight, true);
    }
    const lineLimit = maxLines ?? 3;
    const lineWidth = Math.max(20, columns - 10);
    const rawLines = messageText.slice(0, 500).split('\n');
    const clipped = rawLines.slice(0, lineLimit).map(line => truncate(line, lineWidth, true));
    if (rawLines.length > lineLimit && clipped.length > 0) {
      clipped[clipped.length - 1] = truncate(`${clipped[clipped.length - 1]}…`, lineWidth, true);
    }
    return clipped.join('\n');
  }, [messageText, columns, paddingRight, maxLines]);

  if (isCurrent) {
    return (
      <Box width="100%">
        <Text italic color={color} dimColor={dimColor}>
          (current)
        </Text>
      </Box>
    );
  }

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
        {renderedPromptText}
      </Text>
    </Box>
  );
});

/**
 * Computes the diff stats for all the file edits in-between two messages.
 * Official 2.1.326 #37: marks `hasUncheckedFiles: true` when any shell command
 * ran during the turn so `/rewind` shows "Code changes unknown" instead of
 * falsely claiming "No code changes".
 */
export function computeDiffStatsBetweenMessages(
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
  let hasUncheckedFiles = false;

  for (let i = startIndex + 1; i < endIndex; i++) {
    const msg = messages[i];
    if (!msg) {
      continue;
    }

    // Detect shell tool calls (Bash / PowerShell) whose side effects are untracked by FileHistory.
    if (msg.type === 'assistant') {
      const content = msg.message?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (
            block &&
            typeof block === 'object' &&
            block.type === 'tool_use' &&
            'name' in block &&
            (block.name === 'Bash' || block.name === 'PowerShell')
          ) {
            hasUncheckedFiles = true;
          }
        }
      }
      continue;
    }

    if (msg.type === 'user' && !isToolUseResultMessage(msg)) {
      const content = msg.message?.content;
      if (typeof content === 'string' && content.includes('<bash-input>')) {
        hasUncheckedFiles = true;
      }
      continue;
    }

    if (!isToolUseResultMessage(msg)) {
      continue;
    }

    const result = msg.toolUseResult as (FileEditOutput | FileWriteToolOutput) & {
      stdout?: unknown;
      stderr?: unknown;
      interrupted?: unknown;
    };
    if (!result || !result.filePath || !result.structuredPatch) {
      if (
        result &&
        typeof result === 'object' &&
        ('stdout' in result || 'stderr' in result || 'interrupted' in result)
      ) {
        hasUncheckedFiles = true;
      }
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
    ...(hasUncheckedFiles ? { hasUncheckedFiles: true } : {}),
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

const DEFAULT_REWIND_DIFF_BUDGET_MS = 2000;

function raceWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | undefined> {
  if (timeoutMs <= 0) return Promise.resolve(undefined);
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise.finally(() => {
      if (timer !== undefined) clearTimeout(timer);
    }),
    new Promise<undefined>(resolve => {
      timer = setTimeout(() => resolve(undefined), timeoutMs);
    }),
  ]);
}

/**
 * Official 2.1.323 (#2085): asynchronously load `/rewind` diff stats with a
 * timeout budget on the latest working-tree snapshot so network paths or hung
 * folders never prevent older snapshot labels from appearing promptly.
 */
export async function loadRewindDiffStatsWithBudget(params: {
  messageOptions: readonly UserMessage[];
  messages: readonly Message[];
  fileHistory: FileHistoryState;
  currentUUID: string;
  preClearUUID: string;
  extraEntryUUID: string;
  signal: AbortSignal;
  budgetMs?: number;
  onPartialUpdate?: (metadata: Record<number, DiffStats | undefined>) => void;
  canRestore?: (messageId: UUID) => boolean;
  computeWorkingTreeDiff?: (messageId: UUID) => Promise<DiffStats | undefined>;
  computeBetweenMessagesDiff?: (fromId: UUID, toId: UUID | undefined) => DiffStats | undefined;
}): Promise<Record<number, DiffStats | undefined>> {
  const {
    messageOptions,
    messages,
    fileHistory,
    currentUUID,
    preClearUUID,
    extraEntryUUID,
    signal,
    budgetMs = DEFAULT_REWIND_DIFF_BUDGET_MS,
    onPartialUpdate,
    canRestore = id => fileHistoryCanRestore(fileHistory, id),
    computeWorkingTreeDiff = id => fileHistoryGetDiffStats(fileHistory, id),
    computeBetweenMessagesDiff = (fromId, toId) => computeDiffStatsBetweenMessages(messages as Message[], fromId, toId),
  } = params;

  const nextMetadata: Record<number, DiffStats | undefined> = {};
  const SLICE_MS = 16;
  let deadline = performance.now() + SLICE_MS;
  let latestWorkingTreePromise: Promise<void> | undefined;

  for (let itemIndex = messageOptions.length - 1; itemIndex >= 0; itemIndex--) {
    if (signal.aborted) return nextMetadata;
    const userMessage = messageOptions[itemIndex]!;
    if (userMessage.uuid === currentUUID || userMessage.uuid === preClearUUID || userMessage.uuid === extraEntryUUID) {
      continue;
    }
    if (!canRestore(userMessage.uuid)) {
      nextMetadata[itemIndex] = undefined;
      continue;
    }

    let nextIdx = itemIndex + 1;
    while (nextIdx < messageOptions.length - 1 && !canRestore(messageOptions[nextIdx]!.uuid)) {
      nextIdx++;
    }
    const nextUserMessage = messageOptions.at(nextIdx);
    const nextUuid = nextUserMessage?.uuid !== currentUUID ? nextUserMessage?.uuid : undefined;

    if (nextUuid === undefined) {
      // Latest snapshot compares against working tree; race against budgetMs so a
      // hung network folder doesn't block all earlier labels from rendering.
      const idx = itemIndex;
      const workingTreeFallback = computeBetweenMessagesDiff(userMessage.uuid, undefined);
      nextMetadata[idx] = workingTreeFallback;
      latestWorkingTreePromise = computeWorkingTreeDiff(userMessage.uuid)
        .then(stats => {
          if (stats !== undefined) {
            nextMetadata[idx] = stats;
          }
        })
        .catch(logError);
      await raceWithTimeout(latestWorkingTreePromise, budgetMs);
      if (signal.aborted) return nextMetadata;
      onPartialUpdate?.({ ...nextMetadata });
      deadline = performance.now() + SLICE_MS;
    } else {
      nextMetadata[itemIndex] = computeBetweenMessagesDiff(userMessage.uuid, nextUuid);
    }

    if (performance.now() >= deadline) {
      onPartialUpdate?.({ ...nextMetadata });
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      deadline = performance.now() + SLICE_MS;
    }
  }

  onPartialUpdate?.({ ...nextMetadata });
  if (latestWorkingTreePromise) {
    // Bound final wait so a permanently hung read never holds the promise forever.
    await raceWithTimeout(latestWorkingTreePromise, budgetMs);
  }
  return { ...nextMetadata };
}
