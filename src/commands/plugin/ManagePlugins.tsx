import figures from 'figures';
import type { Dirent } from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ConfigurableShortcutHint } from '../../components/ConfigurableShortcutHint.js';
import { Byline, type DOMElement, useApp } from '@anthropic/ink';
import { MCPRemoteServerMenu } from '../../components/mcp/MCPRemoteServerMenu.js';
import { MCPStdioServerMenu } from '../../components/mcp/MCPStdioServerMenu.js';
import { MCPToolDetailView } from '../../components/mcp/MCPToolDetailView.js';
import { MCPToolListView } from '../../components/mcp/MCPToolListView.js';
import type { ClaudeAIServerInfo, HTTPServerInfo, SSEServerInfo, StdioServerInfo } from '../../components/mcp/types.js';
import { SearchBox } from '../../components/SearchBox.js';
import { useSearchInput } from '@anthropic/ink';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
// eslint-disable-next-line custom-rules/prefer-use-keybindings -- useInput needed for raw search mode text input
import { Box, Text, useInput, useModalOrTerminalSize, useTerminalFocus, useWantEveryKey } from '@anthropic/ink';
import { useKeybinding, useKeybindings } from '../../keybindings/useKeybinding.js';
import { getBuiltinPluginDefinition } from '../../plugins/builtinPlugins.js';
import { useMcpToggleEnabled } from '../../services/mcp/MCPConnectionManager.js';
import type {
  MCPServerConnection,
  McpClaudeAIProxyServerConfig,
  McpHTTPServerConfig,
  McpSSEServerConfig,
  McpStdioServerConfig,
} from '../../services/mcp/types.js';
import { filterToolsByServer } from '../../services/mcp/utils.js';
import {
  disablePluginOp,
  enablePluginOp,
  getPluginInstallationFromV2,
  isInstallableScope,
  isPluginEnabledAtProjectScope,
  uninstallPluginOp,
  updatePluginOp,
  type InstallableScope,
} from '../../services/plugins/pluginOperations.js';
import { useAppState } from '../../state/AppState.js';
import type { Tool } from '../../Tool.js';
import type { LoadedPlugin, PluginError } from '../../types/plugin.js';
import { count } from '../../utils/array.js';
import { openBrowser } from '../../utils/browser.js';
import { logForDebugging } from '../../utils/debug.js';
import { errorMessage, toError } from '../../utils/errors.js';
import { logError } from '../../utils/log.js';
import { clearAllCaches } from '../../utils/plugins/cacheUtils.js';
import { loadInstalledPluginsV2 } from '../../utils/plugins/installedPluginsManager.js';
import { getMarketplace, loadKnownMarketplacesConfig } from '../../utils/plugins/marketplaceManager.js';
import { resolveShownArchiveHeadersHelper } from '../../utils/plugins/marketplaceHeadersHelper.js';
import type { HeadersHelperPaneShown } from '../../utils/plugins/marketplaceHeadersHelper.js';
import type { MarketplaceSource, PluginMarketplaceEntry } from '../../utils/plugins/schemas.js';
import {
  gateHeadersHelperPaneForAction,
  PluginHeadersHelperDisclosure,
  useHeadersHelperPaneConsent,
} from './pluginDetailsHelpers.js';
import {
  isMcpbSource,
  loadMcpbFile,
  type McpbNeedsConfigResult,
  type UserConfigValues,
} from '../../utils/plugins/mcpbHandler.js';
import { getPluginDataDirSize, pluginDataDirPath } from '../../utils/plugins/pluginDirectories.js';
import { getFlaggedPlugins, markFlaggedPluginsSeen, removeFlaggedPlugin } from '../../utils/plugins/pluginFlagging.js';
import { type PersistablePluginScope, parsePluginIdentifier } from '../../utils/plugins/pluginIdentifier.js';
import { loadAllPlugins } from '../../utils/plugins/pluginLoader.js';
import {
  loadPluginOptions,
  type PluginOptionSchema,
  savePluginOptions,
} from '../../utils/plugins/pluginOptionsStorage.js';
import { isPluginBlockedByPolicy } from '../../utils/plugins/pluginPolicy.js';
import { getPluginEditableScopes } from '../../utils/plugins/pluginStartupCheck.js';
import {
  getSettings_DEPRECATED,
  getSettingsForSource,
  updateSettingsForSource,
} from '../../utils/settings/settings.js';
import { jsonParse } from '../../utils/slowOperations.js';
import { re, Vr, Wr } from '../../utils/plugins/escapeSafeText.js';
import { plural } from '../../utils/stringUtils.js';
import { formatErrorMessage, getErrorGuidance } from './PluginErrors.js';
import { PluginOptionsDialog } from './PluginOptionsDialog.js';
import { PluginOptionsFlow } from './PluginOptionsFlow.js';
import type { ViewState as ParentViewState } from './types.js';
import { UnifiedInstalledCell } from './UnifiedInstalledCell.js';
import type { UnifiedInstalledItem, UnifiedInstalledScope } from './unifiedTypes.js';
import { usePagination } from './usePagination.js';
import {
  applySearchBurstInput,
  computePluginListMaxVisible,
  ENTER_REPEAT_COOLDOWN_MS,
  isPluginViewOpCurrent,
  PluginConfirmList,
  recordPluginUiClick,
  shouldIgnorePluginEnterAction,
  usePluginListExtendedKeys,
} from './pluginListHelpers.js';

type Props = {
  setViewState: (state: ParentViewState) => void;
  setResult: (result: string | null) => void;
  onManageComplete?: () => void | Promise<void>;
  onSearchModeChange?: (isActive: boolean) => void;
  targetPlugin?: string;
  targetMarketplace?: string;
  action?: 'enable' | 'disable' | 'uninstall' | 'configure';
};

type FlaggedPluginInfo = {
  id: string;
  name: string;
  marketplace: string;
  reason: string;
  text: string;
  flaggedAt: string;
};

type FailedPluginInfo = {
  id: string;
  name: string;
  marketplace: string;
  errors: PluginError[];
  scope: UnifiedInstalledScope;
};

type ViewState =
  | 'plugin-list'
  | 'plugin-details'
  | 'configuring'
  | { type: 'plugin-options' }
  | { type: 'configuring-options'; schema: PluginOptionSchema }
  | 'confirm-project-uninstall'
  | { type: 'confirm-data-cleanup'; size: { bytes: number; human: string } }
  | { type: 'flagged-detail'; plugin: FlaggedPluginInfo }
  | { type: 'failed-plugin-details'; plugin: FailedPluginInfo }
  | { type: 'mcp-detail'; client: MCPServerConnection }
  | { type: 'mcp-tools'; client: MCPServerConnection }
  | { type: 'mcp-tool-detail'; client: MCPServerConnection; tool: Tool };

type MarketplaceInfo = {
  name: string;
  installedPlugins: LoadedPlugin[];
  enabledCount?: number;
  disabledCount?: number;
};

type PluginState = {
  plugin: LoadedPlugin;
  marketplace: string;
  scope?: 'user' | 'project' | 'local' | 'managed' | 'builtin';
  pendingEnable?: boolean; // Toggle enable/disable
  pendingUpdate?: boolean; // Marked for update
};

/**
 * Get list of base file names (without .md extension) from a directory
 * @param dirPath The directory path to list files from
 * @returns Array of base file names without .md extension
 * @example
 * // Given directory contains: agent-sdk-verifier-py.md, agent-sdk-verifier-ts.md, README.txt
 * await getBaseFileNames('/path/to/agents')
 * // Returns: ['agent-sdk-verifier-py', 'agent-sdk-verifier-ts']
 */
async function getBaseFileNames(dirPath: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries
      .filter((entry: Dirent) => entry.isFile() && entry.name.endsWith('.md'))
      .map((entry: Dirent) => {
        // Remove .md extension specifically
        const baseName = path.basename(entry.name, '.md');
        return baseName;
      });
  } catch (error) {
    const errorMsg = errorMessage(error);
    logForDebugging(`Failed to read plugin components from ${dirPath}: ${errorMsg}`, { level: 'error' });
    logError(toError(error));
    // Return empty array to allow graceful degradation - plugin details can still be shown
    return [];
  }
}

/**
 * Get list of skill directory names from a skills directory
 * Skills are directories containing a SKILL.md file
 * @param dirPath The skills directory path to scan
 * @returns Array of skill directory names that contain SKILL.md
 * @example
 * // Given directory contains: my-skill/SKILL.md, another-skill/SKILL.md, README.txt
 * await getSkillDirNames('/path/to/skills')
 * // Returns: ['my-skill', 'another-skill']
 */
async function getSkillDirNames(dirPath: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const skillNames: string[] = [];

    for (const entry of entries) {
      // Check if it's a directory or symlink (symlinks may point to skill directories)
      if (entry.isDirectory() || entry.isSymbolicLink()) {
        // Check if this directory contains a SKILL.md file
        const skillFilePath = path.join(dirPath, entry.name, 'SKILL.md');
        try {
          const st = await fs.stat(skillFilePath);
          if (st.isFile()) {
            skillNames.push(entry.name);
          }
        } catch {
          // No SKILL.md file in this directory, skip it
        }
      }
    }

    return skillNames;
  } catch (error) {
    const errorMsg = errorMessage(error);
    logForDebugging(`Failed to read skill directories from ${dirPath}: ${errorMsg}`, { level: 'error' });
    logError(toError(error));
    // Return empty array to allow graceful degradation - plugin details can still be shown
    return [];
  }
}

/**
 * densable 2.1.238 — load marketplace entry and show headersHelper on manage details.
 */
