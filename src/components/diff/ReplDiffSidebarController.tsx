import { useCallback, useEffect } from 'react';
import { useNotifications } from '../../context/notifications.js';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import { useKeybinding } from '../../keybindings/useKeybinding.js';
import { getSessionId } from '../../bootstrap/state.js';
import { useAppState, useSetAppState } from '../../state/AppState.js';
import { isFullscreenEnvEnabled } from '../../utils/fullscreen.js';
import {
  DIFF_SIDEBAR_MIN_COLS,
  DIFF_SIDEBAR_NO_GIT_MESSAGE,
  diffSidebarHasGitRepo,
  getPersistedDiffBaseMode,
  getReplDiffHost,
  logReplDiffPanelShown,
  markReplDiffPanelAutoOpen,
  openReplDiffTabFromAutoOpen,
  shouldAutoOpenDiffSidebar,
  toggleReplDiffTab,
} from '../../utils/replDiffTab.js';
import { fetchGitDiff } from '../../utils/gitDiff.js';
import { ReplDiffPanel } from './ReplDiffPanel.js';
import { type DiffSelectionAttach, hasAutoOpenDiffContent } from '../../utils/replDiffMouseHost.js';

type Props = {
  width: number;
  autoOpenBaseline: number | null;
  /** Official `isThinClient`. Local has no thin-client host — always false. */
  isThinClient?: boolean;
  /** densable LX `onAskAboutSelection`. Optional — no REPL invent. */
  onAskAboutSelection?: (payload: DiffSelectionAttach) => void;
};

/**
 * densable `nhu` — auto-open on tracked-file growth, Global
 * `app:toggleReplTab`, shown telemetry, and the sidebar body when width > 0.
 */
export function ReplDiffSidebarController({
  width,
  autoOpenBaseline,
  isThinClient = false,
  onAskAboutSelection,
}: Props): React.ReactNode {
  const replTab = useAppState(s => s.replTab);
  const trackedFileCount = useAppState(s => s.fileHistory.trackedFiles.size);
  const setAppState = useSetAppState();
  const { columns } = useTerminalSize();
  const { addNotification } = useNotifications();
  const host = getReplDiffHost();
  const sessionId = getSessionId();

  useEffect(() => {
    if (replTab !== 'convo' || trackedFileCount === 0) {
      return;
    }
    if (autoOpenBaseline !== null && trackedFileCount === autoOpenBaseline) {
      return;
    }
    if (!isFullscreenEnvEnabled() || isThinClient) {
      return;
    }
    if (!shouldAutoOpenDiffSidebar(columns)) {
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void fetchGitDiff(getPersistedDiffBaseMode(), controller.signal)
        .then(result => {
          if (controller.signal.aborted) return;
          if (!hasAutoOpenDiffContent(result)) return;
          markReplDiffPanelAutoOpen(host);
          setAppState(openReplDiffTabFromAutoOpen);
        })
        .catch(() => {});
    }, 150);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [autoOpenBaseline, columns, host, isThinClient, replTab, setAppState, trackedFileCount]);

  const handleToggle = useCallback(() => {
    if (replTab !== 'diff') {
      if (!diffSidebarHasGitRepo()) {
        addNotification({
          key: 'diff-sidebar-no-git',
          text: DIFF_SIDEBAR_NO_GIT_MESSAGE,
          priority: 'immediate',
          timeoutMs: 3000,
        });
        return;
      }
      if (columns < DIFF_SIDEBAR_MIN_COLS) {
        addNotification({
          key: 'diff-sidebar-too-narrow',
          text: `Resize your terminal to at least ${DIFF_SIDEBAR_MIN_COLS} columns to show the diff panel`,
          priority: 'immediate',
          timeoutMs: 3000,
        });
        return;
      }
    }
    toggleReplDiffTab(host, setAppState, replTab);
  }, [addNotification, columns, host, replTab, setAppState]);

  useKeybinding('app:toggleReplTab', handleToggle, {
    context: 'Global',
    isActive: isFullscreenEnvEnabled() && !isThinClient,
  });

  const shown = replTab === 'diff' && width > 0;
  useEffect(() => {
    if (shown) {
      logReplDiffPanelShown(host, sessionId, columns);
    }
  }, [columns, host, sessionId, shown]);

  if (!shown) {
    return null;
  }
  // densable LX `minCol: columns - width`
  return (
    <ReplDiffPanel width={width} minCol={Math.max(0, columns - width)} onAskAboutSelection={onAskAboutSelection} />
  );
}
