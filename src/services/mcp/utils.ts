import { createHash } from 'crypto'
import { join } from 'path'
import { getIsNonInteractiveSession } from '../../bootstrap/state.js'
import type { Command } from '../../commands.js'
import type { AgentMcpServerInfo } from '../../components/mcp/types.js'
import type { Tool } from '../../Tool.js'
import type { AgentDefinition } from '@claude-code/builtin-tools/tools/AgentTool/loadAgentsDir.js'
import { getProjectPathForConfig } from '../../utils/config.js'
import { getProjectRoot } from '../../bootstrap/state.js'
import { getCwd } from '../../utils/cwd.js'
import { getGlobalClaudeFile } from '../../utils/env.js'
import { isSettingSourceEnabled } from '../../utils/settings/constants.js'
import {
  getSettings_DEPRECATED,
  hasSkipDangerousModePermissionPrompt,
} from '../../utils/settings/settings.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import { getEnterpriseMcpFilePath, getMcpConfigByName } from './config.js'
import { isSessionRejectedMcpServer } from './mcpSessionApprovedServers.js'
import { mcpInfoFromString } from './mcpStringUtils.js'
import { normalizeNameForMCP } from './normalization.js'
import {
  type ConfigScope,
  ConfigScopeSchema,
  type MCPServerConnection,
  type McpHTTPServerConfig,
  type McpServerConfig,
  type McpSSEServerConfig,
  type McpStdioServerConfig,
  type McpWebSocketServerConfig,
  type ScopedMcpServerConfig,
  type ServerResource,
} from './types.js'

/**
 * Filters tools by MCP server name
 *
 * @param tools Array of tools to filter
 * @param serverName Name of the MCP server
 * @returns Tools belonging to the specified server
 */
export function filterToolsByServer(tools: Tool[], serverName: string): Tool[] {
  const prefix = `mcp__${normalizeNameForMCP(serverName)}__`
  return tools.filter(tool => toolBelongsToServer(tool, serverName, prefix))
}

/**
 * densable `GD` — tool belongs to this MCP server. Prefer `mcpInfo.serverName`
 * when stamped; otherwise the `mcp__<server>__` prefix.
 */
export function toolBelongsToServer(
  tool: Pick<Tool, 'name' | 'mcpInfo'>,
  serverName: string,
  prefix?: string,
): boolean {
  if (tool.mcpInfo?.serverName !== undefined) {
    return tool.mcpInfo.serverName === serverName
  }
  return Boolean(tool.name?.startsWith(prefix ?? getMcpToolPrefix(serverName)))
}

function getMcpToolPrefix(serverName: string): string {
  return `mcp__${normalizeNameForMCP(serverName)}__`
}

const CLAUDE_AI_TERMINAL_PREFIX = 'claude_ai_'

/**
 * Official 325 #1779 — expand a claude.ai connector's Desktop / terminal MCP
 * tool name into its alternate spellings (e.g. Desktop `mcp__Slack__post` or
 * `connectorId`-backed server <-> terminal `mcp__claude_ai_Slack__post`) so
 * deny/ask permission rules, hook matchers, and `disallowedTools` written in
 * terminal form still match in Claude Desktop.
 *
 * Callers MUST ONLY use these expanded names for deny/ask/disallowed/hook-family
 * matching (never for `allow` grants).
 */
