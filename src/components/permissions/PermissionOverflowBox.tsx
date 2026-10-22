/**
 * densable `Aa` — permission preview clip box.
 * Gold @207522107: dashed (solid when screen-reader) top/bottom border,
 * `overflow:"hidden"`, no left/right border. Bash wraps the command preview
 * in this so Select stays on screen; plan wraps the markdown body.
 */
import React, { type ReactNode } from 'react';
import { Box } from '@anthropic/ink';
import { isScreenReaderModeEnabled } from '../../utils/screenReaderGate.js';

type Props = {
  children: ReactNode;
  paddingX?: number;
  marginTop?: number;
  marginBottom?: number;
};

export function PermissionOverflowBox({ children, paddingX = 1, marginTop, marginBottom }: Props): React.ReactNode {
  return (
    <Box
      borderStyle={isScreenReaderModeEnabled() ? undefined : 'dashed'}
      borderColor="subtle"
      borderLeft={false}
      borderRight={false}
      flexDirection="column"
      overflow="hidden"
      paddingX={paddingX}
      marginTop={marginTop}
      marginBottom={marginBottom}
    >
      {children}
    </Box>
  );
}
