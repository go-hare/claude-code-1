import { useCallback, useState } from 'react';
import { Select } from '../../components/CustomSelect/index.js';
import TextInput from '../../components/TextInput.js';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import { useKeybinding } from '../../keybindings/useKeybinding.js';
import { Box, Text } from '@anthropic/ink';

interface ChooseRepoStepProps {
  currentRepo: string | null;
  useCurrentRepo: boolean;
  repoUrl: string;
  onRepoUrlChange: (value: string) => void;
  onToggleUseCurrentRepo: (useCurrentRepo: boolean) => void;
  onSubmit: (override?: { useCurrentRepo: boolean; selectedRepoName?: string }) => void;
  onCancel?: () => void;
}

const EMPTY_REPO_ERROR = 'Enter a repository name to continue';

export function ChooseRepoStep({
  currentRepo,
  useCurrentRepo,
  repoUrl,
  onRepoUrlChange,
  onSubmit,
  onToggleUseCurrentRepo,
  onCancel,
}: ChooseRepoStepProps) {
  const [cursorOffset, setCursorOffset] = useState(repoUrl.length);
  const [showEmptyError, setShowEmptyError] = useState(false);
  const [editingTyped, setEditingTyped] = useState(!currentRepo);
  const terminalSize = useTerminalSize();
  const textInputColumns = Math.max(20, terminalSize.columns - 6);

  const handleSubmitTyped = useCallback(
    (submittedValue?: string) => {
      const value = submittedValue ?? repoUrl;
      if (!value.trim()) {
        setShowEmptyError(true);
        return;
      }
      onSubmit({ useCurrentRepo: false, selectedRepoName: value });
    },
    [repoUrl, onSubmit],
  );

  const showTextInput = !currentRepo || (!useCurrentRepo && editingTyped);

  const handleBackOrCancel = useCallback(() => {
    if (currentRepo) {
      setEditingTyped(false);
      onToggleUseCurrentRepo(true);
    } else {
      onCancel?.();
    }
  }, [currentRepo, onToggleUseCurrentRepo, onCancel]);

  useKeybinding('confirm:no', handleBackOrCancel, {
    context: 'Settings',
    isActive: showTextInput,
  });

  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1} gap={1}>
      <Box flexDirection="column">
        <Text bold>Install GitHub App</Text>
        <Text dimColor>Repository</Text>
      </Box>
      {currentRepo && !showTextInput ? (
        <Select<'current' | 'typed'>
          options={[
            { label: `Use current repository: ${currentRepo}`, value: 'current' },
            { label: 'Another repository', value: 'typed' },
          ]}
          defaultFocusValue={useCurrentRepo ? 'current' : 'typed'}
          hideIndexes
          onFocus={value => {
            onToggleUseCurrentRepo(value === 'current');
            setShowEmptyError(false);
          }}
          onChange={value => {
            if (value === 'current') {
              onToggleUseCurrentRepo(true);
              onSubmit({ useCurrentRepo: true, selectedRepoName: currentRepo });
            } else {
              onToggleUseCurrentRepo(false);
              setCursorOffset(0);
              setEditingTyped(true);
            }
          }}
          onCancel={onCancel}
        />
      ) : (
        <Box flexDirection="column" gap={1}>
          <TextInput
            value={repoUrl}
            onChange={value => {
              onRepoUrlChange(value);
              setShowEmptyError(false);
            }}
            onSubmit={handleSubmitTyped}
            onExit={handleBackOrCancel}
            focus={true}
            placeholder="owner/repo"
            columns={textInputColumns}
            cursorOffset={Math.min(cursorOffset, repoUrl.length)}
            onChangeCursorOffset={setCursorOffset}
            showCursor={true}
          />
          <Text dimColor>A https://github.com/owner/repo address works too</Text>
        </Box>
      )}
      {showEmptyError && <Text color="error">{EMPTY_REPO_ERROR}</Text>}
    </Box>
  );
}