export function expandConnectorToolAliases(
  toolName: string,
  options?: {
    connectorId?: string
    connectorDisplayName?: string
    serverName?: string
  },
): string[] {
  const parsed = mcpInfoFromString(toolName)
  if (!parsed) return []
  const aliases = new Set<string>()
  const normalizedServer = normalizeNameForMCP(parsed.serverName)
  const bareTool = parsed.toolName

  if (normalizedServer.startsWith(CLAUDE_AI_TERMINAL_PREFIX)) {
    const stripped = normalizedServer.slice(CLAUDE_AI_TERMINAL_PREFIX.length)
    if (stripped) {
      aliases.add(`mcp__${stripped}__${bareTool}`)
      aliases.add(`mcp__${stripped}`)
    }
  } else if (options?.connectorId) {
    const terminalFromServer = `${CLAUDE_AI_TERMINAL_PREFIX}${normalizedServer}`
    aliases.add(`mcp__${terminalFromServer}__${bareTool}`)
    aliases.add(`mcp__${terminalFromServer}`)
    if (options.connectorDisplayName) {
      const normalizedDisplay = normalizeNameForMCP(
        options.connectorDisplayName,
      )
      if (normalizedDisplay) {
        aliases.add(
          `mcp__${CLAUDE_AI_TERMINAL_PREFIX}${normalizedDisplay}__${bareTool}`,
        )
        aliases.add(`mcp__${CLAUDE_AI_TERMINAL_PREFIX}${normalizedDisplay}`)
      }
    }
  }
  if (options?.connectorId) {
    const normConnector = normalizeNameForMCP(options.connectorId)
    if (normConnector) {
      aliases.add(`mcp__${normConnector}__${bareTool}`)
      aliases.add(
        `mcp__${CLAUDE_AI_TERMINAL_PREFIX}${normConnector}__${bareTool}`,
      )
    }
  }
  aliases.delete(toolName)
  return [...aliases]
}

/**
 * Resolve connector alias names for `toolName` given the live MCP clients list.
 * Used by hook matchers (`getHookFamilyNames`, which sets `throughFamilyOnly`
 * so alias matches can deny/ask but never allow) and `disallowedTools` checks.
 */
export function getConnectorAliasesForMcpTool(
  toolName: string,
  mcpClients?: readonly MCPServerConnection[],
): string[] {
  const parsed = mcpInfoFromString(toolName)
  if (!parsed) return []
  const matchedClient = mcpClients?.find(
    c =>
      c.name === parsed.serverName ||
      normalizeNameForMCP(c.name) === normalizeNameForMCP(parsed.serverName),
  )
  const config = matchedClient?.config as
    | (McpServerConfig & { connectorId?: string; id?: string })
    | undefined
  const connectorId =
    config?.connectorId ??
    (config?.type === 'claudeai-proxy' ? config.id : undefined)
  return expandConnectorToolAliases(toolName, {
    connectorId,
    connectorDisplayName: matchedClient?.name,
    serverName: parsed.serverName,
  })
}

export function toolMatchesWithConnectorAliases(
  toolName: string,
  ruleOrDisallowedName: string,
  mcpClients?: readonly MCPServerConnection[],
): boolean {
  if (toolName === ruleOrDisallowedName) return true
  const aliases = getConnectorAliasesForMcpTool(toolName, mcpClients)
  return aliases.some(
    alias =>
      alias === ruleOrDisallowedName ||
      (ruleOrDisallowedName.startsWith('mcp__') &&
        !ruleOrDisallowedName.slice(5).includes('__') &&
        alias.startsWith(`${ruleOrDisallowedName}__`)),
  )
}

/**
 * densable `jn` — drop one name or a list of names from an MCP per-server map
 * (`resources` / `resourceTemplates`).
 */
export function omitMcpServerEntries<T>(
  map: Record<string, T>,
  names: string | readonly string[],
): Record<string, T> {
  const drop = new Set(typeof names === 'string' ? [names] : names)
  const next = { ...map }
  for (const name of drop) delete next[name]
  return next
}

/**
 * True when a command belongs to the given MCP server.
 *
 * MCP **prompts** are named `mcp__<server>__<prompt>` (wire-format constraint);
 * MCP **skills** are named `<server>:<skill>` (matching plugin/nested-dir skill
 * naming). Both live in `mcp.commands`, so cleanup and filtering must match
 * either shape.
 */
export function commandBelongsToServer(
  command: Command,
  serverName: string,
): boolean {
  // Official 2.1.326 #79 (`Gk`): prefer exact stamped `mcpInfo.serverName` so
  // two servers with nearly identical normalized names (e.g. `my-app` vs
  // `my_app`) never collide and wipe each other's prompts.
  const stampedServer = (
    command as Command & { mcpInfo?: { serverName?: string } }
  ).mcpInfo?.serverName
  if (stampedServer !== undefined) {
    return stampedServer === serverName
  }
  const normalized = normalizeNameForMCP(serverName)
  const name = command.name
  if (!name) return false
  return (
    name.startsWith(`mcp__${normalized}__`) || name.startsWith(`${normalized}:`)
  )
}

/**
 * Filters commands by MCP server name
 * @param commands Array of commands to filter
 * @param serverName Name of the MCP server
 * @returns Commands belonging to the specified server
 */
