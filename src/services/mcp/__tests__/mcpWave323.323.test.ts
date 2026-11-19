import { afterEach, describe, expect, test } from 'bun:test'
import { Command } from '@commander-js/extra-typings'
import { createMcpCompleteAuthTool } from '@claude-code/builtin-tools/tools/McpAuthTool/McpAuthTool.js'
import {
  registerMcpAddCommand,
  wrapHelpTextPreservingIndentedLines,
} from '../../../commands/mcp/addCommand.js'
import {
  URL_NOT_HTTP_OR_HTTPS,
  isHttpOrHttpsUrl,
} from '../../../components/mcp/elicitationUrlSafety.js'
import { collectPendingProjectMcpApprovals } from '../../mcpServerApproval.js'
import { validateSep2352Issuer } from '../auth.js'
import { classifyMcpToolCallAuthError, isSupersededMcpDial } from '../client.js'
import {
  clearRejectedClaudeAiBearerToken,
  hasClaudeAiBearerRecoveredAfterLogin,
  recordRejectedClaudeAiBearerToken,
} from '../connectionHelpers.js'
import {
  buildDocsArtifactUrl,
  extractCreatedDocSlugFromToolResult,
  isClaudeDocsConnectorServer,
} from '../docsConnectorAutoOpen.js'
import { listMcpToolsAggregated } from '../listPagination.js'
import {
  MCP_REQUIRED_SERVER_STARTUP_FLOOR_MS,
  collectRequiredMcpPrewaitServers,
  resolveMcpStartupPrewaitBudgetMs,
} from '../mcpConnectTimeout.js'
import { filterListedMcpToolsBySchema } from '../mcpToolSchema.js'
import {
  MCP_TASKS_EXTENSION_KEY,
  densableClientCapabilitiesForConnect,
  getMcpSdkGeneration,
  isMcpV1CompatMode,
  resetMcpSdkGenerationForTests,
  toV2VersionNegotiation,
} from '../mcpV2Client.js'
import {
  getOfficialMcpDirectoryUrlsEndpoint,
  isOfficialMcpUrl,
  resetOfficialMcpUrlsForTesting,
  setOfficialMcpUrlsForTesting,
} from '../officialRegistry.js'
import { matchesProjectMcpApprovalName } from '../utils.js'

