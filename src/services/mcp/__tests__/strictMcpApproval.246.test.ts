import { describe, expect, test } from 'bun:test'

import { handleMcpjsonServerApprovals } from '../../mcpServerApproval.js'

describe('densable 2.1.246 #43 Te/le strict-mcp-config', () => {
  test('skips the project .mcp.json approval dialog', async () => {
    const root = {
      render() {
        throw new Error('strict-mcp-config must not open MCP approval')
      },
    }
    await handleMcpjsonServerApprovals(root as never, {
      strictMcpConfig: true,
    })
  })
})
