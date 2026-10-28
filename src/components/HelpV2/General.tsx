import * as React from 'react';
import { Box, Text } from '@anthropic/ink';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import { PromptInputHelpMenu } from '../PromptInput/PromptInputHelpMenu.js';

/** densable 2.1.289 Help `T` compact threshold (`j=44`). */
const HELP_GENERAL_COMPACT_ROWS = 44;

/**
 * densable 2.1.289 Help General `T` @218283474.
 * Tagline + optional /powerup hint + Shortcuts (PromptInputHelpMenu).
 */
export function General(): React.ReactNode {
  const { rows } = useTerminalSize();
  const compact = rows < HELP_GENERAL_COMPACT_ROWS;
  const paddingY = compact ? 0 : 1;
  const gap = compact ? 0 : 1;

  return (
    <Box flexDirection="column" paddingY={paddingY} gap={gap}>
      <Box flexShrink={0}>
        <Text>
          Claude understands your codebase, makes edits with your permission, and executes commands — right from your
          terminal.
        </Text>
      </Box>
      {!compact && (
        <Box>
          <Text dimColor>
            New here? Run <Text color="suggestion">/powerup</Text> to learn the features most people miss.
          </Text>
        </Box>
      )}
      <Box flexDirection="column">
        <Box flexShrink={0}>
          <Text bold>Shortcuts</Text>
        </Box>
        <PromptInputHelpMenu gap={2} fixedWidth={true} />
      </Box>
    </Box>
  );
}
