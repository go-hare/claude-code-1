import figures from 'figures';
import { mkdir, writeFile } from 'fs/promises';
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

      try {
        await writeFile(memoryPath, '', { encoding: 'utf8', flag: 'wx' });
      } catch (e: unknown) {
        if (getErrnoCode(e) !== 'EEXIST') {
          throw e;
        }
      }

      if (!openFileInExternalEditor(memoryPath)) {
        onDone(
          `Couldn't open ${getRelativeMemoryPath(memoryPath)} in an editor. If no editor is configured, set $EDITOR or $VISUAL, then run /memory again.`,
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

      onDone(`Opened ${getRelativeMemoryPath(memoryPath)}${safeModeNote}\n\n${editorHint}`, { display: 'system' });
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
