import { Box, Text } from '@anthropic/ink';
import * as React from 'react';
import { useAfkCountdown } from '../../../hooks/useAfkCountdown.js';

type Props = {
  enabled: boolean;
  timeoutMs?: number | null;
  onTimeout: (timeoutMs: number) => void;
};

/**
 * Footer countdown for AskUserQuestion AFK auto-continue (official 2.1.200).
 * Renders only when remaining time is within the countdown threshold.
 */
export function AfkCountdown({ enabled, timeoutMs, onTimeout }: Props): React.ReactNode {
  const { remainingSeconds, showCountdown } = useAfkCountdown({
    enabled,
    timeoutMs,
    onTimeout,
  });

  return (
    <Box height={1} justifyContent="flex-end">
      {showCountdown ? (
        <Text color="inactive" dimColor>
          auto-continue in {remainingSeconds}s · any key to stay
        </Text>
      ) : null}
    </Box>
  );
}
