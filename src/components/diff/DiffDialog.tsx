import type { StructuredPatchHunk } from 'diff';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { CommandResultDisplay } from '../../commands.js';
import { useRegisterOverlay } from '../../context/overlayContext.js';
import { type DiffData, useDiffData } from '../../hooks/useDiffData.js';
import { type TurnDiff, useTurnDiffs } from '../../hooks/useTurnDiffs.js';
import {
  Box,
  Byline,
  Dialog,
  KeyboardShortcutHint,
  LoadingState,
  Tab,
  Tabs,
  Text,
  useModalScrollRef,
} from '@anthropic/ink';
import { useKeybindings } from '../../keybindings/useKeybinding.js';
import { useAppState } from '../../state/AppState.js';
import type { Message } from '../../types/message.js';
import { plural } from '../../utils/stringUtils.js';
import { ConfigurableShortcutHint } from '../ConfigurableShortcutHint.js';
import { DiffDetailView } from './DiffDetailView.js';
import { DiffFileList } from './DiffFileList.js';

type Props = {
  messages: Message[];
  onDone: (result?: string, options?: { display?: CommandResultDisplay }) => void;
};

type ViewMode = 'list' | 'detail';

type DiffSource = { type: 'current' } | { type: 'turn'; turn: TurnDiff };

function turnDiffToDiffData(turn: TurnDiff): DiffData {
  const files = Array.from(turn.files.values())
    .map(f => ({
      path: f.filePath,
      linesAdded: f.linesAdded,
      linesRemoved: f.linesRemoved,
      isBinary: false,
      isLargeFile: false,
      isTruncated: false,
      isNewFile: f.isNewFile,
    }))
    .sort((a, b) => a.path.localeCompare(b.path));

  const hunks = new Map<string, StructuredPatchHunk[]>();
  for (const f of turn.files.values()) {
    hunks.set(f.filePath, f.hunks);
  }

  return {
    stats: {
      filesCount: turn.stats.filesChanged,
      linesAdded: turn.stats.linesAdded,
      linesRemoved: turn.stats.linesRemoved,
    },
    files,
    hunks,
    loading: false,
    source: { kind: 'working-tree' },
    baseMode: 'auto',
  };
}

