import React from 'react';
import { Box, Text } from '@anthropic/ink';
import { ConfirmSelect } from '../../components/ConfirmSelect.js';
import { plural } from '../../utils/stringUtils.js';

export interface ConfirmSetupStepProps {
  repo: string;
  secretName?: string;
  secretKind: 'token' | 'API key';
  workflowCount: number;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Official 2.1.327 (#368) `Ue`: final confirmation before `/install-github-app`
 * pushes a branch or writes a repository secret. Defaults focus to "No, cancel".
 */
export function ConfirmSetupStep({
  repo,
  secretName,
  secretKind,
  workflowCount,
  onConfirm,
  onCancel,
}: ConfirmSetupStepProps): React.ReactNode {
  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1} gap={1}>
      <Box flexDirection="column">
        <Text bold>Install GitHub App</Text>
        <Text dimColor>Last check</Text>
      </Box>
      <Box flexDirection="column">
        <Text>
          Make these changes to <Text bold>{repo}</Text>?
        </Text>
        {workflowCount > 0 && (
          <Text dimColor>
            {'  · '}Push a branch with the Claude workflow {plural(workflowCount, 'file')}
          </Text>
        )}
        {secretName && (
          <Text dimColor>
            {'  · '}Save your {secretKind} as the secret {secretName}, replacing any secret of that name
          </Text>
        )}
      </Box>
      <ConfirmSelect
        cancelFirst
        focus="cancel"
        hideIndexes
        disablePrintableKeybindings
        onUpFromFirstItem={() => {}}
        cancelLabel="No, cancel"
        confirmLabel="Yes, make these changes"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    </Box>
  );
}
