import React from 'react';
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js';
import { formatMcpServerLabel } from '../services/mcp/formatMcpServerLabel.js';
import { approveSessionMcpServers, rejectSessionMcpServers } from '../services/mcp/mcpSessionApprovedServers.js';
import { getProjectPathForConfig } from '../utils/config.js';
import { getSettings_DEPRECATED, updateSettingsForSource } from '../utils/settings/settings.js';
import { Select } from './CustomSelect/index.js';
import { Dialog } from '@anthropic/ink';
import { MCPServerDialogCopy } from './MCPServerDialogCopy.js';

export type McpApprovalPersistResult = {
  persistFailed: boolean;
};

type Props = {
  serverName: string;
  /** densable ee `isPluginServer` — titles go through UKc/`v`. */
  isPluginServer?: boolean;
  onDone(result: McpApprovalPersistResult): void;
};

export function MCPServerApprovalDialog({ serverName, isPluginServer = false, onDone }: Props): React.ReactNode {
  function onChange(value: 'yes' | 'yes_all' | 'no') {
    logEvent('tengu_mcp_dialog_choice', {
      choice: value as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    });

    switch (value) {
      case 'yes':
      case 'yes_all': {
        let persistFailed = false;
        const currentSettings = getSettings_DEPRECATED() || {};
        const enabledServers = currentSettings.enabledMcpjsonServers || [];

        if (!enabledServers.includes(serverName)) {
          const { error } = updateSettingsForSource('localSettings', {
            enabledMcpjsonServers: [...enabledServers, serverName],
          });
          persistFailed ||= error != null;
        }

        if (value === 'yes_all') {
          const { error } = updateSettingsForSource('localSettings', {
            enableAllProjectMcpServers: true,
          });
          persistFailed ||= error != null;
        }
        // densable h(C(), [r]) — even when persistFailed
        approveSessionMcpServers(getProjectPathForConfig(), [serverName]);
        onDone({ persistFailed });
        break;
      }
      case 'no': {
        const currentSettings = getSettings_DEPRECATED() || {};
        const disabledServers = currentSettings.disabledMcpjsonServers || [];
        rejectSessionMcpServers(getProjectPathForConfig(), [serverName]);

        if (!disabledServers.includes(serverName)) {
          const { error } = updateSettingsForSource('localSettings', {
            disabledMcpjsonServers: [...disabledServers, serverName],
          });
          onDone({ persistFailed: error != null });
          break;
        }
        onDone({ persistFailed: false });
        break;
      }
    }
  }

  return (
    <Dialog
      title={`New MCP server found in this project: ${formatMcpServerLabel(serverName, isPluginServer)}`}
      color="warning"
      onCancel={() => onChange('no')}
    >
      <MCPServerDialogCopy />

      <Select
        options={[
          { label: `Use this MCP server`, value: 'yes' },
          {
            label: `Use this and all future MCP servers in this project`,
            value: 'yes_all',
          },
          { label: `Continue without using this MCP server`, value: 'no' },
        ]}
        onChange={value => onChange(value as 'yes_all' | 'yes' | 'no')}
        onCancel={() => onChange('no')}
      />
    </Dialog>
  );
}