function ManagedPluginHeadersHelperDisclosure({
  pluginId,
  marketplaceName,
  pluginName,
  onHelper,
}: {
  pluginId: string;
  marketplaceName: string;
  pluginName: string;
  onHelper: (helper: HeadersHelperPaneShown | null) => void;
}): React.ReactNode {
  const [entry, setEntry] = useState<PluginMarketplaceEntry | null>(null);
  const [marketplaceSource, setMarketplaceSource] = useState<MarketplaceSource | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [mkt, known] = await Promise.all([getMarketplace(marketplaceName), loadKnownMarketplacesConfig()]);
        if (cancelled) return;
        const next = mkt.plugins.find(p => p.name === pluginName) ?? null;
        const source = known[marketplaceName]?.source;
        setEntry(next);
        setMarketplaceSource(source);
        onHelper(
          next
            ? resolveShownArchiveHeadersHelper({
                entry: next,
                marketplaceName,
                marketplaceSource: source,
                catchOverlayRefusal: true,
              })
            : null,
        );
      } catch {
        if (!cancelled) {
          setEntry(null);
          setMarketplaceSource(undefined);
          onHelper(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [marketplaceName, pluginName, onHelper]);
  if (!entry) return null;
  return (
    <PluginHeadersHelperDisclosure
      pluginId={pluginId}
      entry={entry}
      marketplaceName={marketplaceName}
      marketplaceSource={marketplaceSource}
    />
  );
}

// Component to display installed plugin components
function PluginComponentsDisplay({
  plugin,
  marketplace,
}: {
  plugin: LoadedPlugin;
  marketplace: string;
}): React.ReactNode {
  const [components, setComponents] = useState<{
    commands?: string | string[] | Record<string, unknown> | null;
    agents?: string | string[] | Record<string, unknown> | null;
    skills?: string | string[] | Record<string, unknown> | null;
    hooks?: unknown;
    mcpServers?: unknown;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadComponents() {
      try {
        // Built-in plugins don't have a marketplace entry — read from the
        // registered definition directly.
        if (marketplace === 'builtin') {
          const builtinDef = getBuiltinPluginDefinition(plugin.name);
          if (builtinDef) {
            const skillNames = builtinDef.skills?.map(s => s.name) ?? [];
            const hookEvents = builtinDef.hooks ? Object.keys(builtinDef.hooks) : [];
            const mcpServerNames = builtinDef.mcpServers ? Object.keys(builtinDef.mcpServers) : [];
            setComponents({
              commands: null,
              agents: null,
              skills: skillNames.length > 0 ? skillNames : null,
              hooks: hookEvents.length > 0 ? hookEvents : null,
              mcpServers: mcpServerNames.length > 0 ? mcpServerNames : null,
            });
          } else {
            setError(`Built-in plugin ${re(plugin.name)} not found`);
          }
          setLoading(false);
          return;
        }

        const marketplaceData = await getMarketplace(marketplace);
        // Find the plugin entry in the array
        const pluginEntry = marketplaceData.plugins.find(p => p.name === plugin.name);
        if (pluginEntry) {
          // Combine commands from both sources
          const commandPathList = [];
          if (plugin.commandsPath) {
            commandPathList.push(plugin.commandsPath);
          }
          if (plugin.commandsPaths) {
            commandPathList.push(...plugin.commandsPaths);
          }

          // Get base file names from all command paths
          const commandList: string[] = [];
          for (const commandPath of commandPathList) {
            if (typeof commandPath === 'string') {
              // commandPath is already a full path
              const baseNames = await getBaseFileNames(commandPath);
              commandList.push(...baseNames);
            }
          }

          // Combine agents from both sources
          const agentPathList = [];
          if (plugin.agentsPath) {
            agentPathList.push(plugin.agentsPath);
          }
          if (plugin.agentsPaths) {
            agentPathList.push(...plugin.agentsPaths);
          }

          // Get base file names from all agent paths
          const agentList: string[] = [];
          for (const agentPath of agentPathList) {
            if (typeof agentPath === 'string') {
              // agentPath is already a full path
              const baseNames = await getBaseFileNames(agentPath);
              agentList.push(...baseNames);
            }
          }

          // Combine skills from both sources
          const skillPathList = [];
          if (plugin.skillsPath) {
            skillPathList.push(plugin.skillsPath);
          }
          if (plugin.skillsPaths) {
            skillPathList.push(...plugin.skillsPaths);
          }

          // Get skill directory names from all skill paths
          // Skills are directories containing SKILL.md files
          const skillList: string[] = [];
          for (const skillPath of skillPathList) {
            if (typeof skillPath === 'string') {
              // skillPath is already a full path to a skills directory
              const skillDirNames = await getSkillDirNames(skillPath);
              skillList.push(...skillDirNames);
            }
          }

          // Combine hooks from both sources
          const hooksList = [];
          if (plugin.hooksConfig) {
            hooksList.push(Object.keys(plugin.hooksConfig));
          }
          if (pluginEntry.hooks) {
            hooksList.push(pluginEntry.hooks);
          }

          // Combine MCP servers from both sources
          const mcpServersList = [];
          if (plugin.mcpServers) {
            mcpServersList.push(Object.keys(plugin.mcpServers));
          }
          if (pluginEntry.mcpServers) {
            mcpServersList.push(pluginEntry.mcpServers);
          }

          setComponents({
            commands: commandList.length > 0 ? commandList : null,
            agents: agentList.length > 0 ? agentList : null,
            skills: skillList.length > 0 ? skillList : null,
            hooks: hooksList.length > 0 ? hooksList : null,
            mcpServers: mcpServersList.length > 0 ? mcpServersList : null,
          });
        } else {
          setError(`Plugin ${re(plugin.name)} not found in marketplace`);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load components');
      } finally {
        setLoading(false);
      }
    }
    void loadComponents();
  }, [
    plugin.name,
    plugin.commandsPath,
    plugin.commandsPaths,
    plugin.agentsPath,
    plugin.agentsPaths,
    plugin.skillsPath,
    plugin.skillsPaths,
    plugin.hooksConfig,
    plugin.mcpServers,
    marketplace,
  ]);

  if (loading) {
    return null; // Don't show loading state for cleaner UI
  }

  if (error) {
    return (
      <Box flexDirection="column" marginBottom={1}>
        <Text bold>Components:</Text>
        <Text dimColor>Error: {error}</Text>
      </Box>
    );
  }

  if (!components) {
    return null; // No components info available
  }

  const hasComponents =
    components.commands || components.agents || components.skills || components.hooks || components.mcpServers;

  if (!hasComponents) {
    return null; // No components defined
  }

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold>Installed components:</Text>
      {components.commands ? (
        <Text dimColor>
          • Commands:{' '}
          {typeof components.commands === 'string'
            ? components.commands
            : Array.isArray(components.commands)
              ? components.commands.join(', ')
              : Object.keys(components.commands).join(', ')}
        </Text>
      ) : null}
      {components.agents ? (
        <Text dimColor>
          • Agents:{' '}
          {typeof components.agents === 'string'
            ? components.agents
            : Array.isArray(components.agents)
              ? components.agents.join(', ')
              : Object.keys(components.agents).join(', ')}
        </Text>
      ) : null}
      {components.skills ? (
        <Text dimColor>
          • Skills:{' '}
          {typeof components.skills === 'string'
            ? components.skills
            : Array.isArray(components.skills)
              ? components.skills.join(', ')
              : Object.keys(components.skills).join(', ')}
        </Text>
      ) : null}
      {components.hooks ? (
        <Text dimColor>
          • Hooks:{' '}
          {typeof components.hooks === 'string'
            ? components.hooks
            : Array.isArray(components.hooks)
              ? components.hooks.map(String).join(', ')
              : typeof components.hooks === 'object' && components.hooks !== null
                ? Object.keys(components.hooks).join(', ')
                : String(components.hooks)}
        </Text>
      ) : null}
      {components.mcpServers ? (
        <Text dimColor>
          • MCP Servers:{' '}
          {typeof components.mcpServers === 'string'
            ? components.mcpServers
            : Array.isArray(components.mcpServers)
              ? components.mcpServers.map(String).join(', ')
              : typeof components.mcpServers === 'object' && components.mcpServers !== null
                ? Object.keys(components.mcpServers).join(', ')
                : String(components.mcpServers)}
        </Text>
      ) : null}
    </Box>
  );
}

/**
 * Check if a plugin is from a local source and cannot be remotely updated
 * @returns Error message if local, null if remote/updatable
 */
async function checkIfLocalPlugin(pluginName: string, marketplaceName: string): Promise<string | null> {
  const marketplace = await getMarketplace(marketplaceName);
  const entry = marketplace?.plugins.find(p => p.name === pluginName);

  if (entry && typeof entry.source === 'string') {
    return `Local plugins cannot be updated remotely. To update, modify the source at: ${entry.source}`;
  }

  return null;
}

/**
 * Filter out plugins that are force-disabled by org policy (policySettings).
 * These are blocked by the organization and cannot be re-enabled by the user.
 * Checks policySettings directly rather than installation scope, since managed
 * settings don't create installation records with scope 'managed'.
 */
export function filterManagedDisabledPlugins(plugins: LoadedPlugin[]): LoadedPlugin[] {
  return plugins.filter(plugin => {
    const marketplace = plugin.source.split('@')[1] || 'local';
    return !isPluginBlockedByPolicy(`${plugin.name}@${marketplace}`);
  });
}

