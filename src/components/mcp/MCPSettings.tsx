import React, { useEffect, useMemo } from 'react';
import type { CommandResultDisplay } from '../../commands.js';
import { ClaudeAuthProvider } from '../../services/mcp/auth.js';
import type {
  McpClaudeAIProxyServerConfig,
  McpHTTPServerConfig,
  McpSSEServerConfig,
  McpStdioServerConfig,
} from '../../services/mcp/types.js';
import { extractAgentMcpServers, filterToolsByServer } from '../../services/mcp/utils.js';
import { useAppState } from '../../state/AppState.js';
import { getSessionIngressAuthToken } from '../../utils/sessionIngressAuth.js';
import { MCPAgentServerMenu } from './MCPAgentServerMenu.js';
import { MCPListPanel, type SuppressedClaudeAiConnector } from './MCPListPanel.js';
import { MCPRemoteServerMenu } from './MCPRemoteServerMenu.js';
import { MCPStdioServerMenu } from './MCPStdioServerMenu.js';
import { MCPToolDetailView } from './MCPToolDetailView.js';
import { MCPToolListView } from './MCPToolListView.js';
import type { AgentMcpServerInfo, ServerInfo } from './types.js';

type LocalMCPViewState =
  | { type: 'list'; defaultTab?: string }
  | { type: 'server-menu'; serverName: string; fallbackServer: ServerInfo }
  | { type: 'server-tools'; serverName: string; fallbackServer: ServerInfo }
  | { type: 'server-tool-detail'; serverName: string; fallbackServer: ServerInfo; toolName: string }
  | { type: 'agent-server-menu'; agentServer: AgentMcpServerInfo };

type Props = {
  onComplete: (result?: string, options?: { display?: CommandResultDisplay }) => void;
};

export const NO_MCP_SERVERS_MESSAGE =
  "No MCP servers loaded. If you just added one, restart Claude Code. If you declined a project's server, run `claude mcp reset-project-choices` first. `claude doctor` finds config problems. To add one, run `claude mcp --help` or see https://code.claude.com/docs/en/mcp";

