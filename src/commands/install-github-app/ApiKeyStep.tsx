import { useCallback, useState } from 'react';
import { Select } from '../../components/CustomSelect/index.js';
import TextInput from '../../components/TextInput.js';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import { useKeybinding } from '../../keybindings/useKeybinding.js';
import { Box, Text } from '@anthropic/ink';

interface ApiKeyStepProps {
  existingApiKey: string | null;
  useExistingKey: boolean;
  apiKeyOrOAuthToken: string;
  onApiKeyChange: (value: string) => void;
  onToggleUseExistingKey: (useExisting: boolean) => void;
  onSubmit: (override?: { selectedApiKeyOption: 'existing' | 'new' | 'oauth'; apiKeyOrOAuthToken?: string }) => void;
  onCreateOAuthToken?: () => void;
  selectedOption?: 'existing' | 'new' | 'oauth';
  onSelectOption?: (option: 'existing' | 'new' | 'oauth') => void;
  onCancel?: () => void;
  isDisabled?: boolean;
}

export function ApiKeyStep({
  existingApiKey,
  apiKeyOrOAuthToken,
  onApiKeyChange,
  onSubmit,
  onToggleUseExistingKey,
  onCreateOAuthToken,
  selectedOption = existingApiKey ? 'existing' : onCreateOAuthToken ? 'oauth' : 'new',
  onSelectOption,
  onCancel,
  isDisabled = false,
}: ApiKeyStepProps) {
  const [cursorOffset, setCursorOffset] = useState(apiKeyOrOAuthToken.length);
  const [showEmptyError, setShowEmptyError] = useState(false);
  const [enteringNewKey, setEnteringNewKey] = useState(!existingApiKey && !onCreateOAuthToken);
  const terminalSize = useTerminalSize();
  const textInputColumns = Math.max(20, terminalSize.columns - 6);

  const options: Array<{ label: string; value: 'existing' | 'oauth' | 'new' }> = [];
  if (existingApiKey) {
    options.push({ label: 'Use your existing Claude Code API key', value: 'existing' });
  }
  if (onCreateOAuthToken) {
    options.push({ label: 'Create a long-lived token with your Claude subscription', value: 'oauth' });
  }
  options.push({ label: 'Enter a new API key', value: 'new' });

  const showTextInput = enteringNewKey || options.length === 1;

  const handleBackOrCancel = useCallback(() => {
    if (isDisabled) return;
    if (options.length > 1) {
      setEnteringNewKey(false);
    } else {
      onCancel?.();
    }
  }, [isDisabled, options.length, onCancel]);

  useKeybinding('confirm:no', handleBackOrCancel, {
    context: 'Settings',
    isActive: showTextInput && !isDisabled,
  });

  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1} gap={1}>
      <Box flexDirection="column">
        <Text bold>Install GitHub App</Text>
        <Text dimColor>API key</Text>
      </Box>
      {showTextInput ? (
        <Box flexDirection="column" gap={1}>
          <TextInput
            value={apiKeyOrOAuthToken}
            onChange={value => {
              if (isDisabled) return;
              onApiKeyChange(value);
              setShowEmptyError(false);
            }}
            onSubmit={submittedValue => {
              if (isDisabled) return;
              const value = submittedValue ?? apiKeyOrOAuthToken;
              if (!value.trim()) {
                setShowEmptyError(true);
                return;
              }
              onSubmit({ selectedApiKeyOption: 'new', apiKeyOrOAuthToken: value });
            }}
            onPaste={value => {
              if (isDisabled) return;
              const trimmed = value.trim();
              onApiKeyChange(trimmed);
              setCursorOffset(trimmed.length);
              setShowEmptyError(false);
            }}
            onExit={handleBackOrCancel}
            focus={!isDisabled}
            placeholder="sk-ant…"
            mask="*"
            columns={textInputColumns}
            cursorOffset={Math.min(cursorOffset, apiKeyOrOAuthToken.length)}
            onChangeCursorOffset={setCursorOffset}
            showCursor={!isDisabled}
          />
          {showEmptyError ? (
            <Text color="error">Enter an API key to continue</Text>
          ) : (
            <Text dimColor>Create a key at https://platform.claude.com/settings/keys</Text>
          )}
        </Box>
      ) : (
        <Select<'existing' | 'oauth' | 'new'>
          options={options}
          defaultFocusValue={selectedOption}
          isDisabled={isDisabled}
          hideIndexes
          disablePrintableKeybindings
          onFocus={value => {
            onSelectOption?.(value);
            onToggleUseExistingKey(value === 'existing');
          }}
          onChange={value => {
            if (isDisabled) return;
            onSelectOption?.(value);
            onToggleUseExistingKey(value === 'existing');
            if (value === 'oauth' && onCreateOAuthToken) {
              onCreateOAuthToken();
              return;
            }
            if (value === 'new') {
              setEnteringNewKey(true);
              setCursorOffset(apiKeyOrOAuthToken.length);
              setShowEmptyError(false);
              return;
            }
            onSubmit({ selectedApiKeyOption: value });
          }}
          onCancel={isDisabled ? undefined : onCancel}
        />
      )}
    </Box>
  );
}
