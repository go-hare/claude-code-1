import { afterEach, describe, expect, mock, test } from 'bun:test'
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { logMock } from '../../../tests/mocks/log'
import { debugMock } from '../../../tests/mocks/debug'

mock.module('../../services/analytics/index.js', () => ({
  logEvent: () => {},
  stripProtoFields: <T>(v: T) => v,
}))
mock.module('../log.ts', logMock)
mock.module('../debug.ts', debugMock)

const {
  JWT_BEARER_GRANT,
  OIDC_FEDERATION_BETA,
  OIDC_IDENTITY_TOKEN_MAX_BYTES,
  OIDC_TOKEN_FETCH_TIMEOUT_MS,
  OIDC_TOKEN_PATH,
  assertHttpsTokenBaseURL,
  clearOidcFederationCaches,
  exchangeOidcFederationToken,
  getOidcAccountOnHold,
  invalidateOidcFederationCacheOnRetry,
  loadOidcFederationConfig,
  parseOidcAccountOnHold,
  redactTokenErrorBody,
  resolveIdentityTokenProvider,
  resolveOidcCredentialsPath,
  resolveOidcFederationAccessToken,
} = await import('../anthropicOidc.js')
const { AnthropicProfileOauthError } = await import('../anthropicProfile.js')
const { clearAnthropicProfileCaches } = await import('../anthropicProfile.js')

const saved: Record<string, string | undefined> = {}

function pinEnv(patch: Record<string, string | undefined>): void {
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in saved)) saved[k] = process.env[k]
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  clearAnthropicProfileCaches()
  clearOidcFederationCaches()
}

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
    delete saved[k]
  }
  clearAnthropicProfileCaches()
  clearOidcFederationCaches()
})

