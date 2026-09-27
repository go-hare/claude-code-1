/**
 * Streaming preview row (● + markdown).
 *
 * Raw text (no MessageDisplay hook) passes hideTrailingLine so wrap-stream
 * soft-wraps the unfinished tail. Hook output is setTransformed,
 * hideTrailingLine is false, and that string is already sliced to the last
 * newline. Visually empty displayed text (whitespace / strip-only XML /
 * "(no content)") returns null so a lone ● is not painted.
 * wrap-stream pops the incomplete last visual line, so a single open line
 * would otherwise paint ● with an empty body — skip that row too.
 */
import { Box, Text } from '@anthropic/ink';
import * as React from 'react';
import { useSyncExternalStore } from 'react';
import { BLACK_CIRCLE } from '../constants/figures.js';
import { isEmptyMessageText } from '../utils/emptyMessageText.js';
import { resolveStreamingDisplay, type StreamingDisplayStore } from '../utils/streamingTextStore.js';
import { StreamingMarkdown } from './Markdown.js';

type Props = {
  store: StreamingDisplayStore;
};

export function StreamingTextPreview({ store }: Props): React.ReactNode {
  const state = useSyncExternalStore(store.subscribe, store.getState);
  const { displayed, hideTrailingLine, displayedHasNewline } = resolveStreamingDisplay(state);
  // densable: if (!KEl) return null. Local: also hide empty-after-strip,
  // and skip wrap-stream's empty first line (● with no body).
  if (!displayed || isEmptyMessageText(displayed)) return null;
  if (hideTrailingLine && !displayedHasNewline) return null;

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
