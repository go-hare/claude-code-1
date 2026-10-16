import type { TextBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';
import * as React from 'react';
import { BLACK_CIRCLE } from '../../constants/figures.js';
import { Box, Text, type TextProps } from '@anthropic/ink';
import { formatDuration } from '../../utils/format.js';
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
  // densable _p: Number(zr(text,"duration_ms")); suffix ` · ${Qt(y)}` when finite >0.
  const durationMs = Number(extractTag(text, 'duration_ms'));
  const durationSuffix = Number.isFinite(durationMs) && durationMs > 0 ? ` · ${formatDuration(durationMs)}` : null;

  // gold Sp: column + one Text children [circle, " ", summary, duration].
  return (
    <Box flexDirection="column" marginTop={addMargin ? 1 : 0}>
      <Text>
        <Text aria-hidden color={color}>
          {BLACK_CIRCLE}
        </Text>{' '}
        {summary}
        {durationSuffix ? <Text dimColor>{durationSuffix}</Text> : null}
      </Text>
    </Box>
  );
}
