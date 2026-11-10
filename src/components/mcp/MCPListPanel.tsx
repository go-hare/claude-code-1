import React, { useCallback, useMemo, useRef } from 'react';
import type { CommandResultDisplay } from '../../commands.js';
import {
  Box,
  Byline,
  Dialog,
  KeyboardShortcutHint,
  Link,
  StatusIcon,
  Text,
  useIsInsideModal,
  useModalOrTerminalSize,
  useTerminalSize,
} from '@anthropic/ink';
import { formatFailedMcpIssue } from '../../services/mcp/mcpConnectionIssue.js';
import { isEnterpriseManagedClaudeAiConnector } from '../../services/mcp/enterpriseManaged.js';
import { isOfficialClaudeAiConnector } from '../../services/mcp/officialClaudeAiConnector.js';
import type { ConfigScope } from '../../services/mcp/types.js';
import { describeMcpConfigFilePath, filterToolsByServer } from '../../services/mcp/utils.js';
import { useAppState } from '../../state/AppState.js';
import { isDebugMode } from '../../utils/debug.js';
import { plural } from '../../utils/stringUtils.js';
import { ConfigurableShortcutHint } from '../ConfigurableShortcutHint.js';
import { ItemList } from '../ItemList.js';
import { McpParsingWarnings } from './McpParsingWarnings.js';
import type { AgentMcpServerInfo, ServerInfo } from './types.js';

type Props = {
  servers: ServerInfo[];
  agentServers?: AgentMcpServerInfo[];
  onSelectServer: (server: ServerInfo) => void;
  onSelectAgentServer?: (agentServer: AgentMcpServerInfo) => void;
  onComplete: (result?: string, options?: { display?: CommandResultDisplay }) => void;
  defaultTab?: string;
};

type SelectableItem =
  | { type: 'heading'; value: string; label: React.ReactNode }
  | { type: 'server'; value: string; server: ServerInfo }
  | { type: 'agent-server'; value: string; agentServer: AgentMcpServerInfo };

const SCOPE_ORDER: ConfigScope[] = ['project', 'local', 'user', 'enterprise'];
const MIN_VISIBLE_ROWS = 4;

function getScopeHeading(scope: ConfigScope): { label: string; path?: string } {
  switch (scope) {
    case 'project':
      return { label: 'Project MCPs', path: describeMcpConfigFilePath(scope) };
    case 'user':
      return { label: 'User MCPs', path: describeMcpConfigFilePath(scope) };
    case 'local':
      return { label: 'Local MCPs', path: describeMcpConfigFilePath(scope) };
    case 'enterprise':
      return { label: 'Enterprise MCPs' };
    case 'dynamic':
      return { label: 'Built-in MCPs', path: 'always available' };
    default:
      return { label: scope };
  }
}

function renderScopeHeading(label: string, path?: string): React.ReactNode {
  return (
    <Text wrap="truncate-end">
      <Text bold>{label}</Text>
      {path ? <Text dimColor> ({path})</Text> : null}
    </Text>
  );
}

function groupServersByScope(serverList: ServerInfo[]): Map<ConfigScope, ServerInfo[]> {
  const groups = new Map<ConfigScope, ServerInfo[]>();
  for (const server of serverList) {
    const scope = server.scope;
    if (!groups.has(scope)) {
      groups.set(scope, []);
    }
    groups.get(scope)!.push(server);
  }
  for (const [, groupServers] of groups) {
    groupServers.sort((a, b) => a.name.localeCompare(b.name));
  }
  return groups;
}

