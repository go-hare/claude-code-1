import type { Command } from '../../commands.js'
import type { Tool } from '../../Tool.js'
import type {
  MCPServerConnection,
  ServerResource,
} from '../../services/mcp/types.js'

/**
 * densable YTs/JTs/XTs/QTs/CTo/_vd (2.1.211) — module-level MCP control
 * handles so non-interactive `/mcp` can reconnect/toggle without React.
 */
export type McpReconnectFn = (serverName: string) => Promise<{
  client: MCPServerConnection
  tools: Tool[]
  commands: Command[]
  resources?: ServerResource[]
}>

export type McpToggleFn = (serverName: string) => Promise<void>

let reconnectFn: McpReconnectFn | null = null
let toggleFn: McpToggleFn | null = null

export function setMcpControls(
  reconnect: McpReconnectFn | null,
  toggle: McpToggleFn | null,
): void {
  reconnectFn = reconnect
  toggleFn = toggle
}

export function clearMcpControls(): void {
  reconnectFn = null
  toggleFn = null
}

export function getMcpReconnectControl(): McpReconnectFn | null {
  return reconnectFn
}

export function getMcpToggleControl(): McpToggleFn | null {
  return toggleFn
}
