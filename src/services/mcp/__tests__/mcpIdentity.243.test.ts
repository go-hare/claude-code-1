import { afterEach, describe, expect, test } from 'bun:test'

import {
  currentMcpAccountToken,
  getMcpIdentityEpoch,
  isMcpIdentityBoundaryEnabled,
  mcpIdentityChangedSinceLastCheck,
  registerMcpIdentityChangeHandler,
  resolveMcpAccountIdentity,
  setMcpAccountIdentityResolver,
  takeUnownedMcpIdentityChange,
  mcpConfigDependsOnAccountIdentity,
  resetMcpIdentityStateForTests,
  seedMcpIdentityCheck,
} from '../mcpIdentity.js'

const previousDiscoveryCache = process.env.MCP_DISCOVERY_CACHE
afterEach(() => {
  if (previousDiscoveryCache === undefined)
    delete process.env.MCP_DISCOVERY_CACHE
  else process.env.MCP_DISCOVERY_CACHE = previousDiscoveryCache
  resetMcpIdentityStateForTests()
})

describe('mcp identity 243', () => {
  test('289: identity uses account and organization, with an asynchronous owned boundary', async () => {
    resetMcpIdentityStateForTests()
    process.env.MCP_DISCOVERY_CACHE = 'true'
    let account = {
      accountUuid: 'a',
      organizationUuid: 'org',
      credentialInstalled: true,
    }
    setMcpAccountIdentityResolver(() => account)
    seedMcpIdentityCheck()
    expect(currentMcpAccountToken()).toBe('acct:a|org:org')
    expect(mcpIdentityChangedSinceLastCheck()).toBe(false)
    const before = getMcpIdentityEpoch()
    let calls = 0
    const release = registerMcpIdentityChangeHandler(() => {
      calls++
    })
    account = { ...account, organizationUuid: 'other' }
    expect(getMcpIdentityEpoch()).toBe(before + 1)
    expect(calls).toBe(0)
    await Promise.resolve()
    expect(calls).toBe(1)
    expect(mcpIdentityChangedSinceLastCheck()).toBe(true)
    expect(mcpIdentityChangedSinceLastCheck()).toBe(false)
    release()
    account = { ...account, accountUuid: 'b' }
    getMcpIdentityEpoch()
    expect(takeUnownedMcpIdentityChange()).toBe(true)
    expect(takeUnownedMcpIdentityChange()).toBe(false)
  })

  test('logout invalidates outstanding epochs exactly once before any reconnect can settle', async () => {
    resetMcpIdentityStateForTests()
    process.env.MCP_DISCOVERY_CACHE = 'true'
    let installed = true
    setMcpAccountIdentityResolver(() =>
      installed ? { accountUuid: 'a', credentialInstalled: true } : undefined,
    )
    seedMcpIdentityCheck()
    const epoch = getMcpIdentityEpoch()
    let boundaries = 0
    const release = registerMcpIdentityChangeHandler(() => {
      boundaries++
    })
    installed = false
    expect(getMcpIdentityEpoch()).toBe(epoch + 1)
    expect(getMcpIdentityEpoch()).toBe(epoch + 1)
    await Promise.resolve()
    expect(boundaries).toBe(1)
    release()
  })

  test('289: incomplete and logged-out identities never become a resolved baseline', () => {
    resetMcpIdentityStateForTests()
    process.env.MCP_DISCOVERY_CACHE = 'true'
    setMcpAccountIdentityResolver(() => undefined)
    expect(resolveMcpAccountIdentity().kind).toBe('logged-out')
    expect(currentMcpAccountToken()).toBeUndefined()
    expect(mcpIdentityChangedSinceLastCheck()).toBe(true)
    setMcpAccountIdentityResolver(() => ({
      accountUuid: 'a',
      credentialInstalled: false,
    }))
    expect(resolveMcpAccountIdentity().kind).toBe('incomplete')
    expect(currentMcpAccountToken()).toBeUndefined()
  })

  test('289: explicit discovery disable latches and does not trip identity epochs', () => {
    resetMcpIdentityStateForTests()
    process.env.MCP_DISCOVERY_CACHE = 'false'
    let id = 'a'
    setMcpAccountIdentityResolver(() => ({
      accountUuid: id,
      credentialInstalled: true,
    }))
    expect(isMcpIdentityBoundaryEnabled()).toBe(false)
    getMcpIdentityEpoch()
    id = 'b'
    process.env.MCP_DISCOVERY_CACHE = 'true'
    expect(isMcpIdentityBoundaryEnabled()).toBe(false)
    expect(getMcpIdentityEpoch()).toBe(0)
  })
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
