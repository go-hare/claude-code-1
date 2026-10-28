/**
 * densable `fme` — auto-mode classifier billing notice.
 * DualInk Dialog + confirm:yes; omit baseButton.
 */
import React from 'react';
import { Box, Dialog, Text } from '@anthropic/ink';
import { useKeybinding } from '../../keybindings/useKeybinding.js';

type Props = {
  title: string;
  paragraphs: string[];
  onDone: (result: 'continue' | 'interrupt') => void;
};

export function AutoModeServerFallbackNotice({ title, paragraphs, onDone }: Props): React.ReactNode {
  useKeybinding('confirm:yes', () => onDone('continue'), {
    context: 'Confirmation',
    isActive: true,
  });
  return (
    <Dialog title={title} onCancel={() => onDone('interrupt')}>
      <Box flexDirection="column" gap={1}>
        {paragraphs.map(paragraph => (
          <Text key={paragraph}>{paragraph}</Text>
        ))}
      </Box>
    </Dialog>
  );
}
