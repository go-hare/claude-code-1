import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { getMcpServerPolicyBlockReason } from '../config.js'

describe('v2.1.290 #25 — org MCP relisting protection (Oio / $Qr)', () => {
  test('enterprise/managed scopes are never blocked by getMcpServerPolicyBlockReason', () => {
    expect(
      getMcpServerPolicyBlockReason('org-srv', {
        type: 'http',
        url: 'https://mcp.example.com',
        scope: 'enterprise',
      }),
    ).toBeNull()
  })

  test('getMcpConfigByName checks doesEnterpriseMcpConfigExist before user/project/local', () => {
    const configSrc = readFileSync(
      join(import.meta.dir, '../config.ts'),
      'utf8',
    )
    const idx = configSrc.indexOf('export function getMcpConfigByName')
    expect(idx).toBeGreaterThan(-1)
    const body = configSrc.slice(idx, idx + 500)
    expect(body).toContain(
      "if (doesEnterpriseMcpConfigExist() || isRestrictedToPluginOnly('mcp'))",
    )
    expect(body).toContain('return enterpriseServers[name] ?? null')
  })

  test('useManageMCPConnections drops late settlements superseded by account switch or managed-policy', () => {
    const hookSrc = readFileSync(
      join(import.meta.dir, '../useManageMCPConnections.ts'),
      'utf8',
    )
    const idx = hookSrc.indexOf('const onConnectionAttempt = useCallback')
    expect(idx).toBeGreaterThan(-1)
    const body = hookSrc.slice(idx, idx + 1500)
    expect(body).toContain('attemptEpoch !== undefined')
    expect(body).toContain('attemptEpoch !== getMcpIdentityEpoch()')
    expect(body).toContain('mcpConfigDependsOnAccountIdentity(client.config)')
    expect(body).toContain("blockReason === 'managed-policy'")
  })
})
