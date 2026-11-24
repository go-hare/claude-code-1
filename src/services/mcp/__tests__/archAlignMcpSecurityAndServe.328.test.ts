import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { Client, UnauthorizedError } from '@modelcontextprotocol/client'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import axios from 'axios'
import { z } from 'zod/v4'
import {
  checkAgentInlineMcpUrlSsrf,
  initializeAgentMcpServers,
  isAgentPersonalConfigRestricted,
  isReservedAgentMcpServerName,
  validateAgentInlineMcpServer,
} from '../../../../packages/builtin-tools/src/tools/AgentTool/runAgent.js'
import type { AgentDefinition } from '../../../../packages/builtin-tools/src/tools/AgentTool/loadAgentsDir.js'
import {
  createLinkedMcpCallAbortController,
  createMCPServer,
  MCP_PROGRESS_HEARTBEAT_INTERVAL_MS,
  startMcpProgressHeartbeat,
} from '../../../entrypoints/mcp.js'
import type { Tool } from '../../../Tool.js'
import {
  createAbortController,
  getAbortReasonMessage,
  isRemoteCancelAbortReason,
} from '../../../utils/abortController.js'
import {
  getCurrentProjectConfig,
  getGlobalConfig,
  saveGlobalConfig,
} from '../../../utils/config.js'
import * as secureStorageMod from '../../../utils/secureStorage/index.js'
import type {
  SecureStorage,
  SecureStorageData,
} from '../../../utils/secureStorage/types.js'
import { settingsChangeDetector } from '../../../utils/settings/changeDetector.js'
import {
  ClaudeAuthProvider,
  clearMcpOAuthStubIfTokenless,
  evaluateIssuerEchoPolicy,
  getServerKey,
  isEntraLoginUrl,
  IssuerEchoCrossOriginError,
  maybeAppendOfflineAccess,
  McpClientRegistrationDeferredError,
  revokeReplacedServerTokens,
  snapshotServerTokens,
} from '../auth.js'
import {
  completeResourceTemplate,
  composeMcpTool,
  computeMcpDenyKey,
  computeMcpStandardKey,
  deriveMcpUrlStandardKey,
  fetchToolsForClient,
  isSpoofedClaudeAiServerName,
  LegacyDialectToleratingValidator,
  stripLegacyJsonSchemaDialect,
} from '../client.js'
import { isCliOwnedConfig, markCliOwnedConfig } from '../cliOwnedConfigs.js'
import {
  LEGACY_JSON_SCHEMA_DIALECT_URIS,
  LegacyDialectToleratingValidator as SchemaLegacyValidator,
} from '../mcpToolSchema.js'
import type {
  ConnectedMCPServer,
  McpHTTPServerConfig,
  McpServerConfig,
  MCPServerConnection,
  ScopedMcpServerConfig,
} from '../types.js'

const tempDirs: string[] = []
function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function createMemorySecureStorage(): SecureStorage {
  let state: SecureStorageData | null = {}
  return {
    name: 'memory-test-storage',
    read: () => state,
    readAsync: async () => state,
    update: (data: SecureStorageData) => {
      state = data
      return { success: true }
    },
    delete: () => {
      state = null
      return true
    },
  }
}

const originalRestrictPersonal =
  process.env.CLAUDE_CODE_RESTRICT_PERSONAL_CONFIG
const originalAllowPrivate = process.env.CLAUDE_CODE_ALLOW_PRIVATE_INLINE_MCP

afterEach(() => {
  if (originalRestrictPersonal === undefined) {
    delete process.env.CLAUDE_CODE_RESTRICT_PERSONAL_CONFIG
  } else {
    process.env.CLAUDE_CODE_RESTRICT_PERSONAL_CONFIG = originalRestrictPersonal
  }
  if (originalAllowPrivate === undefined) {
    delete process.env.CLAUDE_CODE_ALLOW_PRIVATE_INLINE_MCP
  } else {
    process.env.CLAUDE_CODE_ALLOW_PRIVATE_INLINE_MCP = originalAllowPrivate
  }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // ignore cleanup error
    }
  }
})

