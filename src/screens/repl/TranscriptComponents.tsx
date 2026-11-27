import {
  AccessibilityContext,
  AlternateScreen,
  Box,
  Byline,
  formatShortcutString,
  Input,
  isNativeCursorEnabled,
  MenuWaitContext,
  stringWidth,
  Text,
  useDeclaredCursor,
  useSearchInput,
  useTerminalFocus,
  useTerminalTitle,
} from '@anthropic/ink';
import { feature } from 'bun:bundle';
import figures from 'figures';
import { basename } from 'path';
import * as React from 'react';
import { type RefObject, useEffect, useMemo, useState } from 'react';
import stripAnsi from 'strip-ansi';
import type { Theme } from 'src/utils/theme.js';
import type { Command } from '../../commands.js';
import { FullscreenLayout } from '../../components/FullscreenLayout.js';
import { Messages, type MessagesSource } from '../../components/Messages.js';
import { WaitingTranscriptMessages } from '../../components/messages/WaitingTranscriptMessages.js';
import {
  swarmBannerFillColumns,
  swarmBannerGradientSegments,
  useSwarmBanner,
} from '../../components/PromptInput/useSwarmBanner.js';
import { SandboxViolationExpandedView } from '../../components/SandboxViolationExpandedView.js';
import { ScrollKeybindingHandler } from '../../components/ScrollKeybindingHandler.js';
import type { JumpHandle } from '../../components/VirtualMessageList.js';
import { CancelRequestHandler } from '../../hooks/useCancelRequest.js';
import { CommandKeybindingHandlers } from '../../hooks/useCommandKeybindings.js';
import { GlobalKeybindingHandlers } from '../../hooks/useGlobalKeybindings.js';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import { KeybindingSetup } from '../../keybindings/KeybindingProviderSetup.js';
import { useShortcutDisplay } from '../../keybindings/useShortcutDisplay.js';
import type { AppState } from '../../state/AppStateStore.js';
import type { InProcessTeammateTaskState } from '../../tasks/InProcessTeammateTask/types.js';
import type { LocalAgentTaskState } from '../../tasks/LocalAgentTask/LocalAgentTask.js';
import type { Tools } from '../../Tool.js';
import type { Message as MessageType } from '../../types/message.js';
import { getExternalEditor } from '../../utils/editor.js';
import { truncateToWidth } from '../../utils/format.js';
import { isFullscreenEnvEnabled, mouseTrackingProp } from '../../utils/fullscreen.js';
import type { StreamingToolUse } from '../../utils/messages.js';
import type { ScrollPin } from '../../utils/scrollPin.js';
import type { StreamingDisplayStore } from '../../utils/streamingTextStore.js';
import { TRANSCRIPT_FOOTER_RIGHT_BADGE } from '../../utils/transcriptFooterHints.js';
import { EMPTY_STREAMING_TOOL_USES } from './replHelpers.js';
import type { Screen, ToolJSXState } from './types.js';

/* eslint-disable @typescript-eslint/no-require-imports */
const VoiceKeybindingHandler: typeof import('../../hooks/useVoiceIntegration.js').VoiceKeybindingHandler = feature(
  'VOICE_MODE',
)
  ? require('../../hooks/useVoiceIntegration.js').VoiceKeybindingHandler
  : () => null;
/* eslint-enable @typescript-eslint/no-require-imports */

/**
 * Official 2.1.328 `JBn` (`chunk@318885035.js @23263`): renders the swarm /
 * session-title top banner when the prompt input is hidden behind a blocking
 * dialog or modal (`dialogPanelVis.inPane` → `modal.footer`,
 * `dialogPanelVis.abovePrompt` → top of `abovePrompt`).
 */
