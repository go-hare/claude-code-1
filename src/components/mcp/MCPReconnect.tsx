import figures from 'figures';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { CommandResultDisplay } from '../../commands.js';
import { Box, color, Text, useTheme } from '@anthropic/ink';
import { useExitOnCtrlCDWithKeybindings } from '../../hooks/useExitOnCtrlCDWithKeybindings.js';
import { useKeybinding } from '../../keybindings/useKeybinding.js';
import { useMcpReconnect } from '../../services/mcp/MCPConnectionManager.js';
import { isMcpServerDisabled } from '../../services/mcp/config.js';
import {
  formatMcpReconnectOutcome,
  missingMcpReconnectTarget,
  planMcpReconnect,
  reconnectDisabledElsewhereResult,
} from '../../services/mcp/mcpReconnectRemedy.js';
import { useAppStateStore } from '../../state/AppState.js';
import { Spinner } from '../Spinner.js';

type Props = {
  serverName: string;
  onComplete: (result?: string, options?: { display?: CommandResultDisplay }) => void;
};

export function MCPReconnect({ serverName, onComplete }: Props): React.ReactNode {
  const [theme] = useTheme();
  const store = useAppStateStore();
  const reconnectMcpServer = useMcpReconnect();
  const [isReconnecting, setIsReconnecting] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusLabel, setStatusLabel] = useState(serverName === 'all' ? 'all MCP servers' : serverName);
  const dismissedRef = useRef(false);

  // Official 2.1.326 #85: Esc, or Ctrl+C pressed twice, closes the wait view
  // while letting the in-flight reconnect continue in the background.
  const handleDismissToBackground = useCallback(() => {
    if (dismissedRef.current) return;
    dismissedRef.current = true;
    setIsReconnecting(false);
    onComplete(`Reconnecting to ${statusLabel} in the background…`);
  }, [onComplete, statusLabel]);

  const exitState = useExitOnCtrlCDWithKeybindings(handleDismissToBackground);

  useKeybinding('confirm:no', handleDismissToBackground, {
    context: 'Confirmation',
    isActive: isReconnecting,
  });

  useEffect(() => {
    async function attemptReconnect() {
      try {
        // Read via store.getState() instead of a reactive selector so this
        // effect does not re-fire when reconnectMcpServer updates mcp.clients
        // via onConnectionAttempt.
        const clients = store.getState().mcp.clients;

        if (serverName === 'all') {
          const plan = planMcpReconnect(clients, 'all', isMcpServerDisabled);
          if (plan.kind === 'missing') {
            if (dismissedRef.current) return;
            setIsReconnecting(false);
            onComplete(missingMcpReconnectTarget('all'));
            return;
          }
          if (plan.kind === 'text') {
            if (dismissedRef.current) return;
            setIsReconnecting(false);
            onComplete(plan.text);
            return;
          }

          setStatusLabel(plan.names.length === 1 ? plan.names[0]! : `${plan.names.length} MCP servers`);
          const settled = await Promise.allSettled(plan.names.map(name => reconnectMcpServer(name)));
          if (dismissedRef.current) return;
          const results: Array<{ ok: true; type: string } | { ok: false }> = settled.map(entry =>
            entry.status === 'fulfilled' ? { ok: true, type: entry.value.client.type } : { ok: false },
          );
          const text = formatMcpReconnectOutcome('all', results, plan.appendix);
          setIsReconnecting(false);
          if (!results.some(result => result.ok && result.type === 'connected')) {
            setError(text);
          }
          onComplete(text);
          return;
        }

        // Check if server exists.
        const server = clients.find(c => c.name === serverName);
        if (!server) {
          if (dismissedRef.current) return;
          setError(`MCP server "${serverName}" not found`);
          setIsReconnecting(false);
          onComplete(`MCP server "${serverName}" not found`);
          return;
        }

        const driftedRemedy = reconnectDisabledElsewhereResult(
          [
            {
              name: server.name,
              type: server.type,
              ...(server.type === 'failed' && server.errorCode !== undefined ? { errorCode: server.errorCode } : {}),
            },
          ],
          serverName,
          isMcpServerDisabled,
        );
        if (driftedRemedy !== null) {
          if (dismissedRef.current) return;
          setError(driftedRemedy);
          setIsReconnecting(false);
          onComplete(driftedRemedy);
          return;
        }

        // Attempt reconnection
        const result = await reconnectMcpServer(serverName);
        if (dismissedRef.current) return;

        switch (result.client.type) {
          case 'connected':
            setIsReconnecting(false);
            onComplete(`Successfully reconnected to ${serverName}`);
            break;
          case 'needs-auth': {
            // densable 2.1.216: bg no-terminal parks needs-input in agent view
            const { formatMcpNeedsAuthMessage } = await import('../../utils/bgCommandNeedsPark.js');
            const msg = await formatMcpNeedsAuthMessage(serverName);
            if (dismissedRef.current) return;
            setError(`${serverName} requires authentication`);
            setIsReconnecting(false);
            onComplete(msg);
            break;
          }
          case 'pending':
          case 'failed':
          case 'disabled':
            setError(`Failed to reconnect to ${serverName}`);
            setIsReconnecting(false);
            onComplete(`Failed to reconnect to ${serverName}`);
            break;
        }
      } catch (err) {
        if (dismissedRef.current) return;
        // Only catch actual errors (like server not found)
        const errorMessage = err instanceof Error ? err.message : String(err);
        setError(errorMessage);
        setIsReconnecting(false);
        onComplete(`Error: ${errorMessage}`);
      }
    }

    void attemptReconnect();
  }, [serverName, reconnectMcpServer, store, onComplete]);

  if (isReconnecting) {
    return (
      <Box flexDirection="column" gap={1} padding={1}>
        <Text color="text">
          Reconnecting to <Text bold>{statusLabel}</Text>
        </Text>
        <Box>
          <Spinner />
          <Text> Establishing connection to MCP server</Text>
        </Box>
        <Text dimColor>
          {exitState.pending
            ? `Press ${exitState.keyName} again to continue in the background`
            : 'Press Esc to continue in the background'}
        </Text>
      </Box>
    );
  }

  if (error) {
    return (
      <Box flexDirection="column" gap={1} padding={1}>
        <Box>
          <Text>{color('error', theme)(figures.cross)} </Text>
          <Text color="error">Failed to reconnect to {statusLabel}</Text>
        </Box>
        <Text dimColor>Error: {error}</Text>
      </Box>
    );
  }

  return null;
}
