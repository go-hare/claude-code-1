import type { StructuredPatchHunk } from 'diff';
import * as React from 'react';
import { Box, NoSelect, Text } from '@anthropic/ink';
import { intersperse } from '../utils/array.js';
import { StructuredDiff } from './StructuredDiff.js';

type Props = {
  hunks: StructuredPatchHunk[];
  dim: boolean;
  width: number;
  filePath: string;
  firstLine: string | null;
  fileContent?: string;
};

/** Renders a list of diff hunks with ellipsis separators between them. */
export function StructuredDiffList({ hunks, dim, width, filePath, firstLine, fileContent }: Props): React.ReactNode {
  return intersperse(
    hunks.map((hunk, idx) => (
      <Box flexDirection="column" key={`hunk-${idx}`}>
        <StructuredDiff
          patch={hunk}
          dim={dim}
          width={width}
          filePath={filePath}
          firstLine={firstLine}
          fileContent={fileContent}
        />
      </Box>
    )),
    i => (
      <NoSelect fromLeftEdge key={`ellipsis-${i}`}>
        <Text dimColor>...</Text>
      </NoSelect>
    ),
  );
}
