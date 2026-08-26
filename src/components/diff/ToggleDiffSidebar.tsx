import { useEffect, useRef } from 'react';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import { useAppState, useSetAppState } from '../../state/AppState.js';
import type { LocalJSXCommandOnDone } from '../../types/command.js';
import {
  DIFF_PANEL_UNAVAILABLE_MESSAGE,
  DIFF_SIDEBAR_MIN_COLS,
  DIFF_SIDEBAR_NO_GIT_MESSAGE,
  diffSidebarHasGitRepo,
  getReplDiffHost,
  toggleReplDiffTab,
} from '../../utils/replDiffTab.js';
import { isWillowCrateEnabled } from '../../utils/willowCrate.js';

type Props = {
  onDone: LocalJSXCommandOnDone;
};

/**
 * densable `h0c` — null local-jsx that one-shot toggles the REPL diff tab.
 * Opening refuses when GB is off, cwd is not a git repo, or the terminal
 * is narrower than 110 columns. Closing skips those checks.
 */
export function ToggleDiffSidebar({ onDone }: Props): null {
  const replTab = useAppState(s => s.replTab);
  const setAppState = useSetAppState();
  const { columns } = useTerminalSize();
  const host = getReplDiffHost();
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) {
      return;
    }
    ran.current = true;
    if (replTab !== 'diff') {
      if (!isWillowCrateEnabled()) {
        onDone(DIFF_PANEL_UNAVAILABLE_MESSAGE, { display: 'system' });
        return;
      }
      if (!diffSidebarHasGitRepo()) {
        onDone(DIFF_SIDEBAR_NO_GIT_MESSAGE, { display: 'system' });
        return;
      }
      if (columns < DIFF_SIDEBAR_MIN_COLS) {
        onDone(`Resize your terminal to at least ${DIFF_SIDEBAR_MIN_COLS} columns to show the diff panel`, {
          display: 'system',
        });
        return;
      }
    }
    toggleReplDiffTab(host, setAppState, replTab);
    onDone(undefined, { display: 'skip' });
  }, [columns, host, onDone, replTab, setAppState]);

  return null;
}