export function filterCommandsByServer(
  commands: Command[],
  serverName: string,
): Command[] {
  return commands.filter(c => commandBelongsToServer(c, serverName))
}

/**
 * Filters MCP **prompts** (not skills) by server. Used by the `/mcp` menu
 * capabilities display — skills are a separate feature shown in `/skills`,
 * so they mustn't inflate the "prompts" capability badge.
 *
 * The distinguisher is `loadedFrom === 'mcp'`: MCP skills set it, MCP
 * prompts don't (they use `isMcp: true` instead).
 */
export function filterMcpPromptsByServer(
  commands: Command[],
  serverName: string,
): Command[] {
  return commands.filter(
    c =>
      commandBelongsToServer(c, serverName) &&
      !(c.type === 'prompt' && c.loadedFrom === 'mcp'),
  )
}

/**
 * Filters resources by MCP server name
 * @param resources Array of resources to filter
 * @param serverName Name of the MCP server
 * @returns Resources belonging to the specified server
 */
export function filterResourcesByServer(
  resources: ServerResource[],
  serverName: string,
): ServerResource[] {
  return resources.filter(resource => resource.server === serverName)
}

/**
 * Removes tools belonging to a specific MCP server
 * @param tools Array of tools
 * @param serverName Name of the MCP server to exclude
 * @returns Tools not belonging to the specified server
 */
export function excludeToolsByServer(
  tools: Tool[],
  serverName: string,
): Tool[] {
  const prefix = `mcp__${normalizeNameForMCP(serverName)}__`
  return tools.filter(tool => !toolBelongsToServer(tool, serverName, prefix))
}

/**
 * Removes commands belonging to a specific MCP server
 * @param commands Array of commands
 * @param serverName Name of the MCP server to exclude
 * @returns Commands not belonging to the specified server
 */
export function excludeCommandsByServer(
  commands: Command[],
  serverName: string,
): Command[] {
  return commands.filter(c => !commandBelongsToServer(c, serverName))
}

/**
 * Removes resources belonging to a specific MCP server
 * @param resources Map of server resources
 * @param serverName Name of the MCP server to exclude
 * @returns Resources map without the specified server
 */
export function excludeResourcesByServer(
  resources: Record<string, ServerResource[]>,
  serverName: string,
): Record<string, ServerResource[]> {
  const result = { ...resources }
  delete result[serverName]
  return result
}

/**
 * Stable hash of an MCP server config for change detection on /reload-plugins.
 * Excludes `scope` (provenance, not content — moving a server from .mcp.json
 * to settings.json shouldn't reconnect it). Keys sorted so `{a:1,b:2}` and
 * `{b:2,a:1}` hash the same.
 */
/**
 * Official `gOo` (#1537) — strip provenance/runtime metadata before hashing so
 * desktop/SDK sessions do not falsely mark project/local servers as stale after
 * turn 1 when metadata fields differ.
 */
export function hashMcpConfig(config: ScopedMcpServerConfig): string {
  const {
    scope: _scope,
    pluginSource: _pluginSource,
    pluginPath: _pluginPath,
    relayed: _relayed,
    hostRegistered: _hostRegistered,
    pluginEndpointTemplated: _pluginEndpointTemplated,
    pluginOfficialSourceVouched: _pluginOfficialSourceVouched,
    agentSource: _agentSource,
    declaredIn: _declaredIn,
    readFrom: _readFrom,
    configError: _configError,
    configErrorReason: _configErrorReason,
    expandedFromEnv: _expandedFromEnv,
    configuredCommand: _configuredCommand,
    redialToRelearnRegistration: _redialToRelearnRegistration,
    repoResidentOrigin: _repoResidentOrigin,
    tools: _tools,
    discoveryCache: _discoveryCache,
    cachedInitResponse: _cachedInitResponse,
    cachedDiscoverResponse: _cachedDiscoverResponse,
    ...rest
  } = config as ScopedMcpServerConfig & Record<string, unknown>
  const stable = jsonStringify(rest, (_k, v: unknown) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const obj = v as Record<string, unknown>
      const sorted: Record<string, unknown> = {}
      for (const k of Object.keys(obj).sort()) sorted[k] = obj[k]
      return sorted
    }
    return v
  })
  return createHash('sha256').update(stable).digest('hex').slice(0, 16)
}

