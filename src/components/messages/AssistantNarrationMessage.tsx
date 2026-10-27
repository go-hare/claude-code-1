import type { ThinkingBlock, ThinkingBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';
import React from 'react';
import { Box, NoSelect, Text } from '@anthropic/ink';
import { BLACK_CIRCLE } from '../../constants/figures.js';
import { Markdown } from '../Markdown.js';

type Props = {
  param: ThinkingBlock | ThinkingBlockParam | { type: 'thinking'; thinking: string };
  addMargin: boolean;
  shouldShowDot: boolean;
  /** densable Za `L$n(p)` — true hides Markdown hint `"summary"`. */
  hideSummaryHint?: boolean;
};

/**
 * densable Message `Za` — leftoverTut narration paints as a claude row, not Ss.
 * Gold: `shouldShowDot` → `aria-label="claude:"` Jr; Markdown `hint` is `"summary"`
 * unless leftoverQuizzicalShore.
 */
export function AssistantNarrationMessage({
  param: { thinking },
  addMargin = false,
  shouldShowDot,
  hideSummaryHint = false,
}: Props): React.ReactNode {
  const body = thinking.trim();
  return (
    <Box flexDirection="row" marginTop={addMargin ? 1 : 0} width="100%">
      {shouldShowDot ? (
        <NoSelect fromLeftEdge minWidth={2}>
          <Text aria-label="claude:" color="text">
            {BLACK_CIRCLE}
          </Text>
        </NoSelect>
      ) : null}
      <Box flexDirection="column" flexGrow={1}>
        <Markdown capProseWidth hint={hideSummaryHint ? undefined : 'summary'}>
          {body}
        </Markdown>
      </Box>
    </Box>
  );
}
