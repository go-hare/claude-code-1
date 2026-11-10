import * as React from 'react';
import { Box, Text } from '@anthropic/ink';
import { isScreenReaderModeEnabled } from '../../utils/screenReaderGate.js';
import { Markdown } from '../Markdown.js';

type Props = {
  addMargin: boolean;
  planContent: string;
};

export function UserPlanMessage({ addMargin, planContent }: Props): React.ReactNode {
  return (
    <Box marginTop={addMargin ? 1 : 0}>
      <Box
        flexDirection="column"
        gap={1}
        borderStyle={isScreenReaderModeEnabled() ? undefined : 'round'}
        borderColor="planMode"
        paddingX={isScreenReaderModeEnabled() ? 0 : 1}
      >
        <Text bold color="planMode">
          Plan to implement
        </Text>
        <Markdown>{planContent}</Markdown>
      </Box>
    </Box>
  );
}
