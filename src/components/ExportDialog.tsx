import React, { useCallback, useState } from 'react';
import { getOriginalCwd } from '../bootstrap/state.js';
import { ExportFileExistsError, formatExportClipboardMessage, writeExportFile } from '../commands/export/export.js';
import type { ExitState } from '../hooks/useExitOnCtrlCDWithKeybindings.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import { setClipboard, Box, Text, Byline, Dialog, KeyboardShortcutHint } from '@anthropic/ink';
import { useKeybinding } from '../keybindings/useKeybinding.js';
import { getCwd } from '../utils/cwd.js';
import { isRemoteWorkspace } from '../utils/ultraplanKeyword.js';
import { ConfigurableShortcutHint } from './ConfigurableShortcutHint.js';
import { Select } from './CustomSelect/select.js';
import TextInput from './TextInput.js';

type ExportDialogProps = {
  content: string;
  defaultFilename: string;
  onDone: (result: { success: boolean; message: string }) => void;
};

type ExportOption = 'clipboard' | 'file';

export function ExportDialog({ content, defaultFilename, onDone }: ExportDialogProps): React.ReactNode {
  const [, setSelectedOption] = useState<ExportOption | null>(null);
  const [filename, setFilename] = useState<string>(defaultFilename);
  const [cursorOffset, setCursorOffset] = useState<number>(defaultFilename.length);
  const [showFilenameInput, setShowFilenameInput] = useState(false);
  // #379 (2.1.327): prompt before overwriting an existing file
  const [overwritePath, setOverwritePath] = useState<string | null>(null);
  // #611 (2.1.328): inline error when filename is left empty (avoid writing `.txt`)
  const [filenameError, setFilenameError] = useState<string | null>(null);
  const { columns } = useTerminalSize();

  // Handle going back from filename input to option selection
  const handleGoBack = useCallback(() => {
    setShowFilenameInput(false);
    setSelectedOption(null);
    setFilenameError(null);
  }, []);

  const handleSelectOption = async (value: string): Promise<void> => {
    if (value === 'clipboard') {
      // Copy to clipboard immediately
      const raw = await setClipboard(content);
      if (raw) process.stdout.write(raw);
      onDone({ success: true, message: formatExportClipboardMessage() });
    } else if (value === 'file') {
      setSelectedOption('file');
      setShowFilenameInput(true);
      setFilenameError(null);
    }
  };

  const writeFile = useCallback(
    (targetName: string, overwrite: boolean) => {
      if (!overwrite && targetName.trim() === '') {
        setFilenameError("Filename can't be empty");
        return;
      }
      setFilenameError(null);
      try {
        const filepath = writeExportFile(targetName, content, overwrite ? 'overwrite' : 'refuse');
        onDone({
          success: true,
          message: `Conversation exported to ${filepath}`,
        });
      } catch (error) {
        if (error instanceof ExportFileExistsError) {
          setOverwritePath(error.filepath);
          return;
        }
        onDone({
          success: false,
          message: `Couldn't export conversation: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    },
    [content, onDone],
  );

  const handleFilenameSubmit = () => {
    writeFile(filename, false);
  };

  // Dialog calls onCancel when Escape is pressed. If we are in the overwrite
  // confirmation, return to filename input; if in filename input, go back to options.
  const handleCancel = useCallback(() => {
    if (overwritePath !== null) {
      setOverwritePath(null);
    } else if (showFilenameInput) {
      handleGoBack();
    } else {
      onDone({ success: false, message: 'Export cancelled' });
    }
  }, [overwritePath, showFilenameInput, handleGoBack, onDone]);

  const inDifferentLaunchDir = isRemoteWorkspace() && getOriginalCwd() !== getCwd();
  const fileDescription = inDifferentLaunchDir
    ? 'Save the conversation to a file in the directory where you started Claude Code'
    : 'Save the conversation to a file in the current directory';

  const options = [
    {
      label: 'Copy to clipboard',
      value: 'clipboard',
      description: 'Copy the conversation to your system clipboard',
    },
    {
      label: 'Save to file',
      value: 'file',
      description: fileDescription,
    },
  ];

  // Custom input guide that changes based on dialog state
  function renderInputGuide(exitState: ExitState): React.ReactNode {
    if (showFilenameInput && overwritePath === null) {
      return (
        <Byline>
          <KeyboardShortcutHint shortcut="enter" action="save" />
          <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="go back" />
        </Byline>
      );
    }

    if (exitState.pending) {
      return <Text>Press {exitState.keyName} again to exit</Text>;
    }

    return (
      <ConfigurableShortcutHint
        action="confirm:no"
        context="Confirmation"
        fallback="Esc"
        description={overwritePath !== null ? 'go back' : 'cancel'}
      />
    );
  }

  // Use Settings context so 'n' key doesn't cancel (allows typing 'n' in filename input)
  useKeybinding('confirm:no', handleCancel, {
    context: 'Settings',
    isActive: showFilenameInput && overwritePath === null,
  });

  if (overwritePath !== null) {
    return (
      <Dialog
        title="Overwrite this file?"
        color="warning"
        onCancel={() => setOverwritePath(null)}
        inputGuide={renderInputGuide}
      >
        <Box flexDirection="column" gap={1}>
          <Box flexDirection="column">
            <Text>A file with this name is already there.</Text>
            <Text dimColor>{overwritePath}</Text>
          </Box>
          <Select<'cancel' | 'overwrite'>
            options={[
              { label: 'No, change the name', value: 'cancel' },
              { label: 'Yes, overwrite', value: 'overwrite' },
            ]}
            defaultFocusValue="cancel"
            hideIndexes
            disablePrintableKeybindings
            onUpFromFirstItem={() => {}}
            onChange={choice => {
              if (choice === 'overwrite') {
                writeFile(overwritePath, true);
              } else {
                setOverwritePath(null);
              }
            }}
            onCancel={() => setOverwritePath(null)}
          />
        </Box>
      </Dialog>
    );
  }

  // densable 289 S: title="Export conversation", subtitle="Select export method"
  return (
    <Dialog
      title="Export conversation"
      subtitle="Select export method"
      color="permission"
      onCancel={handleCancel}
      inputGuide={renderInputGuide}
      isCancelActive={!showFilenameInput}
    >
      {!showFilenameInput ? (
        <Select options={options} hideIndexes onChange={handleSelectOption} onCancel={handleCancel} />
      ) : (
        <Box flexDirection="column">
          <Text>Enter filename:</Text>
          <Box flexDirection="row" gap={1} marginTop={1}>
            <Text>&gt;</Text>
            <TextInput
              value={filename}
              onChange={val => {
                setFilename(val);
                if (filenameError) setFilenameError(null);
              }}
              onSubmit={handleFilenameSubmit}
              focus={true}
              showCursor={true}
              columns={columns}
              cursorOffset={cursorOffset}
              onChangeCursorOffset={setCursorOffset}
            />
          </Box>
          {filenameError ? (
            <Box marginTop={1}>
              <Text color="error">{filenameError}</Text>
            </Box>
          ) : null}
        </Box>
      )}
    </Dialog>
  );
}