export function PromptBannerFooter({ hideSessionTitle = false }: { hideSessionTitle?: boolean }): React.ReactNode {
  const { columns } = useTerminalSize();
  const isScreenReader = React.useContext(AccessibilityContext);
  const banner = useSwarmBanner({ hideSessionTitle });
  if (!banner) return null;
  const cleanedText = stripAnsi(banner.text).trim();
  if (!cleanedText) return null;
  if (isScreenReader) {
    return (
      <Text color={banner.bgColor}>
        <Text backgroundColor={banner.bgColor === 'promptBorder' ? undefined : banner.bgColor} color="inverseText">
          {' '}
          {truncateToWidth(cleanedText, Math.max(1, columns - 2))}{' '}
        </Text>
      </Text>
    );
  }
  const maxBannerCols = columns - 3;
  const bannerText = maxBannerCols > 0 ? truncateToWidth(cleanedText, maxBannerCols) : '';
  const bannerTextWidth = stringWidth(bannerText);
  const fill = swarmBannerFillColumns(columns, bannerTextWidth);
  const fillEl =
    banner.gradient && banner.gradient.length > 0
      ? swarmBannerGradientSegments(fill, banner.gradient).map((seg, i) => (
          <Text key={i} color={seg.color as keyof Theme}>
            {'─'.repeat(seg.dashes)}
          </Text>
        ))
      : '─'.repeat(fill);
  const badgeBg =
    (banner.gradient?.at(-1) as keyof Theme | undefined) ??
    (banner.bgColor === 'promptBorder' ? undefined : banner.bgColor);
  return (
    <Text color={(banner.gradient?.at(-1) as keyof Theme | undefined) ?? banner.bgColor}>
      {fillEl}
      {bannerText ? (
        <Text backgroundColor={badgeBg} color="inverseText">
          {' '}
          {bannerText}{' '}
        </Text>
      ) : null}
      {bannerText ? '─' : null}
    </Text>
  );
}

/**
 * Small component to display transcript mode footer with dynamic keybinding.
 * Must be rendered inside KeybindingSetup to access keybinding context.
 */
export function TranscriptModeFooter({
  showAllInTranscript,
  virtualScroll,
  searchBadge,
  suppressShowAll = false,
  status,
  isWorking = false,
  hasDialogWaiting = false,
}: {
  showAllInTranscript: boolean;
  virtualScroll: boolean;
  searchBadge?: { current: number; count: number };
  suppressShowAll?: boolean;
  status?: string;
  isWorking?: boolean;
  hasDialogWaiting?: boolean;
}): React.ReactNode {
  const toggleShortcut = useShortcutDisplay('app:toggleTranscript', 'Global', 'ctrl+o');
  const showAllShortcut = useShortcutDisplay('transcript:toggleShowAll', 'Transcript', 'ctrl+e');
  const { columns } = useTerminalSize();
  // Official 2.1.328 `aj`: statusLabel preempts the right-side `verbose ` badge.
  const statusLabel = hasDialogWaiting ? 'dialog waiting' : isWorking ? 'working' : undefined;
  const showVerboseBadge = statusLabel === undefined;
  const rightBadge = showVerboseBadge ? TRANSCRIPT_FOOTER_RIGHT_BADGE : '';
  // densable Ktn: short editor basename (≤8) for "v to open in <editor>".
  const editorName = (() => {
    const editor = getExternalEditor();
    if (!editor) return undefined;
    const base = basename(editor.split(' ')[0] ?? '');
    return base && base.length <= 8 ? base : undefined;
  })();
  const openInLabel = editorName ? `open in ${editorName}` : 'open in editor';
  // Official 2.1.328 `aj`: ↑/↓ to scroll · v to <editor> · ? for shortcuts
  // Width gate collapses only this segment so the sticky left side never wraps.
  const fullVirtualHints = `${figures.arrowUp}/${figures.arrowDown} to scroll · v to ${openInLabel} · ? for shortcuts`;
  const virtualHints =
    2 +
      stringWidth(
        [statusLabel ?? '', 'Showing detailed transcript', `${toggleShortcut} to toggle`, fullVirtualHints]
          .filter(s => s !== '')
          .join(' · '),
      ) +
      stringWidth(status ? `${status} ` : rightBadge) <
    columns
      ? fullVirtualHints
      : '? for shortcuts';
  const midHint = searchBadge
    ? 'n/N to navigate'
    : virtualScroll
      ? virtualHints
      : suppressShowAll
        ? `v to ${openInLabel}`
        : `${showAllShortcut} to ${showAllInTranscript ? 'collapse' : 'show all'}`;
  return (
    <Box
      noSelect
      alignItems="center"
      alignSelf="center"
      borderTopDimColor
      borderBottom={false}
      borderLeft={false}
      borderRight={false}
      borderStyle="single"
      marginTop={1}
      paddingLeft={2}
      width="100%"
    >
      {/* Official 2.1.328 `aj`: show working/dialog-waiting indicator before transcript label. */}
      <Text dimColor wrap="truncate-end">
        <Byline>
          {statusLabel !== undefined ? (
            <Text color={hasDialogWaiting ? 'permission' : 'claude'}>{statusLabel}</Text>
          ) : null}
          <Text>Showing detailed transcript</Text>
          <Text>{toggleShortcut} to toggle</Text>
          {midHint ? <Text>{midHint}</Text> : null}
        </Byline>
      </Text>
      {status ? (
        <>
          <Box flexGrow={1} />
          <Text>{status} </Text>
        </>
      ) : searchBadge ? (
        // Official 2.1.328 `Bce`: `${current} of ${count} `
        <>
          <Box flexGrow={1} />
          <Text dimColor>
            {searchBadge.current} of {searchBadge.count}{' '}
          </Text>
        </>
      ) : showVerboseBadge ? (
        <>
          <Box flexGrow={1} />
          <Text dimColor>{TRANSCRIPT_FOOTER_RIGHT_BADGE}</Text>
        </>
      ) : null}
    </Box>
  );
}

