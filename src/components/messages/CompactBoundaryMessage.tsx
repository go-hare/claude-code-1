import * as React from 'react';
import { Box, Text } from '@anthropic/ink';
import { useShortcutDisplay } from '../../keybindings/useShortcutDisplay.js';

type Props = {
  leadsToSummary?: boolean;
  savedIn?: string;
};

export function CompactBoundaryMessage({ leadsToSummary, savedIn }: Props = {}): React.ReactNode {
  const historyShortcut = useShortcutDisplay('app:toggleTranscript', 'Global', 'ctrl+o');
  const hint =
    leadsToSummary === undefined
      ? ` (${historyShortcut} for history)`
      : leadsToSummary
        ? ` (${historyShortcut} for the summary)`
        : '';

  return (
    <Box flexDirection="column" marginY={1}>
      <Text dimColor>
        <Text aria-hidden>{'✻ '}</Text>
        Conversation compacted{hint}
      </Text>
      {savedIn !== undefined && (
        <Box paddingLeft={2}>
          <Text dimColor>Earlier messages are saved in {savedIn}</Text>
        </Box>
      )}
    </Box>
  );
}
