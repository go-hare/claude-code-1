import type { TextBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';
import * as React from 'react';
import { BLACK_CIRCLE } from '../../constants/figures.js';
import { Box, Text, type TextProps } from '@anthropic/ink';
import { extractTag } from '../../utils/messages.js';

type Props = {
  addMargin: boolean;
  param: TextBlockParam;
};

function getStatusColor(status: string | null): TextProps['color'] {
  switch (status) {
    case 'completed':
      return 'success';
    case 'failed':
      return 'error';
    case 'killed':
      return 'warning';
    default:
      return 'text';
  }
}

export function UserAgentNotificationMessage({ addMargin, param: { text } }: Props): React.ReactNode {
  const summary = extractTag(text, 'summary');
  if (!summary) return null;

  const status = extractTag(text, 'status');
  const color = getStatusColor(status);

  // width=100% + column split matches UserTeammateMessage / AssistantTextMessage.
  // A single unbounded <Text> measures as one row; ConPTY then hard-wraps the
  // long orphan summary and the next message (Interrupted) overwrites the
  // middle of the sentence.
  return (
    <Box flexDirection="row" marginTop={addMargin ? 1 : 0} width="100%">
      <Box minWidth={2} flexShrink={0}>
        <Text color={color}>{BLACK_CIRCLE}</Text>
      </Box>
      <Box flexDirection="column" flexGrow={1} flexShrink={1}>
        <Text color={color}>{summary}</Text>
      </Box>
    </Box>
  );
}
