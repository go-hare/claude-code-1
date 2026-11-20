import { useCallback, useState } from 'react';
import { Select } from '../../components/CustomSelect/index.js';
import TextInput from '../../components/TextInput.js';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import { useKeybinding } from '../../keybindings/useKeybinding.js';
import { Box, Text } from '@anthropic/ink';

interface CheckExistingSecretStepProps {
  useExistingSecret: boolean;
  secretName: string;
  onToggleUseExistingSecret: (useExisting: boolean) => void;
  onSecretNameChange: (value: string) => void;
  onSubmit: (override?: { useExistingSecret: boolean; secretName?: string }) => void;
  onCancel?: () => void;
}

export function CheckExistingSecretStep({
  useExistingSecret,
  secretName,
  onToggleUseExistingSecret,
  onSecretNameChange,
  onSubmit,
  onCancel,
}: CheckExistingSecretStepProps) {
  const [cursorOffset, setCursorOffset] = useState(secretName.length);
  const [showEmptyError, setShowEmptyError] = useState(false);
  const [editingNewName, setEditingNewName] = useState(!useExistingSecret);
  const terminalSize = useTerminalSize();
  const textInputColumns = Math.max(20, terminalSize.columns - 6);

  const handleBackOrCancel = useCallback(() => {
    setEditingNewName(false);
    onToggleUseExistingSecret(true);
  }, [onToggleUseExistingSecret]);

  useKeybinding('confirm:no', handleBackOrCancel, {
    context: 'Settings',
    isActive: editingNewName,
  });

  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1} gap={1}>
      <Box flexDirection="column">
        <Text bold>Install GitHub App</Text>
        <Text dimColor>Existing secret</Text>
      </Box>
      <Text color="warning">ANTHROPIC_API_KEY already exists in repository secrets</Text>
      {!editingNewName ? (
        <Select<'existing' | 'new'>
          options={[
            { label: 'Use the existing API key', value: 'existing' },
            { label: 'New secret name', value: 'new' },
          ]}
          defaultFocusValue={useExistingSecret ? 'existing' : 'new'}
          hideIndexes
          onFocus={value => {
            onToggleUseExistingSecret(value === 'existing');
            setShowEmptyError(false);
          }}
          onChange={value => {
            if (value === 'existing') {
              onToggleUseExistingSecret(true);
              onSubmit({ useExistingSecret: true, secretName: 'ANTHROPIC_API_KEY' });
            } else {
              onToggleUseExistingSecret(false);
              setCursorOffset(0);
              setEditingNewName(true);
            }
          }}
          onCancel={onCancel}
        />
      ) : (
        <Box flexDirection="column" gap={1}>
          <TextInput
            value={secretName}
            onChange={value => {
              setShowEmptyError(false);
              onSecretNameChange(value);
            }}
            onSubmit={submittedValue => {
              const value = submittedValue ?? secretName;
              if (!value.trim()) {
                setShowEmptyError(true);
                return;
              }
              onSubmit({ useExistingSecret: false, secretName: value });
            }}
            onExit={handleBackOrCancel}
            focus={true}
            placeholder="CLAUDE_API_KEY"
            columns={textInputColumns}
            cursorOffset={Math.min(cursorOffset, secretName.length)}
            onChangeCursorOffset={setCursorOffset}
            showCursor={true}
          />
          {showEmptyError ? (
            <Text color="error">Enter a secret name to continue</Text>
          ) : (
            <Text dimColor>A name takes letters, numbers and underscores</Text>
          )}
        </Box>
      )}
    </Box>
  );
}
