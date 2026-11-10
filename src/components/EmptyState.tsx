import type * as React from 'react';
import { Box, Text } from '@anthropic/ink';

/**
 * densable `Xr` @197375096 — dim message, optional dim hint on the next line.
 */
export function EmptyState({ children, hint }: { children: React.ReactNode; hint?: React.ReactNode }): React.ReactNode {
  if (!hint) {
    return <Text dimColor>{children}</Text>;
  }
  return (
    <Box flexDirection="column">
      <Text dimColor>{children}</Text>
      <Text dimColor>{hint}</Text>
    </Box>
  );
}
