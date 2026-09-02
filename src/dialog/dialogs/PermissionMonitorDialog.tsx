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

function previewNode(preview: UrlPreview): React.ReactNode {
  if (preview.kind === 'withheld') {
    return <Text dimColor>{preview.marker}</Text>;
  }
  return (
    <Box flexDirection={preview.needsGutter ? 'column' : 'row'}>
      <Text>{preview.text}</Text>
    </Box>
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
          <Text dimColor>{`args: ${monitorPreviewText(p.mcp.argsDisplay)}`}</Text>
        ) : null}
      </>
    );
  }
  if (p.ws) {
    const urlText = monitorPreviewText(p.ws.url);
    const protocols = Array.isArray(p.ws.protocols) ? p.ws.protocols.filter(item => typeof item === 'string') : [];
    return (
      <>
        <Box flexDirection={p.ws.url.kind === 'full' && p.ws.url.needsGutter ? 'column' : 'row'}>
          <Text>
            Open WebSocket <Text bold>{urlText}</Text>
          </Text>
        </Box>
        {protocols.length > 0 ? (
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
  const p = payload as MonitorPermissionPayload;
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
    <PermissionDialog title="Monitor" requestSource={p.requestSource}>
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        {monitorBody(p)}
        {monitorDescription !== '' ? <Text dimColor>{monitorDescription}</Text> : null}
      </Box>
      <Box flexDirection="column">
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