export function DiffDialog({ messages, onDone }: Props): React.ReactNode {
  const revision = useAppState(s => s.fileHistory.snapshotSequence);
  const gitDiffData = useDiffData('uncommitted', revision);
  const turnDiffs = useTurnDiffs(messages);

  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [sourceIndex, setSourceIndex] = useState<number>(0);
  const [selection, setSelection] = useState<{ source: number; index: number; mount: number }>({
    source: 0,
    index: 0,
    mount: 0,
  });

  const selectedIndex = selection.source === sourceIndex ? selection.index : 0;

  const sources: DiffSource[] = useMemo(
    () => [{ type: 'current' }, ...turnDiffs.map((turn): DiffSource => ({ type: 'turn', turn }))],
    [turnDiffs],
  );

  const currentSource = sources[sourceIndex];
  const currentTurn = currentSource?.type === 'turn' ? currentSource.turn : null;

  const diffData = useMemo((): DiffData => {
    return currentTurn ? turnDiffToDiffData(currentTurn) : gitDiffData;
  }, [currentTurn, gitDiffData]);

  const selectedFile = diffData.files[selectedIndex];
  const selectedHunks = useMemo(() => {
    return selectedFile ? diffData.hunks.get(selectedFile.path) || [] : [];
  }, [selectedFile, diffData.hunks]);

  // Clamp sourceIndex when sources shrink (e.g., conversation rewind)
  useEffect(() => {
    if (sourceIndex >= sources.length) {
      setSourceIndex(Math.max(0, sources.length - 1));
    }
  }, [sources.length, sourceIndex]);

  useRegisterOverlay('diff-dialog');
  const modalScrollRef = useModalScrollRef();

  const scrollDetail = useCallback(
    (
      dir: 'up' | 'down' | 'pageUp' | 'pageDown' | 'fullPageUp' | 'fullPageDown' | 'top' | 'bottom',
    ): false | undefined => {
      const handle = modalScrollRef?.current;
      if (viewMode !== 'detail' || !handle) {
        return false;
      }
      const halfPage = Math.max(1, Math.floor(handle.getViewportHeight() / 2));
      const fullPage = Math.max(1, handle.getViewportHeight());
      switch (dir) {
        case 'up':
          handle.scrollBy(-1);
          break;
        case 'down':
          handle.scrollBy(1);
          break;
        case 'pageUp':
          handle.scrollBy(-halfPage);
          break;
        case 'pageDown':
          handle.scrollBy(halfPage);
          break;
        case 'fullPageUp':
          handle.scrollBy(-fullPage);
          break;
        case 'fullPageDown':
          handle.scrollBy(fullPage);
          break;
        case 'top':
          handle.scrollTo(0);
          break;
        case 'bottom':
          handle.scrollToBottom();
          break;
      }
    },
    [modalScrollRef, viewMode],
  );

  useKeybindings(
    {
      'diff:previousSource': () => {
        if (viewMode === 'list' && sources.length > 1) {
          setSourceIndex(prev => (prev - 1 + sources.length) % sources.length);
        }
      },
      'diff:nextSource': () => {
        if (viewMode === 'list' && sources.length > 1) {
          setSourceIndex(prev => (prev + 1) % sources.length);
        }
      },
      'diff:back': () => {
        if (viewMode === 'detail') {
          setViewMode('list');
        }
      },
      'diff:viewDetails': () => {
        if (viewMode === 'list' && selectedFile) {
          setViewMode('detail');
          return;
        }
        return false;
      },
      'diff:previousFile': () => scrollDetail('up'),
      'diff:nextFile': () => scrollDetail('down'),
    },
    { context: 'DiffDialog' },
  );

  useKeybindings(
    {
      'scroll:pageUp': () => scrollDetail('pageUp'),
      'scroll:pageDown': () => scrollDetail('pageDown'),
      'scroll:top': () => scrollDetail('top'),
      'scroll:bottom': () => scrollDetail('bottom'),
    },
    { context: 'Scroll', isActive: viewMode === 'detail' },
  );

  const subtitle = diffData.stats ? (
    <Text dimColor>
      {diffData.stats.filesCount} {plural(diffData.stats.filesCount, 'file')} changed
      {diffData.stats.linesAdded > 0 && <Text color="diffAddedWord"> +{diffData.stats.linesAdded}</Text>}
      {diffData.stats.linesRemoved > 0 && <Text color="diffRemovedWord"> -{diffData.stats.linesRemoved}</Text>}
    </Text>
  ) : null;

  const noCommits = !currentTurn && diffData.noCommits === true;
  const isBranch = !currentTurn && diffData.source.kind === 'branch';
  const headerTitle = currentTurn
    ? `Turn ${currentTurn.turnIndex}`
    : noCommits
      ? 'Staged and new files'
      : isBranch
        ? 'Branch changes'
        : 'Uncommitted changes';
  const headerSubtitle = currentTurn
    ? currentTurn.userPromptPreview
      ? `"${currentTurn.userPromptPreview}"`
      : ''
    : noCommits
      ? '(no commits yet)'
      : diffData.source.kind === 'branch'
        ? `(vs ${diffData.source.baseBranch})`
        : '(git diff HEAD)';

  const emptyMessage = (() => {
    if (currentTurn) {
      return 'No file changes in this turn';
    }
    if (diffData.stats && diffData.stats.filesCount > 0 && diffData.files.length === 0) {
      return 'Too many files to display details';
    }
    return 'No changes yet';
  })();

  const title = (
    <Text>
      {headerTitle}
      {headerSubtitle && <Text dimColor> {headerSubtitle}</Text>}
    </Text>
  );

  function handleCancel(): void {
    if (viewMode === 'detail') {
      setViewMode('list');
    } else {
      onDone('Diff dialog dismissed', { display: 'system' });
    }
  }

  const tabBody = (
    <Box flexDirection="column" gap={1}>
      {subtitle}
      {diffData.files.length === 0 ? (
        diffData.loading ? (
          <LoadingState message="Loading diff…" dimColor />
        ) : (
          <Text dimColor>{emptyMessage}</Text>
        )
      ) : viewMode === 'list' ? (
        <Box flexDirection="column">
          <DiffFileList
            key={`${sourceIndex}:${selection.mount}`}
            files={diffData.files}
            defaultFocusIndex={selectedIndex}
            onFocus={index => setSelection(prev => ({ ...prev, source: sourceIndex, index }))}
            onSelect={() => setViewMode('detail')}
          />
        </Box>
      ) : (
        <Box flexDirection="column">
          <DiffDetailView
            filePath={selectedFile?.path || ''}
            hunks={selectedHunks}
            isLargeFile={selectedFile?.isLargeFile}
            isBinary={selectedFile?.isBinary}
            isTruncated={selectedFile?.isTruncated}
            isUntracked={selectedFile?.isUntracked}
          />
        </Box>
      )}
    </Box>
  );

  const inputGuide =
    viewMode === 'list' ? (
      <Byline>
        {sources.length > 1 && <KeyboardShortcutHint shortcut="←/→" action="switch source" />}
        <KeyboardShortcutHint shortcut="↑/↓" action="select" />
        <KeyboardShortcutHint shortcut="enter" action="view" />
        <ConfigurableShortcutHint action="diff:dismiss" context="DiffDialog" fallback="Esc" description="close" />
      </Byline>
    ) : (
      <Byline>
        <KeyboardShortcutHint shortcut="↑/↓" action="scroll" />
        <ConfigurableShortcutHint action="diff:dismiss" context="DiffDialog" fallback="Esc" description="back" />
      </Byline>
    );

  return (
    <Dialog title={title} onCancel={handleCancel} color="background" inputGuide={inputGuide}>
      <Tabs
        hidden={sources.length <= 1}
        selectedTab={String(sourceIndex)}
        onTabChange={tabId => setSourceIndex(Number(tabId))}
        disableNavigation={viewMode === 'detail'}
      >
        {sources.map((source, index) => (
          <Tab
            key={index}
            id={String(index)}
            title={source.type === 'current' ? 'Current' : `T${source.turn.turnIndex}`}
          >
            {tabBody}
          </Tab>
        ))}
      </Tabs>
    </Dialog>
  );
}