/**
 * Official `eFn(config, currentWorkspaceRoot)` (#1537) — true only when a
 * project/local client was explicitly declared under a previous workspace root.
 */
export function isClientDeclaredUnderPreviousWorkspaceRoot(
  config: ScopedMcpServerConfig & {
    declaredIn?: string
    repoResidentOrigin?: string
  },
  currentWorkspaceRoot: string,
  initialProjectRoot?: string,
): boolean {
  if (config.scope === 'project') {
    const origin = config.repoResidentOrigin ?? config.declaredIn
    return (
      origin !== undefined &&
      origin !== (initialProjectRoot ?? currentWorkspaceRoot)
    )
  }
  return (
    config.scope === 'local' &&
    config.declaredIn !== undefined &&
    config.declaredIn !== currentWorkspaceRoot
  )
}

/**
 * Remove stale MCP clients and their tools/commands/resources. A client is
 * stale if:
 *   - scope 'dynamic' and name no longer in configs (plugin disabled), or
 *   - config hash changed (args/url/env edited in .mcp.json) — any scope
 *
 * The removal case is scoped to 'dynamic' so /reload-plugins can't
 * accidentally disconnect a user-configured server that's just temporarily
 * absent from the in-memory config (e.g. during a partial reload). The
 * config-changed case applies to all scopes — if the config actually changed
 * on disk, reconnecting is what you want.
 *
 * Returns the stale clients so the caller can disconnect them (clearServerCache).
 */
export function excludeStalePluginClients(
  mcp: {
    clientsInitialized?: boolean
    clients: MCPServerConnection[]
    tools: Tool[]
    commands: Command[]
    resources: Record<string, ServerResource[]>
    pluginReconnectKey?: number
  },
  configs: Record<string, ScopedMcpServerConfig>,
  currentWorkspaceRoot?: string,
  initialProjectRoot?: string,
): {
  clientsInitialized?: boolean
  clients: MCPServerConnection[]
  tools: Tool[]
  commands: Command[]
  resources: Record<string, ServerResource[]>
  pluginReconnectKey?: number
  stale: MCPServerConnection[]
} {
  const stale = mcp.clients.filter(c => {
    if (
      currentWorkspaceRoot !== undefined &&
      isClientDeclaredUnderPreviousWorkspaceRoot(
        c.config,
        currentWorkspaceRoot,
        initialProjectRoot,
      )
    ) {
      return true
    }
    const fresh = configs[c.name]
    if (!fresh)
      return c.config.scope === 'dynamic' || c.config.scope === 'managed'
    return hashMcpConfig(c.config) !== hashMcpConfig(fresh)
  })
  if (stale.length === 0) {
    return { ...mcp, stale: [] }
  }

  let { tools, commands, resources } = mcp
  for (const s of stale) {
    tools = excludeToolsByServer(tools, s.name)
    commands = excludeCommandsByServer(commands, s.name)
    resources = excludeResourcesByServer(resources, s.name)
  }
  const staleNames = new Set(stale.map(c => c.name))

  return {
    clients: mcp.clients.filter(c => !staleNames.has(c.name)),
    tools,
    commands,
    resources,
    stale,
  }
}

/**
 * Checks if a tool name belongs to a specific MCP server
 * @param toolName The tool name to check
 * @param serverName The server name to match against
 * @returns True if the tool belongs to the specified server
 */
export function isToolFromMcpServer(
  toolName: string,
  serverName: string,
): boolean {
  const info = mcpInfoFromString(toolName)
  return info?.serverName === serverName
}

/**
 * Checks if a tool belongs to any MCP server
 * @param tool The tool to check
 * @returns True if the tool is from an MCP server
 */
export function isMcpTool(tool: Tool): boolean {
  return tool.name?.startsWith('mcp__') || tool.isMcp === true
}

/**
 * Describe the file path for a given MCP config scope.
 * @param scope The config scope ('user', 'project', 'local', or 'dynamic')
 * @returns A description of where the config is stored
 */