const TRANSCRIPT_SHORTCUTS_FORMAT = { keyCase: 'lower' as const, shiftAsCase: true };
const TRANSCRIPT_SHORTCUTS_PAD_X = 2;
const TRANSCRIPT_SHORTCUTS_COL_GAP = 4;

/**
 * Official 2.1.328 `Hce` (`TranscriptShortcutsHelp`): build ordered shortcut
 * hint strings with exit and close first so they stay visible in short windows.
 */
export function buildTranscriptShortcutHints(opts: {
  exitShortcut: string;
  toggleShortcut: string;
  editorName?: string;
}): string[] {
  const fmt = (chord: string | readonly string[], action: string): string => {
    const painted = formatShortcutString(chord, TRANSCRIPT_SHORTCUTS_FORMAT);
    return painted ? `${painted} to ${action}` : '';
  };
  return [
    fmt([opts.exitShortcut, opts.toggleShortcut], 'exit'),
    fmt('?', 'close'),
    fmt(['up', 'down', 'j', 'k'], 'scroll'),
    fmt(['ctrl+u', 'ctrl+d'], 'move half a page'),
    fmt(['space', 'b'], 'move a page'),
    fmt(['g', 'shift+g'], 'go to top/bottom'),
    fmt(['{', '}'], 'jump between prompts'),
    fmt('/', 'search'),
    fmt(['n', 'shift+n'], 'cycle matches'),
    fmt('[', 'print to scrollback'),
    fmt('v', `open in ${opts.editorName ?? 'editor'}`),
  ].filter(Boolean);
}

/**
 * Official 2.1.328 `AWt`: pack shortcut hints into columns starting at 3 rows
 * per column, widening row count until all columns fit in `columns`, and cap
 * rows per column in very short windows so exit/close hints stay visible.
 */
export function packTranscriptShortcutColumns(
  hints: readonly string[],
  columns: number,
  rows?: number,
  measure: (s: string) => number = stringWidth,
): string[][] {
  const items = hints.filter(Boolean);
  let cols: string[][] = [];
  for (let rowsPerCol = 3; ; rowsPerCol++) {
    cols = [];
    for (let i = 0; i < items.length; i += rowsPerCol) {
      cols.push(items.slice(i, i + rowsPerCol));
    }
    const totalColWidth = cols.reduce(
      (sum, col) => sum + col.reduce((max, item) => Math.max(max, measure(item)), 0),
      0,
    );
    if (
      2 * TRANSCRIPT_SHORTCUTS_PAD_X + TRANSCRIPT_SHORTCUTS_COL_GAP * (cols.length - 1) + totalColWidth <= columns ||
      cols.length <= 1
    ) {
      break;
    }
  }
  if (rows !== undefined) {
    // Keep at least the first 2 rows (exit + close) visible in short windows.
    const maxRows = Math.max(2, rows - 2);
    cols = cols.map(col => (col.length > maxRows ? col.slice(0, maxRows) : col));
  }
  return cols;
}

