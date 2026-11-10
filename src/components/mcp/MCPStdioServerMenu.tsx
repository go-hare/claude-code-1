import figures from 'figures';
import React, { useState } from 'react';
import type { CommandResultDisplay } from '../../commands.js';
import { Box, Byline, color, Dialog, KeyboardShortcutHint, Text, useTheme } from '@anthropic/ink';
import { getMcpConfigByName } from '../../services/mcp/config.js';
import { useMcpReconnect, useMcpToggleEnabled } from '../../services/mcp/MCPConnectionManager.js';
import { describeMcpConfigFilePath, filterMcpPromptsByServer } from '../../services/mcp/utils.js';
import { useAppState } from '../../state/AppState.js';
import { errorMessage } from '../../utils/errors.js';
import { capitalize } from '../../utils/stringUtils.js';
import { ConfigurableShortcutHint } from '../ConfigurableShortcutHint.js';
import { Select } from '../CustomSelect/index.js';
import { Spinner } from '../Spinner.js';
import { CapabilitiesSection } from './CapabilitiesSection.js';
import type { StdioServerInfo } from './types.js';
import { handleReconnectError, handleReconnectResult } from './utils/reconnectHelpers.js';

type Props = {
  server: StdioServerInfo;
  serverToolsCount: number;
  onViewTools: () => void;
  onCancel: () => void;
  onComplete: (result?: string, options?: { display?: CommandResultDisplay }) => void;
  borderless?: boolean;
};