export function describeMcpConfigFilePath(scope: ConfigScope): string {
  switch (scope) {
    case 'user':
      return getGlobalClaudeFile()
    case 'project':
      return join(getCwd(), '.mcp.json')
    case 'local':
      return `${getGlobalClaudeFile()} [project: ${getProjectRoot()}]`
    case 'dynamic':
      return 'Dynamically configured'
    case 'enterprise':
      return getEnterpriseMcpFilePath()
    case 'claudeai':
      return 'claude.ai'
    default:
      return scope
  }
}

export function getScopeLabel(scope: ConfigScope): string {
  switch (scope) {
    case 'local':
      return 'Local config (private to you in this project)'
    case 'project':
      return 'Project config (shared via .mcp.json)'
    case 'user':
      return 'User config (available in all your projects)'
    case 'dynamic':
      return 'Dynamic config (from command line)'
    case 'enterprise':
      return 'Enterprise config (managed by your organization)'
    case 'claudeai':
      return 'claude.ai config'
    default:
      return scope
  }
}

export function ensureConfigScope(scope?: string): ConfigScope {
  if (!scope) return 'local'

  if (!ConfigScopeSchema().options.includes(scope as ConfigScope)) {
    throw new Error(
      `Invalid scope: ${scope}. Must be one of: ${ConfigScopeSchema().options.join(', ')}`,
    )
  }

  return scope as ConfigScope
}

export function ensureTransport(type?: string): 'stdio' | 'sse' | 'http' {
  if (!type) return 'stdio'

  if (type !== 'stdio' && type !== 'sse' && type !== 'http') {
    throw new Error(
      `Invalid transport type: ${type}. Must be one of: stdio, sse, http`,
    )
  }

  return type as 'stdio' | 'sse' | 'http'
}

export function parseHeaders(headerArray: string[]): Record<string, string> {
  const headers: Record<string, string> = {}

  for (const header of headerArray) {
    const colonIndex = header.indexOf(':')
    if (colonIndex === -1) {
      throw new Error(
        `Invalid header format: "${header}". Expected format: "Header-Name: value"`,
      )
    }

    const key = header.substring(0, colonIndex).trim()
    const value = header.substring(colonIndex + 1).trim()

    if (!key) {
      throw new Error(
        `Invalid header: "${header}". Header name cannot be empty.`,
      )
    }

    headers[key] = value
  }

  return headers
}

/**
 * #2186: Exact name matcher for project (`.mcp.json`) MCP server approvals.
 * Approval entries written in another spelling no longer silently match;
 * they ask again.
 */
export function matchesProjectMcpApprovalName(
  configuredEntry: string,
  serverName: string,
): boolean {
  return configuredEntry === serverName
}

/**
 * Sticky matcher for project `.mcp.json` denials (`disabledMcpjsonServers`):
 * exact match, or normalized match for non-plugin servers.
 */
function matchesProjectMcpDenialName(
  configuredEntry: string,
  serverName: string,
): boolean {
  if (configuredEntry === serverName) return true
  if (
    configuredEntry.startsWith('plugin:') ||
    serverName.startsWith('plugin:')
  ) {
    return false
  }
  return (
    normalizeNameForMCP(configuredEntry) === normalizeNameForMCP(serverName)
  )
}

/**
 * Strict project MCP approval status from settings only.
 * Official 2.1.196+: used by `claude mcp list` / `mcp get` so pending
 * project (.mcp.json) servers are shown without being spawned.
 * Does NOT auto-approve for bypassPermissions / non-interactive sessions.
 */
export function getProjectMcpServerStatusStrict(
  serverName: string,
): 'approved' | 'rejected' | 'pending' {
  const settings = getSettings_DEPRECATED()

  if (
    settings?.disabledMcpjsonServers?.some(name =>
      matchesProjectMcpDenialName(name, serverName),
    )
  ) {
    return 'rejected'
  }

  // #2186: enabledMcpjsonServers approvals require an exact server name match.
  if (
    settings?.enabledMcpjsonServers?.some(name =>
      matchesProjectMcpApprovalName(name, serverName),
    ) ||
    settings?.enableAllProjectMcpServers
  ) {
    return 'approved'
  }

  return 'pending'
}