describe('[P0-6] Agent frontmatter inline MCP security gates (2.1.328)', () => {
  test('SSRF guard rejects loopback, private RFC1918, link-local, cloud metadata, IPv6 private, and non-HTTP/WS schemes', () => {
    const blockedUrls: McpServerConfig[] = [
      { type: 'http', url: 'http://169.254.169.254/latest/meta-data/' },
      { type: 'http', url: 'http://127.0.0.1:8080/mcp' },
      { type: 'http', url: 'http://localhost:3000/mcp' },
      { type: 'http', url: 'http://api.localhost/mcp' },
      { type: 'http', url: 'http://0.0.0.0:9000/mcp' },
      { type: 'http', url: 'http://10.0.0.5/mcp' },
      { type: 'http', url: 'http://172.16.0.1/mcp' },
      { type: 'http', url: 'http://172.31.255.254/mcp' },
      { type: 'http', url: 'http://192.168.1.42/mcp' },
      { type: 'http', url: 'http://100.64.1.1/mcp' },
      { type: 'http', url: 'http://[::1]:8080/mcp' },
      { type: 'http', url: 'http://[fe80::1]/mcp' },
      { type: 'http', url: 'http://[fd00:ec2::254]/latest/meta-data/' },
      { type: 'http', url: 'http://[::ffff:127.0.0.1]/mcp' },
      { type: 'http', url: 'http://[::ffff:169.254.169.254]/latest/' },
      {
        type: 'http',
        url: 'http://metadata.google.internal/computeMetadata/v1/',
      },
      { type: 'sse', url: 'file:///etc/passwd' },
      { type: 'http', url: 'ftp://example.com/mcp' },
      { type: 'http', url: 'ws://mcp.example.com/ws' },
      { type: 'ws', url: 'https://mcp.example.com/http' },
    ]

    for (const cfg of blockedUrls) {
      const res = checkAgentInlineMcpUrlSsrf(cfg)
      expect(res.allowed).toBe(false)
    }

    // Public HTTPS and WSS are allowed
    expect(
      checkAgentInlineMcpUrlSsrf({
        type: 'http',
        url: 'https://mcp.example.com/v1',
      }),
    ).toEqual({ allowed: true })
    expect(
      checkAgentInlineMcpUrlSsrf({
        type: 'ws',
        url: 'wss://ws.example.com/mcp',
      }),
    ).toEqual({ allowed: true })

    // Explicit allowPrivateAddresses allows private IPv4/IPv6 but still rejects file://
    expect(
      checkAgentInlineMcpUrlSsrf(
        { type: 'http', url: 'http://127.0.0.1:8080/mcp' },
        { allowPrivateAddresses: true },
      ),
    ).toEqual({ allowed: true })
    expect(
      checkAgentInlineMcpUrlSsrf(
        { type: 'http', url: 'file:///etc/passwd' },
        { allowPrivateAddresses: true },
      ).allowed,
    ).toBe(false)
  })

  test('reserved and protected session server name collision guard blocks ide, claude-in-chrome, claude_ai_*, and protected parent clients', () => {
    expect(isReservedAgentMcpServerName('ide')).toBe(true)
    expect(isReservedAgentMcpServerName('IDE')).toBe(true)
    expect(isReservedAgentMcpServerName('claude-in-chrome')).toBe(true)
    expect(isReservedAgentMcpServerName('computer-use')).toBe(true)
    expect(isReservedAgentMcpServerName('claude_ai_Slack')).toBe(true)
    expect(isReservedAgentMcpServerName('claude.ai Linear')).toBe(true)
    expect(isReservedAgentMcpServerName('claude-code-remote')).toBe(true)
    expect(isReservedAgentMcpServerName('custom-tools')).toBe(false)

    const cliOwnedMemConfig: ScopedMcpServerConfig = {
      type: 'http',
      url: 'https://api.anthropic.com/memory',
      scope: 'dynamic',
    }
    markCliOwnedConfig(cliOwnedMemConfig)
    expect(isCliOwnedConfig(cliOwnedMemConfig)).toBe(true)

    const parentClients: MCPServerConnection[] = [
      {
        name: 'memory',
        type: 'failed',
        config: cliOwnedMemConfig,
      },
      {
        name: 'corp-gateway',
        type: 'failed',
        config: {
          type: 'http',
          url: 'https://corp.example.com/mcp',
          scope: 'enterprise',
        },
      },
    ]

    expect(isReservedAgentMcpServerName('memory', parentClients)).toBe(true)
    expect(isReservedAgentMcpServerName('corp-gateway', parentClients)).toBe(
      true,
    )
    expect(isReservedAgentMcpServerName('unlisted-server', parentClients)).toBe(
      false,
    )
  })

  test('untrusted agent origin and CLAUDE_CODE_RESTRICT_PERSONAL_CONFIG block inline MCP servers', () => {
    const untrustedDir = makeTempDir('agent-untrusted-origin-')
    const untrustedAgent = {
      agentType: 'repo-agent',
      source: 'projectSettings' as const,
      baseDir: join(untrustedDir, '.claude', 'agents'),
    }

    const untrustedRes = validateAgentInlineMcpServer({
      agentDefinition: untrustedAgent,
      serverName: 'helper',
      serverConfig: { type: 'http', url: 'https://mcp.example.com/api' },
      isInline: true,
    })
    expect(untrustedRes.allowed).toBe(false)
    if (!untrustedRes.allowed) {
      expect(untrustedRes.reason).toBe('untrusted-origin')
    }

    // Personal config restriction
    const userAgent = {
      agentType: 'my-agent',
      source: 'userSettings' as const,
    }
    delete process.env.CLAUDE_CODE_RESTRICT_PERSONAL_CONFIG
    expect(isAgentPersonalConfigRestricted(userAgent)).toBe(false)
    expect(
      validateAgentInlineMcpServer({
        agentDefinition: userAgent,
        serverName: 'helper',
        serverConfig: { type: 'http', url: 'https://mcp.example.com/api' },
        isInline: true,
      }),
    ).toEqual({ allowed: true })

    process.env.CLAUDE_CODE_RESTRICT_PERSONAL_CONFIG = '1'
    expect(isAgentPersonalConfigRestricted(userAgent)).toBe(true)
    const restrictedRes = validateAgentInlineMcpServer({
      agentDefinition: userAgent,
      serverName: 'helper',
      serverConfig: { type: 'http', url: 'https://mcp.example.com/api' },
      isInline: true,
    })
    expect(restrictedRes.allowed).toBe(false)
    if (!restrictedRes.allowed) {
      expect(restrictedRes.reason).toBe('restricted-personal-config')
    }
  })

  test('project-scoped agent inline MCP server requires project approval even when folder is trusted', () => {
    const trustedDir = makeTempDir('agent-trusted-proj-')
    const prevConfig = getGlobalConfig()
    const prevProjects = prevConfig.projects ?? {}
    saveGlobalConfig(current => ({
      ...current,
      projects: {
        ...current.projects,
        [trustedDir]: {
          ...getCurrentProjectConfig(),
          ...(current.projects?.[trustedDir] ?? {}),
          hasTrustDialogAccepted: true,
          enabledMcpjsonServers: [],
          disabledMcpjsonServers: [],
        },
      },
    }))

    try {
      const projectAgent = {
        agentType: 'proj-agent',
        source: 'projectSettings' as const,
        baseDir: join(trustedDir, '.claude', 'agents'),
      }

      const res = validateAgentInlineMcpServer({
        agentDefinition: projectAgent,
        serverName: 'unapproved-inline-server',
        serverConfig: { type: 'http', url: 'https://mcp.example.com/api' },
        isInline: true,
      })
      expect(res.allowed).toBe(false)
      if (!res.allowed) {
        expect(res.reason).toBe('project-approval')
      }
    } finally {
      saveGlobalConfig(current => ({
        ...current,
        projects: prevProjects,
      }))
    }
  })

  test('disallowed frontmatter transport and initializeAgentMcpServers block before connecting', async () => {
    const userAgent: AgentDefinition = {
      agentType: 'inline-mcp-agent',
      whenToUse: 'test',
      source: 'userSettings',
      getSystemPrompt: () => '',
      mcpServers: [
        {
          'imds-probe': {
            type: 'http',
            url: 'http://169.254.169.254/latest/meta-data/',
          },
        },
        {
          'claude-in-chrome': {
            type: 'http',
            url: 'https://mcp.example.com/chrome',
          },
        },
        {
          'fake-ide': {
            type: 'sse-ide',
            url: 'https://mcp.example.com/ide',
            ideName: 'VSCode',
          },
        },
      ],
    }

    const result = await initializeAgentMcpServers(userAgent, [])
    expect(result.clients).toEqual([])
    expect(result.tools).toEqual([])
    await result.cleanup()
  })
})

