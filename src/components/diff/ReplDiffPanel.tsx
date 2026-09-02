import { Box, Text } from '@anthropic/ink';
import figures from 'figures';
import { useState, type ReactNode } from 'react';
import { useDiffData } from '../../hooks/useDiffData.js';
import { useKeybinding } from '../../keybindings/useKeybinding.js';
import { useAppState } from '../../state/AppState.js';
import {
  cycleDiffBaseMode,
  getPersistedDiffBaseMode,
  replDiffEmptyCopy,
  replDiffPreSessionStats,
  replDiffVisibleFiles,
  replDiffVisibleStats,
  type DiffBaseMode,
} from '../../utils/replDiffTab.js';
import { plural } from '../../utils/stringUtils.js';

type Props = {
  width: number;
};

/**
 * densable `Zmu` list surface. `_zS` preSession files stay out of the main list.
 */
export function ReplDiffPanel({ width }: Props): ReactNode {
  // densable Zmu `tJt` — requested Pec mode passed into H_s as `r`.
  const [requestedMode, setRequestedMode] = useState<DiffBaseMode>(getPersistedDiffBaseMode);
  // densable Zmu `do$=wt(rJA)` → H_s first arg. snapshotSequence is the
  // fileHistory activity signal (official useGitDiffStats comment).
  const revision = useAppState(s => s.fileHistory.snapshotSequence);
  // densable `iNo` — H_s returns `s.baseMode` (pinned to the last good fetch).
  const { files, loading, source, baseMode } = useDiffData(requestedMode, revision);
  const displayMode: DiffBaseMode = baseMode === 'auto' ? requestedMode : baseMode;
  const visible = replDiffVisibleFiles(files);
  const visibleStats = replDiffVisibleStats(visible);
  const preSessionStats = replDiffPreSessionStats(files);
  const inner = Math.max(1, width - 1);

  useKeybinding(
    'app:cycleDiffBase',
    () => {
      setRequestedMode(current => cycleDiffBaseMode(current));
    },
    { context: 'Global' },
  );

  const modeLabel = source.kind === 'branch' ? `branch vs ${source.baseBranch}` : displayMode;

  return (
    <Box flexDirection="column" width={width} height="100%" paddingLeft={1} overflow="hidden">
      <Text bold wrap="truncate">
        Diff
      </Text>
      <Text dimColor wrap="truncate">
        {modeLabel}
      </Text>
      {!loading && visible.length > 0 && (
        <Text dimColor wrap="truncate">
          {visibleStats.filesCount} {plural(visibleStats.filesCount, 'file')}
          {`  +${visibleStats.linesAdded} -${visibleStats.linesRemoved}`}
        </Text>
      )}
      <Box flexDirection="column" width={inner} flexGrow={1} overflow="hidden">
        {loading ? null : visible.length === 0 ? (
          <Text>{replDiffEmptyCopy(displayMode, source)}</Text>
        ) : (
          visible.map(file => (
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
      {!loading && preSessionStats.filesCount > 0 && (
        <Text dimColor wrap="truncate">
          {preSessionStats.filesCount} {plural(preSessionStats.filesCount, 'file')}
          {`  +${preSessionStats.linesAdded} -${preSessionStats.linesRemoved}`}
        </Text>
      )}
    </Box>
  );
}
