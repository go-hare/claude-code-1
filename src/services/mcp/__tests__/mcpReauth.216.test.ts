/**
 * densable 2.1.216 #19 — MCP re-auth must not revoke working credentials
 * before new sign-in succeeds; needs-reauth toast points at /mcp Re-authenticate.
 *
 * Residuals aligned densable:
 * - CLI `mcp login` still `wat` before OAuth
 * - toast oKn uses DYt WeakSet identity, not truthy headersHelper string
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  clearMcpNeedsReauthListenersForTests,
  emitMcpNeedsReauth,
  formatMcpNeedsReauthNotification,
  isAnthropicDesignMcpUrl,
  isMcpHeadersHelperConfig,
  markMcpHeadersHelperConfig,
  mcpNeedsReauthNotificationKey,
  shouldSkipMcpNeedsReauthNotification,
  subscribeMcpNeedsReauth,
} from '../mcpReauthSignal.js'

describe('mcp reauth signal + gate (densable 2.1.216 #19)', () => {
  afterEach(() => {
    clearMcpNeedsReauthListenersForTests()
  })

  test('format/key match densable toast strings', () => {
    expect(formatMcpNeedsReauthNotification('github')).toBe(
      'MCP server "github" lost authentication · open /mcp and select Re-authenticate',
    )
    expect(mcpNeedsReauthNotificationKey('github')).toBe(
      'mcp-needs-reauth-github',
    )
  })

  test('subscribe/emit fan-out (densable xs/t7r)', () => {
    const seen: string[] = []
    const unsub = subscribeMcpNeedsReauth(name => {
      seen.push(name)
    })
    emitMcpNeedsReauth('a')
    emitMcpNeedsReauth('b')
    unsub()
    emitMcpNeedsReauth('c')
    expect(seen).toEqual(['a', 'b'])
  })

  test('shouldSkip: static Authorization header (n5e)', () => {
    expect(
      shouldSkipMcpNeedsReauthNotification({
        configType: 'http',
        headers: { Authorization: 'Bearer x' },
        xaaEnabled: false,
        isFirstPartyProvider: true,
        hasClaudeAiAccessToken: false,
      }),
    ).toBe(true)
  })

  test('shouldSkip: densable DYt WeakSet identity — not headersHelper string', () => {
    // densable oKn does NOT skip on truthy headersHelper string (that is nKn).
    expect(
      shouldSkipMcpNeedsReauthNotification({
        configType: 'sse',
        // no configObject mark
        xaaEnabled: false,
        isFirstPartyProvider: true,
        hasClaudeAiAccessToken: true,
      }),
    ).toBe(false)

    const cfg = { type: 'http', headersHelper: 'mint.sh' }
    expect(isMcpHeadersHelperConfig(cfg)).toBe(false)
    expect(
      shouldSkipMcpNeedsReauthNotification({
        configType: 'http',
        configObject: cfg,
        xaaEnabled: false,
        isFirstPartyProvider: true,
        hasClaudeAiAccessToken: true,
      }),
    ).toBe(false)

    markMcpHeadersHelperConfig(cfg)
    expect(isMcpHeadersHelperConfig(cfg)).toBe(true)
    expect(
      shouldSkipMcpNeedsReauthNotification({
        configType: 'http',
        configObject: cfg,
        xaaEnabled: false,
        isFirstPartyProvider: true,
        hasClaudeAiAccessToken: true,
      }),
    ).toBe(true)

    // Different object identity is not marked
    expect(
      shouldSkipMcpNeedsReauthNotification({
        configType: 'http',
        configObject: { type: 'http', headersHelper: 'mint.sh' },
        xaaEnabled: false,
        isFirstPartyProvider: true,
        hasClaudeAiAccessToken: true,
      }),
    ).toBe(false)
  })

  test('shouldSkip: non-Authorization headers alone do not skip (not n5e)', () => {
    expect(
      shouldSkipMcpNeedsReauthNotification({
        configType: 'http',
        headers: { 'X-Custom': '1' },
        xaaEnabled: false,
        isFirstPartyProvider: true,
        hasClaudeAiAccessToken: true,
      }),
    ).toBe(false)
  })

  test('shouldSkip: XAA when enabled', () => {
    expect(
      shouldSkipMcpNeedsReauthNotification({
        configType: 'http',
        oauthXaa: true,
        xaaEnabled: true,
        isFirstPartyProvider: true,
        hasClaudeAiAccessToken: true,
      }),
    ).toBe(true)
    expect(
      shouldSkipMcpNeedsReauthNotification({
        configType: 'http',
        oauthXaa: true,
        xaaEnabled: false,
        isFirstPartyProvider: true,
        hasClaudeAiAccessToken: true,
      }),
    ).toBe(false)
  })

  test('shouldSkip: Anthropic design MCP only with firstParty + claude token', () => {
    const url = 'https://api.anthropic.com/v1/design/foo'
    expect(isAnthropicDesignMcpUrl(url)).toBe(true)
    expect(
      shouldSkipMcpNeedsReauthNotification({
        configType: 'http',
        url,
        xaaEnabled: false,
        isFirstPartyProvider: true,
        hasClaudeAiAccessToken: true,
      }),
    ).toBe(true)
    expect(
      shouldSkipMcpNeedsReauthNotification({
        configType: 'http',
        url,
        xaaEnabled: false,
        isFirstPartyProvider: false,
        hasClaudeAiAccessToken: true,
      }),
    ).toBe(false)
    expect(
      shouldSkipMcpNeedsReauthNotification({
        configType: 'http',
        url,
        xaaEnabled: false,
        isFirstPartyProvider: true,
        hasClaudeAiAccessToken: false,
      }),
    ).toBe(false)
  })

  test('should not skip plain OAuth http/sse', () => {
    expect(
      shouldSkipMcpNeedsReauthNotification({
        configType: 'http',
        url: 'https://mcp.example.com',
        xaaEnabled: false,
        isFirstPartyProvider: true,
        hasClaudeAiAccessToken: true,
      }),
    ).toBe(false)
  })
})

describe('mcp reauth source contracts (densable QLu/ebe/eMu + t7r)', () => {
  test('auth.ts exports snapshot/eMu and emits on permanent refresh clear', () => {
    const src = readFileSync(join(import.meta.dir, '../auth.ts'), 'utf8')
    expect(src).toContain('export async function snapshotMcpOAuthTokens')
    expect(src).toContain('export async function revokeReplacedMcpTokens')
    expect(src).toContain('export async function revokeTokensAtServer')
    expect(src).toContain('emitMcpNeedsReauth(this.serverName)')
    expect(src).toContain('readConcurrentRefreshWinner')
    expect(src).toContain('invalid_client')
    expect(src).toContain('unauthorized_client')
    // Clear-auth wat path still clears local; reauth must not call it first
    expect(src).toContain(
      'Do **not** use this before interactive re-auth (2.1.216 #19)',
    )
  })

  test('MCPRemoteServerMenu: snapshot → OAuth → connected → eMu (no pre-revoke)', () => {
    const src = readFileSync(
      join(import.meta.dir, '../../../components/mcp/MCPRemoteServerMenu.tsx'),
      'utf8',
    )
    expect(src).toContain('snapshotMcpOAuthTokens')
    expect(src).toContain('revokeReplacedMcpTokens')
    expect(src).toContain('Got new credentials, but ')
    expect(src).toContain('rejected them on reconnect')
    expect(src).toContain('BG_NO_TERMINAL_MCP_AUTH_MSG')
    // Pre-OAuth revokeServerTokens removed from handleAuthenticate
    const authFn = src.slice(
      src.indexOf('const handleAuthenticate'),
      src.indexOf('const handleClearAuth'),
    )
    expect(authFn).not.toContain('revokeServerTokens')
    expect(authFn).toContain('previousTokens')
    expect(authFn).toContain("result.client.type === 'connected'")
  })

  test('useManageMCPConnections: t7r-style subscribe + densable oKn (configObject)', () => {
    const src = readFileSync(
      join(import.meta.dir, '../useManageMCPConnections.ts'),
      'utf8',
    )
    expect(src).toContain('subscribeMcpNeedsReauth')
    expect(src).toContain('shouldSkipMcpNeedsReauthNotification')
    expect(src).toContain('configObject: cfg')
    expect(src).not.toContain('headersHelper,')
    expect(src).toContain('mcpNeedsReauthNotificationKey')
    expect(src).toContain('formatMcpNeedsReauthNotification')
    expect(src).toContain('timeoutMs: 12000')
    expect(src).toContain("priority: 'high'")
  })

  test('CLI mcp login: densable still wat before ebe — keep parity (no invented eMu)', () => {
    const src = readFileSync(
      join(import.meta.dir, '../../../cli/handlers/mcp.tsx'),
      'utf8',
    )
    // densable SEA: await wat(e,n.config,{preserveStepUpState:!0}),await ebe(...)
    const oauthCase = src.slice(
      src.indexOf("case 'oauth'"),
      src.indexOf('if (isMcpServerDisabled(name))'),
    )
    const revokeAt = oauthCase.indexOf('revokeServerTokens')
    const oauthAt = oauthCase.indexOf('performMCPOAuthFlow')
    expect(revokeAt).toBeGreaterThan(-1)
    expect(oauthAt).toBeGreaterThan(-1)
    expect(revokeAt).toBeLessThan(oauthAt)
    expect(oauthCase).toContain('preserveStepUpState: true')
  })

  test('mcpReauthSignal: DYt helpers present (prg WeakSet)', () => {
    const src = readFileSync(
      join(import.meta.dir, '../mcpReauthSignal.ts'),
      'utf8',
    )
    expect(src).toContain('headersHelperConfigIdentity')
    expect(src).toContain('markMcpHeadersHelperConfig')
    expect(src).toContain('isMcpHeadersHelperConfig')
    expect(src).toContain('WeakSet')
    // Must not skip on headersHelper string alone
    expect(src).not.toContain('if (opts.headersHelper)')
  })
})
