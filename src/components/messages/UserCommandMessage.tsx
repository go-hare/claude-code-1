import type { TextBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';
import figures from 'figures';
import * as React from 'react';
import { COMMAND_MESSAGE_TAG } from '../../constants/xml.js';
import { Box, Text } from '@anthropic/ink';
import { extractTag } from '../../utils/messages.js';
import { unescapeXmlEntities } from '../../utils/xml.js';

type Props = {
  addMargin: boolean;
  param: TextBlockParam;
};

export function UserCommandMessage({ addMargin, param: { text } }: Props): React.ReactNode {
  // densable oX — command-message/args may carry EHe/Ua entities (mid-response slash)
  const commandMessageRaw = extractTag(text, COMMAND_MESSAGE_TAG);
  const commandMessage = commandMessageRaw === null ? null : unescapeXmlEntities(commandMessageRaw);
  const argsRaw = extractTag(text, 'command-args');
  const args = argsRaw === null ? null : unescapeXmlEntities(argsRaw);
  const isSkillFormat = extractTag(text, 'skill-format') === 'true';

  if (!commandMessage) {
    return null;
  }

  // Skills use "Skill(name)" format
  if (isSkillFormat) {
    return (
      <Box
        flexDirection="column"
        marginTop={addMargin ? 1 : 0}
        backgroundColor="userMessageBackground"
        paddingRight={1}
      >
        <Text>
          <Text color="subtle">{figures.pointer} </Text>
          <Text color="text">Skill({commandMessage})</Text>
        </Text>
      </Box>
    );
  }

  // Slash command format: show as "❯ /command args"
  const content = `/${[commandMessage, args].filter(Boolean).join(' ')}`;
  return (
    <Box flexDirection="column" marginTop={addMargin ? 1 : 0} backgroundColor="userMessageBackground" paddingRight={1}>
      <Text>
        <Text color="subtle">{figures.pointer} </Text>
        <Text color="text">{content}</Text>
      </Text>
    </Box>
  );
}