export function MCPSettings({ onComplete }: Props): React.ReactNode {
  const mcp = useAppState(s => s.mcp);
  const agentDefinitions = useAppState(s => s.agentDefinitions);
  const mcpClients = mcp.clients;
  const [viewState, setViewState] = React.useState<LocalMCPViewState>({
    type: 'list',
  });
  const [servers, setServers] = React.useState<ServerInfo[]>([]);
  const [showUnusedConnectors, setShowUnusedConnectors] = React.useState(false);
  // Official 2.1.328 #462: Preserve focused tool when returning from tool detail -> tool list.
  const [lastToolSelection, setLastToolSelection] = React.useState<{
    serverName: string;
    toolName: string;
    toolIndex: number;
  } | null>(null);
  const suppressedClaudeAiConnectors = (mcp as { suppressedClaudeAiConnectors?: SuppressedClaudeAiConnector[] })
    .suppressedClaudeAiConnectors;

  // Extract agent-specific MCP servers from agent definitions
  const agentMcpServers = useMemo(
    () => extractAgentMcpServers(agentDefinitions.allAgents),
    [agentDefinitions.allAgents],
  );

  const filteredClients = React.useMemo(
    () => mcpClients.filter(client => client.name !== 'ide').sort((a, b) => a.name.localeCompare(b.name)),
    [mcpClients],
  );

  React.useEffect(() => {
    let cancelled = false;
    async function prepareServers() {
      const serverInfos = await Promise.all(
        filteredClients.map(async client => {
          const scope = client.config.scope;
          const isSSE = client.config.type === 'sse';
          const isHTTP = client.config.type === 'http';
          const isClaudeAIProxy = client.config.type === 'claudeai-proxy';
          let isAuthenticated: boolean | undefined;

          if (isSSE || isHTTP) {
            const authProvider = new ClaudeAuthProvider(
              client.name,
              client.config as McpSSEServerConfig | McpHTTPServerConfig,
            );
            const tokens = await authProvider.tokens();
            // Server is authenticated if:
            // 1. It has OAuth tokens, OR
            // 2. It's connected via session auth (has session token and is connected), OR
            // 3. It's connected and has tools (meaning it's working, regardless of auth method)
            const hasSessionAuth = getSessionIngressAuthToken() !== null && client.type === 'connected';
            const hasToolsAndConnected =
              client.type === 'connected' && filterToolsByServer(mcp.tools, client.name).length > 0;
            isAuthenticated = Boolean(tokens) || hasSessionAuth || hasToolsAndConnected;
          }

          const baseInfo = {
            name: client.name,
            client,
            scope,
          };

          if (isClaudeAIProxy) {
            return {
              ...baseInfo,
              transport: 'claudeai-proxy' as const,
              isAuthenticated: false,
              config: client.config as McpClaudeAIProxyServerConfig,
            };
          } else if (isSSE) {
            return {
              ...baseInfo,
              transport: 'sse' as const,
              isAuthenticated,
              config: client.config as McpSSEServerConfig,
            };
          } else if (isHTTP) {
            return {
              ...baseInfo,
              transport: 'http' as const,
              isAuthenticated,
              config: client.config as McpHTTPServerConfig,
            };
          } else {
            return {
              ...baseInfo,
              transport: 'stdio' as const,
              config: client.config as McpStdioServerConfig,
            };
          }
        }),
      );

      if (cancelled) return;
      setServers(serverInfos);
    }

    void prepareServers();
    return () => {
      cancelled = true;
    };
  }, [filteredClients, mcp.tools]);

  useEffect(() => {
    if (servers.length === 0 && filteredClients.length > 0) {
      // Still loading
      return;
    }

    // Only show "no servers" message if no regular servers AND no agent servers
    if (servers.length === 0 && agentMcpServers.length === 0 && (suppressedClaudeAiConnectors?.length ?? 0) === 0) {
      onComplete(NO_MCP_SERVERS_MESSAGE);
    }
  }, [
    servers.length,
    filteredClients.length,
    agentMcpServers.length,
    suppressedClaudeAiConnectors?.length,
    onComplete,
  ]);

  const activeServer =
    viewState.type === 'server-menu' || viewState.type === 'server-tools' || viewState.type === 'server-tool-detail'
      ? (servers.find(s => s.name === viewState.serverName) ?? viewState.fallbackServer)
      : null;

  const detailTool =
    viewState.type === 'server-tool-detail'
      ? filterToolsByServer(mcp.tools, viewState.serverName).find(t => t.name === viewState.toolName)
      : undefined;

  // Move missing-tool fallback out of render into an effect so state updates stay pure.
  useEffect(() => {
    if (viewState.type === 'server-tool-detail' && !detailTool) {
      setViewState({
        type: 'server-tools',
        serverName: viewState.serverName,
        fallbackServer: activeServer ?? viewState.fallbackServer,
      });
    }
  }, [viewState, detailTool, activeServer]);

  switch (viewState.type) {
    case 'list':
      return (
        <MCPListPanel
          servers={servers}
          suppressedClaudeAiConnectors={suppressedClaudeAiConnectors}
          agentServers={agentMcpServers}
          onSelectServer={server =>
            setViewState({ type: 'server-menu', serverName: server.name, fallbackServer: server })
          }
          onSelectAgentServer={(agentServer: AgentMcpServerInfo) =>
            setViewState({ type: 'agent-server-menu', agentServer })
          }
          onComplete={onComplete}
          defaultTab={viewState.defaultTab}
          showUnusedConnectors={showUnusedConnectors}
          onToggleUnusedConnectors={() => setShowUnusedConnectors(prev => !prev)}
        />
      );

    case 'server-menu': {
      const server = activeServer ?? viewState.fallbackServer;
      const serverTools = filterToolsByServer(mcp.tools, server.name);

      const defaultTab = server.transport === 'claudeai-proxy' ? 'claude.ai' : 'Claude Code';

      if (server.transport === 'stdio') {
        return (
          <MCPStdioServerMenu
            server={server}
            serverToolsCount={serverTools.length}
            onViewTools={() => {
              setLastToolSelection(null);
              setViewState({ type: 'server-tools', serverName: server.name, fallbackServer: server });
            }}
            onCancel={() => setViewState({ type: 'list', defaultTab })}
            onComplete={onComplete}
          />
        );
      } else {
        return (
          <MCPRemoteServerMenu
            server={server}
            serverToolsCount={serverTools.length}
            onViewTools={() => {
              setLastToolSelection(null);
              setViewState({ type: 'server-tools', serverName: server.name, fallbackServer: server });
            }}
            onCancel={() => setViewState({ type: 'list', defaultTab })}
            onComplete={onComplete}
          />
        );
      }
    }

    case 'server-tools': {
      const server = activeServer ?? viewState.fallbackServer;
      const savedSelection = lastToolSelection?.serverName === server.name ? lastToolSelection : null;
      return (
        <MCPToolListView
          server={server}
          startOn={savedSelection?.toolName}
          defaultFocusIndex={savedSelection?.toolIndex}
          onSelectTool={(tool, index) => {
            setLastToolSelection({
              serverName: server.name,
              toolName: tool.name,
              toolIndex: index,
            });
            setViewState({
              type: 'server-tool-detail',
              serverName: server.name,
              fallbackServer: server,
              toolName: tool.name,
            });
          }}
          onBack={() => setViewState({ type: 'server-menu', serverName: server.name, fallbackServer: server })}
        />
      );
    }

    case 'server-tool-detail': {
      const server = activeServer ?? viewState.fallbackServer;
      if (!detailTool) {
        return null;
      }
      return (
        <MCPToolDetailView
          tool={detailTool}
          server={server}
          onBack={() => setViewState({ type: 'server-tools', serverName: server.name, fallbackServer: server })}
        />
      );
    }

    case 'agent-server-menu':
      return (
        <MCPAgentServerMenu
          agentServer={viewState.agentServer}
          onCancel={() => setViewState({ type: 'list', defaultTab: 'Agents' })}
          onComplete={onComplete}
        />
      );
  }
}
