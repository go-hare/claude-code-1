import figures from 'figures';
import React, { useCallback, useMemo, useRef, useState } from 'react';
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
import { getGlobalConfig } from '../../utils/config.js';
import { isDebugMode } from '../../utils/debug.js';
import { plural } from '../../utils/stringUtils.js';
import { ConfigurableShortcutHint } from '../ConfigurableShortcutHint.js';
import { ItemList } from '../ItemList.js';
import { McpParsingWarnings } from './McpParsingWarnings.js';
import type { AgentMcpServerInfo, ServerInfo } from './types.js';

export type SuppressedClaudeAiConnector = {
  name: string;
  duplicateOf: string;
  duplicateOfScope?: ConfigScope | string;
};

type Props = {
  servers: ServerInfo[];
  suppressedClaudeAiConnectors?: SuppressedClaudeAiConnector[];
  agentServers?: AgentMcpServerInfo[];
  onSelectServer: (server: ServerInfo) => void;
  onSelectAgentServer?: (agentServer: AgentMcpServerInfo) => void;
  onComplete: (result?: string, options?: { display?: CommandResultDisplay }) => void;
  defaultTab?: string;
  showUnusedConnectors?: boolean;
  onToggleUnusedConnectors?: () => void;
};

type SelectableItem =
  | { type: 'heading'; value: string; label: React.ReactNode }
  | { type: 'server'; value: string; server: ServerInfo }
  | { type: 'agent-server'; value: string; agentServer: AgentMcpServerInfo }
  | { type: 'unused-connectors-fold'; value: string; count: number; shown: boolean };

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

function renderSuppressedConnectorHint(s: SuppressedClaudeAiConnector): React.ReactNode {
  if (s.duplicateOf.startsWith('plugin:')) {
    return <Text dimColor>To use this connector instead, disable the plugin server in /plugins</Text>;
  }
  switch (s.duplicateOfScope) {
    case 'local':
    case 'user':
    case 'project':
      return (
        <Text dimColor>
          To use this connector instead, run <Text bold>{`claude mcp remove ${s.duplicateOf}`}</Text>
        </Text>
      );
    case 'dynamic':
      return <Text dimColor>To use this connector instead, drop it from your --mcp-config flag</Text>;
    case 'enterprise':
    case 'managed':
      return <Text dimColor>An admin-managed server takes precedence here</Text>;
    default:
      return <Text dimColor>To use this connector instead, remove the duplicate server from your configuration</Text>;
  }
}

export function MCPListPanel({
  servers,
  suppressedClaudeAiConnectors = [],
  agentServers = [],
  onSelectServer,
  onSelectAgentServer,
  onComplete,
  showUnusedConnectors,
  onToggleUnusedConnectors,
}: Props): React.ReactNode {
  const mcpTools = useAppState(s => s.mcp.tools);
  const terminalSize = useTerminalSize();
  const insideModal = useIsInsideModal();
  const { rows: availableRows } = useModalOrTerminalSize(terminalSize);
  const [internalShowUnused, setInternalShowUnused] = useState(false);
  const effectiveShowUnused = showUnusedConnectors ?? internalShowUnused;
  const handleToggleUnusedConnectors = useCallback(() => {
    if (onToggleUnusedConnectors) {
      onToggleUnusedConnectors();
    } else {
      setInternalShowUnused(prev => !prev);
    }
  }, [onToggleUnusedConnectors]);

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

  const { claudeAiServers, unusedClaudeAiServers } = useMemo(() => {
    const everConnected = new Set(getGlobalConfig().claudeAiMcpEverConnected ?? []);
    const active: ServerInfo[] = [];
    const unused: ServerInfo[] = [];
    for (const server of servers) {
      if (!isOfficialClaudeAiConnector(server.client.config)) continue;
      if ((server.client.type === 'needs-auth' || server.client.type === 'failed') && !everConnected.has(server.name)) {
        unused.push(server);
      } else {
        active.push(server);
      }
    }
    active.sort((a, b) => a.name.localeCompare(b.name));
    unused.sort((a, b) => a.name.localeCompare(b.name));
    return { claudeAiServers: active, unusedClaudeAiServers: unused };
  }, [servers]);

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
    if (claudeAiServers.length > 0 || unusedClaudeAiServers.length > 0 || suppressedClaudeAiConnectors.length > 0) {
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
      if (unusedClaudeAiServers.length > 0) {
        items.push({
          type: 'unused-connectors-fold',
          value: 'claudeai-unused-fold',
          count: unusedClaudeAiServers.length,
          shown: effectiveShowUnused,
        });
        if (effectiveShowUnused) {
          for (const server of unusedClaudeAiServers) {
            items.push({ type: 'server', value: `claudeai-${server.name}`, server });
          }
        }
      }
      for (const suppressed of suppressedClaudeAiConnectors) {
        items.push({
          type: 'heading',
          value: `suppressed-${suppressed.name}`,
          label: (
            <Text wrap="truncate-end">
              {suppressed.name}
              <Text dimColor>
                {' · '}
                {figures.radioOff}
                {` hidden — same URL as your server '${suppressed.duplicateOf}'`}
              </Text>
            </Text>
          ),
        });
        items.push({
          type: 'heading',
          value: `suppressed-hint-${suppressed.name}`,
          label: (
            <Box paddingLeft={2}>
              <Text wrap="truncate-end">{renderSuppressedConnectorHint(suppressed)}</Text>
            </Box>
          ),
        });
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
  }, [
    serversByScope,
    claudeAiServers,
    unusedClaudeAiServers,
    effectiveShowUnused,
    suppressedClaudeAiConnectors,
    agentServers,
    dynamicServers,
  ]);

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
    } else if (item.type === 'unused-connectors-fold') {
      handleToggleUnusedConnectors();
    }
  }, [selectableItems, onSelectServer, onSelectAgentServer, handleToggleUnusedConnectors]);

  const debugMode = isDebugMode();
  const hiddenUnusedSet = useMemo(
    () => (effectiveShowUnused ? undefined : new Set(unusedClaudeAiServers.map(s => s.name))),
    [effectiveShowUnused, unusedClaudeAiServers],
  );
  const hasFailedClients = servers.some(s => s.client.type === 'failed' && !hiddenUnusedSet?.has(s.name));

  const itemOptions = useMemo(() => {
    return selectableItems.map(entry => {
      if (entry.type === 'heading') {
        return {
          heading: true,
          value: entry.value,
          label: entry.label,
        };
      }
      if (entry.type === 'unused-connectors-fold') {
        return {
          value: entry.value,
          label: 'Show unused connectors',
          icon: <Text>{entry.shown ? figures.arrowDown : figures.arrowRight}</Text>,
          facts: [`${entry.count} ${entry.shown ? 'shown' : 'hidden'}`],
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

  if (servers.length === 0 && agentServers.length === 0 && suppressedClaudeAiConnectors.length === 0) {
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
