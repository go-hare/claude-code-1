/**
 * densable Wou — permission_monitor DialogHost renderer.
 *
 * Gold 2.1.239: jsu `vM(Nno,Wou)`. Title `kA="Monitor"`. mcp / ws / command
 * preview branches. Esc/onCancel → `{behavior:"deny"}`. bgy via S3+EFA/Yxs.
 * Host answer is store.answer; do not dequeue. Do not invent MonitorTool schema.
 */
import React from 'react';
import { Box, Text } from '@anthropic/ink';
import { PermissionDialog } from '../../components/permissions/PermissionDialog.js';
import { PermissionOverflowBox } from '../../components/permissions/PermissionOverflowBox.js';
import { PermissionPreviewGutter } from '../../components/permissions/PermissionPreviewGutter.js';
import { PermissionPrompt, type PermissionPromptOption } from '../../components/permissions/PermissionPrompt.js';
import { PermissionRuleExplanation } from '../../components/permissions/PermissionRuleExplanation.js';
import type { PermissionDecision } from '../../utils/permissions/PermissionResult.js';
import type { DialogRendererProps } from '../DialogHost.js';
import { APPROVAL_WITHHELD_MARKER, type UrlPreview } from '../permissionBrowser.js';
import {
  buildMonitorSuggestionsRow,
  type MonitorPermissionChoice,
  type MonitorPermissionPayload,
  monitorPreviewText,
  resolveMonitorPermissionAnswer,
  shouldShowMonitorSuggestions,
} from '../permissionMonitor.js';

const MAX_DISPLAYED_NETWORK_HOSTS = 8;
const MAX_NETWORK_HOSTS_CHARS = 160;

function renderNetworkAllowHosts(hosts: readonly string[] | undefined): React.ReactNode {
  if (hosts === undefined || hosts.length === 0) return null;
  const first = hosts[0]!;
  const firstTrimmed =
    first.length > MAX_NETWORK_HOSTS_CHARS ? `…${first.slice(first.length - (MAX_NETWORK_HOSTS_CHARS - 1))}` : first;
  const shown = [firstTrimmed];
  let used = Math.min(shown[0]!.length + 2, MAX_NETWORK_HOSTS_CHARS / 2);
  for (const host of hosts.slice(1)) {
    if (shown.length >= MAX_DISPLAYED_NETWORK_HOSTS) break;
    if (used + host.length > MAX_NETWORK_HOSTS_CHARS) continue;
    shown.push(host);
    used += host.length + 2;
  }
  const remaining = hosts.length - shown.length;
  const more = remaining > 0 ? ` (+${remaining} more, ${hosts.length} in all)` : '';
  return (
    <Box marginBottom={1}>
      <Text>
        Also lets this command reach, beyond the sandbox allowlist: <Text bold>{shown.join(', ')}</Text>
        {more}
      </Text>
    </Box>
  );
}

function previewNode(preview: UrlPreview): React.ReactNode {
  if (preview.kind === 'withheld') {
    return <Text dimColor>{preview.marker}</Text>;
  }
  return (
    <PermissionPreviewGutter multiline={preview.needsGutter}>
      <Text>{preview.text}</Text>
    </PermissionPreviewGutter>
  );
}

function monitorBody(p: MonitorPermissionPayload): React.ReactNode {
  if (p.mcp) {
    const seconds = p.intervalMs / 1000;
    return (
      <>
        <Text>
          Poll <Text bold>{`${p.mcp.server}/${p.mcp.tool}`}</Text> every {seconds}s
        </Text>
        {p.mcp.argsDisplay !== undefined ? (
          <PermissionPreviewGutter multiline={p.mcp.argsDisplay.kind === 'full' && p.mcp.argsDisplay.needsGutter}>
            <Text dimColor>{`args: ${monitorPreviewText(p.mcp.argsDisplay)}`}</Text>
          </PermissionPreviewGutter>
        ) : null}
      </>
    );
  }
  if (p.ws) {
    const urlText = monitorPreviewText(p.ws.url);
    const protocolsWithheld = (p.ws as { protocolsWithheld?: boolean }).protocolsWithheld === true;
    const protocols = Array.isArray(p.ws.protocols) ? p.ws.protocols.filter(item => typeof item === 'string') : [];
    return (
      <>
        <PermissionPreviewGutter multiline={p.ws.url.kind === 'full' && p.ws.url.needsGutter}>
          <Text>
            Open WebSocket <Text bold>{urlText}</Text>
          </Text>
        </PermissionPreviewGutter>
        {protocolsWithheld ? (
          <Text>
            subprotocols: <Text bold>(cannot be shown in full — deny unless expected)</Text>
          </Text>
        ) : protocols.length > 0 ? (
          <Text>
            subprotocols: <Text bold>{protocols.join(', ')}</Text>
          </Text>
        ) : null}
      </>
    );
  }
  if (p.command) {
    return previewNode(p.command);
  }
  return <Text dimColor>{APPROVAL_WITHHELD_MARKER}</Text>;
}

export function PermissionMonitorDialog({ payload, answer }: DialogRendererProps): React.ReactNode {
  const p = payload as MonitorPermissionPayload & { networkAllowHosts?: readonly string[] };
  const row = shouldShowMonitorSuggestions(p) ? buildMonitorSuggestionsRow(p) : null;
  const monitorDescription = typeof p.monitorDescription === 'string' ? p.monitorDescription : '';
  const toolType = p.mcp || p.ws ? 'tool' : 'command';

  const options: PermissionPromptOption<MonitorPermissionChoice>[] = [
    { label: 'Yes', value: 'yes', feedbackConfig: { type: 'accept' } },
  ];
  if (row !== null) {
    options.push({
      label: row.node,
      value: 'yes-apply-suggestions',
    });
  }
  options.push({
    label: 'No',
    value: 'no',
    feedbackConfig: { type: 'reject' },
  });

  return (
    <PermissionDialog title="Monitor" innerPaddingX={0} requestSource={p.requestSource}>
      <Box flexDirection="column" paddingX={1}>
        <PermissionPreviewGutter multiline={monitorDescription.includes('\n')}>
          <Text dimColor>{monitorDescription}</Text>
        </PermissionPreviewGutter>
      </Box>
      <PermissionOverflowBox>{monitorBody(p)}</PermissionOverflowBox>
      <Box flexDirection="column" paddingX={1}>
        {renderNetworkAllowHosts(p.networkAllowHosts)}
        <PermissionRuleExplanation permissionResult={p.permissionResult as PermissionDecision} toolType={toolType} />
        <PermissionPrompt
          options={options}
          onSelect={(choice, feedback) => {
            answer(resolveMonitorPermissionAnswer(choice, p, row, feedback));
          }}
          onCancel={() => {
            answer({ behavior: 'deny' });
          }}
          toolAnalyticsContext={{
            toolName: p.toolName,
            isMcp: false,
          }}
        />
      </Box>
    </PermissionDialog>
  );
}
