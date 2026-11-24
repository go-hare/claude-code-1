import type { ThinkingBlock, ThinkingBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';
import React from 'react';
import { Box, NoSelect, Text } from '@anthropic/ink';
import { THEREFORE } from '../../constants/figures.js';
import { Markdown } from '../Markdown.js';
import { stripPromptXMLTags } from '../../utils/emptyMessageText.js';

type Props = {
  param: ThinkingBlock | ThinkingBlockParam | { type: 'thinking'; thinking: string };
  addMargin: boolean;
  isTranscriptMode: boolean;
  verbose: boolean;
};

/**
 * densable 2.1.289 Ss — `∴` + thinking body.
 * Default: one italic collapsed line. Transcript/verbose: Markdown column.
 */
export function AssistantThinkingMessage({
  param: { thinking },
  addMargin = false,
  isTranscriptMode,
  verbose,
}: Props): React.ReactNode {
  const stripped = stripPromptXMLTags(thinking).trim();
  if (!stripped) {
    return null;
  }

  const expanded = isTranscriptMode || verbose;
  const body = expanded ? (
    <Markdown dimColor capProseWidth>
      {stripped}
    </Markdown>
  ) : (
    <Text dimColor italic>
      {stripped.replace(/\s+/g, ' ')}
    </Text>
  );

  return (
    <Box flexDirection="row" marginTop={addMargin ? 1 : 0} width="100%">
      <NoSelect fromLeftEdge minWidth={2}>
        <Text aria-label="thinking:" dimColor>
          {THEREFORE}
        </Text>
      </NoSelect>
      <Box flexDirection="column" flexGrow={1}>
        {body}
      </Box>
    </Box>
  );
}
