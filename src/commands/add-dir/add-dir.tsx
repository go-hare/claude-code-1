import chalk from 'chalk';
import figures from 'figures';
import React, { useEffect, useRef, useState } from 'react';
import { getAdditionalDirectoriesForClaudeMd, setAdditionalDirectoriesForClaudeMd } from '../../bootstrap/state.js';
import type { LocalJSXCommandContext } from '../../commands.js';
import { CONFIRM_SELECT_ARM_MS, ConfirmSelect, confirmSelectRefused } from '../../components/ConfirmSelect.js';
import { MessageResponse } from '../../components/MessageResponse.js';
import { AddWorkspaceDirectory } from '../../components/permissions/rules/AddWorkspaceDirectory.js';
import { Box, Dialog, Text } from '@anthropic/ink';
import type { LocalJSXCommandOnDone } from '../../types/command.js';
import { randomUUID } from 'crypto';
import { logForDebugging } from '../../utils/debug.js';
import { persistHookOutput } from '../../utils/hooks/persistHookOutput.js';
import { executeDirectoryAddedHooks } from '../../utils/hooks.js';
import { applyPermissionUpdate, persistPermissionUpdates } from '../../utils/permissions/PermissionUpdate.js';
import type { PermissionUpdateDestination } from '../../utils/permissions/PermissionUpdateSchema.js';
import { SandboxManager } from '../../utils/sandbox/sandbox-adapter.js';
import {
  addDirHelpMessage,
  folderToTrustBeforeAdding,
  type UntrustedAddedFolder,
  validateDirectoryForWorkspace,
} from './validation.js';

/**
 * Official 2.1.326 #323 (`AddedFolderTrustPrompt` / `Ecn`): prompts the user to
 * confirm trust before adding an untrusted folder via `/add-dir` or `--add-dir`.
 */
export function AddedFolderTrustPrompt({
  folder,
  onAnswer,
}: {
  folder: UntrustedAddedFolder;
  onAnswer: (trusted: boolean) => void;
}): React.ReactNode {
  const doneRef = useRef(false);
  const [openedAt] = useState(() => Date.now());
  const isInputRefused = () => confirmSelectRefused(openedAt, CONFIRM_SELECT_ARM_MS, Date.now());
  const answerOnce = (trusted: boolean) => {
    if (doneRef.current) return;
    doneRef.current = true;
    onAnswer(trusted);
  };

  return (
    <Dialog
      title="Adding a new directory:"
      onCancel={() => answerOnce(false)}
      color="warning"
      inputGuide={exitState =>
        exitState.pending ? `Press ${exitState.keyName} again to exit` : 'Enter to confirm · Esc to cancel'
      }
    >
      <Box flexDirection="column" gap={1}>
        <Text bold>{folder.path}</Text>
        {folder.repository && (
          <Text>
            This directory is part of the repository at <Text bold>{folder.repository}</Text>. Trusting it trusts that
            whole repository, including its other worktrees and subdirectories.
          </Text>
        )}
        <Text>This session hasn&apos;t worked here before. Is this a directory you created or one you trust?</Text>
        <Text dimColor>
          Claude Code&apos;ll be able to read, edit, and execute files here. Its skills, commands, and agents load and
          can run commands, and so can the git settings of its repository. Your answer holds for this session. Starting
          Claude Code in this directory and trusting it there lasts, and covers its whole repository or everything below
          it.
        </Text>
        <ConfirmSelect
          cancelFirst
          focus="cancel"
          hideIndexes
          disablePrintableKeybindings
          openedAt={openedAt}
          windowMs={CONFIRM_SELECT_ARM_MS}
          refuseInput={isInputRefused}
          onUpFromFirstItem={() => {}}
          cancelLabel="No, cancel"
          confirmLabel="Yes, I trust this folder"
          onConfirm={() => {
            if (isInputRefused()) return;
            answerOnce(true);
          }}
          onCancel={() => {
            if (isInputRefused()) return;
            answerOnce(false);
          }}
        />
      </Box>
    </Dialog>
  );
}

function TrustGateWrapper({
  folder,
  next,
  onDecline,
}: {
  folder: UntrustedAddedFolder;
  next: () => React.ReactNode;
  onDecline: () => void;
}): React.ReactNode {
  const [content, setContent] = useState<React.ReactNode>(null);
  if (content !== null) {
    return content;
  }
  return (
    <AddedFolderTrustPrompt
      folder={folder}
      onAnswer={trusted => {
        if (trusted) {
          setContent(next());
        } else {
          onDecline();
        }
      }}
    />
  );
}

function InteractiveAddDirWithTrust({
  permissionContext,
  onAddDirectory,
  onCancel,
  onDeclineFolder,
}: {
  permissionContext: LocalJSXCommandContext['getAppState'] extends () => infer S
    ? S extends { toolPermissionContext: infer P }
      ? P
      : never
    : never;
  onAddDirectory: (path: string, remember?: boolean) => Promise<void>;
  onCancel: () => void;
  onDeclineFolder: (path: string) => void;
}): React.ReactNode {
  const [pendingTrust, setPendingTrust] = useState<{
    folder: UntrustedAddedFolder;
    path: string;
    remember: boolean;
  } | null>(null);

  if (pendingTrust) {
    return (
      <AddedFolderTrustPrompt
        folder={pendingTrust.folder}
        onAnswer={trusted => {
          const { path, remember } = pendingTrust;
          setPendingTrust(null);
          if (trusted) {
            void onAddDirectory(path, remember);
          } else {
            onDeclineFolder(path);
          }
        }}
      />
    );
  }

  return (
    <AddWorkspaceDirectory
      permissionContext={permissionContext}
      onAddDirectory={(path, remember = false) => {
        const untrusted = folderToTrustBeforeAdding(path);
        if (untrusted) {
          setPendingTrust({ folder: untrusted, path, remember });
          return;
        }
        void onAddDirectory(path, remember);
      }}
      onCancel={onCancel}
    />
  );
}

