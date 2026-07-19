import React from 'react';
import { Box, Text, stringWidth } from '@anthropic/ink';
import type { NormalizedMessage } from '../types/message.js';

type Props = {
  message: NormalizedMessage;
  isTranscriptMode: boolean;
  /**
   * densable showMessageTimestamps (silk_hinge) — when true, stamp assistant
   * messages outside transcript mode as well. Transcript mode always stamps
   * assistant text messages when a timestamp is present.
   */
  showMessageTimestamps?: boolean;
};

export function MessageTimestamp({ message, isTranscriptMode, showMessageTimestamps = false }: Props): React.ReactNode {
  // densable l2o: timestamp && assistant && (showMessageTimestamps || transcript+text)
  const hasTimestamp = Boolean(message.timestamp);
  const isAssistant = message.type === 'assistant';
  const hasTextBlock =
    Array.isArray(message.message?.content) &&
    (message.message!.content as { type: string }[]).some(c => c.type === 'text');

  const shouldShowTimestamp =
    hasTimestamp && isAssistant && (showMessageTimestamps || (isTranscriptMode && hasTextBlock));

  if (!shouldShowTimestamp) {
    return null;
  }

  const formattedTimestamp = new Date(message.timestamp as string | number | Date).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });

  return (
    <Box minWidth={stringWidth(formattedTimestamp)}>
      <Text dimColor>{formattedTimestamp}</Text>
    </Box>
  );
}
