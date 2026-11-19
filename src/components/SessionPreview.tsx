import type { UUID } from 'crypto';
import React, { useCallback, useRef } from 'react';
import {
  Box,
  Byline,
  KeyboardShortcutHint,
  LoadingState,
  ScrollBox,
  type ScrollBoxHandle,
  Text,
  useInput,
  type WheelEvent,
} from '@anthropic/ink';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import { useKeybinding } from '../keybindings/useKeybinding.js';
import { getAllBaseTools } from '../tools.js';
import type { LogOption } from '../types/logs.js';
import { formatRelativeTimeAgo } from '../utils/format.js';
import { isFullscreenActive } from '../utils/fullscreen.js';
import { getSessionIdFromLog, isLiteLog, loadFullLog } from '../utils/sessionStorage.js';
import { ConfigurableShortcutHint } from './ConfigurableShortcutHint.js';
import { LogoV2 } from './LogoV2/LogoV2.js';
import { Messages } from './Messages.js';

type Props = {
  log: LogOption;
  onExit: () => void;
  onSelect: (log: LogOption) => void;
};

export function SessionPreview({ log, onExit, onSelect }: Props): React.ReactNode {
  // fullLog holds the complete log with messages loaded.
  // The input `log` may be a "lite log" (empty messages array),
  // so we load the full messages on mount and store them here.
  const [fullLog, setFullLog] = React.useState<LogOption | null>(null);
  const scrollRef = useRef<ScrollBoxHandle | null>(null);
  const { rows } = useTerminalSize();
  const fullscreen = isFullscreenActive();

  // Load full messages if this is a lite log
  React.useEffect(() => {
    setFullLog(null);
    if (isLiteLog(log)) {
      void loadFullLog(log).then(setFullLog);
    }
  }, [log]);

  const isLoading = isLiteLog(log) && fullLog === null;
  const displayLog = fullLog ?? log;
  const conversationId = getSessionIdFromLog(displayLog) || ('' as UUID);

  // Get all base tools for preview (no permissions needed for read-only view)
  const tools = getAllBaseTools();

  // Handle keyboard input via keybindings
  useKeybinding('confirm:no', onExit, { context: 'Confirmation' });

  const handleSelect = useCallback(() => {
    onSelect(fullLog ?? log);
  }, [onSelect, fullLog, log]);

  useKeybinding('confirm:yes', handleSelect, { context: 'Confirmation' });

  // Official 2.1.326 #207: allow scrolling /resume preview in fullscreen mode.
  const pageStep = Math.max(1, Math.floor((rows - 4) / 2));
  useInput(
    (_input, key) => {
      const box = scrollRef.current;
      if (!box) return;
      if (key.upArrow) {
        box.scrollBy(-1);
      } else if (key.downArrow) {
        box.scrollBy(1);
      } else if (key.pageUp) {
        box.scrollBy(-pageStep);
      } else if (key.pageDown) {
        box.scrollBy(pageStep);
      } else if (key.home) {
        box.scrollTo(0);
      } else if (key.end) {
        box.scrollToBottom();
      }
    },
    { isActive: fullscreen && !isLoading },
  );

  const handleWheel = useCallback((event: WheelEvent) => {
    if (event.deltaY === 0) return;
    scrollRef.current?.scrollBy(event.deltaY > 0 ? 3 : -3);
    event.stopImmediatePropagation();
  }, []);

  // Show loading state while fetching full log
  if (isLoading) {
    return (
      <Box flexDirection="column" padding={1}>
        <LoadingState message="Loading session…" />
        <Text dimColor>
          <Byline>
            <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="cancel" />
          </Byline>
        </Text>
      </Box>
    );
  }

  const messagesNode = (
    <Messages
      messages={displayLog.messages}
      tools={tools}
      commands={[]}
      verbose={true}
      toolJSX={null}
      inProgressToolUseIDs={new Set()}
      isMessageSelectorVisible={false}
      conversationId={conversationId}
      screen="transcript"
      streamingToolUses={[]}
      showAllInTranscript={true}
      isLoading={false}
    />
  );

  return (
    <Box flexDirection="column" height={fullscreen ? rows : undefined}>
      {fullscreen ? (
        <Box flexDirection="column" flexGrow={1} onWheel={handleWheel}>
          <ScrollBox ref={scrollRef} flexDirection="column" flexGrow={1} stickyScroll>
            <LogoV2 />
            {messagesNode}
          </ScrollBox>
        </Box>
      ) : (
        <>
          <LogoV2 />
          {messagesNode}
        </>
      )}
      <Box
        flexShrink={0}
        flexDirection="column"
        borderTopDimColor
        borderBottom={false}
        borderLeft={false}
        borderRight={false}
        borderStyle="single"
        paddingLeft={2}
      >
        <Text>
          {formatRelativeTimeAgo(displayLog.modified)} · {displayLog.messageCount} messages
          {displayLog.gitBranch ? ` · ${displayLog.gitBranch}` : ''}
        </Text>
        <Text dimColor>
          <Byline>
            {fullscreen && <KeyboardShortcutHint shortcut="↑/↓" action="scroll" />}
            <KeyboardShortcutHint shortcut="Enter" action="resume" />
            <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="go back" />
          </Byline>
        </Text>
      </Box>
    </Box>
  );
}