/** Official 2.1.328 `Hce`: `?` shortcuts overlay for fullscreen transcript mode. */
export function TranscriptShortcutsHelp(): React.ReactNode {
  const toggleShortcut = useShortcutDisplay('app:toggleTranscript', 'Global', 'ctrl+o');
  const exitShortcut = useShortcutDisplay('transcript:exit', 'Transcript', 'q');
  const { columns, rows } = useTerminalSize();
  const editorName = (() => {
    const editor = getExternalEditor();
    if (!editor) return undefined;
    const base = basename(editor.split(' ')[0] ?? '');
    return base && base.length <= 8 ? base : undefined;
  })();
  const hints = buildTranscriptShortcutHints({ exitShortcut, toggleShortcut, editorName });
  const cols = packTranscriptShortcutColumns(hints, columns, rows);
  return (
    <Box
      noSelect
      borderTopDimColor
      borderBottom={false}
      borderLeft={false}
      borderRight={false}
      borderStyle="single"
      marginTop={1}
      width="100%"
    >
      <Box flexShrink={0} paddingX={TRANSCRIPT_SHORTCUTS_PAD_X} flexDirection="row" gap={TRANSCRIPT_SHORTCUTS_COL_GAP}>
        {cols.map((col, colIdx) => (
          <Box key={colIdx} flexDirection="column">
            {col.map(hint => (
              <Text key={hint} dimColor>
                {hint}
              </Text>
            ))}
          </Box>
        ))}
      </Box>
    </Box>
  );
}

/** less-style / bar. 1-row, same border-top styling as TranscriptModeFooter. */
export function TranscriptSearchBar({
  jumpRef,
  count,
  current,
  onClose,
  onCancel,
  setHighlight,
  initialQuery,
}: {
  jumpRef: RefObject<JumpHandle | null>;
  count: number;
  current: number;
  onClose: (lastQuery: string) => void;
  onCancel: () => void;
  setHighlight: (query: string) => void;
  initialQuery: string;
}): React.ReactNode {
  const { query, cursorOffset, handleKeyDown, handlePaste } = useSearchInput({
    isActive: true,
    initialQuery,
    onExit: () => onClose(query),
    onCancel,
  });
  const [indexStatus, setIndexStatus] = React.useState<'building' | { ms: number } | null>('building');
  React.useEffect(() => {
    let alive = true;
    let hideTimeout: ReturnType<typeof setTimeout> | undefined;
    const warm = jumpRef.current?.warmSearchIndex;
    if (!warm) {
      setIndexStatus(null);
      return;
    }
    setIndexStatus('building');
    warm().then(ms => {
      if (!alive) return;
      if (ms < 20) {
        setIndexStatus(null);
      } else {
        setIndexStatus({ ms });
        hideTimeout = setTimeout(() => alive && setIndexStatus(null), 2000);
      }
    });
    return () => {
      alive = false;
      if (hideTimeout) clearTimeout(hideTimeout);
    };
  }, [jumpRef]);
  const warmDone = indexStatus !== 'building';
  useEffect(() => {
    if (!warmDone) return;
    jumpRef.current?.setSearchQuery(query);
    setHighlight(query);
  }, [jumpRef, query, setHighlight, warmDone]);
  const off = cursorOffset;
  const codePoint = off < query.length ? query.codePointAt(off) : undefined;
  const cursorChar = codePoint !== undefined ? String.fromCodePoint(codePoint) : ' ';
  const afterOffset = codePoint !== undefined ? off + cursorChar.length : off;
  const nativeCursor = useMemo(isNativeCursorEnabled, []);
  const fullRepaint =
    Boolean(process.env.CLAUDE_CODE_ALT_SCREEN_FULL_REPAINT) && process.env.CLAUDE_CODE_SESSION_KIND !== 'bg';
  const showInverseCursor = !(nativeCursor && !fullRepaint);
  const declaredCursor = useDeclaredCursor({
    line: 0,
    column: 0,
    active: true,
    visible: !fullRepaint,
  });
  return (
    <Box
      borderTopDimColor
      borderBottom={false}
      borderLeft={false}
      borderRight={false}
      borderStyle="single"
      marginTop={1}
      paddingLeft={2}
      width="100%"
      noSelect
    >
      <Input autoFocus onKeyDown={handleKeyDown} onPaste={handlePaste} flexDirection="row" flexGrow={1}>
        <Text>/</Text>
        <Text>{query.slice(0, off)}</Text>
        <Box ref={declaredCursor} flexShrink={0}>
          <Text inverse={showInverseCursor}>{cursorChar}</Text>
        </Box>
        {afterOffset < query.length && <Text>{query.slice(afterOffset)}</Text>}
        <Box flexGrow={1} />
        {indexStatus === 'building' ? (
          <Text dimColor>indexing… </Text>
        ) : indexStatus ? (
          <Text dimColor>indexed in {indexStatus.ms}ms </Text>
        ) : count === 0 && query ? (
          <Text color="error">no matches </Text>
        ) : count > 0 ? (
          <Text dimColor>
            {current}/{count}
            {'  '}
          </Text>
        ) : null}
      </Input>
    </Box>
  );
}

