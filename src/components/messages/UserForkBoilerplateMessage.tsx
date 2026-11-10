/**
 * UserForkBoilerplateMessage — render the fork/subagent boilerplate directive.
 */
import type { TextBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';
import * as React from 'react';
import { useContext } from 'react';
import { Box, Text } from '@anthropic/ink';
import { FORK_BOILERPLATE_TAG, FORK_DIRECTIVE_PREFIX } from '../../constants/xml.js';
import { extractTag } from '../../utils/messages.js';
import { MessageActionsSelectedContext } from '../messageActions.js';

type Props = {
  addMargin: boolean;
  param?: TextBlockParam;
  directive?: string;
  isTranscriptMode?: boolean;
  timestamp?: string;
};

export function UserForkBoilerplateMessage({ param, directive, addMargin }: Props): React.ReactNode {
  const isSelected = useContext(MessageActionsSelectedContext);

  let resolvedDirective = directive;
  if (resolvedDirective === undefined) {
    if (!param || !extractTag(param.text, FORK_BOILERPLATE_TAG)) return null;
    const closeTag = `</${FORK_BOILERPLATE_TAG}>`;
    const afterTag = param.text.slice(param.text.indexOf(closeTag) + closeTag.length).trimStart();
    resolvedDirective = afterTag.startsWith(FORK_DIRECTIVE_PREFIX)
      ? afterTag.slice(FORK_DIRECTIVE_PREFIX.length)
      : afterTag;
  }

  return (
    <Box
      marginTop={addMargin ? 1 : 0}
      backgroundColor={isSelected ? 'messageActionsBackground' : 'userMessageBackground'}
      paddingRight={1}
    >
      <Text aria-label="fork:" dimColor>
        {'⑂'}
      </Text>
      <Box paddingLeft={1}>
        <Text>{resolvedDirective}</Text>
      </Box>
    </Box>
  );
}
