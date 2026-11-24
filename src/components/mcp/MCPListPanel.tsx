import figures from 'figures';
import React, { useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { CommandResultDisplay } from '../../commands.js';
import {
  AccessibilityContext,
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
import { isEnterpriseManagedClaudeAiConnector } from '../../services/mcp/enterpriseManaged.js';
import { isOfficialClaudeAiConnector } from '../../services/mcp/officialClaudeAiConnector.js';
import type { ConfigScope, DroppedMcpTool } from '../../services/mcp/types.js';
import { getIsRemoteMode, getMainThreadAgentType } from '../../bootstrap/state.js';
import { filterToolsByDenyRules } from '../../tools.js';
import { describeMcpConfigFilePath, filterToolsByServer } from '../../services/mcp/utils.js';
import { useAppState } from '../../state/AppState.js';
import { getGlobalConfig } from '../../utils/config.js';
import { formatRelativeTime } from '../../utils/format.js';
import { isScreenReaderModeEnabled } from '../../utils/screenReaderGate.js';
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

type PanelScope = ConfigScope | 'agent';

const SCOPE_ORDER: PanelScope[] = ['project', 'local', 'user', 'enterprise', 'managed', 'agent'];
const MIN_VISIBLE_ROWS = 3;

export function getScopeHeading(scope: PanelScope, activeAgentName?: string): { label: string; path?: string } {
  switch (scope) {
    case 'project':
      return { label: 'Project MCPs', path: describeMcpConfigFilePath(scope) };
    case 'user':
      return { label: 'User MCPs', path: describeMcpConfigFilePath(scope) };
    case 'local':
      return { label: 'Local MCPs', path: describeMcpConfigFilePath(scope) };
    case 'enterprise':
      return { label: 'Enterprise MCPs' };
    case 'managed':
      return { label: 'Managed MCPs', path: 'provided by your organization' };
    case 'agent': {
      const agentName = activeAgentName ?? getMainThreadAgentType();
      return {
        label: 'Active agent MCPs',
        path: agentName ? `@${agentName} frontmatter` : 'agent frontmatter',
      };
    }
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

function groupServersByScope(serverList: ServerInfo[]): Map<PanelScope, ServerInfo[]> {
  const groups = new Map<PanelScope, ServerInfo[]>();
  for (const server of serverList) {
    const scope = server.scope as PanelScope;
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

type ExtendedMcpClient = {
  type: string;
  capabilities?: { tools?: unknown };
  discoveryBearerRejected?: boolean;
  toolsListError?: unknown;
  reconnectAttempt?: number;
  maxReconnectAttempts?: number;
  heldBy?: string;
  cacheSavedAt?: number;
  errorCode?: string;
  retriesInBackground?: boolean;
  droppedTools?: DroppedMcpTool[];
};

function getDroppedToolsForDisplay(client: ExtendedMcpClient): DroppedMcpTool[] {
  const isConnectedOrCached = client.type === 'connected' || client.type === 'cached';
  if (!isConnectedOrCached || (client.type === 'connected' && Boolean(client.toolsListError))) {
    return [];
  }
  return client.droppedTools ?? [];
}

/**
 * Official 2.1.328 `Ht` (`chunk@338304393.js:43900..44800`) — icon and status
 * metadata facts for an MCP server row.
 */
export function buildServerItemProps(
  server: ServerInfo,
  toolCount: number | undefined,
  isScreenReader = false,
): { icon: React.ReactNode; facts: string[] } {
  const client = server.client as unknown as ExtendedMcpClient;
  let icon: React.ReactNode;
  let facts: string[] = [];

  if (client.type === 'disabled') {
    icon = <StatusIcon status="off" />;
    if (client.heldBy !== undefined) {
      facts = [`held by ${client.heldBy}`];
    }
  } else if (client.type === 'connected') {
    const hasToolsCapability = Boolean(client.capabilities?.tools);
    let warningText: string | undefined;
    if (client.discoveryBearerRejected) {
      warningText = 'session token rejected';
    } else if (client.toolsListError) {
      warningText = "couldn't load tools";
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
  } else if (client.type === 'cached') {
    const cachedLabel =
      client.cacheSavedAt !== undefined ? `cached ${formatRelativeTime(new Date(client.cacheSavedAt))}` : 'cached';
    icon = <Text color="inactive">{figures.radioOn}</Text>;
    facts = [
      cachedLabel,
      'connects on first use',
      ...(toolCount !== undefined ? [`${toolCount} ${plural(toolCount, 'tool')}`] : []),
    ];
  } else if (client.type === 'pending') {
    icon = <StatusIcon status="loading" aria-label="connecting:" />;
    const { reconnectAttempt, maxReconnectAttempts } = client;
    if (reconnectAttempt && maxReconnectAttempts) {
      facts = [`reconnecting (${reconnectAttempt}/${maxReconnectAttempts})…`];
    }
  } else if (client.type === 'needs-auth') {
    icon = <StatusIcon status="warning" />;
    facts = ['needs sign-in'];
  } else if (client.errorCode === 'UNCONFIGURED') {
    icon = <StatusIcon status="pending" aria-label="not configured:" />;
    facts = [isScreenReader ? '' : 'not configured'];
  } else {
    icon = <StatusIcon status="error" />;
    if (client.errorCode === 'INVALID_CONFIG') {
      facts = ['config issue'];
    } else if (client.retriesInBackground) {
      facts = ['retrying'];
    }
  }

  const droppedCount = getDroppedToolsForDisplay(client).length;
  if (droppedCount > 0) {
    facts = [...facts, `${droppedCount} ${plural(droppedCount, 'tool')} left out`];
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
      return <Text dimColor>To use this connector instead, remove the server from your --mcp-config flag</Text>;
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
  const toolPermissionContext = useAppState(s => s.toolPermissionContext);
  const activeAgentName = useAppState(s => s.agent) ?? getMainThreadAgentType();
  const isScreenReader = useContext(AccessibilityContext) || isScreenReaderModeEnabled();
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

  const visibleAgentServers = useMemo(() => {
    const activeAgentServerNames = new Set(servers.filter(s => (s.scope as PanelScope) === 'agent').map(s => s.name));
    if (activeAgentServerNames.size === 0) return agentServers;
    return agentServers.filter(s => !activeAgentServerNames.has(s.name));
  }, [servers, agentServers]);

  const availableMcpTools = useMemo(() => {
    if (!getIsRemoteMode()) {
      return mcpTools;
    }
    return filterToolsByDenyRules(mcpTools, toolPermissionContext).filter(tool => {
      try {
        return tool.isEnabled();
      } catch {
        return true;
      }
    });
  }, [mcpTools, toolPermissionContext]);

  const toolCountsByServer = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const server of servers) {
      counts[server.name] = filterToolsByServer(availableMcpTools, server.name).length;
    }
    return counts;
  }, [servers, availableMcpTools]);

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
      const heading = getScopeHeading(scope, activeAgentName);
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
    if (visibleAgentServers.length > 0) {
      items.push({
        type: 'heading',
        value: 'heading-agent-mcps',
        label: renderScopeHeading('Agent MCPs'),
      });
      const agentNames = [...new Set(visibleAgentServers.flatMap(s => s.sourceAgents))];
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
        for (const agentServer of visibleAgentServers.filter(s => s.sourceAgents.includes(agentName))) {
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
      const dynamicHeading = getScopeHeading('dynamic', activeAgentName);
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
    activeAgentName,
    claudeAiServers,
    unusedClaudeAiServers,
    effectiveShowUnused,
    suppressedClaudeAiConnectors,
    visibleAgentServers,
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
        const { icon, facts } = buildServerItemProps(
          entry.server,
          toolCountsByServer[entry.server.name],
          isScreenReader,
        );
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
  }, [selectableItems, toolCountsByServer, isScreenReader]);

  if (servers.length === 0 && visibleAgentServers.length === 0 && suppressedClaudeAiConnectors.length === 0) {
    return null;
  }

  const totalServers = servers.length + visibleAgentServers.length;
  const chromeRows = insideModal ? 6 : 12;
  const visibleOptionCount = Math.max(MIN_VISIBLE_ROWS, availableRows - chromeRows);
  const hasSelectableItems = selectableItems.some(entry => entry.type !== 'heading');
  const overflows = hasSelectableItems && itemOptions.length > visibleOptionCount;

  return (
    <Box flexDirection="column">
      <McpParsingWarnings />

      <Dialog
        title="MCP servers"
        subtitle={`${totalServers} ${plural(totalServers, 'server')}`}
        onCancel={handleCancel}
        inputGuide={
          <Byline>
            {hasSelectableItems && <KeyboardShortcutHint shortcut="Enter" action="view" />}
            <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="close" />
          </Byline>
        }
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
            <Text dimColor>
              <Link url="https://code.claude.com/docs/en/mcp">https://code.claude.com/docs/en/mcp</Link> for help
            </Text>
          </Box>
        </Box>
      </Dialog>
    </Box>
  );
}
