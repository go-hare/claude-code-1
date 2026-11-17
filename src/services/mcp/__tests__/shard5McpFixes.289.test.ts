/**
 * Regression tests for Shard 5 MCP & Account-Memory 2.1.289 alignment fixes:
 * - #1 mcpIdentity logged-out baseline + rearmMcpIdentityBaseline preservation
 * - #6 headlessMcpIdentityBoundary tft() strict/bare/enterprise connector gate
 * - #7 accountMemory vs accountMemoryServer (SZe/wno) + PermissionRequest empty {}
 * - #12.1 connectToServer per-call abort rejects with AbortError
 * - #14 collectMcpResourceLinks UTF-8 byte cap (64 KiB)
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import '../../../tasks.js'
import {
  getStrictMcpConfig,
  setStrictMcpConfig,
} from '../../../bootstrap/state.js'
import { isAbortError } from '../../../utils/errors.js'
import {
  didAccountMemoryHookRewriteInput,
  isAccountMemoryHookTool,
} from '../../../utils/hooks/toolCallManagedPass.js'
import { collectMcpResourceLinks } from '../../../utils/mcpAutoBackground.js'
import {
  ACCOUNT_MEMORY_SERVER_NAME,
  isAccountMemoryServerTool,
  isAccountMemoryTool,
} from '../accountMemoryMcp.js'
import { markCliOwnedConfig } from '../cliOwnedConfigs.js'
import { connectToServer } from '../client.js'
import { createHeadlessMcpIdentityBoundary } from '../headlessMcpIdentityBoundary.js'
import {
  currentMcpAccountToken,
  getMcpIdentityEpoch,
  mcpIdentityChangedSinceLastCheck,
  rearmMcpIdentityBaseline,
  registerMcpIdentityChangeHandler,
  resetMcpIdentityStateForTests,
  seedMcpIdentityCheck,
  setMcpAccountIdentityResolver,
  type McpAccountIdentity,
} from '../mcpIdentity.js'
import { resetMcpCcrIngressCapture } from '../mcpConnectTimeout.js'

describe('Shard 5 MCP 2.1.289 fixes', () => {
  const prevDiscoveryEnv = process.env.MCP_DISCOVERY_CACHE
  const prevSimpleEnv = process.env.CLAUDE_CODE_SIMPLE
  const prevEntrypoint = process.env.CLAUDE_CODE_ENTRYPOINT
  const prevChildSession = process.env.CLAUDE_CODE_CHILD_SESSION
  const prevIngress = process.env.SESSION_INGRESS_URL
  const prevStrict = getStrictMcpConfig()

  beforeEach(() => {
    process.env.MCP_DISCOVERY_CACHE = '1'
    delete process.env.CLAUDE_CODE_SIMPLE
    delete process.env.CLAUDE_CODE_ENTRYPOINT
    delete process.env.CLAUDE_CODE_CHILD_SESSION
    setStrictMcpConfig(false)
    resetMcpIdentityStateForTests()
  })

  afterEach(() => {
    if (prevDiscoveryEnv === undefined) delete process.env.MCP_DISCOVERY_CACHE
    else process.env.MCP_DISCOVERY_CACHE = prevDiscoveryEnv
    if (prevSimpleEnv === undefined) delete process.env.CLAUDE_CODE_SIMPLE
    else process.env.CLAUDE_CODE_SIMPLE = prevSimpleEnv
    if (prevEntrypoint === undefined) delete process.env.CLAUDE_CODE_ENTRYPOINT
    else process.env.CLAUDE_CODE_ENTRYPOINT = prevEntrypoint
    if (prevChildSession === undefined)
      delete process.env.CLAUDE_CODE_CHILD_SESSION
    else process.env.CLAUDE_CODE_CHILD_SESSION = prevChildSession
    if (prevIngress === undefined) delete process.env.SESSION_INGRESS_URL
    else process.env.SESSION_INGRESS_URL = prevIngress
    setStrictMcpConfig(prevStrict)
    resetMcpIdentityStateForTests()
    resetMcpCcrIngressCapture()
  })

  test('#1: logged-out account returns acct:logged-out and stabilizes identity baseline across turns', () => {
    setMcpAccountIdentityResolver(() => undefined)
    expect(currentMcpAccountToken()).toBe('acct:logged-out')

    seedMcpIdentityCheck()
    // Subsequent turns in API-key / Bedrock / Vertex / logged-out sessions must NOT report identity changed
    expect(mcpIdentityChangedSinceLastCheck()).toBe(false)
    expect(mcpIdentityChangedSinceLastCheck()).toBe(false)
    expect(getMcpIdentityEpoch()).toBe(0)
  })

  test('#1: unwired and incomplete accounts still return undefined token', () => {
    // Unwired (no resolver installed)
    expect(currentMcpAccountToken()).toBeUndefined()

    // Incomplete (accountUuid present but credentialInstalled: false)
    setMcpAccountIdentityResolver(() => ({
      accountUuid: 'acc-1',
      organizationUuid: 'org-1',
      credentialInstalled: false,
    }))
    expect(currentMcpAccountToken()).toBeUndefined()
  })

  test('#1: rearmMcpIdentityBaseline survives transient logged-out/incomplete reads and trips on resolved', async () => {
    let current: McpAccountIdentity | undefined
    setMcpAccountIdentityResolver(() => current)

    let notified = 0
    const unsub = registerMcpIdentityChangeHandler(() => {
      notified += 1
    })

    try {
      rearmMcpIdentityBaseline()
      const epochAfterRearm = getMcpIdentityEpoch()
      expect(epochAfterRearm).toBe(1)

      // Transient logged-out & incomplete reads must NOT wipe baseline:rearmed or fire handler
      expect(currentMcpAccountToken()).toBe('acct:logged-out')
      current = {
        accountUuid: 'acc-new',
        organizationUuid: 'org-new',
        credentialInstalled: false,
      }
      expect(currentMcpAccountToken()).toBeUndefined()
      await Promise.resolve()
      expect(notified).toBe(0)
      expect(getMcpIdentityEpoch()).toBe(epochAfterRearm)

      // Transition to resolved must now trip epoch + handler
      current = {
        accountUuid: 'acc-new',
        organizationUuid: 'org-new',
        credentialInstalled: true,
      }
      expect(currentMcpAccountToken()).toBe('acct:acc-new|org:org-new')
      await Promise.resolve()
      expect(getMcpIdentityEpoch()).toBe(epochAfterRearm + 1)
      expect(notified).toBe(1)
    } finally {
      unsub()
    }
  })

  test('#6: headlessMcpIdentityBoundary skips claude.ai connector fetch under --strict-mcp-config and --bare', async () => {
    setMcpAccountIdentityResolver(() => ({
      accountUuid: 'acc-1',
      organizationUuid: 'org-1',
      credentialInstalled: true,
    }))
    seedMcpIdentityCheck()

    let connectorFetches = 0
    const appState = {
      mcp: {
        clients: [],
        tools: [],
        commands: [],
        resources: {},
        resourceTemplates: {},
      },
    }
    const boundary = createHeadlessMcpIdentityBoundary({
      getAppState: () => appState as never,
      setAppState: () => {},
      getDynamicMcpState: () => ({ clients: [], tools: [], configs: {} }),
      setDynamicMcpState: () => {},
      isControlReconnectInFlight: () => false,
      isRunEnding: () => false,
      clearNeedsAuth: () => {},
      clearConnectorConfigs: () => {},
      onReconnected: () => {},
      fetchConnectorConfigs: async () => {
        connectorFetches += 1
        return {}
      },
    })

    setStrictMcpConfig(true)
    await boundary.refresh({ force: true })
    expect(connectorFetches).toBe(0)

    setStrictMcpConfig(false)
    process.env.CLAUDE_CODE_SIMPLE = '1'
    await boundary.refresh({ force: true })
    expect(connectorFetches).toBe(0)

    delete process.env.CLAUDE_CODE_SIMPLE
    await boundary.refresh({ force: true })
    expect(connectorFetches).toBe(1)
    boundary.dispose()
  })

  test('#7: SZe distinguishes accountMemoryServer from user SDK memory servers and allows PermissionRequest empty {}', () => {
    const sdkMemoryServer = {
      name: ACCOUNT_MEMORY_SERVER_NAME,
      config: { scope: 'dynamic', type: 'sdk' },
    }
    // Outside local-agent entrypoint: X2e is true, but SZe (accountMemoryServer) is false
    expect(isAccountMemoryTool(sdkMemoryServer, 'memory_read')).toBe(true)
    expect(isAccountMemoryServerTool(sdkMemoryServer, 'memory_read')).toBe(
      false,
    )

    // Inside local-agent entrypoint (non-child): SZe is true
    process.env.CLAUDE_CODE_ENTRYPOINT = 'local-agent'
    expect(isAccountMemoryServerTool(sdkMemoryServer, 'memory_read')).toBe(true)
    process.env.CLAUDE_CODE_CHILD_SESSION = '1'
    expect(isAccountMemoryServerTool(sdkMemoryServer, 'memory_read')).toBe(
      false,
    )

    // CLI-owned memory server is always SZe
    const cliConfig = { scope: 'dynamic', type: 'sdk' }
    markCliOwnedConfig(cliConfig)
    expect(
      isAccountMemoryServerTool(
        { name: ACCOUNT_MEMORY_SERVER_NAME, config: cliConfig },
        'custom_helper',
      ),
    ).toBe(true)

    // User SDK tool with only accountMemory: true (no accountMemoryServer) is not hook-rewrite-blocked
    const userSdkTool = { mcpInfo: { accountMemory: true } }
    expect(isAccountMemoryHookTool(userSdkTool)).toBe(false)
    expect(
      didAccountMemoryHookRewriteInput(
        userSdkTool,
        { q: 'hello' },
        { q: 'rewritten' },
      ),
    ).toBe(false)

    // Real account memory server tool blocks input changes, EXCEPT empty {} when allowEmptyObject=true
    const realMemoryTool = {
      mcpInfo: { accountMemory: true, accountMemoryServer: true },
    }
    expect(isAccountMemoryHookTool(realMemoryTool)).toBe(true)
    expect(
      didAccountMemoryHookRewriteInput(
        realMemoryTool,
        { path: '/notes/a.md' },
        {},
        true,
      ),
    ).toBe(false)
    expect(
      didAccountMemoryHookRewriteInput(
        realMemoryTool,
        { path: '/notes/a.md' },
        {},
        false,
      ),
    ).toBe(true)
    expect(
      didAccountMemoryHookRewriteInput(
        realMemoryTool,
        { path: '/notes/a.md' },
        { path: '/notes/tampered.md' },
        true,
      ),
    ).toBe(true)
  })

  test('#12.1: connectToServer per-call abort rejects with AbortError recognized by isAbortError', async () => {
    const neverEndingPending = new Promise<never>(() => {})
    const fakeConfig = {
      type: 'http' as const,
      url: 'http://127.0.0.1:65534/mcp-abort-test',
      scope: 'dynamic' as const,
    }
    // Seed memo with a pending promise so we never spawn or dial network
    connectToServer.cache.set(
      `abort-test-${JSON.stringify(fakeConfig)}`,
      neverEndingPending,
    )
    const ac = new AbortController()
    ac.abort()
    try {
      const err = await connectToServer('abort-test', fakeConfig, undefined, {
        signal: ac.signal,
      }).then(
        () => null,
        e => e,
      )
      expect(err).not.toBeNull()
      expect(isAbortError(err)).toBe(true)
    } finally {
      connectToServer.cache.clear?.()
    }
  })

  test('#14: collectMcpResourceLinks enforces 64 KiB cap in UTF-8 bytes rather than UTF-16 code units', () => {
    // 10,000 CJK chars = 10,000 UTF-16 units (~10k .length) but 30,000 UTF-8 bytes!
    // Three such entries = ~30k chars (< 65,536 chars) yet ~90,000 UTF-8 bytes (> 65,536 bytes).
    const cjkChunk = '漢'.repeat(10_000)
    const links = [
      { type: 'resource_link', uri: 'file:///1', name: cjkChunk },
      { type: 'resource_link', uri: 'file:///2', name: cjkChunk },
      { type: 'resource_link', uri: 'file:///3', name: cjkChunk },
    ]
    const collected = collectMcpResourceLinks(links)
    expect(collected.length).toBe(2)
    expect(
      Buffer.byteLength(JSON.stringify(collected), 'utf8'),
    ).toBeLessThanOrEqual(65_536)
  })
})
