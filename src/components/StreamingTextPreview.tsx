/**
 * Streaming preview row (● + markdown).
 *
 * gold Oa @207919407 / 2.1.312 `Pl`:
 *   {displayed, hideTrailingLine} = Pt(subscribe, getDerived)
 *   if (!displayed) return null
 *   v = transcriptV2===undefined ? "row" : "column"
 *   T = transcriptV2==="label" && Ba ? speaker : false
 *   M = transcriptV2===undefined && Box minWidth 2 ●
 *   E = Box column Ehr
 *   N = Box row [M, E]
 *   return Box alignItems flex-start / flexDirection v / marginTop 1 / width 100% / children [T, N]
 *
 * Official through 2.1.312 still paints a lone ● when wrap-stream (`h1` /
 * `Odo` hideTrailingLine) pops the only visual row — thinking / short open
 * sentence. Local clip (`58f3d6d3`): ● is absolute; inner overflow hidden so
 * leftover-empty column height 0 clips the bullet. Not gold Oa.
 *
 * Prompt (transcriptV2 undefined): T is false. DualInk DA is gold DA.
 */
import { Box, Text } from '@anthropic/ink';
import * as React from 'react';
import { memo, useSyncExternalStore } from 'react';
import { BLACK_CIRCLE } from '../constants/figures.js';
import type { StreamingDisplayStore } from '../utils/streamingTextStore.js';
import { StreamingMarkdown } from './Markdown.js';

type Props = {
  store: StreamingDisplayStore;
};

/** gold Oa = jf(function). Prompt path: transcriptV2 undefined. */
export const StreamingTextPreview = memo(function StreamingTextPreview({ store }: Props): React.ReactNode {
  const { displayed, hideTrailingLine } = useSyncExternalStore(store.subscribe, store.getDerived);
  if (!displayed) return null;

  // gold v / T / M — prompt is transcriptV2===undefined (REPL does not pass v2).
  const transcriptV2 = undefined as 'label' | 'column' | undefined;
  const direction = transcriptV2 === undefined ? 'row' : 'column';
  const speaker = transcriptV2 === 'label' && false;
  const bullet = transcriptV2 === undefined && (
    <Box minWidth={2} position="absolute">
      <Text color="text" aria-label="claude:">
        {BLACK_CIRCLE}
      </Text>
    </Box>
  );
  const column = (
    <Box flexDirection="column" paddingLeft={2}>
      <StreamingMarkdown hideTrailingLine={hideTrailingLine}>{displayed}</StreamingMarkdown>
    </Box>
  );
  const inner = (
    <Box flexDirection="row" overflow="hidden" position="relative">
      {bullet}
      {column}
    </Box>
  );

  return (
    <Box alignItems="flex-start" flexDirection={direction} marginTop={1} width="100%">
      {speaker}
      {inner}
    </Box>
  );
});
