import React from 'react';
import { MessageResponse } from 'src/components/MessageResponse.js';
import { Text } from '@anthropic/ink';
import { countCharInString } from 'src/utils/stringUtils.js';
import type { Input, Output } from './RemoteTriggerTool.js';

export function renderToolUseMessage(input: Partial<Input>): React.ReactNode {
  const id = input.session_id ?? input.trigger_id;
  return `${input.action ?? ''}${id ? ` ${id}` : ''}`;
}

export function renderToolResultMessage(output: Output): React.ReactNode {
  const lines = countCharInString(output.json, '\n') + 1;
  return (
    <MessageResponse>
      <Text>
        HTTP {output.status} <Text dimColor>({lines} lines)</Text>
      </Text>
    </MessageResponse>
  );
}