function buildServerItemProps(
  server: ServerInfo,
  toolCount: number | undefined,
): { icon: React.ReactNode; facts: string[] } {
  const { client } = server;
  let icon: React.ReactNode;
  let facts: string[] = [];

  if (client.type === 'disabled') {
    icon = <StatusIcon status="off" />;
  } else if (client.type === 'connected') {
    const hasToolsCapability = Boolean(client.capabilities?.tools);
    const extraClient = client as {
      discoveryBearerRejected?: boolean;
      toolsListError?: unknown;
    };
    let warningText: string | undefined;
    if (extraClient.discoveryBearerRejected) {
      warningText = 'session token rejected';
    } else if (extraClient.toolsListError) {
      warningText = 'tools fetch failed';
    } else if (hasToolsCapability && toolCount === 0) {
      warningText = 'no tools';
    }

    if (warningText) {
      icon = <StatusIcon status="warning" />;
      facts = [warningText, 'connected'];
    } else {
      icon = <StatusIcon status="success" aria-label="connected:" />;
      if (hasToolsCapability && toolCount !== undefined) {
        facts = [`${toolCount} ${plural(toolCount, 'tool')}`];
      }
    }
  } else if (client.type === 'pending') {
    icon = <StatusIcon status="loading" aria-label="connecting:" />;
    const { reconnectAttempt, maxReconnectAttempts } = client;
    if (reconnectAttempt && maxReconnectAttempts) {
      facts = [`reconnecting (${reconnectAttempt}/${maxReconnectAttempts})…`];
    }
  } else if (client.type === 'needs-auth') {
    icon = <StatusIcon status="warning" />;
    facts = ['needs authentication'];
  } else {
    icon = <StatusIcon status="error" />;
    const issue = client.type === 'failed' ? formatFailedMcpIssue(client) : '';
    if (issue) {
      facts = [issue];
    }
  }

  const managed = isEnterpriseManagedClaudeAiConnector({
    transport: server.transport,
    scope: server.scope,
    enterpriseManaged: server.transport === 'claudeai-proxy' ? server.config.enterpriseManaged : undefined,
  });

  if (managed) {
    facts = [...facts, 'managed'];
  }

  return { icon, facts };
}

function buildAgentServerIcon(needsAuth: boolean): React.ReactNode {
  return <StatusIcon status={needsAuth ? 'warning' : 'off'} />;
}