describe('Wave 323 Group 3: MCP alignment items', () => {
  afterEach(() => {
    resetMcpSdkGenerationForTests()
    resetOfficialMcpUrlsForTesting()
    clearRejectedClaudeAiBearerToken()
    delete process.env.MCP_SDK_GENERATION
    delete process.env.CLAUDE_CODE_SAFE_MODE
  })

  test('#1996: classifies OAuth TOKEN_EXPIRED tool-call errors as credential_rejected', () => {
    const oauthErr = Object.assign(new Error('HTTP 401: TOKEN_EXPIRED'), {
      errorCode: 'TOKEN_EXPIRED',
    })
    expect(classifyMcpToolCallAuthError(oauthErr)).toBe('credential_rejected')

    const clientErr = Object.assign(new Error('HTTP 401: invalid_client'), {
      errorCode: 'invalid_client',
    })
    // invalid_client is excluded from OAuth-shaped reauth when status code isn't numeric 401
    expect(classifyMcpToolCallAuthError(clientErr)).toBeUndefined()
  })

  test('#2002: detects claude.ai bearer recovery after /login in another terminal', () => {
    recordRejectedClaudeAiBearerToken('old-token-123')
    expect(hasClaudeAiBearerRecoveredAfterLogin(() => 'old-token-123')).toBe(
      false,
    )
    expect(hasClaudeAiBearerRecoveredAfterLogin(() => 'fresh-token-456')).toBe(
      true,
    )
  })

  test('#2034 & #2182: mcp add --help uses node ./my-server.js and does not wrap indented examples', () => {
    const root = new Command('claude')
    const mcp = root.command('mcp')
    registerMcpAddCommand(mcp)
    const addCmd = mcp.commands.find(c => c.name() === 'add')!
    expect(addCmd.summary()).toBe('Add an MCP server')
    const help = addCmd.helpInformation()
    expect(help).toContain('node ./my-server.js')
    expect(help).not.toContain('npx my-mcp-server')

    const longExample =
      '  claude mcp add --transport http corridor https://app.corridor.dev/api/mcp --header "Authorization: Bearer ..."'
    const wrapped = wrapHelpTextPreservingIndentedLines(longExample, 40)
    expect(wrapped).toBe(longExample)
  })

  test('#2037: extracts created doc slug from Claude Docs batch result and identifies Docs server', () => {
    expect(
      isClaudeDocsConnectorServer('Claude_Docs', {
        type: 'claudeai-proxy',
        url: 'https://claude.ai/api/mcp',
        id: '758bbc64-7e6c-5dab-a3a5-2a4c7ca423fc',
        scope: 'claudeai',
      }),
    ).toBe(true)

    const slug = extractCreatedDocSlugFromToolResult([
      {
        type: 'text',
        text: JSON.stringify({
          created: {
            verdict: 'allow',
            minted: 'https://claude.ai/code/artifact/doc_abc12345',
          },
          frame: { slug: 'doc_abc12345' },
        }),
      },
    ])
    expect(slug).toBe('doc_abc12345')
    expect(buildDocsArtifactUrl('doc_abc12345')).toContain(
      '/code/artifact/doc_abc12345',
    )
  })

  test('#2046: safe mode skips project MCP server approval prompts at startup', async () => {
    process.env.CLAUDE_CODE_SAFE_MODE = '1'
    const pending = await collectPendingProjectMcpApprovals()
    expect(pending.pendingServers).toEqual([])
    expect(pending.pluginServerNames.size).toBe(0)
  })

  test('#2047: non-http/https URLs flagged for URL elicitation notice', () => {
    expect(isHttpOrHttpsUrl('https://example.com/auth')).toBe(true)
    expect(isHttpOrHttpsUrl('http://localhost:3000/cb')).toBe(true)
    expect(isHttpOrHttpsUrl('javascript:alert(1)')).toBe(false)
    expect(isHttpOrHttpsUrl('slack://open')).toBe(false)
    expect(URL_NOT_HTTP_OR_HTTPS).toContain('http or https')
  })

  test('#2052: superseded dial helper defaults to false for fresh promises', () => {
    expect(isSupersededMcpDial(undefined)).toBe(false)
  })

  test('#2054: enforces 2s startup wait floor for required MCP servers from --allowedTools / mcp_tool hooks', () => {
    const required = collectRequiredMcpPrewaitServers({
      allowedToolRules: ['mcp__linear__list_issues', 'Bash'],
      mcpToolHookServers: ['my-server'],
    })
    expect(required.has('linear')).toBe(true)
    expect(required.has('my-server')).toBe(true)
    expect(
      resolveMcpStartupPrewaitBudgetMs({
        configuredWaitMs: 250,
        hasPendingRequiredServers: true,
        elapsedMs: 100,
      }),
    ).toBe(MCP_REQUIRED_SERVER_STARTUP_FLOOR_MS - 100)
  })

  test('#2055: listMcpToolsAggregated filters out null entries from SDK host tools/list', async () => {
    const tools = await listMcpToolsAggregated(
      {
        listTools: async () => ({
          tools: [
            null,
            undefined,
            { name: 'ok', inputSchema: { type: 'object' } },
          ] as never,
        }),
      } as never,
      'sdk-host',
    )
    expect(tools).toHaveLength(1)
    expect((tools[0] as { name: string }).name).toBe('ok')
  })

  test('#2151: records dropped tools and schema rejection reasons via onDroppedTool', () => {
    const dropped: Array<{ toolName: string; reason: string }> = []
    const kept = filterListedMcpToolsBySchema(
      [
        {
          name: 'bad_combo',
          inputSchema: {
            anyOf: [{ type: 'object', properties: { a: { type: 'string' } } }],
          },
        },
        {
          name: 'good_tool',
          inputSchema: {
            type: 'object',
            properties: { a: { type: 'string' } },
          },
        },
      ],
      {
        serverName: 'srv',
        config: { type: 'stdio' },
        normalizeRootCombinators: false,
        dropInvalidSchemas: true,
        onDroppedTool: item => dropped.push(item),
      },
    )
    expect(kept.map(t => t.name)).toEqual(['good_tool'])
    expect(dropped).toHaveLength(1)
    expect(dropped[0]?.toolName).toBe('bad_combo')
    expect(dropped[0]?.reason).toContain('anyOf')
  })

  test('#2170: MCP_SDK_GENERATION=v1 runs v2 client in compatibility mode (legacy handshake + relaxed issuer check)', () => {
    process.env.MCP_SDK_GENERATION = 'v1'
    expect(getMcpSdkGeneration()).toBe('v2')
    expect(isMcpV1CompatMode()).toBe(true)
    expect(
      toV2VersionNegotiation({ mode: 'auto', probe: { timeoutMs: 3000 } }),
    ).toEqual({ mode: 'legacy' })
    const caps = densableClientCapabilitiesForConnect({
      mode: 'auto',
      probe: { timeoutMs: 3000 },
    })
    expect(caps.extensions?.[MCP_TASKS_EXTENSION_KEY]).toBeUndefined()

    const stored = { issuer: 'https://idp-a.example.com', token: 'abc' }
    expect(
      validateSep2352Issuer(stored, 'https://idp-b.example.com', {
        warn: () => {},
      }),
    ).toBe(stored)
  })

  test('#2171: complete_authentication MCP tool always asks user and denies in dontAsk mode', async () => {
    const tool = createMcpCompleteAuthTool('my-srv', {
      type: 'http',
      url: 'https://mcp.example.com',
      scope: 'user',
    })
    expect(tool.requiresUserInteraction?.()).toBe(true)
    expect(
      tool.suppressesAlwaysAllowRule?.({
        callback_url: 'http://localhost/cb?code=1',
      }),
    ).toBe(true)

    const askDecision = await tool.checkPermissions!(
      { callback_url: 'http://localhost/cb?code=1' },
      {
        getAppState: () => ({
          toolPermissionContext: { mode: 'bypassPermissions' },
        }),
      } as never,
    )
    expect(askDecision.behavior).toBe('ask')

    const dontAskDecision = await tool.checkPermissions!(
      { callback_url: 'http://localhost/cb?code=1' },
      {
        getAppState: () => ({
          toolPermissionContext: { mode: 'dontAsk' },
        }),
      } as never,
    )
    expect(dontAskDecision.behavior).toBe('deny')
    if (dontAskDecision.behavior === 'deny') {
      expect(dontAskDecision.message).toContain('/mcp')
    }
  })

  test('#2186: project (.mcp.json) MCP approvals require exact server name spelling', () => {
    expect(matchesProjectMcpApprovalName('my-server', 'my-server')).toBe(true)
    expect(matchesProjectMcpApprovalName('my_server', 'my-server')).toBe(false)
    expect(matchesProjectMcpApprovalName('My-Server', 'my-server')).toBe(false)
  })

  test('#2205: official MCP registry uses /api/directory/server-urls and normalizes URLs', () => {
    expect(getOfficialMcpDirectoryUrlsEndpoint()).toMatch(
      /\/api\/directory\/server-urls$/,
    )
    expect(isOfficialMcpUrl('https://mcp.sentry.dev/mcp')).toBe(false)
    setOfficialMcpUrlsForTesting([
      'https://user:pass@mcp.sentry.dev/mcp/?foo=bar',
    ])
    expect(isOfficialMcpUrl('https://mcp.sentry.dev/mcp')).toBe(true)
  })
})
