import figures from 'figures';
import { access, constants, mkdir, writeFile } from 'fs/promises';
import * as React from 'react';
import type { CommandResultDisplay } from '../../commands.js';
import { Box, Dialog, Link, LoadingState, Text } from '@anthropic/ink';
import { MemoryFileSelector } from '../../components/memory/MemoryFileSelector.js';
import { getRelativeMemoryPath } from '../../components/memory/MemoryUpdateNotification.js';
import type { LocalJSXCommandCall } from '../../types/command.js';
import { clearMemoryFileCaches, getMemoryFiles } from '../../utils/claudemd.js';
import { openFileInExternalEditor } from '../../utils/editor.js';
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js';
import { errorMessage, getErrnoCode } from '../../utils/errors.js';
import { logError } from '../../utils/log.js';
import { isSafeModeEnabled, safeModeDisableHint } from '../../utils/safeMode.js';

/**
 * Official 2.1.326 #152 (`kn(v, bn.W_OK)`): check whether an existing memory
 * file is writable before opening it in an external editor and return a warning
 * when changes may not save.
 */
export async function checkMemoryFileReadOnlyWarning(memoryPath: string): Promise<string> {
  try {
    await access(memoryPath, constants.W_OK);
    return '';
  } catch (err: unknown) {
    const code = getErrnoCode(err);
    if (code === 'EROFS') {
      return "\n\n> This file is on a read-only file system, so your changes can't be saved. Make that file system writable to edit it.";
    }
    if (code === 'EACCES' || code === 'EPERM') {
      return '\n\n> This file is read-only, so your changes may not save. Check its permissions.';
    }
    return '';
  }
}

function MemoryCommand({
  onDone,
}: {
  onDone: (result?: string, options?: { display?: CommandResultDisplay }) => void;
}): React.ReactNode {
  const safeMode = isSafeModeEnabled();
  const safeModeExitHint = safeMode ? safeModeDisableHint() : '';

  const handleSelectMemoryFile = async (memoryPath: string) => {
    try {
      if (memoryPath.includes(getClaudeConfigHomeDir())) {
        await mkdir(getClaudeConfigHomeDir(), { recursive: true });
      }

      let readOnlyWarning = '';
      try {
        await writeFile(memoryPath, '', { encoding: 'utf8', flag: 'wx' });
      } catch (e: unknown) {
        if (getErrnoCode(e) !== 'EEXIST') {
          throw e;
        }
        // Official 2.1.326 #152: warn when opening a read-only memory file.
        readOnlyWarning = await checkMemoryFileReadOnlyWarning(memoryPath);
      }

      if (!openFileInExternalEditor(memoryPath)) {
        onDone(
          `Couldn't open ${getRelativeMemoryPath(memoryPath)} in an editor. If no editor is configured, set $EDITOR or $VISUAL, then run /memory again.${readOnlyWarning}`,
          { display: 'system' },
        );
        return;
      }

      let editorSource = 'default';
      let editorValue = '';
      if (process.env.VISUAL) {
        editorSource = '$VISUAL';
        editorValue = process.env.VISUAL;
      } else if (process.env.EDITOR) {
        editorSource = '$EDITOR';
        editorValue = process.env.EDITOR;
      }

      const editorInfo = editorSource !== 'default' ? `Using ${editorSource}="${editorValue}".` : '';

      const editorHint = editorInfo
        ? `> ${editorInfo} To change editor, set $EDITOR or $VISUAL environment variable.`
        : `> To use a different editor, set the $EDITOR or $VISUAL environment variable.`;

      const safeModeNote = isSafeModeEnabled()
        ? `\n\n> Safe mode: this session doesn't load CLAUDE.md files, so changes take effect after you ${safeModeDisableHint()}.`
        : '';

      onDone(`Opened ${getRelativeMemoryPath(memoryPath)}${readOnlyWarning}${safeModeNote}\n\n${editorHint}`, {
        display: 'system',
      });
    } catch (error) {
      logError(error);
      onDone(`Couldn't open ${getRelativeMemoryPath(memoryPath)}: ${errorMessage(error)}`, { display: 'system' });
    }
  };

  const handleCancel = () => {
    onDone('Cancelled memory editing', { display: 'system' });
  };

  return (
    <Dialog title="Memory" onCancel={handleCancel} color="remember">
      <Box flexDirection="column" gap={1}>
        {safeMode && (
          <Box flexDirection="column">
            <Text color="suggestion">{figures.info} Safe mode</Text>
            <Text dimColor>
              CLAUDE.md files aren&apos;t loaded into this session. You can still edit them — changes take effect after
              you {safeModeExitHint}.
            </Text>
          </Box>
        )}

        <React.Suspense fallback={<LoadingState message="Loading…" dimColor />}>
          <MemoryFileSelector onSelect={handleSelectMemoryFile} onCancel={handleCancel} />
        </React.Suspense>

        <Box>
          <Text dimColor>
            Learn more: <Link url="https://code.claude.com/docs/en/memory" />
          </Text>
        </Box>
      </Box>
    </Dialog>
  );
}

export const call: LocalJSXCommandCall = async onDone => {
  clearMemoryFileCaches();
  await getMemoryFiles();
  return <MemoryCommand onDone={onDone} />;
};