export function MCPListPanel({
  servers,
  agentServers = [],
  onSelectServer,
  onSelectAgentServer,
  onComplete,
}: Props): React.ReactNode {
  const mcpTools = useAppState(s => s.mcp.tools);
  const terminalSize = useTerminalSize();
  const insideModal = useIsInsideModal();
  const { rows: availableRows } = useModalOrTerminalSize(terminalSize);

  // densable 247 Et: live ref so same-tick focus + accept reads latest index.
  const selectedIndexLive = useRef(0);

  const toolCountsByServer = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const server of servers) {
      counts[server.name] = filterToolsByServer(mcpTools, server.name).length;
    }
    return counts;
  }, [servers, mcpTools]);

  const serversByScope = useMemo(() => {
    const regularServers = servers.filter(s => !isOfficialClaudeAiConnector(s.client.config));
    return groupServersByScope(regularServers);
  }, [servers]);

  const claudeAiServers = useMemo(
    () =>
      servers.filter(s => isOfficialClaudeAiConnector(s.client.config)).sort((a, b) => a.name.localeCompare(b.name)),
    [servers],
  );

  const dynamicServers = useMemo(
    () => (serversByScope.get('dynamic') ?? []).sort((a, b) => a.name.localeCompare(b.name)),
    [serversByScope],
  );

  const selectableItems = useMemo(() => {
    const items: SelectableItem[] = [];
    for (const scope of SCOPE_ORDER) {
      const scopeServers = serversByScope.get(scope) ?? [];
      if (scopeServers.length === 0) continue;
      const heading = getScopeHeading(scope);
      items.push({
        type: 'heading',
        value: `heading-${scope}`,
        label: renderScopeHeading(heading.label, heading.path),
      });
      for (const server of scopeServers) {
        items.push({ type: 'server', value: `${scope}-${server.name}`, server });
      }
      items.push({ type: 'heading', value: `spacer-${scope}`, label: <Text> </Text> });
    }
    if (claudeAiServers.length > 0) {
      items.push({
        type: 'heading',
        value: 'heading-claudeai',
        label: (
          <Text wrap="truncate-end">
            <Text bold>claude.ai</Text>
          </Text>
        ),
      });
      for (const server of claudeAiServers) {
        items.push({ type: 'server', value: `claudeai-${server.name}`, server });
      }
      items.push({ type: 'heading', value: 'spacer-claudeai', label: <Text> </Text> });
    }
    if (agentServers.length > 0) {
      items.push({
        type: 'heading',
        value: 'heading-agent-mcps',
        label: renderScopeHeading('Agent MCPs'),
      });
      const agentNames = [...new Set(agentServers.flatMap(s => s.sourceAgents))];
      for (const agentName of agentNames) {
        items.push({ type: 'heading', value: `spacer-agent-${agentName}`, label: <Text> </Text> });
        items.push({
          type: 'heading',
          value: `subheading-agent-${agentName}`,
          label: (
            <Text dimColor wrap="truncate-end">
              @{agentName}
            </Text>
          ),
        });
        for (const agentServer of agentServers.filter(s => s.sourceAgents.includes(agentName))) {
          items.push({
            type: 'agent-server',
            value: `agent-${agentName}-${agentServer.name}`,
            agentServer,
          });
        }
      }
      items.push({ type: 'heading', value: 'spacer-agent-mcps', label: <Text> </Text> });
    }
    if (dynamicServers.length > 0) {
      const dynamicHeading = getScopeHeading('dynamic');
      items.push({
        type: 'heading',
        value: 'heading-dynamic',
        label: renderScopeHeading(dynamicHeading.label, dynamicHeading.path),
      });
      for (const server of dynamicServers) {
        items.push({ type: 'server', value: `dynamic-${server.name}`, server });
      }
      items.push({ type: 'heading', value: 'spacer-dynamic', label: <Text> </Text> });
    }
    if (items.at(-1)?.value.startsWith('spacer-')) {
      items.pop();
    }
    return items;
  }, [serversByScope, claudeAiServers, agentServers, dynamicServers]);

  const handleCancel = useCallback((): void => {
    onComplete('MCP dialog dismissed', {
      display: 'system',
    });
  }, [onComplete]);

  const handleSelect = useCallback((): void => {
    const item = selectableItems[selectedIndexLive.current];
    if (!item) return;
    if (item.type === 'server') {
      onSelectServer(item.server);
    } else if (item.type === 'agent-server' && onSelectAgentServer) {
      onSelectAgentServer(item.agentServer);
    }
  }, [selectableItems, onSelectServer, onSelectAgentServer]);

  const debugMode = isDebugMode();
  const hasFailedClients = servers.some(s => s.client.type === 'failed');

  const itemOptions = useMemo(() => {
    return selectableItems.map(entry => {
      if (entry.type === 'heading') {
        return {
          heading: true,
          value: entry.value,
          label: entry.label,
        };
      }
      if (entry.type === 'server') {
        const { icon, facts } = buildServerItemProps(entry.server, toolCountsByServer[entry.server.name]);
        return {
          value: entry.value,
          label: entry.server.name,
          icon,
          facts,
        };
      }

      const icon = buildAgentServerIcon(entry.agentServer.needsAuth);
      const baseFact = entry.agentServer.needsAuth ? 'may need auth' : 'agent-only';
      return {
        value: entry.value,
        label: entry.agentServer.name,
        icon,
        facts: [baseFact],
      };
    });
  }, [selectableItems, toolCountsByServer]);

  if (servers.length === 0 && agentServers.length === 0) {
    return null;
  }

  const totalServers = servers.length + agentServers.length;
  const chromeRows = insideModal ? 8 : 12;
  const visibleOptionCount = Math.max(MIN_VISIBLE_ROWS, availableRows - chromeRows - (hasFailedClients ? 1 : 0));
  const overflows = itemOptions.length > visibleOptionCount;

  return (
    <Box flexDirection="column">
      <McpParsingWarnings />

      <Dialog
        title="Manage MCP servers"
        subtitle={`${totalServers} ${plural(totalServers, 'server')}`}
        onCancel={handleCancel}
        hideInputGuide
      >
        <Box flexDirection="column">
          <ItemList
            options={itemOptions}
            visibleOptionCount={visibleOptionCount}
            onFocus={index => {
              selectedIndexLive.current = index;
            }}
            onSelect={index => {
              selectedIndexLive.current = index;
              handleSelect();
            }}
            onCancel={handleCancel}
          />

          <Box flexDirection="column" marginTop={overflows ? 0 : 1}>
            {hasFailedClients && (
              <Text dimColor>
                {debugMode ? '※ Error logs shown inline with --debug' : '※ Run claude --debug to see error logs'}
              </Text>
            )}
            <Text dimColor>
              <Link url="https://code.claude.com/docs/en/mcp">https://code.claude.com/docs/en/mcp</Link> for help
            </Text>
          </Box>
        </Box>
      </Dialog>

      <Box paddingX={1}>
        <Text dimColor italic>
          <Byline>
            <KeyboardShortcutHint shortcut="↑/↓" action="navigate" />
            <KeyboardShortcutHint shortcut="Enter" action="confirm" />
            <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="cancel" />
          </Byline>
        </Text>
      </Box>
    </Box>
  );
}
