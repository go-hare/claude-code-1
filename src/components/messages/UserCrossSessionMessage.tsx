/**
 * UserCrossSessionMessage — densable 2.1.289 Wr orchestrator.
 *
 * Agent path: Fg (AgentInboundMessage). UDS path: [name] expanded or zX.
 * QM(verbose, transcript) expands. followsSpeakerLabel is speaker_label only.
 * Never `export function Wr|Fg|zX`.
 */
import type { TextBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';
import figures from 'figures';
import * as React from 'react';
import { Box, Text } from '@anthropic/ink';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import { useAppStateMaybeOutsideOfProvider } from '../../state/AppState.js';
import { toInkColor } from '../../utils/ink.js';
import { extractTag, isPeerHandbackOrFlaggedOrigin, stripPeerOverflowFrame } from '../../utils/messages.js';
import {
  agentMessageOverflow,
  parseAgentMessageFromAttr,
  parseCrossSessionOpenAttrs,
  resolveCrossSessionSenderLabel,
  sanitizeCrossSessionDisplayName,
  stripAgentMessageEnvelope,
  stripHandbackReportFrame,
} from '../../utils/crossSessionMessage.js';
import { Markdown } from '../Markdown.js';
import { PluginUserMessageSite } from '../PluginRasterPanes.js';
import { AgentInboundMessage } from './AgentInboundMessage.js';
import { CollapsedPeerMessage } from './CollapsedPeerMessage.js';

type Props = {
  addMargin: boolean;
  param: TextBlockParam;
  isTranscriptMode?: boolean;
  /** densable Fg `expanded` — QM(verbose, transcript). */
  verbose?: boolean;
  /** densable Fg fromName — subagent/peer display, before envelope parse. */
  fromName?: string;
  /** densable zX fallbackLabel — gold agent vs UDS peer. */
  fallbackLabel?: string;
  /** densable Urs hostInjected — strips host-injected peer suffix. */
  hostInjected?: boolean;
  /** densable Wr origin — irr handback/flagged. */
  origin?: {
    kind?: string;
    handback?: unknown;
    flagged?: unknown;
    plugin?: string;
    hostInjected?: unknown;
  };
  /** densable Wr followsSpeakerLabel — speaker_label row, not analog agent inbound. */
  followsSpeakerLabel?: boolean;
  /** densable Wr messageId — TDe / PluginUserMessageSite. */
  messageId?: string;
};

export function UserCrossSessionMessage({
  param,
  addMargin,
  isTranscriptMode = false,
  verbose = false,
  fromName,
  fallbackLabel = 'peer',
  origin,
  followsSpeakerLabel = false,
  hostInjected = false,
  messageId,
}: Props): React.ReactNode {
  const text = param.text;
  const injected = hostInjected || (origin?.kind === 'peer' && origin.hostInjected === true);
  const extracted = extractTag(text, 'cross-session-message');
  const attrs = parseCrossSessionOpenAttrs(text);
  const isAgentFallback = fallbackLabel === 'agent';
  // densable Xx: Oh(fromName)||"agent". Envelope from= fills when origin.name is missing.
  const rawName = isAgentFallback ? fromName || parseAgentMessageFromAttr(text) || '' : '';
  const from = isAgentFallback
    ? sanitizeCrossSessionDisplayName(rawName)
    : resolveCrossSessionSenderLabel({
        from: attrs.from ?? fromName,
        fromName: attrs.fromName ?? fromName,
      });
  const displayName = from || fallbackLabel;
  const senderPlugin =
    origin?.kind === 'peer' && typeof origin.plugin === 'string' ? sanitizeCrossSessionDisplayName(origin.plugin) : '';
  const appVerbose = useAppStateMaybeOutsideOfProvider(s => s.verbose) === true;
  // densable jg: strip <agent-message> so expanded body is the payload.
  const stripped = extracted ?? (isAgentFallback ? stripAgentMessageEnvelope(text) : text);
  const framed = stripPeerOverflowFrame(stripped, injected);
  // densable Jx: peel y7n frame when peer handback (Ko(KO) analog-skip).
  const body =
    origin?.kind === 'peer' && origin.handback === true && !appVerbose ? stripHandbackReportFrame(framed) : framed;
  const isEnvelope = extracted !== null;
  const qmExpanded = isTranscriptMode || verbose;
  const uncapped = isPeerHandbackOrFlaggedOrigin(origin);
  const { columns } = useTerminalSize();
  const siteExpanded = isAgentFallback
    ? qmExpanded || (followsSpeakerLabel && (uncapped || agentMessageOverflow(body, Math.max(1, columns)) === null))
    : qmExpanded || followsSpeakerLabel;

  const painted = isAgentFallback ? (
    <AgentInboundMessage
      addMargin={addMargin}
      fromName={rawName || displayName}
      name={displayName}
      expanded={qmExpanded}
      uncapped={uncapped}
      followsSpeakerLabel={followsSpeakerLabel}
      body={body}
    />
  ) : followsSpeakerLabel ? (
    <Text wrap="wrap">{body}</Text>
  ) : qmExpanded ? (
    <Box flexDirection="column" marginTop={addMargin ? 1 : 0} width="100%">
      <Text color={toInkColor(undefined)}>
        {'@ '}
        {displayName}
        {senderPlugin ? <Text dimColor>{` <${senderPlugin} plugin>`}</Text> : null}
        <Text aria-hidden>{figures.pointer}</Text>
      </Text>
      <Box paddingLeft={2}>
        <Markdown stripPromptTags={false}>{body}</Markdown>
      </Box>
    </Box>
  ) : (
    <CollapsedPeerMessage
      displayName={displayName}
      addMargin={addMargin}
      fallbackLabel={fallbackLabel}
      body={isEnvelope ? body : undefined}
    />
  );

  if (messageId === undefined) return painted;
  return (
    <PluginUserMessageSite
      requestId={messageId}
      text={body}
      origin={origin?.kind !== undefined ? { ...origin, kind: origin.kind } : undefined}
      isExpanded={siteExpanded}
      from={{ name: displayName }}
    >
      {painted}
    </PluginUserMessageSite>
  );
}
