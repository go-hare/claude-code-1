import { useEffect } from 'react';
import { useNotifications } from 'src/context/notifications.js';
import { getIsRemoteMode } from '../../bootstrap/state.js';
import { Text } from '@anthropic/ink';
import { hasClaudeAiMcpEverConnected, hasClaudeAiMcpSessionConnected } from '../../services/mcp/claudeai.js';
import type { MCPServerConnection } from '../../services/mcp/types.js';
import { countMcpNeedsAuth, shouldCountMcpClientForAuthNotice } from '../../services/mcp/utils.js';

type Props = {
  mcpClients?: MCPServerConnection[];
};

const EMPTY_MCP_CLIENTS: MCPServerConnection[] = [];

/**
 * densable 2.1.218 #19 — startup MCP connectivity notices.
 * needs-auth count uses densable `Kka`/`DYo` so claude.ai connectors that
 * aren't connected in claude.ai (eligible===false / never connected) are not
 * over-counted.
 */
export function useMcpConnectivityStatus({ mcpClients = EMPTY_MCP_CLIENTS }: Props): void {
  const { addNotification } = useNotifications();
  useEffect(() => {
    if (getIsRemoteMode()) return;

    const ever = hasClaudeAiMcpEverConnected;
    const session = hasClaudeAiMcpSessionConnected;

    const failedLocalClients = mcpClients.filter(
      client =>
        client.type === 'failed' &&
        client.config.type !== 'claudeai-proxy' &&
        shouldCountMcpClientForAuthNotice(client, ever, session),
    );
    // claude.ai failures: only flag connectors that have previously connected
    // (densable Vsr) — org connectors that were never authorized are noise.
    const failedClaudeAiClients = mcpClients.filter(
      client =>
        client.type === 'failed' &&
        client.config.type === 'claudeai-proxy' &&
        shouldCountMcpClientForAuthNotice(client, ever, session),
    );

    // densable `_Ub` / `Kka` — single needs-auth count for the unified notice.
    // Local product still splits local vs claude.ai copy when both are nonzero,
    // but each side is filtered with the same DYo predicate.
    const needsAuthLocalServers = mcpClients.filter(
      client =>
        client.type === 'needs-auth' &&
        client.config.type !== 'claudeai-proxy' &&
        shouldCountMcpClientForAuthNotice(client, ever, session),
    );
    const needsAuthClaudeAiServers = mcpClients.filter(
      client =>
        client.type === 'needs-auth' &&
        client.config.type === 'claudeai-proxy' &&
        shouldCountMcpClientForAuthNotice(client, ever, session),
    );

    // densable single-count path (Logo warning uses this total).
    const mcpNeedsAuthCount = countMcpNeedsAuth(mcpClients, ever, session);

    if (failedLocalClients.length === 0 && failedClaudeAiClients.length === 0 && mcpNeedsAuthCount === 0) {
      return;
    }
    if (failedLocalClients.length > 0) {
      addNotification({
        key: 'mcp-failed',
        jsx: (
          <>
            <Text color="error">
              {failedLocalClients.length} MCP {failedLocalClients.length === 1 ? 'server' : 'servers'} failed
            </Text>
            <Text dimColor> · /mcp</Text>
          </>
        ),
        priority: 'medium',
      });
    }
    if (failedClaudeAiClients.length > 0) {
      addNotification({
        key: 'mcp-claudeai-failed',
        jsx: (
          <>
            <Text color="error">
              {failedClaudeAiClients.length} claude.ai {failedClaudeAiClients.length === 1 ? 'connector' : 'connectors'}{' '}
              unavailable
            </Text>
            <Text dimColor> · /mcp</Text>
          </>
        ),
        priority: 'medium',
      });
    }
    // densable Logo warning: one "N MCP server(s) need authentication" line.
    // Keep split local/claude.ai notices when both present for richer copy;
    // when only one side, still match densable wording for the combined count.
    if (mcpNeedsAuthCount > 0) {
      if (needsAuthLocalServers.length > 0 && needsAuthClaudeAiServers.length === 0) {
        addNotification({
          key: 'mcp-needs-auth',
          jsx: (
            <>
              <Text color="warning">
                {needsAuthLocalServers.length} MCP{' '}
                {needsAuthLocalServers.length === 1 ? 'server needs' : 'servers need'} authentication
              </Text>
              <Text dimColor> · /mcp</Text>
            </>
          ),
          priority: 'medium',
        });
      } else if (needsAuthClaudeAiServers.length > 0 && needsAuthLocalServers.length === 0) {
        addNotification({
          key: 'mcp-claudeai-needs-auth',
          jsx: (
            <>
              <Text color="warning">
                {needsAuthClaudeAiServers.length} claude.ai{' '}
                {needsAuthClaudeAiServers.length === 1 ? 'connector needs' : 'connectors need'} auth
              </Text>
              <Text dimColor> · /mcp</Text>
            </>
          ),
          priority: 'medium',
        });
      } else {
        // Both local + claude.ai: densable unified count wording
        addNotification({
          key: 'mcp-needs-auth',
          jsx: (
            <>
              <Text color="warning">
                {mcpNeedsAuthCount} MCP {mcpNeedsAuthCount === 1 ? 'server needs' : 'servers need'} authentication
              </Text>
              <Text dimColor> · /mcp</Text>
            </>
          ),
          priority: 'medium',
        });
      }
    }
  }, [addNotification, mcpClients]);
}
