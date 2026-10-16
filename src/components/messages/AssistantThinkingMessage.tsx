import type { ThinkingBlock, ThinkingBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';
import React from 'react';
import { Box, Text } from '@anthropic/ink';
import { THEREFORE } from '../../constants/figures.js';
import { Markdown } from '../Markdown.js';
import { stripPromptXMLTags } from '../../utils/emptyMessageText.js';

type Props = {
  param: ThinkingBlock | ThinkingBlockParam | { type: 'thinking'; thinking: string };
  addMargin: boolean;
  isTranscriptMode: boolean;
  verbose: boolean;
  /** When true, hide this thinking block entirely (used for past thinking in transcript mode) */
  hideInTranscript?: boolean;
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
  hideInTranscript = false,
}: Props): React.ReactNode {
  if (hideInTranscript) {
    return null;
  }

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
      <Box minWidth={2}>
        <Text aria-label="thinking:" dimColor italic>
          {THEREFORE}
        </Text>
      </Box>
      <Box flexDirection="column" flexGrow={1}>
        {body}
      </Box>
    </Box>
  );
}
