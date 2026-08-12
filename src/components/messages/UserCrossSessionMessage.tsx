/**
 * UserCrossSessionMessage — render a message received from another Claude session
 * via UDS_INBOX (SendMessage tool).
 *
 * densable 2.1.228 #13: sender label prefers from-name (RC session title / selfTitle),
 * else pretty from address (lhm), else "peer"; body shown inline after [sender].
 */
import type { TextBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';
import * as React from 'react';
import { Box, Text } from '@anthropic/ink';
import { extractTag } from '../../utils/messages.js';
import { parseCrossSessionOpenAttrs, resolveCrossSessionSenderLabel } from '../../utils/crossSessionMessage.js';

type Props = {
  addMargin: boolean;
  param: TextBlockParam;
};

export function UserCrossSessionMessage({ param, addMargin }: Props): React.ReactNode {
  const text = param.text;
  const extracted = extractTag(text, 'cross-session-message');
  if (!extracted) {
    return null;
  }

  const attrs = parseCrossSessionOpenAttrs(text);
  const from = resolveCrossSessionSenderLabel({
    from: attrs.from,
    fromName: attrs.fromName,
  });

  return (
    <Box flexDirection="row" marginTop={addMargin ? 1 : 0}>
      <Text dimColor>[{from}] </Text>
      <Text>{extracted}</Text>
    </Box>
  );
}