export function ManagePlugins({
  setViewState: setParentViewState,
  setResult,
  onManageComplete,
  onSearchModeChange,
  targetPlugin,
  targetMarketplace,
  action,
}: Props): React.ReactNode {
  // App state for MCP access
  const mcpClients = useAppState(s => s.mcp.clients);
  const mcpTools = useAppState(s => s.mcp.tools);
  const pluginErrors = useAppState(s => s.plugins.errors);
  const flaggedPlugins = getFlaggedPlugins();

  // Search state
  const { focusManager } = useApp();
  const searchBoxRef = useRef<DOMElement | null>(null);
  // Official 2.1.328 #614 & #615: View generation & target-plugin guards so
  // slow async saves/removals/uninstalls never reopen a closed page, close an
  // open page, ask to uninstall the wrong plugin, or leave Esc trapped.
  const viewGenRef = useRef(0);
  const activePluginIdRef = useRef<string | null>(null);
  const isProcessingRef = useRef(false);
  const mountedRef = useRef(true);
  const toggleChainsRef = useRef<Map<string, Promise<void>>>(new Map());

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  // Official 2.1.327 #382 & 2.1.328 #617: Track transition/accept timestamps
  // so click+Enter or held Enter cannot turn off several plugins.
  const lastViewTransitionAtRef = useRef(0);
  const lastEnterAcceptAtRef = useRef(0);
  // Official 2.1.328 #462: Preserve focused MCP tool when returning from tool detail.
  const [lastMcpToolSelection, setLastMcpToolSelection] = useState<{
    serverName: string;
    toolName: string;
    toolIndex: number;
  } | null>(null);
  const filteredItemsLengthRef = useRef(0);

  const [isSearchMode, setIsSearchModeRaw] = useState(false);
  const isSearchModeRef = useRef(isSearchMode);
  isSearchModeRef.current = isSearchMode;
  const setIsSearchMode = useCallback(
    (active: boolean) => {
      isSearchModeRef.current = active;
      setIsSearchModeRaw(active);
      onSearchModeChange?.(active);
    },
    [onSearchModeChange],
  );
  const enterSearchMode = useCallback(() => {
    setIsSearchMode(true);
  }, [setIsSearchMode]);
  const isTerminalFocused = useTerminalFocus();
  const { columns: terminalWidth, rows: terminalRows } = useModalOrTerminalSize(useTerminalSize());

  // View state
  const [viewState, setViewState] = useState<ViewState>('plugin-list');

  const isSearchActive = viewState === 'plugin-list' && isSearchMode;
  // Official 2.1.328 (#603): receive every keypress while search input is active.
  useWantEveryKey(isSearchActive);

  const {
    query: searchQuery,
    queryRef: searchQueryRef,
    setQuery: setSearchQuery,
    cursorOffset: searchCursorOffset,
    cursorOffsetRef: searchCursorOffsetRef,
    setCursorOffset: setSearchCursorOffset,
    handleKeyDown: rawHandleSearchKeyDown,
    handlePaste: rawHandleSearchPaste,
  } = useSearchInput({
    isActive: isSearchActive,
    onExit: () => {
      // Official 2.1.328 #616: When a search has no results, stay in search mode
      // instead of stranding the cursor on an empty list.
      if (filteredItemsLengthRef.current === 0 && searchQueryRef.current.length > 0) {
        return;
      }
      setIsSearchMode(false);
    },
  });
  // Official 2.1.327 #410: Protect search input handlers from malformed/burst key events.
  const handleSearchKeyDown = useCallback(
    (event: Parameters<typeof rawHandleSearchKeyDown>[0]) => {
      try {
        rawHandleSearchKeyDown(event);
      } catch (err) {
        logForDebugging(`ManagePlugins search key burst ignored: ${errorMessage(err)}`);
      }
    },
    [rawHandleSearchKeyDown],
  );
  const handleSearchPaste = useCallback(
    (event: Parameters<typeof rawHandleSearchPaste>[0]) => {
      try {
        rawHandleSearchPaste(event);
      } catch (err) {
        logForDebugging(`ManagePlugins search paste burst ignored: ${errorMessage(err)}`);
      }
    },
    [rawHandleSearchPaste],
  );
  // Official 2.1.328 #616: Always focus SearchBox when entering search mode (even
  // after clicking the tab row, which shifts Ink focus to Tabs' header element).
  useEffect(() => {
    if (viewState === 'plugin-list' && isSearchMode && searchBoxRef.current) {
      focusManager?.focus(searchBoxRef.current);
    }
  }, [viewState, isSearchMode, focusManager]);
  const [selectedPlugin, setSelectedPlugin] = useState<PluginState | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const bumpViewGeneration = useCallback((nextPluginId: string | null = null) => {
    viewGenRef.current += 1;
    activePluginIdRef.current = nextPluginId;
    isProcessingRef.current = false;
    lastViewTransitionAtRef.current = Date.now();
    setIsProcessing(false);
  }, []);

  // Data state
  const [marketplaces, setMarketplaces] = useState<MarketplaceInfo[]>([]);
  const [pluginStates, setPluginStates] = useState<PluginState[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingToggles, setPendingToggles] = useState<Map<string, 'will-enable' | 'will-disable'>>(new Map());

  // Guard to prevent auto-navigation from re-triggering after the user
  // navigates away (targetPlugin is never cleared by the parent).
  const hasAutoNavigated = useRef(false);
  // Auto-action (enable/disable/uninstall) to fire after auto-navigation lands.
  // Ref, not state: it's consumed by a one-shot effect that already re-runs on
  // viewState/selectedPlugin, so a render-triggering state var would be redundant.
  const pendingAutoActionRef = useRef<'enable' | 'disable' | 'uninstall' | 'configure' | undefined>(undefined);

  // MCP toggle hook
  const toggleMcpServer = useMcpToggleEnabled();

  // Handle escape to go back - viewState-dependent navigation
  const handleBack = React.useCallback(() => {
    if (viewState === 'plugin-details') {
      bumpViewGeneration(null);
      setViewState('plugin-list');
      setSelectedPlugin(null);
      setProcessError(null);
      setPresentedHeadersHelper(null);
    } else if (viewState === 'confirm-project-uninstall') {
      bumpViewGeneration(selectedPlugin ? `${selectedPlugin.plugin.name}@${selectedPlugin.marketplace}` : null);
      setViewState(selectedPlugin ? 'plugin-details' : 'plugin-list');
      setProcessError(null);
    } else if (typeof viewState === 'object' && viewState.type === 'confirm-data-cleanup') {
      bumpViewGeneration(selectedPlugin ? `${selectedPlugin.plugin.name}@${selectedPlugin.marketplace}` : null);
      setViewState(selectedPlugin ? 'plugin-details' : 'plugin-list');
      setProcessError(null);
    } else if (typeof viewState === 'object' && viewState.type === 'failed-plugin-details') {
      bumpViewGeneration(null);
      setViewState('plugin-list');
      setProcessError(null);
      setPresentedHeadersHelper(null);
    } else if (viewState === 'configuring') {
      bumpViewGeneration(selectedPlugin ? `${selectedPlugin.plugin.name}@${selectedPlugin.marketplace}` : null);
      setViewState('plugin-details');
      setConfigNeeded(null);
    } else if (
      typeof viewState === 'object' &&
      (viewState.type === 'plugin-options' || viewState.type === 'configuring-options')
    ) {
      bumpViewGeneration(null);
      // Cancel mid-sequence — plugin is already enabled, just bail to list.
      // User can configure later via the Configure options menu if they want.
      setViewState('plugin-list');
      setSelectedPlugin(null);
      setResult('Plugin enabled. Configuration skipped — run /reload-plugins to apply.');
      if (onManageComplete) {
        void onManageComplete();
      }
    } else if (typeof viewState === 'object' && viewState.type === 'flagged-detail') {
      bumpViewGeneration(null);
      setViewState('plugin-list');
      setProcessError(null);
    } else if (typeof viewState === 'object' && viewState.type === 'mcp-detail') {
      bumpViewGeneration(null);
      setViewState('plugin-list');
      setProcessError(null);
    } else if (typeof viewState === 'object' && viewState.type === 'mcp-tools') {
      bumpViewGeneration(null);
      setViewState({ type: 'mcp-detail', client: viewState.client });
    } else if (typeof viewState === 'object' && viewState.type === 'mcp-tool-detail') {
      bumpViewGeneration(null);
      setViewState({ type: 'mcp-tools', client: viewState.client });
    } else {
      bumpViewGeneration(null);
      if (pendingToggles.size > 0) {
        void onManageComplete?.();
        setResult('Run /reload-plugins to apply plugin changes.');
        return;
      }
      setParentViewState({ type: 'menu' });
    }
  }, [viewState, selectedPlugin, bumpViewGeneration, setParentViewState, pendingToggles, setResult, onManageComplete]);

  // Escape when not in search mode - go back.
  // Excludes confirm-project-uninstall and confirm-data-cleanup ONLY when
  // PluginConfirmList is active (not processing); while processing, keep Esc
  // active here so Esc is never ignored (#615).
  // Also disabled while MCP subviews (mcp-detail/mcp-tools/mcp-tool-detail) are
  // active because their own Dialog/onCancel owns Esc.
  useKeybinding('confirm:no', handleBack, {
    context: 'Confirmation',
    isActive:
      (viewState !== 'plugin-list' || !isSearchMode) &&
      !(
        typeof viewState === 'object' &&
        (viewState.type === 'mcp-detail' || viewState.type === 'mcp-tools' || viewState.type === 'mcp-tool-detail')
      ) &&
      (isProcessing ||
        (viewState !== 'confirm-project-uninstall' &&
          !(typeof viewState === 'object' && viewState.type === 'confirm-data-cleanup'))),
  });

  // Fallback out of render when an MCP detail view has an unsupported transport config type.
  const mcpDetailConfigType =
    typeof viewState === 'object' && viewState.type === 'mcp-detail'
      ? (mcpClients.find(c => c.name === viewState.client.name) ?? viewState.client).config.type
      : undefined;
  const isUnsupportedMcpDetail =
    typeof viewState === 'object' &&
    viewState.type === 'mcp-detail' &&
    !(
      mcpDetailConfigType === 'stdio' ||
      mcpDetailConfigType === 'sse' ||
      mcpDetailConfigType === 'http' ||
      mcpDetailConfigType === 'claudeai-proxy'
    );
  useEffect(() => {
    if (isUnsupportedMcpDetail) {
      setViewState('plugin-list');
    }
  }, [isUnsupportedMcpDetail]);

  // Helper to get MCP status
  const getMcpStatus = (
    client: MCPServerConnection,
  ): 'connected' | 'disabled' | 'pending' | 'needs-auth' | 'failed' => {
    if (client.type === 'connected') return 'connected';
    if (client.type === 'disabled') return 'disabled';
    if (client.type === 'pending') return 'pending';
    if (client.type === 'needs-auth') return 'needs-auth';
    return 'failed';
  };

  // Derive unified items from plugins and MCP servers
  const unifiedItems = useMemo(() => {
    const mergedSettings = getSettings_DEPRECATED();

    // Build map of plugin name -> child MCPs
    // Plugin MCPs have names like "plugin:pluginName:serverName"
    const pluginMcpMap = new Map<string, Array<{ displayName: string; client: MCPServerConnection }>>();
    for (const client of mcpClients) {
      if (client.name.startsWith('plugin:')) {
        const parts = client.name.split(':');
        if (parts.length >= 3) {
          const pluginName = parts[1]!;
          const serverName = parts.slice(2).join(':');
          const existing = pluginMcpMap.get(pluginName) || [];
          existing.push({ displayName: serverName, client });
          pluginMcpMap.set(pluginName, existing);
        }
      }
    }

    // Build plugin items (unsorted for now)
    type PluginWithChildren = {
      item: UnifiedInstalledItem & { type: 'plugin' };
      originalScope: 'user' | 'project' | 'local' | 'managed' | 'builtin';
      childMcps: Array<{ displayName: string; client: MCPServerConnection }>;
    };
    const pluginsWithChildren: PluginWithChildren[] = [];

    for (const state of pluginStates) {
      const pluginId = `${state.plugin.name}@${state.marketplace}`;
      const isEnabled = mergedSettings?.enabledPlugins?.[pluginId] !== false;
      const errors = pluginErrors.filter(
        e =>
          ('plugin' in e && e.plugin === state.plugin.name) ||
          e.source === pluginId ||
          e.source.startsWith(`${state.plugin.name}@`),
      );

      // Built-in plugins use 'builtin' scope; others look up from V2 data.
      const originalScope = state.plugin.isBuiltin ? 'builtin' : state.scope || 'user';

      pluginsWithChildren.push({
        item: {
          type: 'plugin',
          id: pluginId,
          name: state.plugin.name,
          description: state.plugin.manifest.description,
          marketplace: state.marketplace,
          scope: originalScope,
          isEnabled,
          errorCount: errors.length,
          errors,
          plugin: state.plugin,
          pendingEnable: state.pendingEnable,
          pendingUpdate: state.pendingUpdate,
          pendingToggle: pendingToggles.get(pluginId),
        },
        originalScope,
        childMcps: pluginMcpMap.get(state.plugin.name) || [],
      });
    }

    // Find orphan errors (errors for plugins that failed to load entirely)
    const matchedPluginIds = new Set(pluginsWithChildren.map(({ item }) => item.id));
    const matchedPluginNames = new Set(pluginsWithChildren.map(({ item }) => item.name));
    const orphanErrorsBySource = new Map<string, typeof pluginErrors>();
    for (const error of pluginErrors) {
      if (
        matchedPluginIds.has(error.source) ||
        ('plugin' in error && typeof error.plugin === 'string' && matchedPluginNames.has(error.plugin))
      ) {
        continue;
      }
      const existing = orphanErrorsBySource.get(error.source) || [];
      existing.push(error);
      orphanErrorsBySource.set(error.source, existing);
    }
    const pluginScopes = getPluginEditableScopes();
    const failedPluginItems: UnifiedInstalledItem[] = [];
    for (const [pluginId, errors] of orphanErrorsBySource) {
      // Skip plugins that are already shown in the flagged section
      if (pluginId in flaggedPlugins) continue;
      const parsed = parsePluginIdentifier(pluginId);
      const pluginName = parsed.name || pluginId;
      const marketplace = parsed.marketplace || 'unknown';
      const rawScope = pluginScopes.get(pluginId);
      // 'flag' is session-only (from --plugin-dir / flagSettings) and undefined
      // means the plugin isn't in any settings source. Default both to 'user'
      // since UnifiedInstalledItem doesn't have a 'flag' scope variant.
      const scope = rawScope === 'flag' || rawScope === undefined ? 'user' : rawScope;
      failedPluginItems.push({
        type: 'failed-plugin',
        id: pluginId,
        name: pluginName,
        marketplace,
        scope,
        errorCount: errors.length,
        errors,
      });
    }

    // Build standalone MCP items
    const standaloneMcps: UnifiedInstalledItem[] = [];
    for (const client of mcpClients) {
      if (client.name === 'ide') continue;
      if (client.name.startsWith('plugin:')) continue;

      standaloneMcps.push({
        type: 'mcp',
        id: `mcp:${client.name}`,
        name: client.name,
        description: undefined,
        scope: client.config.scope,
        status: getMcpStatus(client),
        client,
      });
    }

    // Define scope order for display
    const scopeOrder: Record<string, number> = {
      flagged: -1,
      project: 0,
      local: 1,
      user: 2,
      enterprise: 3,
      managed: 4,
      dynamic: 5,
      builtin: 6,
    };

    // Build final list by merging plugins (with their child MCPs) and standalone MCPs
    // Group by scope to avoid duplicate scope headers
    const unified: UnifiedInstalledItem[] = [];

    // Create a map of scope -> items for proper merging
    const itemsByScope = new Map<string, UnifiedInstalledItem[]>();

    // Add plugins with their child MCPs
    for (const { item, originalScope, childMcps } of pluginsWithChildren) {
      const scope = item.scope;
      if (!itemsByScope.has(scope)) {
        itemsByScope.set(scope, []);
      }
      itemsByScope.get(scope)!.push(item);
      // Add child MCPs right after the plugin, indented (use original scope, not 'flagged').
      // Built-in plugins map to 'user' for display since MCP ConfigScope doesn't include 'builtin'.
      for (const { displayName, client } of childMcps) {
        const displayScope = originalScope === 'builtin' ? 'user' : originalScope;
        if (!itemsByScope.has(displayScope)) {
          itemsByScope.set(displayScope, []);
        }
        itemsByScope.get(displayScope)!.push({
          type: 'mcp',
          id: `mcp:${client.name}`,
          name: displayName,
          description: undefined,
          scope: displayScope,
          status: getMcpStatus(client),
          client,
          indented: true,
        });
      }
    }

    // Add standalone MCPs to their respective scope groups
    for (const mcp of standaloneMcps) {
      const scope = mcp.scope;
      if (!itemsByScope.has(scope)) {
        itemsByScope.set(scope, []);
      }
      itemsByScope.get(scope)!.push(mcp);
    }

    // Add failed plugins to their respective scope groups
    for (const failedPlugin of failedPluginItems) {
      const scope = failedPlugin.scope;
      if (!itemsByScope.has(scope)) {
        itemsByScope.set(scope, []);
      }
      itemsByScope.get(scope)!.push(failedPlugin);
    }

    // Add flagged (delisted) plugins from user settings.
    // Reason/text are looked up from the cached security messages file.
    for (const [pluginId, entry] of Object.entries(flaggedPlugins)) {
      const parsed = parsePluginIdentifier(pluginId);
      const pluginName = parsed.name || pluginId;
      const marketplace = parsed.marketplace || 'unknown';
      if (!itemsByScope.has('flagged')) {
        itemsByScope.set('flagged', []);
      }
      itemsByScope.get('flagged')!.push({
        type: 'flagged-plugin',
        id: pluginId,
        name: pluginName,
        marketplace,
        scope: 'flagged',
        reason: 'delisted',
        text: 'Removed from marketplace',
        flaggedAt: entry.flaggedAt,
      });
    }

    // Sort scopes and build final list
    const sortedScopes = [...itemsByScope.keys()].sort((a, b) => (scopeOrder[a] ?? 99) - (scopeOrder[b] ?? 99));

    for (const scope of sortedScopes) {
      const items = itemsByScope.get(scope)!;

      // Separate items into plugin groups (with their child MCPs) and standalone MCPs
      // This preserves parent-child relationships that would be broken by naive sorting
      const pluginGroups: UnifiedInstalledItem[][] = [];
      const standaloneMcpsInScope: UnifiedInstalledItem[] = [];

      let i = 0;
      while (i < items.length) {
        const item = items[i]!;
        if (item.type === 'plugin' || item.type === 'failed-plugin' || item.type === 'flagged-plugin') {
          // Collect the plugin and its child MCPs as a group
          const group: UnifiedInstalledItem[] = [item];
          i++;
          // Look ahead for indented child MCPs
          let nextItem = items[i];
          while (nextItem?.type === 'mcp' && nextItem.indented) {
            group.push(nextItem);
            i++;
            nextItem = items[i];
          }
          pluginGroups.push(group);
        } else if (item.type === 'mcp' && !item.indented) {
          // Standalone MCP (not a child of a plugin)
          standaloneMcpsInScope.push(item);
          i++;
        } else {
          // Skip orphaned indented MCPs (shouldn't happen)
          i++;
        }
      }

      // Sort plugin groups by the plugin name (first item in each group)
      pluginGroups.sort((a, b) => a[0]!.name.localeCompare(b[0]!.name));

      // Sort standalone MCPs by name
      standaloneMcpsInScope.sort((a, b) => a.name.localeCompare(b.name));

      // Build final list: plugins (with their children) first, then standalone MCPs
      for (const group of pluginGroups) {
        unified.push(...group);
      }
      unified.push(...standaloneMcpsInScope);
    }

    return unified;
  }, [pluginStates, mcpClients, pluginErrors, pendingToggles, flaggedPlugins]);

  // Mark flagged plugins as seen when the Installed view renders them.
  // After 48 hours from seenAt, they auto-clear on next load.
  const flaggedIds = useMemo(
    () => unifiedItems.filter(item => item.type === 'flagged-plugin').map(item => item.id),
    [unifiedItems],
  );
  useEffect(() => {
    if (flaggedIds.length > 0) {
      void markFlaggedPluginsSeen(flaggedIds);
    }
  }, [flaggedIds]);

  // Filter items based on search query (matches name or description)
  const filteredItems = useMemo(() => {
    if (!searchQuery) return unifiedItems;
    const lowerQuery = searchQuery.toLowerCase();
    return unifiedItems.filter(
      item =>
        item.name.toLowerCase().includes(lowerQuery) ||
        ('description' in item && item.description?.toLowerCase().includes(lowerQuery)),
    );
  }, [unifiedItems, searchQuery]);
  filteredItemsLengthRef.current = filteredItems.length;

  // Selection state
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Official 2.1.326 #272: adapt visible Installed rows to terminal height so
  // cursor and key hints remain visible in short windows.
  const installedMaxVisible = computePluginListMaxVisible(terminalRows, 11, 2, 8, 2);

  // Pagination for unified list (continuous scrolling)
  const pagination = usePagination<UnifiedInstalledItem>({
    totalItems: filteredItems.length,
    selectedIndex,
    maxVisible: installedMaxVisible,
  });

  // Official 2.1.326 #272: Home / End / PgUp / PgDn navigation on Installed tab.
  usePluginListExtendedKeys({
    isActive: viewState === 'plugin-list' && !isSearchMode && filteredItems.length > 0,
    totalItems: filteredItems.length,
    selectedIndex,
    pageSize: pagination.pageSize,
    onSelectIndex: nextIdx => pagination.handleSelectionChange(nextIdx, setSelectedIndex),
  });

  // Official 2.1.326 #126: when clearing a search on the Installed tab, restore
  // list cursor focus (exit search mode if query just became empty) and reset
  // pagination scroll offset so the cursor never disappears.
  const prevSearchQueryRef = useRef(searchQuery);
  useEffect(() => {
    const prev = prevSearchQueryRef.current;
    prevSearchQueryRef.current = searchQuery;
    pagination.resetScroll();
    setSelectedIndex(0);
    if (prev !== '' && searchQuery === '' && isSearchMode) {
      setIsSearchMode(false);
    }
  }, [searchQuery, isSearchMode, setIsSearchMode, pagination.resetScroll]);

  // Details view state
  const [detailsMenuIndex, setDetailsMenuIndex] = useState(0);
  const [processError, setProcessError] = useState<string | null>(null);
  // densable 2.1.238 — when update is blocked for headersHelper, show the
  // command on this pane (SEA "now shown") before the user retries.
  const [presentedHeadersHelper, setPresentedHeadersHelper] = useState<{
    command: string;
    archiveUrl: string;
  } | null>(null);
  const [manageHeadersHelper, setManageHeadersHelper] = useState<HeadersHelperPaneShown | null>(null);
  const selectedPluginKey = selectedPlugin ? `${selectedPlugin.plugin.name}@${selectedPlugin.marketplace}` : '';
  useEffect(() => {
    setManageHeadersHelper(null);
  }, [selectedPluginKey]);
  // SEA dwo — pin only while details are showing (list identity is empty → unshown).
  const detailsHeadersHelper = viewState === 'plugin-details' ? manageHeadersHelper : null;
  const headersHelperPane = useHeadersHelperPaneConsent(detailsHeadersHelper);
  useEffect(() => {
    if (detailsHeadersHelper) headersHelperPane.record(detailsHeadersHelper);
  }, [detailsHeadersHelper, headersHelperPane]);

  // Configuration state
  const [configNeeded, setConfigNeeded] = useState<McpbNeedsConfigResult | null>(null);
  const [_isLoadingConfig, setIsLoadingConfig] = useState(false);
  const [selectedPluginHasMcpb, setSelectedPluginHasMcpb] = useState(false);

  // Detect if selected plugin has MCPB
  // Reads raw marketplace.json to work with old cached marketplaces
  useEffect(() => {
    if (!selectedPlugin) {
      setSelectedPluginHasMcpb(false);
      return;
    }

    let cancelled = false;

    async function detectMcpb() {
      // Check plugin manifest first
      const mcpServersSpec = selectedPlugin!.plugin.manifest.mcpServers;
      let hasMcpb = false;

      if (mcpServersSpec) {
        hasMcpb =
          (typeof mcpServersSpec === 'string' && isMcpbSource(mcpServersSpec)) ||
          (Array.isArray(mcpServersSpec) && mcpServersSpec.some(s => typeof s === 'string' && isMcpbSource(s)));
      }

      // If not in manifest, read raw marketplace.json directly (bypassing schema validation)
      // This works even with old cached marketplaces from before MCPB support
      if (!hasMcpb) {
        try {
          const marketplaceDir = path.join(selectedPlugin!.plugin.path, '..');
          const marketplaceJsonPath = path.join(marketplaceDir, '.claude-plugin', 'marketplace.json');

          const content = await fs.readFile(marketplaceJsonPath, 'utf-8');
          if (cancelled) return;
          const marketplace = jsonParse(content);

          const entry = marketplace.plugins?.find((p: { name: string }) => p.name === selectedPlugin!.plugin.name);

          if (entry?.mcpServers) {
            const spec = entry.mcpServers;
            hasMcpb =
              (typeof spec === 'string' && isMcpbSource(spec)) ||
              (Array.isArray(spec) && spec.some((s: unknown) => typeof s === 'string' && isMcpbSource(s)));
          }
        } catch (err) {
          logForDebugging(`Failed to read raw marketplace.json: ${err}`);
        }
      }

      if (!cancelled) {
        setSelectedPluginHasMcpb(hasMcpb);
      }
    }

    void detectMcpb();
    return () => {
      cancelled = true;
    };
  }, [selectedPlugin]);

  // Load installed plugins grouped by marketplace
  useEffect(() => {
    let cancelled = false;

    async function loadInstalledPlugins() {
      setLoading(true);
      try {
        const { enabled, disabled } = await loadAllPlugins();
        if (cancelled) return;
        const mergedSettings = getSettings_DEPRECATED(); // Use merged settings to respect all layers

        const allPlugins = filterManagedDisabledPlugins([...enabled, ...disabled]);

        // Group plugins by marketplace
        const pluginsByMarketplace: Record<string, LoadedPlugin[]> = {};
        for (const plugin of allPlugins) {
          const marketplace = plugin.source.split('@')[1] || 'local';
          if (!pluginsByMarketplace[marketplace]) {
            pluginsByMarketplace[marketplace] = [];
          }
          pluginsByMarketplace[marketplace]!.push(plugin);
        }

        // Create marketplace info array with enabled/disabled counts
        const marketplaceInfos: MarketplaceInfo[] = [];
        for (const [name, plugins] of Object.entries(pluginsByMarketplace)) {
          const enabledCount = count(plugins, p => {
            const pluginId = `${p.name}@${name}`;
            return mergedSettings?.enabledPlugins?.[pluginId] !== false;
          });
          const disabledCount = plugins.length - enabledCount;

          marketplaceInfos.push({
            name,
            installedPlugins: plugins,
            enabledCount,
            disabledCount,
          });
        }

        // Sort marketplaces: claude-plugin-directory first, then alphabetically
        marketplaceInfos.sort((a, b) => {
          if (a.name === 'claude-plugin-directory') return -1;
          if (b.name === 'claude-plugin-directory') return 1;
          return a.name.localeCompare(b.name);
        });

        setMarketplaces(marketplaceInfos);

        // Build flat list of all plugin states
        const allStates: PluginState[] = [];
        for (const marketplace of marketplaceInfos) {
          for (const plugin of marketplace.installedPlugins) {
            const pluginId = `${plugin.name}@${marketplace.name}`;
            // Built-in plugins don't have V2 install entries — skip the lookup.
            const scope = plugin.isBuiltin ? 'builtin' : getPluginInstallationFromV2(pluginId).scope;

            allStates.push({
              plugin,
              marketplace: marketplace.name,
              scope,
              pendingEnable: undefined,
              pendingUpdate: false,
            });
          }
        }
        setPluginStates(allStates);
        setSelectedIndex(0);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadInstalledPlugins();
    return () => {
      cancelled = true;
    };
  }, []);

  // Auto-navigate to target plugin if specified (once only)
  useEffect(() => {
    if (hasAutoNavigated.current) return;
    if (targetPlugin && marketplaces.length > 0 && !loading) {
      // targetPlugin may be `name` or `name@marketplace` (parseArgs passes the
      // raw arg through). Parse it so p.name matching works either way.
      const { name: targetName, marketplace: targetMktFromId } = parsePluginIdentifier(targetPlugin);
      const effectiveTargetMarketplace = targetMarketplace ?? targetMktFromId;

      // Use targetMarketplace if provided, otherwise search all
      const marketplacesToSearch = effectiveTargetMarketplace
        ? marketplaces.filter(m => m.name === effectiveTargetMarketplace)
        : marketplaces;

      // First check successfully loaded plugins
      for (const marketplace of marketplacesToSearch) {
        const plugin = marketplace.installedPlugins.find(p => p.name === targetName);
        if (plugin) {
          // Get scope from V2 data for proper operation handling
          const pluginId = `${plugin.name}@${marketplace.name}`;
          const { scope } = getPluginInstallationFromV2(pluginId);

          const pluginState: PluginState = {
            plugin,
            marketplace: marketplace.name,
            scope,
            pendingEnable: undefined,
            pendingUpdate: false,
          };
          setSelectedPlugin(pluginState);
          setViewState('plugin-details');
          pendingAutoActionRef.current = action;
          hasAutoNavigated.current = true;
          return;
        }
      }

      // Fall back to failed plugins (those with errors but not loaded)
      const failedItem = unifiedItems.find(item => item.type === 'failed-plugin' && item.name === targetName);
      if (failedItem && failedItem.type === 'failed-plugin') {
        setViewState({
          type: 'failed-plugin-details',
          plugin: {
            id: failedItem.id,
            name: failedItem.name,
            marketplace: failedItem.marketplace,
            errors: failedItem.errors,
            scope: failedItem.scope,
          },
        });
        hasAutoNavigated.current = true;
      }

      // No match in loaded OR failed plugins — close the dialog with a
      // message rather than silently landing on the plugin list. Only do
      // this when an action was requested (e.g. /plugin uninstall X);
      // plain navigation (/plugin manage) should still just show the list.
      if (!hasAutoNavigated.current && action) {
        hasAutoNavigated.current = true;
        setResult(re(`Plugin "${targetPlugin}" is not installed in this project`));
      }
    }
  }, [targetPlugin, targetMarketplace, marketplaces, loading, unifiedItems, action, setResult]);

  // Handle single plugin operations from details view
  const handleSingleOperation = async (operation: 'enable' | 'disable' | 'update' | 'uninstall') => {
    if (!selectedPlugin || isProcessingRef.current) return;

    const targetPlugin = selectedPlugin;
    const pluginId = `${targetPlugin.plugin.name}@${targetPlugin.marketplace}`;
    const opGen = viewGenRef.current;
    const pluginScope = targetPlugin.scope || 'user';
    const isBuiltin = pluginScope === 'builtin';

    // Built-in plugins can only be enabled/disabled, not updated/uninstalled.
    if (isBuiltin && (operation === 'update' || operation === 'uninstall')) {
      setProcessError('Built-in plugins cannot be updated or uninstalled.');
      return;
    }

    // Managed scope plugins can only be updated, not enabled/disabled/uninstalled
    if (!isBuiltin && !isInstallableScope(pluginScope) && operation !== 'update') {
      setProcessError('This plugin is managed by your organization. Contact your admin to disable it.');
      return;
    }

    isProcessingRef.current = true;
    setIsProcessing(true);
    setProcessError(null);
    if (operation !== 'update') {
      setPresentedHeadersHelper(null);
    }

    const isStillCurrent = () => isPluginViewOpCurrent(viewGenRef.current, opGen, activePluginIdRef.current, pluginId);

    try {
      let reverseDependents: string[] | undefined;

      // enable/disable omit scope — pluginScope is the install scope from
      // installed_plugins.json (where files are cached), which can diverge
      // from the settings scope (where enablement lives). Passing it trips
      // the cross-scope guard. Auto-detect finds the right scope. #38084
      switch (operation) {
        case 'enable': {
          const enableResult = await enablePluginOp(pluginId);
          if (!enableResult.success) {
            throw new Error(enableResult.message);
          }
          break;
        }
        case 'disable': {
          const disableResult = await disablePluginOp(pluginId);
          if (!disableResult.success) {
            throw new Error(disableResult.message);
          }
          reverseDependents = disableResult.reverseDependents;
          break;
        }
        case 'uninstall': {
          if (isBuiltin) break; // guarded above; narrows pluginScope
          if (!isInstallableScope(pluginScope)) break;
          if (isPluginEnabledAtProjectScope(pluginId)) {
            if (!isStillCurrent()) return;
            isProcessingRef.current = false;
            setIsProcessing(false);
            setViewState('confirm-project-uninstall');
            return;
          }
          const installs = loadInstalledPluginsV2().plugins[pluginId];
          const isLastScope = !installs || installs.length <= 1;
          const dataSize = isLastScope ? await getPluginDataDirSize(pluginId) : null;
          // Official 2.1.328 #615: Do not open uninstall confirmation if user already left this plugin.
          if (!isStillCurrent()) return;
          if (dataSize) {
            isProcessingRef.current = false;
            setIsProcessing(false);
            setViewState({ type: 'confirm-data-cleanup', size: dataSize });
            return;
          }
          const result = await uninstallPluginOp(pluginId, pluginScope);
          if (!result.success) {
            throw new Error(result.message);
          }
          reverseDependents = result.reverseDependents;
          break;
        }
        case 'update': {
          if (isBuiltin) break; // guarded above; narrows pluginScope
          // densable 2.1.238 — SEA `_in(..., {explicit:!0, consentedEntryHelper: pinned()})`
          // always; do not skip the gate when getMarketplace throws.
          let marketplaceEntry: Awaited<ReturnType<typeof getMarketplace>>['plugins'][number] | undefined;
          let marketplaceSource: MarketplaceSource | undefined;
          try {
            const [mkt, known] = await Promise.all([
              getMarketplace(targetPlugin.marketplace),
              loadKnownMarketplacesConfig(),
            ]);
            marketplaceEntry = mkt.plugins.find(p => p.name === targetPlugin.plugin.name);
            marketplaceSource = known[targetPlugin.marketplace]?.source;
          } catch {
            marketplaceEntry = undefined;
            marketplaceSource = undefined;
          }
          if (!isStillCurrent()) return;
          if (marketplaceEntry) {
            const paneBlock = gateHeadersHelperPaneForAction({
              pluginId,
              entry: marketplaceEntry,
              kind: 'update',
              marketplaceName: targetPlugin.marketplace,
              marketplaceSource,
              consented: headersHelperPane.pinned(),
              onPresentHelper: helper => {
                if (!isStillCurrent()) return;
                setPresentedHeadersHelper(helper);
                headersHelperPane.record(helper);
              },
            });
            if (paneBlock) {
              throw new Error(paneBlock);
            }
            setPresentedHeadersHelper(null);
          }
          const result = await updatePluginOp(pluginId, pluginScope, {
            explicit: true,
            consentedEntryHelper: headersHelperPane.pinned(),
          });
          if (!result.success) {
            throw new Error(result.message);
          }
          // If already up to date, show message and exit
          if (result.alreadyUpToDate) {
            if (onManageComplete) {
              await onManageComplete();
            }
            // Official 2.1.328 #614: Do not close the currently open page if user navigated away.
            if (!isStillCurrent()) return;
            isProcessingRef.current = false;
            setIsProcessing(false);
            setResult(re(`${re(targetPlugin.plugin.name)} is already at the latest version (${result.newVersion}).`));
            setParentViewState({ type: 'menu' });
            return;
          }
          // Success - will show standard message below
          break;
        }
      }

      // Operations (enable, disable, uninstall, update) now use centralized functions
      // that handle their own settings updates, so we only need to clear caches here
      clearAllCaches();

      // Official 2.1.328 #614 & #615: If user already went back or opened another
      // plugin while this slow operation was running, mark changed in the
      // background without reopening options or closing their currently open page.
      if (!isStillCurrent()) {
        if (onManageComplete) {
          void onManageComplete();
        }
        return;
      }

      const settingsAfter = getSettings_DEPRECATED();
      const enabledAfter = settingsAfter?.enabledPlugins?.[pluginId] !== false;
      if (enabledAfter) {
        isProcessingRef.current = false;
        setIsProcessing(false);
        setViewState({ type: 'plugin-options' });
        return;
      }

      const operationName =
        operation === 'enable'
          ? 'Enabled'
          : operation === 'disable'
            ? 'Disabled'
            : operation === 'update'
              ? 'Updated'
              : 'Uninstalled';

      // Single-line warning — notification timeout is ~8s, multi-line would scroll off.
      // The persistent record is in the Errors tab (dependency-unsatisfied after reload).
      const depWarn =
        reverseDependents && reverseDependents.length > 0
          ? ` · required by ${reverseDependents.map(name => re(name)).join(', ')}`
          : '';
      const message = `✓ ${operationName} ${re(targetPlugin.plugin.name)}${depWarn}. Run /reload-plugins to apply.`;

      if (onManageComplete) {
        await onManageComplete();
      }
      if (!isStillCurrent()) return;

      isProcessingRef.current = false;
      setIsProcessing(false);
      setResult(re(message));
      setParentViewState({ type: 'menu' });
    } catch (error) {
      if (isStillCurrent()) {
        isProcessingRef.current = false;
        setIsProcessing(false);
        const errorMessage = error instanceof Error ? error.message : String(error);
        setProcessError(`Failed to ${operation}: ${errorMessage}`);
      }
      logError(toError(error));
    }
  };

  // Latest-ref: lets the auto-action effect call the current closure without
  // adding handleSingleOperation (recreated every render) to its deps.
  const handleSingleOperationRef = useRef(handleSingleOperation);
  handleSingleOperationRef.current = handleSingleOperation;

  // Auto-execute the action prop (/plugin uninstall X, /plugin enable X,
  // /plugin configure X, etc.) once auto-navigation has landed on plugin-details.
  useEffect(() => {
    if (viewState === 'plugin-details' && selectedPlugin && pendingAutoActionRef.current) {
      const pending = pendingAutoActionRef.current;
      pendingAutoActionRef.current = undefined;
      if (pending === 'configure') {
        const schema = selectedPlugin.plugin.manifest.userConfig;
        if (schema && Object.keys(schema).length > 0) {
          setViewState({ type: 'configuring-options', schema });
        } else {
          setResult(re(`${selectedPlugin.plugin.name} has no options to set.`));
        }
        return;
      }
      void handleSingleOperationRef.current(pending);
    }
  }, [viewState, selectedPlugin, setResult]);

  // Handle toggle enable/disable
  const handleToggle = React.useCallback(() => {
    if (selectedIndex >= filteredItems.length) return;
    const item = filteredItems[selectedIndex];
    if (item?.type === 'flagged-plugin') return;
    if (item?.type === 'plugin') {
      const pluginId = `${item.plugin.name}@${item.marketplace}`;
      const mergedSettings = getSettings_DEPRECATED();
      const currentPending = pendingToggles.get(pluginId);
      const isEnabled = mergedSettings?.enabledPlugins?.[pluginId] !== false;
      const pluginScope = item.scope;
      const isBuiltin = pluginScope === 'builtin';
      if (isBuiltin || isInstallableScope(pluginScope as PersistablePluginScope)) {
        const nextPending: 'will-disable' | 'will-enable' | undefined = currentPending
          ? undefined
          : isEnabled
            ? 'will-disable'
            : 'will-enable';
        const shouldEnable = currentPending ? currentPending === 'will-disable' : !isEnabled;

        setPendingToggles(prev => {
          const next = new Map(prev);
          if (nextPending === undefined) {
            next.delete(pluginId);
          } else {
            next.set(pluginId, nextPending);
          }
          return next;
        });

        // Serialize per-plugin writes so rapid Space taps never race on disk, and
        // roll back optimistic state + surface an error if persistence fails.
        const prevChain = toggleChainsRef.current.get(pluginId) ?? Promise.resolve();
        const nextChain = prevChain.then(async () => {
          try {
            const opResult = shouldEnable ? await enablePluginOp(pluginId) : await disablePluginOp(pluginId);
            if (!opResult.success) {
              throw new Error(opResult.message || `Failed to ${shouldEnable ? 'enable' : 'disable'} ${pluginId}`);
            }
            clearAllCaches();
            await onManageComplete?.();
            if (mountedRef.current) {
              setProcessError(null);
            }
          } catch (err) {
            logError(err);
            if (mountedRef.current) {
              setPendingToggles(prev => {
                if (prev.get(pluginId) !== nextPending) return prev;
                const rolledBack = new Map(prev);
                if (currentPending === undefined) {
                  rolledBack.delete(pluginId);
                } else {
                  rolledBack.set(pluginId, currentPending);
                }
                return rolledBack;
              });
              setProcessError(`Failed to update ${item.plugin.name}: ${errorMessage(err)}`);
            }
          }
        });
        const wrappedChain = nextChain.finally(() => {
          if (toggleChainsRef.current.get(pluginId) === wrappedChain) {
            toggleChainsRef.current.delete(pluginId);
          }
        });
        toggleChainsRef.current.set(pluginId, wrappedChain);
      }
    } else if (item?.type === 'mcp') {
      void toggleMcpServer(item.client.name);
    }
  }, [selectedIndex, filteredItems, pendingToggles, toggleMcpServer, onManageComplete]);

  // Handle accept (Enter) in plugin-list
  const handleAccept = React.useCallback(() => {
    if (selectedIndex >= filteredItems.length) return;
    // Official 2.1.328 #617: Throttle rapid repeated Enter presses so holding
    // Enter cannot cascade through multiple plugins.
    const now = Date.now();
    if (now - lastEnterAcceptAtRef.current < ENTER_REPEAT_COOLDOWN_MS) {
      return;
    }
    lastEnterAcceptAtRef.current = now;
    const item = filteredItems[selectedIndex];
    if (item?.type === 'plugin') {
      const state = pluginStates.find(s => s.plugin.name === item.plugin.name && s.marketplace === item.marketplace);
      if (state) {
        bumpViewGeneration(`${state.plugin.name}@${state.marketplace}`);
        setSelectedPlugin(state);
        setViewState('plugin-details');
        setDetailsMenuIndex(0);
        setProcessError(null);
      }
    } else if (item?.type === 'flagged-plugin') {
      bumpViewGeneration(item.id);
      setViewState({
        type: 'flagged-detail',
        plugin: {
          id: item.id,
          name: item.name,
          marketplace: item.marketplace,
          reason: item.reason,
          text: item.text,
          flaggedAt: item.flaggedAt,
        },
      });
      setProcessError(null);
    } else if (item?.type === 'failed-plugin') {
      bumpViewGeneration(item.id);
      setViewState({
        type: 'failed-plugin-details',
        plugin: {
          id: item.id,
          name: item.name,
          marketplace: item.marketplace,
          errors: item.errors,
          scope: item.scope,
        },
      });
      setDetailsMenuIndex(0);
      setProcessError(null);
    } else if (item?.type === 'mcp') {
      bumpViewGeneration(item.client.name);
      setViewState({ type: 'mcp-detail', client: item.client });
      setProcessError(null);
    }
  }, [selectedIndex, filteredItems, pluginStates, bumpViewGeneration]);

  // Plugin-list navigation (non-search mode)
  useKeybindings(
    {
      'select:previous': () => {
        if (filteredItems.length === 0 || selectedIndex === 0) {
          setIsSearchMode(true);
        } else {
          pagination.handleSelectionChange(selectedIndex - 1, setSelectedIndex);
        }
      },
      'select:next': () => {
        if (filteredItems.length === 0) {
          // Official 2.1.328 #616: With no search results, Down arrow restores
          // search focus instead of becoming unresponsive.
          setIsSearchMode(true);
        } else if (selectedIndex < filteredItems.length - 1) {
          pagination.handleSelectionChange(selectedIndex + 1, setSelectedIndex);
        }
      },
      'select:accept': handleAccept,
    },
    {
      context: 'Select',
      isActive: viewState === 'plugin-list' && !isSearchMode,
    },
  );

  useKeybindings(
    { 'plugin:toggle': handleToggle },
    {
      context: 'Plugin',
      isActive: viewState === 'plugin-list' && !isSearchMode,
    },
  );

  // Handle dismiss action in flagged-detail view
  const handleFlaggedDismiss = React.useCallback(() => {
    if (typeof viewState !== 'object' || viewState.type !== 'flagged-detail') return;
    void removeFlaggedPlugin(viewState.plugin.id);
    setViewState('plugin-list');
  }, [viewState]);

  useKeybindings(
    { 'select:accept': handleFlaggedDismiss },
    {
      context: 'Select',
      isActive: typeof viewState === 'object' && viewState.type === 'flagged-detail',
    },
  );

  // Build details menu items (needed for navigation)
  const detailsMenuItems = React.useMemo(() => {
    if (viewState !== 'plugin-details' || !selectedPlugin) return [];

    const mergedSettings = getSettings_DEPRECATED();
    const pluginId = `${selectedPlugin.plugin.name}@${selectedPlugin.marketplace}`;
    const isEnabled = mergedSettings?.enabledPlugins?.[pluginId] !== false;
    const isBuiltin = selectedPlugin.marketplace === 'builtin';

    const menuItems: Array<{ label: string; action: () => void }> = [];

    menuItems.push({
      label: isEnabled ? 'Disable plugin' : 'Enable plugin',
      action: () => void handleSingleOperation(isEnabled ? 'disable' : 'enable'),
    });

    // Update/Uninstall options — not available for built-in plugins
    if (!isBuiltin) {
      menuItems.push({
        label: selectedPlugin.pendingUpdate ? 'Unmark for update' : 'Mark for update',
        action: async () => {
          try {
            const localError = await checkIfLocalPlugin(selectedPlugin.plugin.name, selectedPlugin.marketplace);

            if (localError) {
              setProcessError(localError);
              return;
            }

            const newStates = [...pluginStates];
            const index = newStates.findIndex(
              s => s.plugin.name === selectedPlugin.plugin.name && s.marketplace === selectedPlugin.marketplace,
            );
            if (index !== -1) {
              newStates[index]!.pendingUpdate = !selectedPlugin.pendingUpdate;
              setPluginStates(newStates);
              setSelectedPlugin({
                ...selectedPlugin,
                pendingUpdate: !selectedPlugin.pendingUpdate,
              });
            }
          } catch (error) {
            setProcessError(error instanceof Error ? error.message : 'Failed to check plugin update availability');
          }
        },
      });

      if (selectedPluginHasMcpb) {
        menuItems.push({
          label: 'Configure',
          action: async () => {
            setIsLoadingConfig(true);
            try {
              const mcpServersSpec = selectedPlugin.plugin.manifest.mcpServers;

              let mcpbPath: string | null = null;
              if (typeof mcpServersSpec === 'string' && isMcpbSource(mcpServersSpec)) {
                mcpbPath = mcpServersSpec;
              } else if (Array.isArray(mcpServersSpec)) {
                for (const spec of mcpServersSpec) {
                  if (typeof spec === 'string' && isMcpbSource(spec)) {
                    mcpbPath = spec;
                    break;
                  }
                }
              }

              if (!mcpbPath) {
                setProcessError('No MCPB file found in plugin');
                setIsLoadingConfig(false);
                return;
              }

              const pluginId = `${selectedPlugin.plugin.name}@${selectedPlugin.marketplace}`;
              const result = await loadMcpbFile(
                mcpbPath,
                selectedPlugin.plugin.path,
                pluginId,
                undefined,
                undefined,
                true,
              );

              if ('status' in result && result.status === 'needs-config') {
                setConfigNeeded(result);
                setViewState('configuring');
              } else {
                setProcessError('Failed to load MCPB for configuration');
              }
            } catch (err) {
              const errorMsg = errorMessage(err);
              setProcessError(`Failed to load configuration: ${errorMsg}`);
            } finally {
              setIsLoadingConfig(false);
            }
          },
        });
      }

      if (
        selectedPlugin.plugin.manifest.userConfig &&
        Object.keys(selectedPlugin.plugin.manifest.userConfig).length > 0
      ) {
        menuItems.push({
          label: 'Configure options',
          action: () => {
            setViewState({
              type: 'configuring-options',
              schema: selectedPlugin.plugin.manifest.userConfig!,
            });
          },
        });
      }

      menuItems.push({
        label: 'Update now',
        action: () => void handleSingleOperation('update'),
      });

      menuItems.push({
        label: 'Uninstall',
        action: () => void handleSingleOperation('uninstall'),
      });
    }

    if (selectedPlugin.plugin.manifest.homepage) {
      menuItems.push({
        label: 'Open homepage',
        action: () => void openBrowser(selectedPlugin.plugin.manifest.homepage!),
      });
    }

    if (selectedPlugin.plugin.manifest.repository) {
      menuItems.push({
        // Generic label — manifest.repository can be GitLab, Bitbucket,
        // Azure DevOps, etc. (gh-31598). pluginDetailsHelpers.tsx:74 keeps
        // 'View on GitHub' because that path has an explicit isGitHub check.
        label: 'View repository',
        action: () => void openBrowser(selectedPlugin.plugin.manifest.repository!),
      });
    }

    menuItems.push({
      label: 'Back to plugin list',
      action: () => {
        bumpViewGeneration(null);
        setViewState('plugin-list');
        setSelectedPlugin(null);
        setProcessError(null);
      },
    });

    return menuItems;
  }, [viewState, selectedPlugin, selectedPluginHasMcpb, pluginStates, bumpViewGeneration]);

  // Plugin-details navigation
  useKeybindings(
    {
      'select:previous': () => {
        if (detailsMenuIndex > 0) {
          setDetailsMenuIndex(detailsMenuIndex - 1);
        }
      },
      'select:next': () => {
        if (detailsMenuIndex < detailsMenuItems.length - 1) {
          setDetailsMenuIndex(detailsMenuIndex + 1);
        }
      },
      'select:accept': () => {
        const chosen = detailsMenuItems[detailsMenuIndex];
        if (!chosen) return;
        const isMutating =
          chosen.label === 'Disable plugin' ||
          chosen.label === 'Enable plugin' ||
          chosen.label === 'Uninstall' ||
          chosen.label === 'Update now';
        // Official 2.1.327 #382 & 2.1.328 #617: Prevent click+Enter or held
        // Enter from accidentally disabling/uninstalling/updating a plugin.
        if (
          isMutating &&
          shouldIgnorePluginEnterAction({
            lastTransitionAt: lastViewTransitionAtRef.current,
            lastAcceptAt: lastEnterAcceptAtRef.current,
            isBusy: isProcessingRef.current,
          })
        ) {
          return;
        }
        lastEnterAcceptAtRef.current = Date.now();
        chosen.action();
      },
    },
    {
      context: 'Select',
      isActive: viewState === 'plugin-details' && !!selectedPlugin,
    },
  );

  // Failed-plugin-details: only "Uninstall" option, handle Enter
  useKeybindings(
    {
      'select:accept': () => {
        if (typeof viewState === 'object' && viewState.type === 'failed-plugin-details') {
          if (
            shouldIgnorePluginEnterAction({
              lastTransitionAt: lastViewTransitionAtRef.current,
              lastAcceptAt: lastEnterAcceptAtRef.current,
              isBusy: isProcessingRef.current,
            })
          ) {
            return;
          }
          lastEnterAcceptAtRef.current = Date.now();
          const opGen = viewGenRef.current;
          const pluginId = viewState.plugin.id;
          const pluginScope = viewState.plugin.scope;
          const isStillCurrent = () =>
            isPluginViewOpCurrent(viewGenRef.current, opGen, activePluginIdRef.current, pluginId);
          void (async () => {
            isProcessingRef.current = true;
            setIsProcessing(true);
            setProcessError(null);
            const result = isInstallableScope(pluginScope as PersistablePluginScope)
              ? await uninstallPluginOp(pluginId, pluginScope as InstallableScope, false)
              : await uninstallPluginOp(pluginId, 'user', false);
            let success = result.success;
            if (!success) {
              const editableSources = ['userSettings' as const, 'projectSettings' as const, 'localSettings' as const];
              for (const source of editableSources) {
                const settings = getSettingsForSource(source);
                if (settings?.enabledPlugins?.[pluginId] !== undefined) {
                  updateSettingsForSource(source, {
                    enabledPlugins: {
                      ...settings.enabledPlugins,
                      [pluginId]: undefined,
                    },
                  });
                  success = true;
                }
              }
              clearAllCaches();
            }
            if (success) {
              if (onManageComplete) {
                await onManageComplete();
              }
              // Official 2.1.328 #614: Do not clobber the user's open page if they left.
              if (!isStillCurrent()) return;
              isProcessingRef.current = false;
              setIsProcessing(false);
              setViewState('plugin-list');
            } else {
              if (!isStillCurrent()) return;
              isProcessingRef.current = false;
              setIsProcessing(false);
              setProcessError(result.message);
            }
          })();
        }
      },
    },
    {
      context: 'Select',
      isActive:
        typeof viewState === 'object' &&
        viewState.type === 'failed-plugin-details' &&
        viewState.plugin.scope !== 'managed',
    },
  );

  // Official 2.1.326 #331: confirm-project-uninstall and confirm-data-cleanup
  // now use arrow-key + Enter / Esc lists (PluginConfirmList); y/n/u no longer
  // answer them.
  const handleConfirmProjectDisable = useCallback(() => {
    if (!selectedPlugin) return;
    setIsProcessing(true);
    setProcessError(null);
    const pluginId = `${selectedPlugin.plugin.name}@${selectedPlugin.marketplace}`;
    const { error } = updateSettingsForSource('localSettings', {
      enabledPlugins: {
        ...getSettingsForSource('localSettings')?.enabledPlugins,
        [pluginId]: false,
      },
    });
    if (error) {
      setIsProcessing(false);
      setProcessError(`Failed to write settings: ${error.message}`);
      return;
    }
    clearAllCaches();
    setResult(
      `✓ Disabled ${re(selectedPlugin.plugin.name)} in .claude/settings.local.json. Run /reload-plugins to apply.`,
    );
    if (onManageComplete) void onManageComplete();
    setParentViewState({ type: 'menu' });
  }, [selectedPlugin, setResult, onManageComplete, setParentViewState]);

  const handleConfirmDataCleanupUninstall = useCallback(
    async (deleteDataDir: boolean) => {
      if (!selectedPlugin || isProcessingRef.current) return;
      const pluginId = `${selectedPlugin.plugin.name}@${selectedPlugin.marketplace}`;
      const pluginScope = selectedPlugin.scope;
      if (!pluginScope || pluginScope === 'builtin' || !isInstallableScope(pluginScope)) return;
      const opGen = viewGenRef.current;
      const isStillCurrent = () =>
        isPluginViewOpCurrent(viewGenRef.current, opGen, activePluginIdRef.current, pluginId);
      isProcessingRef.current = true;
      setIsProcessing(true);
      setProcessError(null);
      try {
        const result = await uninstallPluginOp(pluginId, pluginScope, deleteDataDir);
        if (!result.success) throw new Error(result.message);
        clearAllCaches();
        if (onManageComplete) void onManageComplete();
        // Official 2.1.328 #614 & #615: Do not close another open page if user already left.
        if (!isStillCurrent()) return;
        isProcessingRef.current = false;
        setIsProcessing(false);
        const suffix = deleteDataDir ? '' : ' · data preserved';
        setResult(re(`${figures.tick} ${result.message}${suffix}`));
        setParentViewState({ type: 'menu' });
      } catch (e) {
        if (isStillCurrent()) {
          isProcessingRef.current = false;
          setIsProcessing(false);
          setProcessError(e instanceof Error ? e.message : String(e));
        }
      }
    },
    [selectedPlugin, setResult, onManageComplete, setParentViewState],
  );

  // Handle input for entering search mode (text input handled by useSearchInput hook)
  // eslint-disable-next-line custom-rules/prefer-use-keybindings -- useInput needed for raw search mode text input
  useInput(
    (input, key) => {
      const keyIsNotCtrlOrMeta = !key.ctrl && !key.meta;
      if (isSearchModeRef.current) {
        // Official 2.1.327 #410 & 2.1.328 #603: Append subsequent burst chars
        // that arrive before React commits isSearchMode=true instead of
        // overwriting earlier characters.
        if (!isSearchMode && keyIsNotCtrlOrMeta && input.length > 0) {
          const next = applySearchBurstInput(searchQueryRef.current, searchCursorOffsetRef.current, input);
          setSearchQuery(next.query);
          setSearchCursorOffset(next.cursorOffset);
        }
        return;
      }

      // Official 2.1.328 #616: Backspace on an empty search result list re-enters
      // search mode and removes the last query char so the user is never stuck.
      if ((key.backspace || key.delete) && searchQueryRef.current.length > 0) {
        const shortened = searchQueryRef.current.slice(0, -1);
        setIsSearchMode(true);
        setSearchQuery(shortened);
        setSearchCursorOffset(shortened.length);
        setSelectedIndex(0);
        return;
      }

      // Enter search mode with '/' or any printable character (except navigation keys)
      if (input === '/' && keyIsNotCtrlOrMeta) {
        setIsSearchMode(true);
        setSearchQuery('');
        setSearchCursorOffset(0);
        setSelectedIndex(0);
      } else if (
        keyIsNotCtrlOrMeta &&
        input.length > 0 &&
        !/^\s+$/.test(input) &&
        input !== 'j' &&
        input !== 'k' &&
        input !== ' '
      ) {
        const next = applySearchBurstInput('', 0, input);
        if (next.query.length > 0) {
          setIsSearchMode(true);
          setSearchQuery(next.query);
          setSearchCursorOffset(next.cursorOffset);
          setSelectedIndex(0);
        }
      }
    },
    { isActive: viewState === 'plugin-list' },
  );

  // Loading state
  if (loading) {
    return <Text>Loading installed plugins…</Text>;
  }

  // No plugins or MCPs installed
  if (unifiedItems.length === 0) {
    return (
      <Box flexDirection="column">
        <Box marginBottom={1}>
          <Text bold>Manage plugins</Text>
        </Box>
        <Text>No plugins or MCP servers installed.</Text>
        <Box marginTop={1}>
          <Text dimColor>Esc to go back</Text>
        </Box>
      </Box>
    );
  }

  if (typeof viewState === 'object' && viewState.type === 'plugin-options' && selectedPlugin) {
    const pluginId = `${selectedPlugin.plugin.name}@${selectedPlugin.marketplace}`;
    function finish(msg: string): void {
      setResult(re(msg));
      // Plugin is enabled regardless of whether config was saved or
      // skipped — onManageComplete → markPluginsChanged → the
      // persistent "run /reload-plugins" notice.
      if (onManageComplete) {
        void onManageComplete();
      }
      setParentViewState({ type: 'menu' });
    }
    return (
      <PluginOptionsFlow
        plugin={selectedPlugin.plugin}
        pluginId={pluginId}
        onDone={(outcome, detail) => {
          switch (outcome) {
            case 'configured':
              finish(`✓ Enabled and configured ${re(selectedPlugin.plugin.name)}. Run /reload-plugins to apply.`);
              break;
            case 'skipped':
              finish(`✓ Enabled ${re(selectedPlugin.plugin.name)}. Run /reload-plugins to apply.`);
              break;
            case 'error':
              finish(`Failed to save configuration: ${detail !== undefined ? re(detail) : ''}`);
              break;
          }
        }}
      />
    );
  }

  // Configure options (from the Manage menu)
  if (typeof viewState === 'object' && viewState.type === 'configuring-options' && selectedPlugin) {
    const pluginId = `${selectedPlugin.plugin.name}@${selectedPlugin.marketplace}`;
    return (
      <PluginOptionsDialog
        title={`Configure ${re(selectedPlugin.plugin.name)}`}
        subtitle="Plugin options"
        configSchema={viewState.schema}
        initialValues={loadPluginOptions(pluginId)}
        onSave={values => {
          const opGen = viewGenRef.current;
          const isStillCurrent = () =>
            isPluginViewOpCurrent(viewGenRef.current, opGen, activePluginIdRef.current, pluginId);
          void (async () => {
            try {
              await savePluginOptions(pluginId, values, viewState.schema);
              clearAllCaches();
              await onManageComplete?.();
              // Official 2.1.328 #614: Do not close or reopen if user already went back.
              if (!isStillCurrent() || !mountedRef.current) return;
              setResult('Configuration saved. Run /reload-plugins for changes to take effect.');
            } catch (err) {
              if (!isStillCurrent() || !mountedRef.current) return;
              setProcessError(`Failed to save configuration: ${errorMessage(err)}`);
            }
            if (isStillCurrent() && mountedRef.current) {
              setViewState('plugin-details');
            }
          })();
        }}
        onCancel={() => {
          bumpViewGeneration(pluginId);
          setViewState('plugin-details');
        }}
      />
    );
  }

  // Configuration view
  if (viewState === 'configuring' && configNeeded && selectedPlugin) {
    const pluginId = `${selectedPlugin.plugin.name}@${selectedPlugin.marketplace}`;

    async function handleSave(config: UserConfigValues) {
      if (!configNeeded || !selectedPlugin) return;
      const opGen = viewGenRef.current;
      const isStillCurrent = () =>
        isPluginViewOpCurrent(viewGenRef.current, opGen, activePluginIdRef.current, pluginId);

      try {
        // Find MCPB path again
        const mcpServersSpec = selectedPlugin.plugin.manifest.mcpServers;
        let mcpbPath: string | null = null;

        if (typeof mcpServersSpec === 'string' && isMcpbSource(mcpServersSpec)) {
          mcpbPath = mcpServersSpec;
        } else if (Array.isArray(mcpServersSpec)) {
          for (const spec of mcpServersSpec) {
            if (typeof spec === 'string' && isMcpbSource(spec)) {
              mcpbPath = spec;
              break;
            }
          }
        }

        if (!mcpbPath) {
          if (!isStillCurrent()) return;
          setProcessError('No MCPB file found');
          setViewState('plugin-details');
          return;
        }

        // Reload with provided config
        await loadMcpbFile(mcpbPath, selectedPlugin.plugin.path, pluginId, undefined, config);
        clearAllCaches();
        await onManageComplete?.();

        // Official 2.1.328 #614: Do not close or reopen if user already went back.
        if (!isStillCurrent() || !mountedRef.current) return;
        // Success - go back to details
        setProcessError(null);
        setConfigNeeded(null);
        setViewState('plugin-details');
        setResult('Configuration saved. Run /reload-plugins for changes to take effect.');
      } catch (err) {
        if (!isStillCurrent() || !mountedRef.current) return;
        const errorMsg = errorMessage(err);
        setProcessError(`Failed to save configuration: ${errorMsg}`);
        setViewState('plugin-details');
      }
    }

    function handleCancel() {
      bumpViewGeneration(pluginId);
      setConfigNeeded(null);
      setViewState('plugin-details');
    }

    return (
      <PluginOptionsDialog
        title={`Configure ${re(configNeeded.manifest.name)}`}
        subtitle={`Plugin: ${re(selectedPlugin.plugin.name)}`}
        configSchema={configNeeded.configSchema}
        initialValues={configNeeded.existingConfig}
        onSave={handleSave}
        onCancel={handleCancel}
      />
    );
  }

  // Flagged plugin detail view
  if (typeof viewState === 'object' && viewState.type === 'flagged-detail') {
    const fp = viewState.plugin;
    return (
      <Box flexDirection="column">
        <Box>
          <Text bold>
            {re(fp.name)} @ {re(fp.marketplace)}
          </Text>
        </Box>

        <Box marginBottom={1}>
          <Text dimColor>Status: </Text>
          <Text color="error">Removed</Text>
        </Box>

        <Box marginBottom={1} flexDirection="column">
          <Text color="error">Removed from marketplace · reason: {re(fp.reason)}</Text>
          <Text>{re(fp.text)}</Text>
          <Text dimColor>Flagged on {new Date(fp.flaggedAt).toLocaleDateString()}</Text>
        </Box>

        <Box marginTop={1} flexDirection="column">
          <Box>
            <Text>{figures.pointer} </Text>
            <Text color="suggestion">Dismiss</Text>
          </Box>
        </Box>

        <Byline>
          <ConfigurableShortcutHint action="select:accept" context="Select" fallback="Enter" description="dismiss" />
          <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="back" />
        </Byline>
      </Box>
    );
  }

  // Confirm-project-uninstall: Official 2.1.326 #331 arrow-key + Enter / Esc list
  if (viewState === 'confirm-project-uninstall' && selectedPlugin) {
    return (
      <Box flexDirection="column">
        <Text bold color="warning">
          {re(selectedPlugin.plugin.name)} is enabled in .claude/settings.json (shared with your team)
        </Text>
        <Box marginTop={1} flexDirection="column">
          <Text>Disable it just for you in .claude/settings.local.json?</Text>
          <Text dimColor>This has the same effect as uninstalling, without affecting other contributors.</Text>
        </Box>
        {processError && (
          <Box marginTop={1}>
            <Text color="error">{processError}</Text>
          </Box>
        )}
        <Box marginTop={1}>
          {isProcessing ? (
            <Text dimColor>Disabling…</Text>
          ) : (
            <PluginConfirmList
              options={[
                { value: 'disable', label: 'Disable in .claude/settings.local.json' },
                { value: 'cancel', label: 'Cancel' },
              ]}
              onSelect={choice => {
                if (choice === 'disable') {
                  handleConfirmProjectDisable();
                } else {
                  setViewState('plugin-details');
                  setProcessError(null);
                }
              }}
              onCancel={() => {
                setViewState('plugin-details');
                setProcessError(null);
              }}
            />
          )}
        </Box>
      </Box>
    );
  }

  // Confirm-data-cleanup: Official 2.1.326 #331 arrow-key + Enter / Esc list
  if (typeof viewState === 'object' && viewState.type === 'confirm-data-cleanup' && selectedPlugin) {
    return (
      <Box flexDirection="column">
        <Text bold>
          {re(selectedPlugin.plugin.name)} has {viewState.size.human} of persistent data
        </Text>
        <Box marginTop={1} flexDirection="column">
          <Text>Delete it along with the plugin?</Text>
          <Text dimColor>{pluginDataDirPath(`${selectedPlugin.plugin.name}@${selectedPlugin.marketplace}`)}</Text>
        </Box>
        {processError && (
          <Box marginTop={1}>
            <Text color="error">{processError}</Text>
          </Box>
        )}
        <Box marginTop={1}>
          {isProcessing ? (
            <Text dimColor>Uninstalling…</Text>
          ) : (
            <PluginConfirmList
              options={[
                { value: 'keep', label: 'Uninstall and keep data' },
                { value: 'delete', label: 'Uninstall and delete data', destructive: true },
                { value: 'cancel', label: 'Cancel' },
              ]}
              onSelect={choice => {
                if (choice === 'delete') {
                  void handleConfirmDataCleanupUninstall(true);
                } else if (choice === 'keep') {
                  void handleConfirmDataCleanupUninstall(false);
                } else {
                  setViewState('plugin-details');
                  setProcessError(null);
                }
              }}
              onCancel={() => {
                setViewState('plugin-details');
                setProcessError(null);
              }}
            />
          )}
        </Box>
      </Box>
    );
  }

  // Plugin details view
  if (viewState === 'plugin-details' && selectedPlugin) {
    const mergedSettings = getSettings_DEPRECATED(); // Use merged settings to respect all layers
    const pluginId = `${selectedPlugin.plugin.name}@${selectedPlugin.marketplace}`;
    const isEnabled = mergedSettings?.enabledPlugins?.[pluginId] !== false;

    // Compute plugin errors section
    const filteredPluginErrors = pluginErrors.filter(
      e =>
        ('plugin' in e && e.plugin === selectedPlugin.plugin.name) ||
        e.source === pluginId ||
        e.source.startsWith(`${selectedPlugin.plugin.name}@`),
    );
    const oe = Wr(selectedPlugin.plugin.manifest);
    const pluginErrorsSection =
      filteredPluginErrors.length === 0 ? null : (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold color="error">
            {filteredPluginErrors.length} {plural(filteredPluginErrors.length, 'error')}:
          </Text>
          {filteredPluginErrors.map((error, i) => {
            const guidance = getErrorGuidance(error);
            return (
              <Box key={i} flexDirection="column" marginLeft={2}>
                <Text color="error">{formatErrorMessage(error)}</Text>
                {guidance && (
                  <Text dimColor italic>
                    {figures.arrowRight} {guidance}
                  </Text>
                )}
              </Box>
            );
          })}
        </Box>
      );

    return (
      <Box flexDirection="column">
        <Box>
          <Text bold>
            {Vr(selectedPlugin.plugin)} @ {re(selectedPlugin.marketplace)}
          </Text>
        </Box>

        {/* Scope */}
        <Box>
          <Text dimColor>Scope: </Text>
          <Text>{selectedPlugin.scope || 'user'}</Text>
        </Box>

        {/* Plugin details — densable ah(I.plugin.manifest) / Wr */}
        {oe.version && (
          <Box>
            <Text dimColor>Version: </Text>
            <Text>{oe.version}</Text>
          </Box>
        )}

        {oe.description && (
          <Box marginBottom={1}>
            <Text>{oe.description}</Text>
          </Box>
        )}

        {oe.author && (
          <Box>
            <Text dimColor>Author: </Text>
            <Text>{oe.author.name}</Text>
          </Box>
        )}

        {/* Current status */}
        <Box marginBottom={1}>
          <Text dimColor>Status: </Text>
          <Text color={isEnabled ? 'success' : 'warning'}>{isEnabled ? 'Enabled' : 'Disabled'}</Text>
          {selectedPlugin.pendingUpdate && <Text color="suggestion"> · Marked for update</Text>}
        </Box>

        {/* Installed components */}
        <PluginComponentsDisplay plugin={selectedPlugin.plugin} marketplace={selectedPlugin.marketplace} />

        <ManagedPluginHeadersHelperDisclosure
          pluginId={pluginId}
          marketplaceName={selectedPlugin.marketplace}
          pluginName={selectedPlugin.plugin.name}
          onHelper={setManageHeadersHelper}
        />

        {/* Plugin errors */}
        {pluginErrorsSection}

        {/* Menu */}
        <Box marginTop={1} flexDirection="column">
          {detailsMenuItems.map((item, index) => {
            const isSelected = index === detailsMenuIndex;

            return (
              <Box key={index}>
                {isSelected && <Text>{figures.pointer} </Text>}
                {!isSelected && <Text>{'  '}</Text>}
                <Text
                  bold={isSelected}
                  color={
                    item.label.includes('Uninstall')
                      ? 'error'
                      : item.label.includes('Update')
                        ? 'suggestion'
                        : undefined
                  }
                >
                  {item.label}
                </Text>
              </Box>
            );
          })}
        </Box>

        {/* Processing state */}
        {isProcessing && (
          <Box marginTop={1}>
            <Text>Processing…</Text>
          </Box>
        )}

        {/* densable 2.1.238 — SEA update "now shown": render helper after a block */}
        {presentedHeadersHelper && (
          <Box marginTop={1} flexDirection="column">
            <Text bold>headersHelper</Text>
            <Text dimColor>
              Fetching this plugin&apos;s archive sends helper-minted headers; the local command it runs (headersHelper)
              is:
            </Text>
            <Text>{presentedHeadersHelper.command}</Text>
          </Box>
        )}

        {/* Error message */}
        {processError && (
          <Box marginTop={1}>
            <Text color="error">{processError}</Text>
          </Box>
        )}

        <Box marginTop={1}>
          <Text dimColor italic>
            <Byline>
              <ConfigurableShortcutHint action="select:previous" context="Select" fallback="↑" description="navigate" />
              <ConfigurableShortcutHint action="select:accept" context="Select" fallback="Enter" description="select" />
              <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="back" />
            </Byline>
          </Text>
        </Box>
      </Box>
    );
  }

  // Failed plugin detail view
  if (typeof viewState === 'object' && viewState.type === 'failed-plugin-details') {
    const failedPlugin = viewState.plugin;

    const firstError = failedPlugin.errors[0];
    const errorMessage = firstError ? formatErrorMessage(firstError) : 'Failed to load';

    return (
      <Box flexDirection="column">
        <Text>
          <Text bold>{Vr({ name: failedPlugin.name })}</Text>
          <Text dimColor> @ {re(failedPlugin.marketplace)}</Text>
          <Text dimColor> ({failedPlugin.scope})</Text>
        </Text>
        <Text color="error">{errorMessage}</Text>

        {failedPlugin.scope === 'managed' ? (
          <Box marginTop={1}>
            <Text dimColor>Managed by your organization — contact your admin</Text>
          </Box>
        ) : (
          <Box marginTop={1}>
            <Text color="suggestion">{figures.pointer} </Text>
            <Text bold>Remove</Text>
          </Box>
        )}

        {isProcessing && <Text>Processing…</Text>}
        {processError && <Text color="error">{processError}</Text>}

        <Box marginTop={1}>
          <Text dimColor italic>
            <Byline>
              {failedPlugin.scope !== 'managed' && (
                <ConfigurableShortcutHint
                  action="select:accept"
                  context="Select"
                  fallback="Enter"
                  description="remove"
                />
              )}
              <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="back" />
            </Byline>
          </Text>
        </Box>
      </Box>
    );
  }

  // MCP detail view
  if (typeof viewState === 'object' && viewState.type === 'mcp-detail') {
    const client = mcpClients.find(c => c.name === viewState.client.name) ?? viewState.client;
    const serverToolsCount = filterToolsByServer(mcpTools, client.name).length;

    // Common handlers for MCP menus
    const handleMcpViewTools = () => {
      setLastMcpToolSelection(null);
      setViewState({ type: 'mcp-tools', client });
    };

    const handleMcpCancel = () => {
      setViewState('plugin-list');
    };

    const handleMcpComplete = (result?: string) => {
      if (result) {
        setResult(result);
      }
      setViewState('plugin-list');
    };

    // Transform MCPServerConnection to appropriate ServerInfo type
    const scope = client.config.scope;
    const configType = client.config.type;

    if (configType === 'stdio') {
      const server: StdioServerInfo = {
        name: client.name,
        client,
        scope,
        transport: 'stdio',
        config: client.config as McpStdioServerConfig,
      };
      return (
        <MCPStdioServerMenu
          server={server}
          serverToolsCount={serverToolsCount}
          onViewTools={handleMcpViewTools}
          onCancel={handleMcpCancel}
          onComplete={handleMcpComplete}
          borderless
        />
      );
    } else if (configType === 'sse') {
      const server: SSEServerInfo = {
        name: client.name,
        client,
        scope,
        transport: 'sse',
        isAuthenticated: undefined,
        config: client.config as McpSSEServerConfig,
      };
      return (
        <MCPRemoteServerMenu
          server={server}
          serverToolsCount={serverToolsCount}
          onViewTools={handleMcpViewTools}
          onCancel={handleMcpCancel}
          onComplete={handleMcpComplete}
          borderless
        />
      );
    } else if (configType === 'http') {
      const server: HTTPServerInfo = {
        name: client.name,
        client,
        scope,
        transport: 'http',
        isAuthenticated: undefined,
        config: client.config as McpHTTPServerConfig,
      };
      return (
        <MCPRemoteServerMenu
          server={server}
          serverToolsCount={serverToolsCount}
          onViewTools={handleMcpViewTools}
          onCancel={handleMcpCancel}
          onComplete={handleMcpComplete}
          borderless
        />
      );
    } else if (configType === 'claudeai-proxy') {
      const server: ClaudeAIServerInfo = {
        name: client.name,
        client,
        scope,
        transport: 'claudeai-proxy',
        isAuthenticated: undefined,
        config: client.config as McpClaudeAIProxyServerConfig,
      };
      return (
        <MCPRemoteServerMenu
          server={server}
          serverToolsCount={serverToolsCount}
          onViewTools={handleMcpViewTools}
          onCancel={handleMcpCancel}
          onComplete={handleMcpComplete}
          borderless
        />
      );
    }

    // Fallback handled via useEffect (isUnsupportedMcpDetail)
    return null;
  }

  // MCP tools view
  if (typeof viewState === 'object' && viewState.type === 'mcp-tools') {
    const client = mcpClients.find(c => c.name === viewState.client.name) ?? viewState.client;
    const scope = client.config.scope;
    const configType = client.config.type;

    // Build ServerInfo for MCPToolListView
    let server: StdioServerInfo | SSEServerInfo | HTTPServerInfo | ClaudeAIServerInfo;
    if (configType === 'stdio') {
      server = {
        name: client.name,
        client,
        scope,
        transport: 'stdio',
        config: client.config as McpStdioServerConfig,
      };
    } else if (configType === 'sse') {
      server = {
        name: client.name,
        client,
        scope,
        transport: 'sse',
        isAuthenticated: undefined,
        config: client.config as McpSSEServerConfig,
      };
    } else if (configType === 'http') {
      server = {
        name: client.name,
        client,
        scope,
        transport: 'http',
        isAuthenticated: undefined,
        config: client.config as McpHTTPServerConfig,
      };
    } else {
      server = {
        name: client.name,
        client,
        scope,
        transport: 'claudeai-proxy',
        isAuthenticated: undefined,
        config: client.config as McpClaudeAIProxyServerConfig,
      };
    }

    const savedToolSelection = lastMcpToolSelection?.serverName === server.name ? lastMcpToolSelection : null;
    return (
      <MCPToolListView
        server={server}
        startOn={savedToolSelection?.toolName}
        defaultFocusIndex={savedToolSelection?.toolIndex}
        onSelectTool={(tool: Tool, index: number) => {
          setLastMcpToolSelection({
            serverName: server.name,
            toolName: tool.name,
            toolIndex: index,
          });
          setViewState({ type: 'mcp-tool-detail', client, tool });
        }}
        onBack={() => setViewState({ type: 'mcp-detail', client })}
      />
    );
  }

  // MCP tool detail view
  if (typeof viewState === 'object' && viewState.type === 'mcp-tool-detail') {
    const client = mcpClients.find(c => c.name === viewState.client.name) ?? viewState.client;
    const { tool } = viewState;
    const scope = client.config.scope;
    const configType = client.config.type;

    // Build ServerInfo for MCPToolDetailView
    let server: StdioServerInfo | SSEServerInfo | HTTPServerInfo | ClaudeAIServerInfo;
    if (configType === 'stdio') {
      server = {
        name: client.name,
        client,
        scope,
        transport: 'stdio',
        config: client.config as McpStdioServerConfig,
      };
    } else if (configType === 'sse') {
      server = {
        name: client.name,
        client,
        scope,
        transport: 'sse',
        isAuthenticated: undefined,
        config: client.config as McpSSEServerConfig,
      };
    } else if (configType === 'http') {
      server = {
        name: client.name,
        client,
        scope,
        transport: 'http',
        isAuthenticated: undefined,
        config: client.config as McpHTTPServerConfig,
      };
    } else {
      server = {
        name: client.name,
        client,
        scope,
        transport: 'claudeai-proxy',
        isAuthenticated: undefined,
        config: client.config as McpClaudeAIProxyServerConfig,
      };
    }

    return <MCPToolDetailView tool={tool} server={server} onBack={() => setViewState({ type: 'mcp-tools', client })} />;
  }

  // Plugin list view (main management interface)
  const visibleItems = pagination.getVisibleItems(filteredItems);

  return (
    <Box flexDirection="column">
      {/* Search box */}
      <Box marginBottom={1}>
        <SearchBox
          ref={searchBoxRef}
          query={searchQuery}
          isFocused={isSearchMode}
          onFocus={enterSearchMode}
          isTerminalFocused={isTerminalFocused}
          width={terminalWidth - 4}
          cursorOffset={searchCursorOffset}
          onCursorOffsetChange={setSearchCursorOffset}
          onKeyDown={isSearchMode ? handleSearchKeyDown : undefined}
          onPaste={isSearchMode ? handleSearchPaste : undefined}
          autoFocus={isSearchMode}
        />
      </Box>

      {/* No search results */}
      {filteredItems.length === 0 && searchQuery && (
        <Box marginBottom={1}>
          <Text dimColor>No items match &quot;{searchQuery}&quot;</Text>
        </Box>
      )}

      {/* Scroll up indicator (Official 2.1.326 #272: count hidden rows) */}
      {pagination.scrollPosition.canScrollUp && (
        <Box>
          <Text dimColor>
            {' '}
            {figures.arrowUp} {pagination.scrollPosition.hiddenAbove} more above
          </Text>
        </Box>
      )}

      {/* Unified list of plugins and MCPs grouped by scope */}
      {visibleItems.map((item, visibleIndex) => {
        const actualIndex = pagination.toActualIndex(visibleIndex);
        const isSelected = actualIndex === selectedIndex && !isSearchMode;

        // Check if we need to show a scope header
        const prevItem = visibleIndex > 0 ? visibleItems[visibleIndex - 1] : null;
        const showScopeHeader = !prevItem || prevItem.scope !== item.scope;

        // Get scope label
        const getScopeLabel = (scope: string): string => {
          switch (scope) {
            case 'flagged':
              return 'Flagged';
            case 'project':
              return 'Project';
            case 'local':
              return 'Local';
            case 'user':
              return 'User';
            case 'enterprise':
              return 'Enterprise';
            case 'managed':
              return 'Managed';
            case 'builtin':
              return 'Built-in';
            case 'dynamic':
              return 'Built-in';
            default:
              return scope;
          }
        };

        return (
          <React.Fragment key={item.id}>
            {showScopeHeader && (
              <Box marginTop={visibleIndex > 0 ? 1 : 0} paddingLeft={2}>
                <Text
                  dimColor={item.scope !== 'flagged'}
                  color={item.scope === 'flagged' ? 'warning' : undefined}
                  bold={item.scope === 'flagged'}
                >
                  {getScopeLabel(item.scope)}
                </Text>
              </Box>
            )}
            <Box
              onClick={() => {
                recordPluginUiClick();
                if (isSearchMode) setIsSearchMode(false);
                pagination.handleSelectionChange(actualIndex, setSelectedIndex);
              }}
            >
              <UnifiedInstalledCell item={item} isSelected={isSelected} />
            </Box>
          </React.Fragment>
        );
      })}

      {/* Scroll down indicator (Official 2.1.326 #272: count hidden rows) */}
      {pagination.scrollPosition.canScrollDown && (
        <Box>
          <Text dimColor>
            {' '}
            {figures.arrowDown} {pagination.scrollPosition.hiddenBelow} more below
          </Text>
        </Box>
      )}

      {/* Help text */}
      <Box marginTop={1} marginLeft={1}>
        <Text dimColor italic>
          <Byline>
            <Text>type to search</Text>
            <ConfigurableShortcutHint action="plugin:toggle" context="Plugin" fallback="Space" description="toggle" />
            <ConfigurableShortcutHint action="select:accept" context="Select" fallback="Enter" description="details" />
            <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="back" />
          </Byline>
        </Text>
      </Box>

      {/* Reload disclaimer for plugin changes */}
      {pendingToggles.size > 0 && (
        <Box marginLeft={1}>
          <Text dimColor italic>
            Run /reload-plugins to apply changes
          </Text>
        </Box>
      )}
    </Box>
  );
}