function AddDirError({
  message,
  args,
  onDone,
}: {
  message: string;
  args: string;
  onDone: () => void;
}): React.ReactNode {
  useEffect(() => {
    // We need to defer calling onDone to avoid the "return null" bug where
    // the component unmounts before React can render the error message.
    // Using setTimeout ensures the error displays before the command exits.
    const timer = setTimeout(onDone, 0);
    return () => clearTimeout(timer);
  }, [onDone]);

  return (
    <Box flexDirection="column">
      <Text dimColor>
        {figures.pointer} /add-dir {args}
      </Text>
      <MessageResponse>
        <Text>{message}</Text>
      </MessageResponse>
    </Box>
  );
}

export async function call(
  onDone: LocalJSXCommandOnDone,
  context: LocalJSXCommandContext,
  args?: string,
): Promise<React.ReactNode> {
  const directoryPath = (args ?? '').trim();
  const appState = context.getAppState();

  // Helper to handle adding a directory (shared by both with-path and no-path cases)
  const handleAddDirectory = async (path: string, remember = false) => {
    const destination: PermissionUpdateDestination = remember ? 'localSettings' : 'session';

    const permissionUpdate = {
      type: 'addDirectories' as const,
      directories: [path],
      destination,
    };

    // Apply to session context
    const latestAppState = context.getAppState();
    const updatedContext = applyPermissionUpdate(latestAppState.toolPermissionContext, permissionUpdate);
    context.setAppState(prev => ({
      ...prev,
      toolPermissionContext: updatedContext,
    }));

    // Update sandbox config so Bash commands can access the new directory.
    // Bootstrap state is the source of truth for session-only dirs; persisted
    // dirs are picked up via the settings subscription, but we refresh
    // eagerly here to avoid a race when the user acts immediately.
    const currentDirs = getAdditionalDirectoriesForClaudeMd();
    if (!currentDirs.includes(path)) {
      setAdditionalDirectoriesForClaudeMd([...currentDirs, path]);
    }
    SandboxManager.refreshConfig();

    // densable 2.1.219 #3 s2t — DirectoryAdded after /add-dir (slash_command)
    try {
      const { systemMessages } = await executeDirectoryAddedHooks(path, 'slash_command');
      const seed = randomUUID();
      await Promise.all(
        systemMessages.map((sm, index) =>
          persistHookOutput(sm, `add-dir-${seed}-${index}`, 'systemMessage').then(text => {
            logForDebugging(`DirectoryAdded hook: ${text}`);
          }),
        ),
      );
    } catch (error) {
      logForDebugging(`DirectoryAdded hook failed: ${error instanceof Error ? error.message : String(error)}`, {
        level: 'warn',
      });
    }

    let message: string;

    if (remember) {
      try {
        // Official 2.1.326 #16: surface settings persistence warnings via onPersistError.
        let persistWarning: string | undefined;
        persistPermissionUpdates([permissionUpdate], {
          onPersistError: warning => {
            persistWarning = warning;
          },
        });
        message =
          persistWarning === undefined
            ? `Added ${chalk.bold(path)} as a working directory and saved to local settings`
            : `Added ${chalk.bold(path)} as a working directory. ${persistWarning}`;
      } catch (error) {
        message = `Added ${chalk.bold(path)} as a working directory. Couldn't save it to local settings: ${error instanceof Error ? error.message : 'Unknown error'}`;
      }
    } else {
      message = `Added ${chalk.bold(path)} as a working directory for this session`;
    }

    const messageWithHint = `${message} ${chalk.dim('· /permissions to manage')}`;
    onDone(messageWithHint);
  };

  // When no path is provided, show AddWorkspaceDirectory input form directly
  // and return to REPL after confirmation
  if (!directoryPath) {
    return (
      <InteractiveAddDirWithTrust
        permissionContext={appState.toolPermissionContext}
        onAddDirectory={handleAddDirectory}
        onCancel={() => {
          onDone('Did not add a working directory.');
        }}
        onDeclineFolder={declinedPath => {
          onDone(`Did not add ${chalk.bold(declinedPath)} as a working directory.`);
        }}
      />
    );
  }

  const result = await validateDirectoryForWorkspace(directoryPath, appState.toolPermissionContext);
  const decline = () => {
    onDone(`Did not add ${chalk.bold(directoryPath)} as a working directory.`);
  };

  const renderNext = (): React.ReactNode => {
    if (result.resultType !== 'success') {
      const message = addDirHelpMessage(result);
      return <AddDirError message={message} args={args ?? ''} onDone={() => onDone(message)} />;
    }
    return (
      <AddWorkspaceDirectory
        directoryPath={result.absolutePath}
        permissionContext={appState.toolPermissionContext}
        onAddDirectory={handleAddDirectory}
        onCancel={() => {
          onDone(`Did not add ${chalk.bold(result.absolutePath)} as a working directory.`);
        }}
      />
    );
  };

  // Official 2.1.326 #323: prompt for trust when adding an untrusted folder in local sessions.
  const untrustedFolder = result.resultType === 'success' ? folderToTrustBeforeAdding(result.absolutePath) : undefined;
  if (untrustedFolder) {
    return <TrustGateWrapper folder={untrustedFolder} next={renderNext} onDecline={decline} />;
  }

  return renderNext();
}
