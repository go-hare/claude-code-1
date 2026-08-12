/**
 * densable 2.1.224 #5 — gGn / aUl peer_inbound_approval dialog.
 *
 * SEA: title "Held message from another session", Select approve|deny,
 * neh holdCause body, preview «…».
 * Host: peerInboundApprovalQueue (queueBehind) → REPL modal / bottom slot.
 */
import { Box, Dialog, Text } from '@anthropic/ink';
import React, { useMemo } from 'react';
import type { PeerInboundHoldCause } from '../utils/crossSessionInbound.js';
import { peerInboundDialogCauseMessage, UNIDENTIFIED_PEER_SESSION } from '../utils/peerInboundHoldUi.js';
import { Select } from './CustomSelect/index.js';

export type PeerInboundApprovalResult = 'approve' | 'deny' | 'cancelled';

export type PeerInboundApprovalPayload = {
  fromAddress?: string;
  claimedName?: string;
  verifiedPeerPid?: number;
  holdCause: PeerInboundHoldCause;
  preview: string;
};

export type PeerInboundApprovalDialogProps = {
  payload: PeerInboundApprovalPayload;
  onAnswer: (result: PeerInboundApprovalResult) => void;
};

const OPTIONS = [
  {
    value: 'approve' as const,
    label: 'Deliver this message to Claude',
  },
  {
    value: 'deny' as const,
    label: 'Deny — drop it and tell the sender it was declined',
  },
];

export function PeerInboundApprovalDialog({ payload, onAnswer }: PeerInboundApprovalDialogProps): React.ReactNode {
  const from = payload.fromAddress ?? UNIDENTIFIED_PEER_SESSION;
  const pidBit = payload.verifiedPeerPid !== undefined ? ` [verified pid ${payload.verifiedPeerPid}]` : '';
  const nameBit = payload.claimedName ? ` (peer claims name: ${payload.claimedName})` : '';
  const causeText = useMemo(() => peerInboundDialogCauseMessage(payload.holdCause), [payload.holdCause]);

  return (
    <Dialog color="warning" title="Held message from another session" onCancel={() => onAnswer('cancelled')}>
      <Box flexDirection="column" marginTop={1} paddingX={1}>
        <Text>
          Another Claude session sent a message: from {from}
          {pidBit}
          {nameBit}
        </Text>
        <Box marginTop={1}>
          <Text color="inactive">{causeText}</Text>
        </Box>
        {payload.preview !== '' ? (
          <Box marginTop={1} flexDirection="column">
            <Text color="inactive">Message body (this is what will be delivered):</Text>
            <Text>«{payload.preview}»</Text>
          </Box>
        ) : null}
        <Box marginTop={1}>
          <Select
            options={OPTIONS}
            onChange={value => onAnswer(value === 'approve' || value === 'deny' ? value : 'cancelled')}
            onCancel={() => onAnswer('cancelled')}
          />
        </Box>
      </Box>
    </Dialog>
  );
}
