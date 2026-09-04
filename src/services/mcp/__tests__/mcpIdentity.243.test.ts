import { describe, expect, test } from 'bun:test'

import {
  mcpConfigDependsOnAccountIdentity,
  resetMcpIdentityStateForTests,
  seedMcpIdentityCheck,
} from '../mcpIdentity.js'

describe('mcp identity 243', () => {
  test('rN: remote configs depend on account identity; stdio/sdk/ide do not', () => {
    expect(mcpConfigDependsOnAccountIdentity({ type: 'http' })).toBe(true)
    expect(mcpConfigDependsOnAccountIdentity({ type: 'sse' })).toBe(true)
    expect(mcpConfigDependsOnAccountIdentity({ type: 'claudeai-proxy' })).toBe(
      true,
    )
    expect(mcpConfigDependsOnAccountIdentity({ type: 'stdio' })).toBe(false)
    expect(mcpConfigDependsOnAccountIdentity({ type: 'sdk' })).toBe(false)
    expect(mcpConfigDependsOnAccountIdentity({ type: 'sse-ide' })).toBe(false)
    expect(mcpConfigDependsOnAccountIdentity({ type: 'ws-ide' })).toBe(false)
    expect(mcpConfigDependsOnAccountIdentity({ type: undefined })).toBe(false)
  })

  test('WKs seed is idempotent', () => {
    resetMcpIdentityStateForTests()
    seedMcpIdentityCheck()
    seedMcpIdentityCheck()
  })
})