// densable 2.1.228 #16: szi=["◐","◑"] (was 227 nUi=["⠂","⠐"]).
const TITLE_ANIMATION_FRAMES = ['◐', '◑'];
const TITLE_STATIC_PREFIX = '✳';
const TITLE_ANIMATION_INTERVAL_MS = 960;

/**
 * Sets the terminal tab title, with an animated prefix glyph while a query
 * is running. Isolated from REPL so the 960ms animation tick re-renders only
 * this leaf component.
 */
export function AnimatedTerminalTitle({
  isAnimating,
  title,
  disabled,
  noPrefix,
}: {
  isAnimating: boolean;
  title: string;
  disabled: boolean;
  noPrefix: boolean;
}): null {
  const terminalFocused = useTerminalFocus();
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (!isAnimating) {
      setFrame(0);
      return;
    }
    if (disabled || noPrefix || !terminalFocused) return;
    const interval = setInterval(
      setFrame => setFrame(f => (f + 1) % TITLE_ANIMATION_FRAMES.length),
      TITLE_ANIMATION_INTERVAL_MS,
      setFrame,
    );
    return () => clearInterval(interval);
  }, [disabled, noPrefix, isAnimating, terminalFocused]);
  // Idle / waiting: densable static ✳. Never leave a busy ◐/◑ frozen in the tab.
  const prefix = isAnimating ? (TITLE_ANIMATION_FRAMES[frame] ?? TITLE_STATIC_PREFIX) : TITLE_STATIC_PREFIX;
  useTerminalTitle(disabled ? null : noPrefix ? title : `${prefix} ${title}`);
  return null;
}

export type TranscriptViewProps = {
  disableVirtualScroll: boolean;
  dumpMode: boolean;
  scrollPin: ScrollPin;
  messagesSource: MessagesSource;
  staticAgentMessages: readonly MessageType[] | null;
  transcriptMessages: MessageType[];
  messages: MessageType[];
  tools: Tools;
  commands: Command[];
  toolJSX: ToolJSXState | null;
  focusedInProgressToolUseIDs: Set<string>;
  focusedConversationId: string;
  screen: Screen;
  agentDefinitions: AppState['agentDefinitions'];
  viewedAgentTask: InProcessTeammateTaskState | LocalAgentTaskState | undefined;
  focusedStreamingToolUses: StreamingToolUse[];
  transcriptStreamingToolUses: StreamingToolUse[];
  showStreamingText: boolean;
  isLoading: boolean;
  hasStreamingText: boolean;
  focusFoldHoldsPreview: boolean;
  streamingDisplayStore: StreamingDisplayStore;
  showAllInTranscript: boolean;
  handleOpenRateLimitOptions: () => void;
  focusedIsLoading: boolean;
  jumpRef: RefObject<JumpHandle | null>;
  onSearchMatchesChange: (count: number, current: number) => void;
  scanElement: React.ComponentProps<typeof Messages>['scanElement'];
  setPositions: React.ComponentProps<typeof Messages>['setPositions'];
  titleIsAnimating: boolean;
  terminalTitle: string;
  titleDisabled: boolean;
  showStatusInTerminalTab: boolean;
  globalKeybindingProps: React.ComponentProps<typeof GlobalKeybindingHandlers>;
  voice: Pick<
    ReturnType<typeof import('../../hooks/useVoiceIntegration.js').useVoiceIntegration>,
    'handleKeyEvent' | 'stripTrailing' | 'resetAnchor'
  >;
  onSubmit: React.ComponentProps<typeof CommandKeybindingHandlers>['onSubmit'];
  cancelRequestProps: React.ComponentProps<typeof CancelRequestHandler>;
  searchOpen: boolean;
  setSearchOpen: React.Dispatch<React.SetStateAction<boolean>>;
  searchQuery: string;
  setSearchQuery: React.Dispatch<React.SetStateAction<string>>;
  searchCount: number;
  setSearchCount: React.Dispatch<React.SetStateAction<number>>;
  searchCurrent: number;
  setSearchCurrent: React.Dispatch<React.SetStateAction<number>>;
  setHighlight: (query: string) => void;
  transcriptHelpOpen: boolean;
  editorStatus: string;
  hasActivePrompt: boolean;
};