export function getProjectMcpServerStatus(
  serverName: string,
): 'approved' | 'rejected' | 'pending' {
  const strict = getProjectMcpServerStatusStrict(serverName)
  if (strict !== 'pending') {
    return strict
  }

  // persistFailed "don't use" never reaches disabledMcpjsonServers. Keep the
  // session reject so plugin MCP does not start, and Te does not re-prompt.
  if (isSessionRejectedMcpServer(getProjectPathForConfig(), serverName)) {
    return 'rejected'
  }

  // In bypass permissions mode (--dangerously-skip-permissions), there's no way
  // to show an approval popup. Auto-approve if projectSettings is enabled since
  // the user has explicitly chosen to bypass all permission checks.
  // SECURITY: We intentionally only check skipDangerousModePermissionPrompt via
  // hasSkipDangerousModePermissionPrompt(), which reads from userSettings/localSettings/
  // flagSettings/policySettings but NOT projectSettings (repo-level .claude/settings.json).
  // This is intentional: a repo should not be able to accept the bypass dialog on behalf of
  // users. We also do NOT check getSessionBypassPermissionsMode() here because
  // sessionBypassPermissionsMode can be set from project settings before the dialog is shown,
  // which would allow RCE attacks via malicious project settings.
  if (
    hasSkipDangerousModePermissionPrompt() &&
    isSettingSourceEnabled('projectSettings')
  ) {
    return 'approved'
  }

  // In non-interactive mode (SDK, claude -p, piped input), there's no way to
  // show an approval popup. Auto-approve if projectSettings is enabled since:
  // 1. The user/developer explicitly chose to run in this mode
  // 2. For SDK, projectSettings is off by default - they must explicitly enable it
  // 3. For -p mode, the help text warns to only use in trusted directories
  if (
    getIsNonInteractiveSession() &&
    isSettingSourceEnabled('projectSettings')
  ) {
    return 'approved'
  }

  return 'pending'
}

/**
 * Get the scope/settings source for an MCP server from a tool name
 * @param toolName MCP tool name (format: mcp__serverName__toolName)
 * @returns ConfigScope or null if not an MCP tool or server not found
 */
export function getMcpServerScopeFromToolName(
  toolName: string,
): ConfigScope | null {
  if (!isMcpTool({ name: toolName } as Tool)) {
    return null
  }

  // Extract server name from tool name (format: mcp__serverName__toolName)
  const mcpInfo = mcpInfoFromString(toolName)
  if (!mcpInfo) {
    return null
  }

  // Look up server config
  const serverConfig = getMcpConfigByName(mcpInfo.serverName)

  // Fallback: claude.ai servers have normalized names starting with "claude_ai_"
  // but aren't in getMcpConfigByName (they're fetched async separately)
  if (!serverConfig && mcpInfo.serverName.startsWith('claude_ai_')) {
    return 'claudeai'
  }

  return serverConfig?.scope ?? null
}

// Type guards for MCP server config types
function isStdioConfig(
  config: McpServerConfig,
): config is McpStdioServerConfig {
  return config.type === 'stdio' || config.type === undefined
}

function isSSEConfig(config: McpServerConfig): config is McpSSEServerConfig {
  return config.type === 'sse'
}

function isHTTPConfig(config: McpServerConfig): config is McpHTTPServerConfig {
  return config.type === 'http'
}

function isWebSocketConfig(
  config: McpServerConfig,
): config is McpWebSocketServerConfig {
  return config.type === 'ws'
}

/**
 * Extracts MCP server definitions from agent frontmatter and groups them by server name.
 * This is used to show agent-specific MCP servers in the /mcp command.
 *
 * @param agents Array of agent definitions
 * @returns Array of AgentMcpServerInfo, grouped by server name with list of source agents
 */
