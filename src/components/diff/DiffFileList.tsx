import React, { useMemo, useState } from 'react';
import { Box, stringWidth, Text, useModalOrTerminalSize, useTerminalSize } from '@anthropic/ink';
import type { DiffFile } from '../../hooks/useDiffData.js';
import { truncateStartToWidth } from '../../utils/format.js';
import { ItemList } from '../ItemList.js';
import { flattenDiffFilename } from './DiffDetailView.js';

const VISIBLE_FILE_COUNT = 7;

type Props = {
  files: DiffFile[];
  defaultFocusIndex?: number;
  selectedIndex?: number;
  onFocus?: (index: number) => void;
  onSelect?: (index: number) => void;
};

function getFileStatsTextLength(file: DiffFile): number {
  if (file.isUntracked) return 'untracked'.length;
  if (file.isBinary) return 'Binary file'.length;
  if (file.isLargeFile) return 'Large file modified'.length;
  const parts: string[] = [];
  if (file.linesAdded > 0) parts.push(`+${file.linesAdded}`);
  if (file.linesRemoved > 0) parts.push(`-${file.linesRemoved}`);
  let len = parts.join(' ').length;
  if (file.isTruncated) len += ' (truncated)'.length;
  return len;
}

export function DiffFileList({ files, defaultFocusIndex, selectedIndex, onFocus, onSelect }: Props): React.ReactNode {
  const terminalSize = useTerminalSize();
  const { columns } = useModalOrTerminalSize(terminalSize);
  const initialFocus = defaultFocusIndex ?? selectedIndex ?? 0;
  const [focusedIndex, setFocusedIndex] = useState(initialFocus);

  const rowWidth = Math.max(28, columns - 6);

  const options = useMemo(
    () =>
      files.map((file, index) => {
        const isSelected = index === focusedIndex;
        const cleanedPath = flattenDiffFilename(file.path);
        const statsWidth = getFileStatsTextLength(file);
        const maxPathWidth = Math.max(20, rowWidth - statsWidth - 2);
        const displayPath = truncateStartToWidth(cleanedPath, maxPathWidth);
        const gapWidth = Math.max(1, rowWidth - stringWidth(displayPath) - statsWidth);

        return {
          value: file.path,
          label: (
            <>
              {displayPath}
              {' '.repeat(gapWidth)}
              <FileStats file={file} isSelected={isSelected} />
            </>
          ),
        };
      }),
    [files, focusedIndex, rowWidth],
  );

  if (files.length === 0) {
    return <Text dimColor>No changed files</Text>;
  }

  return (
    <ItemList
      options={options}
      visibleOptionCount={VISIBLE_FILE_COUNT}
      defaultFocusIndex={initialFocus}
      onFocus={index => {
        setFocusedIndex(index);
        onFocus?.(index);
      }}
      onSelect={onSelect}
      onUpFromFirst={() => {}}
    />
  );
}

function FileStats({ file, isSelected }: { file: DiffFile; isSelected: boolean }): React.ReactNode {
  if (file.isUntracked) {
    return (
      <Text color="text" dimColor={!isSelected} italic>
        untracked
      </Text>
    );
  }
  if (file.isBinary) {
    return (
      <Text color="text" dimColor={!isSelected} italic>
        Binary file
      </Text>
    );
  }
  if (file.isLargeFile) {
    return (
      <Text color="text" dimColor={!isSelected} italic>
        Large file modified
      </Text>
    );
  }
  return (
    <Text color="text">
      {file.linesAdded > 0 && (
        <Text color="diffAddedWord" bold={isSelected}>
          +{file.linesAdded}
        </Text>
      )}
      {file.linesAdded > 0 && file.linesRemoved > 0 && ' '}
      {file.linesRemoved > 0 && (
        <Text color="diffRemovedWord" bold={isSelected}>
          -{file.linesRemoved}
        </Text>
      )}
      {file.isTruncated && (
        <Text color="text" dimColor={!isSelected}>
          {' '}
          (truncated)
        </Text>
      )}
    </Text>
  );
}
