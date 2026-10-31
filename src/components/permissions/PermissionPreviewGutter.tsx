/**
 * densable `Xs` — permission preview gutter.
 * Gold @207975638: screen-reader → aria-role blockquote and return;
 * `!multiline` → children as-is; else left-only dim single border + paddingLeft 1.
 * Cmy/tyy wrap the command in Aa then Xs(`needsGutter`). Do not wrap="wrap"
 * the full verbose command.
 */
import React, { type ReactNode } from 'react';
import { Box } from '@anthropic/ink';
import { isScreenReaderModeEnabled } from '../../utils/screenReaderGate.js';

type Props = {
  multiline?: boolean;
  children: ReactNode;
};

export function PermissionPreviewGutter({ multiline = false, children }: Props): React.ReactNode {
  if (isScreenReaderModeEnabled()) {
    return <Box accessibility={{ role: 'blockquote' }}>{children}</Box>;
  }
  if (!multiline) {
    return children;
  }
  return (
    <Box
      borderStyle="single"
      borderLeft
      borderRight={false}
      borderTop={false}
      borderBottom={false}
      borderDimColor
      paddingLeft={1}
    >
      {children}
    </Box>
  );
}
