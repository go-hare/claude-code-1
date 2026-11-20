/**
 * densable 2.1.289 Fg — in-session agent inbound paint.
 * expanded (QM): `> Message from name` (NO `@`) + padded body.
 * !expanded: zX CollapsedPeerMessage.
 * followsSpeakerLabel: body only (Vk wrap or Wg overflow).
 * Never `export function Fg`.
 */
import figures from 'figures';
import * as React from 'react';
import { Box, NoSelect, Text } from '@anthropic/ink';
import { AgentInboundOverflow } from './AgentInboundOverflow.js';
import { CollapsedPeerMessage } from './CollapsedPeerMessage.js';

type Props = {
  addMargin: boolean;
  fromName?: string;
  name: string;
  expanded: boolean;
  uncapped: boolean;
  followsSpeakerLabel: boolean;
  body: string;
};

export function AgentInboundMessage({
  addMargin,
  fromName,
  name,
  expanded,
  uncapped,
  followsSpeakerLabel,
  body,
}: Props): React.ReactNode {
  if (followsSpeakerLabel) {
    return expanded || uncapped ? <Text wrap="wrap">{body}</Text> : <AgentInboundOverflow body={body} />;
  }
  if (!expanded) {
    return <CollapsedPeerMessage displayName={fromName || name} addMargin={addMargin} fallbackLabel="agent" />;
  }
  return (
    <Box flexDirection="column" marginTop={addMargin ? 1 : 0} width="100%">
      <Box flexDirection="row">
        <NoSelect fromLeftEdge minWidth={2}>
          <Text aria-hidden dimColor>
            {figures.pointerSmall}
          </Text>
        </NoSelect>
        <Text dimColor>Message from {name}</Text>
      </Box>
      <Box paddingLeft={2}>
        <Text wrap="wrap">{body}</Text>
      </Box>
    </Box>
  );
}
