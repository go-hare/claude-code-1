import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  clearLoggableMcpServersForTests,
  isFixedUrlOfficialMarketplacePluginMcp,
  isMcpServerLoggable,
  markMcpServerLoggable,
  redactMcpServerNameForOtel,
} from '../../../utils/mcpUsageAttribution.js'
import {
  dialedWithoutOAuth,
  dialWithSignedOutFallback,
  markStoredTokenRejectedForRedial,
  rejectedStoredTokens,
} from '../auth.js'
import {
  formatMcpToolTimeoutMessage,
  MCP_QUESTION_UNANSWERED_MESSAGE,
} from '../client.js'
import { resolveRemoteConnectAuth } from '../connectionHelpers.js'
import { formatFailedMcpIssue } from '../mcpConnectionIssue.js'
import { describeMcpConfigFilePath } from '../utils.js'

describe('#1208 MCP tool timeout with unanswered elicitation', () => {
  test('appends unanswered question guidance when hasOpenQuestions is true', () => {
    const msg = formatMcpToolTimeoutMessage('srv', 'ask', 30_000, true)
    expect(msg).toContain('MCP server "srv" tool "ask" timed out after 30s.')
    expect(msg).toContain(MCP_QUESTION_UNANSWERED_MESSAGE)
    expect(msg).toContain('Do not call this tool again in this turn.')
  })

  test('omits unanswered question guidance when hasOpenQuestions is false', () => {
    const msg = formatMcpToolTimeoutMessage('srv', 'ask', 30_000, false)
    expect(msg).toBe('MCP server "srv" tool "ask" timed out after 30s')
  })
})

describe('#1238 describeMcpConfigFilePath local scope uses getProjectRoot', () => {
  test('uses getProjectRoot() rather than getCwd() for local scope', () => {
    const utilsSrc = readFileSync(join(__dirname, '..', 'utils.ts'), 'utf8')
    expect(utilsSrc).toContain(
      'return `${getGlobalClaudeFile()} [project: ${getProjectRoot()}]`',
    )
    const described = describeMcpConfigFilePath('local')
    expect(described).toContain('[project:')
  })
})

describe('#1239 formatFailedMcpIssue does not duplicate errorCode prefix', () => {
  test('does not repeat ENOENT: when error already starts with ENOENT: ', () => {
    expect(
      formatFailedMcpIssue({
        errorCode: 'ENOENT',
        error: 'ENOENT: no such file or directory',
      }),
    ).toBe('ENOENT: no such file or directory')
  })

  test('does not repeat when error equals codeLabel', () => {
    expect(
      formatFailedMcpIssue({
        errorCode: 'ENOENT',
        error: 'ENOENT',
      }),
    ).toBe('ENOENT')
  })

  test('prepends codeLabel when error does not start with it', () => {
    expect(
      formatFailedMcpIssue({
        errorCode: 'ENOENT',
        error: 'command not found',
      }),
    ).toBe('ENOENT: command not found')
  })
})

describe('#1263 & #1264 dialedWithoutOAuth + isEffectivelyAuthenticated', () => {
  test('resolveRemoteConnectAuth skips OAuth provider when dialedWithoutOAuth matches url', async () => {
    dialedWithoutOAuth.set('my-srv', 'https://example.com/mcp')
    try {
      const res = await resolveRemoteConnectAuth(
        'my-srv',
        { type: 'http', url: 'https://example.com/mcp', scope: 'user' },
        {},
      )
      expect(res.authProvider).toBeUndefined()
    } finally {
      dialedWithoutOAuth.delete('my-srv')
    }
  })

  test('MCPRemoteServerMenu distinguishes authenticated vs not signed in', () => {
    const menuSrc = readFileSync(
      join(
        __dirname,
        '..',
        '..',
        '..',
        'components',
        'mcp',
        'MCPRemoteServerMenu.tsx',
      ),
      'utf8',
    )
    expect(menuSrc).toContain('not signed in')
    expect(menuSrc).toContain('dialedWithoutOAuth.set')
  })
})

describe('#1338 OTel mcp_server.name loggableMcpServers', () => {
  test('recognizes fixed-URL official marketplace plugin remote MCP servers', () => {
    expect(
      isFixedUrlOfficialMarketplacePluginMcp({
        scope: 'dynamic',
        type: 'http',
        pluginSource: 'my-plugin@claude-plugins-official',
        url: 'https://mcp.example.com/sse',
      }),
    ).toBe(true)

    expect(
      isFixedUrlOfficialMarketplacePluginMcp({
        scope: 'dynamic',
        type: 'http',
        pluginSource: 'my-plugin@claude-plugins-official',
        url: 'https://${HOST}/mcp',
      }),
    ).toBe(false)

    expect(
      isFixedUrlOfficialMarketplacePluginMcp({
        scope: 'dynamic',
        type: 'http',
        pluginSource: 'my-plugin@third-party',
        url: 'https://mcp.example.com/sse',
      }),
    ).toBe(false)
  })

  test('redactMcpServerNameForOtel returns real name only when loggable', () => {
    clearLoggableMcpServersForTests()
    expect(redactMcpServerNameForOtel('plugin:official:srv')).toBe('custom')
    markMcpServerLoggable('plugin:official:srv')
    expect(isMcpServerLoggable('plugin:official:srv')).toBe(true)
    expect(redactMcpServerNameForOtel('plugin:official:srv')).toBe(
      'plugin:official:srv',
    )
    clearLoggableMcpServersForTests()
  })
})

describe('#1364 signed-out fallback when stored token fails', () => {
  test('dialWithSignedOutFallback returns first result for stdio', async () => {
    const first = {
      name: 'local',
      type: 'failed',
      config: { type: 'stdio', command: 'x', args: [], scope: 'user' },
    }
    const out = await dialWithSignedOutFallback(
      async () => first,
      () => true,
      'local',
      { type: 'stdio', command: 'x', args: [], scope: 'user' },
    )
    expect(out).toBe(first)
    expect(typeof markStoredTokenRejectedForRedial).toBe('function')
    expect(rejectedStoredTokens.size).toBe(0)
  })
})

describe('#1365 mcpLogoutHandler checks revokeResult.cleared', () => {
  test('mcp.tsx checks revokeResult.cleared before reporting Signed out', () => {
    const mcpHandlerSrc = readFileSync(
      join(__dirname, '..', '..', '..', 'cli', 'handlers', 'mcp.tsx'),
      'utf8',
    )
    expect(mcpHandlerSrc).toContain('if (!revokeResult.cleared)')
    expect(mcpHandlerSrc).toContain('keychain_unreadable')
  })
})
