import type { Command } from '../../commands.js'

const mcp = {
  type: 'local-jsx',
  name: 'mcp',
  description: 'Manage MCP servers',
  immediate: true,
  argumentHint: '[reconnect|enable|disable [<server>|all]]',
  load: () => import('./mcp.js'),
} satisfies Command

export default mcp
