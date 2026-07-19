import { getIsNonInteractiveSession } from '../../bootstrap/state.js'
import type { Command } from '../../commands.js'

/**
 * densable _Dy (interactive local-jsx) + rSs (non-interactive local).
 */
export const mcp: Command = {
  type: 'local-jsx',
  name: 'mcp',
  description: 'Manage MCP servers',
  immediate: true,
  argumentHint: '[reconnect <server>|enable|disable [<server>|all]]',
  isEnabled: () => !getIsNonInteractiveSession(),
  load: () => import('./mcp.js'),
}

export const mcpNonInteractive: Command = {
  type: 'local',
  name: 'mcp',
  supportsNonInteractive: true,
  description: 'Manage MCP servers',
  argumentHint: '[reconnect|enable|disable [<server>|all]]',
  get isHidden() {
    return !getIsNonInteractiveSession()
  },
  isEnabled() {
    return getIsNonInteractiveSession()
  },
  load: () => import('./mcp-noninteractive.js'),
}

export default mcp
