import { lstat } from 'fs/promises';
import { join, sep } from 'path';
import figures from 'figures';
import React, { useEffect, useState } from 'react';
import { Box, Dialog, KeyboardShortcutHint, Text } from '@anthropic/ink';
import { getCwd } from '../utils/cwd.js';
import { logForDebugging } from '../utils/debug.js';
import { execFileNoThrowWithCwd } from '../utils/execFileNoThrow.js';
import type { GitFileStatus } from '../utils/git.js';
import { getFileStatus, gitExe, stashToCleanState } from '../utils/git.js';
import { ConfirmSelect } from './ConfirmSelect.js';
import { Spinner } from './Spinner.js';

export class TeleportStashRefusalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TeleportStashRefusalError';
  }
}

/**
 * #65 SEA `CPn` + `jvs` (@290969017, @291007500):
 * Refuse stashing when a folder on disk has replaced a tracked file or symlink
 * (including assume-unchanged entries), because `git add` + `git stash` would
 * delete the folder's contents.
 */
export async function checkTrackedFilesReplacedByFolders(
  cwd: string,
  lstatFn: typeof lstat = lstat,
  runGit: (args: string[]) => Promise<{ code: number; stdout: string }> = args =>
    execFileNoThrowWithCwd(gitExe(), args, { cwd, preserveOutputOnError: false }),
): Promise<void> {
  const [diffRes, lsRes] = await Promise.all([
    runGit(['diff-index', '-z', '--diff-filter=DT', 'HEAD', '--']),
    runGit(['ls-files', '-z', '-v', '-s']),
  ]);
  if (diffRes.code !== 0) {
    return;
  }
  const diffParts = diffRes.stdout.split('\0');
  const diffPaths = diffParts.filter(
    (p, idx) => idx % 2 === 1 && p.length > 0 && !diffParts[idx - 1]?.startsWith(':160000'),
  );
  const assumeUnchangedPaths =
    lsRes.code === 0
      ? Array.from(lsRes.stdout.matchAll(/(?:^|\0)h (?!160000)\d{6} [0-9a-f]+ \d\t([^\0]+)/g), m => m[1] ?? '').filter(
          Boolean,
        )
      : [];
  const candidates = Array.from(new Set([...diffPaths, ...assumeUnchangedPaths]));
  if (candidates.some(p => p.startsWith('/') || p.split(sep === '\\' ? /[\\/]/ : '/').includes('..'))) {
    return;
  }
  const replaced: string[] = [];
  for (const rel of candidates) {
    try {
      const st = await lstatFn(join(cwd, rel));
      if (st.isDirectory()) {
        replaced.push(rel);
      }
    } catch {
      // Missing / unreadable path — not a directory replacing a tracked file
    }
  }
  if (replaced.length > 0) {
    const first = replaced[0]!;
    const rest = replaced.length - 1;
    const msg =
      rest === 0
        ? `Nothing was stashed: "${first}" is now a folder in place of a tracked file or link, and stashing could delete what's in it for good. Commit the change or move the folder somewhere else, then try again.`
        : `Nothing was stashed: "${first}" and ${rest} other ${rest === 1 ? 'path' : 'paths'} are now folders in place of tracked files or links, and stashing could delete what's in them for good. Commit the change or move the folders somewhere else, then try again.`;
    throw new TeleportStashRefusalError(msg);
  }
}

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
      await checkTrackedFilesReplacedByFolders(getCwd());
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
      setError(err instanceof TeleportStashRefusalError ? err.message : 'Failed to stash changes');
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
