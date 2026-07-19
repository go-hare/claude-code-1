import { feature } from 'bun:bundle';
import * as React from 'react';
import { useCallback, useState } from 'react';
import { useDoublePress } from '../hooks/useDoublePress.js';
import { Box, Text } from '@anthropic/ink';
import { useTaskBackgroundKeybinding } from '../keybindings/useTaskBackgroundKeybinding.js';
import { useAppState, useAppStateStore, useSetAppState } from '../state/AppState.js';
import { backgroundAll, hasForegroundTasks } from '../tasks/LocalShellTask/LocalShellTask.js';
import { getGlobalConfig, saveGlobalConfig } from '../utils/config.js';
import { isBgSession } from '../utils/concurrentSessions.js';
import { isEnvTruthy } from '../utils/envUtils.js';
import { isBackgroundTasksDisabled } from '../utils/residualFinalEnvGates.js';
import { KeyboardShortcutHint } from '@anthropic/ink';

type Props = {
  onBackgroundSession: () => void;
  isLoading: boolean;
};

/**
 * Shows a hint when user presses Ctrl+B to background the current session.
 * Uses double-press pattern: first press shows hint, second press within 800ms backgrounds.
 *
 * Only activates when:
 * 1. isLoading is true (a query is in progress)
 * 2. No foreground tasks (bash/agent) are running (those take priority for Ctrl+B)
 *
 * densable tpr: cohesion gate may hide the hint when the shortcut is unbound,
 * and prefers ctrl+x ctrl+b display when defaults are intact.
 */
export function SessionBackgroundHint({ onBackgroundSession, isLoading }: Props): React.ReactElement | null {
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
  const hasForeground = useAppState(hasForegroundTasks);
  const { cohesionFixes, displayShortcut } = useTaskBackgroundKeybinding({
    handler: handleBackground,
    isActive: hasForeground || (sessionBgEnabled && isLoading),
  });

  // densable: hide when cohesion on and shortcut unbound (empty display)
  if (!isLoading || !showSessionHint || (cohesionFixes && displayShortcut === '')) {
    return null;
  }

  return (
    <Box paddingLeft={2}>
      <Text dimColor>
        <KeyboardShortcutHint shortcut={displayShortcut} action="background" />
      </Text>
    </Box>
  );
}