describe('leftover 239 i4b / VPu / By_ OIDC jwt-bearer', () => {
  test('i4b env-quad builds oidc_federation config', async () => {
    pinEnv({
      ANTHROPIC_PROFILE: undefined,
      ANTHROPIC_CONFIG_DIR: join(
        tmpdir(),
        `cc-oidc-missing-${process.pid}-${Date.now()}`,
      ),
      ANTHROPIC_FEDERATION_RULE_ID: 'rule_abc',
      ANTHROPIC_ORGANIZATION_ID: 'org_xyz',
      ANTHROPIC_WORKSPACE_ID: 'ws_1',
      ANTHROPIC_IDENTITY_TOKEN_FILE: '/tmp/id.jwt',
      ANTHROPIC_SERVICE_ACCOUNT_ID: 'sa_1',
      ANTHROPIC_API_KEY: undefined,
      ANTHROPIC_AUTH_TOKEN: undefined,
      CLAUDE_CODE_OAUTH_TOKEN: undefined,
    })
    const config = await loadOidcFederationConfig()
    expect(config).toEqual({
      organization_id: 'org_xyz',
      workspace_id: 'ws_1',
      base_url: undefined,
      authentication: {
        type: 'oidc_federation',
        federation_rule_id: 'rule_abc',
        service_account_id: 'sa_1',
        identity_token: { source: 'file', path: '/tmp/id.jwt' },
        scope: undefined,
      },
    })
  })

  test('VPu POSTs jwt-bearer with both betas', async () => {
    const jwt = 'e.jwt.token'
    pinEnv({
      ANTHROPIC_IDENTITY_TOKEN: jwt,
      ANTHROPIC_BASE_URL: 'https://api.example.com/',
    })
    const fetchFn = mock(
      async (url: string | URL | Request, init?: RequestInit) => {
        expect(String(url)).toBe(`https://api.example.com${OIDC_TOKEN_PATH}`)
        expect(init?.method).toBe('POST')
        const headers = init?.headers as Record<string, string>
        expect(headers['anthropic-beta']).toBe(
          `oauth-2025-04-20,${OIDC_FEDERATION_BETA}`,
        )
        expect(String(headers['User-Agent'])).toContain(
          'oidcFederationProvider',
        )
        expect(JSON.parse(String(init?.body))).toEqual({
          grant_type: JWT_BEARER_GRANT,
          assertion: jwt,
          federation_rule_id: 'rule_1',
          organization_id: 'org_1',
          service_account_id: 'sa_9',
          workspace_id: 'ws_2',
        })
        return new Response(
          JSON.stringify({
            access_token: 'exchanged',
            expires_in: 3600,
            token_type: 'Bearer',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      },
    )
    const tok = await exchangeOidcFederationToken(
      {
        organization_id: 'org_1',
        workspace_id: 'ws_2',
        base_url: 'https://api.example.com/',
        authentication: {
          type: 'oidc_federation',
          federation_rule_id: 'rule_1',
          service_account_id: 'sa_9',
        },
      },
      fetchFn,
    )
    expect(tok.token).toBe('exchanged')
    expect(tok.expiresAt).toBeGreaterThan(Date.now() / 1000)
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  test('By_ prefers identity_token file then env inline', () => {
    const dir = join(tmpdir(), `cc-oidc-jwt-${process.pid}-${Date.now()}`)
    mkdirSync(dir, { recursive: true })
    const path = join(dir, 'id.jwt')
    writeFileSync(path, ' file.jwt \n')
    const fromFile = resolveIdentityTokenProvider({
      type: 'oidc_federation',
      identity_token: { source: 'file', path },
    })
    expect(fromFile).not.toBeNull()
    const inline = resolveIdentityTokenProvider(
      { type: 'oidc_federation' },
      { ANTHROPIC_IDENTITY_TOKEN: 'inline.jwt' },
    )
    expect(inline?.()).toBe('inline.jwt')
  })

  test('Pjo refuses non-https remote bases', () => {
    expect(() =>
      assertHttpsTokenBaseURL('https://api.anthropic.com'),
    ).not.toThrow()
    expect(() => assertHttpsTokenBaseURL('http://localhost:8080')).not.toThrow()
    expect(() => assertHttpsTokenBaseURL('http://evil.example')).toThrow(
      /non-https/,
    )
  })

  test('hbe keeps only oauth error fields', () => {
    expect(
      redactTokenErrorBody({ error: 'invalid_grant', access_token: 'x' }),
    ).toEqual({
      error: 'invalid_grant',
    })
  })

  test('getActiveProfileWire exchanges env-quad', async () => {
    pinEnv({
      ANTHROPIC_PROFILE: undefined,
      ANTHROPIC_CONFIG_DIR: join(
        tmpdir(),
        `cc-oidc-wire-${process.pid}-${Date.now()}`,
      ),
      ANTHROPIC_FEDERATION_RULE_ID: 'rule_w',
      ANTHROPIC_ORGANIZATION_ID: 'org_w',
      ANTHROPIC_IDENTITY_TOKEN: 'wire.jwt',
      ANTHROPIC_BASE_URL: 'https://api.example.com',
      ANTHROPIC_API_KEY: undefined,
      ANTHROPIC_AUTH_TOKEN: undefined,
      CLAUDE_CODE_OAUTH_TOKEN: undefined,
    })
    const prevFetch = globalThis.fetch
    globalThis.fetch = mock(async () => {
      return new Response(
        JSON.stringify({
          access_token: 'wif_tok',
          expires_in: 3600,
          token_type: 'Bearer',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }) as unknown as typeof fetch
    try {
      const { getActiveProfileWire } = await import('../auth.js')
      const wire = await getActiveProfileWire()
      expect(wire?.token).toBe('wif_tok')
      expect(wire?.extraHeaders).toEqual({})
      expect(wire?.baseURL).toBe('https://api.example.com')
    } finally {
      globalThis.fetch = prevFetch
    }
  })

  test('sOt parses account_on_hold', () => {
    expect(
      parseOidcAccountOnHold({
        error: 'invalid_grant',
        error_description: 'account_on_hold',
        error_uri: 'https://claude.ai/restricted',
        access_token: 'x',
      }),
    ).toEqual({ url: 'https://claude.ai/restricted' })
    expect(
      getOidcAccountOnHold(
        new AnthropicProfileOauthError('hold', 400, {
          error: 'access_denied',
          error_description: 'account_on_hold',
        }),
      ),
    ).not.toBeNull()
    expect(
      getOidcAccountOnHold(new AnthropicProfileOauthError('x', 500, {})),
    ).toBeNull()
  })

  test('kew invalidates TQt on 401 except DUr and sOt', async () => {
    pinEnv({
      ANTHROPIC_PROFILE: undefined,
      ANTHROPIC_CONFIG_DIR: join(
        tmpdir(),
        `cc-oidc-kew-${process.pid}-${Date.now()}`,
      ),
      ANTHROPIC_FEDERATION_RULE_ID: 'rule_k',
      ANTHROPIC_ORGANIZATION_ID: 'org_k',
      ANTHROPIC_IDENTITY_TOKEN: 'kew.jwt',
      ANTHROPIC_BASE_URL: 'https://api.example.com',
    })
    const fetchFn = mock(async () => {
      return new Response(
        JSON.stringify({
          access_token: 'first',
          expires_in: 3600,
          token_type: 'Bearer',
        }),
        { status: 200 },
      )
    })
    await resolveOidcFederationAccessToken(process.env, fetchFn)
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(
      await invalidateOidcFederationCacheOnRetry(
        new AnthropicProfileOauthError('bad', 401),
      ),
    ).toBe(true)
    await resolveOidcFederationAccessToken(process.env, fetchFn)
    expect(fetchFn).toHaveBeenCalledTimes(2)
    expect(
      await invalidateOidcFederationCacheOnRetry(
        new AnthropicProfileOauthError(
          'Access token at x has expired and no refresh is available (client_id empty, refresh_token empty)',
        ),
      ),
    ).toBe(false)
    expect(
      await invalidateOidcFederationCacheOnRetry(
        new AnthropicProfileOauthError('hold', 400, {
          error: 'invalid_grant',
          error_description: 'account_on_hold',
        }),
      ),
    ).toBe(false)
  })

  test('jy_ reuses profile credentials file unless forceRefresh', async () => {
    const dir = join(tmpdir(), `cc-oidc-jy-${process.pid}-${Date.now()}`)
    mkdirSync(join(dir, 'configs'), { recursive: true })
    mkdirSync(join(dir, 'credentials'), { recursive: true })
    writeFileSync(
      join(dir, 'configs', 'default.json'),
      JSON.stringify({
        organization_id: 'org_j',
        authentication: {
          type: 'oidc_federation',
          federation_rule_id: 'rule_j',
        },
      }),
    )
    writeFileSync(
      join(dir, 'credentials', 'default.json'),
      JSON.stringify({
        version: '1.0',
        type: 'oauth_token',
        access_token: 'cached.tok',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      }),
    )
    pinEnv({
      ANTHROPIC_PROFILE: undefined,
      ANTHROPIC_CONFIG_DIR: dir,
      ANTHROPIC_FEDERATION_RULE_ID: undefined,
      ANTHROPIC_ORGANIZATION_ID: undefined,
      ANTHROPIC_IDENTITY_TOKEN: 'file.jwt',
      ANTHROPIC_API_KEY: undefined,
      ANTHROPIC_AUTH_TOKEN: undefined,
      CLAUDE_CODE_OAUTH_TOKEN: undefined,
    })
    const config = await loadOidcFederationConfig()
    expect(config?.authentication.type).toBe('oidc_federation')
    expect(resolveOidcCredentialsPath(config!)).toBe(
      join(dir, 'credentials', 'default.json'),
    )
    const fetchFn = mock(async () => {
      return new Response(
        JSON.stringify({
          access_token: 'fresh',
          expires_in: 3600,
          token_type: 'Bearer',
        }),
        { status: 200 },
      )
    })
    const tok = await resolveOidcFederationAccessToken(process.env, fetchFn)
    expect(tok?.token).toBe('cached.tok')
    expect(fetchFn).toHaveBeenCalledTimes(0)
    expect(
      await invalidateOidcFederationCacheOnRetry(
        new AnthropicProfileOauthError('stale', 401),
      ),
    ).toBe(true)
    const again = await resolveOidcFederationAccessToken(process.env, fetchFn)
    expect(again?.token).toBe('fresh')
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  test('withRetry wires leftover kew before CannotRetry', () => {
    const src = readFileSync(
      join(import.meta.dir, '../../services/api/withRetry.ts'),
      'utf8',
    )
    expect(src).toContain('invalidateOidcFederationCacheOnRetry')
    expect(src).toContain('handledWifAuthError')
  })

  test('$Ur token fetch uses 10s abort', async () => {
    pinEnv({
      ANTHROPIC_PROFILE: undefined,
      ANTHROPIC_CONFIG_DIR: join(
        tmpdir(),
        `cc-oidc-to-${process.pid}-${Date.now()}`,
      ),
      ANTHROPIC_FEDERATION_RULE_ID: 'rule_t',
      ANTHROPIC_ORGANIZATION_ID: 'org_t',
      ANTHROPIC_IDENTITY_TOKEN: 'to.jwt',
      ANTHROPIC_BASE_URL: 'https://api.example.com',
    })
    const fetchFn = mock(
      async (_url: string | URL | Request, init?: RequestInit) => {
        expect(init?.signal).toBeDefined()
        expect(OIDC_TOKEN_FETCH_TIMEOUT_MS).toBe(10_000)
        return new Response(
          JSON.stringify({
            access_token: 'timed',
            expires_in: 3600,
            token_type: 'Bearer',
          }),
          { status: 200 },
        )
      },
    )
    const tok = await resolveOidcFederationAccessToken(process.env, fetchFn)
    expect(tok?.token).toBe('timed')
  })

  test('identity token over 16 KiB is refused', async () => {
    const huge = 'a'.repeat(OIDC_IDENTITY_TOKEN_MAX_BYTES + 1)
    pinEnv({ ANTHROPIC_IDENTITY_TOKEN: huge })
    await expect(
      exchangeOidcFederationToken({
        organization_id: 'org_1',
        authentication: {
          type: 'oidc_federation',
          federation_rule_id: 'rule_1',
        },
      }),
    ).rejects.toThrow(/16 KiB/)
  })
})
