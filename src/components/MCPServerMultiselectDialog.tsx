import partition from 'lodash-es/partition.js';
import uniq from 'lodash-es/uniq.js';
import React, { useCallback } from 'react';
import { logEvent } from 'src/services/analytics/index.js';
import { Box, Text } from '@anthropic/ink';
import { formatMcpServerLabel } from '../services/mcp/formatMcpServerLabel.js';
import { approveSessionMcpServers, rejectSessionMcpServers } from '../services/mcp/mcpSessionApprovedServers.js';
import { getProjectPathForConfig } from '../utils/config.js';
import { getSettings_DEPRECATED, updateSettingsForSource } from '../utils/settings/settings.js';
import { ConfigurableShortcutHint } from './ConfigurableShortcutHint.js';
import { SelectMulti } from './CustomSelect/SelectMulti.js';
import { Byline, Dialog, KeyboardShortcutHint } from '@anthropic/ink';
import { MCPServerDialogCopy } from './MCPServerDialogCopy.js';
import type { McpApprovalPersistResult } from './MCPServerApprovalDialog.js';

type Props = {
  serverNames: string[];
  /** densable ce `pluginServerNames` — option labels go through UKc/`v`. */
  pluginServerNames?: Set<string>;
  onDone(result: McpApprovalPersistResult): void;
};

export function MCPServerMultiselectDialog({ serverNames, pluginServerNames, onDone }: Props): React.ReactNode {
  const pluginNames = pluginServerNames ?? new Set<string>();

  function onSubmit(selectedServers: string[]) {
    const [approvedServers, rejectedServers] = partition(serverNames, server => selectedServers.includes(server));

    logEvent('tengu_mcp_multidialog_choice', {
      approved: approvedServers.length,
      rejected: rejectedServers.length,
    });

    let persistFailed = false;
    if (approvedServers.length > 0) {
      const currentSettings = getSettings_DEPRECATED() || {};
      const { error } = updateSettingsForSource('localSettings', {
        enabledMcpjsonServers: uniq([...(currentSettings.enabledMcpjsonServers || []), ...approvedServers]),
      });
      persistFailed ||= error != null;
    }

    if (rejectedServers.length > 0) {
      const currentSettings = getSettings_DEPRECATED() || {};
      const { error } = updateSettingsForSource('localSettings', {
        disabledMcpjsonServers: uniq([...(currentSettings.disabledMcpjsonServers || []), ...rejectedServers]),
      });
      persistFailed ||= error != null;
    }

    // densable h(C(), n) — comma after the enabled write; empty n is a no-op
    approveSessionMcpServers(getProjectPathForConfig(), approvedServers);
    rejectSessionMcpServers(getProjectPathForConfig(), rejectedServers);

    onDone({ persistFailed });
  }

  const handleEscRejectAll = useCallback(() => {
    const currentSettings = getSettings_DEPRECATED() || {};
    rejectSessionMcpServers(getProjectPathForConfig(), serverNames);
    const { error } = updateSettingsForSource('localSettings', {
      disabledMcpjsonServers: uniq([...(currentSettings.disabledMcpjsonServers || []), ...serverNames]),
    });
    onDone({ persistFailed: error != null });
  }, [serverNames, onDone]);

  return (
    <>
      <Dialog
        title={`${serverNames.length} new MCP servers found in this project`}
        subtitle="Select any you wish to enable."
        color="warning"
        onCancel={handleEscRejectAll}
        hideInputGuide
      >
        <MCPServerDialogCopy />

        <SelectMulti
          options={serverNames.map(server => ({
            label: formatMcpServerLabel(server, pluginNames.has(server)),
            value: server,
          }))}
          defaultValue={serverNames}
          onSubmit={onSubmit}
          onCancel={handleEscRejectAll}
          hideIndexes
        />
      </Dialog>
      <Box paddingX={1}>
        <Text dimColor italic>
          <Byline>
            <KeyboardShortcutHint shortcut="Space" action="select" />
            <KeyboardShortcutHint shortcut="Enter" action="confirm" />
            <ConfigurableShortcutHint
              action="confirm:no"
              context="Confirmation"
              fallback="Esc"
              description="reject all"
            />
          </Byline>
        </Text>
      </Box>
    </>
  );
}