export function extractAgentMcpServers(
  agents: AgentDefinition[],
): AgentMcpServerInfo[] {
  // Map: server name -> { config, sourceAgents }
  const serverMap = new Map<
    string,
    {
      config: McpServerConfig & { name: string }
      sourceAgents: string[]
    }
  >()

  for (const agent of agents) {
    if (!agent.mcpServers?.length) continue

    for (const spec of agent.mcpServers) {
      // Skip string references - these refer to servers already in global config
      if (typeof spec === 'string') continue

      // Inline definition as { [name]: config }
      const entries = Object.entries(spec)
      if (entries.length !== 1) continue

      const [serverName, serverConfig] = entries[0]!
      const existing = serverMap.get(serverName)

      if (existing) {
        // Add this agent as another source
        if (!existing.sourceAgents.includes(agent.agentType)) {
          existing.sourceAgents.push(agent.agentType)
        }
      } else {
        // New server
        serverMap.set(serverName, {
          config: { ...serverConfig, name: serverName } as McpServerConfig & {
            name: string
          },
          sourceAgents: [agent.agentType],
        })
      }
    }
  }

  // Convert map to array of AgentMcpServerInfo
  // Only include transport types supported by AgentMcpServerInfo
  const result: AgentMcpServerInfo[] = []
  for (const [name, { config, sourceAgents }] of serverMap) {
    // Use type guards to properly narrow the discriminated union type
    // Only include transport types that are supported by AgentMcpServerInfo
    if (isStdioConfig(config)) {
      result.push({
        name,
        sourceAgents,
        transport: 'stdio',
        command: config.command,
        needsAuth: false,
      })
    } else if (isSSEConfig(config)) {
      result.push({
        name,
        sourceAgents,
        transport: 'sse',
        url: config.url,
        needsAuth: true,
      })
    } else if (isHTTPConfig(config)) {
      result.push({
        name,
        sourceAgents,
        transport: 'http',
        url: config.url,
        needsAuth: true,
      })
    } else if (isWebSocketConfig(config)) {
      result.push({
        name,
        sourceAgents,
        transport: 'ws',
        url: config.url,
        needsAuth: false,
      })
    }
    // Skip unsupported transport types (sdk, claudeai-proxy, sse-ide, ws-ide)
    // These are internal types not meant for agent MCP server display
  }

  return result.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Extracts the MCP server base URL (without query string) for analytics logging.
 * Query strings are stripped because they can contain access tokens.
 * Trailing slashes are also removed for normalization.
 * Returns undefined for stdio/sdk servers or if URL parsing fails.
 */
export function getLoggingSafeMcpBaseUrl(
  config: McpServerConfig,
): string | undefined {
  if (!('url' in config) || typeof config.url !== 'string') {
    return undefined
  }

  try {
    const url = new URL(config.url)
    url.search = ''
    return url.toString().replace(/\/$/, '')
  } catch {
    return undefined
  }
}

/**
 * densable `kee` (MCP path) — failed+UNCONFIGURED is not a real failure.
 * Local FailedMCPServer has no errorCode field yet; always false for now.
 */
export function isUnconfiguredMcpClient(client: MCPServerConnection): boolean {
  return (
    client.type === 'failed' &&
    'errorCode' in client &&
    (client as { errorCode?: string }).errorCode === 'UNCONFIGURED'
  )
}

/**
 * densable `DYo` — should this client contribute to needs-auth / failure
 * startup counts?
 *
 * - UNCONFIGURED → never
 * - claudeai-proxy: if eligible===false and not session-connected (Gsr), skip;
 *   otherwise only if ever-connected (Vsr) / session-connected predicate
 * - exclude sse-ide / ws-ide
 */
export function shouldCountMcpClientForAuthNotice(
  client: MCPServerConnection,
  everConnected: (name: string) => boolean,
  sessionConnected: (name: string) => boolean,
): boolean {
  if (isUnconfiguredMcpClient(client)) return false
  if (client.config.type === 'claudeai-proxy') {
    // densable: eligible===false && !Gsr(name) → exclude
    if (client.config.eligible === false && !sessionConnected(client.name)) {
      return false
    }
    // densable: return Vsr(name) — only count if ever connected in claude.ai
    // history (or session, which is already in everConnected after Wsr)
    return everConnected(client.name)
  }
  return client.config.type !== 'sse-ide' && client.config.type !== 'ws-ide'
}

/**
 * densable `Kka` / `_Ub` — count needs-auth clients for startup notice.
 * Uses DYo filter so claude.ai connectors not connected in claude.ai are
 * not over-counted (densable 2.1.218 #19).
 */
export function countMcpNeedsAuth(
  clients: readonly MCPServerConnection[],
  everConnected: (name: string) => boolean = () => false,
  sessionConnected: (name: string) => boolean = () => false,
): number {
  let n = 0
  for (const c of clients) {
    if (
      c.type === 'needs-auth' &&
      shouldCountMcpClientForAuthNotice(c, everConnected, sessionConnected)
    ) {
      n++
    }
  }
  return n
}
