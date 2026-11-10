import * as React from 'react';
import { Box, Text } from '@anthropic/ink';
import {
  isShutdownApproved,
  isShutdownRejected,
  isShutdownRequest,
  type ShutdownRejectedMessage,
  type ShutdownRequestMessage,
} from '../../utils/teammateMailbox.js';

type ShutdownRequestProps = {
  request: ShutdownRequestMessage;
  replyInstructions?: string;
};

/**
 * Renders a shutdown request with a warning-colored border.
 */
export function ShutdownRequestDisplay({ request, replyInstructions }: ShutdownRequestProps): React.ReactNode {
  return (
    <Box flexDirection="column" marginY={1}>
      <Box borderStyle="round" borderColor="warning" flexDirection="column" paddingX={1} paddingY={1}>
        <Box marginBottom={1}>
          <Text color="warning" bold>
            Shutdown request from {request.from}
          </Text>
        </Box>
        {request.reason && (
          <Box>
            <Text>Reason: {request.reason}</Text>
          </Box>
        )}
      </Box>
      {replyInstructions && <Text dimColor>{replyInstructions}</Text>}
    </Box>
  );
}

type ShutdownRejectedProps = {
  response: ShutdownRejectedMessage;
};

/**
 * Renders a shutdown rejected message with a subtle (grey) border.
 */
export function ShutdownRejectedDisplay({ response }: ShutdownRejectedProps): React.ReactNode {
  return (
    <Box flexDirection="column" marginY={1}>
      <Box borderStyle="round" borderColor="subtle" flexDirection="column" paddingX={1} paddingY={1}>
        <Text color="subtle" bold>
          Shutdown rejected by {response.from}
        </Text>
        <Box
          marginTop={1}
          borderStyle="dashed"
          borderColor="subtle"
          borderLeft={false}
          borderRight={false}
          paddingX={1}
        >
          <Text>Reason: {response.reason}</Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Teammate is continuing to work. You may request shutdown again later.</Text>
        </Box>
      </Box>
    </Box>
  );
}

/**
 * Try to parse and render a shutdown message from raw content.
 * Returns the rendered component if it's a shutdown message, null otherwise.
 */
export function tryRenderShutdownMessage(content: string): React.ReactNode | null {
  const splitIdx = content.indexOf('\n\n');
  const jsonPart = splitIdx === -1 ? content : content.slice(0, splitIdx);
  const request = isShutdownRequest(jsonPart);
  if (request) {
    const replyInstructions = splitIdx === -1 ? undefined : content.slice(splitIdx + 2);
    return <ShutdownRequestDisplay request={request} replyInstructions={replyInstructions} />;
  }

  // Shutdown approved is handled inline by the caller — skip it here
  if (isShutdownApproved(content)) {
    return null;
  }

  const rejected = isShutdownRejected(content);
  if (rejected) {
    return <ShutdownRejectedDisplay response={rejected} />;
  }

  return null;
}

/**
 * Get a brief summary text for a shutdown message.
 * Used in places like the inbox queue where we want a short description.
 * Returns null if the content is not a shutdown message.
 */
export function getShutdownMessageSummary(content: string): string | null {
  const splitIdx = content.indexOf('\n\n');
  const jsonPart = splitIdx === -1 ? content : content.slice(0, splitIdx);
  const request = isShutdownRequest(jsonPart);
  if (request) {
    return `[Shutdown Request from ${request.from}]${request.reason ? ` ${request.reason}` : ''}`;
  }

  const approved = isShutdownApproved(content);
  if (approved) {
    return `[Shutdown Approved] ${approved.from} is now exiting`;
  }

  const rejected = isShutdownRejected(content);
  if (rejected) {
    return `[Shutdown Rejected] ${rejected.from}: ${rejected.reason}`;
  }

  return null;
}
