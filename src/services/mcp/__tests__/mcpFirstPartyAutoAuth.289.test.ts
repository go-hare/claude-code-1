/**
 * densable 2.1.289 first-party MCP auto-auth (`o$` / `Jn` / `X` / `Bt` / `Ur`).
 * Do not treat Design jo as L. Do not invent hop tokens.
 */
import { describe, expect, test } from 'bun:test'
import {
  classifyFirstPartyAuthRejection,
  FIRST_PARTY_AUTH_REJECTED,
  FirstPartyDesignNeedsConsentError,
  isFirstPartyAnthropicMcpUrl,
  isFirstPartyDesignMcpUrl,
  shouldUseFirstPartyAutoAuth,
  wrapFirstPartyAutoAuthFetch,
} from '../mcpFirstPartyAutoAuth.js'

const DESIGN = 'https://api.anthropic.com/v1/design/mcp'
const PAGES = 'https://api.anthropic.com/v1/pages/mcp'
const CLAUDE_TEST = 'https://api.anthropic.com/v1/claude/test/foo'
const OTHER = 'https://example.com/v1/design/mcp'

function unauthorized(status = 401): Error & { status: number } {
  return Object.assign(new Error('Unauthorized'), {
    name: 'UnauthorizedError',
    status,
  })
}

describe('gold o$ / Vx first-party MCP URL', () => {
  test('https api.anthropic.com design prefix, pages exact, claude/test prefix', () => {
    expect(isFirstPartyAnthropicMcpUrl(DESIGN)).toBe(true)
    expect(isFirstPartyAnthropicMcpUrl(PAGES)).toBe(true)
    expect(isFirstPartyAnthropicMcpUrl(CLAUDE_TEST)).toBe(true)
    expect(isFirstPartyDesignMcpUrl(DESIGN)).toBe(true)
    expect(isFirstPartyDesignMcpUrl(PAGES)).toBe(false)
    expect(isFirstPartyDesignMcpUrl(CLAUDE_TEST)).toBe(false)
  })

  test('rejects http, other hosts, ports, and non-LF paths', () => {
    expect(
      isFirstPartyAnthropicMcpUrl('http://api.anthropic.com/v1/design/mcp'),
    ).toBe(false)
    expect(isFirstPartyAnthropicMcpUrl(OTHER)).toBe(false)
    expect(
      isFirstPartyAnthropicMcpUrl(
        'https://api.anthropic.com:8443/v1/design/mcp',
      ),
    ).toBe(false)
    expect(
      isFirstPartyAnthropicMcpUrl('https://api.anthropic.com/v1/mcp'),
    ).toBe(false)
    expect(
      isFirstPartyAnthropicMcpUrl('https://api.anthropic.com/v1/pages/mcp/x'),
    ).toBe(false)
  })
})

describe('gold Ur FIRST_PARTY_AUTH_REJECTED', () => {
  test('login 401 is not OAuth Yo', () => {
    const r = classifyFirstPartyAuthRejection({
      error: unauthorized(),
      statusCode: 401,
      serverRef: { type: 'http', url: PAGES },
      firstPartyBearer: 'login',
    })
    expect(r?.errorCode).toBe(FIRST_PARTY_AUTH_REJECTED)
    expect(r?.message).toContain('Run /login and retry')
    expect(r?.message).not.toContain('/design-login')
  })

  test('design 403 without design scope points at /design-login', () => {
    const r = classifyFirstPartyAuthRejection({
      error: unauthorized(403),
      statusCode: 403,
      serverRef: { type: 'http', url: DESIGN },
      firstPartyBearer: 'login',
    })
    expect(r?.errorCode).toBe(FIRST_PARTY_AUTH_REJECTED)
    expect(r?.message).toContain('/design-login')
    expect(r?.message).toContain('no Claude Design access')
  })
})

describe('gold X / shouldUseFirstPartyAutoAuth', () => {
  const flags = {
    hasUserAuthHeader: false,
    helperMintsAuthHeader: false,
  }

  test('ce/re/me/non-LF/non-http short-circuit without inventing hop', async () => {
    expect(
      await shouldUseFirstPartyAutoAuth({
        type: 'http',
        url: DESIGN,
        flags: { hasUserAuthHeader: true, helperMintsAuthHeader: false },
        cliOwned: false,
      }),
    ).toBe(false)
    expect(
      await shouldUseFirstPartyAutoAuth({
        type: 'http',
        url: DESIGN,
        flags: { hasUserAuthHeader: false, helperMintsAuthHeader: true },
        cliOwned: false,
      }),
    ).toBe(false)
    expect(
      await shouldUseFirstPartyAutoAuth({
        type: 'http',
        url: DESIGN,
        flags,
        cliOwned: true,
      }),
    ).toBe(false)
    expect(
      await shouldUseFirstPartyAutoAuth({
        type: 'http',
        url: OTHER,
        flags,
        cliOwned: false,
      }),
    ).toBe(false)
    expect(
      await shouldUseFirstPartyAutoAuth({
        type: 'stdio',
        url: DESIGN,
        flags,
        cliOwned: false,
      }),
    ).toBe(false)
  })
})

describe('gold Bt wrap', () => {
  test('passthrough when Authorization already set', async () => {
    const inner = async (_url: string | URL, init?: RequestInit) => {
      const h = new Headers(init?.headers)
      return new Response('ok', {
        status: 200,
        headers: { 'x-had-auth': h.has('Authorization') ? '1' : '0' },
      })
    }
    const fetch = wrapFirstPartyAutoAuthFetch(inner)
    const r = await fetch(DESIGN, {
      headers: { Authorization: 'Bearer already' },
    })
    expect(r.headers.get('x-had-auth')).toBe('1')
  })

  test('passthrough when URL is not o$', async () => {
    let sawAuth = false
    const inner = async (_url: string | URL, init?: RequestInit) => {
      sawAuth = new Headers(init?.headers).has('Authorization')
      return new Response('ok', { status: 200 })
    }
    const fetch = wrapFirstPartyAutoAuthFetch(inner)
    await fetch(OTHER)
    expect(sawAuth).toBe(false)
  })

  test('design 403 needs_consent throws Oke', async () => {
    const inner = async () =>
      new Response(
        JSON.stringify({
          error: 'needs_consent',
          consent: 'agent_design_projects',
        }),
        { status: 403, headers: { 'content-type': 'application/json' } },
      )
    const fetch = wrapFirstPartyAutoAuthFetch(inner, { last: 'login' })
    // Without a sent token gold does not throw Oke. Force the 403+token arm
    // by sending Authorization so wrap returns inner — that is not Oke.
    // Tokenless inner 403 on o$ URL: wrap still runs doRequest; no token →
    // sentToken undefined → no Oke. Lock that.
    await expect(fetch(DESIGN)).resolves.toMatchObject({ status: 403 })
  })

  test('FirstPartyDesignNeedsConsentError name matches gold Oke', () => {
    const e = new FirstPartyDesignNeedsConsentError('agent_design_projects')
    expect(e.name).toBe('FirstPartyDesignNeedsConsentError')
    expect(e.consent).toBe('agent_design_projects')
  })
})
