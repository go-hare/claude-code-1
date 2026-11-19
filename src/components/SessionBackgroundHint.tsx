import { feature } from 'bun:bundle';
import * as React from 'react';
import { useCallback, useState } from 'react';
import { useDoublePress } from '../hooks/useDoublePress.js';
import { Box, Text } from '@anthropic/ink';
import { useKeybinding } from '../keybindings/useKeybinding.js';
import { useShortcutDisplay } from '../keybindings/useShortcutDisplay.js';
import { useAppState, useAppStateStore, useSetAppState } from '../state/AppState.js';
import { backgroundAll, hasForegroundTasks } from '../tasks/LocalShellTask/LocalShellTask.js';
import { getGlobalConfig, saveGlobalConfig } from '../utils/config.js';
import { isBgSession } from '../utils/concurrentSessions.js';
import { env } from '../utils/env.js';
import { isEnvTruthy } from '../utils/envUtils.js';
import { isFullscreenEnvEnabled } from '../utils/fullscreen.js';
import { isBackgroundTasksDisabled } from '../utils/residualFinalEnvGates.js';
import { KeyboardShortcutHint } from '@anthropic/ink';

type Props = {
  onBackgroundSession: () => void;
  isLoading: boolean;
  /** #214 (2.1.326): suppress Ctrl+B backgrounding & hint in fullscreen transcript (Ctrl+B pages up). */
  isTranscriptMode?: boolean;
};

/**
 * Shows a hint when user presses Ctrl+B to background the current session.
 * Uses double-press pattern: first press shows hint, second press within 800ms backgrounds.
 *
 * Only activates when:
 * 1. isLoading is true (a query is in progress)
 * 2. No foreground tasks (bash/agent) are running (those take priority for Ctrl+B)
 */
export function SessionBackgroundHint({
  onBackgroundSession,
  isLoading,
  isTranscriptMode = false,
}: Props): React.ReactElement | null {
  const suppressInFullscreenTranscript = isTranscriptMode && isFullscreenEnvEnabled();
  const setAppState = useSetAppState();
  const appStateStore = useAppStateStore();

  const [showSessionHint, setShowSessionHint] = useState(false);

  // Decompile stub was isEnvTruthy('false'); official gate is BG_SESSIONS
  // + not already backgrounded + adopt not disabled.
  // feature() must stay in if/ternary condition position (bun:bundle).
  const sessionBgEnabled = feature('BG_SESSIONS')
    ? !isBgSession() && !isEnvTruthy(process.env.CLAUDE_DISABLE_ADOPT) && !isBackgroundTasksDisabled()
    : false;

  const handleDoublePress = useDoublePress(
    setShowSessionHint,
    onBackgroundSession,
    () => {}, // First press just shows the hint
  );

  // Handler for task:background - prioritizes foreground tasks, falls back to session backgrounding
  // Skip all background functionality if background tasks are disabled
  const handleBackground = useCallback(() => {
    if (isBackgroundTasksDisabled()) {
      return;
    }
    const state = appStateStore.getState();
    if (hasForegroundTasks(state)) {
      // Existing behavior - background running bash/agent tasks
      backgroundAll(() => appStateStore.getState(), setAppState);
      if (!getGlobalConfig().hasUsedBackgroundTask) {
        saveGlobalConfig(c => (c.hasUsedBackgroundTask ? c : { ...c, hasUsedBackgroundTask: true }));
      }
    } else if (sessionBgEnabled && isLoading) {
      // Official session backgrounding: double-press Ctrl+B while a query
      // is running (gated by BG_SESSIONS + not already a bg session).
      handleDoublePress();
    }
  }, [setAppState, appStateStore, isLoading, handleDoublePress, sessionBgEnabled]);

  // Only eat ctrl+b when there's something to background. Without this gate
  // the binding double-fires with readline backward-char at an idle prompt.
  // #214 (2.1.326): in fullscreen transcript mode, Ctrl+B pages up so do not
  // intercept it or show a Ctrl+B background hint.
  const hasForeground = useAppState(hasForegroundTasks);
  useKeybinding('task:background', handleBackground, {
    context: 'Task',
    isActive: !suppressInFullscreenTranscript && (hasForeground || (sessionBgEnabled && isLoading)),
  });

  // Get the configured shortcut for task:background
  const baseShortcut = useShortcutDisplay('task:background', 'Task', 'ctrl+b');
  // In tmux, ctrl+b is the prefix key, so users need to press it twice to send ctrl+b
  const shortcut = env.terminal === 'tmux' && baseShortcut === 'ctrl+b' ? 'ctrl+b ctrl+b' : baseShortcut;

  if (!isLoading || !showSessionHint || suppressInFullscreenTranscript) {
    return null;
  }

  return (
    <Box paddingLeft={2}>
      <Text dimColor>
        <KeyboardShortcutHint shortcut={shortcut} action="background" />
      </Text>
    </Box>
  );
}