describe('[P0-7 + P1-7] MCP OAuth RFC 8414 issuer-echo, deferred DCR, revocation & Entra ID (2.1.328)', () => {
  const testServerConfig: McpHTTPServerConfig = {
    type: 'http',
    url: 'https://mcp-auth-test.example.com/mcp',
  }

  test('evaluateIssuerEchoPolicy enforces RFC 8414 §3.3 cross-origin check in strict mode and allows exact/same-origin', () => {
    // Exact match and trailing slash match pass even in strict mode
    expect(() =>
      evaluateIssuerEchoPolicy({
        serverName: 'srv',
        site: 'rfc9728_chain',
        expectedIssuer: 'https://auth.example.com/',
        receivedIssuer: 'https://auth.example.com',
        strict: true,
      }),
    ).not.toThrow()

    // Same-origin path difference proceeds in strict mode
    expect(() =>
      evaluateIssuerEchoPolicy({
        serverName: 'srv',
        site: 'rfc9728_chain',
        expectedIssuer: 'https://auth.example.com',
        receivedIssuer: 'https://auth.example.com/oauth2',
        strict: true,
      }),
    ).not.toThrow()

    // Cross-origin mismatch in observe mode does NOT throw
    expect(() =>
      evaluateIssuerEchoPolicy({
        serverName: 'srv',
        site: 'rfc9728_chain',
        expectedIssuer: 'https://auth.example.com',
        receivedIssuer: 'https://evil.attacker.com',
        strict: false,
      }),
    ).not.toThrow()

    // Cross-origin mismatch in strict mode throws IssuerEchoCrossOriginError
    let caught: unknown
    try {
      evaluateIssuerEchoPolicy({
        serverName: 'srv',
        site: 'rfc9728_chain',
        expectedIssuer: 'https://auth.example.com',
        receivedIssuer: 'https://evil.attacker.com',
        serverConfig: testServerConfig,
        strict: true,
      })
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(IssuerEchoCrossOriginError)
    const echoErr = caught as IssuerEchoCrossOriginError
    expect(echoErr.name).toBe('IssuerEchoCrossOriginError')
    expect(echoErr.code).toBe('issuer_echo_denied')
    expect(echoErr.expected).toBe('https://auth.example.com')
    expect(echoErr.received).toBe('https://evil.attacker.com')

    // Missing / unparseable issuer also denied in strict mode
    expect(() =>
      evaluateIssuerEchoPolicy({
        serverName: 'srv',
        site: 'sdk_auth',
        expectedIssuer: 'https://auth.example.com',
        receivedIssuer: undefined,
        strict: true,
      }),
    ).toThrow(IssuerEchoCrossOriginError)
  })

  test('ClaudeAuthProvider defers DCR with McpClientRegistrationDeferredError during background discovery', async () => {
    const storage = createMemorySecureStorage()
    const storageSpy = spyOn(
      secureStorageMod,
      'getSecureStorage',
    ).mockReturnValue(storage)
    try {
      const serverName = `deferred-dcr-${Date.now()}`
      const config: McpHTTPServerConfig = {
        type: 'http',
        url: `https://dcr-test-${Date.now()}.example.com/mcp`,
      }

      const backgroundProvider = new ClaudeAuthProvider(
        serverName,
        config,
        'http://127.0.0.1:43210/callback',
        false, // background discovery — handleRedirection = false
      )
      await backgroundProvider.saveDiscoveryState({
        authorizationServerUrl: 'https://auth.example.com',
        authorizationServerMetadata: {
          issuer: 'https://auth.example.com',
          authorization_endpoint: 'https://auth.example.com/authorize',
          token_endpoint: 'https://auth.example.com/token',
          registration_endpoint: 'https://auth.example.com/register',
          response_types_supported: ['code'],
        },
      })
      expect(backgroundProvider.registrationOfferedByDiscovery).toBe(true)

      let deferredErr: unknown
      try {
        await backgroundProvider.clientInformation()
      } catch (err) {
        deferredErr = err
      }
      expect(deferredErr).toBeInstanceOf(McpClientRegistrationDeferredError)
      expect(deferredErr).toBeInstanceOf(UnauthorizedError)
      expect(
        (deferredErr as McpClientRegistrationDeferredError).serverName,
      ).toBe(serverName)

      // User-initiated auth (handleRedirection = true) returns undefined so DCR runs
      const interactiveProvider = new ClaudeAuthProvider(
        serverName,
        config,
        'http://127.0.0.1:43210/callback',
        true,
      )
      interactiveProvider.registrationOfferedByDiscovery = true
      expect(await interactiveProvider.clientInformation()).toBeUndefined()

      // Tokenless stub created by saveDiscoveryState is cleaned up by clearMcpOAuthStubIfTokenless
      const key = getServerKey(serverName, config)
      expect(storage.read()?.mcpOAuth?.[key]).toBeDefined()
      await clearMcpOAuthStubIfTokenless(serverName, config)
      expect(storage.read()?.mcpOAuth?.[key]).toBeUndefined()
    } finally {
      storageSpy.mockRestore()
    }
  })

  test('snapshotServerTokens + revokeReplacedServerTokens + clearMcpOAuthStubIfTokenless preserve active tokens and revoke replaced ones', async () => {
    const storage = createMemorySecureStorage()
    const storageSpy = spyOn(
      secureStorageMod,
      'getSecureStorage',
    ).mockReturnValue(storage)
    const serverName = `revoke-test-${Date.now()}`
    const config: McpHTTPServerConfig = {
      type: 'http',
      url: `https://revoke-test-${Date.now()}.example.com/mcp`,
      oauth: {
        authServerMetadataUrl:
          'https://auth.revoke-test.example.com/.well-known/oauth-authorization-server',
      },
    }
    const key = getServerKey(serverName, config)
    const initialEntry = {
      serverName,
      serverUrl: config.url,
      accessToken: 'old-access-token',
      refreshToken: 'old-refresh-token',
      expiresAt: Date.now() + 60_000,
      clientId: 'cid-123',
    }

    storage.update({
      mcpOAuth: {
        [key]: initialEntry,
      },
    })

    try {
      // clearMcpOAuthStubIfTokenless must NOT delete entries with tokens
      await clearMcpOAuthStubIfTokenless(serverName, config)
      expect(storage.read()?.mcpOAuth?.[key]?.accessToken).toBe(
        'old-access-token',
      )

      // Snapshot captures old tokens
      const snap = await snapshotServerTokens(serverName, config)
      expect(snap?.accessToken).toBe('old-access-token')
      expect(snap?.refreshToken).toBe('old-refresh-token')
      expect(snap?.clientId).toBe('cid-123')

      // Simulate re-auth replacing tokens
      const cur = storage.read() || {}
      const existingEntry = cur.mcpOAuth?.[key] ?? initialEntry
      storage.update({
        ...cur,
        mcpOAuth: {
          ...cur.mcpOAuth,
          [key]: {
            ...existingEntry,
            accessToken: 'new-access-token',
            refreshToken: 'new-refresh-token',
          },
        },
      })

      const origFetch = globalThis.fetch
      const origAxiosPost = axios.post
      const revokedTokens: string[] = []

      globalThis.fetch = (async () =>
        new Response(
          JSON.stringify({
            issuer: 'https://auth.revoke-test.example.com',
            authorization_endpoint:
              'https://auth.revoke-test.example.com/authorize',
            token_endpoint: 'https://auth.revoke-test.example.com/token',
            revocation_endpoint: 'https://auth.revoke-test.example.com/revoke',
            response_types_supported: ['code'],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )) as unknown as typeof fetch

      const axiosPostSpy = mock(async (_url: string, data: unknown) => {
        if (data instanceof URLSearchParams) {
          revokedTokens.push(
            `${data.get('token_type_hint')}:${data.get('token')}`,
          )
        }
        return { status: 200, data: {} }
      })
      axios.post = axiosPostSpy as unknown as typeof axios.post

      try {
        await revokeReplacedServerTokens(serverName, config, snap!)
        expect(revokedTokens).toEqual([
          'refresh_token:old-refresh-token',
          'access_token:old-access-token',
        ])
        // New tokens in storage remain intact
        expect(storage.read()?.mcpOAuth?.[key]?.accessToken).toBe(
          'new-access-token',
        )
      } finally {
        globalThis.fetch = origFetch
        axios.post = origAxiosPost
      }
    } finally {
      storageSpy.mockRestore()
    }
  })

  test('Microsoft Entra ID detection, maybeAppendOfflineAccess, and redirectToAuthorization scope/prompt fix', async () => {
    expect(
      isEntraLoginUrl(
        'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
      ),
    ).toBe(true)
    expect(
      isEntraLoginUrl(
        'https://login.microsoftonline.us/tenant/oauth2/v2.0/authorize',
      ),
    ).toBe(true)
    expect(
      isEntraLoginUrl(
        'https://login.chinacloudapi.cn/tenant/oauth2/v2.0/authorize',
      ),
    ).toBe(true)
    expect(
      isEntraLoginUrl(
        'https://login.partner.microsoftonline.cn/tenant/oauth2/v2.0/authorize',
      ),
    ).toBe(true)
    expect(isEntraLoginUrl('https://contoso.b2clogin.com/authorize')).toBe(true)
    expect(isEntraLoginUrl('https://contoso.ciamlogin.com/authorize')).toBe(
      true,
    )
    expect(isEntraLoginUrl('https://auth.example.com/authorize')).toBe(false)
    expect(
      isEntraLoginUrl('https://login.microsoftonline.com.evil.test/authorize'),
    ).toBe(false)

    // maybeAppendOfflineAccess behavior
    expect(
      maybeAppendOfflineAccess('openid profile', {
        scopes_supported: ['openid', 'profile', 'offline_access'],
      }),
    ).toBe('openid profile offline_access')
    expect(
      maybeAppendOfflineAccess('openid offline_access', {
        scopes_supported: ['openid', 'offline_access'],
      }),
    ).toBe('openid offline_access')
    expect(
      maybeAppendOfflineAccess('openid', { scopes_supported: ['openid'] }),
    ).toBe('openid')
    expect(
      maybeAppendOfflineAccess(null, {
        scopes_supported: ['offline_access'],
      }),
    ).toBe('offline_access')

    // End-to-end ClaudeAuthProvider.redirectToAuthorization with Entra ID URL
    const capturedUrls: string[] = []
    const provider = new ClaudeAuthProvider(
      'entra-mcp',
      testServerConfig,
      'http://127.0.0.1:44444/callback',
      true,
      url => capturedUrls.push(url),
      true, // skipBrowserOpen
    )
    provider.setMetadata({
      issuer: 'https://login.microsoftonline.com/tenant/v2.0',
      authorization_endpoint:
        'https://login.microsoftonline.com/tenant/oauth2/v2.0/authorize',
      token_endpoint:
        'https://login.microsoftonline.com/tenant/oauth2/v2.0/token',
      scopes_supported: ['openid', 'api://mcp/access', 'offline_access'],
      response_types_supported: ['code'],
    })

    const authUrl = new URL(
      'https://login.microsoftonline.com/tenant/oauth2/v2.0/authorize?client_id=abc&scope=openid&prompt=consent',
    )
    await provider.redirectToAuthorization(authUrl)

    expect(capturedUrls).toHaveLength(1)
    const redirected = new URL(capturedUrls[0]!)
    expect(redirected.searchParams.get('scope')).toBe('openid offline_access')
    expect(redirected.searchParams.get('prompt')).toBeNull()
  })
})

describe('[P1-7] MCP Client legacy schema tolerance, standardKey/denyKey, droppedTools & completion (2.1.328)', () => {
  test('stripLegacyJsonSchemaDialect & LegacyDialectToleratingValidator tolerate draft-04/06/07/2019-09 schemas', () => {
    expect(LEGACY_JSON_SCHEMA_DIALECT_URIS.size).toBe(10)
    expect(LegacyDialectToleratingValidator).toBe(SchemaLegacyValidator)

    const draft07 = {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      properties: { count: { type: 'number' } },
      required: ['count'],
    }
    const stripped = stripLegacyJsonSchemaDialect(draft07)
    expect('$schema' in stripped).toBe(false)
    expect(stripped.type).toBe('object')

    // Draft 2020-12 and custom $schema stay intact
    const draft2020 = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
    }
    expect(stripLegacyJsonSchemaDialect(draft2020)).toBe(draft2020)

    // AJV validator compiles draft-07, draft-04, and draft-2019-09 schemas cleanly
    const validator = new LegacyDialectToleratingValidator()
    for (const uri of [
      'http://json-schema.org/draft-04/schema#',
      'https://json-schema.org/draft-06/schema',
      'http://json-schema.org/draft-07/schema#',
      'https://json-schema.org/draft/2019-09/schema',
    ]) {
      const validate = validator.getValidator({
        $schema: uri,
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
      })
      expect(validate({ name: 'ok' }).valid).toBe(true)
      expect(validate({ name: 123 }).valid).toBe(false)
    }
  })

  test('standardKey, denyKey, and composeMcpTool anti-spoofing metadata', async () => {
    expect(deriveMcpUrlStandardKey('https://api.example.com/v1/mcp')).toBe(
      'api_example_com',
    )
    expect(deriveMcpUrlStandardKey('http://127.0.0.1:8080/mcp')).toMatch(
      /^h-[0-9a-f]{32}$/,
    )

    const httpCfg: ScopedMcpServerConfig = {
      type: 'http',
      url: 'https://api.example.com/v1/mcp',
      scope: 'user',
    }
    expect(computeMcpStandardKey('my-alias', httpCfg)).toEqual({
      key: 'api_example_com',
      pinned: false,
    })

    expect(
      computeMcpStandardKey('ide', {
        type: 'sse-ide',
        url: 'http://127.0.0.1:1234',
        ideName: 'VSCode',
        scope: 'dynamic',
      }),
    ).toEqual({ key: 'ide', pinned: true })

    // Punycode/IDN URL yields canonical denyKey
    expect(
      computeMcpDenyKey({
        type: 'http',
        url: 'https://bücher.example/mcp',
        scope: 'user',
      }),
    ).toBe('xn--bcher-kva_example')

    // Spoofed claude_ai_* server name refuses allow rules
    expect(isSpoofedClaudeAiServerName('claude_ai_Slack', httpCfg)).toBe(true)
    expect(
      isSpoofedClaudeAiServerName('claude_ai_Slack', {
        ...httpCfg,
        scope: 'claudeai',
      }),
    ).toBe(false)

    const dummyBaseTool = {
      name: 'mcp__claude_ai_Slack__post',
      mcpInfo: { serverName: 'claude_ai_Slack', toolName: 'post' },
    } as unknown as Tool

    const spoofedTool = composeMcpTool({
      serverName: 'claude_ai_Slack',
      config: httpCfg,
      toolName: 'post',
      fullyQualifiedName: 'mcp__claude_ai_Slack__post',
      standardKey: computeMcpStandardKey('claude_ai_Slack', httpCfg),
      denyKey: 'alt_deny_key',
      requiresUserInteraction: false,
      isFirstPartyDesignServer: false,
      baseTool: dummyBaseTool,
    })
    const spoofedInfo = spoofedTool.mcpInfo as {
      standardKey?: { key: string; pinned: boolean }
      denyKey?: string
      legacyGrantRefused?: boolean
    }
    expect(spoofedInfo.standardKey).toEqual({
      key: 'api_example_com',
      pinned: false,
    })
    expect(spoofedInfo.denyKey).toBe('alt_deny_key')
    expect(spoofedInfo.legacyGrantRefused).toBe(true)
    expect(spoofedTool.suppressesAlwaysAllowRule?.({})).toBe(true)
  })

  test('fetchToolsForClient tracks droppedTools (invalid schema + overlong name) and detects toolNameShared collisions', async () => {
    const longToolName = 'x'.repeat(140)
    const listedToolsPayload = {
      tools: [
        {
          name: 'read-item',
          description: 'Read item A',
          inputSchema: {
            type: 'object',
            properties: { id: { type: 'string' } },
          },
        },
        {
          name: 'read.item',
          description: 'Read item B',
          inputSchema: {
            type: 'object',
            properties: { id: { type: 'string' } },
          },
        },
        {
          name: 'read_item',
          description: 'Read item C (collides with read.item)',
          inputSchema: {
            type: 'object',
            properties: { id: { type: 'string' } },
          },
        },
        {
          name: 'bad_schema_tool',
          description: 'Has invalid non-array root combinator schema',
          inputSchema: {
            anyOf: 'not-an-array',
          },
        },
        {
          name: longToolName,
          description: 'Too long tool name',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
      ],
    }
    const fakeSdkClient = {
      request: async () => listedToolsPayload,
      listTools: async () => listedToolsPayload,
    }

    const connected: ConnectedMCPServer = {
      name: `srv-drop-${Date.now()}`,
      type: 'connected',
      client: fakeSdkClient as unknown as Client,
      capabilities: { tools: {} },
      config: {
        type: 'http',
        url: 'https://tools.example.com/mcp',
        scope: 'user',
      },
      cleanup: async () => {},
    }

    const tools = await fetchToolsForClient(connected)
    // Valid tools kept, colliding normalized tools (`read.item` & `read_item`) marked toolNameShared
    const colliding = tools.filter(
      t =>
        t.mcpInfo?.toolName === 'read.item' ||
        t.mcpInfo?.toolName === 'read_item',
    )
    expect(colliding).toHaveLength(2)
    for (const t of colliding) {
      const info = t.mcpInfo as {
        standardKey?: { key: string; pinned: boolean }
        toolNameShared?: boolean
      }
      expect(info.standardKey).toEqual({
        key: 'tools_example_com',
        pinned: false,
      })
      expect(info.toolNameShared).toBe(true)
      expect(t.suppressesAlwaysAllowRule?.({})).toBe(true)
    }

    // Non-colliding tool has standardKey and allows normal rules
    const cleanTool = tools.find(t => t.mcpInfo?.toolName === 'read-item')
    expect(cleanTool).toBeDefined()
    expect(
      (cleanTool!.mcpInfo as { toolNameShared?: boolean }).toolNameShared,
    ).toBeUndefined()

    // Both overlong tool name and invalid-schema tool were recorded in client.droppedTools
    expect(connected.droppedTools?.some(d => d.toolName === longToolName)).toBe(
      true,
    )
    expect(
      connected.droppedTools?.some(d => d.toolName === 'bad_schema_tool'),
    ).toBe(true)
  })

  test('completeResourceTemplate invokes completion/complete when supported and returns [] otherwise', async () => {
    let capturedParams: unknown
    const connectedWithCompletions: ConnectedMCPServer = {
      name: 'complete-srv',
      type: 'connected',
      client: {
        complete: async (params: unknown) => {
          capturedParams = params
          return {
            completion: {
              values: ['main', 'develop'],
              hasMore: false,
            },
          }
        },
      } as unknown as Client,
      capabilities: { completions: {} },
      config: { type: 'stdio', command: 'echo', args: [], scope: 'user' },
      cleanup: async () => {},
    }

    const values = await completeResourceTemplate(
      connectedWithCompletions,
      'git://repo/{branch}',
      'branch',
      'ma',
      { owner: 'anthropic' },
    )
    expect(values).toEqual(['main', 'develop'])
    expect(capturedParams).toEqual({
      ref: { type: 'ref/resource', uri: 'git://repo/{branch}' },
      argument: { name: 'branch', value: 'ma' },
      context: { arguments: { owner: 'anthropic' } },
    })

    // Without completions capability -> returns [] without throwing
    const noCompletions: ConnectedMCPServer = {
      ...connectedWithCompletions,
      capabilities: {},
    }
    expect(
      await completeResourceTemplate(
        noCompletions,
        'git://repo/{branch}',
        'branch',
        'ma',
      ),
    ).toEqual([])
  })
})

describe('[P1-7] claude mcp serve alignment (2.1.328)', () => {
  test('createLinkedMcpCallAbortController links remote-cancel and server shutdown', () => {
    const serverAc = createAbortController()
    const requestAc = new AbortController()
    const { abortController, detach } = createLinkedMcpCallAbortController(
      serverAc,
      requestAc.signal,
    )
    expect(abortController.signal.aborted).toBe(false)
    requestAc.abort()
    expect(abortController.signal.aborted).toBe(true)
    expect(isRemoteCancelAbortReason(abortController.signal.reason)).toBe(true)
    detach()

    // Shutdown abort propagation
    const serverAc2 = createAbortController()
    const { abortController: ac2, detach: detach2 } =
      createLinkedMcpCallAbortController(serverAc2)
    serverAc2.abort(new DOMException('shutdown', 'AbortError'))
    expect(ac2.signal.aborted).toBe(true)
    expect(getAbortReasonMessage(ac2.signal.reason)).toBe('shutdown')
    detach2()
  })

  test('startMcpProgressHeartbeat uses 30s default and emits monotonic progress notifications', async () => {
    expect(MCP_PROGRESS_HEARTBEAT_INTERVAL_MS).toBe(30_000)

    const sent: Array<{
      method: string
      params: {
        progressToken: string | number
        progress: number
        message?: string
      }
    }> = []

    // No-op when progressToken is undefined
    const noop = startMcpProgressHeartbeat(
      undefined,
      async n => {
        sent.push(n)
      },
      10,
    )
    expect(noop.report).toBeUndefined()
    noop.stop()
    expect(sent).toHaveLength(0)

    // Emits monotonic progress notifications on interval
    const hb = startMcpProgressHeartbeat(
      'tok-heartbeat',
      async n => {
        sent.push(n)
      },
      20,
    )
    await new Promise(resolve => setTimeout(resolve, 65))
    hb.stop()

    expect(sent.length).toBeGreaterThanOrEqual(2)
    expect(sent[0]!.method).toBe('notifications/progress')
    expect(sent[0]!.params.progressToken).toBe('tok-heartbeat')
    expect(sent[1]!.params.progress).toBeGreaterThan(sent[0]!.params.progress)
  })

  test('createMCPServer exposes tools.listChanged, loads agents, propagates remote-cancel, and emits progress heartbeats', async () => {
    const observedPromptAgents: string[] = []
    let observedCallAgentsCount = -1
    let observedAbortReason: unknown
    let resolveSlowTool: (() => void) | undefined

    const slowCancellableTool = {
      name: 'SlowEcho',
      inputSchema: z.object({ mode: z.enum(['fast', 'slow', 'cancel']) }),
      isEnabled: () => true,
      prompt: async (opts: { agents?: AgentDefinition[] }) => {
        for (const a of opts.agents ?? []) {
          observedPromptAgents.push(a.agentType)
        }
        return 'SlowEcho test tool'
      },
      call: async (
        input: { mode: 'fast' | 'slow' | 'cancel' },
        context: {
          abortController: AbortController
          options: { agentDefinitions: { activeAgents: AgentDefinition[] } }
        },
      ) => {
        observedCallAgentsCount =
          context.options.agentDefinitions.activeAgents.length
        if (input.mode === 'fast') {
          return { data: { ok: true } }
        }
        if (input.mode === 'slow') {
          await new Promise(resolve => setTimeout(resolve, 75))
          return { data: { done: true } }
        }
        // mode === 'cancel': wait until request abort fires
        await new Promise<void>(resolve => {
          resolveSlowTool = resolve
          if (context.abortController.signal.aborted) {
            observedAbortReason = context.abortController.signal.reason
            resolve()
            return
          }
          context.abortController.signal.addEventListener(
            'abort',
            () => {
              observedAbortReason = context.abortController.signal.reason
              resolve()
            },
            { once: true },
          )
        })
        return { data: { aborted: true } }
      },
    } as unknown as Tool

    const mockAgent: AgentDefinition = {
      agentType: 'trusted-serve-agent',
      whenToUse: 'test',
      source: 'userSettings',
      getSystemPrompt: () => 'prompt',
    }

    const { server, ready, dispose } = createMCPServer(
      process.cwd(),
      false,
      false,
      'raw',
      {
        progressHeartbeatIntervalMs: 20,
        getToolsOverride: () => [slowCancellableTool],
        loadAgentDefinitions: async () => ({
          activeAgents: [mockAgent],
          allAgents: [mockAgent],
        }),
      },
    )

    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair()
    let listChangedCount = 0
    const progressEvents: Array<{ progress: number; message?: string }> = []

    const mcpClient = new Client(
      { name: 'test-client', version: '1.0.0' },
      {
        listChanged: {
          tools: {
            autoRefresh: false,
            debounceMs: 0,
            onChanged: () => {
              listChangedCount += 1
            },
          },
        },
      },
    )

    try {
      await Promise.all([
        server.connect(serverTransport),
        mcpClient.connect(clientTransport),
      ])
      await ready

      // 1. Server declares capabilities.tools.listChanged: true
      expect(mcpClient.getServerCapabilities()?.tools?.listChanged).toBe(true)

      // 2. tools/list passes loaded project/user agent definitions to tool.prompt
      const listed = await mcpClient.listTools()
      expect(listed.tools.map(t => t.name)).toEqual(['SlowEcho'])
      expect(observedPromptAgents).toContain('trusted-serve-agent')

      // 3. Settings change listener sends notifications/tools/list_changed
      settingsChangeDetector.notifyChange('userSettings')
      await new Promise(resolve => setTimeout(resolve, 30))
      expect(listChangedCount).toBeGreaterThanOrEqual(1)

      // 4. tools/call receives agentDefinitions + emits progress heartbeats when progressToken supplied
      const slowResult = await mcpClient.callTool(
        { name: 'SlowEcho', arguments: { mode: 'slow' } },
        {
          onprogress: p => {
            progressEvents.push({ progress: p.progress, message: p.message })
          },
        },
      )
      expect(slowResult.isError).toBeUndefined()
      expect(observedCallAgentsCount).toBe(1)
      expect(progressEvents.length).toBeGreaterThanOrEqual(2)

      // 5. Client-side request cancellation aborts toolUseContext.abortController with 'remote-cancel'
      const cancelAc = new AbortController()
      const callPromise = mcpClient.callTool(
        { name: 'SlowEcho', arguments: { mode: 'cancel' } },
        { signal: cancelAc.signal },
      )
      await new Promise(resolve => setTimeout(resolve, 25))
      cancelAc.abort()
      await callPromise.catch(() => {})
      await new Promise(resolve => setTimeout(resolve, 25))
      expect(isRemoteCancelAbortReason(observedAbortReason)).toBe(true)
      resolveSlowTool?.()
    } finally {
      dispose()
      await mcpClient.close().catch(() => {})
      await server.close().catch(() => {})
    }
  })
})
