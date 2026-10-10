import type { StructuredPatchHunk } from 'diff';
import { resolve } from 'path';
import React, { useMemo } from 'react';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import { Box, Text } from '@anthropic/ink';
import { getCwd } from '../../utils/cwd.js';
import { readFileSafe } from '../../utils/file.js';
import { Divider } from '@anthropic/ink';
import { isScreenReaderModeEnabled } from '../../utils/screenReaderGate.js';
import { StructuredDiff } from '../StructuredDiff.js';
import { sanitizeInvisibleText } from '../../utils/plugins/escapeSafeText.js';
import stripAnsi from 'strip-ansi';

/**
 * densable `vge` — `Cpe(tn(h)).text.replace(/[\t\n]+/g," ")`.
 * `tn` analog is `strip-ansi` (gold `Bun.stripANSI`); `Cpe` analog is
 * `sanitizeInvisibleText` (bidi/zero-width). Flatten tab/newline first so
 * expand-tabs cannot swallow `\t`. Disk reads still use the raw `filePath`.
 * Do not export minify `vge`.
 */
export function flattenDiffFilename(filePath: string): string {
  const flattened = filePath.replace(/[\t\n]+/g, ' ');
  return sanitizeInvisibleText(stripAnsi(flattened), '');
}

type Props = {
  filePath: string;
  hunks: StructuredPatchHunk[];
  isLargeFile?: boolean;
  isBinary?: boolean;
  isTruncated?: boolean;
  isUntracked?: boolean;
  isRestricted?: boolean;
  width?: number;
};

/**
 * Displays the diff content for a single file.
 * Uses StructuredDiff for word-level diffing and syntax highlighting.
 * No scrolling - renders all lines (max 400 due to parsing limits).
 */
export function DiffDetailView({
  filePath,
  hunks,
  isLargeFile,
  isBinary,
  isTruncated,
  isUntracked,
  isRestricted,
  width,
}: Props): React.ReactNode {
  const { columns } = useTerminalSize();
  const screenReader = isScreenReaderModeEnabled();
  const viewWidth = width ?? columns - 4;
  const paintedPath = flattenDiffFilename(filePath);

  // Read file content for syntax detection and multiline construct handling.
  // Only computed when this component is rendered (detail view mode).
  const { firstLine, fileContent } = useMemo(() => {
    // densable sPe: skip read for empty/binary/large/untracked/restricted/ax.
    if (!filePath || isBinary || isLargeFile || isUntracked || isRestricted || screenReader) {
      return { firstLine: null, fileContent: undefined };
    }
    const fullPath = resolve(getCwd(), filePath);
    const content = readFileSafe(fullPath);
    return {
      firstLine: content?.split('\n')[0] ?? null,
      fileContent: content ?? undefined,
    };
  }, [filePath, isBinary, isLargeFile, isRestricted, isUntracked, screenReader]);

  if (isRestricted) {
    return (
      <Box flexDirection="column" width="100%">
        <Box>
          <Text bold>{paintedPath}</Text>
        </Box>
        <Divider width={viewWidth} />
        <Box flexDirection="column">
          <Text dimColor italic>
            Content restricted by read-permission rules
          </Text>
        </Box>
      </Box>
    );
  }

  // Handle untracked files
  if (isUntracked) {
    return (
      <Box flexDirection="column" width="100%">
        <Box>
          <Text bold>{paintedPath}</Text>
          <Text dimColor> (untracked)</Text>
        </Box>
        <Divider width={viewWidth} />
        <Box flexDirection="column">
          <Text dimColor italic>
            New file not yet staged.
          </Text>
          {!screenReader && (
            <Text dimColor italic>
              Run `git add :/{paintedPath}` to see line counts.
            </Text>
          )}
        </Box>
      </Box>
    );
  }

  // Handle binary files
  if (isBinary) {
    return (
      <Box flexDirection="column" width="100%">
        <Box>
          <Text bold>{paintedPath}</Text>
        </Box>
        <Divider width={viewWidth} />
        <Box flexDirection="column">
          <Text dimColor italic>
            Binary file - cannot display diff
          </Text>
        </Box>
      </Box>
    );
  }

  // Handle large files
  if (isLargeFile) {
    return (
      <Box flexDirection="column" width="100%">
        <Box>
          <Text bold>{paintedPath}</Text>
        </Box>
        <Divider width={viewWidth} />
        <Box flexDirection="column">
          <Text dimColor italic>
            {screenReader ? 'Diff too large to display.' : 'Large file - diff exceeds 1 MB limit'}
          </Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width="100%">
      <Box>
        <Text bold>{paintedPath}</Text>
        {isTruncated && <Text dimColor> (truncated)</Text>}
      </Box>

      <Divider width={viewWidth} />
      <Box flexDirection="column">
        {hunks.length === 0 ? (
          <Text dimColor>No diff content</Text>
        ) : (
          hunks.map((hunk, index) => (
            <StructuredDiff
              key={index}
              patch={hunk}
              filePath={filePath}
              firstLine={firstLine}
              fileContent={fileContent}
              dim={false}
              width={viewWidth}
            />
          ))
        )}
      </Box>

      {isTruncated && (
        <Text dimColor italic>
          … diff truncated (exceeded 400 line limit)
        </Text>
      )}
    </Box>
  );
}
