/**
 * densable session host bag for `$.tool.register` (Hu → toolContext /
 * addMcpServer / tools / mcpServers / builtInToolsDisabled).
 *
 * Bound from REPL / print headless so register can mount dynamic HTTP MCP.
 */
import type { ScopedMcpServerConfig } from 'src/services/mcp/types.js'

export type PluginMcpRefusal =
  | 'unlisted'
  | 'unapproved'
  | 'disabled'
  | 'policy'
  | 'auth'
  | 'failed'

export type PluginMcpConnection =
  | { isConnected: true }
  | { isConnected: false; refused: PluginMcpRefusal; message: string }

export type PluginMcpResolution =
  | { isListed: false; refused: PluginMcpRefusal; message: string }
  | { isListed: true; isTwin: true; name: string }
  | {
      isListed: true
      isTwin: false
      name: string
      config: ScopedMcpServerConfig
    }

export type PluginToolSessionHost = {
  /** densable D9t: resolve this plugin's manifest, policy and existing twin. */
  resolveMcpServer?: (input: {
    pluginId: string
    key: string
  }) => Promise<PluginMcpResolution>
  /** Wait until a configured server leaves its pending state. */
  settledMcpServer?: (name: string) => Promise<PluginMcpConnection>
  /** Mount a dynamic server and await its actual connection outcome. */
  connectMcpServer?: (
    name: string,
    config: ScopedMcpServerConfig,
  ) => Promise<PluginMcpConnection>
  /** densable addMcpServer(name, config) — mount/replace dynamic MCP config. */
  addMcpServer: (
    name: string,
    config: ScopedMcpServerConfig,
  ) => void | Promise<void>
  /** densable removeMcpServer — optional. */
  removeMcpServer?: (name: string) => void | Promise<void>
  /** Current session tools (including MCP). */
  tools: () => ReadonlyArray<{ name: string }>
  /** Configured MCP server names. */
  mcpServers: () => readonly string[]
  /**
   * densable builtInToolsDisabled — session ran with `--tools ""` and takes
   * no plugin tools either.
   */
  builtInToolsDisabled?: boolean
  /**
   * Optional deny-rule check (gold iUe). When true, skip visibility wait.
   */
  isToolWithheldByDenyRule?: (tool: {
    name: string
    mcpInfo?: { serverName: string; toolName: string }
  }) => boolean
}

let sessionHost: PluginToolSessionHost | undefined

export function setPluginToolSessionHost(
  host: PluginToolSessionHost | undefined,
): void {
  sessionHost = host
}

export function getPluginToolSessionHost(): PluginToolSessionHost | undefined {
  return sessionHost
}
