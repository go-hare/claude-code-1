import * as React from 'react';
import { MessageResponse } from 'src/components/MessageResponse.js';
import { OutputLine } from 'src/components/shell/OutputLine.js';
import { Text } from '@anthropic/ink';
import type { ToolProgressData } from 'src/Tool.js';
import type { ProgressMessage } from 'src/types/message.js';
import { jsonStringify } from 'src/utils/slowOperations.js';
import type { Output } from './RefreshMcpToolsTool.js';

export function renderToolUseMessage(input: Partial<{ server?: string }>): React.ReactNode {
  return input.server ? `Refresh MCP tools from server "${input.server}"` : `Refresh all MCP tool lists`;
}

export function renderToolResultMessage(
  output: Output,
  _progressMessagesForMessage: ProgressMessage<ToolProgressData>[],
  { verbose }: { verbose: boolean },
): React.ReactNode {
  if (!output || output.length === 0) {
    return (
      <MessageResponse height={1}>
        <Text dimColor>(No MCP servers to refresh)</Text>
      </MessageResponse>
    );
  }

  // eslint-disable-next-line no-restricted-syntax -- human-facing UI, not tool_result
  const formattedOutput = jsonStringify(output, null, 2);

  return <OutputLine content={formattedOutput} verbose={verbose} />;
}
