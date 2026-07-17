import type { StructuredPatchHunk } from 'diff';
import * as React from 'react';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import { Box, Text } from '@anthropic/ink';
import { count } from '../utils/array.js';
import { CtrlOToExpand } from './CtrlOToExpand.js';
import { MessageResponse } from './MessageResponse.js';
import { StructuredDiffList } from './StructuredDiffList.js';

type Props = {
  filePath: string;
  structuredPatch: StructuredPatchHunk[];
  firstLine: string | null;
  fileContent?: string;
  style?: 'condensed';
  verbose: boolean;
  previewHint?: string;
  /** Official: collapse full diff for scratchpad files (stats + ctrl+o). */
  collapsed?: boolean;
};

export function FileEditToolUpdatedMessage({
  filePath,
  structuredPatch,
  firstLine,
  fileContent,
  style,
  verbose,
  previewHint,
  collapsed,
}: Props): React.ReactNode {
  const { columns } = useTerminalSize();
  const numAdditions = structuredPatch.reduce((acc, hunk) => acc + count(hunk.lines, _ => _.startsWith('+')), 0);
  const numRemovals = structuredPatch.reduce((acc, hunk) => acc + count(hunk.lines, _ => _.startsWith('-')), 0);

  // Official densable: stats-only line — no path in condensed/collapsed summary.
  const text = (
    <Text>
      {numAdditions > 0 ? (
        <>
          Added <Text bold>{numAdditions}</Text> {numAdditions > 1 ? 'lines' : 'line'}
        </>
      ) : null}
      {numAdditions > 0 && numRemovals > 0 ? ', ' : null}
      {numRemovals > 0 ? (
        <>
          {numAdditions === 0 ? 'R' : 'r'}emoved <Text bold>{numRemovals}</Text> {numRemovals > 1 ? 'lines' : 'line'}
        </>
      ) : null}
    </Text>
  );

  // Plan files: invert condensed behavior
  // - Regular mode: just show the hint (user can type /plan to see full content)
  // - Condensed mode (subagent view): show the diff
  if (previewHint) {
    if (style !== 'condensed' && !verbose) {
      return (
        <MessageResponse>
          <Text dimColor>{previewHint}</Text>
        </MessageResponse>
      );
    }
  } else if (style === 'condensed' && !verbose) {
    // Official: subagent / condensed style returns stats only.
    return text;
  } else if (collapsed && !verbose && numAdditions + numRemovals > 0) {
    // Official: scratchpad edits keep stats + expand hint, hide full diff.
    return (
      <MessageResponse>
        <Text>
          {text} <CtrlOToExpand />
        </Text>
      </MessageResponse>
    );
  }

  return (
    <MessageResponse>
      <Box flexDirection="column">
        <Text>{text}</Text>
        <StructuredDiffList
          hunks={structuredPatch}
          dim={false}
          width={columns - 12}
          filePath={filePath}
          firstLine={firstLine}
          fileContent={fileContent}
        />
      </Box>
    </MessageResponse>
  );
}
