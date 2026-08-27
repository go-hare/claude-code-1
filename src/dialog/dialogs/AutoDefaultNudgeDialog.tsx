/**
 * densable Veu / p2A — auto_default_nudge DialogHost renderer.
 */
import React from 'react';
import { Box, Dialog, Text } from '@anthropic/ink';
import { Select } from '../../components/CustomSelect/index.js';

export type AutoDefaultNudgeResult = 'accepted' | 'declined' | 'cancelled';

type Props = {
  currentMode?: string;
  onAnswer: (result: AutoDefaultNudgeResult) => void;
};

export function AutoDefaultNudgeDialog({ currentMode, onAnswer }: Props): React.ReactNode {
  return (
    <Dialog title="Try auto mode as your default?" color="warning" onCancel={() => onAnswer('cancelled')}>
      <Box flexDirection="column" gap={1}>
        <Text>
          Auto mode can handle routine permission prompts for you
          {currentMode ? ` (current mode: ${currentMode})` : ''}.
        </Text>
        <Select
          options={[
            { value: 'accepted', label: 'Yes, set auto as default' },
            { value: 'declined', label: 'Not now' },
          ]}
          onChange={value => onAnswer(value as 'accepted' | 'declined')}
          onCancel={() => onAnswer('cancelled')}
        />
      </Box>
    </Dialog>
  );
}
