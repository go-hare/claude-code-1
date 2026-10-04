/**
 * Streaming preview row (● + markdown).
 *
 * gold yi @203236672: outer `width:100%` row, then an inner row of
 * `[minWidth 2 ●, column]`. Completed assistant text (@202887955) is a
 * single `[dot, column]` row — do not flatten streaming to that.
 *
 * wrap-stream (`qv`/`_g` paint + `h1` measure) pops the last visual row.
 * Gold measure subtracts that row *before* the "fits in container" return,
 * so a short open sentence is height 0. An in-flow ● is still height 1 and
 * paints a lone bullet. Keep the ● out of flow (absolute) and clip the inner
 * row to the wrap-stream column — leftover empty → inner height 0, ● clipped.
 * Official yi is still `if (!displayed) return null` only.
 *
 * Raw text (no MessageDisplay hook) passes hideTrailingLine so wrap-stream
 * soft-wraps the unfinished tail. Hook output is setTransformed,
 * hideTrailingLine is false, and that string is already sliced to the last
 * newline. Visually empty displayed text (whitespace / strip-only XML /
 * "(no content)") returns null so a lone ● is not painted.
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

  // gold yi: outer alignItems flex-start / row / marginTop 1 / width 100%.
  // Inner [●, column]: ● is absolute so wrap-stream height owns the row.
  // overflow hidden clips the ● when wrap-stream leftover is empty (height 0).
  // Column has NO flexGrow (202890377 is thinking).
  return (
    <Box alignItems="flex-start" flexDirection="row" marginTop={1} width="100%">
      <Box flexDirection="row" overflow="hidden" position="relative">
        <Box minWidth={2} position="absolute">
          <Text color="text" aria-label="claude:">
            {BLACK_CIRCLE}
          </Text>
        </Box>
        <Box flexDirection="column" paddingLeft={2}>
          <StreamingMarkdown hideTrailingLine={hideTrailingLine}>{displayed}</StreamingMarkdown>
        </Box>
      </Box>
    </Box>
  );
}