export function TranscriptView({
  disableVirtualScroll,
  dumpMode,
  scrollPin,
  messagesSource,
  staticAgentMessages,
  transcriptMessages,
  messages,
  tools,
  commands,
  toolJSX,
  focusedInProgressToolUseIDs,
  focusedConversationId,
  screen,
  agentDefinitions,
  viewedAgentTask,
  focusedStreamingToolUses,
  transcriptStreamingToolUses,
  showStreamingText,
  isLoading,
  hasStreamingText,
  focusFoldHoldsPreview,
  streamingDisplayStore,
  showAllInTranscript,
  handleOpenRateLimitOptions,
  focusedIsLoading,
  jumpRef,
  onSearchMatchesChange,
  scanElement,
  setPositions,
  titleIsAnimating,
  terminalTitle,
  titleDisabled,
  showStatusInTerminalTab,
  globalKeybindingProps,
  voice,
  onSubmit,
  cancelRequestProps,
  searchOpen,
  setSearchOpen,
  searchQuery,
  setSearchQuery,
  searchCount,
  setSearchCount,
  searchCurrent,
  setSearchCurrent,
  setHighlight,
  transcriptHelpOpen,
  editorStatus,
  hasActivePrompt,
}: TranscriptViewProps): React.ReactNode {
  const scrollViewport = scrollPin.viewport;
  const transcriptScrollViewport =
    isFullscreenEnvEnabled() && !disableVirtualScroll && !dumpMode ? scrollViewport : undefined;
  const transcriptMessagesElement = (
    <Messages
      source={transcriptScrollViewport ? messagesSource : undefined}
      messages={transcriptScrollViewport ? undefined : (staticAgentMessages ?? transcriptMessages)}
      tools={tools}
      commands={commands}
      verbose={true}
      toolJSX={null}
      inProgressToolUseIDs={focusedInProgressToolUseIDs}
      isMessageSelectorVisible={false}
      conversationId={focusedConversationId}
      screen={screen}
      agentDefinitions={agentDefinitions}
      streamingToolUses={
        viewedAgentTask
          ? EMPTY_STREAMING_TOOL_USES
          : transcriptScrollViewport
            ? focusedStreamingToolUses
            : transcriptStreamingToolUses
      }
      showStreamingText={showStreamingText}
      hasStreamingText={isLoading && !viewedAgentTask && hasStreamingText && !focusFoldHoldsPreview}
      streamingDisplayStore={streamingDisplayStore}
      showAllInTranscript={showAllInTranscript}
      onOpenRateLimitOptions={handleOpenRateLimitOptions}
      hideLogo={!!viewedAgentTask}
      isLoading={focusedIsLoading}
      hidePastThinking={true}
      scrollViewport={transcriptScrollViewport}
      jumpRef={jumpRef}
      revealRef={scrollPin.revealRef}
      onSearchMatchesChange={onSearchMatchesChange}
      scanElement={scanElement}
      setPositions={setPositions}
      disableRenderCap={dumpMode}
    />
  );
  const transcriptToolJSX = toolJSX && (
    <Box flexDirection="column" width="100%">
      {toolJSX.isLocalJSXCommand ? (
        <MenuWaitContext.Provider value={true}>{toolJSX.jsx}</MenuWaitContext.Provider>
      ) : (
        toolJSX.jsx
      )}
    </Box>
  );
  const transcriptReturn = (
    <KeybindingSetup>
      <AnimatedTerminalTitle
        isAnimating={titleIsAnimating}
        title={terminalTitle}
        disabled={titleDisabled}
        noPrefix={showStatusInTerminalTab}
      />
      <GlobalKeybindingHandlers {...globalKeybindingProps} />
      {feature('VOICE_MODE') ? (
        <VoiceKeybindingHandler
          voiceHandleKeyEvent={voice.handleKeyEvent}
          stripTrailing={voice.stripTrailing}
          resetAnchor={voice.resetAnchor}
          isActive={!toolJSX?.isLocalJSXCommand}
        />
      ) : null}
      <CommandKeybindingHandlers onSubmit={onSubmit} isActive={!toolJSX?.isLocalJSXCommand} />
      {transcriptScrollViewport ? (
        <ScrollKeybindingHandler
          scrollViewport={scrollViewport}
          isActive={true}
          isModal={!searchOpen}
          onScroll={() => jumpRef.current?.disarmSearch()}
        />
      ) : null}
      <CancelRequestHandler {...cancelRequestProps} />
      {transcriptScrollViewport ? (
        <FullscreenLayout
          scrollViewport={scrollViewport}
          onPillClick={() => {
            scrollViewport.handle?.scrollToBottom();
          }}
          scrollable={
            <>
              {transcriptMessagesElement}
              <WaitingTranscriptMessages
                task={viewedAgentTask}
                messages={staticAgentMessages ?? messages}
                isLoading={focusedIsLoading}
              />
              {transcriptToolJSX}
              <SandboxViolationExpandedView />
            </>
          }
          bottom={
            searchOpen ? (
              <TranscriptSearchBar
                jumpRef={jumpRef}
                initialQuery=""
                count={searchCount}
                current={searchCurrent}
                onClose={q => {
                  setSearchQuery(searchCount > 0 ? q : '');
                  setSearchOpen(false);
                  if (!q) {
                    setSearchCount(0);
                    setSearchCurrent(0);
                    jumpRef.current?.setSearchQuery('');
                  }
                }}
                onCancel={() => {
                  setSearchOpen(false);
                  jumpRef.current?.setSearchQuery('');
                  jumpRef.current?.setSearchQuery(searchQuery);
                  setHighlight(searchQuery);
                }}
                setHighlight={setHighlight}
              />
            ) : transcriptHelpOpen ? (
              <TranscriptShortcutsHelp />
            ) : (
              <TranscriptModeFooter
                showAllInTranscript={showAllInTranscript}
                virtualScroll={true}
                status={editorStatus || undefined}
                isWorking={isLoading}
                hasDialogWaiting={hasActivePrompt}
                searchBadge={
                  searchQuery && searchCount > 0 ? { current: searchCurrent, count: searchCount } : undefined
                }
              />
            )
          }
        />
      ) : (
        <>
          {transcriptMessagesElement}
          <WaitingTranscriptMessages
            task={viewedAgentTask}
            messages={staticAgentMessages ?? transcriptMessages}
            isLoading={focusedIsLoading}
          />
          {transcriptToolJSX}
          <SandboxViolationExpandedView />
          <TranscriptModeFooter
            showAllInTranscript={showAllInTranscript}
            virtualScroll={false}
            suppressShowAll={dumpMode}
            status={editorStatus || undefined}
            isWorking={isLoading}
            hasDialogWaiting={hasActivePrompt}
          />
        </>
      )}
    </KeybindingSetup>
  );
  if (transcriptScrollViewport) {
    return <AlternateScreen mouseTracking={mouseTrackingProp()}>{transcriptReturn}</AlternateScreen>;
  }
  return transcriptReturn;
}
