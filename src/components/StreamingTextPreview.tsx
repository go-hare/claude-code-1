/**
 * densable XEl — streaming text preview row (● + StreamingMarkdown).
 * Reads densable WNf store via useSyncExternalStore + Qci resolve.
 *
 * densable gate is `if (!displayed) return null`. We additionally treat
 * isEmptyMessageText (whitespace / strip-only XML) as empty so ● is not
 * painted with a blank StreamingMarkdown body — same empty rule as
 * AssistantTextMessage final path.
 */
import { Box, Text } from '@anthropic/ink';
import * as React from 'react';
import { useSyncExternalStore } from 'react';
import { BLACK_CIRCLE } from '../constants/figures.js';
import { isEmptyMessageText } from '../utils/messages.js';
import { resolveStreamingDisplay, type StreamingDisplayStore } from '../utils/streamingTextStore.js';
import { StreamingMarkdown } from './Markdown.js';

type Props = {
  store: StreamingDisplayStore;
};

export function StreamingTextPreview({ store }: Props): React.ReactNode {
  const state = useSyncExternalStore(store.subscribe, store.getState);
  const { displayed, hideTrailingLine } = resolveStreamingDisplay(state);
  // densable: if (!KEl) return null. Local: also hide empty-after-strip.
  if (!displayed || isEmptyMessageText(displayed)) return null;

  return (
    <Box alignItems="flex-start" flexDirection="row" marginTop={1} width="100%">
      <Box flexDirection="row">
        <Box minWidth={2}>
          <Text color="text" aria-label="claude:">
            {BLACK_CIRCLE}
          </Text>
        </Box>
        <Box flexDirection="column">
          <StreamingMarkdown hideTrailingLine={hideTrailingLine}>{displayed}</StreamingMarkdown>
        </Box>
      </Box>
    </Box>
  );
}