export function MCPStdioServerMenu({
  server,
  serverToolsCount,
  onViewTools,
  onCancel,
  onComplete,
  borderless = false,
}: Props): React.ReactNode {
  const [theme] = useTheme();
  const mcp = useAppState(s => s.mcp);
  const reconnectMcpServer = useMcpReconnect();
  const toggleMcpServer = useMcpToggleEnabled();
  const [isReconnecting, setIsReconnecting] = useState(false);

  const handleToggleEnabled = React.useCallback(async () => {
    const wasEnabled = server.client.type !== 'disabled';

    try {
      await toggleMcpServer(server.name);
      // Return to the server list so user can continue managing other servers
      onCancel();
    } catch (err) {
      const action = wasEnabled ? 'disable' : 'enable';
      onComplete(`Failed to ${action} MCP server '${server.name}': ${errorMessage(err)}`);
    }
  }, [server.client.type, server.name, toggleMcpServer, onCancel, onComplete]);

  const capitalizedServerName = capitalize(String(server.name));

  // Count MCP prompts for this server (skills are shown in /skills, not here)
  const serverCommandsCount = filterMcpPromptsByServer(mcp.commands, server.name).length;

  const menuOptions = [];

  // Only show "View tools" if server is not disabled and has tools
  if (server.client.type !== 'disabled' && serverToolsCount > 0) {
    menuOptions.push({
      label: 'View tools',
      value: 'tools',
    });
  }

  // Only show reconnect option if the server is not disabled
  if (server.client.type !== 'disabled') {
    menuOptions.push({
      label: 'Reconnect',
      value: 'reconnectMcpServer',
    });
  }

  menuOptions.push({
    label: server.client.type !== 'disabled' ? 'Disable' : 'Enable',
    value: 'toggle-enabled',
  });

  // If there are no other options, add a back option so Select handles escape
  if (menuOptions.length === 0) {
    menuOptions.push({
      label: 'Back',
      value: 'back',
    });
  }

  if (isReconnecting) {
    return (
      <Dialog title={`${capitalizedServerName} MCP Server`} onCancel={() => {}} hideBorder={borderless} hideInputGuide>
        <Text color="text">
          Reconnecting to <Text bold>{server.name}</Text>
        </Text>
        <Box>
          <Spinner />
          <Text> Restarting MCP server process</Text>
        </Box>
        <Text dimColor>This may take a few moments.</Text>
      </Dialog>
    );
  }

  const connectedClient =
    server.client.type === 'connected'
      ? (server.client as {
          protocolEra?: string;
          negotiatedProtocolVersion?: string;
          toolsListError?: string;
        })
      : undefined;

  return (
    <Dialog
      title={`${capitalizedServerName} MCP Server`}
      onCancel={onCancel}
      hideBorder={borderless}
      inputGuide={exitState =>
        exitState.pending ? (
          <Text>Press {exitState.keyName} again to exit</Text>
        ) : (
          <Byline>
            <KeyboardShortcutHint shortcut="↑↓" action="navigate" />
            <KeyboardShortcutHint shortcut="Enter" action="select" />
            <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="back" />
          </Byline>
        )
      }
    >
      <Box flexDirection="column" gap={0}>
        <Box>
          <Text bold>Status: </Text>
          {server.client.type === 'disabled' ? (
            <Text>{color('inactive', theme)(figures.radioOff)} disabled</Text>
          ) : server.client.type === 'connected' ? (
            server.client.toolsListError ? (
              <Text>{color('warning', theme)(figures.warning)} connected · tools fetch failed</Text>
            ) : server.client.capabilities?.tools && serverToolsCount === 0 ? (
              <Text>{color('warning', theme)(figures.warning)} connected · no tools</Text>
            ) : (
              <Text>{color('success', theme)(figures.tick)} connected</Text>
            )
          ) : server.client.type === 'pending' ? (
            <>
              <Text dimColor>{figures.radioOff}</Text>
              <Text> connecting…</Text>
            </>
          ) : (
            <Text>{color('error', theme)(figures.cross)} failed</Text>
          )}
        </Box>

        <Box>
          <Text bold>Command: </Text>
          <Text dimColor>{server.config.command}</Text>
        </Box>

        {server.config.args && server.config.args.length > 0 && (
          <Box>
            <Text bold>Args: </Text>
            <Text dimColor>{server.config.args.join(' ')}</Text>
          </Box>
        )}

        {connectedClient && connectedClient.protocolEra !== 'legacy' && connectedClient.negotiatedProtocolVersion && (
          <Box>
            <Text bold>Protocol: </Text>
            <Text dimColor>{connectedClient.negotiatedProtocolVersion}</Text>
          </Box>
        )}

        <Box>
          <Text bold>Config location: </Text>
          <Text dimColor>{describeMcpConfigFilePath(getMcpConfigByName(server.name)?.scope ?? 'dynamic')}</Text>
        </Box>

        {server.client.type === 'connected' && (
          <CapabilitiesSection
            serverToolsCount={serverToolsCount}
            serverPromptsCount={serverCommandsCount}
            serverResourcesCount={mcp.resources[server.name]?.length || 0}
          />
        )}

        {server.client.type === 'connected' && serverToolsCount > 0 && (
          <Box>
            <Text bold>Tools: </Text>
            <Text dimColor>{serverToolsCount} tools</Text>
          </Box>
        )}

        {server.client.type === 'connected' && server.client.toolsListError && (
          <Box flexDirection="column">
            <Text bold>Issue: </Text>
            <Text dimColor>{server.client.toolsListError}</Text>
          </Box>
        )}
      </Box>

      {menuOptions.length > 0 && (
        <Box marginTop={1}>
          <Select
            options={menuOptions}
            onChange={async value => {
              if (value === 'tools') {
                onViewTools();
              } else if (value === 'reconnectMcpServer') {
                setIsReconnecting(true);
                try {
                  const result = await reconnectMcpServer(server.name);
                  const { message } = handleReconnectResult(result, server.name);
                  onComplete?.(message);
                } catch (err) {
                  onComplete?.(handleReconnectError(err, server.name));
                } finally {
                  setIsReconnecting(false);
                }
              } else if (value === 'toggle-enabled') {
                await handleToggleEnabled();
              } else if (value === 'back') {
                onCancel();
              }
            }}
            onCancel={onCancel}
          />
        </Box>
      )}
    </Dialog>
  );
}
