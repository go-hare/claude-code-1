import figures from 'figures';
import React, { useEffect, useState } from 'react';
import { Box, Dialog, KeyboardShortcutHint, Text } from '@anthropic/ink';
import { logForDebugging } from '../utils/debug.js';
import type { GitFileStatus } from '../utils/git.js';
import { getFileStatus, stashToCleanState } from '../utils/git.js';
import { ConfirmSelect } from './ConfirmSelect.js';
import { Spinner } from './Spinner.js';

type TeleportStashProps = {
  onStashAndContinue: () => void | Promise<void>;
  onCancel: () => void;
  cancelQuits?: boolean;
};

function noop(): void {}

export function TeleportStash({
  onStashAndContinue,
  onCancel,
  cancelQuits = true,
}: TeleportStashProps): React.ReactNode {
  const [gitFileStatus, setGitFileStatus] = useState<GitFileStatus | null>(null);
  const changedFiles = gitFileStatus !== null ? [...gitFileStatus.tracked, ...gitFileStatus.untracked] : [];
  const [loading, setLoading] = useState(true);
  const [stashing, setStashing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load changed files on mount
  useEffect(() => {
    const loadChangedFiles = async () => {
      try {
        const fileStatus = await getFileStatus();
        setGitFileStatus(fileStatus);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        logForDebugging(`Error getting changed files: ${errorMessage}`, {
          level: 'error',
        });
        setError('Failed to get changed files');
      } finally {
        setLoading(false);
      }
    };

    void loadChangedFiles();
  }, []);

  const handleStash = async () => {
    setStashing(true);
    try {
      logForDebugging('Stashing changes before teleport...');
      const success = await stashToCleanState('Teleport auto-stash');

      if (!success) {
        setError('Failed to stash changes');
        setStashing(false);
        return;
      }
      logForDebugging('Successfully stashed changes');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logForDebugging(`Error stashing changes: ${errorMessage}`, {
        level: 'error',
      });
      setError('Failed to stash changes');
      setStashing(false);
      return;
    }
    try {
      await onStashAndContinue();
    } finally {
      setStashing(false);
    }
  };

  if (loading) {
    return (
      <Box flexDirection="column" padding={1}>
        <Box marginBottom={1}>
          <Spinner />
          <Text> Checking git status{figures.ellipsis}</Text>
        </Box>
      </Box>
    );
  }

  if (error) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="error">
          Error: {error}
        </Text>
        <Box marginTop={1}>
          <Text dimColor>
            <KeyboardShortcutHint shortcut="escape" action="cancel" bold />
          </Text>
        </Box>
      </Box>
    );
  }

  const showFileCount = changedFiles.length > 8;
  const stashingNonQuit = stashing && !cancelQuits;

  return (
    <Dialog
      key={stashingNonQuit ? 'stashing' : 'asking'}
      title="Working directory has changes"
      onCancel={stashingNonQuit ? noop : onCancel}
      exitOnCtrlCD={cancelQuits || stashingNonQuit}
      inputGuide={stashingNonQuit ? 'Teleport continues when the stash finishes…' : undefined}
    >
      <Text>Teleport will switch git branches. The following changes were found:</Text>

      <Box flexDirection="column" paddingLeft={2}>
        {changedFiles.length > 0 ? (
          showFileCount ? (
            <Text>{changedFiles.length} files changed</Text>
          ) : (
            changedFiles.map((file: string, index: number) => <Text key={index}>{file}</Text>)
          )
        ) : (
          <Text dimColor>No changes detected</Text>
        )}
      </Box>

      <Text>Would you like to stash these changes and continue with teleport?</Text>

      {stashing ? (
        <Box>
          <Spinner />
          <Text> Stashing changes...</Text>
        </Box>
      ) : (
        <ConfirmSelect
          confirmLabel="Stash changes and continue"
          cancelLabel={cancelQuits ? 'Exit' : 'Cancel'}
          onConfirm={() => void handleStash()}
          onCancel={onCancel}
        />
      )}
    </Dialog>
  );
}
