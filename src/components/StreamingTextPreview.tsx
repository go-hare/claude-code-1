/**
 * Streaming preview row (● + markdown).
 *
 * Raw text (no MessageDisplay hook) passes hideTrailingLine so wrap-stream
 * soft-wraps the unfinished tail. Hook output is setTransformed,
 * hideTrailingLine is false, and that string is already sliced to the last
 * newline. Visually empty displayed text (whitespace / strip-only XML /
 * "(no content)") returns null so a lone ● is not painted.
 * wrap-stream pops the unfinished last visual line at paint (Ink qv). Gold
 * Ty still returns the merged buffer so a long first paragraph without `\n`
 * is visible. Empty-after-strip still returns null (no lone ●).
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
  const { displayed, hideTrailingLine } = resolveStreamingDisplay(state);
  // densable yi @203236672: if (!p) return null. Empty-after-strip is
  // already null in resolveStreamingDisplay.
  if (!displayed || isEmptyMessageText(displayed)) return null;

  // gold yi: outer alignItems flex-start / row / marginTop 1 / width 100%;
  // inner [minWidth 2 ●, column] — column has NO flexGrow (202890377 is thinking).
  return (
    <Box alignItems="flex-start" flexDirection="row" marginTop={1} width="100%">
      <Box minWidth={2}>
        <Text color="text" aria-label="claude:">
          {BLACK_CIRCLE}
        </Text>
      </Box>
      <Box flexDirection="column">
        <StreamingMarkdown hideTrailingLine={hideTrailingLine}>{displayed}</StreamingMarkdown>
      </Box>
    </Box>
  );
}
