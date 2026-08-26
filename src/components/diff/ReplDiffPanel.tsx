import { Box, Text } from '@anthropic/ink';
import figures from 'figures';
import type { ReactNode } from 'react';
import { useDiffData } from '../../hooks/useDiffData.js';
import { plural } from '../../utils/stringUtils.js';

type Props = {
  width: number;
};

/**
 * Working-tree list for the REPL diff tab.
 *
 * Official `Zmu`/`H_s`/`PPi` also do session + branch bases, noise/pre-session
 * filters, and file-list keybindings. Those are parked — this is the
 * uncommitted working-tree surface `useDiffData` already owns. Do not invent
 * `PPi` here.
 */
export function ReplDiffPanel({ width }: Props): ReactNode {
  const { stats, files, loading } = useDiffData();
  const inner = Math.max(1, width - 1);

  return (
    <Box flexDirection="column" width={width} height="100%" paddingLeft={1} overflow="hidden">
      <Text bold wrap="truncate">
        Diff
      </Text>
      {!loading && files.length > 0 && (
        <Text dimColor wrap="truncate">
          {files.length} {plural(files.length, 'file')}
          {stats ? `  +${stats.linesAdded} -${stats.linesRemoved}` : ''}
        </Text>
      )}
      <Box flexDirection="column" width={inner} flexGrow={1} overflow="hidden">
        {loading ? null : files.length === 0 ? (
          <Text>No uncommitted changes</Text>
        ) : (
          files.map(file => (
            <Text key={file.path} wrap="truncate">
              {file.path}{' '}
              <Text color="success">
                {figures.triangleUp}
                {file.linesAdded}
              </Text>{' '}
              <Text color="error">
                {figures.triangleDown}
                {file.linesRemoved}
              </Text>
            </Text>
          ))
        )}
      </Box>
    </Box>
  );
}
