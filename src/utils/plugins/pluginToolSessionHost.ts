/**
 * densable session host bag for `$.tool.register` (Hu → toolContext /
 * addMcpServer / tools / mcpServers / builtInToolsDisabled).
 *
 * Bound from REPL / print headless so register can mount dynamic HTTP MCP.
 */
import type { ScopedMcpServerConfig } from 'src/services/mcp/types.js'

export type PluginToolSessionHost = {
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
